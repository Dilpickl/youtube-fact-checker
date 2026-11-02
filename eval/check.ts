// Accuracy check, run before building the YouTube interface: finds the
// checkable claims in a saved transcript, checks each one with web search, and
// writes a report to grade by hand. Usage:
//   node --env-file=.env eval/check.ts eval/transcripts/<name>.txt
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { z } from "zod";

const MODEL = "claude-opus-5-5";
// ponytail: a fixed cap keeps one run's cost predictable; raise it once the
// verdicts are known to be worth paying for.
const MAX_CLAIMS = 10;
// Twelve checks at once (three videos × four) made a third of the searches
// fail, and the model fell back on memory; two at a time, one video at a time.
const PARALLEL_CHECKS = 2;
const CHECK_TRIES = 3;

const client = new Anthropic();

const ClaimsSchema = z.object({
  claims: z.array(
    z.object({
      time: z.string(),
      quote: z.string(),
      claim: z.string(),
      kind: z.enum(["fact", "statistic", "forecast", "attributed"]),
    }),
  ),
});
type Claim = z.infer<typeof ClaimsSchema>["claims"][number];

const VerdictSchema = z.object({
  verdict: z.enum(["supported", "contradicted", "misleading", "unverified"]),
  explanation: z.string(),
  sources: z.array(
    z.object({ url: z.string(), title: z.string(), says: z.string() }),
  ),
});
type Verdict = z.infer<typeof VerdictSchema>;

const FIND_CLAIMS = `You find the checkable claims in a video transcript for a fact-checker.

A claim counts if a source could support or contradict it today: facts, statistics, dates, and what experts forecast. Leave out opinions, jokes, figures of speech, rhetorical questions, the speaker's plans, and speculation no source could speak to. When someone is quoted, the claim is what they asserted as fact (for example "Collins says she voted against the bill"), not their opinion.

Transcripts are often automatic captions: names may be misspelled and punctuation missing. Write each claim as one standalone sentence with names spelled correctly, so it can be searched without the video. "time" is the timestamp of the line it comes from, and "quote" is the shortest exact span of the transcript it comes from.

Return at most ${MAX_CLAIMS} claims, choosing the ones a viewer would most want checked: specific, consequential, or surprising. Skip near-duplicates.`;

const CHECK_CLAIM = `You check one claim from a video against sources found with web search.

Verdicts:
- supported: reliable sources agree with the claim as stated.
- contradicted: reliable sources say otherwise.
- misleading: partly true, but missing context changes what a viewer would conclude.
- unverified: the sources found don't settle it. This is an honest answer, not a failure; prefer it over guessing.

For a forecast, judge whether it matches what experts actually forecast. Prefer primary sources, scientific reviews, and established outlets over blogs. Keep the explanation to two sentences a viewer could read mid-video. List only sources you actually found, each with what it says about the claim.`;

async function findClaims(transcript: string): Promise<Claim[]> {
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium", format: zodOutputFormat(ClaimsSchema) },
    system: FIND_CLAIMS,
    messages: [{ role: "user", content: transcript }],
  });
  addUsage(response.usage);
  if (!response.parsed_output)
    throw new Error(`No claims: ${response.stop_reason}`);
  return response.parsed_output.claims;
}

/** Checks a claim again when its searches failed, so verdicts rest on sources. */
async function checkClaim(claim: Claim, videoTitle: string): Promise<Verdict> {
  for (let attempt = 1; ; attempt++) {
    const { verdict, failedSearches } = await checkOnce(claim, videoTitle);
    if (failedSearches === 0 || attempt === CHECK_TRIES) {
      if (failedSearches > 0)
        verdict.explanation += ` (${failedSearches} searches failed)`;
      return verdict;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000 * attempt));
  }
}

async function checkOnce(claim: Claim, videoTitle: string) {
  let failedSearches = 0;
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Video: ${videoTitle}\nClaim (at ${claim.time}): ${claim.claim}\nAs said: "${claim.quote}"`,
    },
  ];
  // Web search can pause a long turn; resend the paused turn to let it finish.
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      output_config: {
        effort: "medium",
        format: zodOutputFormat(VerdictSchema),
      },
      system: CHECK_CLAIM,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }],
      messages,
    });
    addUsage(response.usage);
    // A failed search comes back as an error object instead of a result list.
    for (const block of response.content) {
      if (
        block.type === "web_search_tool_result" &&
        !Array.isArray(block.content)
      ) {
        failedSearches++;
        searchErrors.push(block.content.error_code);
      }
    }
    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }
    if (!response.parsed_output)
      throw new Error(`No verdict: ${response.stop_reason}`);
    return { verdict: response.parsed_output, failedSearches };
  }
  throw new Error("Still paused after 4 tries");
}

const totals = { input: 0, output: 0, searches: 0 };
const searchErrors: string[] = [];
function addUsage(usage: Anthropic.Usage) {
  totals.input += usage.input_tokens + (usage.cache_read_input_tokens ?? 0);
  totals.output += usage.output_tokens;
  totals.searches += usage.server_tool_use?.web_search_requests ?? 0;
}

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

const claims = await findClaims(transcript);
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

// Opus 5.5: $4 per million input tokens, $20 per million output, $10 per 1,000 searches.
const cost =
  (totals.input * 4 + totals.output * 20) / 1e6 + totals.searches * 0.01;
const report = [
  `# ${title}`,
  "",
  `${claims.length} claims · ${totals.searches} searches · ${searchErrors.length} failed searches (${[...new Set(searchErrors)].join(", ") || "none"}) · about $${cost.toFixed(2)}`,
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
const out = `eval/results/${basename(path, ".txt")}.md`;
writeFileSync(out, report);
console.log(`Wrote ${out} (about $${cost.toFixed(2)})`);
