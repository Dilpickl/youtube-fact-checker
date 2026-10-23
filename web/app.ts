// The website: a Now page (picking the next task arrives in milestone 3) and
// a Plan page that lays everything out by day and imports screenshots.
import {
  STATUS_LABELS,
  STATUSES,
  type ReviewRow,
  type SaveRow,
  type SavedAssignment,
  type Status,
} from "../src/assignment.ts";
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
    throw new Error("Couldn't reach the server. Check that it's running.");
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

const reopen = (assignment: SavedAssignment) =>
  setStatus(assignment, "open", backOnPlan(assignment));

// ---- Pages ----

function renderNow(): Node[] {
  return [
    el(
      "div",
      { class: "card" },
      el("h1", {}, "What now?"),
      el(
        "p",
        { class: "muted" },
        "Soon this page will pick the one thing to do next, with a reason and a time to start. Until then, your Plan shows everything that's due.",
      ),
      el("a", { class: "button primary", href: "#plan" }, "Open your Plan"),
    ),
  ];
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
        "details",
        {},
        el("summary", {}, `Done (${plan.done.length})`),
        list(plan.done, (a) => (a.dueAt ? dateLabel(a) : ""), "reopen"),
      ),
    );
  }
  return nodes;
}

function list(
  items: SavedAssignment[],
  when: (assignment: SavedAssignment) => string,
  action: "done" | "reopen" = "done",
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
        action === "done"
          ? button("Mark done", () => void markDone(assignment))
          : button("Reopen", () => void reopen(assignment)),
      ),
    ),
  );
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
  const page = location.hash === "#plan" ? "plan" : "now";
  for (const link of document.querySelectorAll<HTMLAnchorElement>("nav a")) {
    if (link.dataset.page === page) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  app.replaceChildren(...(page === "now" ? renderNow() : renderPlan()));
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
