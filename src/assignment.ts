// Shapes and small helpers shared by the server and the website. No Node
// imports, so the browser bundle can use it too.

export const STATUSES = ["open", "not_open_yet", "closed", "unknown"] as const;
export type Status = (typeof STATUSES)[number];

export interface SavedAssignment {
  id: number;
  name: string;
  course: string;
  /** ISO 8601, or null when no site has shown a due date. */
  dueAt: string | null;
  status: Status;
  /** Other names the same assignment was seen under (e.g. on Canvas). */
  aliases: string[];
  /** Left out by the student (e.g. a grade total); later imports skip it. */
  ignored: boolean;
  /** TypeSafe's estimate of the work, or null until it has been judged. */
  estimateMinutes: number | null;
  /** When the student marked it done, or null (e.g. closed by the site). */
  closedAt: string | null;
  /** Work sessions done on it, oldest first. */
  sessions: WorkSession[];
}

export interface WorkSession {
  id: number;
  minutes: number;
  /** When it was logged, ISO 8601. */
  at: string;
}

/** How an imported row relates to what's already saved. */
export type Match =
  | { kind: "new" }
  | { kind: "same"; id: number; changes: string[] }
  | { kind: "ask"; id: number; savedName: string };

/** One row of an import, ready for the student to review before saving. */
export interface ReviewRow {
  name: string;
  course: string;
  dueAt: string | null;
  status: Status;
  /** False for gradebook totals, which are listed but not saved by default. */
  include: boolean;
  /** Why the student should look at this row, if anything. */
  flag: string | null;
  match: Match;
}

/** What the website sends back after review. */
export interface SaveRow {
  name: string;
  course: string;
  dueAt: string | null;
  status: Status;
  /** The saved assignment this row updates, or null for a new one. */
  matchId: number | null;
  /** True for rows the student left out, so later imports skip them. */
  ignored: boolean;
}

/** "2026-10-23T23:59:00-05:00" → "Oct 23", using the clock time it was written in. */
export function shortDate(dueAt: string): string {
  return new Date(`${dueAt.slice(0, 19)}Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
}

export const STATUS_LABELS: Record<Status, string> = {
  open: "Open",
  not_open_yet: "Not open yet",
  closed: "Closed",
  unknown: "Status unknown",
};
