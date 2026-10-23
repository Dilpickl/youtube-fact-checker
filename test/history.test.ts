import assert from "node:assert/strict";
import test from "node:test";
import type { SavedAssignment, WorkSession } from "../src/assignment.ts";
import { buildHistory, formatMinutes } from "../src/history.ts";

// Thursday Oct 22, 2026, 11 pm in whatever time zone the tests run in.
const now = new Date(2026, 9, 22, 23, 0);
let nextId = 1;
const assignment = (
  name: string,
  options: {
    closedAt?: Date;
    status?: SavedAssignment["status"];
    sessions?: WorkSession[];
    ignored?: boolean;
  } = {},
): SavedAssignment => ({
  id: nextId++,
  name,
  course: "ITAL 101",
  dueAt: null,
  status: options.status ?? (options.closedAt ? "closed" : "open"),
  aliases: [],
  ignored: options.ignored ?? false,
  estimateMinutes: 30,
  closedAt: options.closedAt?.toISOString() ?? null,
  sessions: options.sessions ?? [],
});
const session = (id: number, minutes: number, at: Date): WorkSession => ({
  id,
  minutes,
  at: at.toISOString(),
});

test("groups finished work and sessions by day, newest first, with totals", () => {
  const history = buildHistory(
    [
      assignment("Discussione 4", { closedAt: new Date(2026, 9, 22, 21, 0) }),
      assignment("Four-year plan", {
        sessions: [
          session(1, 25, new Date(2026, 9, 22, 22, 0)),
          session(2, 30, new Date(2026, 9, 21, 20, 0)),
        ],
      }),
      assignment("Old quiz", { closedAt: new Date(2026, 9, 10, 12, 0) }),
    ],
    now,
  );
  assert.deepEqual(
    history.days.map((day) => [
      day.label,
      day.entries.map((e) => `${e.kind} ${e.assignment.name}`),
      day.minutes,
      day.finished,
    ]),
    [
      ["Today", ["session Four-year plan", "finished Discussione 4"], 25, 1],
      ["Yesterday", ["session Four-year plan"], 30, 0],
      ["Saturday, Oct 10", ["finished Old quiz"], 0, 1],
    ],
  );
  assert.equal(history.weekMinutes, 55);
  assert.equal(history.weekFinished, 1, "Oct 10 is more than a week ago");
});

test("keeps closed work with no date apart, and hides left-out rows", () => {
  const history = buildHistory(
    [
      assignment("Strutture II", { status: "closed" }),
      assignment("Chapter 1", { status: "closed", ignored: true }),
    ],
    now,
  );
  assert.deepEqual(history.days, []);
  assert.deepEqual(
    history.closedUndated.map((a) => a.name),
    ["Strutture II"],
  );
});

test("formats minutes as hours and minutes", () => {
  assert.equal(formatMinutes(40), "40 min");
  assert.equal(formatMinutes(120), "2 h");
  assert.equal(formatMinutes(135), "2 h 15 min");
});
