// The background service worker carries the content script's requests to the
// local server, which holds the API keys. The content script can't call it
// itself: its requests count as the YouTube page's, and Chrome keeps web pages
// away from this computer's own servers.
import type { ServerRequest } from "./messages.ts";

// Plain HTTP is fine here: the request never leaves this computer.
const SERVER = "http://127.0.0.1:8787";
const PATHS: Record<ServerRequest["type"], string> = {
  findClaims: "/claims",
  checkClaim: "/check",
};

chrome.runtime.onMessage.addListener(
  (message: Partial<ServerRequest>, _sender, sendResponse) => {
    const path = message.type && PATHS[message.type];
    if (!path) return false;
    const { type: _type, ...body } = message;
    void askServer(path, body).then(sendResponse);
    return true; // Keeps the channel open until sendResponse is called.
  },
);

async function askServer(path: string, body: object) {
  let response: Response;
  try {
    response = await fetch(`${SERVER}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return {
      ok: false,
      error:
        "couldn't reach the fact-check server. Is it running? (npm run server)",
    };
  }
  const answer = await response.json().catch(() => ({}));
  return response.ok
    ? { ok: true, ...answer }
    : {
        ok: false,
        error: answer.error ?? `the server answered ${response.status}`,
      };
}
