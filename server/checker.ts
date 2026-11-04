// Finds the checkable claims in a video's transcript and checks each one with
// web search. Shared by the server the extension talks to and by the accuracy
// check in eval/, so both run the prompts that were tested.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

export const MODEL = "claude-haiku-5-5";
// ponytail: a fixed cap keeps a video's cost predictable (about 17¢ at Haiku
// rates); raise it once long videos need more claims.
const MAX_CLAIMS = 10;
const CHECK_TRIES = 3;

// Haiku 5.5: $0.10 per million input tokens, $0.50 per million output, $10 per
// 1,000 searches.
// ponytail: these rates hold for prompts up to 100K tokens ($0.50 / $2.50
// beyond); price per request from usage if a check's searches grow that large.
const INPUT_PRICE = 0.1;
const OUTPUT_PRICE = 0.5;
const SEARCH_PRICE = 0.01;

export type Usage = { input: number; output: number; searches: number };

/** Dollars spent for the given usage. */
export function costOf(usage: Usage) {
  return (
    (usage.input * INPUT_PRICE + usage.output * OUTPUT_PRICE) / 1e6 +
    usage.searches * SEARCH_PRICE
  );
}

/** Everything spent since this process started. */
export const totals: Usage = { input: 0, output: 0, searches: 0 };
export const searchErrors: string[] = [];

// Created on first use, so importing this file needs no API key (tests don't).
let anthropic: Anthropic | undefined;
const client = () => (anthropic ??= new Anthropic());

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
export type Claim = Pick<
  z.infer<typeof ClaimsSchema>["claims"][number],
  "time" | "quote" | "claim"
>;

const VerdictSchema = z.object({
  verdict: z.enum(["supported", "contradicted", "misleading", "unverified"]),
  explanation: z.string(),
  sources: z.array(
    z.object({ url: z.string(), title: z.string(), says: z.string() }),
  ),
});
export type Verdict = z.infer<typeof VerdictSchema>;

const FIND_CLAIMS = `You find the checkable claims in a video transcript for a fact-checker.

A claim counts if a source could support or contradict it today: facts, statistics, dates, and what experts forecast. Leave out opinions, jokes, figures of speech, rhetorical questions, the speaker's plans, and speculation no source could speak to. When someone is quoted, the claim is what they asserted as fact (for example "Collins says she voted against the bill"), not their opinion.

Transcripts are often automatic captions: names may be misspelled and punctuation missing. Write each claim as one standalone sentence with names spelled correctly, so it can be searched without the video. "time" is the timestamp of the line it comes from, and "quote" is the shortest exact span of the transcript it comes from.

Return at most ${MAX_CLAIMS} claims, choosing the ones a viewer would most want checked: specific, consequential, or surprising. Skip near-duplicates.`;

const CHECK_CLAIM = `You check one claim from a video against sources found with web search.

Verdicts:
- supported: reliable sources agree with the claim as stated. A rounded number, or one inside the range experts give, is supported; mention the precise figure in the explanation.
- contradicted: reliable sources say otherwise.
- misleading: partly true, but a viewer would come away believing something false. A missing qualifier, or a debate among experts the claim takes one mainstream side of, is not enough on its own.
- unverified: the sources found don't address it. This is an honest answer, not a failure; prefer it over guessing. But a specific claim that no research supports, where reliable sources say the effect it describes doesn't exist, is contradicted.

Sources must speak to the claim as stated: guidelines or recommendations about what people should do don't contradict a claim about what they actually do. When the claim is that someone said or reported something, judge whether they said it, not whether it is true. For a forecast, judge whether it matches what experts actually forecast. Prefer primary sources, scientific reviews, and established outlets over blogs. Keep the explanation to two sentences a viewer could read mid-video. List only sources you actually found, each with what it says about the claim.`;

/** The claims a viewer would most want checked, from a transcript with a "Title:" line. */
export async function findClaims(transcript: string): Promise<Claim[]> {
  const response = await client().messages.parse({
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
export async function checkClaim(
  claim: Claim,
  videoTitle: string,
): Promise<Verdict> {
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
    const response = await client().messages.parse({
      model: MODEL,
      max_tokens: 16000,
      output_config: {
        effort: "medium",
        format: zodOutputFormat(VerdictSchema),
      },
      system: CHECK_CLAIM,
      // The 2026-02-09 search (with filtering) is for Opus and Sonnet only.
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
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

function addUsage(usage: Anthropic.Usage) {
  totals.input += usage.input_tokens + (usage.cache_read_input_tokens ?? 0);
  totals.output += usage.output_tokens;
  totals.searches += usage.server_tool_use?.web_search_requests ?? 0;
}
