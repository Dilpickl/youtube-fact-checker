// Saved assignments, in a SQLite file using Node's built-in driver. One file
// on the server, so the website and (later) the Discord bot share it.
import { DatabaseSync } from "node:sqlite";
import type { SaveRow, SavedAssignment, Status } from "./assignment.ts";
import { normalizeName } from "./match.ts";

interface AssignmentRecord {
  id: number;
  name: string;
  course: string;
  due_at: string | null;
  status: string;
  aliases: string;
  ignored: number;
}

const toAssignment = (record: AssignmentRecord): SavedAssignment => ({
  id: record.id,
  name: record.name,
  course: record.course,
  dueAt: record.due_at,
  status: record.status as Status,
  aliases: JSON.parse(record.aliases) as string[],
  ignored: record.ignored === 1,
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
    ignored INTEGER NOT NULL DEFAULT 0
  )`);
  const find = (id: number) => {
    const record = db
      .prepare("SELECT * FROM assignments WHERE id = ?")
      .get(id) as AssignmentRecord | undefined;
    return record && toAssignment(record);
  };

  return {
    list(): SavedAssignment[] {
      const records = db
        .prepare("SELECT * FROM assignments ORDER BY id")
        .all() as unknown as AssignmentRecord[];
      return records.map(toAssignment);
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

    setStatus(id: number, status: Status): boolean {
      return (
        db
          .prepare("UPDATE assignments SET status = ? WHERE id = ?")
          .run(status, id).changes > 0
      );
    },

    close(): void {
      db.close();
    },
  };
}

export type Store = ReturnType<typeof openStore>;
