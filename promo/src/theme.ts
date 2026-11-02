import { loadFont } from "@remotion/google-fonts/Inter";
import { Easing, interpolate } from "remotion";
import type { Tone } from "./timeline.ts";

export const { fontFamily } = loadFont("normal", {
  weights: ["400", "500", "600", "700", "800"],
  subsets: ["latin"],
});

export const COLORS = {
  background: "#0A0C11",
  surface: "#141821",
  border: "rgba(255, 255, 255, 0.10)",
  text: "#F3F5F9",
  muted: "#9AA3B2",
  faint: "#6B7382",
  accent: "#5B8CFF",
};

export const TONE_COLORS: Record<Tone, string> = {
  supported: "#2FBF71",
  contradicted: "#F0544F",
  unverified: "#8A919E",
  warn: "#F2A93B",
};

/** 0 → 1 over `duration` frames starting at `from`, with a soft ease-out. */
export const progress = (
  frame: number,
  from: number,
  duration: number,
): number =>
  interpolate(frame, [from, from + duration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.22, 1, 0.36, 1),
  });
