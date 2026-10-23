import assert from "node:assert/strict";
import test from "node:test";
import type { SavedAssignment } from "../src/assignment.ts";
import type { CheckedAssignment } from "../src/import-screenshot.ts";
import {
  normalizeName,
  reviewImport,
  type GuessCourse,
  type Judges,
  type JudgeSame,
  withoutFinishedNew,
} from "../src/match.ts";

const imported = (
  overrides: Partial<CheckedAssignment>,
): CheckedAssignment => ({
  name: "Strutture III- 5",
  course: "ITAL 101",
  dueAt: "2026-10-20T23:59:00-05:00",
  status: "open",
  include: true,
  flag: null,
  dueProbability: 1,
  statusChoice: "open",
  statusProbability: 0.9,
  totalProbability: 0.05,
  ...overrides,
});

const saved = (overrides: Partial<SavedAssignment>): SavedAssignment => ({
  id: 1,
  name: "Strutture III- 5",
  course: "ITAL 101",
  dueAt: "2026-10-20T23:59:00-05:00",
  status: "open",
  aliases: [],
  ignored: false,
  estimateMinutes: null,
  closedAt: null,
  sessions: [],
  ...overrides,
});

const neverAsked: JudgeSame = async () => {
  throw new Error("TypeSafe shouldn't be needed here");
};
const neverGuessed: GuessCourse = async () => {
  throw new Error("No course guess should be needed here");
};
const judges = (
  same: JudgeSame = neverAsked,
  course: GuessCourse = neverGuessed,
): Judges => ({ same, course });
const judgeSays =
  (probability: number): JudgeSame =>
  async (pairs) =>
    pairs.map(() => probability);

test("ignores spacing, case, and accents when comparing names", () => {
  assert.equal(
    normalizeName("Strutture III- 5"),
    normalizeName("strutture iii-5"),
  );
  assert.equal(
    normalizeName("Le mie attività"),
    normalizeName("Le mie attivita"),
  );
});

test("the same screenshot imported twice matches instead of duplicating", async () => {
  const [row] = await reviewImport([imported({})], [saved({})], judges());
  assert.deepEqual(row.match, { kind: "same", id: 1, changes: [] });
});

// Live Canvas screenshots: the second one repeats rows but shows no course.
test("a row without a course matches the saved one and keeps its course", async () => {
  const [row] = await reviewImport(
    [imported({ course: "" })],
    [saved({})],
    judges(),
  );
  assert.equal(row.match.kind, "same");
  assert.equal(row.course, "ITAL 101");
});

test("reports a changed due date or status in words", async () => {
  const [row] = await reviewImport(
    [imported({ dueAt: "2026-10-23T23:59:00-05:00", status: "closed" })],
    [saved({})],
    judges(),
  );
  assert.deepEqual(row.match, {
    kind: "same",
    id: 1,
    changes: ["Due Oct 20 → Oct 23", "Open → Closed"],
  });
});

test("differently named rows merge, ask, or stay new by TypeSafe's answer", async () => {
  const canvasRow = [imported({ name: "Connect: Strutture III" })];
  const savedRow = [saved({})];
  const [merged] = await reviewImport(
    canvasRow,
    savedRow,
    judges(judgeSays(0.95)),
  );
  assert.equal(merged.match.kind, "same");
  const [asked] = await reviewImport(
    canvasRow,
    savedRow,
    judges(judgeSays(0.5)),
  );
  assert.deepEqual(asked.match, {
    kind: "ask",
    id: 1,
    savedName: "Strutture III- 5",
  });
  const [separate] = await reviewImport(
    canvasRow,
    savedRow,
    judges(judgeSays(0.1)),
  );
  assert.equal(separate.match.kind, "new");
});

test("only rows due within a day of each other are compared", async () => {
  const [row] = await reviewImport(
    [imported({ name: "Discussione 4", dueAt: "2026-10-30T23:59:00-05:00" })],
    [saved({})],
    judges(),
  );
  assert.equal(row.match.kind, "new");
});

test("an assignment left out before stays left out", async () => {
  const [row] = await reviewImport(
    [imported({ name: "Chapter 1", flag: "Might be a grade total" })],
    [saved({ name: "Chapter 1", ignored: true })],
    judges(),
  );
  assert.deepEqual([row.include, row.flag], [false, null]);
});

// Dylan's cropped Canvas screenshot showed no course on any row.
test("a page's one course fills its rows that didn't show it", async () => {
  const rows = await reviewImport(
    [
      imported({ name: "Voice Board 7" }),
      imported({ name: "Quiz", course: "" }),
    ],
    [],
    judges(),
  );
  assert.deepEqual(
    rows.map((row) => row.course),
    ["ITAL 101", "ITAL 101"],
  );
});

test("with no course on the page, TypeSafe picks among saved courses", async () => {
  let offered: string[] = [];
  const guess: GuessCourse = async (rows, courses) => {
    offered = courses.map((entry) => entry.course);
    return rows.map((row) =>
      row.name.startsWith("Voice") ? "ITAL 101" : null,
    );
  };
  const rows = await reviewImport(
    [
      imported({ name: "Voice Board 7", course: "", dueAt: null }),
      imported({ name: "Lab 3", course: "", dueAt: null }),
    ],
    [saved({}), saved({ id: 2, name: "MP1", course: "CS 124" })],
    judges(neverAsked, guess),
  );
  assert.deepEqual(offered, ["ITAL 101", "CS 124"]);
  assert.deepEqual(
    rows.map((row) => row.course),
    ["ITAL 101", ""],
    "an unsure guess stays blank",
  );
});

// The duplicate Dylan got: the same assignment under Canvas's course code.
test("the same course spelled differently still matches", async () => {
  const [row] = await reviewImport(
    [imported({ course: "ital_101_120268_264325" })],
    [saved({})],
    judges(),
  );
  assert.equal(row.match.kind, "same");
});

// Pasting Canvas text showed "Closed → Open" for work Dylan had finished,
// because the page still said "Available until Oct 23".
test("an import never reopens work the student marked done", async () => {
  const finished = saved({
    status: "closed",
    closedAt: "2026-10-22T22:00:00.000Z",
  });
  const [row] = await reviewImport(
    [imported({ status: "open" })],
    [finished],
    judges(),
  );
  assert.equal(row.status, "closed");
  assert.deepEqual(row.match, { kind: "same", id: 1, changes: [] });

  // Closed by the site (no done time): a site saying it's open again wins.
  const locked = saved({ status: "closed" });
  const [reopened] = await reviewImport(
    [imported({ status: "open" })],
    [locked],
    judges(),
  );
  assert.equal(reopened.status, "open");
});

// Dylan was asked whether "HW6 Week 6" was the same as "Chapter 1", a left-out
// Italian grade total with no course or date.
test("never asks about left-out or undated rows", async () => {
  const rows = await reviewImport(
    [
      imported({ name: "HW6 Week 6", course: "MATH 257", dueAt: null }),
      imported({ name: "Quiz 9", course: "MATH 257" }),
    ],
    [
      saved({ name: "Chapter 1", course: "", dueAt: null, ignored: true }),
      saved({ id: 2, name: "Old quiz", course: "", ignored: true }),
    ],
    judges(),
  );
  assert.deepEqual(
    rows.map((row) => row.match.kind),
    ["new", "new"],
  );
});

// Dylan's pasted ENG 100 page showed "eng_100", which would have renamed the
// saved "ENG 100" assignments on save.
test("writes every imported course as its code", async () => {
  const [row] = await reviewImport(
    [imported({ name: "A&P Class 17", course: "eng_100" })],
    [saved({ name: "A&P Class 17", course: "ENG 100" })],
    judges(),
  );
  assert.equal(row.course, "ENG 100");
  assert.equal(row.match.kind, "same");
});

// The same page brought in 22 past, closed assignments as new.
test("skips new rows that are already finished, but keeps updates", async () => {
  const rows = await reviewImport(
    [
      imported({
        name: "A&P Class 13",
        status: "closed",
        dueAt: "2026-10-01T23:59:00-05:00",
      }),
      imported({ name: "Strutture III- 5", status: "closed" }),
      imported({
        name: "GP1",
        status: "open",
        dueAt: "2026-10-30T23:59:00-05:00",
      }),
    ],
    [saved({})],
    judges(),
  );
  const result = withoutFinishedNew(rows);
  assert.equal(result.skipped, 1);
  assert.deepEqual(
    result.rows.map((row) => [row.name, row.match.kind]),
    [
      ["Strutture III- 5", "same"],
      ["GP1", "new"],
    ],
  );
});
