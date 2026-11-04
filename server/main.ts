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
// Twelve checks at once made a third of the searches fail, and the model fell
// back on memory (eval/RESULTS.md); two at a time didn't.
const PARALLEL_CHECKS = 2;

// ponytail: kept in memory, so reloading a video doesn't pay again, and lost
// when the server stops; a file or database once people besides Dylan use it.
const claimsByVideo = new Map<string, Promise<Claim[]>>();
const verdictsByClaim = new Map<string, Promise<Verdict>>();

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
