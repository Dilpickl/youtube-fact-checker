// Lays saved assignments out by day for the Plan page. Runs in the browser, so
// "today" is the student's own local day.
import type { SavedAssignment } from "./assignment.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DayGroup {
  label: string;
  items: SavedAssignment[];
}

export interface Plan {
  pastDue: SavedAssignment[];
  today: SavedAssignment[];
  /** The next six days, one group per day that has something due. */
  thisWeek: DayGroup[];
  later: SavedAssignment[];
  needsDate: SavedAssignment[];
  done: SavedAssignment[];
}

const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

/** Whole calendar days from today to the due date (0 = today). */
const daysAway = (due: Date, now: Date) =>
  Math.round((startOfDay(due).getTime() - startOfDay(now).getTime()) / DAY_MS);

const byDue = (a: SavedAssignment, b: SavedAssignment) =>
  Date.parse(a.dueAt ?? "") - Date.parse(b.dueAt ?? "");

export function buildPlan(assignments: SavedAssignment[], now: Date): Plan {
  const plan: Plan = {
    pastDue: [],
    today: [],
    thisWeek: [],
    later: [],
    needsDate: [],
    done: [],
  };
  const sorted = assignments
    .filter((assignment) => !assignment.ignored)
    .sort(byDue);
  for (const assignment of sorted) {
    if (assignment.status === "closed") {
      plan.done.push(assignment);
      continue;
    }
    if (!assignment.dueAt) {
      plan.needsDate.push(assignment);
      continue;
    }
    const due = new Date(assignment.dueAt);
    const days = daysAway(due, now);
    if (due < now) plan.pastDue.push(assignment);
    else if (days === 0) plan.today.push(assignment);
    else if (days <= 6) {
      const label =
        days === 1
          ? "Tomorrow"
          : due.toLocaleDateString("en-US", {
              weekday: "long",
              month: "short",
              day: "numeric",
            });
      const group = plan.thisWeek.find((day) => day.label === label);
      if (group) group.items.push(assignment);
      else plan.thisWeek.push({ label, items: [assignment] });
    } else plan.later.push(assignment);
  }
  return plan;
}
