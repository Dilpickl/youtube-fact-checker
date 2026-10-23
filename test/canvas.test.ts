import assert from "node:assert/strict";
import test from "node:test";
import type { ReviewRow } from "../src/assignment.ts";
import {
  dueAtOf,
  feedRows,
  feedUrlProblem,
  newOrChanged,
  parseFeed,
  splitSummary,
} from "../src/canvas.ts";

// Shaped like a Canvas user calendar feed (made-up ids), with a folded line,
// an escaped comma, a non-assignment event, and a past assignment.
const feed = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:event-assignment-1001",
  "DTSTART:20261024T045900Z",
  "SUMMARY:Discussione 4: La dieta mediterranea [ITAL 101 1 FA26]",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:event-assignment-1002",
  "DTSTART:20261114T055900Z",
  "SUMMARY:Voice Board 7: Il mio weekend\\, part 2 [ITAL 101 1 F",
  " A26]",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:event-calendar-event-77",
  "DTSTART:20261023T150000Z",
  "SUMMARY:Office hours [PHYS 110]",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:event-assignment-900",
  "DTSTART:20261001T045900Z",
  "SUMMARY:Old homework [PHYS 110]",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const now = new Date("2026-10-22T23:00:00-05:00");

test("reads upcoming assignments with names, courses, and local due times", () => {
  const rows = feedRows(parseFeed(feed), now);
  assert.deepEqual(
    rows.map((row) => [row.name, row.course, row.dueAt]),
    [
      [
        "Discussione 4: La dieta mediterranea",
        "ITAL 101",
        "2026-10-23T23:59:00-05:00",
      ],
      // After daylight saving ends, 05:59 UTC is still 11:59 PM in Illinois.
      [
        "Voice Board 7: Il mio weekend, part 2",
        "ITAL 101",
        "2026-11-13T23:59:00-06:00",
      ],
    ],
    "office hours and past work are left out",
  );
});

test("handles dates with no time and times in a named zone", () => {
  const event = { uid: "x", summary: "x", startZone: null };
  assert.equal(
    dueAtOf({ ...event, start: "20261204" }, "America/Chicago"),
    "2026-12-04T23:59:00-06:00",
  );
  assert.equal(
    dueAtOf(
      { ...event, start: "20261204T235500", startZone: "America/Chicago" },
      "America/Chicago",
    ),
    "2026-12-04T23:55:00-06:00",
  );
  assert.equal(dueAtOf({ ...event, start: "next Tuesday" }), null);
});

// Dylan's real feed names courses like "ital_101_120268_264325"; reading them
// as is saved every Italian assignment a second time under a new course name.
test("pulls a course code out of the bracketed course name", () => {
  assert.deepEqual(splitSummary("Voice Board 5 [ital_101_120268_264325]"), {
    name: "Voice Board 5",
    course: "ITAL 101",
  });
  assert.equal(
    splitSummary("Essay 2 [eng_100_120268_265701]").course,
    "ENG 100",
  );
  assert.equal(
    splitSummary("Orientation [citl_citl_open_260025]").course,
    "citl_citl_open_260025",
    "no code, kept as is",
  );
  assert.deepEqual(splitSummary("Lab 3 [PHYS110 Spring]"), {
    name: "Lab 3",
    course: "PHYS 110",
  });
  assert.deepEqual(splitSummary("Essay [Rhetoric and Writing]"), {
    name: "Essay",
    course: "Rhetoric and Writing",
  });
  assert.deepEqual(splitSummary("No course here"), {
    name: "No course here",
    course: "",
  });
});

test("only asks about new or changed rows, and opens the new ones", () => {
  const row = (match: ReviewRow["match"]): ReviewRow => ({
    name: "x",
    course: "ITAL 101",
    dueAt: null,
    status: "unknown",
    include: true,
    flag: null,
    match,
  });
  const result = newOrChanged([
    row({ kind: "new" }),
    row({ kind: "same", id: 1, changes: [] }),
    row({ kind: "same", id: 2, changes: ["Due Oct 23 → Oct 25"] }),
  ]);
  assert.deepEqual(
    result.map((r) => [r.match.kind, r.status]),
    [
      ["new", "open"],
      ["same", "unknown"],
    ],
  );
});

test("explains what's wrong with a pasted link", () => {
  assert.equal(
    feedUrlProblem(
      "https://canvas.illinois.edu/feeds/calendars/user_abc123.ics",
    ),
    null,
  );
  assert.match(feedUrlProblem("canvas")!, /isn't a link/);
  assert.match(
    feedUrlProblem("http://canvas.illinois.edu/feeds/calendars/user_a.ics")!,
    /https/,
  );
  assert.match(
    feedUrlProblem("https://canvas.illinois.edu/courses/72857")!,
    /Calendar Feed/,
  );
});
