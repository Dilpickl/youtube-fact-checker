// The background service worker carries the content script's requests to the
// hosted server, which holds the API keys. The content script can't call it
// itself: its requests would count as the YouTube page's, and the server
// refuses web pages.
import { ENABLED_KEY, readEnabled, type ServerRequest } from "./messages.ts";

// The popup's button turns the extension on or off; the icon turns grey and
// shows "OFF" so the state is visible without opening it.
chrome.storage.onChanged.addListener((changes) => {
  if (ENABLED_KEY in changes) void showOnOff();
});
// Chrome forgets the badge, its colour, and the tooltip when it restarts.
chrome.runtime.onStartup.addListener(() => void showOnOff());
chrome.runtime.onInstalled.addListener(() => void showOnOff());

// The icon is drawn here rather than shipped as image files: a speech bubble
// (a claim) with a check (its verdict), green while on and grey while off.
const BUBBLE =
  "M14 4h36a11 11 0 0 1 11 11v23a11 11 0 0 1-11 11H32L18 61V49h-4A11 11 0 0 1 3 38V15A11 11 0 0 1 14 4z";
const CHECK = "M19 26l10 10 17-18";

function iconImage(size: number, enabled: boolean): ImageData {
  const context = new OffscreenCanvas(size, size).getContext("2d");
  if (!context) throw new Error("no canvas to draw the icon on");
  context.scale(size / 64, size / 64);
  const fill = context.createLinearGradient(0, 0, 64, 64);
  fill.addColorStop(0, enabled ? "#22c071" : "#9aa0a6");
  fill.addColorStop(1, enabled ? "#0b7f47" : "#6b7075");
  context.fillStyle = fill;
  context.fill(new Path2D(BUBBLE));
  context.strokeStyle = "#fff";
  context.lineWidth = size < 32 ? 8 : 6.5; // Bolder where it's tiny.
  context.lineCap = "round";
  context.lineJoin = "round";
  context.stroke(new Path2D(CHECK));
  return context.getImageData(0, 0, size, size);
}

async function showOnOff() {
  const enabled = await readEnabled();
  await chrome.action.setIcon({
    imageData: { 16: iconImage(16, enabled), 32: iconImage(32, enabled) },
  });
  await chrome.action.setBadgeBackgroundColor({ color: "#5f6368" });
  await chrome.action.setBadgeText({ text: enabled ? "" : "OFF" });
  await chrome.action.setTitle({
    title: enabled ? "Video Fact Check is on" : "Video Fact Check is off",
  });
}

// The server on Render (render.yaml). To use one on this computer instead
// (npm run server), put http://127.0.0.1:8787 here and in the manifest's
// host_permissions.
const SERVER = "https://video-fact-check-6p2n.onrender.com";
const PATHS: Record<ServerRequest["type"], string> = {
  findClaims: "/claims",
  checkClaim: "/check",
  pickClaim: "/pick",
  budget: "/budget",
};

chrome.runtime.onMessage.addListener(
  (message: Partial<ServerRequest>, _sender, sendResponse) => {
    const path = message.type && PATHS[message.type];
    if (!path) return false;
    const { type, ...body } = message;
    // Only the budget is a question with nothing to send.
    void askServer(path, type === "budget" ? undefined : body).then(
      sendResponse,
    );
    return true; // Keeps the channel open until sendResponse is called.
  },
);

async function askServer(path: string, body?: object) {
  let response: Response;
  try {
    response = await fetch(`${SERVER}${path}`, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json" },
      body: body && JSON.stringify(body),
    });
  } catch {
    return {
      ok: false,
      error: "couldn't reach the fact-check server. Check your connection",
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
