// Reads WebVTT, the caption file format TikTok serves.

export interface Cue {
  /** Seconds from the start of the video. */
  start: number;
  text: string;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
  nbsp: " ",
};

export function parseWebVtt(vtt: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of vtt.replace(/\r\n?/g, "\n").split(/\n{2,}/)) {
    const lines = block.split("\n");
    const timingLine = lines.findIndex((line) => line.includes("-->"));
    // Blocks without a timing line are the header, NOTE, or STYLE blocks.
    if (timingLine === -1) continue;
    const text = lines
      .slice(timingLine + 1)
      .join(" ")
      .replace(/<[^>]*>/g, "")
      .replace(
        /&(amp|lt|gt|quot|#39|nbsp);/g,
        (_, name: string) => ENTITIES[name],
      )
      .replace(/\s+/g, " ")
      .trim();
    // Skip empty cues and repeats of the cue before (captions that linger).
    if (!text || text === cues.at(-1)?.text) continue;
    cues.push({ start: parseTimestamp(lines[timingLine]), text });
  }
  return cues;
}

function parseTimestamp(timingLine: string): number {
  const match = /(?:(\d+):)?(\d{1,2}):(\d{2})\.(\d{3})/.exec(timingLine);
  if (!match) return 0;
  const [, hours = "0", minutes, seconds, milliseconds] = match;
  return (
    Number(hours) * 3600 +
    Number(minutes) * 60 +
    Number(seconds) +
    Number(milliseconds) / 1000
  );
}
