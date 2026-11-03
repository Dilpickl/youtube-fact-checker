// Messages passed between the extension's scripts.
import type { Claim } from "../server/checker.ts";
import type { Cue } from "./youtube.ts";

/** Tags messages from page-hook.ts so content.ts ignores anything else posted on the page. */
export const PAGE_HOOK_SOURCE = "video-fact-check:page-hook";
/** Tags content.ts's requests to page-hook.ts. */
export const CONTENT_SOURCE = "video-fact-check:content";

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
  type: "readCaptions";
}

export interface FindClaimsRequest {
  type: "findClaims";
  videoId: string;
  title: string;
  transcript: string;
}

export type FindClaimsResponse =
  { ok: true; claims: Claim[] } | { ok: false; error: string };
