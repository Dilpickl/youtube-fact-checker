// Runs in the extension's isolated world on youtube.com. Takes the captions
// page-hook.ts reads, asks the local server (through background.ts) for the
// claims worth checking, and shows them: a toggle in the player's controls
// with the count, and a list beside the video.
import type { Claim } from "../server/checker.ts";
import {
  CONTENT_SOURCE,
  PAGE_HOOK_SOURCE,
  type ContentMessage,
  type FindClaimsRequest,
  type FindClaimsResponse,
  type PageHookMessage,
} from "./messages.ts";
import { formatTime, parseTime, transcriptText, type Cue } from "./youtube.ts";

const TOGGLE_ID = "vfc-toggle";
const LIST_ID = "vfc-list";
const STYLE_ID = "vfc-style";

type TimedClaim = Claim & { seconds: number };

type Status =
  | { state: "finding" }
  | { state: "ready"; claims: TimedClaim[] }
  | { state: "noCaptions" }
  | { state: "error"; reason: string; retry: () => void };

let status: Status = { state: "finding" };
let statusVideoId: string | null = null;
let listOpen = false;

/** The video on the page, from its address; null off a watch page. */
function currentVideoId(): string | null {
  if (location.pathname !== "/watch") return null;
  return new URLSearchParams(location.search).get("v");
}

function setStatus(next: Status): void {
  status = next;
  statusVideoId = currentVideoId();
  render();
}

window.addEventListener("message", (event: MessageEvent<PageHookMessage>) => {
  const message = event.data;
  if (event.source !== window || message?.source !== PAGE_HOOK_SOURCE) return;
  // An answer about a video the viewer has already left.
  if (message.videoId !== currentVideoId()) return;
  switch (message.type) {
    case "reading":
      return setStatus({ state: "finding" });
    case "noCaptions":
      return setStatus({ state: "noCaptions" });
    case "captionError":
      return setStatus({
        state: "error",
        reason: `Couldn't read the captions: ${message.error}`,
        retry: readCaptionsAgain,
      });
    case "captions":
      return void findClaims(message.videoId, message.title, message.cues);
  }
});

function readCaptionsAgain(): void {
  setStatus({ state: "finding" });
  const message: ContentMessage = {
    source: CONTENT_SOURCE,
    type: "readCaptions",
  };
  window.postMessage(message, window.location.origin);
}

async function findClaims(videoId: string, title: string, cues: Cue[]) {
  if (cues.length === 0) return setStatus({ state: "noCaptions" });
  setStatus({ state: "finding" });
  const request: FindClaimsRequest = {
    type: "findClaims",
    videoId,
    title,
    transcript: transcriptText(cues),
  };
  let response: FindClaimsResponse | undefined;
  try {
    response = await chrome.runtime.sendMessage(request);
  } catch {
    // The extension was reloaded or updated after this page opened.
    response = { ok: false, error: "the extension changed; reload the page" };
  }
  if (videoId !== currentVideoId()) return;
  if (!response?.ok) {
    return setStatus({
      state: "error",
      reason: `Couldn't find claims: ${response?.error ?? "the extension didn't answer"}`,
      retry: () => void findClaims(videoId, title, cues),
    });
  }
  const claims = response.claims
    .flatMap((claim) => {
      const seconds = parseTime(claim.time);
      return seconds === null ? [] : [{ ...claim, seconds }];
    })
    .sort((a, b) => a.seconds - b.seconds);
  setStatus({ state: "ready", claims });
}

function render(): void {
  addStyle();
  renderToggle();
  renderList();
}

function toggleLabel(): string {
  switch (status.state) {
    case "finding":
      return "Finding claims…";
    case "noCaptions":
      return "No captions";
    case "error":
      return "Couldn't check: retry";
    case "ready": {
      const count = status.claims.length;
      if (count === 0) return "Nothing to check";
      return count === 1 ? "1 claim" : `${count} claims`;
    }
  }
}

function renderToggle(): void {
  const controls = document.querySelector(".ytp-right-controls");
  if (!controls) return;
  let toggle = document.getElementById(TOGGLE_ID) as HTMLButtonElement | null;
  if (!toggle) {
    toggle = element("button");
    toggle.id = TOGGLE_ID;
    toggle.type = "button";
    toggle.addEventListener("click", (event) => {
      event.stopPropagation(); // Not a click on the video.
      if (status.state === "error") return status.retry();
      listOpen = !listOpen;
      render();
    });
  }
  if (toggle.parentElement !== controls) controls.prepend(toggle);
  toggle.hidden = currentVideoId() === null;
  toggle.textContent = toggleLabel();
  toggle.dataset.state = status.state;
  toggle.title =
    status.state === "error"
      ? status.reason
      : "Claims in this video worth checking";
  toggle.setAttribute("aria-expanded", String(listOpen));
}

function renderList(): void {
  const existing = document.getElementById(LIST_ID);
  if (!listOpen || currentVideoId() === null) return existing?.remove();
  const list = existing ?? element("section");
  list.id = LIST_ID;
  list.setAttribute("aria-label", "Claims in this video");
  list.replaceChildren(listHeader(), ...listBody());
  // Beside the video in YouTube's two-column layout, under it in one column.
  const oneColumn = document
    .querySelector("ytd-watch-flexy")
    ?.hasAttribute("is-single-column");
  const container = document.querySelector(
    oneColumn ? "#below" : "#secondary-inner",
  );
  if (container && list.parentElement !== container) container.prepend(list);
}

function listHeader(): HTMLElement {
  const close = element("button", "×", "vfc-close");
  close.type = "button";
  close.title = "Close";
  close.setAttribute("aria-label", "Close");
  close.addEventListener("click", () => {
    listOpen = false;
    render();
  });
  const header = element("header");
  header.append(element("h2", "Claims in this video"), close);
  return header;
}

function listBody(): HTMLElement[] {
  switch (status.state) {
    case "finding":
      return [
        note(
          "Reading the captions and picking out the claims worth checking. This takes up to a minute.",
        ),
      ];
    case "noCaptions":
      return [
        note(
          "This video has no captions, so there's nothing to read claims from.",
        ),
      ];
    case "error": {
      const { retry } = status;
      const button = element("button", "Try again", "vfc-retry");
      button.type = "button";
      button.addEventListener("click", () => retry());
      return [note(status.reason), button];
    }
    case "ready": {
      if (status.claims.length === 0)
        return [
          note(
            "Nothing here a source could confirm or contradict: no facts, figures, or forecasts.",
          ),
        ];
      const items = element("ol");
      for (const claim of status.claims) {
        const row = element("button", undefined, "vfc-claim");
        row.type = "button";
        row.append(
          element("span", formatTime(claim.seconds), "vfc-time"),
          element("span", claim.claim),
        );
        row.addEventListener("click", () => jumpTo(claim.seconds));
        const item = element("li");
        item.append(row);
        items.append(item);
      }
      return [
        note(
          "Not checked yet: these are the claims worth checking. Click one to jump to it.",
        ),
        items,
      ];
    }
  }
}

function jumpTo(seconds: number): void {
  const video = document.querySelector<HTMLVideoElement>("#movie_player video");
  if (!video) return;
  video.currentTime = seconds;
  video.play().catch(() => {}); // Staying paused is fine.
}

function note(text: string): HTMLElement {
  return element("p", text, "vfc-note");
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function addStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = element("style", STYLE);
  style.id = STYLE_ID;
  document.head.append(style);
}

const STYLE = `
#vfc-toggle {
  flex: none;
  align-self: center;
  height: 28px;
  margin-right: 8px;
  padding: 0 12px;
  border: 0;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
  font: 500 13px/28px Roboto, Arial, sans-serif;
  white-space: nowrap;
  cursor: pointer;
}
#vfc-toggle:hover, #vfc-toggle[aria-expanded="true"] { background: rgba(255, 255, 255, 0.3); }
#vfc-toggle[data-state="error"] { background: rgba(255, 78, 69, 0.45); }
#vfc-toggle:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
#vfc-list {
  --vfc-text: #0f0f0f;
  --vfc-muted: #606060;
  --vfc-surface: rgba(0, 0, 0, 0.05);
  --vfc-hover: rgba(0, 0, 0, 0.1);
  --vfc-accent: #065fd4;
  margin: 0 0 16px;
  padding: 8px 8px 4px;
  border-radius: 12px;
  background: var(--vfc-surface);
  color: var(--vfc-text);
  font: 400 14px/20px Roboto, Arial, sans-serif;
}
html[dark] #vfc-list {
  --vfc-text: #f1f1f1;
  --vfc-muted: #aaa;
  --vfc-surface: rgba(255, 255, 255, 0.1);
  --vfc-hover: rgba(255, 255, 255, 0.2);
  --vfc-accent: #3ea6ff;
}
#vfc-list header { display: flex; align-items: center; justify-content: space-between; padding-left: 8px; }
#vfc-list h2 { margin: 0; font: 700 16px/22px Roboto, Arial, sans-serif; }
#vfc-list .vfc-note { margin: 2px 8px 8px; color: var(--vfc-muted); font-size: 13px; line-height: 18px; }
#vfc-list ol { margin: 0; padding: 0; list-style: none; }
#vfc-list button { color: inherit; font: inherit; cursor: pointer; }
#vfc-list button:focus-visible { outline: 2px solid var(--vfc-accent); outline-offset: 1px; }
#vfc-list .vfc-close { width: 36px; height: 36px; border: 0; border-radius: 50%; background: none; font-size: 22px; line-height: 1; }
#vfc-list .vfc-claim { display: flex; gap: 12px; width: 100%; padding: 8px; border: 0; border-radius: 8px; background: none; text-align: left; }
#vfc-list .vfc-close:hover, #vfc-list .vfc-claim:hover { background: var(--vfc-hover); }
#vfc-list .vfc-time { flex: none; min-width: 40px; color: var(--vfc-accent); font-weight: 500; font-variant-numeric: tabular-nums; }
#vfc-list .vfc-retry { height: 36px; margin: 0 8px 8px; padding: 0 16px; border: 0; border-radius: 18px; background: var(--vfc-hover); font-weight: 500; }
`;

// YouTube changes videos without loading a new page.
document.addEventListener("yt-navigate-finish", () => {
  if (statusVideoId !== currentVideoId()) setStatus({ state: "finding" });
  else render();
});
// YouTube switches between one and two columns as the window resizes; let it
// finish before moving the list.
window.addEventListener("resize", () => setTimeout(render, 300));
