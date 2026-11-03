import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import { handle } from "../server/main.ts";

// These requests are all refused before the language model is called, so the
// tests spend nothing and need no API key.
const server = createServer(
  (request, response) => void handle(request, response),
);
server.listen(0, "127.0.0.1");
await once(server, "listening");
const { port } = server.address() as AddressInfo;
after(() => server.close());

function askForClaims(origin: string, body: object) {
  return fetch(`http://127.0.0.1:${port}/claims`, {
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
  const response = await askForClaims("https://example.com", request);
  assert.equal(response.status, 403);
});

test("an empty transcript is refused before anything is spent", async () => {
  const response = await askForClaims("chrome-extension://abc", {
    ...request,
    transcript: "   ",
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "the transcript is empty" });
});
