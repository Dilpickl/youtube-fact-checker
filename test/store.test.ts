import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { SaveRow } from "../src/assignment.ts";
import { openStore } from "../src/store.ts";

const row = (overrides: Partial<SaveRow>): SaveRow => ({
  name: "Cultura (Interpretiamo)- 5",
  course: "ITAL 101",
  dueAt: "2026-10-21T23:59:00-05:00",
  status: "open",
  matchId: null,
  ignored: false,
  ...overrides,
});

test("saved assignments survive closing and reopening the database", async () => {
  const folder = await mkdtemp(join(tmpdir(), "store-test-"));
  try {
    const path = join(folder, "assignments.db");
    const first = openStore(path);
    first.save([row({})]);
    first.close();
    const reopened = openStore(path);
    assert.deepEqual(
      reopened.list().map((a) => a.name),
      ["Cultura (Interpretiamo)- 5"],
    );
    reopened.close();
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("an update keeps known details the new screenshot didn't show", () => {
  const store = openStore(":memory:");
  store.save([row({})]);
  const [{ id }] = store.list();
  store.save([
    row({
      name: "Connect: Cultura 5",
      course: "",
      status: "unknown",
      matchId: id,
    }),
  ]);
  const [updated] = store.list();
  assert.equal(updated.name, "Cultura (Interpretiamo)- 5");
  assert.equal(updated.course, "ITAL 101");
  assert.equal(updated.status, "open");
  assert.deepEqual(updated.aliases, ["Connect: Cultura 5"]);
  store.close();
});

test("a bad row saves nothing at all", () => {
  const store = openStore(":memory:");
  assert.throws(() => store.save([row({}), row({ matchId: 999 })]));
  assert.deepEqual(store.list(), []);
  store.close();
});

// Voice Board 6 went from "Not open yet" to "Open" after Done and Reopen.
test("reopening restores the status it had before it was done", () => {
  const store = openStore(":memory:");
  store.save([row({ name: "Voice Board 6", status: "not_open_yet" })]);
  const [{ id }] = store.list();
  store.setStatus(id, "closed", new Date("2026-10-22T22:00:00-05:00"));
  const [done] = store.list();
  assert.equal(done.closedAt, "2026-10-23T03:00:00.000Z");
  assert.ok(store.reopen(id));
  const [reopened] = store.list();
  assert.deepEqual(
    [reopened.status, reopened.closedAt],
    ["not_open_yet", null],
  );
  assert.equal(store.reopen(id), false, "only closed work can be reopened");
  store.close();
});
