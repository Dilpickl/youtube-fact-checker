import assert from "node:assert/strict";
import test from "node:test";
import type { SavedAssignment } from "../src/assignment.ts";
import type { CheckedAssignment } from "../src/import-screenshot.ts";
import { normalizeName, reviewImport, type JudgeSame } from "../src/match.ts";

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
  ...overrides,
});

const neverAsked: JudgeSame = async () => {
  throw new Error("TypeSafe shouldn't be needed here");
};
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
  const [row] = await reviewImport([imported({})], [saved({})], neverAsked);
  assert.deepEqual(row.match, { kind: "same", id: 1, changes: [] });
});

// Live Canvas screenshots: the second one repeats rows but shows no course.
test("a row without a course matches the saved one and keeps its course", async () => {
  const [row] = await reviewImport(
    [imported({ course: "" })],
    [saved({})],
    neverAsked,
  );
  assert.equal(row.match.kind, "same");
  assert.equal(row.course, "ITAL 101");
});

test("reports a changed due date or status in words", async () => {
  const [row] = await reviewImport(
    [imported({ dueAt: "2026-10-23T23:59:00-05:00", status: "closed" })],
    [saved({})],
    neverAsked,
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
  const [merged] = await reviewImport(canvasRow, savedRow, judgeSays(0.95));
  assert.equal(merged.match.kind, "same");
  const [asked] = await reviewImport(canvasRow, savedRow, judgeSays(0.5));
  assert.deepEqual(asked.match, {
    kind: "ask",
    id: 1,
    savedName: "Strutture III- 5",
  });
  const [separate] = await reviewImport(canvasRow, savedRow, judgeSays(0.1));
  assert.equal(separate.match.kind, "new");
});

test("only rows due within a day of each other are compared", async () => {
  const [row] = await reviewImport(
    [imported({ name: "Discussione 4", dueAt: "2026-10-30T23:59:00-05:00" })],
    [saved({})],
    neverAsked,
  );
  assert.equal(row.match.kind, "new");
});

test("an assignment left out before stays left out", async () => {
  const [row] = await reviewImport(
    [imported({ name: "Chapter 1", flag: "Might be a grade total" })],
    [saved({ name: "Chapter 1", ignored: true })],
    neverAsked,
  );
  assert.deepEqual([row.include, row.flag], [false, null]);
});
