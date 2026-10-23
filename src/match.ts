// Decides how each imported row relates to what's already saved, so the same
// assignment is never saved twice. Code finds the candidates (same name, or
// same course with due dates within a day); TypeSafe judges the candidates
// whose names differ, like "Connect: Lessico 6" on Canvas and "Lessico- 6".
// Rows whose screenshot didn't show a course get one inferred first.
import { choice, noul, TypeSafeClient } from "@typesafe-ai/sdk";
import {
  courseCode,
  shortDate,
  STATUS_LABELS,
  type Match,
  type ReviewRow,
  type SavedAssignment,
  type Status,
} from "./assignment.ts";
import { CONFIDENT, type CheckedAssignment } from "./import-screenshot.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** "Strutture III- 5" and "strutture iii-5" compare equal; accents are ignored. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** One key per course however it's spelled ("ITAL 101", "ital_101_…"). */
const courseKey = (course: string) => normalizeName(courseCode(course));

/** An empty course means the screenshot didn't show one, so it can match any. */
const coursesFit = (a: string, b: string) =>
  !a || !b || courseKey(a) === courseKey(b);

/** Both dated, within a day: undated rows are too vague to pair by date. */
const datesClose = (a: string | null, b: string | null) =>
  a !== null && b !== null && Math.abs(Date.parse(a) - Date.parse(b)) <= DAY_MS;

export interface CandidatePair {
  imported: CheckedAssignment;
  saved: SavedAssignment;
}

/** Probability, for each pair, that both rows are the same assignment. */
export type JudgeSame = (pairs: CandidatePair[]) => Promise<number[]>;

/** A saved course, with a few assignment names that show what it covers. */
export interface CourseExamples {
  course: string;
  examples: string[];
}

/** For each row, the saved course it's for, or null when unsure. */
export type GuessCourse = (
  rows: { name: string; dueAt: string | null }[],
  courses: CourseExamples[],
) => Promise<(string | null)[]>;

/** The TypeSafe judgments matching needs; tests swap in fakes. */
export interface Judges {
  same: JudgeSame;
  course: GuessCourse;
}

const findExact = (row: CheckedAssignment, saved: SavedAssignment[]) =>
  saved.find(
    (candidate) =>
      coursesFit(row.course, candidate.course) &&
      [candidate.name, ...candidate.aliases].some(
        (name) => normalizeName(name) === normalizeName(row.name),
      ),
  );

export async function reviewImport(
  imported: CheckedAssignment[],
  saved: SavedAssignment[],
  judges: Judges,
): Promise<ReviewRow[]> {
  // "eng_100" from a Canvas page and "ENG 100" elsewhere are one course.
  const named = imported.map((row) => ({
    ...row,
    course: courseCode(row.course),
  }));
  const rows = await fillCourses(named, saved, judges.course);
  const exact = rows.map((row) => findExact(row, saved));

  const pairs: (CandidatePair & { row: number })[] = [];
  rows.forEach((row, index) => {
    if (exact[index]) return;
    for (const candidate of saved) {
      // Left-out rows (like a "Chapter 1" grade total) only match by name.
      if (
        !candidate.ignored &&
        coursesFit(row.course, candidate.course) &&
        datesClose(row.dueAt, candidate.dueAt)
      ) {
        pairs.push({ row: index, imported: row, saved: candidate });
      }
    }
  });
  const probabilities = pairs.length > 0 ? await judges.same(pairs) : [];

  return rows.map((row, index) => {
    let target = exact[index];
    let match: Match = { kind: "new" };
    if (!target) {
      const best = pairs
        .map((pair, k) => ({ ...pair, probability: probabilities[k] }))
        .filter((pair) => pair.row === index)
        .sort((a, b) => b.probability - a.probability)[0];
      if (best && best.probability >= CONFIDENT) target = best.saved;
      else if (best && best.probability > 1 - CONFIDENT) {
        match = { kind: "ask", id: best.saved.id, savedName: best.saved.name };
      }
    }
    if (target) {
      const changed = target.ignored ? [] : changes(target, row);
      match = { kind: "same", id: target.id, changes: changed };
    }
    // Fill what this screenshot didn't show from what's already saved.
    const dueAt = row.dueAt ?? target?.dueAt ?? null;
    return {
      name: row.name,
      course: row.course || target?.course || "",
      dueAt,
      status: statusAfterImport(row.status, target),
      include: target?.ignored ? false : row.include,
      flag:
        target?.ignored || (row.flag === "Needs a date" && dueAt)
          ? null
          : row.flag,
      match,
    };
  });
}

/**
 * Leaves out new rows that are already finished on the site (past and closed,
 * or scored): there's nothing to do on them. Closed rows that update something
 * saved still come through.
 */
export function withoutFinishedNew(rows: ReviewRow[]): {
  rows: ReviewRow[];
  skipped: number;
} {
  const kept = rows.filter(
    (row) => !(row.match.kind === "new" && row.status === "closed"),
  );
  return { rows: kept, skipped: rows.length - kept.length };
}

/**
 * Fills in courses the screenshot didn't show. A page usually belongs to one
 * course, so if every row that shows a course shows the same one, the rest get
 * it too. Otherwise TypeSafe picks among the courses already saved, which also
 * keeps one course from being saved under two names.
 */
async function fillCourses(
  rows: CheckedAssignment[],
  saved: SavedAssignment[],
  guessCourse: GuessCourse,
): Promise<CheckedAssignment[]> {
  const shown = new Set(rows.map((row) => row.course).filter(Boolean));
  if (shown.size === 1) {
    const [course] = shown;
    return rows.map((row) => ({ ...row, course: row.course || course }));
  }
  // Rows that match a saved assignment by name take its course later anyway.
  const blanks = rows.flatMap((row, index) =>
    !row.course && !findExact(row, saved) ? [index] : [],
  );
  const courses = courseExamples(saved);
  if (blanks.length === 0 || courses.length === 0) return rows;
  const guesses = await guessCourse(
    blanks.map((index) => rows[index]),
    courses,
  );
  const filled = [...rows];
  blanks.forEach((index, k) => {
    filled[index] = { ...rows[index], course: guesses[k] ?? "" };
  });
  return filled;
}

/** Each saved course once, with up to three of its assignment names. */
export function courseExamples(saved: SavedAssignment[]): CourseExamples[] {
  const courses = new Map<string, CourseExamples>();
  for (const assignment of saved) {
    if (!assignment.course || assignment.ignored) continue;
    const key = courseKey(assignment.course);
    const entry = courses.get(key) ?? {
      course: assignment.course,
      examples: [],
    };
    if (entry.examples.length < 3) entry.examples.push(assignment.name);
    courses.set(key, entry);
  }
  return [...courses.values()];
}

/**
 * A site only knows whether work is available, not whether the student has
 * done it, so work the student marked done stays done. Otherwise the import
 * wins, unless it couldn't tell.
 */
function statusAfterImport(
  imported: Status,
  saved: SavedAssignment | undefined,
): Status {
  if (!saved) return imported;
  if (saved.status === "closed" && saved.closedAt) return "closed";
  return imported === "unknown" ? saved.status : imported;
}

/** What this import would change about a saved assignment, in words. */
function changes(saved: SavedAssignment, row: CheckedAssignment): string[] {
  const list: string[] = [];
  if (row.dueAt && !saved.dueAt)
    list.push(`Due date added: ${shortDate(row.dueAt)}`);
  else if (
    row.dueAt &&
    saved.dueAt &&
    // Compare the clock time shown; pages without a time zone get a guessed offset.
    row.dueAt.slice(0, 16) !== saved.dueAt.slice(0, 16)
  ) {
    list.push(`Due ${shortDate(saved.dueAt)} → ${shortDate(row.dueAt)}`);
  }
  const status = statusAfterImport(row.status, saved);
  if (status !== saved.status) {
    list.push(`${STATUS_LABELS[saved.status]} → ${STATUS_LABELS[status]}`);
  }
  return list;
}

const describe = (row: {
  name: string;
  course: string;
  dueAt: string | null;
}) => ({
  name: row.name,
  course: row.course || "not shown",
  due: row.dueAt ?? "not shown",
});

/** The real judge: one TypeSafe request with a yes/no question per pair. */
export const typeSafeJudgeSame: JudgeSame = async (pairs) => {
  const client = new TypeSafeClient();
  const { answers } = await client.systemOne({
    state: {
      pairs: pairs.map((pair) => ({
        first: describe(pair.imported),
        second: describe(pair.saved),
      })),
    },
    questions: Object.fromEntries(
      pairs.map((_, k) => [
        `same${k}`,
        noul(
          `Are \`pairs[${k}].first\` and \`pairs[${k}].second\` the same piece of coursework, listed under two different names (for example once on Canvas and once on the publisher's site)?`,
        ),
      ]),
    ),
  });
  return pairs.map((_, k) => answers[`same${k}`].noul);
};

/** The real course guesser: one TypeSafe multiple-choice question per row. */
export const typeSafeGuessCourse: GuessCourse = async (rows, courses) => {
  const client = new TypeSafeClient();
  const criteria: Record<string, string> = Object.fromEntries(
    courses.map((entry, k) => [
      `c${k}`,
      `${entry.course}, which has assignments like ${entry.examples.map((name) => `"${name}"`).join(", ")}`,
    ]),
  );
  criteria.other = "A different course that isn't listed here.";
  const { answers } = await client.systemOne({
    state: {
      assignments: rows.map((row) => ({
        name: row.name,
        due: row.dueAt ?? "not shown",
      })),
    },
    questions: Object.fromEntries(
      rows.map((_, k) => [
        `course${k}`,
        choice(
          `Which of the student's courses is \`assignments[${k}]\` for?`,
          criteria,
        ),
      ]),
    ),
  });
  return rows.map((_, k) => {
    const answer = answers[`course${k}`];
    const probability = answer.probabilities[answer.choice] ?? 0;
    if (answer.choice === "other" || probability < CONFIDENT) return null;
    return courses[Number(answer.choice.slice(1))].course;
  });
};
