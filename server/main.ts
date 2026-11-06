// The server the extension talks to. It holds the Anthropic key, which can't
// go inside the extension where anyone could read it, finds the checkable
// claims in a video's transcript, and checks each claim with web search. It
// only listens on this computer. Run with:
//   npm run server
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import {
  checkClaim,
  costOf,
  findClaims,
  totals,
  type Claim,
  type Verdict,
} from "./checker.ts";

const PORT = 8787;
// About six hours of captions, far past any video worth checking claim by claim.
const MAX_TRANSCRIPT_CHARS = 400_000;
const MAX_BODY_CHARS = 1_000_000;
const MAX_CLAIM_CHARS = 1_000;
// "Check what was just said" sends about 20 seconds of captions.
const MAX_EXCERPT_CHARS = 2_000;
// Pressing it costs a claim search plus a check (about 2.3¢), so it can't be
// spammed: one at a time, and at most this many an hour.
export const PICKS_PER_HOUR = 20;
const HOUR_MS = 60 * 60 * 1000;
// Twelve checks at once made a third of the searches fail, and the model fell
// back on memory (eval/RESULTS.md); two at a time didn't.
const PARALLEL_CHECKS = 2;

// ponytail: kept in memory, so reloading a video doesn't pay again, and lost
// when the server stops; a file or database once people besides Dylan use it.
const claimsByVideo = new Map<string, Promise<Claim[]>>();
const verdictsByClaim = new Map<string, Promise<Verdict>>();
let picking = false;
const pickTimes: number[] = [];

type Answer = { status: number; body: object };
type Route = (body: Record<string, unknown>) => Promise<Answer>;

export async function handle(
  request: IncomingMessage,
  response: ServerResponse,
) {
  // Web pages send their own Origin; only the extension (or curl) may spend.
  const origin = request.headers.origin;
  if (origin && !origin.startsWith("chrome-extension://"))
    return send(response, 403, { error: "only the extension can use this" });
  const route = request.method === "POST" && ROUTES[request.url ?? ""];
  if (!route) return send(response, 404, { error: "not found" });

  let body: unknown;
  try {
    body = JSON.parse(await readBody(request));
  } catch {
    return send(response, 400, { error: "the request wasn't valid JSON" });
  }
  const answer = await route(
    typeof body === "object" && body !== null ? { ...body } : {},
  );
  send(response, answer.status, answer.body);
}

const ROUTES: Record<string, Route> = {
  "/claims": async ({ videoId, title, transcript }) => {
    if (!isVideoId(videoId)) return refuse("missing or malformed video id");
    if (typeof title !== "string" || typeof transcript !== "string")
      return refuse("missing title or transcript");
    if (!transcript.trim()) return refuse("the transcript is empty");
    if (transcript.length > MAX_TRANSCRIPT_CHARS)
      return {
        status: 413,
        body: { error: "this video is too long to check" },
      };
    try {
      const claims = await cached(claimsByVideo, videoId, () =>
        findClaims(`Title: ${title.slice(0, 300)}\n\n${transcript}`),
      );
      log(`${claims.length} claims in "${title}"`);
      return { status: 200, body: { claims } };
    } catch (error) {
      return modelFailed(`Finding claims for ${videoId}`, error);
    }
  },

  "/pick": async ({ videoId, title, excerpt }) => {
    if (!isVideoId(videoId)) return refuse("missing or malformed video id");
    if (typeof title !== "string" || typeof excerpt !== "string")
      return refuse("missing title or captions");
    if (!excerpt.trim()) return refuse("no captions in the last 20 seconds");
    if (excerpt.length > MAX_EXCERPT_CHARS)
      return refuse("too many captions to check at once");
    const limit = pickLimit(Date.now());
    if (limit) return { status: 429, body: { error: limit } };
    picking = true;
    try {
      const claims = await findClaims(
        `Title: ${title.slice(0, 300)}

${excerpt}`,
      );
      // ponytail: the last claim is taken as the one the viewer just heard;
      // ask the model which one if it picks the wrong one in practice.
      const claim = claims.at(-1) ?? null;
      log(`Picked: ${claim?.claim ?? "nothing checkable"}`);
      return { status: 200, body: { claim } };
    } catch (error) {
      return modelFailed(`Picking a claim in ${videoId}`, error);
    } finally {
      picking = false;
    }
  },

  "/check": async ({ videoId, title, claim }) => {
    if (!isVideoId(videoId)) return refuse("missing or malformed video id");
    if (typeof title !== "string") return refuse("missing title");
    const { time, quote, claim: text } = (claim ?? {}) as Partial<Claim>;
    if (
      typeof time !== "string" ||
      typeof quote !== "string" ||
      typeof text !== "string" ||
      !text.trim() ||
      time.length + quote.length + text.length > MAX_CLAIM_CHARS
    )
      return refuse("missing or malformed claim");
    try {
      const verdict = await cached(verdictsByClaim, `${videoId} ${text}`, () =>
        queuedCheck(() =>
          checkClaim({ time, quote, claim: text }, title.slice(0, 300)),
        ).then(sourcedOnly),
      );
      log(`[${time}] ${verdict.verdict}: ${text}`);
      return { status: 200, body: { verdict } };
    } catch (error) {
      return modelFailed(`Checking "${text}"`, error);
    }
  },
};

/**
 * Why a pick must wait, or null when it may go ahead (and is counted).
 * Exported for tests, which pass their own clock.
 */
export function pickLimit(now: number): string | null {
  if (picking) return "still checking the last one";
  while (pickTimes.length > 0 && pickTimes[0] <= now - HOUR_MS)
    pickTimes.shift();
  if (pickTimes.length >= PICKS_PER_HOUR) {
    const minutes = Math.ceil((pickTimes[0] + HOUR_MS - now) / 60_000);
    return `that's ${PICKS_PER_HOUR} checks this hour; try again in ${minutes} min`;
  }
  pickTimes.push(now);
  return null;
}

/** No source, no verdict: one without sources rests on the model's memory. */
export function sourcedOnly(verdict: Verdict): Verdict {
  if (verdict.sources.length > 0 || verdict.verdict === "unverified")
    return verdict;
  return {
    verdict: "unverified",
    explanation: "The web search found no sources to check this against.",
    sources: [],
  };
}

let running = 0;
const waiting: (() => void)[] = [];

/** Runs a check once fewer than PARALLEL_CHECKS are running, in arrival order. */
export async function queuedCheck<T>(work: () => Promise<T>): Promise<T> {
  if (running < PARALLEL_CHECKS) running++;
  else await new Promise<void>((resolve) => waiting.push(resolve));
  try {
    return await work();
  } finally {
    // Hand the slot straight to the next in line, so no newcomer jumps ahead.
    const next = waiting.shift();
    if (next) next();
    else running--;
  }
}

function cached<T>(
  cache: Map<string, Promise<T>>,
  key: string,
  work: () => Promise<T>,
): Promise<T> {
  let result = cache.get(key);
  if (!result) {
    result = work();
    cache.set(key, result);
    // Forget a failure, so trying again asks again.
    result.catch(() => cache.delete(key));
  }
  return result;
}

function isVideoId(value: unknown): value is string {
  return typeof value === "string" && /^[\w-]{11}$/.test(value);
}

function refuse(error: string): Answer {
  return { status: 400, body: { error } };
}

function modelFailed(what: string, error: unknown): Answer {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`${what} failed: ${reason}`);
  return {
    status: 502,
    body: { error: `the language model failed (${reason.slice(0, 200)})` },
  };
}

function log(line: string) {
  console.log(
    `${line} · spent since start: about $${costOf(totals).toFixed(3)}`,
  );
}

async function readBody(request: IncomingMessage) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > MAX_BODY_CHARS) throw new Error("request too large");
  }
  return body;
}

function send(response: ServerResponse, status: number, body: object) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

if (import.meta.main) {
  createServer((request, response) => {
    handle(request, response).catch((error) => {
      console.error(error);
      if (!response.headersSent) send(response, 500, { error: "server error" });
    });
  }).listen(PORT, "127.0.0.1", () =>
    console.log(`Fact-check server listening on http://127.0.0.1:${PORT}`),
  );
}
