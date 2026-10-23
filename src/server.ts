// The website's server: the pages, plus a small JSON API for importing
// screenshots, checking the Canvas feed, saving reviewed rows, estimating
// work, logging work sessions, and changing an assignment's status.
// Start it with `npm start`, which restarts it when code changes.
import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { dirname } from "node:path";
import { z } from "zod";
import {
  STATUSES,
  type ReviewRow,
  type SavedAssignment,
} from "./assignment.ts";
import { feedRows, feedUrlProblem, newOrChanged, parseFeed } from "./canvas.ts";
import { typeSafeEstimateMinutes, type EstimateMinutes } from "./estimate.ts";
import {
  importScreenshot,
  type CheckedAssignment,
} from "./import-screenshot.ts";
import {
  reviewImport,
  typeSafeGuessCourse,
  typeSafeJudgeSame,
} from "./match.ts";
import { openStore, type Store } from "./store.ts";

const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;

const PAGES: Record<string, [file: string, type: string]> = {
  "/": ["web/index.html", "text/html; charset=utf-8"],
  "/styles.css": ["web/styles.css", "text/css; charset=utf-8"],
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

const StatusRequest = z.object({ status: z.enum(STATUSES) });

const WorkRequest = z.object({
  minutes: z
    .number()
    .int()
    .min(1)
    .max(24 * 60),
  /** True when this session finished the whole assignment. */
  finished: z.boolean(),
});

const CanvasRequest = z.object({ feedUrl: z.string().max(2000) });

const CANVAS_FEED = "canvasFeedUrl";
const CANVAS_CHECKED = "canvasLastChecked";

/** Compares imported rows with what's saved, using TypeSafe's judgments. */
const matchRows = (rows: CheckedAssignment[], saved: SavedAssignment[]) =>
  reviewImport(rows, saved, {
    same: typeSafeJudgeSame,
    course: typeSafeGuessCourse,
  });

async function fetchFeed(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Canvas answered ${response.status}`);
  return response.text();
}

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** What the server calls out to; tests swap in fakes. */
export interface Services {
  readScreenshot: (bytes: Uint8Array) => Promise<CheckedAssignment[]>;
  match: typeof matchRows;
  fetchFeed: (url: string) => Promise<string>;
  estimate: EstimateMinutes;
  /** The page's bundled script, built at startup. */
  pageScript: string;
}

export function createApp(store: Store, overrides: Partial<Services> = {}) {
  const services: Services = {
    readScreenshot: importScreenshot,
    match: matchRows,
    fetchFeed,
    estimate: typeSafeEstimateMinutes,
    pageScript: "",
    ...overrides,
  };
  return createServer(async (request, response) => {
    try {
      await route(request, response, store, services);
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
  services: Services,
): Promise<void> {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  const page = PAGES[path];

  if (request.method === "GET" && page) {
    const [file, type] = page;
    response.writeHead(200, { "Content-Type": type });
    response.end(await readFile(file));
  } else if (request.method === "GET" && path === "/app.js") {
    response.writeHead(200, {
      "Content-Type": "text/javascript; charset=utf-8",
    });
    response.end(services.pageScript);
  } else if (request.method === "GET" && path === "/api/assignments") {
    sendJson(response, 200, store.list());
  } else if (request.method === "POST" && path === "/api/estimates") {
    // Estimates each task that can still be worked on and has none yet.
    const missing = store
      .list()
      .filter(
        (assignment) =>
          assignment.estimateMinutes === null &&
          !assignment.ignored &&
          assignment.status !== "closed",
      );
    try {
      store.setEstimates(await services.estimate(missing));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new HttpError(502, `Couldn't estimate your tasks: ${reason}`);
    }
    sendJson(response, 200, store.list());
  } else if (request.method === "POST" && path === "/api/import") {
    const bytes = await readBody(request);
    try {
      const rows = await services.readScreenshot(bytes);
      sendJson(response, 200, {
        rows: await services.match(rows, store.list()),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new HttpError(502, `Couldn't read that screenshot: ${reason}`);
    }
  } else if (request.method === "POST" && path === "/api/save") {
    const json = await readJson(request);
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
    /^\/api\/assignments\/\d+\/status$/.test(path)
  ) {
    const id = Number(path.split("/")[3]);
    const parsed = StatusRequest.safeParse(await readJson(request));
    if (!parsed.success) throw new HttpError(400, "That isn't a status.");
    if (!store.setStatus(id, parsed.data.status)) {
      throw new HttpError(404, "That assignment doesn't exist anymore.");
    }
    sendJson(response, 200, store.list());
  } else if (
    request.method === "POST" &&
    /^\/api\/assignments\/\d+\/work$/.test(path)
  ) {
    const id = Number(path.split("/")[3]);
    const parsed = WorkRequest.safeParse(await readJson(request));
    if (!parsed.success) throw new HttpError(400, "That isn't a work session.");
    const sessionId = store.logWork(id, parsed.data.minutes);
    if (sessionId === null) {
      throw new HttpError(404, "That assignment doesn't exist anymore.");
    }
    if (parsed.data.finished) store.setStatus(id, "closed");
    sendJson(response, 200, { sessionId, assignments: store.list() });
  } else if (
    request.method === "POST" &&
    /^\/api\/assignments\/\d+\/reopen$/.test(path)
  ) {
    if (!store.reopen(Number(path.split("/")[3]))) {
      throw new HttpError(404, "That assignment isn't marked done.");
    }
    sendJson(response, 200, store.list());
  } else if (request.method === "DELETE" && /^\/api\/work\/\d+$/.test(path)) {
    if (!store.deleteWork(Number(path.split("/")[3]))) {
      throw new HttpError(404, "That session was already removed.");
    }
    sendJson(response, 200, store.list());
  } else if (path === "/api/canvas") {
    await canvasSettings(request, response, store);
  } else if (request.method === "POST" && path === "/api/canvas/check") {
    const feedUrl = store.getSetting(CANVAS_FEED);
    if (!feedUrl) throw new HttpError(400, "Connect Canvas first.");
    let rows: ReviewRow[];
    try {
      const events = parseFeed(await services.fetchFeed(feedUrl));
      rows = await services.match(feedRows(events, new Date()), store.list());
    } catch (error) {
      // Never echo the feed link: it works like a password.
      const reason = error instanceof Error ? error.message : String(error);
      throw new HttpError(502, `Couldn't read your Canvas feed: ${reason}`);
    }
    store.setSetting(CANVAS_CHECKED, new Date().toISOString());
    sendJson(response, 200, { rows: newOrChanged(rows) });
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

/** GET says whether Canvas is connected; PUT saves a feed link; DELETE forgets it. */
async function canvasSettings(
  request: IncomingMessage,
  response: ServerResponse,
  store: Store,
) {
  if (request.method === "PUT") {
    const parsed = CanvasRequest.safeParse(await readJson(request));
    const problem = parsed.success
      ? feedUrlProblem(parsed.data.feedUrl)
      : "Paste the Canvas feed link.";
    if (problem) throw new HttpError(400, problem);
    store.setSetting(CANVAS_FEED, parsed.data!.feedUrl.trim());
    store.setSetting(CANVAS_CHECKED, null);
  } else if (request.method === "DELETE") {
    store.setSetting(CANVAS_FEED, null);
    store.setSetting(CANVAS_CHECKED, null);
  } else if (request.method !== "GET") {
    throw new HttpError(404, "Not found.");
  }
  sendJson(response, 200, {
    connected: store.getSetting(CANVAS_FEED) !== null,
    lastChecked: store.getSetting(CANVAS_CHECKED),
  });
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const body = await readBody(request);
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new HttpError(400, "That wasn't valid JSON.");
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

if (import.meta.main) {
  // Build the page's script in memory on every start; `npm start` restarts the
  // server when src/ or web/ changes, so the page is never stale. (Writing it
  // to disk instead made Node's watcher on Windows restart in a loop.)
  const { build } = await import("esbuild");
  const { outputFiles } = await build({
    entryPoints: ["web/app.ts"],
    bundle: true,
    format: "esm",
    target: "es2022",
    write: false,
    logLevel: "warning",
  });
  const databasePath = process.env.DB_PATH ?? "data/assignments.db";
  mkdirSync(dirname(databasePath), { recursive: true });
  const port = Number(process.env.PORT ?? 3000);
  const pageScript = outputFiles[0].text;
  const server = createApp(openStore(databasePath), { pageScript });
  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EADDRINUSE") throw error;
    console.error(
      `Port ${port} is already in use, probably by another copy of this server. ` +
        "Stop that one (Ctrl+C in its terminal) and run npm start again.",
    );
    process.exit(1);
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`Schoolwork assistant running at http://localhost:${port}`);
  });
}
