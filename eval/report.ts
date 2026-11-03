// Writing and reading back the accuracy check's reports.
import { costOf, MODEL, type Usage } from "../server/checker.ts";

/** The line under a report's title: model, claims, searches, and cost. */
export function reportSummary(
  claimCount: number,
  usage: Usage,
  searchErrors: string[],
) {
  const errorKinds = [...new Set(searchErrors)].join(", ") || "none";
  return `${MODEL} · ${claimCount} claims · ${usage.searches} searches · ${searchErrors.length} failed searches (${errorKinds}) · about $${costOf(usage).toFixed(2)}`;
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
