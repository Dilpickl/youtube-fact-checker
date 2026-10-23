// Reads a Canvas calendar feed (the private .ics link under Calendar →
// Calendar Feed) into rows for the same review step screenshots use. The feed
// lists every dated assignment in the student's courses, but not whether it
// has been submitted.
import { courseCode, type ReviewRow } from "./assignment.ts";
import {
  TIME_ZONE,
  wallClockToIso,
  type CheckedAssignment,
} from "./import-screenshot.ts";

export interface FeedEvent {
  uid: string;
  summary: string;
  /** DTSTART exactly as written, e.g. "20261024T045900Z". */
  start: string;
  /** The TZID parameter on DTSTART, if any. */
  startZone: string | null;
}

/** Why a pasted link isn't a Canvas calendar feed, or null if it looks right. */
export function feedUrlProblem(link: string): string | null {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return "That isn't a link. Copy it from Canvas → Calendar → Calendar Feed.";
  }
  if (url.protocol !== "https:")
    return "The Canvas feed link should start with https://.";
  if (
    !url.pathname.includes("/feeds/calendars/") ||
    !url.pathname.endsWith(".ics")
  ) {
    return "That isn't a calendar feed link. In Canvas, open Calendar and click Calendar Feed at the bottom right.";
  }
  return null;
}

/** Splits iCalendar text into its events, following the format's line folding. */
export function parseFeed(text: string): FeedEvent[] {
  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const events: FeedEvent[] = [];
  let current: Partial<FeedEvent> | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") current = { startZone: null };
    else if (line === "END:VEVENT" && current) {
      if (current.uid && current.summary && current.start) {
        events.push(current as FeedEvent);
      }
      current = null;
    } else if (current) {
      const colon = line.indexOf(":");
      if (colon < 0) continue;
      const [name, ...params] = line.slice(0, colon).split(";");
      const value = line.slice(colon + 1);
      if (name === "UID") current.uid = value;
      else if (name === "SUMMARY") current.summary = unescapeText(value);
      else if (name === "DTSTART") {
        current.start = value;
        const zone = params.find((p) => p.startsWith("TZID="));
        current.startZone = zone ? zone.slice(5) : null;
      }
    }
  }
  return events;
}

const unescapeText = (value: string) =>
  value.replace(/\\([\\,;nN])/g, (_, c: string) =>
    c === "n" || c === "N" ? "\n" : c,
  );

/** The due time as ISO 8601 with the student's offset, or null if unreadable. */
export function dueAtOf(event: FeedEvent, timeZone = TIME_ZONE): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})\d{2}(Z?))?$/.exec(
    event.start,
  );
  if (!match) return null;
  const [, year, month, day, hour, minute, utc] = match;
  if (!hour) {
    // A date with no time: count it as due at the end of that day.
    return wallClockToIso(`${year}-${month}-${day}T23:59`, timeZone);
  }
  if (!utc) {
    return wallClockToIso(
      `${year}-${month}-${day}T${hour}:${minute}`,
      event.startZone ?? timeZone,
    );
  }
  // A UTC time: find the clock time it shows in the student's time zone.
  const instant = new Date(`${year}-${month}-${day}T${hour}:${minute}:00Z`);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  return wallClockToIso(
    `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`,
    timeZone,
  );
}

/**
 * "Discussione 4: La dieta mediterranea [ITAL 101 1 FA26]" → the name, and the
 * course code from the brackets ("ITAL 101"), or the bracket text as is.
 */
export function splitSummary(summary: string): {
  name: string;
  course: string;
} {
  const match = /^(.*)\s\[([^\]]+)\]$/.exec(summary.trim());
  if (!match) return { name: summary.trim(), course: "" };
  return { name: match[1].trim(), course: courseCode(match[2]) };
}

/** Upcoming assignments from the feed, shaped like checked screenshot rows. */
export function feedRows(events: FeedEvent[], now: Date): CheckedAssignment[] {
  const seen = new Set<string>();
  return events.flatMap((event) => {
    // Canvas marks assignments in the UID; other events are calendar entries.
    if (!event.uid.includes("assignment") || seen.has(event.uid)) return [];
    seen.add(event.uid);
    const dueAt = dueAtOf(event);
    if (!dueAt || Date.parse(dueAt) <= now.getTime()) return [];
    return [
      {
        ...splitSummary(event.summary),
        dueAt,
        // The feed doesn't say whether it's submitted; matching keeps a saved
        // status, and newOrChanged opens the rest.
        status: "unknown" as const,
        include: true,
        flag: null,
        // Read from Canvas itself, not from an image: nothing to doubt.
        dueProbability: 1,
        statusChoice: "unknown" as const,
        statusProbability: 1,
        totalProbability: 0,
      },
    ];
  });
}

/** Only what a check should ask about: new rows, and saved ones that changed. */
export function newOrChanged(rows: ReviewRow[]): ReviewRow[] {
  return rows
    .filter((row) => row.match.kind !== "same" || row.match.changes.length > 0)
    .map((row) =>
      row.status === "unknown" && row.match.kind !== "same"
        ? { ...row, status: "open" }
        : row,
    );
}
