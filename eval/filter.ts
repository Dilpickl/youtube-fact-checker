// Can a cheap TypeSafe judgment decide which claims are worth a web search?
// Asks Jev about each claim in the Haiku reports, then counts how many of the
// claims Haiku flagged (anything but "supported") the filter would keep, and
// how many supported claims it would skip. Usage:
//   node --env-file=.env eval/filter.ts
import { readFileSync, writeFileSync } from "node:fs";
import { readClaims, type ReportClaim } from "./model.ts";

const VIDEOS = [
  "kurzgesagt-first-civilization",
  "berg-do-not-cook-with-this",
  "pbs-midterm-final-stops",
];

const QUESTIONS = {
  doubt: {
    type: "noul",
    instructions:
      "Could `claim`, as a video states it, plausibly be false, exaggerated, or misleading?",
    criteria: {
      true: "A knowledgeable skeptic would want to see sources: a surprising number, a health or safety scare, a sweeping causal claim, or a figure that sounds too precise or too extreme.",
      false:
        "A well-established fact, a rounded textbook figure, or a plain report of what someone said or did that news outlets would routinely confirm.",
    },
  },
  problem: {
    type: "score",
    instructions:
      "How likely is a fact-checker to find a problem with `claim` as a video states it?",
    criteria: [
      "A textbook or widely reported fact; a fact-checker would almost certainly confirm it",
      "Mostly standard, with one specific detail (an exact number, date, or superlative) that could be slightly off",
      "Contested or unusual; experts disagree, or the claim goes beyond what mainstream sources say",
      "Sounds like a known myth, health scare, or exaggeration that fact-checkers often correct",
    ],
  },
};

type Judgment = { doubt: number; problem: number; tokens: number };

async function judge(video: string, claim: string): Promise<Judgment> {
  const response = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "jev-latest",
      state: { video, claim },
      questions: QUESTIONS,
    }),
  });
  if (!response.ok)
    throw new Error(`TypeSafe ${response.status}: ${await response.text()}`);
  const { answers, usage } = await response.json();
  return {
    doubt: answers.doubt.noul,
    problem: answers.problem.score,
    tokens: usage.input_tokens,
  };
}

const rows: (ReportClaim & Judgment)[] = [];
for (const video of VIDEOS) {
  const report = readFileSync(
    `eval/results/${video}-claude-haiku-5-5.md`,
    "utf8",
  );
  const title = report.match(/^# (.*)$/m)?.[1] ?? video;
  const judgments = await Promise.all(
    readClaims(report).map(async (claim) => ({
      ...claim,
      ...(await judge(title, claim.claim)),
    })),
  );
  rows.push(...judgments);
}

const flagged = (row: ReportClaim) => row.verdict !== "supported";
const totalFlagged = rows.filter(flagged).length;
const totalSupported = rows.length - totalFlagged;

/** For each cutoff, how many flagged claims are kept and supported ones skipped. */
function sweep(signal: "doubt" | "problem", cutoffs: number[]) {
  return cutoffs.map((cutoff) => {
    const kept = rows.filter((row) => row[signal] >= cutoff);
    const keptFlagged = kept.filter(flagged).length;
    const skippedSupported = totalSupported - (kept.length - keptFlagged);
    return `| ${signal} ≥ ${cutoff} | ${keptFlagged} of ${totalFlagged} | ${skippedSupported} of ${totalSupported} | ${kept.length} of ${rows.length} |`;
  });
}

const tokens = rows.reduce((sum, row) => sum + row.tokens, 0);
const report = [
  "# TypeSafe filter test",
  "",
  `${rows.length} claims · jev-latest · ${tokens} input tokens in all`,
  "",
  "| Cutoff | Flagged claims kept | Supported claims skipped | Claims searched |",
  "| --- | --- | --- | --- |",
  ...sweep("doubt", [0.2, 0.3, 0.4, 0.5, 0.6, 0.7]),
  ...sweep("problem", [0.5, 0.75, 1, 1.25, 1.5, 2]),
  "",
  "| Doubt | Problem | Haiku | Claim |",
  "| --- | --- | --- | --- |",
  ...rows
    .sort((a, b) => b.doubt - a.doubt)
    .map(
      (row) =>
        `| ${row.doubt.toFixed(2)} | ${row.problem.toFixed(2)} | ${row.verdict} | ${row.claim} |`,
    ),
].join("\n");
writeFileSync("eval/results/filter.md", report);
console.log(report);
