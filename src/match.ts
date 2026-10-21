// Decides how each imported row relates to what's already saved, so the same
// assignment is never saved twice. Code finds the candidates (same name, or
// same course with a due date within a day); TypeSafe judges the candidates
// whose names differ, like "Connect: Lessico 6" on Canvas and "Lessico- 6".
import { noul, TypeSafeClient } from "@typesafe-ai/sdk";
import {
  shortDate,
  STATUS_LABELS,
  type Match,
  type ReviewRow,
  type SavedAssignment,
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

/** An empty course means the screenshot didn't show one, so it can match any. */
const coursesFit = (a: string, b: string) =>
  !a || !b || normalizeName(a) === normalizeName(b);

const datesClose = (a: string | null, b: string | null) =>
  a && b ? Math.abs(Date.parse(a) - Date.parse(b)) <= DAY_MS : a === b;

export interface CandidatePair {
  imported: CheckedAssignment;
  saved: SavedAssignment;
}

/** Probability, for each pair, that both rows are the same assignment. */
export type JudgeSame = (pairs: CandidatePair[]) => Promise<number[]>;

export async function reviewImport(
  rows: CheckedAssignment[],
  saved: SavedAssignment[],
  judgeSame: JudgeSame,
): Promise<ReviewRow[]> {
  const exact = rows.map((row) =>
    saved.find(
      (candidate) =>
        coursesFit(row.course, candidate.course) &&
        [candidate.name, ...candidate.aliases].some(
          (name) => normalizeName(name) === normalizeName(row.name),
        ),
    ),
  );

  const pairs: (CandidatePair & { row: number })[] = [];
  rows.forEach((row, index) => {
    if (exact[index]) return;
    for (const candidate of saved) {
      if (
        coursesFit(row.course, candidate.course) &&
        datesClose(row.dueAt, candidate.dueAt)
      ) {
        pairs.push({ row: index, imported: row, saved: candidate });
      }
    }
  });
  const probabilities = pairs.length > 0 ? await judgeSame(pairs) : [];

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
      match = { kind: "same", id: target.id, changes: changes(target, row) };
    }
    // Fill what this screenshot didn't show from what's already saved.
    const dueAt = row.dueAt ?? target?.dueAt ?? null;
    return {
      name: row.name,
      course: row.course || target?.course || "",
      dueAt,
      status: row.status === "unknown" && target ? target.status : row.status,
      include: target?.ignored ? false : row.include,
      flag:
        target?.ignored || (row.flag === "Needs a date" && dueAt)
          ? null
          : row.flag,
      match,
    };
  });
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
  if (row.status !== "unknown" && row.status !== saved.status) {
    list.push(`${STATUS_LABELS[saved.status]} → ${STATUS_LABELS[row.status]}`);
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
