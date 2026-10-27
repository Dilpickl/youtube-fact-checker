import assert from "node:assert/strict";
import test from "node:test";
import type { SavedAssignment, Status } from "../src/assignment.ts";
import {
  courseColors,
  courseStatus,
  dueOn,
  matchesQuery,
  monthGrid,
  summarizeCourses,
} from "../src/overview.ts";

// Friday Oct 23, 2026, 9 am in whatever time zone the tests run in.
const now = new Date(2026, 9, 23, 9, 0);
let nextId = 1;
const work = (
  name: string,
  course: string,
  due: Date | null,
  status: Status = "open",
  ignored = false,
): SavedAssignment => ({
  id: nextId++,
  name,
  course,
  dueAt: due && due.toISOString(),
  status,
  aliases: [],
  ignored,
  estimateMinutes: null,
  closedAt: null,
  sessions: [],
});

const assignments = [
  work("A09: Departmental", "ENG 100", new Date(2026, 9, 27, 23, 59)),
  work("GP1: Check-in", "ENG 100", new Date(2026, 9, 25, 23, 59)),
  work("A08: Resume", "ENG 100", new Date(2026, 10, 1, 23, 59)),
  work("A06: Draft", "ENG 100", new Date(2026, 8, 27, 23, 59), "closed"),
  work("Prelab 8", "PHYS 211", new Date(2026, 9, 28, 7, 0)),
  work("17. Homework", "PHYS 211", new Date(2026, 9, 22, 8, 0)),
  work(
    "Discussione 5",
    "ITAL 101",
    new Date(2026, 9, 30, 23, 59),
    "not_open_yet",
  ),
  work("Midterm Exam", "ITAL 101", null),
  work("Chapter 1", "", null, "closed", true),
];

test("summarizes each course: overdue first, then soonest due", () => {
  const summaries = summarizeCourses(assignments, now);
  assert.deepEqual(
    summaries.map((s) => [
      s.course,
      s.upcoming.map((a) => a.name),
      s.overdue.length,
      s.undated.length,
      courseStatus(s).text,
    ]),
    [
      ["PHYS 211", ["Prelab 8"], 1, 0, "1 overdue"],
      [
        "ENG 100",
        ["GP1: Check-in", "A09: Departmental", "A08: Resume"],
        0,
        0,
        "2 due this week",
      ],
      ["ITAL 101", ["Discussione 5"], 0, 1, "Nothing due this week"],
    ],
    "finished and left-out work stays out",
  );
});

test("gives each course one color, and no course gray", () => {
  const colors = courseColors(assignments);
  assert.notEqual(colors.get("ENG 100"), colors.get("PHYS 211"));
  assert.equal(colors.get(""), "#888780");
  // Colors follow the course everywhere, including its summary card.
  const [phys] = summarizeCourses(assignments, now);
  assert.equal(phys.color, colors.get("PHYS 211"));
});

test("lays out October 2026 as weeks starting on Sunday", () => {
  const weeks = monthGrid(2026, 9);
  assert.equal(weeks.length, 5);
  assert.deepEqual(
    weeks[0].map((d) => d?.getDate() ?? null),
    [null, null, null, null, 1, 2, 3],
  );
  assert.equal(weeks.at(-1)!.at(-1)?.getDate(), 31, "Oct 31 is a Saturday");
  assert.deepEqual(
    monthGrid(2026, 10)
      .at(-1)!
      .map((d) => d?.getDate() ?? null),
    [29, 30, null, null, null, null, null],
    "November ends on a Monday, padded to the week",
  );
});

test("lists what's due on a day, earliest first", () => {
  assert.deepEqual(
    dueOn(assignments, new Date(2026, 9, 27)).map((a) => a.name),
    ["A09: Departmental"],
  );
  assert.deepEqual(
    dueOn(assignments, new Date(2026, 8, 27)),
    [],
    "done work hidden",
  );
});

test("search finds assignments by name or course, ignoring case and accents", () => {
  const find = (query: string) =>
    assignments.filter((a) => matchesQuery(a, query)).map((a) => a.name);
  assert.deepEqual(find("prelab"), ["Prelab 8"]);
  assert.deepEqual(find("phys 211"), ["Prelab 8", "17. Homework"]);
  assert.deepEqual(find("DISCUSSIONE"), ["Discussione 5"]);
  assert.equal(find("  ").length, assignments.length, "blank shows everything");
});
