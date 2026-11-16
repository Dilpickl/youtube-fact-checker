// The background service worker carries the content script's requests to the
// local server, which holds the API keys. The content script can't call it
// itself: its requests count as the YouTube page's, and Chrome keeps web pages
// away from this computer's own servers.
import { ENABLED_KEY, readEnabled, type ServerRequest } from "./messages.ts";

// Clicking the icon turns the extension on or off; the content script on each
// YouTube tab hears the change and hides or shows itself.
// Clicks wait their turn, so a quick double click turns it off and on again
// rather than both clicks reading "on" and writing "off".
let lastToggle = Promise.resolve();
chrome.action.onClicked.addListener(() => {
  lastToggle = lastToggle.then(async () => {
    await chrome.storage.local.set({ [ENABLED_KEY]: !(await readEnabled()) });
  });
});
chrome.storage.onChanged.addListener((changes) => {
  if (ENABLED_KEY in changes) void showOnOff();
});
// Chrome forgets the badge, its colour, and the tooltip when it restarts.
chrome.runtime.onStartup.addListener(() => void showOnOff());
chrome.runtime.onInstalled.addListener(() => void showOnOff());

async function showOnOff() {
  const enabled = await readEnabled();
  await chrome.action.setBadgeBackgroundColor({ color: "#5f6368" });
  await chrome.action.setBadgeText({ text: enabled ? "" : "OFF" });
  await chrome.action.setTitle({
    title: enabled
      ? "Video Fact Check is on. Click to turn it off."
      : "Video Fact Check is off. Click to turn it on.",
  });
}

// Plain HTTP is fine here: the request never leaves this computer.
const SERVER = "http://127.0.0.1:8787";
const PATHS: Record<ServerRequest["type"], string> = {
  findClaims: "/claims",
  checkClaim: "/check",
  pickClaim: "/pick",
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
