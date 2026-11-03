import assert from "node:assert/strict";
import { test } from "node:test";
import { readClaims, reportSummary } from "../eval/report.ts";
import { MODEL } from "../server/checker.ts";

test("claims are found and checked with Haiku 5.5", () => {
  assert.equal(MODEL, "claude-haiku-5-5");
});

test("the report names the model and prices the run at Haiku rates", () => {
  // 1M input tokens ($0.10) + 1M output ($0.50) + 100 searches ($1.00).
  const usage = { input: 1_000_000, output: 1_000_000, searches: 100 };
  assert.equal(
    reportSummary(10, usage, []),
    "claude-haiku-5-5 · 10 claims · 100 searches · 0 failed searches (none) · about $1.60",
  );
});

test("an earlier report's claims are read back, failed checks included", () => {
  const report = [
    "# Title",
    "",
    "## [1:28] SUPPORTED: The Holocene began about 12,000 years ago.",
    "",
    "> This is the start of the holysine",
    "",
    "## [3:57] A check that failed.",
    "",
    "Check failed.",
  ].join("\n");
  assert.deepEqual(readClaims(report), [
    {
      time: "1:28",
      claim: "The Holocene began about 12,000 years ago.",
      quote: "This is the start of the holysine",
      verdict: "supported",
    },
    { time: "3:57", claim: "A check that failed.", quote: "", verdict: "" },
  ]);
});
