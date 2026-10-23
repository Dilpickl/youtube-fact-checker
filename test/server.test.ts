import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import type { ReviewRow, SavedAssignment } from "../src/assignment.ts";
import type { CheckedAssignment } from "../src/import-screenshot.ts";
import { createApp } from "../src/server.ts";
import { openStore } from "../src/store.ts";

const checkedRow: CheckedAssignment = {
  name: "Cultura (Interpretiamo)- 5",
  course: "ITAL 101",
  dueAt: "2026-10-21T23:59:00-05:00",
  status: "open",
  include: true,
  flag: null,
  dueProbability: 1,
  statusChoice: "open",
  statusProbability: 1,
  totalProbability: 0,
};

const feedLink =
  "https://canvas.illinois.edu/feeds/calendars/user_secret123.ics";
const futureFeed = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT",
  "UID:event-assignment-1",
  "DTSTART:20301024T045900Z",
  "SUMMARY:Discussione 9 [ITAL 101 1 FA30]",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");
let fetchedFeed = "";

const server = createApp(openStore(":memory:"), {
  readScreenshot: async () => [checkedRow],
  // Treats every row as new; matching itself is tested in match.test.ts.
  match: async (rows) =>
    rows.map((row): ReviewRow => ({
      name: row.name,
      course: row.course,
      dueAt: row.dueAt,
      status: row.status,
      include: row.include,
      flag: row.flag,
      match: { kind: "new" },
    })),
  fetchFeed: async (url) => {
    fetchedFeed = url;
    return futureFeed;
  },
  estimate: async (assignments) =>
    new Map(assignments.map((assignment) => [assignment.id, 25])),
});
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

test("import, save, estimate, log work, mark done, and undo work end to end", async () => {
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
  const estimated = await post("/api/estimates", "");
  const [withEstimate] = (await estimated.json()) as SavedAssignment[];
  assert.equal(withEstimate.estimateMinutes, 25);

  const worked = await post(
    `/api/assignments/${assignment.id}/work`,
    JSON.stringify({ minutes: 25, finished: false }),
  );
  const { sessionId, assignments } = (await worked.json()) as {
    sessionId: number;
    assignments: SavedAssignment[];
  };
  assert.equal(assignments[0].sessions[0].minutes, 25);
  const undone = await fetch(`${base}/api/work/${sessionId}`, {
    method: "DELETE",
  });
  assert.deepEqual(
    ((await undone.json()) as SavedAssignment[])[0].sessions,
    [],
  );

  assert.equal(await setStatus("closed"), "closed", "mark done");
  assert.equal(await setStatus("open"), "open", "undo");
  await setStatus("closed");
  const reopened = await post(`/api/assignments/${assignment.id}/reopen`, "");
  assert.equal(
    ((await reopened.json()) as SavedAssignment[])[0].status,
    "open",
  );
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

test("connects a Canvas feed, checks it, and never sends the link back", async () => {
  const put = (feedUrl: string) =>
    fetch(base + "/api/canvas", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedUrl }),
    });
  const bad = await put("https://canvas.illinois.edu/courses/72857");
  assert.equal(bad.status, 400);

  const connected = await put(feedLink);
  const status = await connected.text();
  assert.deepEqual(JSON.parse(status), { connected: true, lastChecked: null });
  assert.ok(!status.includes("secret123"));

  const checked = await post("/api/canvas/check", "");
  const { rows } = (await checked.json()) as { rows: ReviewRow[] };
  assert.equal(fetchedFeed, feedLink);
  assert.deepEqual(
    rows.map((row) => [row.name, row.course, row.status]),
    [["Discussione 9", "ITAL 101", "open"]],
  );

  const disconnected = await fetch(base + "/api/canvas", { method: "DELETE" });
  assert.deepEqual(await disconnected.json(), {
    connected: false,
    lastChecked: null,
  });
  assert.equal((await post("/api/canvas/check", "")).status, 400);
});
