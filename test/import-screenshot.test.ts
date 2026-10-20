import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import sharp from "sharp";
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

test("fills in, defers, or flags the status from TypeSafe's check", () => {
  const row = (
    status: "open" | "closed" | "unknown",
    due: number,
    open: number,
  ) => resolveRow(status, due, open);
  // From the live Connect run: Claude couldn't tell, TypeSafe was 91% sure it's open.
  assert.deepEqual(row("unknown", 1, 0.91), {
    status: "open",
    needsCheck: false,
  });
  // TypeSafe unsure (near 50%) defers to Claude instead of flagging.
  assert.deepEqual(row("closed", 1, 0.48), {
    status: "closed",
    needsCheck: false,
  });
  assert.equal(
    row("closed", 1, 0.9).needsCheck,
    true,
    "confident contradiction",
  );
  assert.equal(row("open", 0.4, 0.9).needsCheck, true, "doubtful due date");
  assert.equal(row("unknown", 1, 0.5).needsCheck, true, "neither can tell");
});
