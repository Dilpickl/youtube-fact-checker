import assert from "node:assert/strict";
import test from "node:test";
import type { SavedAssignment, Status } from "../src/assignment.ts";
import { buildPlan } from "../src/plan.ts";

// Wednesday Oct 21, 2026, 10 am in whatever time zone the tests run in.
const now = new Date(2026, 9, 21, 10, 0);
let nextId = 1;
const due = (
  name: string,
  date: Date | null,
  status: Status = "open",
  ignored = false,
): SavedAssignment => ({
  id: nextId++,
  name,
  course: "ITAL 101",
  dueAt: date && date.toISOString(),
  status,
  aliases: [],
  ignored,
  estimateMinutes: null,
  sessions: [],
});

test("lays assignments out by day, with done and undated work apart", () => {
  const plan = buildPlan(
    [
      due("Voice Board 5", new Date(2026, 9, 23, 23, 59)),
      due("Cultura", new Date(2026, 9, 21, 23, 59)),
      due("Strutture III", new Date(2026, 9, 20, 23, 59)),
      due("Discussione 4", new Date(2026, 9, 22, 23, 59)),
      due("Writing Assignment 2", new Date(2026, 11, 4, 23, 55)),
      due("Midterm Exam", null),
      due("Strutture II", new Date(2026, 9, 19, 23, 59), "closed"),
      due("Chapter 1", null, "closed", true),
    ],
    now,
  );
  const names = (items: SavedAssignment[]) => items.map((a) => a.name);
  assert.deepEqual(names(plan.pastDue), ["Strutture III"]);
  assert.deepEqual(names(plan.today), ["Cultura"]);
  assert.deepEqual(
    plan.thisWeek.map((day) => [day.label, names(day.items)]),
    [
      ["Tomorrow", ["Discussione 4"]],
      ["Friday, Oct 23", ["Voice Board 5"]],
    ],
  );
  assert.deepEqual(names(plan.later), ["Writing Assignment 2"]);
  assert.deepEqual(names(plan.needsDate), ["Midterm Exam"]);
  assert.deepEqual(names(plan.done), ["Strutture II"], "left-out rows hidden");
});

test("an empty plan has nothing in any section", () => {
  const plan = buildPlan([], now);
  assert.equal(Object.values(plan).flat().length, 0);
});
