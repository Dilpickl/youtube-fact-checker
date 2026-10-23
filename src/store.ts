// Saved assignments, in a SQLite file using Node's built-in driver. One file
// on the server, so the website and (later) the Discord bot share it.
import { DatabaseSync } from "node:sqlite";
import type {
  SaveRow,
  SavedAssignment,
  Status,
  WorkSession,
} from "./assignment.ts";
import { normalizeName } from "./match.ts";

interface AssignmentRecord {
  id: number;
  name: string;
  course: string;
  due_at: string | null;
  status: string;
  aliases: string;
  ignored: number;
  estimate_minutes: number | null;
  closed_at: string | null;
}

const toAssignment = (
  record: AssignmentRecord,
  sessions: WorkSession[] = [],
): SavedAssignment => ({
  id: record.id,
  name: record.name,
  course: record.course,
  dueAt: record.due_at,
  status: record.status as Status,
  aliases: JSON.parse(record.aliases) as string[],
  ignored: record.ignored === 1,
  estimateMinutes: record.estimate_minutes,
  closedAt: record.closed_at,
  sessions,
});

export function openStore(path: string) {
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE IF NOT EXISTS assignments (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    course TEXT NOT NULL,
    due_at TEXT,
    status TEXT NOT NULL,
    aliases TEXT NOT NULL DEFAULT '[]',
    ignored INTEGER NOT NULL DEFAULT 0,
    estimate_minutes INTEGER,
    closed_at TEXT,
    reopen_status TEXT
  )`);
  // Databases made before a column existed get it added.
  const columns = (
    db.prepare("PRAGMA table_info(assignments)").all() as { name: string }[]
  ).map((column) => column.name);
  for (const [name, type] of [
    ["estimate_minutes", "INTEGER"],
    ["closed_at", "TEXT"],
    ["reopen_status", "TEXT"],
  ]) {
    if (!columns.includes(name)) {
      db.exec(`ALTER TABLE assignments ADD COLUMN ${name} ${type}`);
    }
  }
  db.exec(`CREATE TABLE IF NOT EXISTS work_log (
    id INTEGER PRIMARY KEY,
    assignment_id INTEGER NOT NULL REFERENCES assignments(id),
    minutes INTEGER NOT NULL,
    logged_at TEXT NOT NULL
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);
  const find = (id: number) => {
    const record = db
      .prepare("SELECT * FROM assignments WHERE id = ?")
      .get(id) as AssignmentRecord | undefined;
    return record && toAssignment(record);
  };

  return {
    list(): SavedAssignment[] {
      const sessions = new Map<number, WorkSession[]>();
      const logged = db.prepare("SELECT * FROM work_log ORDER BY id").all() as {
        id: number;
        assignment_id: number;
        minutes: number;
        logged_at: string;
      }[];
      for (const entry of logged) {
        const list = sessions.get(entry.assignment_id) ?? [];
        list.push({
          id: entry.id,
          minutes: entry.minutes,
          at: entry.logged_at,
        });
        sessions.set(entry.assignment_id, list);
      }
      const records = db
        .prepare("SELECT * FROM assignments ORDER BY id")
        .all() as unknown as AssignmentRecord[];
      return records.map((record) =>
        toAssignment(record, sessions.get(record.id)),
      );
    },

    /** Saves reviewed rows all together, or none if any row is invalid. */
    save(rows: SaveRow[]): void {
      const insert = db.prepare(
        "INSERT INTO assignments (name, course, due_at, status, ignored) VALUES (?, ?, ?, ?, ?)",
      );
      const update = db.prepare(
        "UPDATE assignments SET course = ?, due_at = ?, status = ?, aliases = ?, ignored = ? WHERE id = ?",
      );
      db.exec("BEGIN");
      try {
        for (const row of rows) {
          if (row.matchId === null) {
            insert.run(
              row.name,
              row.course,
              row.dueAt,
              row.status,
              Number(row.ignored),
            );
            continue;
          }
          const saved = find(row.matchId);
          if (!saved) throw new Error(`No saved assignment ${row.matchId}`);
          const known = [saved.name, ...saved.aliases].map(normalizeName);
          const aliases = known.includes(normalizeName(row.name))
            ? saved.aliases
            : [...saved.aliases, row.name];
          // Keep what's known when this screenshot didn't show it.
          update.run(
            row.course || saved.course,
            row.dueAt ?? saved.dueAt,
            row.status === "unknown" ? saved.status : row.status,
            JSON.stringify(aliases),
            Number(row.ignored),
            saved.id,
          );
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },

    /**
     * Marking an assignment closed records when, and what status to restore if
     * it's reopened; any other status clears that.
     */
    setStatus(id: number, status: Status, at = new Date()): boolean {
      const saved = find(id);
      if (!saved) return false;
      if (status === "closed" && saved.status !== "closed") {
        db.prepare(
          "UPDATE assignments SET status = 'closed', closed_at = ?, reopen_status = ? WHERE id = ?",
        ).run(at.toISOString(), saved.status, id);
      } else if (status !== "closed") {
        db.prepare(
          "UPDATE assignments SET status = ?, closed_at = NULL, reopen_status = NULL WHERE id = ?",
        ).run(status, id);
      }
      return true;
    },

    /** Puts a closed assignment back the way it was before it was closed. */
    reopen(id: number): boolean {
      return (
        db
          .prepare(
            "UPDATE assignments SET status = COALESCE(reopen_status, 'open'), closed_at = NULL, reopen_status = NULL WHERE id = ? AND status = 'closed'",
          )
          .run(id).changes > 0
      );
    },

    /** Records a work session; returns its id, or null if no such assignment. */
    logWork(id: number, minutes: number, at = new Date()): number | null {
      if (!find(id)) return null;
      const result = db
        .prepare(
          "INSERT INTO work_log (assignment_id, minutes, logged_at) VALUES (?, ?, ?)",
        )
        .run(id, minutes, at.toISOString());
      return Number(result.lastInsertRowid);
    },

    deleteWork(sessionId: number): boolean {
      return (
        db.prepare("DELETE FROM work_log WHERE id = ?").run(sessionId).changes >
        0
      );
    },

    setEstimates(estimates: Map<number, number>): void {
      const update = db.prepare(
        "UPDATE assignments SET estimate_minutes = ? WHERE id = ?",
      );
      for (const [id, minutes] of estimates) update.run(minutes, id);
    },

    getSetting(key: string): string | null {
      const row = db
        .prepare("SELECT value FROM settings WHERE key = ?")
        .get(key) as { value: string } | undefined;
      return row?.value ?? null;
    },

    /** Saves a setting, or removes it when given null. */
    setSetting(key: string, value: string | null): void {
      if (value === null) {
        db.prepare("DELETE FROM settings WHERE key = ?").run(key);
      } else {
        db.prepare(
          "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        ).run(key, value);
      }
    },

    close(): void {
      db.close();
    },
  };
}

export type Store = ReturnType<typeof openStore>;
