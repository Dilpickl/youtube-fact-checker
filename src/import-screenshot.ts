// Turns a screenshot of any course site into a checked list of assignments.
// Claude Haiku reads the image and lists what it sees (TypeSafe answers
// questions but doesn't write text); TypeSafe then checks each row against the
// same image, and rows it doubts are flagged for the student to confirm.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { image, noul, TypeSafeClient } from "@typesafe-ai/sdk";
import sharp from "sharp";
import { z } from "zod";

const EXTRACT_MODEL = "claude-haiku-5-5";
const MAX_IMAGE_SIDE = 1568;
// ponytail: one fixed cutoff for "check this"; tune it once there's a test set
// of real screenshots with known answers.
const CONFIDENT = 0.7;

const AssignmentSchema = z.object({
  name: z.string(),
  course: z.string(),
  dueAt: z.string().nullable(),
  status: z.enum(["open", "closed", "unknown"]),
});
const ExtractionSchema = z.object({ assignments: z.array(AssignmentSchema) });

export type Assignment = z.infer<typeof AssignmentSchema>;

export interface CheckedAssignment extends Assignment {
  /** TypeSafe's probability that the screenshot shows this name and due date. */
  dueProbability: number;
  /** TypeSafe's probability that the assignment is still open. */
  openProbability: number;
  needsCheck: boolean;
}

export type ImageFormat = "png" | "jpeg";

/** Reads the format from the file's first bytes; both APIs accept only these two. */
export function imageFormat(bytes: Uint8Array): ImageFormat | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpeg";
  return null;
}

/**
 * Combines Claude's reading with TypeSafe's check. A confident TypeSafe answer
 * fills in a status Claude couldn't tell; an unsure one (near 50%) defers to
 * Claude. A row needs a look when the due date is doubtful, when TypeSafe
 * confidently contradicts Claude, or when neither can tell the status.
 */
export function resolveRow(
  status: Assignment["status"],
  dueProbability: number,
  openProbability: number,
): { status: Assignment["status"]; needsCheck: boolean } {
  const typeSafeSays =
    openProbability >= CONFIDENT
      ? "open"
      : openProbability <= 1 - CONFIDENT
        ? "closed"
        : "unknown";
  const resolved = status === "unknown" ? typeSafeSays : status;
  const contradicts =
    status !== "unknown" &&
    typeSafeSays !== "unknown" &&
    typeSafeSays !== status;
  return {
    status: resolved,
    needsCheck:
      dueProbability < CONFIDENT || contradicts || resolved === "unknown",
  };
}

/** "2026-10-20T23:59:00-05:00" → "Oct 20, 2026 at 11:59 PM", as the page showed it. */
export function describeDue(dueAt: string | null): string {
  if (!dueAt) return "with no due date shown";
  // Drop the offset and format as UTC so the clock time isn't shifted.
  const local = new Date(`${dueAt.slice(0, 19)}Z`);
  if (Number.isNaN(local.getTime())) return `due ${dueAt}`;
  const date = local.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
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
): Promise<Assignment[]> {
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
- course: the course code if the page shows one (for example "ITAL 101"), otherwise "".
- dueAt: the due date and time in ISO 8601 with the time zone offset, for example "2026-10-20T23:59:00-05:00". Use the offset of any time zone the page names (CDT is -05:00). If no year is shown, use the next such date on or after ${today.toDateString()}. If there's no due date, null. Use the due date, never a start or available date.
- status: "closed" if the page marks it as locked, submitted, completed, or past due; "open" if it can still be worked on; "unknown" if the page doesn't say.
Include only what is visible. Don't invent tasks or dates.`,
          },
        ],
      },
    ],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) {
    throw new Error("Claude couldn't read assignments from that screenshot.");
  }
  return response.parsed_output.assignments;
}

async function checkAssignments(
  bytes: Uint8Array,
  assignments: Assignment[],
): Promise<CheckedAssignment[]> {
  if (assignments.length === 0) return [];
  const client = new TypeSafeClient({
    defaultHeaders: { "TypeSafe-Danger-Zone-Images": "true" },
  });
  // All rows go in one request; TypeSafe answers the questions in parallel.
  const questions = Object.fromEntries(
    assignments.flatMap((assignment, index) => [
      [
        `due${index}`,
        noul(
          `Does \`screenshot\` show a task named "${assignment.name}" ${describeDue(assignment.dueAt)}?`,
        ),
      ],
      [
        `open${index}`,
        noul(
          `In \`screenshot\`, can the task "${assignment.name}" still be worked on, rather than being locked, submitted, completed, or past due?`,
        ),
      ],
    ]),
  );
  const { answers } = await client.systemOne({
    state: { screenshot: image(bytes) },
    questions,
  });
  return assignments.map((assignment, index) => {
    const dueProbability = answers[`due${index}`].noul;
    const openProbability = answers[`open${index}`].noul;
    return {
      ...assignment,
      ...resolveRow(assignment.status, dueProbability, openProbability),
      dueProbability,
      openProbability,
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
  const assignments = await extractAssignments(fitted, "png", today);
  return checkAssignments(fitted, assignments);
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
