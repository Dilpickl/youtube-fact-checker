// The website: a Now page that shows the one task to do next, and a Plan page
// that lays everything out by day and imports screenshots.
import {
  STATUS_LABELS,
  STATUSES,
  type ReviewRow,
  type SaveRow,
  type SavedAssignment,
  type Status,
} from "../src/assignment.ts";
import {
  buildSchedule,
  describeDay,
  describePace,
  describeWhen,
  smallerItem,
  type WorkItem,
} from "../src/now.ts";
import { buildHistory, formatMinutes } from "../src/history.ts";
import {
  courseColors,
  courseStatus,
  dueOn,
  matchesQuery,
  monthGrid,
  summarizeCourses,
} from "../src/overview.ts";
import { buildPlan } from "../src/plan.ts";

interface Notice {
  text: string;
  kind: "good" | "error";
  undo?: () => void;
}

/** A row under review, plus the student's answer to "Same assignment?". */
interface Draft extends ReviewRow {
  sameAnswer: "same" | "different" | null;
}

const state = {
  assignments: null as SavedAssignment[] | null,
  loadFailed: false,
  /** What's being read right now, if anything. */
  importing: null as "screenshot" | "page" | null,
  pasteOpen: false,
  /** What's typed in the paste box, kept across re-renders. */
  pasteDraft: "",
  saving: false,
  drafts: null as Draft[] | null,
  reviewError: null as string | null,
  notice: null as Notice | null,
  estimating: false,
  estimateError: null as string | null,
  /** Tasks passed over with "Not now" this visit. */
  skipped: new Set<number>(),
  /** A task chosen by "Too tired?" instead of the next in order. */
  tiredPick: null as number | null,
  canvas: null as { connected: boolean; lastChecked: string | null } | null,
  canvasFormOpen: false,
  /** What's typed in the feed link box, kept across re-renders. */
  canvasDraft: "",
  canvasError: null as string | null,
  checkingCanvas: false,
  overviewView: "courses" as "courses" | "calendar",
  /** Course cards opened past their first three assignments. */
  expandedCourses: new Set<string>(),
  calendarMonth: {
    year: new Date().getFullYear(),
    month: new Date().getMonth(),
  },
  selectedDay: new Date(),
  /** What's typed in Overview's "Find an assignment" box. */
  overviewQuery: "",
  /** The assignment opened on Overview to show its Mark done button. */
  openItem: null as number | null,
  /** Review rows opened for editing, by position in the review. */
  openRows: new Set<number>(),
  /** The "Course for rows without one" box in the review. */
  bulkCourse: "",
  /** New rows left out of the review because they're already finished. */
  reviewSkipped: 0,
  /** Where the rows under review came from. */
  reviewSource: "screenshot" as "screenshot" | "canvas" | "page",
};

const app = document.querySelector<HTMLElement>("#app")!;

type Child = Node | string | null | false;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    node.setAttribute(name, value);
  }
  node.append(...children.filter((child) => child !== null && child !== false));
  return node;
}

function button(label: string, onClick: () => void, className = "") {
  const node = el("button", className ? { class: className } : {}, label);
  node.addEventListener("click", onClick);
  return node;
}

const tag = (text: string) => el("span", { class: "tag" }, text);

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    // The server restarts itself after code changes (about 2 seconds), so
    // wait out a restart once before giving up.
    await new Promise((resolve) => setTimeout(resolve, 2500));
    try {
      response = await fetch(path, init);
    } catch {
      throw new Error(
        "Couldn't reach the server. Check that npm start is still running, then try again.",
      );
    }
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error ?? `The server answered ${response.status}.`);
  }
  return body as T;
}

// ---- Dates ----

const timeLabel = (assignment: SavedAssignment) =>
  new Date(assignment.dueAt!).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

const dateLabel = (assignment: SavedAssignment) =>
  new Date(assignment.dueAt!).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

const pad = (n: number) => String(n).padStart(2, "0");

/** The value a datetime-local input expects, in the student's time zone. */
function toInputValue(dueAt: string): string {
  const d = new Date(dueAt);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** ISO 8601 with the local offset, so the clock time stays as typed. */
function toLocalIso(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  return `${toInputValue(date.toISOString())}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

// ---- Actions ----

async function loadAssignments() {
  state.loadFailed = false;
  render();
  try {
    state.assignments = await api<SavedAssignment[]>("/api/assignments");
  } catch {
    state.loadFailed = true;
  }
  render();
  void ensureEstimates();
}

/** Asks the server to estimate any task that can be worked on and has none. */
async function ensureEstimates() {
  const missing = state.assignments?.some(
    (a) => a.estimateMinutes === null && !a.ignored && a.status !== "closed",
  );
  if (!missing || state.estimating) return;
  state.estimating = true;
  state.estimateError = null;
  render();
  try {
    state.assignments = await api<SavedAssignment[]>("/api/estimates", {
      method: "POST",
    });
  } catch (error) {
    state.estimateError = messageOf(error);
  } finally {
    state.estimating = false;
    render();
  }
}

/** Shared by screenshots and pasted pages: read, then open the review. */
async function runImport(
  source: "screenshot" | "page",
  request: () => Promise<{ rows: ReviewRow[]; skipped: number }>,
) {
  if (state.drafts) {
    state.notice = {
      text: "Save or cancel the import you're reviewing first.",
      kind: "error",
    };
    return render();
  }
  if (state.importing) return;
  if (location.hash !== "#plan") location.hash = "#plan";
  state.importing = source;
  state.notice = null;
  render();
  try {
    const { rows, skipped } = await request();
    state.reviewSkipped = skipped;
    if (rows.length === 0) {
      state.notice =
        skipped > 0
          ? {
              text: `Everything in that ${source} is already finished or past, so there's nothing new to add.`,
              kind: "good",
            }
          : {
              text: `No assignments found in that ${source}. Try one that shows assignment names and due dates.`,
              kind: "error",
            };
    } else {
      state.drafts = rows.map((row) => ({ ...row, sameAnswer: null }));
      state.openRows.clear();
      state.reviewSource = source;
      state.reviewError = null;
      if (source === "page") {
        state.pasteOpen = false;
        state.pasteDraft = "";
      }
    }
  } catch (error) {
    state.notice = { text: messageOf(error), kind: "error" };
  } finally {
    state.importing = null;
    render();
  }
}

function importFile(file: File) {
  if (file.type !== "image/png" && file.type !== "image/jpeg") {
    state.notice = {
      text: "That isn't a PNG or JPEG image. Take a screenshot and try again.",
      kind: "error",
    };
    return render();
  }
  return runImport("screenshot", () =>
    api("/api/import", {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    }),
  );
}

/** A single https link is fetched by the server; anything else is page text. */
function importPage() {
  const pasted = state.pasteDraft.trim();
  if (!pasted) {
    state.notice = {
      text: "Paste a page's text or a link first.",
      kind: "error",
    };
    return render();
  }
  const isLink = /^https?:[/][/][^ ]+$/.test(pasted);
  return runImport("page", () =>
    api("/api/import-page", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(isLink ? { url: pasted } : { text: pasted }),
    }),
  );
}

async function saveDrafts() {
  const drafts = state.drafts!;
  const kept = drafts.filter((draft) => draft.include);
  const unanswered = kept.filter(
    (draft) => draft.match.kind === "ask" && !draft.sameAnswer,
  ).length;
  if (unanswered > 0) {
    state.reviewError = `Answer "Same assignment?" for ${unanswered} row${unanswered === 1 ? "" : "s"} first.`;
    return render();
  }
  if (kept.some((draft) => !draft.name.trim())) {
    state.reviewError = "Every row you keep needs a name.";
    return render();
  }
  const rows: SaveRow[] = drafts
    .filter((draft) => draft.name.trim())
    .map((draft) => ({
      name: draft.name.trim(),
      course: draft.course.trim(),
      dueAt: draft.dueAt,
      status: draft.status,
      matchId:
        draft.match.kind === "same" ||
        (draft.match.kind === "ask" && draft.sameAnswer === "same")
          ? draft.match.id
          : null,
      ignored: !draft.include,
    }));
  state.saving = true;
  state.reviewError = null;
  render();
  try {
    state.assignments = await api<SavedAssignment[]>("/api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows }),
    });
    state.drafts = null;
    state.notice = {
      text: `Saved ${kept.length} assignment${kept.length === 1 ? "" : "s"}.`,
      kind: "good",
    };
    void ensureEstimates();
  } catch (error) {
    state.reviewError = messageOf(error);
  } finally {
    state.saving = false;
    render();
  }
}

async function setStatus(
  assignment: SavedAssignment,
  status: Status,
  notice: Notice,
) {
  try {
    state.assignments = await api<SavedAssignment[]>(
      `/api/assignments/${assignment.id}/status`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      },
    );
    state.notice = notice;
  } catch (error) {
    state.notice = { text: messageOf(error), kind: "error" };
  }
  render();
}

const backOnPlan = (assignment: SavedAssignment): Notice => ({
  text: `"${assignment.name}" is back on your plan.`,
  kind: "good",
});

const markDone = (assignment: SavedAssignment) =>
  setStatus(assignment, "closed", {
    text: `Marked "${assignment.name}" done.`,
    kind: "good",
    // Restores the exact status it had, e.g. "Not open yet".
    undo: () =>
      void setStatus(assignment, assignment.status, backOnPlan(assignment)),
  });

/** Records a work session; finishing it also marks the assignment done. */
async function logWork(item: WorkItem, minutes: number, finished: boolean) {
  const { assignment } = item;
  try {
    const result = await api<{
      sessionId: number;
      assignments: SavedAssignment[];
    }>(`/api/assignments/${assignment.id}/work`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ minutes, finished }),
    });
    state.assignments = result.assignments;
    state.tiredPick = null;
    state.notice = {
      text: finished
        ? `Finished "${assignment.name}".`
        : `Logged ${minutes} min on "${assignment.name}".`,
      kind: "good",
      undo: () => void undoWork(result.sessionId, finished ? assignment : null),
    };
  } catch (error) {
    state.notice = { text: messageOf(error), kind: "error" };
  }
  render();
}

/** Removes a logged session, and reopens the assignment if it finished it. */
async function undoWork(sessionId: number, finished: SavedAssignment | null) {
  try {
    state.assignments = await api<SavedAssignment[]>(`/api/work/${sessionId}`, {
      method: "DELETE",
    });
    if (finished) {
      return await setStatus(finished, finished.status, backOnPlan(finished));
    }
    state.notice = { text: "Session removed.", kind: "good" };
  } catch (error) {
    state.notice = { text: messageOf(error), kind: "error" };
  }
  render();
}

/** Puts finished work back the way it was, e.g. "Not open yet". */
async function reopen(assignment: SavedAssignment) {
  try {
    state.assignments = await api<SavedAssignment[]>(
      `/api/assignments/${assignment.id}/reopen`,
      { method: "POST" },
    );
    state.notice = backOnPlan(assignment);
  } catch (error) {
    state.notice = { text: messageOf(error), kind: "error" };
  }
  render();
}

// ---- Canvas ----

const CANVAS_RECHECK_MS = 6 * 60 * 60 * 1000;

async function loadCanvas() {
  try {
    state.canvas = await api("/api/canvas");
  } catch {
    return; // The rest of the app works without it.
  }
  const last = state.canvas?.lastChecked;
  if (
    state.canvas?.connected &&
    (!last || Date.now() - Date.parse(last) > CANVAS_RECHECK_MS)
  ) {
    await checkCanvas(true);
  }
  render();
}

async function connectCanvas(feedUrl: string) {
  state.canvasError = null;
  try {
    state.canvas = await api("/api/canvas", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedUrl }),
    });
    state.canvasFormOpen = false;
    state.canvasDraft = "";
    await checkCanvas(false);
  } catch (error) {
    state.canvasError = messageOf(error);
  }
  render();
}

async function disconnectCanvas() {
  try {
    state.canvas = await api("/api/canvas", { method: "DELETE" });
    state.notice = { text: "Canvas disconnected.", kind: "good" };
  } catch (error) {
    state.notice = { text: messageOf(error), kind: "error" };
  }
  render();
}

/** Quiet checks (the automatic ones) say nothing when nothing is new. */
async function checkCanvas(quiet: boolean) {
  if (state.drafts || state.checkingCanvas) {
    if (!quiet) {
      state.notice = {
        text: "Save or cancel the import you're reviewing first.",
        kind: "error",
      };
    }
    return render();
  }
  state.checkingCanvas = true;
  if (!quiet) state.notice = null;
  render();
  try {
    const { rows } = await api<{ rows: ReviewRow[] }>("/api/canvas/check", {
      method: "POST",
    });
    if (rows.length > 0) {
      state.drafts = rows.map((row) => ({ ...row, sameAnswer: null }));
      state.openRows.clear();
      state.reviewSource = "canvas";
      state.reviewError = null;
    } else if (!quiet) {
      state.notice = {
        text: "Canvas is up to date: nothing new or changed.",
        kind: "good",
      };
    }
    state.canvas = await api("/api/canvas");
  } catch (error) {
    state.notice = { text: messageOf(error), kind: "error" };
  } finally {
    state.checkingCanvas = false;
    render();
  }
}

/** "just now", "12 min ago", "3 h ago", or a date. */
function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function renderPasteBox(): HTMLElement {
  const box = el("textarea", {
    rows: "7",
    "aria-label": "Page text or link",
    placeholder:
      "Paste a link to a public course page, or the text of any assignments page (open it, press Ctrl+A, then Ctrl+C).",
  });
  box.value = state.pasteDraft;
  box.addEventListener("input", () => {
    state.pasteDraft = box.value;
  });
  const read = button(
    state.importing === "page" ? "Reading…" : "Import",
    () => void importPage(),
    "primary",
  );
  read.disabled = state.importing !== null;
  return el(
    "div",
    { class: "card paste-box" },
    el("strong", {}, "Paste text or a link"),
    el(
      "p",
      { class: "muted" },
      "Text works for any page you can see, even ones you have to log in to, like Gradescope or PrairieLearn. Links work for public pages only.",
    ),
    box,
    el(
      "div",
      { class: "actions" },
      read,
      button("Cancel", () => {
        state.pasteOpen = false;
        state.pasteDraft = "";
        render();
      }),
    ),
  );
}

function renderCanvasBar(): HTMLElement | null {
  if (!state.canvas) return null;
  if (state.canvasFormOpen) {
    const input = el("input", {
      type: "url",
      placeholder: "https://canvas.illinois.edu/feeds/calendars/user_….ics",
      "aria-label": "Canvas calendar feed link",
    });
    input.value = state.canvasDraft;
    input.addEventListener("input", () => {
      state.canvasDraft = input.value;
    });
    const submit = () => {
      if (!input.value.trim()) {
        state.canvasError = "Paste your Canvas feed link first.";
        return render();
      }
      void connectCanvas(input.value);
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") submit();
    });
    return el(
      "div",
      { class: "canvas-bar card" },
      el("strong", {}, "Connect Canvas"),
      el(
        "p",
        { class: "muted" },
        "In Canvas, open Calendar, click Calendar Feed at the bottom right, and copy the link. It works like a password, so it stays on this computer.",
      ),
      input,
      state.canvasError &&
        el("p", { class: "error-text", role: "alert" }, state.canvasError),
      el(
        "div",
        { class: "actions" },
        button("Connect", submit, "primary"),
        button("Cancel", () => {
          state.canvasFormOpen = false;
          state.canvasError = null;
          render();
        }),
      ),
    );
  }
  if (!state.canvas.connected) {
    return el(
      "div",
      { class: "canvas-bar" },
      el(
        "span",
        { class: "muted" },
        "Get new Canvas assignments without screenshots.",
      ),
      button("Connect Canvas", () => {
        state.canvasFormOpen = true;
        render();
      }),
    );
  }
  const check = button(
    state.checkingCanvas ? "Checking…" : "Check Canvas",
    () => void checkCanvas(false),
  );
  check.disabled = state.checkingCanvas;
  return el(
    "div",
    { class: "canvas-bar" },
    el(
      "span",
      { class: "muted" },
      `Canvas connected · checked ${
        state.canvas.lastChecked ? timeAgo(state.canvas.lastChecked) : "never"
      }`,
    ),
    check,
    button("Disconnect", () => void disconnectCanvas(), "link"),
  );
}

// ---- Pages ----

function renderNow(): Node[] {
  const page = (...nodes: Child[]): Node[] =>
    [...nodes, state.notice && renderNotice(state.notice)].filter(
      (node): node is HTMLElement => Boolean(node),
    );
  const card = (...children: Child[]) =>
    el("div", { class: "card now-card" }, ...children);

  if (state.loadFailed) return renderSchedule();
  if (!state.assignments || state.estimating) {
    return page(
      card(
        el(
          "p",
          { class: "muted", role: "status" },
          state.estimating
            ? "Working out how long each task takes…"
            : "Loading…",
        ),
      ),
    );
  }

  const now = new Date();
  const schedule = buildSchedule(state.assignments, now);
  const pace = describePace(schedule.pace);
  const paceLine =
    pace &&
    el(
      "p",
      { class: "muted pace" },
      schedule.doneToday > 0
        ? `${pace} You've done ${schedule.doneToday} min today.`
        : pace,
    );

  if (schedule.items.length === 0) {
    const hasAny = state.assignments.some((a) => !a.ignored);
    return page(
      card(
        el("h1", {}, hasAny ? "Nothing to do right now" : "Nothing saved yet"),
        el(
          "p",
          { class: "muted" },
          hasAny
            ? "Everything you can work on is done. New work shows up here once you add it on your Plan."
            : "Add a screenshot of an assignments page on your Plan, and this page will lay out what to do in order.",
        ),
        el("a", { class: "button", href: "#plan" }, "Open your Plan"),
      ),
    );
  }

  const queue = schedule.items.filter(
    (item) => !state.skipped.has(item.assignment.id),
  );
  const tiredItem = schedule.items.find(
    (item) => item.assignment.id === state.tiredPick,
  );
  const current = tiredItem ?? queue[0];
  if (!current) {
    return page(
      card(
        el("h1", {}, "That's everything for now"),
        el(
          "p",
          { class: "muted" },
          `You passed on all ${schedule.items.length} tasks. Start over to see them in order again.`,
        ),
        button(
          "Start over",
          () => {
            state.skipped.clear();
            render();
          },
          "primary",
        ),
      ),
      paceLine,
    );
  }

  const shareDone = !schedule.items.some((item) => item.tier !== "ahead");
  const eyebrows = {
    "due-soon": "Due soon",
    today: "Today's share",
    ahead: "Getting ahead",
  };
  const reasons = {
    "due-soon": "It's due soon, so it comes before everything else.",
    today: "It's part of today's share of your upcoming work.",
    ahead: `Starting early: the plan has it for ${describeDay(current.plannedStart, now)}.`,
  };
  const partial = current.minutes < current.remaining;
  const { assignment } = current;
  const sameDay =
    current.plannedStart.getTime() === current.plannedFinish.getTime();
  const planned =
    current.tier === "due-soon"
      ? null
      : sameDay
        ? `Planned for ${describeDay(current.plannedStart, now)}`
        : `Planned ${describeDay(current.plannedStart, now)} through ${describeDay(current.plannedFinish, now)}`;

  return page(
    shareDone &&
      el(
        "p",
        { class: "notice good" },
        "Today's share is done and everything is on track. You can stop here, or keep going to get ahead.",
      ),
    card(
      el(
        "p",
        { class: "eyebrow" },
        tiredItem ? "Something smaller" : eyebrows[current.tier],
      ),
      el("h1", {}, assignment.name),
      el("p", { class: "muted" }, assignment.course || "No course"),
      el("p", {}, `Due ${describeWhen(new Date(assignment.dueAt!), now)}`),
      el(
        "p",
        { class: "start-by" },
        partial
          ? `This session: about ${current.minutes} min (${current.remaining} min left in all)`
          : `About ${current.minutes} min`,
      ),
      planned && el("p", { class: "muted" }, planned),
      el(
        "p",
        {},
        tiredItem
          ? "It's the shortest session on your list."
          : reasons[current.tier],
      ),
      state.estimateError &&
        el(
          "p",
          { class: "error-text" },
          `Couldn't estimate times (${state.estimateError}). Using 30 minutes per task for now.`,
        ),
      el(
        "div",
        { class: "actions" },
        button(
          partial ? "Done with this session" : "Done",
          () => void logWork(current, current.minutes, !partial),
          "primary",
        ),
        partial &&
          button(
            "Finished it all",
            () => void logWork(current, current.remaining, true),
          ),
        button("Not now", () => {
          state.skipped.add(assignment.id);
          state.tiredPick = null;
          state.notice = null;
          render();
        }),
        button("Too tired?", () => {
          const smaller = smallerItem(queue, current);
          if (smaller) {
            state.tiredPick = smaller.assignment.id;
            state.notice = null;
          } else {
            state.notice = {
              text: "This is already the shortest session on your list. Take a 10-minute break, then come back to it.",
              kind: "good",
            };
          }
          render();
        }),
      ),
    ),
    paceLine,
  );
}

function renderPlan(): Node[] {
  const fileInput = el("input", {
    type: "file",
    accept: "image/png,image/jpeg",
    hidden: "",
  });
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file) void importFile(file);
  });
  const add = button(
    state.importing === "screenshot" ? "Reading…" : "Add screenshot",
    () => fileInput.click(),
    "primary",
  );
  const paste = button("Paste text or link", () => {
    state.pasteOpen = true;
    render();
  });
  for (const control of [add, paste]) {
    control.disabled = state.importing !== null || state.drafts !== null;
  }

  return [
    el(
      "div",
      { class: "plan-header" },
      el(
        "div",
        {},
        el("h1", {}, "Plan"),
        el(
          "p",
          { class: "hint muted" },
          state.drafts
            ? "Save or cancel this import to add another."
            : "Add a screenshot of any course page (or paste one with Ctrl+V), or paste a page's text or link.",
        ),
      ),
      el("div", { class: "actions" }, add, paste, fileInput),
    ),
    renderCanvasBar(),
    state.pasteOpen && !state.drafts && renderPasteBox(),
    state.importing &&
      el(
        "p",
        { class: "notice", role: "status" },
        state.importing === "page"
          ? "Reading that page…"
          : "Reading your screenshot…",
      ),
    state.notice && renderNotice(state.notice),
    state.drafts && renderReview(state.drafts),
    ...renderSchedule(),
  ].filter((node): node is HTMLElement => Boolean(node));
}

function renderNotice(notice: Notice): HTMLElement {
  return el(
    "p",
    {
      class: `notice ${notice.kind}`,
      role: notice.kind === "error" ? "alert" : "status",
    },
    notice.text,
    notice.undo ? " " : null,
    notice.undo ? button("Undo", notice.undo) : null,
  );
}

function renderSchedule(): Node[] {
  if (state.loadFailed) {
    return [
      el(
        "div",
        { class: "notice error", role: "alert" },
        "Couldn't load your plan. Check that the server is running. ",
        button("Try again", () => void loadAssignments()),
      ),
    ];
  }
  if (!state.assignments) {
    return [el("p", { class: "muted" }, "Loading your plan…")];
  }
  const plan = buildPlan(state.assignments, new Date());
  if (Object.values(plan).flat().length === 0) {
    return state.drafts
      ? []
      : [
          el(
            "div",
            { class: "card", style: "margin-top: 24px" },
            el("h2", { style: "margin-top: 0" }, "Nothing saved yet"),
            el(
              "p",
              { class: "muted" },
              "Take a screenshot of an assignments page (Connect, Canvas, Gradescope, a syllabus) and add it above. You'll check what was found before anything is saved.",
            ),
          ),
        ];
  }

  const nodes: Node[] = [];
  const section = (
    title: string,
    items: SavedAssignment[],
    when: (assignment: SavedAssignment) => string,
  ) => {
    if (items.length > 0) nodes.push(el("h2", {}, title), list(items, when));
  };
  section("Past due", plan.pastDue, dateLabel);
  section("Today", plan.today, timeLabel);
  for (const day of plan.thisWeek) section(day.label, day.items, timeLabel);
  section("Later", plan.later, dateLabel);
  section("Needs a date", plan.needsDate, () => "No date");
  if (nodes.length === 0) {
    nodes.push(el("p", { class: "muted" }, "Nothing left to do right now."));
  }
  if (plan.done.length > 0) {
    nodes.push(
      el(
        "p",
        { class: "muted" },
        `${plan.done.length} done. `,
        el("a", { href: "#history" }, "See them in History"),
      ),
    );
  }
  return nodes;
}

function list(
  items: SavedAssignment[],
  when: (assignment: SavedAssignment) => string,
) {
  return el(
    "ul",
    { class: "list" },
    ...items.map((assignment) =>
      el(
        "li",
        {},
        el("span", { class: "when" }, when(assignment)),
        el(
          "span",
          { class: "what" },
          assignment.name,
          assignment.status === "not_open_yet" && tag("Not open yet"),
          el("br"),
          el("span", { class: "course" }, assignment.course || "No course"),
        ),
        button("Mark done", () => void markDone(assignment)),
      ),
    ),
  );
}

// ---- Overview ----

/** "Sat 25" this week and next, "Nov 8" further out. */
function shortDay(iso: string): string {
  const date = new Date(iso);
  const days = (date.getTime() - Date.now()) / 86_400_000;
  if (days > -7 && days < 7) {
    const weekday = date.toLocaleDateString("en-US", { weekday: "short" });
    return `${weekday} ${date.getDate()}`;
  }
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const dot = (color: string) =>
  el("span", {
    class: "dot",
    style: `background: ${color}`,
    "aria-hidden": "true",
  });

function renderOverview(): Node[] {
  if (state.loadFailed || !state.assignments) return renderSchedule();
  const toggle = (view: "courses" | "calendar", label: string) => {
    const control = button(label, () => {
      state.overviewView = view;
      render();
    });
    control.setAttribute("aria-pressed", String(state.overviewView === view));
    return control;
  };
  const search = el("input", {
    id: "overview-search",
    type: "search",
    placeholder: "Find an assignment or course",
    "aria-label": "Find an assignment or course",
  });
  search.value = state.overviewQuery;
  search.addEventListener("input", () => {
    state.overviewQuery = search.value;
    render();
    // Re-rendering replaces the box, so put the cursor back where it was.
    const again = document.querySelector<HTMLInputElement>("#overview-search");
    again?.focus();
    again?.setSelectionRange(again.value.length, again.value.length);
  });
  const matching = state.assignments.filter((a) =>
    matchesQuery(a, state.overviewQuery),
  );
  const colors = courseColors(state.assignments);
  return [
    el(
      "div",
      { class: "plan-header" },
      el("h1", {}, "Overview"),
      el(
        "div",
        { class: "segmented", role: "group", "aria-label": "View" },
        toggle("courses", "By course"),
        toggle("calendar", "Calendar"),
      ),
    ),
    el("p", { class: "hint muted" }, "Click an assignment to mark it done."),
    search,
    state.notice ? renderNotice(state.notice) : el("span"),
    state.overviewView === "courses"
      ? renderCourseCards(matching)
      : renderCalendar(matching, colors),
  ];
}

/** An assignment row that opens, on click, to show a Mark done button. */
function overviewItem(
  assignment: SavedAssignment,
  when: string,
  options: { color?: string; overdue?: boolean; showCourse?: boolean } = {},
): HTMLElement {
  const open = state.openItem === assignment.id;
  const later = assignment.status === "not_open_yet";
  const name = el(
    "button",
    {
      class: later ? "item-button later" : "item-button",
      "aria-expanded": String(open),
    },
    assignment.name,
    later && el("span", { class: "later-note" }, " · not open yet"),
    options.showCourse
      ? el("span", { class: "muted" }, ` · ${assignment.course || "No course"}`)
      : null,
  );
  name.addEventListener("click", () => {
    state.openItem = open ? null : assignment.id;
    render();
  });
  return el(
    "li",
    { class: open ? "open" : "" },
    options.color ? dot(options.color) : null,
    name,
    el("span", { class: options.overdue ? "when overdue" : "when" }, when),
    open &&
      el(
        "div",
        { class: "item-actions" },
        button(
          "Mark done",
          () => {
            state.openItem = null;
            void markDone(assignment);
          },
          "primary",
        ),
        button("Cancel", () => {
          state.openItem = null;
          render();
        }),
      ),
  );
}

function renderCourseCards(assignments: SavedAssignment[]): HTMLElement {
  const summaries = summarizeCourses(assignments, new Date());
  const searching = state.overviewQuery.trim() !== "";
  if (summaries.length === 0 && searching) {
    return el(
      "p",
      { class: "muted", style: "margin-top: 16px" },
      `No assignments still to do match "${state.overviewQuery.trim()}".`,
    );
  }
  if (summaries.length === 0) {
    return el(
      "div",
      { class: "card", style: "margin-top: 16px" },
      el("h2", { style: "margin-top: 0" }, "Nothing to do"),
      el(
        "p",
        { class: "muted" },
        "Every saved assignment is done. Add more on your Plan.",
      ),
    );
  }
  return el(
    "div",
    { class: "course-cards" },
    ...summaries.map((summary) => {
      const status = courseStatus(summary);
      const items = [
        ...summary.overdue,
        ...summary.upcoming,
        ...summary.undated,
      ];
      // Searching shows every match; otherwise the next three.
      const expanded = searching || state.expandedCourses.has(summary.course);
      const shown = expanded ? items : items.slice(0, 3);
      const rows = shown.map((assignment) =>
        overviewItem(
          assignment,
          assignment.dueAt ? shortDay(assignment.dueAt) : "No date",
          { overdue: summary.overdue.includes(assignment) },
        ),
      );
      const more = searching ? 0 : items.length - 3;
      return el(
        "section",
        { class: "course-card" },
        el(
          "div",
          { class: "course-head" },
          el("h2", {}, dot(summary.color), summary.course || "No course"),
          el("span", { class: `course-status ${status.tone}` }, status.text),
        ),
        el("ul", {}, ...rows),
        more > 0 &&
          button(
            expanded ? "Show less" : `+${more} more`,
            () => {
              if (expanded) state.expandedCourses.delete(summary.course);
              else state.expandedCourses.add(summary.course);
              render();
            },
            "link",
          ),
      );
    }),
  );
}

function renderCalendar(
  assignments: SavedAssignment[],
  colors: Map<string, string>,
): HTMLElement {
  const { year, month } = state.calendarMonth;
  const today = new Date();
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const moveMonth = (by: number) => {
    const next = new Date(year, month + by, 1);
    state.calendarMonth = { year: next.getFullYear(), month: next.getMonth() };
    render();
  };

  const weeks = monthGrid(year, month).map((week) =>
    week.map((day) => {
      if (!day) return el("div", { class: "cal-day empty" });
      const due = dueOn(assignments, day);
      const cell = el(
        "button",
        {
          class: [
            "cal-day",
            sameDay(day, today) ? "today" : "",
            sameDay(day, state.selectedDay) ? "selected" : "",
          ].join(" "),
          "aria-label": `${day.toLocaleDateString("en-US", { month: "long", day: "numeric" })}, ${due.length} due`,
        },
        el("span", { class: "cal-date" }, String(day.getDate())),
        el(
          "span",
          { class: "cal-dots" },
          ...due.slice(0, 3).map((a) => dot(colors.get(a.course)!)),
          due.length > 3 &&
            el("span", { class: "cal-more" }, `+${due.length - 3}`),
        ),
      );
      cell.addEventListener("click", () => {
        state.selectedDay = day;
        render();
      });
      return cell;
    }),
  );

  const selected = dueOn(assignments, state.selectedDay);
  const selectedLabel = state.selectedDay.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
  return el(
    "div",
    { class: "calendar" },
    el(
      "div",
      { class: "cal-head" },
      button("‹", () => moveMonth(-1), "icon"),
      el(
        "h2",
        {},
        new Date(year, month, 1).toLocaleDateString("en-US", {
          month: "long",
          year: "numeric",
        }),
      ),
      button("›", () => moveMonth(1), "icon"),
      button(
        "Today",
        () => {
          state.calendarMonth = {
            year: today.getFullYear(),
            month: today.getMonth(),
          };
          state.selectedDay = today;
          render();
        },
        "link",
      ),
    ),
    el(
      "div",
      { class: "cal-grid" },
      ...["S", "M", "T", "W", "T", "F", "S"].map((d) =>
        el("span", { class: "cal-weekday" }, d),
      ),
      ...weeks.flat(),
    ),
    el(
      "section",
      { class: "card day-list" },
      el("h3", {}, selectedLabel),
      selected.length === 0
        ? el("p", { class: "muted" }, "Nothing due.")
        : el(
            "ul",
            {},
            ...selected.map((a) =>
              overviewItem(
                a,
                new Date(a.dueAt!).toLocaleTimeString("en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                }),
                { color: colors.get(a.course), showCourse: true },
              ),
            ),
          ),
    ),
  );
}

// ---- History ----

function renderHistory(): Node[] {
  const notice = state.notice && renderNotice(state.notice);
  if (state.loadFailed || !state.assignments) return renderSchedule();
  const history = buildHistory(state.assignments, new Date());
  const header = el("h1", {}, "History");

  if (history.days.length === 0 && history.closedUndated.length === 0) {
    return [
      header,
      el(
        "div",
        { class: "card", style: "margin-top: 16px" },
        el("h2", { style: "margin-top: 0" }, "Nothing here yet"),
        el(
          "p",
          { class: "muted" },
          "When you finish work or log a session on Now, it shows up here, and you can undo it.",
        ),
      ),
    ];
  }

  const time = (date: Date) =>
    date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const row = (
    when: string,
    what: Node | string,
    course: string,
    action: HTMLElement,
  ) =>
    el(
      "li",
      {},
      el("span", { class: "when" }, when),
      el(
        "span",
        { class: "what" },
        what,
        el("br"),
        el("span", { class: "course" }, course || "No course"),
      ),
      action,
    );

  const nodes: Node[] = [
    header,
    el(
      "p",
      { class: "hint muted" },
      `Last 7 days: ${formatMinutes(history.weekMinutes)} of work logged, ${history.weekFinished} finished.`,
    ),
  ];
  if (notice) nodes.push(notice);
  for (const day of history.days) {
    const totals = [
      day.minutes > 0 && formatMinutes(day.minutes),
      day.finished > 0 && `${day.finished} finished`,
    ].filter(Boolean);
    nodes.push(
      el("h2", {}, `${day.label} · ${totals.join(", ")}`),
      el(
        "ul",
        { class: "list" },
        ...day.entries.map((entry) =>
          entry.kind === "finished"
            ? row(
                time(entry.at),
                el("span", {}, tag("Finished"), " ", entry.assignment.name),
                entry.assignment.course,
                button("Reopen", () => void reopen(entry.assignment)),
              )
            : row(
                time(entry.at),
                `${formatMinutes(entry.minutes)} on ${entry.assignment.name}`,
                entry.assignment.course,
                button("Remove", () => void undoWork(entry.sessionId, null)),
              ),
        ),
      ),
    );
  }
  if (history.closedUndated.length > 0) {
    nodes.push(
      el(
        "details",
        {},
        el(
          "summary",
          {},
          `Closed without a date (${history.closedUndated.length}): locked or past due on a course site, or marked done before dates were kept`,
        ),
        el(
          "ul",
          { class: "list" },
          ...history.closedUndated.map((assignment) =>
            row(
              assignment.dueAt ? dateLabel(assignment) : "",
              assignment.name,
              assignment.course,
              button("Reopen", () => void reopen(assignment)),
            ),
          ),
        ),
      ),
    );
  }
  return nodes;
}

// ---- Review ----

function renderReview(drafts: Draft[]): HTMLElement {
  const indexed = drafts.map((draft, index) => ({ draft, index }));
  const kept = indexed.filter(({ draft }) => draft.include);
  const leftOut = indexed.filter(({ draft }) => !draft.include);
  // Questions first, then flagged rows; everything else is collapsed.
  const needsLook = kept
    .filter(({ draft }) => draft.match.kind === "ask" || draft.flag)
    .sort(
      (a, b) =>
        Number(b.draft.match.kind === "ask") -
        Number(a.draft.match.kind === "ask"),
    );
  const fine = kept.filter((row) => !needsLook.includes(row));

  const actions = () => {
    const save = button(
      state.saving ? "Saving…" : `Save ${kept.length}`,
      () => void saveDrafts(),
      "primary",
    );
    save.disabled = state.saving;
    return el(
      "div",
      { class: "actions" },
      save,
      button("Cancel", () => {
        state.drafts = null;
        state.reviewError = null;
        state.openRows.clear();
        render();
      }),
    );
  };

  return el(
    "section",
    { class: "card review", "aria-label": "Review import" },
    el("h2", { style: "margin-top: 0" }, `Review: ${kept.length} to save`),
    el(
      "p",
      { class: "muted" },
      state.reviewSource === "canvas"
        ? "New or changed assignments from your Canvas feed. "
        : state.reviewSource === "page"
          ? "Assignments found in the page you pasted. "
          : "Assignments found in your screenshot. ",
      "Save now, or open any row to fix it. Unticked rows are skipped in later imports too.",
      state.reviewSource !== "canvas" &&
        state.reviewSkipped > 0 &&
        ` Skipped ${state.reviewSkipped} finished or past assignment${state.reviewSkipped === 1 ? "" : "s"}.`,
    ),
    actions(),
    kept.some(({ draft }) => !draft.course.trim()) && renderBulkCourse(drafts),
    needsLook.length > 0 &&
      el("h3", { class: "review-group" }, `Needs a look (${needsLook.length})`),
    ...needsLook.map(({ draft, index }) => renderDraft(draft, index)),
    fine.length > 0 &&
      el("h3", { class: "review-group" }, `Looks fine (${fine.length})`),
    ...fine.map(({ draft, index }) => renderCompactDraft(draft, index)),
    leftOut.length > 0 &&
      el(
        "details",
        {},
        el("summary", {}, `Left out (${leftOut.length})`),
        ...leftOut.map(({ draft, index }) => renderCompactDraft(draft, index)),
      ),
    state.reviewError &&
      el("p", { class: "error-text", role: "alert" }, state.reviewError),
    actions(),
  );
}

function renderBulkCourse(drafts: Draft[]): HTMLElement {
  const input = el("input", {
    type: "text",
    placeholder: "PHYS 211",
    "aria-label": "Course for rows without one",
  });
  input.value = state.bulkCourse;
  input.addEventListener("input", () => {
    state.bulkCourse = input.value;
  });
  return el(
    "div",
    { class: "bulk-course" },
    el("span", { class: "muted" }, "Course for rows without one:"),
    input,
    button("Apply", () => {
      const course = state.bulkCourse.trim();
      if (!course) return;
      for (const draft of drafts) {
        if (!draft.course.trim()) draft.course = course;
      }
      render();
    }),
  );
}

function keepBox(draft: Draft, label: string) {
  const keep = el("input", { type: "checkbox", "aria-label": label });
  keep.checked = draft.include;
  keep.addEventListener("change", () => {
    draft.include = keep.checked;
    render();
  });
  return keep;
}

function matchLabel(draft: Draft): HTMLElement | null {
  const match = draft.match;
  if (match.kind === "ask") return null;
  const changed = match.kind === "same" && match.changes.length > 0;
  return el(
    "span",
    { class: `match${changed ? " changed" : ""}` },
    match.kind === "new" ? "New" : match.changes.join(" · ") || "Already saved",
  );
}

/** A row's one-line summary; opening it shows the full editor. */
function renderCompactDraft(draft: Draft, index: number): HTMLElement {
  const due = draft.dueAt
    ? new Date(draft.dueAt).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "no date";
  const details = el(
    "details",
    {},
    el(
      "summary",
      {},
      el("span", { class: "compact-name" }, draft.name),
      el(
        "span",
        { class: "muted" },
        ` · ${draft.course || "no course"} · ${due} · ${STATUS_LABELS[draft.status]} `,
      ),
      matchLabel(draft),
    ),
    renderFields(draft),
  );
  details.open = state.openRows.has(index);
  details.addEventListener("toggle", () => {
    if (details.open) state.openRows.add(index);
    else state.openRows.delete(index);
  });
  return el(
    "div",
    { class: `review-row compact${draft.include ? "" : " left-out"}` },
    keepBox(draft, `Keep ${draft.name}`),
    details,
  );
}

function renderDraft(draft: Draft, index: number): HTMLElement {
  return el(
    "div",
    { class: `review-row${draft.include ? "" : " left-out"}` },
    el(
      "div",
      { class: "top" },
      el("label", {}, keepBox(draft, `Keep ${draft.name}`), " Keep"),
      draft.flag && tag(draft.flag),
      matchLabel(draft),
    ),
    draft.match.kind === "ask" &&
      renderAsk(draft, draft.match.savedName, index),
    renderFields(draft),
  );
}

function renderFields(draft: Draft): HTMLElement {
  const textField = (
    label: string,
    value: string,
    set: (v: string) => void,
  ) => {
    const input = el("input", { type: "text" });
    input.value = value;
    input.addEventListener("input", () => set(input.value));
    return el("label", {}, label, input);
  };

  const due = el("input", { type: "datetime-local" });
  due.value = draft.dueAt ? toInputValue(draft.dueAt) : "";
  due.addEventListener("change", () => {
    draft.dueAt = due.value ? toLocalIso(new Date(due.value)) : null;
  });

  const status = el(
    "select",
    {},
    ...STATUSES.map((value) => el("option", { value }, STATUS_LABELS[value])),
  );
  status.value = draft.status;
  status.addEventListener("change", () => {
    draft.status = status.value as Status;
  });

  return el(
    "div",
    { class: "fields" },
    textField("Name", draft.name, (v) => (draft.name = v)),
    textField("Course", draft.course, (v) => (draft.course = v)),
    el("label", {}, "Due", due),
    el("label", {}, "Status", status),
  );
}

function renderAsk(draft: Draft, savedName: string, index: number) {
  const option = (value: "same" | "different", label: string) => {
    const radio = el("input", { type: "radio", name: `same-${index}`, value });
    radio.checked = draft.sameAnswer === value;
    radio.addEventListener("change", () => {
      draft.sameAnswer = value;
    });
    return el("label", {}, radio, ` ${label}`);
  };
  return el(
    "div",
    { class: "ask" },
    el("div", {}, `Same assignment as "${savedName}", already saved?`),
    option("same", "Same"),
    option("different", "Different"),
  );
}

// ---- Wiring ----

function render() {
  const pages = {
    now: renderNow,
    plan: renderPlan,
    overview: renderOverview,
    history: renderHistory,
  };
  const requested = location.hash.slice(1);
  const page = requested in pages ? (requested as keyof typeof pages) : "now";
  for (const link of document.querySelectorAll<HTMLAnchorElement>("nav a")) {
    if (link.dataset.page === page) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  app.replaceChildren(...pages[page]());
}

window.addEventListener("hashchange", render);

document.addEventListener("paste", (event) => {
  const file = [...(event.clipboardData?.files ?? [])].find((f) =>
    f.type.startsWith("image/"),
  );
  if (file) {
    event.preventDefault();
    void importFile(file);
  }
});

app.addEventListener("dragover", (event) => {
  event.preventDefault();
  app.classList.add("drop-target");
});
app.addEventListener("dragleave", () => app.classList.remove("drop-target"));
app.addEventListener("drop", (event) => {
  event.preventDefault();
  app.classList.remove("drop-target");
  const file = event.dataTransfer?.files[0];
  if (file) void importFile(file);
});

void loadAssignments();
void loadCanvas();
