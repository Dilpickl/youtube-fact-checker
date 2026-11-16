// Messages passed between the extension's scripts.
import type { Claim, Verdict } from "../server/checker.ts";
import type { Cue } from "./youtube.ts";

/** Tags messages from page-hook.ts so content.ts ignores anything else posted on the page. */
export const PAGE_HOOK_SOURCE = "video-fact-check:page-hook";
/** Tags content.ts's requests to page-hook.ts. */
export const CONTENT_SOURCE = "video-fact-check:content";

/** The saved on/off setting, flipped by clicking the extension's icon. */
export const ENABLED_KEY = "enabled";

/** Whether the extension is on; it is until Dylan first turns it off. */
export async function readEnabled(): Promise<boolean> {
  const stored = await chrome.storage.local.get(ENABLED_KEY);
  return stored[ENABLED_KEY] !== false;
}

/** What page-hook.ts finds out about a video's captions. */
export type PageHookMessage = {
  source: typeof PAGE_HOOK_SOURCE;
  videoId: string;
} & (
  | { type: "reading" }
  | { type: "captions"; title: string; cues: Cue[] }
  | { type: "noCaptions" }
  | { type: "captionError"; error: string }
);

export interface ContentMessage {
  source: typeof CONTENT_SOURCE;
  /** Read this video's captions, or stop: the extension was turned off. */
  type: "readCaptions" | "stopReading";
}

/** What content.ts asks the server, through background.ts. */
export type ServerRequest =
  | { type: "findClaims"; videoId: string; title: string; transcript: string }
  | { type: "checkClaim"; videoId: string; title: string; claim: Claim }
  | { type: "pickClaim"; videoId: string; title: string; excerpt: string };

type Answer<T> = ({ ok: true } & T) | { ok: false; error: string };
export type FindClaimsResponse = Answer<{ claims: Claim[] }>;
export type CheckClaimResponse = Answer<{ verdict: Verdict }>;
export type PickClaimResponse = Answer<{ claim: Claim | null }>;
