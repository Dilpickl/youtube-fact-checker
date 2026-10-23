// Reads a public course page from a link, as text for the same import that
// pasted text uses. Pages behind a login (Gradescope, PrairieLearn, Canvas)
// can't be fetched this way; the student copies their text instead.

const MAX_PAGE_BYTES = 3 * 1024 * 1024;
/** Less text than this means the page is mostly built by its own scripts. */
const MIN_PAGE_CHARACTERS = 200;
const COPY_INSTEAD =
  "Open the page, select everything (Ctrl+A), copy it, and paste the text here instead.";

/** Why a link can't be read, or null if it's fine to fetch. */
export function linkProblem(link: string): string | null {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return "That isn't a link.";
  }
  if (url.protocol !== "https:") return "Use a link that starts with https://.";
  const host = url.hostname;
  // Only public websites: never this computer or the local network.
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    /^[\d.]+$/.test(host) ||
    host.includes(":") ||
    host.startsWith("[")
  ) {
    return "Use a link to a public website.";
  }
  return null;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** The readable text of an HTML page, one block per line. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(
      /<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/td|\/th|\/section)\b[^>]*>/gi,
      "\n",
    )
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (entity, code: string) => {
      if (code.startsWith("#x") || code.startsWith("#X")) {
        return String.fromCodePoint(parseInt(code.slice(2), 16));
      }
      if (code.startsWith("#"))
        return String.fromCodePoint(Number(code.slice(1)));
      return ENTITIES[code.toLowerCase()] ?? entity;
    })
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/ *\n[\s]*/g, "\n")
    .trim();
}

/** Turns a fetched page into text, or explains why it can't be imported. */
export function pageText(html: string): string {
  if (/<input[^>]+type=["']?password/i.test(html)) {
    throw new Error(`That page asks you to log in. ${COPY_INSTEAD}`);
  }
  const text = htmlToText(html);
  if (text.length < MIN_PAGE_CHARACTERS) {
    throw new Error(
      `That page builds itself in the browser, so it can't be read from a link. ${COPY_INSTEAD}`,
    );
  }
  return text;
}

/** Fetches a public page's HTML; tests swap in a fake. */
export async function fetchPage(link: string): Promise<string> {
  const response = await fetch(link, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) {
    throw new Error(`That page answered ${response.status}. ${COPY_INSTEAD}`);
  }
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("html") && !type.includes("text")) {
    throw new Error("That link isn't a web page.");
  }
  const html = await response.text();
  if (html.length > MAX_PAGE_BYTES) {
    throw new Error(`That page is too big to read. ${COPY_INSTEAD}`);
  }
  return html;
}
