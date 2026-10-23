// Usage: npm run import -- path/to/screenshot.png   (or page-text.txt)
// Prints the assignments found, with any flags to double-check.
import { readFile } from "node:fs/promises";
import {
  describeDue,
  importScreenshot,
  importText,
} from "./import-screenshot.ts";

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
  const rows = path.endsWith(".txt")
    ? await importText(new TextDecoder().decode(bytes))
    : await importScreenshot(bytes);
  if (rows.length === 0)
    console.log("No assignments found in that screenshot.");
  const percent = (p: number) => `${Math.round(p * 100)}%`;
  for (const row of rows) {
    const label = !row.include ? "LEFT OUT" : (row.flag ?? "ok");
    console.log(
      `[${label}] ${row.name}${row.course ? ` (${row.course})` : ""}, ` +
        `${describeDue(row.dueAt)}, ${row.status}` +
        `  · date ${percent(row.dueProbability)}, ` +
        `TypeSafe status ${row.statusChoice} ${percent(row.statusProbability)}, ` +
        `grade total ${percent(row.totalProbability)}`,
    );
  }
} catch (error) {
  console.error(
    `Import failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
