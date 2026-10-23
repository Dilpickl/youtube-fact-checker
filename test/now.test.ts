import assert from "node:assert/strict";
import test from "node:test";
import type {
  SavedAssignment,
  Status,
  WorkSession,
} from "../src/assignment.ts";
import { buildSchedule, describePace, smallerItem } from "../src/now.ts";

// Thursday Oct 22, 2026, 10:40 pm in whatever time zone the tests run in.
const now = new Date(2026, 9, 22, 22, 40);
let nextId = 1;
const task = (
  name: string,
  due: Date | null,
  estimateMinutes: number | null,
  options: { status?: Status; sessions?: WorkSession[] } = {},
): SavedAssignment => ({
  id: nextId++,
  name,
  course: "PHYS 110",
  dueAt: due && due.toISOString(),
  status: options.status ?? "open",
  aliases: [],
  ignored: false,
  estimateMinutes,
  sessions: options.sessions ?? [],
});

// Dylan's open work on Oct 22: about 4 hours, all due Dec 11.
const dec11 = new Date(2026, 11, 11, 23, 59);
const fourYearPlan = task("Four-year academic plan", dec11, 154);
const activities = task("Out-of-class activities", dec11, 43);
const labSafety = task("Lab safety training", dec11, 34);
const dylansWork = [activities, labSafety, fourYearPlan];

const summary = (assignments: SavedAssignment[], at = now) =>
  buildSchedule(assignments, at).items.map(
    (item) => `${item.tier}: ${item.assignment.name} (${item.minutes} min)`,
  );

test("with nothing due soon, today's share is one session of the earliest-planned task", () => {
  const schedule = buildSchedule(dylansWork, now);
  assert.equal(schedule.pace, 5, "231 min over the 50 days to Dec 10");
  assert.deepEqual(summary(dylansWork), [
    "today: Four-year academic plan (25 min)",
    "ahead: Out-of-class activities (43 min)",
    "ahead: Lab safety training (34 min)",
  ]);
  const [first] = schedule.items;
  assert.equal(first.remaining, 154);
  // Big task: finishes two days early, by Dec 9.
  assert.ok(first.plannedFinish <= new Date(2026, 11, 9));
});

test("after today's share is done, everything left is getting ahead", () => {
  const worked = task("Four-year academic plan", dec11, 154, {
    sessions: [
      { id: 1, minutes: 25, at: new Date(2026, 9, 22, 22, 0).toISOString() },
    ],
  });
  const schedule = buildSchedule([activities, labSafety, worked], now);
  assert.equal(schedule.doneToday, 25);
  assert.equal(schedule.pace, 5, "the pace doesn't drop as you work");
  assert.ok(schedule.items.every((item) => item.tier === "ahead"));
  const plan = schedule.items.find((item) => item.assignment === worked)!;
  assert.equal(plan.remaining, 129);
});

test("something due tomorrow jumps to the top", () => {
  const quiz = task("Quiz 7", new Date(2026, 9, 23, 23, 59), 20);
  assert.deepEqual(summary([...dylansWork, quiz]).slice(0, 2), [
    "due-soon: Quiz 7 (20 min)",
    "today: Four-year academic plan (25 min)",
  ]);
});

test("a pile-up of deadlines raises the pace and pulls work earlier", () => {
  const essay = task("Essay", new Date(2026, 9, 26, 23, 59), 120);
  const project = task("Project", new Date(2026, 9, 26, 23, 59), 120);
  const schedule = buildSchedule([essay, project], now);
  // 240 min must be done by Oct 24: three days starting today.
  assert.equal(schedule.pace, 80);
  assert.equal(schedule.items[0].tier, "today");
  assert.equal(schedule.items[0].minutes, 60, "sessions top out at an hour");
});

test("leaves out work that can't be done now; short tasks stay whole", () => {
  const items = summary([
    task("Discussione 5", dec11, 25, { status: "not_open_yet" }),
    task("Voice Board 5", dec11, 20, { status: "closed" }),
    task("Strutture III", new Date(2026, 9, 20, 23, 59), 30),
    task("Midterm Exam", null, 360),
    labSafety,
  ]);
  assert.deepEqual(items, ["today: Lab safety training (34 min)"]);
});

test("'Too tired?' finds a shorter session, or nothing if this is the shortest", () => {
  const { items } = buildSchedule(
    [...dylansWork, task("Quiz 7", new Date(2026, 9, 23, 23, 59), 20)],
    now,
  );
  const quiz = items[0];
  const plan = items[1];
  assert.equal(smallerItem(items, plan), quiz);
  assert.equal(smallerItem(items, quiz), null);
});

test("describes a slow pace as a session every few days", () => {
  assert.equal(
    describePace(5),
    "About 25 min every 5 days keeps everything on time.",
  );
  assert.equal(
    describePace(40),
    "About 40 min a day keeps everything on time.",
  );
  assert.equal(describePace(0), null);
});
