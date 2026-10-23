// Lays out what's been done for the History page: finished assignments and
// logged work sessions, by day, newest first. Runs in the browser, so days
// are the student's local days.
import type { SavedAssignment } from "./assignment.ts";

const DAY_MS = 86_400_000;

export type HistoryEntry =
  | { kind: "finished"; at: Date; assignment: SavedAssignment }
  | {
      kind: "session";
      at: Date;
      assignment: SavedAssignment;
      minutes: number;
      sessionId: number;
    };

export interface HistoryDay {
  label: string;
  entries: HistoryEntry[];
  minutes: number;
  finished: number;
}

export interface History {
  days: HistoryDay[];
  /** Totals over the last seven days, today included. */
  weekMinutes: number;
  weekFinished: number;
  /** Closed with no date: marked by a course site, or before dates were kept. */
  closedUndated: SavedAssignment[];
}

const startOfDay = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate());
const daysAgo = (date: Date, now: Date) =>
  Math.round((startOfDay(now).getTime() - startOfDay(date).getTime()) / DAY_MS);

export function buildHistory(
  assignments: SavedAssignment[],
  now: Date,
): History {
  const visible = assignments.filter((a) => !a.ignored);
  const entries: HistoryEntry[] = visible.flatMap((assignment) => [
    ...assignment.sessions.map((session): HistoryEntry => ({
      kind: "session",
      at: new Date(session.at),
      assignment,
      minutes: session.minutes,
      sessionId: session.id,
    })),
    ...(assignment.status === "closed" && assignment.closedAt
      ? [
          {
            kind: "finished",
            at: new Date(assignment.closedAt),
            assignment,
          } satisfies HistoryEntry,
        ]
      : []),
  ]);
  entries.sort((a, b) => b.at.getTime() - a.at.getTime());

  const days: HistoryDay[] = [];
  for (const entry of entries) {
    const ago = daysAgo(entry.at, now);
    const label =
      ago === 0
        ? "Today"
        : ago === 1
          ? "Yesterday"
          : entry.at.toLocaleDateString("en-US", {
              weekday: "long",
              month: "short",
              day: "numeric",
            });
    let day = days.at(-1);
    if (day?.label !== label) {
      day = { label, entries: [], minutes: 0, finished: 0 };
      days.push(day);
    }
    day.entries.push(entry);
    if (entry.kind === "session") day.minutes += entry.minutes;
    else day.finished++;
  }

  const thisWeek = entries.filter((entry) => daysAgo(entry.at, now) < 7);
  return {
    days,
    weekMinutes: thisWeek.reduce(
      (sum, entry) => sum + (entry.kind === "session" ? entry.minutes : 0),
      0,
    ),
    weekFinished: thisWeek.filter((entry) => entry.kind === "finished").length,
    closedUndated: visible.filter((a) => a.status === "closed" && !a.closedAt),
  };
}

/** 135 → "2 h 15 min", 40 → "40 min". */
export function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}
