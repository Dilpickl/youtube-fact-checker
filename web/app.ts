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
  importing: false,
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

async function importFile(file: File) {
  if (state.drafts) {
    state.notice = {
      text: "Save or cancel the import you're reviewing first.",
      kind: "error",
    };
    return render();
  }
  if (state.importing) return;
  if (file.type !== "image/png" && file.type !== "image/jpeg") {
    state.notice = {
      text: "That isn't a PNG or JPEG image. Take a screenshot and try again.",
      kind: "error",
    };
    return render();
  }
  if (location.hash !== "#plan") location.hash = "#plan";
  state.importing = true;
  state.notice = null;
  render();
  try {
    const { rows } = await api<{ rows: ReviewRow[] }>("/api/import", {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    });
    if (rows.length === 0) {
      state.notice = {
        text: "No assignments found in that screenshot. Try one that shows assignment names and due dates.",
        kind: "error",
      };
    } else {
      state.drafts = rows.map((row) => ({ ...row, sameAnswer: null }));
      state.reviewError = null;
    }
  } catch (error) {
    state.notice = { text: messageOf(error), kind: "error" };
  } finally {
    state.importing = false;
    render();
  }
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
    state.importing ? "Reading…" : "Add screenshot",
    () => fileInput.click(),
    "primary",
  );
  add.disabled = state.importing || state.drafts !== null;

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
            : "Add a screenshot of any course page, or paste one with Ctrl+V.",
        ),
      ),
      el("div", {}, add, fileInput),
    ),
    state.importing &&
      el(
        "p",
        { class: "notice", role: "status" },
        "Reading your screenshot. This takes about 20 seconds…",
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
  const kept = drafts.filter((draft) => draft.include);
  const leftOut = drafts.filter((draft) => !draft.include);
  const save = button(
    state.saving ? "Saving…" : "Save",
    () => void saveDrafts(),
    "primary",
  );
  save.disabled = state.saving;
  return el(
    "section",
    { class: "card review", "aria-label": "Review import" },
    el("h2", { style: "margin-top: 0" }, `Review: ${kept.length} to save`),
    el(
      "p",
      { class: "muted" },
      "Fix anything that's wrong. Untick rows you don't want, like grade totals; later imports will skip them too.",
    ),
    ...kept.map((draft) => renderDraft(draft, drafts.indexOf(draft))),
    leftOut.length > 0 && el("h2", {}, `Left out (${leftOut.length})`),
    ...leftOut.map((draft) => renderDraft(draft, drafts.indexOf(draft))),
    state.reviewError &&
      el("p", { class: "error-text", role: "alert" }, state.reviewError),
    el(
      "div",
      { class: "actions" },
      save,
      button("Cancel", () => {
        state.drafts = null;
        state.reviewError = null;
        render();
      }),
    ),
  );
}

function renderDraft(draft: Draft, index: number): HTMLElement {
  const keep = el("input", { type: "checkbox" });
  keep.checked = draft.include;
  keep.addEventListener("change", () => {
    draft.include = keep.checked;
    render();
  });

  const match = draft.match;
  const matchText =
    match.kind === "new"
      ? "New"
      : match.kind === "same"
        ? match.changes.join(" · ") || "Already saved"
        : null;

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
    { class: `review-row${draft.include ? "" : " left-out"}` },
    el(
      "div",
      { class: "top" },
      el("label", {}, keep, " Keep"),
      draft.flag && tag(draft.flag),
      matchText &&
        el(
          "span",
          {
            class: `match${match.kind === "same" && match.changes.length ? " changed" : ""}`,
          },
          matchText,
        ),
    ),
    match.kind === "ask" && renderAsk(draft, match.savedName, index),
    el(
      "div",
      { class: "fields" },
      textField("Name", draft.name, (v) => (draft.name = v)),
      textField("Course", draft.course, (v) => (draft.course = v)),
      el("label", {}, "Due", due),
      el("label", {}, "Status", status),
    ),
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
  const page =
    location.hash === "#plan"
      ? "plan"
      : location.hash === "#history"
        ? "history"
        : "now";
  for (const link of document.querySelectorAll<HTMLAnchorElement>("nav a")) {
    if (link.dataset.page === page) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  const pages = { now: renderNow, plan: renderPlan, history: renderHistory };
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
