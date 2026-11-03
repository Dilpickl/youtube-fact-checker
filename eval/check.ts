// Accuracy check, run before building the YouTube interface: finds the
// checkable claims in a saved transcript, checks each one with web search, and
// writes a report to grade by hand. Usage:
//   node --env-file=.env eval/check.ts eval/transcripts/<name>.txt [report.md]
// With an earlier report, checks that report's claims instead of finding new
// ones, so two models are compared on the same claims.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import {
  checkClaim,
  findClaims,
  MODEL,
  searchErrors,
  totals,
} from "../server/checker.ts";
import { readClaims, reportSummary } from "./report.ts";

// Twelve checks at once (three videos × four) made a third of the searches
// fail, and the model fell back on memory; two at a time, one video at a time.
const PARALLEL_CHECKS = 2;

/** Runs `work` over `items`, at most `limit` at a time, keeping the order. */
async function mapLimited<T, R>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<R>,
) {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

const path = process.argv[2];
if (!path)
  throw new Error("Usage: node --env-file=.env eval/check.ts <transcript.txt>");
const transcript = readFileSync(path, "utf8");
const title = transcript.match(/^Title: (.*)$/m)?.[1] ?? basename(path);

const earlierReport = process.argv[3];
const claims = earlierReport
  ? readClaims(readFileSync(earlierReport, "utf8"))
  : await findClaims(transcript);
console.log(`${title}: ${claims.length} claims`);
const verdicts = await mapLimited(claims, PARALLEL_CHECKS, async (claim) => {
  try {
    const verdict = await checkClaim(claim, title);
    console.log(`  [${claim.time}] ${verdict.verdict}: ${claim.claim}`);
    return verdict;
  } catch (error) {
    console.log(`  [${claim.time}] failed: ${error}`);
    return null;
  }
});

const summary = reportSummary(claims.length, totals, searchErrors);
const report = [
  `# ${title}`,
  "",
  summary,
  "",
  ...claims.flatMap((claim, k) => {
    const verdict = verdicts[k];
    if (!verdict)
      return [`## [${claim.time}] ${claim.claim}`, "", "Check failed.", ""];
    return [
      `## [${claim.time}] ${verdict.verdict.toUpperCase()}: ${claim.claim}`,
      "",
      `> ${claim.quote}`,
      "",
      verdict.explanation,
      "",
      ...verdict.sources.map((s) => `- [${s.title}](${s.url}): ${s.says}`),
      "",
      "**Grade:** ",
      "",
    ];
  }),
].join("\n");
mkdirSync("eval/results", { recursive: true });
// Named by model, so a cheaper model's run sits beside the Opus reports.
const out = `eval/results/${basename(path, ".txt")}-${MODEL}.md`;
writeFileSync(out, report);
console.log(`Wrote ${out}: ${summary}`);
