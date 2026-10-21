// The website's server: the pages, plus a small JSON API for importing
// screenshots, saving reviewed rows, and marking work done.
// Start it with `npm start`.
import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { dirname } from "node:path";
import { z } from "zod";
import { STATUSES, type ReviewRow } from "./assignment.ts";
import { importScreenshot } from "./import-screenshot.ts";
import { reviewImport, typeSafeJudgeSame } from "./match.ts";
import { openStore, type Store } from "./store.ts";

const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;

const PAGES: Record<string, [file: string, type: string]> = {
  "/": ["web/index.html", "text/html; charset=utf-8"],
  "/styles.css": ["web/styles.css", "text/css; charset=utf-8"],
  "/app.js": ["dist/app.js", "text/javascript; charset=utf-8"],
};

const SaveRequest = z.object({
  rows: z
    .array(
      z.object({
        name: z.string().trim().min(1, "Every row needs a name.").max(300),
        course: z.string().trim().max(100),
        dueAt: z
          .string()
          .refine((value) => !Number.isNaN(Date.parse(value)), "Bad date.")
          .nullable(),
        status: z.enum(STATUSES),
        matchId: z.number().int().positive().nullable(),
        ignored: z.boolean(),
      }),
    )
    .max(500),
});

/** Reads a screenshot into rows to review; tests swap in a fake. */
export type ReviewScreenshot = (
  bytes: Uint8Array,
  store: Store,
) => Promise<ReviewRow[]>;

const reviewScreenshot: ReviewScreenshot = async (bytes, store) =>
  reviewImport(await importScreenshot(bytes), store.list(), typeSafeJudgeSame);

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function createApp(
  store: Store,
  review: ReviewScreenshot = reviewScreenshot,
) {
  return createServer(async (request, response) => {
    try {
      await route(request, response, store, review);
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(response, error.status, { error: error.message });
        return;
      }
      console.error(error instanceof Error ? error.message : error);
      sendJson(response, 500, {
        error: "Something went wrong on the server. Try again.",
      });
    }
  });
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  store: Store,
  review: ReviewScreenshot,
): Promise<void> {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  const page = PAGES[path];

  if (request.method === "GET" && page) {
    const [file, type] = page;
    response.writeHead(200, { "Content-Type": type });
    response.end(await readFile(file));
  } else if (request.method === "GET" && path === "/api/assignments") {
    sendJson(response, 200, store.list());
  } else if (request.method === "POST" && path === "/api/import") {
    const bytes = await readBody(request);
    try {
      sendJson(response, 200, { rows: await review(bytes, store) });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new HttpError(502, `Couldn't read that screenshot: ${reason}`);
    }
  } else if (request.method === "POST" && path === "/api/save") {
    const body = await readBody(request);
    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder().decode(body));
    } catch {
      throw new HttpError(400, "That wasn't valid JSON.");
    }
    const parsed = SaveRequest.safeParse(json);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0].message);
    }
    try {
      store.save(parsed.data.rows);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : "");
    }
    sendJson(response, 200, store.list());
  } else if (
    request.method === "POST" &&
    /^\/api\/assignments\/\d+\/done$/.test(path)
  ) {
    const id = Number(path.split("/")[3]);
    if (!store.setStatus(id, "closed")) {
      throw new HttpError(404, "That assignment doesn't exist anymore.");
    }
    sendJson(response, 200, store.list());
  } else {
    throw new HttpError(404, "Not found.");
  }
}

async function readBody(request: IncomingMessage): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_UPLOAD_BYTES) {
      throw new HttpError(
        413,
        "That file is too big. Use a screenshot under 16 MB.",
      );
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

if (import.meta.main) {
  const databasePath = process.env.DB_PATH ?? "data/assignments.db";
  mkdirSync(dirname(databasePath), { recursive: true });
  const port = Number(process.env.PORT ?? 3000);
  createApp(openStore(databasePath)).listen(port, "127.0.0.1", () => {
    console.log(`Schoolwork assistant running at http://localhost:${port}`);
  });
}
