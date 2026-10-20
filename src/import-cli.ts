// Usage: npm run import -- path/to/screenshot.png
// Prints the assignments found in a screenshot, flagging rows to double-check.
import { readFile } from "node:fs/promises";
import { describeDue, importScreenshot } from "./import-screenshot.ts";

const path = process.argv[2];
if (!path) {
  console.error("Give a screenshot to read: npm run import -- screenshot.png");
  process.exit(1);
}

let bytes: Uint8Array;
try {
  bytes = await readFile(path);
} catch {
  console.error(`Couldn't open ${path}. Check the file name and try again.`);
  process.exit(1);
}

try {
  const assignments = await importScreenshot(bytes);
  if (assignments.length === 0) {
    console.log("No assignments found in that screenshot.");
  }
  for (const assignment of assignments) {
    const flag = assignment.needsCheck ? "CHECK THIS" : "ok";
    const percent = (p: number) => `${Math.round(p * 100)}%`;
    console.log(
      `[${flag}] ${assignment.name}${assignment.course ? ` (${assignment.course})` : ""}, ` +
        `${describeDue(assignment.dueAt)}, ${assignment.status}` +
        `  · date match ${percent(assignment.dueProbability)}, open ${percent(assignment.openProbability)}`,
    );
  }
} catch (error) {
  console.error(
    `Import failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
