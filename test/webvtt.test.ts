import assert from "node:assert/strict";
import { test } from "node:test";
import { parseWebVtt } from "../src/webvtt.ts";

test("reads cue text and start times", () => {
  const vtt = [
    "WEBVTT",
    "",
    "NOTE This block is a comment.",
    "",
    "1",
    "00:00:00.120 --> 00:00:02.000",
    "Magnesium <c.yellow>cures</c>",
    "insomnia",
    "",
    "2",
    "00:00:02.000 --> 00:00:03.500",
    "in 90% of people &amp; it&#39;s cheap",
    "",
    "00:01:03.500 --> 00:01:05.000 align:start",
    "in 90% of people &amp; it&#39;s cheap",
    "",
    "01:02:03.250 --> 01:02:04.000",
    "the end",
  ].join("\r\n");

  assert.deepEqual(parseWebVtt(vtt), [
    { start: 0.12, text: "Magnesium cures insomnia" },
    { start: 2, text: "in 90% of people & it's cheap" },
    { start: 3723.25, text: "the end" },
  ]);
});

test("reads minute-only timestamps", () => {
  const vtt = "WEBVTT\n\n00:02.500 --> 00:04.000\nhello";
  assert.deepEqual(parseWebVtt(vtt), [{ start: 2.5, text: "hello" }]);
});

test("returns no cues for empty or non-caption text", () => {
  assert.deepEqual(parseWebVtt(""), []);
  assert.deepEqual(parseWebVtt("WEBVTT"), []);
  assert.deepEqual(parseWebVtt("<html>Access denied</html>"), []);
});
