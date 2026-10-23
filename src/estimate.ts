// How long each assignment will take, judged once by TypeSafe and saved.
// The learning milestone will correct these with real focus-timer times.
import { score, TypeSafeClient } from "@typesafe-ai/sdk";
import type { SavedAssignment } from "./assignment.ts";

/** Minutes for each level of the scale below, shortest first. */
const LEVEL_MINUTES = [10, 30, 60, 150, 360];
const LEVELS = [
  "About 10 minutes: a short quiz, a quick post, or a small check-in.",
  "About 30 minutes: a typical online homework set or a short discussion post or recording.",
  "About 1 hour: a longer problem set or a short written response.",
  "About 2 to 3 hours: a lab report, a project milestone, or a short paper.",
  "Most of a day or more: a large project, a long paper, or studying for an exam.",
] as const;

/**
 * Combines the level probabilities on a log scale (a weighted geometric mean),
 * so a small chance of "most of a day" doesn't swamp a likely 30 minutes.
 */
export function minutesFromProbabilities(probabilities: number[]): number {
  const total = probabilities.reduce((sum, p) => sum + p, 0) || 1;
  const logMinutes = probabilities.reduce(
    (sum, p, level) => sum + (p / total) * Math.log(LEVEL_MINUTES[level]),
    0,
  );
  return Math.round(Math.exp(logMinutes));
}

/** Estimates, keyed by assignment id; tests swap in a fake. */
export type EstimateMinutes = (
  assignments: SavedAssignment[],
) => Promise<Map<number, number>>;

export const typeSafeEstimateMinutes: EstimateMinutes = async (assignments) => {
  if (assignments.length === 0) return new Map();
  const client = new TypeSafeClient();
  const { answers } = await client.systemOne({
    state: {
      assignments: assignments.map((assignment) => ({
        name: assignment.name,
        course: assignment.course || "not shown",
      })),
    },
    questions: Object.fromEntries(
      assignments.map((_, k) => [
        `minutes${k}`,
        score(
          `How long will a typical college student need to finish \`assignments[${k}]\`?`,
          LEVELS,
        ),
      ]),
    ),
  });
  return new Map(
    assignments.map((assignment, k) => {
      // Probabilities come keyed by level number ("0" to "4").
      const probabilities: Record<number, number> =
        answers[`minutes${k}`].probabilities;
      const ordered = LEVELS.map((_, level) => probabilities[level] ?? 0);
      return [assignment.id, minutesFromProbabilities(ordered)];
    }),
  );
};
