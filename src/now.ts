// Orders the work for the Now page. Dylan works top to bottom until stopping,
// so the order is the plan:
//   1. Due soon (before the end of tomorrow), soonest first.
//   2. Today's share: sessions from everything else, earliest deadline first.
//   3. Getting ahead: the rest, same order, once today's share is done.
// There's no daily budget. The pace comes from the workload: for each
// deadline, the work due by then divided by the days left (finishing a day
// early, two for big tasks). The largest of those keeps everything on time,
// and rises by itself when deadlines pile up.
import type { SavedAssignment } from "./assignment.ts";

const DAY_MS = 86_400_000;
/** Used until TypeSafe has estimated a task. */
const DEFAULT_MINUTES = 30;
// ponytail: fixed session sizes; the learning milestone can tune them to how
// long Dylan actually focuses.
const MIN_SESSION = 25;
const MAX_SESSION = 60;
/** Tasks this long get two days of slack instead of one. */
const BIG_TASK = 120;
/** A task that ran over its estimate still has a little left until it's done. */
const OVERRUN_MINUTES = 10;

export type Tier = "due-soon" | "today" | "ahead";

export interface WorkItem {
  assignment: SavedAssignment;
  tier: Tier;
  /** This session's length. */
  minutes: number;
  /** Work left on the whole task, including this session. */
  remaining: number;
  /** The days the plan works on it (midnight of each). */
  plannedStart: Date;
  plannedFinish: Date;
}

export interface Schedule {
  items: WorkItem[];
  /** Minutes a day that keep everything on time; 0 if nothing is upcoming. */
  pace: number;
  /** Minutes logged today on work that isn't due soon. */
  doneToday: number;
}

const startOfDay = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, days: number) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
const daysBetween = (a: Date, b: Date) =>
  Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY_MS);
const sum = (numbers: number[]) => numbers.reduce((a, b) => a + b, 0);

export function buildSchedule(
  assignments: SavedAssignment[],
  now: Date,
): Schedule {
  const today = startOfDay(now);
  const loggedToday = (a: SavedAssignment) =>
    sum(
      a.sessions
        .filter((s) => daysBetween(today, new Date(s.at)) === 0)
        .map((s) => s.minutes),
    );
  const remainingOf = (a: SavedAssignment) =>
    Math.max(
      (a.estimateMinutes ?? DEFAULT_MINUTES) -
        sum(a.sessions.map((s) => s.minutes)),
      OVERRUN_MINUTES,
    );

  const workable = assignments.filter(
    (a) =>
      !a.ignored &&
      (a.status === "open" || a.status === "unknown") &&
      a.dueAt !== null &&
      Date.parse(a.dueAt) > now.getTime(),
  );
  const dueSoonBefore = addDays(today, 2).getTime();
  const isDueSoon = (a: SavedAssignment) =>
    a.dueAt !== null && Date.parse(a.dueAt) < dueSoonBefore;
  const dueSoon = workable
    .filter(isDueSoon)
    .sort((a, b) => Date.parse(a.dueAt!) - Date.parse(b.dueAt!));

  const later = workable
    .filter((a) => !isDueSoon(a))
    .map((assignment) => {
      const remaining = remainingOf(assignment);
      const slack = remaining >= BIG_TASK ? 2 : 1;
      const lastDay = addDays(startOfDay(new Date(assignment.dueAt!)), -slack);
      return {
        assignment,
        remaining,
        // What was left this morning, so the pace holds steady as you work.
        startOfDayRemaining: remaining + loggedToday(assignment),
        target: lastDay < today ? today : lastDay,
      };
    })
    .sort(
      (a, b) =>
        a.target.getTime() - b.target.getTime() ||
        Date.parse(a.assignment.dueAt!) - Date.parse(b.assignment.dueAt!),
    );

  let pace = 0;
  let cumulative = 0;
  for (const task of later) {
    cumulative += task.startOfDayRemaining;
    pace = Math.max(pace, cumulative / (daysBetween(today, task.target) + 1));
  }
  pace = Math.ceil(pace);

  const doneToday = sum(
    assignments.filter((a) => !isDueSoon(a)).map(loggedToday),
  );

  // Lay the work onto days at that pace, earliest deadline first. A slow pace
  // banks up across days into sessions of at least MIN_SESSION; if nothing is
  // done yet today, the first session is today rather than days from now.
  const plans = later.map(() => ({
    today: 0,
    firstChunk: 0,
    start: null as Date | null,
    finish: today,
  }));
  let bank =
    doneToday === 0
      ? Math.max(pace, MIN_SESSION)
      : Math.max(0, pace - doneToday);
  let next = 0;
  let left = later[0]?.remaining ?? 0;
  for (let day = 0; next < later.length && day < 1000; day++) {
    if (day > 0) bank += pace;
    const date = addDays(today, day);
    while (next < later.length && bank >= Math.min(MIN_SESSION, left)) {
      // An hour or less is done in one sitting, even if that borrows from
      // the days ahead; only bigger tasks are split into sessions.
      const chunk = left <= MAX_SESSION ? left : Math.min(bank, left);
      const plan = plans[next];
      if (!plan.start) {
        plan.start = date;
        plan.firstChunk = chunk;
      }
      plan.finish = date;
      if (day === 0) plan.today += chunk;
      bank -= chunk;
      left -= chunk;
      if (left <= 0) left = later[++next]?.remaining ?? 0;
    }
  }

  const items: WorkItem[] = dueSoon.map((assignment) => {
    const remaining = remainingOf(assignment);
    return {
      assignment,
      tier: "due-soon",
      minutes: Math.min(remaining, MAX_SESSION),
      remaining,
      plannedStart: today,
      plannedFinish: today,
    };
  });
  const laterItems = later.map((task, k): WorkItem => {
    const plan = plans[k];
    const share = plan.today > 0 ? plan.today : plan.firstChunk;
    return {
      assignment: task.assignment,
      tier: plan.today > 0 ? "today" : "ahead",
      minutes: Math.min(Math.round(share) || task.remaining, MAX_SESSION),
      remaining: task.remaining,
      plannedStart: plan.start ?? today,
      plannedFinish: plan.finish,
    };
  });
  items.push(
    ...laterItems.filter((item) => item.tier === "today"),
    ...laterItems.filter((item) => item.tier === "ahead"),
  );
  return { items, pace, doneToday };
}

/** For "Too tired?": the shortest other session, if one is shorter. */
export function smallerItem(
  items: WorkItem[],
  current: WorkItem,
): WorkItem | null {
  const shorter = items
    .filter((item) => item.minutes < current.minutes)
    .sort((a, b) => a.minutes - b.minutes);
  return shorter[0] ?? null;
}

/** "About 30 min a day…", or for a slow pace, "About 25 min every 5 days…". */
export function describePace(pace: number): string | null {
  if (pace === 0) return null;
  if (pace >= MIN_SESSION) {
    return `About ${pace} min a day keeps everything on time.`;
  }
  const days = Math.max(2, Math.round(MIN_SESSION / pace));
  return `About ${MIN_SESSION} min every ${days} days keeps everything on time.`;
}

/** "today at 9:40 PM", "tomorrow at …", "Friday at …", or "Oct 30 at …". */
export function describeWhen(date: Date, now: Date): string {
  const time = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${describeDay(date, now)} at ${time}`;
}

/** "today", "tomorrow", "Friday", or "Oct 30". */
export function describeDay(date: Date, now: Date): string {
  const days = daysBetween(now, date);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days > 1 && days < 7) {
    return date.toLocaleDateString("en-US", { weekday: "long" });
  }
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
