import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import sharp from "sharp";
import type { Status } from "../src/assignment.ts";
import {
  describeDue,
  fitImage,
  imageFormat,
  resolveRow,
} from "../src/import-screenshot.ts";

test("recognizes PNG and JPEG screenshots and rejects other files", async () => {
  const screenshot = await readFile("test/fixtures/connect-capitolo5.png");
  assert.equal(imageFormat(screenshot), "png");
  assert.equal(imageFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "jpeg");
  assert.equal(imageFormat(new TextEncoder().encode("GIF89a")), null);
});

// Regression: TypeSafe rejected this 1576-pixel-wide screenshot outright.
test("shrinks screenshots to the size TypeSafe accepts", async () => {
  const screenshot = await readFile("test/fixtures/connect-capitolo5.png");
  const { width, height } = await sharp(await fitImage(screenshot)).metadata();
  assert.ok(width <= 1568 && height <= 1568, `${width}x${height}`);
  assert.equal(width, 1568, "keeps as much detail as allowed");
});

test("writes due dates the way the course page shows them", () => {
  assert.equal(
    describeDue("2026-10-20T23:59:00-05:00"),
    "due Oct 20, 2026 at 11:59 PM",
  );
  assert.equal(describeDue(null), "with no due date shown");
});

const DATED = "2026-10-20T23:59:00-05:00";
const sure = (statusChoice: Status, statusProbability = 0.9) => ({
  dueProbability: 1,
  statusChoice,
  statusProbability,
  totalProbability: 0.1,
});

test("fills in, defers to, or flags the status from TypeSafe's check", () => {
  const task = (status: Status) => ({
    status,
    kind: "task" as const,
    dueAt: DATED,
  });
  // Live Connect run: Claude couldn't tell, TypeSafe was 92% sure it's open.
  assert.deepEqual(resolveRow(task("unknown"), sure("open", 0.92)), {
    status: "open",
    include: true,
    flag: null,
  });
  // TypeSafe unsure defers to Claude instead of flagging.
  assert.equal(resolveRow(task("closed"), sure("open", 0.5)).flag, null);
  assert.equal(
    resolveRow(task("closed"), sure("open")).flag,
    "Check the status",
    "confident contradiction",
  );
  assert.equal(
    resolveRow(task("open"), { ...sure("open"), dueProbability: 0.4 }).flag,
    "Check the date",
  );
});

// Live Canvas run: "Not available until Oct 26" was misread as closed.
test("keeps 'not open yet' apart from closed", () => {
  const row = {
    status: "not_open_yet" as const,
    kind: "task" as const,
    dueAt: DATED,
  };
  assert.deepEqual(resolveRow(row, sure("not_open_yet")), {
    status: "not_open_yet",
    include: true,
    flag: null,
  });
});

// Live Canvas run: "Chapter 1" and "Participation" are grade totals, not tasks.
test("leaves out grade totals, and flags rows the models disagree on", () => {
  const total = {
    status: "closed" as const,
    kind: "grade_total" as const,
    dueAt: null,
  };
  const both = resolveRow(total, { ...sure("closed"), totalProbability: 0.9 });
  assert.equal(both.include, false);
  const onlyClaude = resolveRow(total, sure("closed"));
  assert.deepEqual(
    [onlyClaude.include, onlyClaude.flag],
    [false, "Might be a grade total"],
  );
});

test("asks for a date on undated work that isn't finished", () => {
  const exam = {
    status: "unknown" as const,
    kind: "task" as const,
    dueAt: null,
  };
  assert.equal(resolveRow(exam, sure("unknown", 0.5)).flag, "Needs a date");
  const doneQuiz = {
    status: "closed" as const,
    kind: "task" as const,
    dueAt: null,
  };
  assert.equal(resolveRow(doneQuiz, sure("closed")).flag, null);
});
