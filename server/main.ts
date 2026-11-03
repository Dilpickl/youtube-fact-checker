// The server the extension talks to. It holds the Anthropic key, which can't
// go inside the extension where anyone could read it, and finds the checkable
// claims in a video's transcript. It only listens on this computer. Run with:
//   npm run server
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { costOf, findClaims, totals, type Claim } from "./checker.ts";

const PORT = 8787;
// About six hours of captions, far past any video worth checking claim by claim.
const MAX_TRANSCRIPT_CHARS = 400_000;
const MAX_BODY_CHARS = 1_000_000;

// ponytail: kept in memory, so reloading a video doesn't pay again, and lost
// when the server stops; a file or database once people besides Dylan use it.
const claimsByVideo = new Map<string, Promise<Claim[]>>();

export async function handle(
  request: IncomingMessage,
  response: ServerResponse,
) {
  // Web pages send their own Origin; only the extension (or curl) may spend.
  const origin = request.headers.origin;
  if (origin && !origin.startsWith("chrome-extension://"))
    return send(response, 403, { error: "only the extension can use this" });
  if (request.method !== "POST" || request.url !== "/claims")
    return send(response, 404, { error: "not found" });

  let body: unknown;
  try {
    body = JSON.parse(await readBody(request));
  } catch {
    return send(response, 400, { error: "the request wasn't valid JSON" });
  }
  const { videoId, title, transcript } = (body ?? {}) as Record<
    string,
    unknown
  >;
  if (typeof videoId !== "string" || !/^[\w-]{11}$/.test(videoId))
    return send(response, 400, { error: "missing or malformed video id" });
  if (typeof title !== "string" || typeof transcript !== "string")
    return send(response, 400, { error: "missing title or transcript" });
  if (!transcript.trim())
    return send(response, 400, { error: "the transcript is empty" });
  if (transcript.length > MAX_TRANSCRIPT_CHARS)
    return send(response, 413, { error: "this video is too long to check" });

  try {
    const claims = await cachedClaims(
      videoId,
      `Title: ${title.slice(0, 300)}\n\n${transcript}`,
    );
    console.log(
      `${claims.length} claims in "${title}" · spent since start: about $${costOf(totals).toFixed(3)}`,
    );
    send(response, 200, { claims });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`Finding claims failed for ${videoId}: ${reason}`);
    send(response, 502, {
      error: `the language model failed (${reason.slice(0, 200)})`,
    });
  }
}

function cachedClaims(videoId: string, transcript: string) {
  let claims = claimsByVideo.get(videoId);
  if (!claims) {
    claims = findClaims(transcript);
    claimsByVideo.set(videoId, claims);
    // Forget a failure, so trying again asks again.
    claims.catch(() => claimsByVideo.delete(videoId));
  }
  return claims;
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
