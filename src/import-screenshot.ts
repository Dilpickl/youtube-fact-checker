// Turns a screenshot of any course site into a checked list of assignments.
// Claude Haiku reads the image and lists what it sees (TypeSafe answers
// questions but doesn't write text); TypeSafe then checks each row against the
// same image, and rows it doubts are flagged for the student to confirm.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { choice, image, noul, TypeSafeClient } from "@typesafe-ai/sdk";
import sharp from "sharp";
import { z } from "zod";
import { STATUSES, type Status } from "./assignment.ts";

const EXTRACT_MODEL = "claude-haiku-5-5";
const MAX_IMAGE_SIDE = 1568;
// ponytail: one time zone for every page, the student's; a page showing times
// in another zone would be read as local. Add per-page zones if that happens.
export const TIME_ZONE = process.env.TIME_ZONE ?? "America/Chicago";
// ponytail: one fixed cutoff for "confident"; tune it once there's a test set
// of real screenshots with known answers.
export const CONFIDENT = 0.7;

const ExtractedSchema = z.object({
  name: z.string(),
  course: z.string(),
  dueAt: z.string().nullable(),
  status: z.enum(STATUSES),
  kind: z.enum(["task", "grade_total"]),
});
const ExtractionSchema = z.object({ assignments: z.array(ExtractedSchema) });

export type Extracted = z.infer<typeof ExtractedSchema>;

/** TypeSafe's answers about one row, checked against the image. */
export interface RowCheck {
  /** Probability the screenshot shows this name with this due date. */
  dueProbability: number;
  /** TypeSafe's own pick for the status, and its probability. */
  statusChoice: Status;
  statusProbability: number;
  /** Probability the row is a gradebook total rather than one piece of work. */
  totalProbability: number;
}

export interface CheckedAssignment extends RowCheck {
  name: string;
  course: string;
  dueAt: string | null;
  status: Status;
  include: boolean;
  flag: string | null;
}

const STATUS_MEANINGS: Record<Status, string> = {
  open: "It can be worked on now.",
  not_open_yet:
    "The page says it isn't available yet, for example 'Not available until …'.",
  closed: "It is locked, submitted, completed, or past due.",
  unknown: "The page doesn't show whether it can be worked on.",
};

export type ImageFormat = "png" | "jpeg";

/** Reads the format from the file's first bytes; both APIs accept only these two. */
export function imageFormat(bytes: Uint8Array): ImageFormat | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpeg";
  return null;
}

/**
 * Combines Claude's reading with TypeSafe's check. A confident TypeSafe answer
 * fills in what Claude couldn't tell; an unsure one (near 50%) defers to
 * Claude. Rows both models call grade totals are left out.
 */
export function resolveRow(
  extracted: Pick<Extracted, "status" | "kind" | "dueAt">,
  check: RowCheck,
): { status: Status; include: boolean; flag: string | null } {
  const typeSafeStatus =
    check.statusProbability >= CONFIDENT ? check.statusChoice : "unknown";
  const status =
    extracted.status === "unknown" ? typeSafeStatus : extracted.status;
  const statusConflict =
    extracted.status !== "unknown" &&
    typeSafeStatus !== "unknown" &&
    typeSafeStatus !== extracted.status;

  const claudeSaysTotal = extracted.kind === "grade_total";
  const typeSafeSaysTotal = check.totalProbability >= 0.5;
  if (claudeSaysTotal && typeSafeSaysTotal) {
    return { status, include: false, flag: null };
  }

  // The models disagree on grade totals often (neither can see how the course
  // grades). Default to Claude, which reads the whole page, and let the
  // student decide; their answer is remembered for later imports.
  if (claudeSaysTotal !== typeSafeSaysTotal) {
    return {
      status,
      include: !claudeSaysTotal,
      flag: "Might be a grade total",
    };
  }

  let flag: string | null = null;
  if (!extracted.dueAt && status !== "closed") flag = "Needs a date";
  else if (check.dueProbability < CONFIDENT) flag = "Check the date";
  else if (statusConflict || status === "unknown") flag = "Check the status";
  return { status, include: true, flag };
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * "2026-11-13T23:59" in America/Chicago → "2026-11-13T23:59:00-06:00": the
 * offset in effect on that date, so daylight saving time is handled.
 */
export function wallClockToIso(wallClock: string, timeZone: string): string {
  const offsetAt = (instant: number) => {
    const name =
      new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
        .formatToParts(instant)
        .find((part) => part.type === "timeZoneName")?.value ?? "";
    const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
    if (!match) return 0; // "GMT" alone means no offset
    const minutes = Number(match[2]) * 60 + Number(match[3]);
    return match[1] === "-" ? -minutes : minutes;
  };
  const asUtc = Date.parse(`${wallClock}:00Z`);
  // The offset depends on the instant and the instant on the offset; one
  // correction settles it.
  const offset = offsetAt(asUtc - offsetAt(asUtc) * 60_000);
  const abs = Math.abs(offset);
  return `${wallClock}:00${offset < 0 ? "-" : "+"}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/**
 * "2026-10-20T23:59:00-05:00" → "due Oct 20 at 11:59 PM", as the page showed
 * it. No year: most pages don't show one, so TypeSafe couldn't confirm it.
 */
export function describeDue(dueAt: string | null): string {
  if (!dueAt) return "with no due date shown";
  // Drop the offset and format as UTC so the clock time isn't shifted.
  const local = new Date(`${dueAt.slice(0, 19)}Z`);
  if (Number.isNaN(local.getTime())) return `due ${dueAt}`;
  const date = local.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
  const time = local.toLocaleTimeString("en-US", {
    timeZone: "UTC",
    hour: "numeric",
    minute: "2-digit",
  });
  return `due ${date} at ${time}`;
}

async function extractAssignments(
  bytes: Uint8Array,
  format: ImageFormat,
  today: Date,
): Promise<Extracted[]> {
  const client = new Anthropic();
  const response = await client.messages.parse({
    model: EXTRACT_MODEL,
    max_tokens: 16000,
    output_config: { format: zodOutputFormat(ExtractionSchema) },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: `image/${format}`,
              data: Buffer.from(bytes).toString("base64"),
            },
          },
          {
            type: "text",
            text: `This is a screenshot of a course website. List every assignment, quiz, exam, or other task it shows.
- name: exactly as written on the page.
- course: the course code if the page shows one anywhere, including in a link or breadcrumb (for example "ITAL 101"), otherwise "".
- dueAt: the due date and time exactly as the page shows them, written as YYYY-MM-DDTHH:MM in 24-hour time with no time zone, for example "2026-11-13T23:59". If no year is shown, use the next such date on or after ${today.toDateString()}. If there's no due date, null. Use the due date, never a start or available date.
- status: "not_open_yet" if the page says it isn't available yet (for example "Not available until Oct 26"); "closed" if it's locked, submitted, completed, or past due; "open" if it can be worked on now; "unknown" if the page doesn't say.
- kind: "grade_total" if the row is a gradebook category or running total rather than one piece of work: it typically has no due date and shows points earned out of a large total that adds up many smaller assignments. Otherwise "task".
Include only what is visible. Don't invent tasks or dates.`,
          },
        ],
      },
    ],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) {
    throw new Error("Claude couldn't read assignments from that screenshot.");
  }
  // The model copies the clock time; code adds the offset, so daylight saving
  // time is right (the model gave November dates the October offset).
  return response.parsed_output.assignments.map((row) => {
    const wallClock = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.exec(
      row.dueAt ?? "",
    )?.[0];
    return {
      ...row,
      dueAt: wallClock ? wallClockToIso(wallClock, TIME_ZONE) : null,
    };
  });
}

async function checkAssignments(
  bytes: Uint8Array,
  today: Date,
  rows: Extracted[],
): Promise<CheckedAssignment[]> {
  if (rows.length === 0) return [];
  const client = new TypeSafeClient({
    defaultHeaders: { "TypeSafe-Danger-Zone-Images": "true" },
  });
  // All rows go in one request; TypeSafe answers the questions in parallel.
  const questions = Object.fromEntries(
    rows.flatMap((row, index) => [
      [
        `due${index}`,
        noul(
          `Does \`screenshot\` show a task named "${row.name}" ${describeDue(row.dueAt)}?`,
        ),
      ],
      [
        `status${index}`,
        choice(
          `Today is \`today\`. In \`screenshot\`, what is the status of "${row.name}"?`,
          STATUS_MEANINGS,
        ),
      ],
      [
        `total${index}`,
        noul(
          `In \`screenshot\`, is "${row.name}" a gradebook category or running total (points summed across many smaller assignments), rather than one assignment, quiz, exam, or discussion the student submits?`,
        ),
      ],
    ]),
  );
  const { answers } = await client.systemOne({
    // Today's date lets it tell "Available until Oct 23" from past due.
    state: {
      today: today.toLocaleDateString("en-US", {
        timeZone: TIME_ZONE,
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      }),
      screenshot: image(bytes),
    },
    questions,
  });
  // Mixing question types in one request loses the per-question answer type.
  const yes = (name: string): number => {
    const answer = answers[name];
    if (answer.type !== "noul") throw new Error(`${name} wasn't a yes/no`);
    return answer.noul;
  };
  return rows.map((row, index) => {
    const status = answers[`status${index}`];
    if (status.type !== "choice") throw new Error("status wasn't a choice");
    const check: RowCheck = {
      dueProbability: yes(`due${index}`),
      statusChoice: status.choice as Status,
      statusProbability: status.probabilities[status.choice] ?? 0,
      totalProbability: yes(`total${index}`),
    };
    return {
      name: row.name,
      course: row.course,
      dueAt: row.dueAt,
      ...resolveRow(row, check),
      ...check,
    };
  });
}

export async function importScreenshot(
  bytes: Uint8Array,
  today = new Date(),
): Promise<CheckedAssignment[]> {
  if (!imageFormat(bytes)) {
    throw new Error("Screenshots must be PNG or JPEG images.");
  }
  const fitted = await fitImage(bytes);
  const rows = await extractAssignments(fitted, "png", today);
  return checkAssignments(fitted, today, rows);
}

/**
 * TypeSafe rejects images with a side over 1568 pixels (Claude shrinks them to
 * about that size anyway), so shrink large screenshots to fit, keeping shape.
 */
export async function fitImage(bytes: Uint8Array): Promise<Uint8Array> {
  return sharp(bytes)
    .resize({
      width: MAX_IMAGE_SIDE,
      height: MAX_IMAGE_SIDE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();
}
