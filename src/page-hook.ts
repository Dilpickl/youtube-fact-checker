// Runs inside the YouTube page itself (not the extension's isolated world) so it
// can use YouTube's player. YouTube serves captions only to requests carrying a
// token its player adds, so this notes the player's own caption request and
// reads the same address. When captions are off, it turns them on for a
// moment, hidden, so the player asks, then turns them off again. The player
// ignores that until the video itself plays, so it waits out any ad first.
import {
  CONTENT_SOURCE,
  PAGE_HOOK_SOURCE,
  type PageHookMessage,
} from "./messages.ts";
import { parseJson3, pickCaptionTrack, type CaptionTrack } from "./youtube.ts";

const PLAYER_WAIT_MS = 30_000;
// Long enough for ads, or for a viewer who opens a video and presses play later.
const CAPTIONS_WAIT_MS = 10 * 60_000;
const ASK_EVERY_MS = 5_000;
const ASK_FOR_MS = 3_000;
const POLL_MS = 250;

interface PlayerResponse {
  videoDetails?: { videoId?: string; title?: string; author?: string };
  captions?: {
    playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] };
  };
}

/** The parts of YouTube's player element (#movie_player) used here. */
interface Player extends HTMLElement {
  getPlayerResponse(): PlayerResponse | undefined;
  /** -1 until the video starts; YouTube reports the ad's state during an ad. */
  getPlayerState(): number;
  loadModule(module: "captions"): void;
  getOption(
    module: "captions",
    option: "track",
  ): Partial<CaptionTrack> | undefined;
  setOption(
    module: "captions",
    option: "track",
    track: Partial<CaptionTrack>,
  ): void;
}

/** Video id → the address of the player's latest caption request for it. */
const captionAddresses = new Map<string, string>();
new PerformanceObserver((list) => {
  for (const { name } of list.getEntries()) {
    if (!name.includes("/api/timedtext") || !name.includes("pot=")) continue;
    const videoId = new URL(name).searchParams.get("v");
    if (videoId) captionAddresses.set(videoId, name);
  }
}).observe({ type: "resource" });

let readingVideoId: string | null = null;

/** The video on the page, from its address; null off a watch page. */
function currentVideoId(): string | null {
  if (location.pathname !== "/watch") return null;
  return new URLSearchParams(location.search).get("v");
}

async function readCaptions(): Promise<void> {
  const videoId = currentVideoId();
  if (!videoId || videoId === readingVideoId) return;
  readingVideoId = videoId;
  post({ type: "reading", videoId });
  try {
    // Right after YouTube changes video, the player may still describe the old one.
    const player = await waitFor(() => {
      const element = document.getElementById("movie_player") as Player | null;
      const playing = element?.getPlayerResponse?.()?.videoDetails?.videoId;
      return playing === videoId ? element : null;
    }, "YouTube's player didn't load");
    const response = player.getPlayerResponse() ?? {};
    const track = pickCaptionTrack(
      response.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [],
    );
    if (!track) return post({ type: "noCaptions", videoId });

    const address = new URL(await captionAddress(player, track, videoId));
    address.searchParams.set("fmt", "json3");
    const captions = await (await fetch(address)).json();
    const { title = "", author = "" } = response.videoDetails ?? {};
    post({
      type: "captions",
      videoId,
      title: author ? `${title} (${author})` : title,
      cues: parseJson3(captions),
    });
  } catch (error) {
    if (readingVideoId === videoId) readingVideoId = null; // so a retry reads again
    const reason = error instanceof Error ? error.message : String(error);
    post({ type: "captionError", videoId, error: reason });
  }
}

/**
 * The address of the player's caption request for this video: the viewer's
 * own, if they turn captions on, or one this asks for once the video plays.
 */
async function captionAddress(
  player: Player,
  track: CaptionTrack,
  videoId: string,
): Promise<string> {
  const started = Date.now();
  let askedAt = -Infinity;
  for (;;) {
    const address = captionAddresses.get(videoId);
    if (address) return address;
    if (currentVideoId() !== videoId) throw new Error("the viewer moved on");
    if (Date.now() - started > CAPTIONS_WAIT_MS)
      throw new Error("the player didn't load captions");
    const captionsOn = Boolean(
      player.getOption("captions", "track")?.languageCode,
    );
    const videoPlaying =
      player.getPlayerState() !== -1 &&
      !player.classList.contains("ad-showing");
    if (!captionsOn && videoPlaying && Date.now() - askedAt > ASK_EVERY_MS) {
      askedAt = Date.now();
      await askPlayerForCaptions(player, track, videoId);
    } else {
      await sleep(POLL_MS);
    }
  }
}

/** Turns captions on, hidden, for up to ASK_FOR_MS so the player requests them. */
async function askPlayerForCaptions(
  player: Player,
  track: CaptionTrack,
  videoId: string,
): Promise<void> {
  const hide = document.createElement("style");
  hide.textContent =
    ".ytp-caption-window-container { display: none !important; }";
  document.head.append(hide);
  try {
    player.loadModule("captions");
    player.setOption("captions", "track", {
      languageCode: track.languageCode,
      kind: track.kind,
    });
    const started = Date.now();
    while (!captionAddresses.has(videoId) && Date.now() - started < ASK_FOR_MS)
      await sleep(POLL_MS);
  } finally {
    player.setOption("captions", "track", {});
    hide.remove();
  }
}

/** Resolves with `check`'s first truthy answer, polling for up to PLAYER_WAIT_MS. */
function waitFor<T>(
  check: () => T | null | undefined,
  failure: string,
): Promise<T> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      const value = check();
      if (value) resolve(value);
      else if (Date.now() - started > PLAYER_WAIT_MS)
        reject(new Error(failure));
      else setTimeout(poll, POLL_MS);
    };
    poll();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type Unsourced<T> = T extends unknown ? Omit<T, "source"> : never;

function post(message: Unsourced<PageHookMessage>): void {
  window.postMessage(
    { source: PAGE_HOOK_SOURCE, ...message },
    window.location.origin,
  );
}

window.addEventListener("message", (event) => {
  if (
    event.source === window &&
    event.data?.source === CONTENT_SOURCE &&
    event.data.type === "readCaptions"
  ) {
    void readCaptions();
  }
});
// YouTube changes videos without loading a new page, and says so with this event.
document.addEventListener("yt-navigate-finish", () => void readCaptions());
void readCaptions();
