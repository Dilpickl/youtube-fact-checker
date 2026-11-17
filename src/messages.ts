// Messages passed between the extension's scripts.
import type { Claim, Verdict } from "../server/checker.ts";
import type { Cue } from "./youtube.ts";

/** Tags messages from page-hook.ts so content.ts ignores anything else posted on the page. */
export const PAGE_HOOK_SOURCE = "video-fact-check:page-hook";
/** Tags content.ts's requests to page-hook.ts. */
export const CONTENT_SOURCE = "video-fact-check:content";

/** The saved on/off setting, flipped by the switch in the popup. */
export const ENABLED_KEY = "enabled";

/** Whether the extension is on; it is until Dylan first turns it off. */
export async function readEnabled(): Promise<boolean> {
  const stored = await chrome.storage.local.get(ENABLED_KEY);
  return stored[ENABLED_KEY] !== false;
}

/** The saved channels to fact-check without being asked: channel id → name. */
export const CHANNELS_KEY = "channels";
export type Channels = Record<string, string>;

export async function readChannels(): Promise<Channels> {
  const stored = await chrome.storage.local.get(CHANNELS_KEY);
  return (stored[CHANNELS_KEY] as Channels | undefined) ?? {};
}

/** The saved setting to fact-check every Short without being asked; off at first. */
export const ALL_SHORTS_KEY = "allShorts";

export async function readAllShorts(): Promise<boolean> {
  const stored = await chrome.storage.local.get(ALL_SHORTS_KEY);
  return stored[ALL_SHORTS_KEY] === true;
}

/** What page-hook.ts finds out about a video and its captions. */
export type PageHookMessage = {
  source: typeof PAGE_HOOK_SOURCE;
  videoId: string;
} & (
  | { type: "video"; channelId: string; channel: string }
  | { type: "reading" }
  | { type: "captions"; title: string; cues: Cue[] }
  | { type: "noCaptions" }
  | { type: "captionError"; error: string }
);

export interface ContentMessage {
  source: typeof CONTENT_SOURCE;
  /**
   * Say whose video this is, read its captions, or stop: the extension was
   * turned off.
   */
  type: "describeVideo" | "readCaptions" | "stopReading";
}

/** What content.ts asks the server, through background.ts. */
export type ServerRequest =
  | { type: "findClaims"; videoId: string; title: string; transcript: string }
  | { type: "checkClaim"; videoId: string; title: string; claim: Claim }
  | { type: "pickClaim"; videoId: string; title: string; excerpt: string }
  | { type: "budget" };

type Answer<T> = ({ ok: true } & T) | { ok: false; error: string };
export type FindClaimsResponse = Answer<{ claims: Claim[] }>;
export type CheckClaimResponse = Answer<{ verdict: Verdict }>;
export type PickClaimResponse = Answer<{ claim: Claim | null }>;
export type BudgetResponse = Answer<{ cap: number; left: number }>;

/** What popup.ts asks the content script on the tab in front. */
export type PopupRequest = { type: "popupState" } | { type: "popupStart" };

/** The video on that tab, as the popup shows it; null off a watch page. */
export type PopupState = {
  /** The same words as the button in the player. */
  label: string;
  /** Whether "Fact-check this video" would do anything now. */
  canStart: boolean;
  channel: { id: string; name: string } | null;
} | null;
