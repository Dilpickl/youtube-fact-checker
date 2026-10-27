// The Overview tab: a summary card per course, and a month calendar. Runs in
// the browser, so days are the student's local days. Only work still to do
// appears; finished work lives in History.
import type { SavedAssignment } from "./assignment.ts";

const DAY_MS = 86_400_000;

/** Colors that read on light and dark backgrounds, one per course. */
const COURSE_COLORS = [
  "#1D9E75",
  "#7F77DD",
  "#D85A30",
  "#378ADD",
  "#BA7517",
  "#D4537E",
  "#639922",
  "#888780",
];

export interface CourseSummary {
  /** The course as saved; "" for assignments with no course. */
  course: string;
  color: string;
  /** Still to do and not yet due, soonest first. */
  upcoming: SavedAssignment[];
  /** Still open, and the due date has passed. */
  overdue: SavedAssignment[];
  /** Still to do, with no due date. */
  undated: SavedAssignment[];
  dueThisWeek: number;
}

const startOfDay = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate());

const stillToDo = (a: SavedAssignment) => !a.ignored && a.status !== "closed";

/**
 * Colors by alphabetical order of course, so each course keeps its color
 * everywhere on the page. (No course is gray.)
 */
export function courseColors(
  assignments: SavedAssignment[],
): Map<string, string> {
  const courses = [...new Set(assignments.map((a) => a.course))]
    .filter(Boolean)
    .sort();
  const colors = new Map(
    courses.map((course, k) => [
      course,
      COURSE_COLORS[k % (COURSE_COLORS.length - 1)],
    ]),
  );
  colors.set("", COURSE_COLORS.at(-1)!);
  return colors;
}

/** One summary per course with work to do: overdue first, then soonest due. */
export function summarizeCourses(
  assignments: SavedAssignment[],
  now: Date,
): CourseSummary[] {
  const colors = courseColors(assignments);
  const weekEnd = startOfDay(now).getTime() + 7 * DAY_MS;
  const byCourse = new Map<string, SavedAssignment[]>();
  for (const assignment of assignments.filter(stillToDo)) {
    const list = byCourse.get(assignment.course) ?? [];
    list.push(assignment);
    byCourse.set(assignment.course, list);
  }
  const summaries = [...byCourse].map(([course, list]): CourseSummary => {
    const due = (a: SavedAssignment) => Date.parse(a.dueAt!);
    const dated = list.filter((a) => a.dueAt).sort((a, b) => due(a) - due(b));
    const upcoming = dated.filter((a) => due(a) >= now.getTime());
    return {
      course,
      color: colors.get(course)!,
      upcoming,
      overdue: dated.filter((a) => due(a) < now.getTime()),
      undated: list.filter((a) => !a.dueAt),
      dueThisWeek: upcoming.filter((a) => due(a) < weekEnd).length,
    };
  });
  const nextDue = (s: CourseSummary) =>
    s.upcoming[0] ? Date.parse(s.upcoming[0].dueAt!) : Infinity;
  return summaries.sort(
    (a, b) =>
      Number(b.overdue.length > 0) - Number(a.overdue.length > 0) ||
      Number(a.course === "") - Number(b.course === "") ||
      nextDue(a) - nextDue(b),
  );
}

/** The card's one-line status, and how much attention it needs. */
export function courseStatus(summary: CourseSummary): {
  text: string;
  tone: "danger" | "normal" | "good";
} {
  const n = summary.overdue.length;
  if (n > 0) return { text: `${n} overdue`, tone: "danger" };
  if (summary.dueThisWeek > 0) {
    return { text: `${summary.dueThisWeek} due this week`, tone: "normal" };
  }
  if (summary.upcoming.length > 0)
    return { text: "Nothing due this week", tone: "good" };
  return { text: "All caught up", tone: "good" };
}

/** The weeks of a month as rows of seven days, with nulls outside the month. */
export function monthGrid(year: number, month: number): (Date | null)[][] {
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = Array(first.getDay()).fill(null);
  for (let day = 1; day <= days; day++) cells.push(new Date(year, month, day));
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (Date | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Work still to do that's due on a given day, earliest first. */
export function dueOn(
  assignments: SavedAssignment[],
  day: Date,
): SavedAssignment[] {
  const start = startOfDay(day).getTime();
  return assignments
    .filter((a) => stillToDo(a) && a.dueAt !== null)
    .filter((a) => {
      const due = Date.parse(a.dueAt!);
      return due >= start && due < start + DAY_MS;
    })
    .sort((a, b) => Date.parse(a.dueAt!) - Date.parse(b.dueAt!));
}

const simplify = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

/** Whether an assignment's name or course contains what was typed in search. */
export function matchesQuery(
  assignment: SavedAssignment,
  query: string,
): boolean {
  const wanted = simplify(query.trim());
  return (
    wanted === "" ||
    simplify(assignment.name).includes(wanted) ||
    simplify(assignment.course).includes(wanted)
  );
}
