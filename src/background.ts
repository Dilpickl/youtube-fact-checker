// The background service worker fetches caption files for content.ts when the
// caption server refuses requests made from the TikTok page.
import type { FetchCaptionRequest, FetchCaptionResponse } from "./messages.ts";
import { isTikTokCaptionUrl } from "./tiktok.ts";

chrome.runtime.onMessage.addListener(
  (
    message: Partial<FetchCaptionRequest>,
    _sender,
    sendResponse: (response: FetchCaptionResponse) => void,
  ) => {
    if (message.type !== "fetchCaption") return false;
    // The address came from the web page, so only fetch from TikTok's own servers.
    if (typeof message.url !== "string" || !isTikTokCaptionUrl(message.url)) {
      sendResponse({ ok: false, error: "not a TikTok caption address" });
      return false;
    }
    void fetchText(message.url).then(sendResponse);
    return true; // Keeps the channel open until sendResponse is called.
  },
);

async function fetchText(url: string): Promise<FetchCaptionResponse> {
  try {
    const response = await fetch(url, { credentials: "omit" });
    return response.ok
      ? { ok: true, text: await response.text() }
      : { ok: false, error: `the caption server answered ${response.status}` };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, error: reason };
  }
}
