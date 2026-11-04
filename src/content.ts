// Runs in the extension's isolated world on youtube.com. Takes the captions
// page-hook.ts reads, asks the local server (through background.ts) for the
// claims worth checking, and checks each one a few minutes before it's said.
// Shows the results in three places: a toggle in the player's controls with
// the count, a chip on the video as each claim is said, and a list beside the
// video with every verdict and its sources.
import type { Claim, Verdict } from "../server/checker.ts";
import {
  CONTENT_SOURCE,
  PAGE_HOOK_SOURCE,
  type CheckClaimResponse,
  type ContentMessage,
  type FindClaimsResponse,
  type PageHookMessage,
  type ServerRequest,
} from "./messages.ts";
import {
  formatTime,
  parseTime,
  quoteStart,
  transcriptText,
  type Cue,
} from "./youtube.ts";

const TOGGLE_ID = "vfc-toggle";
const LIST_ID = "vfc-list";
const OPEN_ITEM_ID = "vfc-open";
const CHIPS_ID = "vfc-chips";
const STYLE_ID = "vfc-style";
// Checks run this far ahead of the playhead, so verdicts are ready when a
// claim is said and nothing past where the viewer stops gets paid for.
const LOOKAHEAD_SECONDS = 180;
const PARALLEL_CHECKS = 2;
// A late verdict still gets its chip this long after the claim is said.
const CHIP_WINDOW_SECONDS = 20;
const RED_CHIP_MS = 8000;
const QUIET_CHIP_MS = 4000;

type Check =
  | { state: "waiting" }
  | { state: "checking" }
  | { state: "done"; verdict: Verdict }
  | { state: "failed"; error: string };

interface LiveClaim extends Claim {
  /** When it's said, in seconds. */
  seconds: number;
  check: Check;
  /** Its chip so far: none yet, one while checking, or one with the verdict. */
  chip: "none" | "pending" | "final";
}

type Status =
  | { state: "finding" }
  | { state: "ready"; videoId: string; title: string; claims: LiveClaim[] }
  | { state: "noCaptions" }
  | { state: "error"; reason: string; retry: () => void };

type Tone = "red" | "green" | "grey";

let status: Status = { state: "finding" };
let statusVideoId: string | null = null;
let listOpen = false;
/** The claim whose explanation and sources are open in the list. */
let openClaim: LiveClaim | null = null;
const chipTimers = new WeakMap<HTMLElement, number>();
const chipsByClaim = new WeakMap<LiveClaim, HTMLButtonElement>();

/** The video on the page, from its address; null off a watch page. */
function currentVideoId(): string | null {
  if (location.pathname !== "/watch") return null;
  return new URLSearchParams(location.search).get("v");
}

function playerVideo(): HTMLVideoElement | null {
  return document.querySelector("#movie_player video");
}

/** During an ad, the player's video and its time belong to the ad. */
function adShowing(): boolean {
  return Boolean(
    document.getElementById("movie_player")?.classList.contains("ad-showing"),
  );
}

function setStatus(next: Status): void {
  status = next;
  statusVideoId = currentVideoId();
  if (next.state !== "ready") document.getElementById(CHIPS_ID)?.remove();
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

async function askServer<T>(
  request: ServerRequest,
): Promise<T | { ok: false; error: string }> {
  try {
    const response: T | undefined = await chrome.runtime.sendMessage(request);
    return response ?? { ok: false, error: "the extension didn't answer" };
  } catch {
    // The extension was reloaded or updated after this page opened.
    return { ok: false, error: "the extension changed; reload the page" };
  }
}

async function findClaims(videoId: string, title: string, cues: Cue[]) {
  if (cues.length === 0) return setStatus({ state: "noCaptions" });
  setStatus({ state: "finding" });
  const response = await askServer<FindClaimsResponse>({
    type: "findClaims",
    videoId,
    title,
    transcript: transcriptText(cues),
  });
  if (videoId !== currentVideoId()) return;
  if (!response.ok) {
    return setStatus({
      state: "error",
      reason: `Couldn't find claims: ${response.error}`,
      retry: () => void findClaims(videoId, title, cues),
    });
  }
  const claims = response.claims
    .flatMap((claim): LiveClaim[] => {
      const lineStart = parseTime(claim.time);
      if (lineStart === null) return [];
      const seconds = quoteStart(cues, claim.quote, lineStart);
      return [{ ...claim, seconds, check: { state: "waiting" }, chip: "none" }];
    })
    .sort((a, b) => a.seconds - b.seconds);
  openClaim = null;
  setStatus({ state: "ready", videoId, title, claims });
  checkAhead();
}

/** Starts checks for the next claims within LOOKAHEAD_SECONDS of the playhead. */
function checkAhead(): void {
  const video = playerVideo();
  if (status.state !== "ready" || !video || adShowing()) return;
  const now = video.currentTime;
  const { claims } = status;
  const running = claims.filter((claim) => claim.check.state === "checking");
  claims
    .filter(
      (claim) =>
        claim.check.state === "waiting" &&
        claim.seconds > now - CHIP_WINDOW_SECONDS &&
        claim.seconds < now + LOOKAHEAD_SECONDS,
    )
    .slice(0, Math.max(0, PARALLEL_CHECKS - running.length))
    .forEach((claim) => void checkClaim(claim));
}

async function checkClaim(claim: LiveClaim): Promise<void> {
  if (status.state !== "ready") return;
  const { videoId, title } = status;
  claim.check = { state: "checking" };
  renderList();
  const { time, quote, claim: text } = claim;
  const response = await askServer<CheckClaimResponse>({
    type: "checkClaim",
    videoId,
    title,
    claim: { time, quote, claim: text },
  });
  claim.check = response.ok
    ? { state: "done", verdict: response.verdict }
    : { state: "failed", error: response.error };
  if (videoId !== currentVideoId()) return;
  renderList();
  showDueChips();
  checkAhead();
}

function verdictLook(claim: LiveClaim): { label: string; tone: Tone } {
  switch (claim.check.state) {
    case "waiting":
      return { label: "Not checked yet", tone: "grey" };
    case "checking":
      return { label: "Checking…", tone: "grey" };
    case "failed":
      return { label: "Couldn't check", tone: "grey" };
    case "done": {
      const { verdict } = claim.check.verdict;
      if (verdict === "supported") return { label: "Supported", tone: "green" };
      if (verdict === "unverified")
        return { label: "Unverified", tone: "grey" };
      const label = verdict === "contradicted" ? "Contradicted" : "Misleading";
      return { label, tone: "red" };
    }
  }
}

/** Shows a chip for each claim being said now, with its verdict once there is one. */
function showDueChips(): void {
  const video = playerVideo();
  if (status.state !== "ready" || !video || adShowing()) return;
  const now = video.currentTime;
  for (const claim of status.claims) {
    const due =
      claim.seconds <= now && now < claim.seconds + CHIP_WINDOW_SECONDS;
    if (!due || claim.chip === "final") continue;
    const settled =
      claim.check.state === "done" || claim.check.state === "failed";
    if (settled || claim.chip === "none") showChip(claim);
    claim.chip = settled ? "final" : "pending";
  }
}

function showChip(claim: LiveClaim): void {
  const player = document.getElementById("movie_player");
  if (!player) return;
  let chips = document.getElementById(CHIPS_ID);
  if (!chips) {
    chips = element("div");
    chips.id = CHIPS_ID;
  }
  if (chips.parentElement !== player) player.append(chips);

  const look =
    claim.check.state === "waiting"
      ? { label: "Checking…", tone: "grey" as const }
      : verdictLook(claim);
  const chip =
    chipsByClaim.get(claim) ?? element("button", undefined, "vfc-chip");
  chipsByClaim.set(claim, chip);
  chip.type = "button";
  chip.dataset.tone = look.tone;
  chip.title = `${look.label}: ${claim.claim}`;
  chip.classList.remove("vfc-leaving");
  chip.replaceChildren(
    element("strong", look.tone === "green" ? "✓ Supported" : look.label),
  );
  // Only red flags spell out the claim; the others stay small and quiet.
  if (look.tone === "red") chip.append(element("span", claim.claim));
  chip.onclick = (event) => {
    event.stopPropagation(); // Not a click on the video.
    void openFromChip(claim);
  };
  if (!chip.isConnected) chips.append(chip);

  clearTimeout(chipTimers.get(chip));
  const shown = look.tone === "red" ? RED_CHIP_MS : QUIET_CHIP_MS;
  chipTimers.set(
    chip,
    window.setTimeout(() => {
      chip.classList.add("vfc-leaving");
      chipTimers.set(
        chip,
        window.setTimeout(() => chip.remove(), 400),
      );
    }, shown),
  );
}

async function openFromChip(claim: LiveClaim): Promise<void> {
  playerVideo()?.pause();
  // The list is beside the video, which fullscreen hides.
  if (document.fullscreenElement) await document.exitFullscreen();
  listOpen = true;
  openClaim = claim;
  render();
  document
    .getElementById(OPEN_ITEM_ID)
    ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
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
      const button = element("button", "Try again", "vfc-action");
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
      items.append(...status.claims.map(listItem));
      return [
        note(
          "Each claim is checked against web sources a few minutes before it's said. Click one for its sources.",
        ),
        items,
      ];
    }
  }
}

function listItem(claim: LiveClaim): HTMLElement {
  const { label, tone } = verdictLook(claim);
  const item = element("li", undefined, "vfc-item");
  item.dataset.tone = tone;
  const time = element("button", formatTime(claim.seconds), "vfc-time");
  time.type = "button";
  time.title = "Jump to this claim";
  time.addEventListener("click", () => jumpTo(claim.seconds));
  const summary = element("button", undefined, "vfc-claim");
  summary.type = "button";
  summary.setAttribute("aria-expanded", String(openClaim === claim));
  summary.append(
    element("span", label, "vfc-badge"),
    element("span", claim.claim),
  );
  summary.addEventListener("click", () => {
    openClaim = openClaim === claim ? null : claim;
    renderList();
  });
  item.append(time, summary);
  if (openClaim === claim) {
    item.id = OPEN_ITEM_ID;
    item.append(details(claim));
  }
  return item;
}

function details(claim: LiveClaim): HTMLElement {
  const box = element("div", undefined, "vfc-details");
  switch (claim.check.state) {
    case "waiting":
      box.append(
        note(
          "Not checked yet: claims are checked a few minutes before they're said.",
        ),
        checkButton(claim, "Check now"),
      );
      break;
    case "checking":
      box.append(note("Checking against web sources…"));
      break;
    case "failed":
      box.append(
        note(`Couldn't check: ${claim.check.error}`),
        checkButton(claim, "Try again"),
      );
      break;
    case "done": {
      const { explanation, sources } = claim.check.verdict;
      box.append(element("p", explanation, "vfc-explanation"));
      if (sources.length === 0) break;
      const list = element("ul", undefined, "vfc-sources");
      for (const source of sources) {
        const item = element("li");
        item.append(sourceLink(source.url, source.title), ` — ${source.says}`);
        list.append(item);
      }
      box.append(list);
    }
  }
  return box;
}

/** A link to a source, or just its title when the address isn't a web page. */
function sourceLink(address: string, title: string): HTMLElement {
  let url: URL | null = null;
  try {
    url = new URL(address);
  } catch {
    // Not an address; show the title alone.
  }
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:"))
    return element("span", title);
  const link = element("a", title);
  link.href = url.href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

function checkButton(claim: LiveClaim, label: string): HTMLElement {
  const button = element("button", label, "vfc-action");
  button.type = "button";
  button.addEventListener("click", () => void checkClaim(claim));
  return button;
}

function jumpTo(seconds: number): void {
  const video = playerVideo();
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

#vfc-chips {
  position: absolute;
  right: 12px;
  bottom: 72px;
  z-index: 61;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  max-width: min(360px, 70%);
  pointer-events: none;
}
.vfc-chip {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 4px 10px;
  border: 0;
  border-radius: 14px;
  background: rgba(15, 15, 15, 0.75);
  color: #e8e8e8;
  font: 400 12px/18px Roboto, Arial, sans-serif;
  text-align: left;
  pointer-events: auto;
  cursor: pointer;
  animation: vfc-in 0.2s ease-out;
  transition: opacity 0.4s;
}
.vfc-chip strong { font-weight: 500; }
.vfc-chip[data-tone="green"] strong { color: #5fdc8a; }
.vfc-chip[data-tone="red"] {
  padding: 8px 14px;
  border-radius: 10px;
  background: #c62828;
  color: #fff;
  font-size: 14px;
  line-height: 19px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.45);
}
.vfc-chip[data-tone="red"] strong { font-weight: 700; }
.vfc-chip span { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.vfc-chip.vfc-leaving { opacity: 0; }
.vfc-chip:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
@keyframes vfc-in { from { opacity: 0; transform: translateY(6px); } }
@media (prefers-reduced-motion: reduce) { .vfc-chip { animation: none; transition: none; } }

#vfc-list {
  --vfc-text: #0f0f0f;
  --vfc-muted: #606060;
  --vfc-surface: rgba(0, 0, 0, 0.05);
  --vfc-hover: rgba(0, 0, 0, 0.1);
  --vfc-accent: #065fd4;
  --vfc-red: #c62828;
  --vfc-green: #1e7d3a;
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
  --vfc-red: #ff7b72;
  --vfc-green: #5fdc8a;
}
#vfc-list header { display: flex; align-items: center; justify-content: space-between; padding-left: 8px; }
#vfc-list h2 { margin: 0; font: 700 16px/22px Roboto, Arial, sans-serif; }
#vfc-list .vfc-note { margin: 2px 8px 8px; color: var(--vfc-muted); font-size: 13px; line-height: 18px; }
#vfc-list ol { margin: 0; padding: 0; list-style: none; }
#vfc-list button { color: inherit; font: inherit; cursor: pointer; }
#vfc-list button:focus-visible { outline: 2px solid var(--vfc-accent); outline-offset: 1px; }
#vfc-list .vfc-close { width: 36px; height: 36px; border: 0; border-radius: 50%; background: none; font-size: 22px; line-height: 1; }
#vfc-list .vfc-item { display: grid; grid-template-columns: auto 1fr; align-items: start; }
#vfc-list .vfc-time { min-width: 52px; padding: 8px; border: 0; border-radius: 8px; background: none; color: var(--vfc-accent); font-weight: 500; font-variant-numeric: tabular-nums; text-align: left; }
#vfc-list .vfc-claim { display: flex; flex-direction: column; gap: 2px; padding: 8px; border: 0; border-radius: 8px; background: none; text-align: left; }
#vfc-list .vfc-item[data-tone="red"] .vfc-claim { box-shadow: inset 3px 0 var(--vfc-red); }
#vfc-list .vfc-time:hover, #vfc-list .vfc-claim:hover, #vfc-list .vfc-close:hover { background: var(--vfc-hover); }
#vfc-list .vfc-badge { color: var(--vfc-muted); font-size: 12px; line-height: 16px; font-weight: 500; }
#vfc-list [data-tone="red"] .vfc-badge { color: var(--vfc-red); }
#vfc-list [data-tone="green"] .vfc-badge { color: var(--vfc-green); }
#vfc-list .vfc-details { grid-column: 2; padding: 0 8px 8px; }
#vfc-list .vfc-details .vfc-note { margin: 0 0 8px; }
#vfc-list .vfc-explanation { margin: 0 0 8px; }
#vfc-list .vfc-sources { margin: 0; padding-left: 18px; color: var(--vfc-muted); font-size: 13px; line-height: 18px; }
#vfc-list .vfc-sources li { margin-bottom: 4px; }
#vfc-list .vfc-sources a { color: var(--vfc-accent); }
#vfc-list .vfc-action { height: 36px; margin: 0 8px 8px; padding: 0 16px; border: 0; border-radius: 18px; background: var(--vfc-hover); font-weight: 500; }
#vfc-list .vfc-details .vfc-action { margin: 0; }
`;

// Media events don't bubble, so listen in the capture phase, and only to the
// player's own video (thumbnails play previews too).
document.addEventListener(
  "timeupdate",
  (event) => {
    if (event.target !== playerVideo()) return;
    checkAhead();
    showDueChips();
  },
  true,
);
document.addEventListener(
  "seeked",
  (event) => {
    if (event.target !== playerVideo() || status.state !== "ready") return;
    // Going back shows the chips again for the claims ahead.
    const now = (event.target as HTMLVideoElement).currentTime;
    for (const claim of status.claims)
      if (claim.seconds > now) claim.chip = "none";
    checkAhead();
  },
  true,
);
// YouTube changes videos without loading a new page.
document.addEventListener("yt-navigate-finish", () => {
  if (statusVideoId !== currentVideoId()) setStatus({ state: "finding" });
  else render();
});
// YouTube switches between one and two columns as the window resizes; let it
// finish before moving the list.
window.addEventListener("resize", () => setTimeout(render, 300));
