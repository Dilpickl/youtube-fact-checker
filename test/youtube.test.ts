import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatTime,
  parseJson3,
  parseTime,
  pickCaptionTrack,
  transcriptText,
} from "../src/youtube.ts";

test("captions someone wrote win over automatic ones, English first", () => {
  const spanish = { languageCode: "es" };
  const automatic = { languageCode: "en", kind: "asr" };
  const written = { languageCode: "en-US" };
  assert.equal(pickCaptionTrack([spanish, automatic, written]), written);
  assert.equal(pickCaptionTrack([spanish, automatic]), automatic);
  assert.equal(pickCaptionTrack([spanish]), spanish);
  assert.equal(pickCaptionTrack([]), undefined);
});

test("the player's caption format becomes timed lines", () => {
  // Shaped like YouTube's automatic captions: word pieces, then line breaks.
  const json3 = {
    events: [
      { tStartMs: 0, dDurationMs: 465080 },
      {
        tStartMs: 40,
        segs: [{ utf8: "so" }, { utf8: " let's" }, { utf8: " talk" }],
      },
      { tStartMs: 3350, aAppend: 1, segs: [{ utf8: "\n" }] },
      { tStartMs: 3360, segs: [{ utf8: "fry your" }, { utf8: " Foods" }] },
    ],
  };
  assert.deepEqual(parseJson3(json3), [
    { start: 0.04, text: "so let's talk" },
    { start: 3.36, text: "fry your Foods" },
  ]);
});

test("the transcript groups captions into timestamped lines", () => {
  const cues = [
    { start: 0, text: "one" },
    { start: 4, text: "two" },
    { start: 11, text: "three" },
    { start: 3725, text: "late" },
  ];
  assert.equal(
    transcriptText(cues),
    "[0:00] one two\n[0:11] three\n[1:02:05] late",
  );
});

test("claim times read back as seconds", () => {
  assert.equal(parseTime("4:03"), 243);
  assert.equal(parseTime("[4:03]"), 243);
  assert.equal(parseTime("1:02:05"), 3725);
  assert.equal(parseTime("about four minutes"), null);
  assert.equal(formatTime(243.9), "4:03");
});
