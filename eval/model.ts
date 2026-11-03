// The model the accuracy check runs on, what a run costs, and reading the
// claims back out of an earlier report.
export const MODEL = "claude-haiku-5-5";

// Haiku 5.5: $0.10 per million input tokens, $0.50 per million output, $10 per
// 1,000 searches.
// ponytail: these rates hold for prompts up to 100K tokens ($0.50 / $2.50
// beyond); price per request from usage if a check's searches grow that large.
const INPUT_PRICE = 0.1;
const OUTPUT_PRICE = 0.5;
const SEARCH_PRICE = 0.01;

export type Usage = { input: number; output: number; searches: number };

/** The line under a report's title: model, claims, searches, and cost. */
export function reportSummary(
  claimCount: number,
  usage: Usage,
  searchErrors: string[],
) {
  const cost =
    (usage.input * INPUT_PRICE + usage.output * OUTPUT_PRICE) / 1e6 +
    usage.searches * SEARCH_PRICE;
  const errorKinds = [...new Set(searchErrors)].join(", ") || "none";
  return `${MODEL} · ${claimCount} claims · ${usage.searches} searches · ${searchErrors.length} failed searches (${errorKinds}) · about $${cost.toFixed(2)}`;
}

export type ReportClaim = {
  time: string;
  claim: string;
  quote: string;
  /** "supported", "misleading", ... or "" when the check failed. */
  verdict: string;
};

/** The claims in a report, so another model can check exactly the same ones. */
export function readClaims(report: string): ReportClaim[] {
  const claims: ReportClaim[] = [];
  const lines = report.split(/\r?\n/);
  lines.forEach((line, k) => {
    // "## [1:28] SUPPORTED: claim", or "## [1:28] claim" when the check failed.
    const heading = line.match(/^## \[(.+?)\] (?:([A-Z]+): )?(.*)$/);
    if (!heading) return;
    const quote = lines[k + 2]?.match(/^> (.*)$/)?.[1] ?? "";
    claims.push({
      time: heading[1],
      claim: heading[3],
      quote,
      verdict: heading[2]?.toLowerCase() ?? "",
    });
  });
  return claims;
}
