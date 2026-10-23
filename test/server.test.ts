import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import type { ReviewRow, SavedAssignment } from "../src/assignment.ts";
import { createApp } from "../src/server.ts";
import { openStore } from "../src/store.ts";

const reviewRow: ReviewRow = {
  name: "Cultura (Interpretiamo)- 5",
  course: "ITAL 101",
  dueAt: "2026-10-21T23:59:00-05:00",
  status: "open",
  include: true,
  flag: null,
  match: { kind: "new" },
};

const server = createApp(openStore(":memory:"), async () => [reviewRow]);
let base = "";

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const post = (path: string, body: BodyInit, type = "application/json") =>
  fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": type },
    body,
  });

test("serves the website", async () => {
  const response = await fetch(base + "/");
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<title>Schoolwork assistant<\/title>/);
});

test("import, save, mark done, and undo work end to end", async () => {
  const imported = await post("/api/import", "fake image", "image/png");
  const { rows } = (await imported.json()) as { rows: ReviewRow[] };
  assert.equal(rows[0].name, "Cultura (Interpretiamo)- 5");

  const saved = await post(
    "/api/save",
    JSON.stringify({
      rows: rows.map((row) => ({ ...row, matchId: null, ignored: false })),
    }),
  );
  const [assignment] = (await saved.json()) as SavedAssignment[];
  assert.equal(assignment.status, "open");

  const setStatus = async (status: string) => {
    const response = await post(
      `/api/assignments/${assignment.id}/status`,
      JSON.stringify({ status }),
    );
    return ((await response.json()) as SavedAssignment[])[0].status;
  };
  assert.equal(await setStatus("closed"), "closed", "mark done");
  assert.equal(await setStatus("open"), "open", "undo");
});

test("rejects a save with a blank name and explains why", async () => {
  const response = await post(
    "/api/save",
    JSON.stringify({
      rows: [
        {
          name: "  ",
          course: "",
          dueAt: null,
          status: "open",
          matchId: null,
          ignored: false,
        },
      ],
    }),
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Every row needs a name.",
  });
});

test("answers unknown paths with a 404", async () => {
  assert.equal((await fetch(base + "/api/nope")).status, 404);
});
