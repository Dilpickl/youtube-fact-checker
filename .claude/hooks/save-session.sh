#!/bin/bash

# Save Claude session transcripts.
# Works as both:
# 1. A Claude SessionEnd hook (receives JSON on stdin with transcript_path)
# 2. A git pre-commit hook (copies transcripts into .claude-sessions/ and stages them)
#
# Claude stores transcripts at ~/.claude/projects/<encoded-path>/*.jsonl
# where <encoded-path> replaces all non-alphanumeric characters with -.
# For paths longer than 200 chars (encoded), Claude truncates and appends a hash suffix.
#
# A transcript that outgrows SAVE_SESSION_MAX_BYTES is copied as line-aligned parts
# (<name>.part01.jsonl, <name>.part02.jsonl, ...) instead of as one file, so a long session can
# never leave a file in the repository that GitHub refuses to accept. Each line of a transcript is
# a self-contained record carrying its own session id, so the parts read back exactly like the
# whole file.

# GitHub rejects files over 100 MiB and warns from 50 MiB. 40 MiB parts stay clear of both.
SAVE_SESSION_MAX_BYTES="${SAVE_SESSION_MAX_BYTES:-41943040}"

file_size_bytes() {
  # BSD stat (macOS) and GNU stat (Linux, Git Bash) disagree on flags; wc -c works on all three.
  wc -c < "$1" | tr -d ' '
}

# Copy one transcript into $session_dir, whole or in parts.
copy_transcript() {
  local source="$1" name
  name="$(basename "$source")"

  if [ "$(file_size_bytes "$source")" -le "$SAVE_SESSION_MAX_BYTES" ]; then
    cp "$source" "$session_dir/$name"
    return
  fi

  # The whole-file copy from before the transcript crossed the limit must not stay behind: the
  # pre-commit hook stages everything in the directory, and it is the file that would be refused.
  rm -f "$session_dir/$name"
  rm -f "$session_dir/${name%.jsonl}".part[0-9][0-9].jsonl

  # LC_ALL=C makes length() count bytes in every awk, which is what the limit is in. A single
  # line longer than the limit goes into a part of its own rather than being cut.
  LC_ALL=C awk -v max="$SAVE_SESSION_MAX_BYTES" -v base="$session_dir/${name%.jsonl}" '
    {
      n = length($0) + 1
      if (part == 0 || (size > 0 && size + n > max)) {
        if (part > 0) {
          close(file)
        }
        part++
        size = 0
        file = sprintf("%s.part%02d.jsonl", base, part)
      }
      print > file
      size += n
    }
  ' "$source"
}

copy_transcripts() {
  local encoded_path claude_dir transcript
  encoded_path="$(echo "$project_dir" | sed 's|[^a-zA-Z0-9]|-|g')"

  if [ "${#encoded_path}" -le 200 ]; then
    # Short path: exact match
    claude_dir="$HOME/.claude/projects/$encoded_path"
  else
    # Long path (>200 chars): Claude truncates to 200 chars and appends a hash.
    # Use the prefix to find the matching directory.
    local prefix="${encoded_path:0:200}"
    claude_dir="$(find "$HOME/.claude/projects" -maxdepth 1 -type d -name "${prefix}*" | head -1)"
  fi

  if [ -n "$claude_dir" ] && [ -d "$claude_dir" ]; then
    mkdir -p "$session_dir"
    for transcript in "$claude_dir"/*.jsonl; do
      if [ -f "$transcript" ]; then
        copy_transcript "$transcript"
      fi
    done
  fi
}

# Everything below runs only when the script is executed, so the tests can source the functions.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  # Always use git rev-parse for the project path, not CLAUDE_PROJECT_DIR.
  # On Windows, Claude Code POSIX-converts CLAUDE_PROJECT_DIR (C:\Users\foo -> /c/Users/foo)
  # but stores transcripts using the native path encoding. git rev-parse returns the native
  # path format on all platforms, so the encoding always matches.
  project_dir="$(git rev-parse --show-toplevel 2>/dev/null)"
  if [ -z "$project_dir" ]; then
    exit 0
  fi

  session_dir="$project_dir/.claude-sessions"

  # Claude Code exports CLAUDE_PROJECT_DIR to every hook it runs, and nothing else here sets it, so
  # its presence alone marks a SessionEnd run. (CLAUDE_SESSION_ID, used before, is never exported
  # to hooks, so SessionEnd fell through to the pre-commit branch and staged files mid-session.)
  # The value is not used: see the note on project_dir above.
  if [ -n "${CLAUDE_PROJECT_DIR:-}" ]; then
    # Running as a Claude SessionEnd hook
    cat > /dev/null  # consume stdin
    copy_transcripts
  else
    # Running as a git pre-commit hook
    if git check-ignore -q "$session_dir" 2>/dev/null; then
      echo "simple-claude-save: .claude-sessions/ is .gitignored — remove it from .gitignore to save transcripts" >&2
      exit 1
    fi
    copy_transcripts
    if [ -d "$session_dir" ]; then
      # -A also stages the removal of a whole-file copy that has since been replaced by parts
      git add -A -- "$session_dir" 2>/dev/null || true
    fi
  fi
fi
