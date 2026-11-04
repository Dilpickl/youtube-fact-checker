// Reads YouTube's caption data: picks a caption track, parses the format the
// player downloads (json3), and lays the captions out as a timestamped
// transcript for claim finding.

export interface CaptionTrack {
  languageCode: string;
  /** "asr" for automatic captions; missing for captions someone wrote. */
  kind?: string;
}

export interface Cue {
  /** Seconds from the start of the video. */
  start: number;
  text: string;
}

/** English captions someone wrote, then automatic English ones, then any. */
export function pickCaptionTrack<T extends CaptionTrack>(
  tracks: T[],
): T | undefined {
  const english = tracks.filter((track) => /^en\b/.test(track.languageCode));
  return (
    english.find((track) => track.kind !== "asr") ?? english[0] ?? tracks[0]
  );
}

interface Json3 {
  events?: { tStartMs?: number; segs?: { utf8?: string }[] }[];
}

/** Caption lines from json3, skipping the events that only break lines. */
export function parseJson3(json: Json3): Cue[] {
  const cues: Cue[] = [];
  for (const event of json.events ?? []) {
    const text = (event.segs ?? [])
      .map((seg) => seg.utf8 ?? "")
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (text) cues.push({ start: (event.tStartMs ?? 0) / 1000, text });
  }
  return cues;
}

/**
 * Joins captions into lines of about `lineSeconds`, each starting "[m:ss]",
 * the layout claim finding was tested on. A claim's time is its line's start,
 * so shorter lines put it closer to when it's said.
 */
export function transcriptText(cues: Cue[], lineSeconds = 10): string {
  const lines: Cue[] = [];
  for (const cue of cues) {
    const line = lines.at(-1);
    if (line && cue.start - line.start < lineSeconds)
      line.text += ` ${cue.text}`;
    else lines.push({ ...cue });
  }
  return lines
    .map((line) => `[${formatTime(line.start)}] ${line.text}`)
    .join("\n");
}

/**
 * When a claim's quote starts: the caption holding its first words, searched
 * from the claim's line on. Falls back to the line's start when the quote
 * isn't word for word in the captions.
 */
export function quoteStart(cues: Cue[], quote: string, lineStart: number) {
  const words = (text: string) =>
    text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
  const opening = words(quote).slice(0, 3);
  const nearby = cues
    .filter((cue) => cue.start >= lineStart - 1 && cue.start < lineStart + 30)
    .flatMap((cue) =>
      words(cue.text).map((word) => ({ word, start: cue.start })),
    );
  if (opening.length === 0) return lineStart;
  for (let i = 0; i + opening.length <= nearby.length; i++) {
    if (opening.every((word, k) => nearby[i + k].word === word))
      return nearby[i].start;
  }
  return lineStart;
}

/** "4:03", or "1:02:03" past an hour. */
export function formatTime(seconds: number): string {
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}`
    : `${minutes}:${rest}`;
}

/** Seconds from "4:03", "1:02:03" or "[4:03]", or null if it isn't a time. */
export function parseTime(time: string): number | null {
  const match = /^\[?(?:(\d+):)?(\d{1,2}):(\d{2})\]?$/.exec(time.trim());
  if (!match) return null;
  const [, hours = "0", minutes, seconds] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}
