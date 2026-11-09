// How many eval claims has a professional fact-checker already checked?
// Sends each claim in the given reports to the Google Fact Check Tools API and
// prints the matches. Usage:
//   node --env-file=.env eval/fact-check-match.ts eval/results/<name>.md ...
import { readFileSync } from "node:fs";
import { readClaims } from "./report.ts";

type ClaimReview = {
  publisher?: { name?: string };
  url?: string;
  textualRating?: string;
};
type SearchResponse = {
  claims?: { text: string; claimReview?: ClaimReview[] }[];
};

const key = process.env.FACT_CHECK_API_KEY;
if (!key) throw new Error("Add FACT_CHECK_API_KEY to .env");
const reports = process.argv.slice(2);
if (reports.length === 0)
  throw new Error("Usage: eval/fact-check-match.ts <report.md> ...");

let total = 0;
let matched = 0;
for (const report of reports) {
  console.log(`\n# ${report}`);
  for (const claim of readClaims(readFileSync(report, "utf8"))) {
    total++;
    const url = new URL(
      "https://factchecktools.googleapis.com/v1alpha1/claims:search",
    );
    url.searchParams.set("query", claim.claim);
    url.searchParams.set("languageCode", "en");
    // The key goes in a header, not the URL, so it never shows up in logs.
    const response = await fetch(url, { headers: { "X-Goog-Api-Key": key } });
    if (!response.ok)
      throw new Error(`${response.status}: ${await response.text()}`);
    const found = ((await response.json()) as SearchResponse).claims ?? [];
    console.log(`\n[${claim.time}] ${claim.claim}`);
    if (found.length === 0) {
      console.log("  no match");
      continue;
    }
    matched++;
    for (const match of found.slice(0, 3)) {
      const review = match.claimReview?.[0];
      console.log(`  "${match.text}"`);
      console.log(
        `    ${review?.publisher?.name}: ${review?.textualRating} ${review?.url}`,
      );
    }
  }
}
console.log(`\n${matched} of ${total} claims had a published fact-check.`);
