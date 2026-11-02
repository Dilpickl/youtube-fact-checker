// Messages passed between the extension's scripts.
import type { TikTokVideo } from "./tiktok.ts";

/** Tags messages from page-hook.ts so content.ts ignores anything else posted on the page. */
export const PAGE_HOOK_SOURCE = "video-fact-check:page-hook";

export interface PageHookMessage {
  source: typeof PAGE_HOOK_SOURCE;
  videos: TikTokVideo[];
}

export interface FetchCaptionRequest {
  type: "fetchCaption";
  url: string;
}

export type FetchCaptionResponse =
  { ok: true; text: string } | { ok: false; error: string };
