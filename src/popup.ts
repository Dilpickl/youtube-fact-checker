// The popup that opens from the extension's icon: the big on/off button, the
// video on the tab in front (start it, or always check its channel), the
// setting for Shorts, and how much of today's budget is left.
import {
  ALL_SHORTS_KEY,
  CHANNELS_KEY,
  ENABLED_KEY,
  readAllShorts,
  readChannels,
  readEnabled,
  type BudgetResponse,
  type PopupRequest,
  type PopupState,
  type ServerRequest,
} from "./messages.ts";

// A video goes from "Finding claims…" to its count while the popup is open.
const REFRESH_MS = 1000;

function byId<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const power = byId<HTMLButtonElement>("enabled");
const powerLabel = byId("enabled-label");
const powerHint = byId("enabled-hint");
const settings = byId("settings");
const videoSection = byId("video");
const startButton = byId<HTMLButtonElement>("start");
const channelRow = byId("channel-row");
const channelLabel = byId("channel-label");
const channelSwitch = byId<HTMLInputElement>("channel");
const allShortsSwitch = byId<HTMLInputElement>("all-shorts");
const hint = byId("hint");
const budgetText = byId("budget-text");
const budgetBar = byId("budget-bar");

let enabled = true;
let channel: NonNullable<PopupState>["channel"] = null;

/** Asks the content script on the tab in front; null when it isn't a YouTube video. */
async function askTab(type: PopupRequest["type"]): Promise<PopupState> {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.id === undefined) return null;
    const request: PopupRequest = { type };
    return (await chrome.tabs.sendMessage(tab.id, request)) ?? null;
  } catch {
    // No content script there: not YouTube, or a tab open since before the
    // extension was loaded.
    return null;
  }
}

async function showVideo(state: PopupState): Promise<void> {
  videoSection.hidden = !enabled || !state;
  hint.hidden = !enabled || !videoSection.hidden;
  if (!state) return;
  startButton.textContent =
    state.label === "Fact-check" ? "Fact-check this video" : state.label;
  startButton.disabled = !state.canStart;
  channel = state.channel;
  channelRow.hidden = !channel;
  if (!channel) return;
  channelLabel.textContent = `Always check ${channel.name}`;
  channelSwitch.checked = channel.id in (await readChannels());
}

function showEnabled(next: boolean): void {
  enabled = next;
  power.setAttribute("aria-checked", String(enabled));
  powerLabel.textContent = enabled
    ? "Fact-checking is on"
    : "Fact-checking is off";
  powerHint.textContent = enabled
    ? "Click to turn it off"
    : "Click to turn it on";
  settings.hidden = !enabled;
}

async function showBudget(): Promise<void> {
  const request: ServerRequest = { type: "budget" };
  const response: BudgetResponse | undefined = await chrome.runtime
    .sendMessage(request)
    .catch(() => undefined);
  if (!response?.ok) {
    budgetText.textContent = "Couldn't reach the server";
    return;
  }
  budgetText.textContent = `$${response.left.toFixed(2)} of $${response.cap.toFixed(2)} left`;
  budgetBar.style.width = `${(100 * response.left) / response.cap}%`;
}

power.addEventListener("click", async () => {
  showEnabled(!enabled);
  await chrome.storage.local.set({ [ENABLED_KEY]: enabled });
  await showVideo(await askTab("popupState"));
});
startButton.addEventListener("click", async () => {
  await showVideo(await askTab("popupStart"));
});
channelSwitch.addEventListener("change", async () => {
  if (!channel) return;
  const channels = await readChannels();
  if (channelSwitch.checked) channels[channel.id] = channel.name;
  else delete channels[channel.id];
  await chrome.storage.local.set({ [CHANNELS_KEY]: channels });
});
allShortsSwitch.addEventListener("change", async () => {
  await chrome.storage.local.set({
    [ALL_SHORTS_KEY]: allShortsSwitch.checked,
  });
});

async function open(): Promise<void> {
  showEnabled(await readEnabled());
  allShortsSwitch.checked = await readAllShorts();
  await showVideo(await askTab("popupState"));
  void showBudget();
  setInterval(async () => showVideo(await askTab("popupState")), REFRESH_MS);
}
void open();
