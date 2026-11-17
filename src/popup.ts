// The popup that opens from the extension's icon: the on/off switch, the
// video on the tab in front (start it, or always check its channel), and how
// much of today's budget is left.
import {
  CHANNELS_KEY,
  ENABLED_KEY,
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

const enabledSwitch = byId<HTMLInputElement>("enabled");
const enabledLabel = byId("enabled-label");
const videoSection = byId("video");
const startButton = byId<HTMLButtonElement>("start");
const channelRow = byId("channel-row");
const channelLabel = byId("channel-label");
const channelSwitch = byId<HTMLInputElement>("channel");
const hint = byId("hint");
const budget = byId("budget");

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
  const enabled = enabledSwitch.checked;
  videoSection.hidden = !enabled || !state;
  hint.hidden = !videoSection.hidden;
  hint.textContent = enabled
    ? "Open a YouTube video to fact-check it. If one is already open, reload its tab."
    : "Turn it on to fact-check YouTube videos.";
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

function showEnabled(enabled: boolean): void {
  enabledSwitch.checked = enabled;
  enabledLabel.textContent = enabled
    ? "Fact-checking is on"
    : "Fact-checking is off";
}

async function showBudget(): Promise<void> {
  const request: ServerRequest = { type: "budget" };
  const response: BudgetResponse | undefined = await chrome.runtime
    .sendMessage(request)
    .catch(() => undefined);
  budget.textContent = response?.ok
    ? `Today's budget: $${response.left.toFixed(2)} of $${response.cap.toFixed(2)} left`
    : "Today's budget: couldn't reach the server";
}

enabledSwitch.addEventListener("change", async () => {
  showEnabled(enabledSwitch.checked);
  await chrome.storage.local.set({ [ENABLED_KEY]: enabledSwitch.checked });
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

async function open(): Promise<void> {
  showEnabled(await readEnabled());
  await showVideo(await askTab("popupState"));
  void showBudget();
  setInterval(async () => showVideo(await askTab("popupState")), REFRESH_MS);
}
void open();
