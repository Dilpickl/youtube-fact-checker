// Runs inside the TikTok page itself (not the extension's isolated world) so it
// can see the video data TikTok's own code downloads. It never changes what
// TikTok receives: it reads a copy of each response and hands it to content.ts.
import { PAGE_HOOK_SOURCE, type PageHookMessage } from "./messages.ts";
import { extractVideos, isTikTokApiUrl } from "./tiktok.ts";

function forward(json: unknown): void {
  const videos = extractVideos(json);
  if (videos.length === 0) return;
  const message: PageHookMessage = { source: PAGE_HOOK_SOURCE, videos };
  window.postMessage(message, window.location.origin);
}

const originalFetch = window.fetch;
window.fetch = async (...args: Parameters<typeof fetch>) => {
  const response = await originalFetch.apply(window, args);
  if (isTikTokApiUrl(response.url)) {
    // Responses that aren't JSON have nothing for us, so a parse failure is ignored.
    response
      .clone()
      .json()
      .then(forward, () => {});
  }
  return response;
};

const originalOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (
  this: XMLHttpRequest,
  ...args: unknown[]
) {
  this.addEventListener("load", () => {
    if (isTikTokApiUrl(this.responseURL)) forward(readJson(this));
  });
  Reflect.apply(originalOpen, this, args);
} as typeof XMLHttpRequest.prototype.open;

function readJson(request: XMLHttpRequest): unknown {
  if (request.responseType === "json") return request.response;
  if (request.responseType !== "" && request.responseType !== "text") {
    return null;
  }
  try {
    return JSON.parse(request.responseText);
  } catch {
    return null;
  }
}
