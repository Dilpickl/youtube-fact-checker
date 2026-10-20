// The trailer's script and timing, shared by the video and its soundtrack.
// All times are frames at 30 fps; beats inside a scene count from its start.

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

// Neighbouring scenes overlap by 15 frames so they crossfade.
export const SCENES = {
  hook: { from: 0, duration: 105 },
  claims: { from: 105, duration: 480 },
  aiSignals: { from: 570, duration: 240 },
  principles: { from: 795, duration: 165 },
  endCard: { from: 945, duration: 150 },
};
export const DURATION = SCENES.endCard.from + SCENES.endCard.duration;

export type Tone = "supported" | "contradicted" | "unverified" | "warn";

export interface Sentence {
  from: number;
  to: number;
  text: string;
  claim: boolean;
}

export const CLAIMS = {
  sentences: [
    {
      from: 12,
      to: 78,
      text: "Magnesium is how your body regulates sleep.",
      claim: true,
    },
    {
      from: 82,
      to: 150,
      text: "It cures insomnia in 90% of people.",
      claim: true,
    },
    {
      from: 154,
      to: 222,
      text: "And doctors get paid not to tell you.",
      claim: true,
    },
    { from: 228, to: 300, text: "Follow for part two.", claim: false },
  ] satisfies Sentence[],
  cursorFrom: 246,
  click: 290,
  rows: [
    {
      text: "Magnesium is involved in regulating sleep",
      detail: "Supported · 4 sources",
      tone: "supported",
      resolveAt: 335,
    },
    {
      text: "Magnesium cures insomnia in 90% of people",
      detail: "Contradicted · 3 sources",
      tone: "contradicted",
      resolveAt: 365,
    },
    {
      text: "Doctors are paid to hide magnesium's effects",
      detail: "Unverified · no evidence found",
      tone: "unverified",
      resolveAt: 395,
    },
  ] satisfies { text: string; detail: string; tone: Tone; resolveAt: number }[],
  noAiSignsAt: 415,
  close: 452,
  resume: 458,
};

export const AI = {
  sentences: [
    {
      from: 6,
      to: 120,
      text: "Downtown is completely underwater",
      claim: true,
    },
  ] satisfies Sentence[],
  buttonIn: 26,
  cursorFrom: 60,
  click: 98,
  signals: [
    {
      text: "TikTok label",
      detail: "None · not labeled by the creator",
      tone: "unverified",
      resolveAt: 130,
    },
    {
      text: "Caption and hashtags",
      detail: "Signal · tagged #veo3",
      tone: "warn",
      resolveAt: 148,
    },
    {
      text: "Viewer comments",
      detail: "Signal · comments point out warped signs",
      tone: "warn",
      resolveAt: 166,
    },
  ] satisfies { text: string; detail: string; tone: Tone; resolveAt: number }[],
  verdictAt: 186,
  claimAt: 204,
};

export type Sound = "pop" | "click" | Tone | "logo";

/** When each sound effect plays, in absolute frames. */
export function soundCues(): { frame: number; sound: Sound }[] {
  const claims = SCENES.claims.from;
  const ai = SCENES.aiSignals.from;
  return [
    ...CLAIMS.sentences
      .filter((sentence) => sentence.claim)
      .map((sentence) => ({
        frame: claims + sentence.to,
        sound: "pop" as const,
      })),
    { frame: claims + CLAIMS.click, sound: "click" },
    ...CLAIMS.rows.map((row) => ({
      frame: claims + row.resolveAt,
      sound: row.tone,
    })),
    { frame: claims + CLAIMS.noAiSignsAt, sound: "supported" },
    { frame: ai + AI.buttonIn, sound: "pop" },
    { frame: ai + AI.click, sound: "click" },
    ...AI.signals.map((signal) => ({
      frame: ai + signal.resolveAt,
      sound: signal.tone,
    })),
    { frame: ai + AI.verdictAt, sound: "warn" },
    { frame: ai + AI.claimAt, sound: "contradicted" },
    { frame: SCENES.endCard.from + 10, sound: "logo" },
  ];
}
