import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import {
  DAILY_CAP_DOLLARS,
  dailyLimit,
  handle,
  PICKS_PER_HOUR,
  pickLimit,
  queuedCheck,
  sourcedOnly,
} from "../server/main.ts";

// These requests are all refused before the language model is called, so the
// tests spend nothing and need no API key.
const server = createServer(
  (request, response) => void handle(request, response),
);
server.listen(0, "127.0.0.1");
await once(server, "listening");
const { port } = server.address() as AddressInfo;
after(() => server.close());

function ask(path: string, origin: string, body: object) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const request = {
  videoId: "hmkoFDMAvkc",
  title: "A video",
  transcript: "[0:00] hi",
};

test("web pages can't spend credits through the server", async () => {
  const response = await ask("/claims", "https://example.com", request);
  assert.equal(response.status, 403);
});

test("an empty transcript is refused before anything is spent", async () => {
  const response = await ask("/claims", "chrome-extension://abc", {
    ...request,
    transcript: "   ",
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "the transcript is empty" });
});

test("a claim to check needs its text", async () => {
  const response = await ask("/check", "chrome-extension://abc", {
    videoId: "hmkoFDMAvkc",
    title: "A video",
    claim: { time: "4:31", quote: "about 3 years", claim: " " },
  });
  assert.equal(response.status, 400);
});

test("checking what was just said needs captions", async () => {
  const response = await ask("/pick", "chrome-extension://abc", {
    videoId: "hmkoFDMAvkc",
    title: "A video",
    excerpt: "  ",
  });
  assert.equal(response.status, 400);
});

test("checking what was just said can't be spammed", () => {
  const start = Date.UTC(2030, 0, 1);
  for (let i = 0; i < PICKS_PER_HOUR; i++)
    assert.equal(pickLimit(start + i * 1000), null);
  assert.match(
    pickLimit(start + 60_000) ?? "",
    /20 checks this hour; try again in 59 min/,
  );
  // An hour after the first, its slot frees up.
  assert.equal(pickLimit(start + 60 * 60 * 1000), null);
});

test("no source, no verdict", () => {
  const fromMemory = {
    verdict: "contradicted" as const,
    explanation: "From what I remember, this is false.",
    sources: [],
  };
  assert.equal(sourcedOnly(fromMemory).verdict, "unverified");
  const sourced = {
    ...fromMemory,
    sources: [
      {
        url: "https://a.org",
        title: "A",
        says: "No.",
        stance: "contradicts" as const,
      },
    ],
  };
  assert.equal(sourcedOnly(sourced), sourced);
});

test("at most two checks run at once, in the order they came", async () => {
  let running = 0;
  let mostAtOnce = 0;
  const finished: number[] = [];
  const check = (id: number) =>
    queuedCheck(async () => {
      mostAtOnce = Math.max(mostAtOnce, ++running);
      await new Promise((resolve) => setTimeout(resolve, 10));
      running--;
      finished.push(id);
    });
  await Promise.all([1, 2, 3, 4, 5].map(check));
  assert.equal(mostAtOnce, 2);
  assert.deepEqual(finished, [1, 2, 3, 4, 5]);
});

test("the popup can ask how much of today's budget is left", async () => {
  const response = await fetch(`http://127.0.0.1:${port}/budget`, {
    headers: { Origin: "chrome-extension://abc" },
  });
  assert.deepEqual(await response.json(), {
    cap: DAILY_CAP_DOLLARS,
    left: DAILY_CAP_DOLLARS,
  });
});

test("the daily budget stops spending, then starts over the next day", () => {
  const day = 24 * 60 * 60 * 1000;
  assert.equal(dailyLimit(100 * day, 2), null);
  assert.equal(dailyLimit(100 * day + 1, 2 + DAILY_CAP_DOLLARS - 0.01), null);
  assert.match(dailyLimit(100 * day + 2, 2 + DAILY_CAP_DOLLARS)!, /tomorrow/);
  assert.equal(dailyLimit(101 * day, 2 + DAILY_CAP_DOLLARS), null);
});
