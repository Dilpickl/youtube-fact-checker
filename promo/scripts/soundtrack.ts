// Writes public/soundtrack.wav: a soft synth pad, a quiet pulse, and interface
// sounds placed on the trailer's timeline. Everything is synthesized here, so
// the soundtrack has no licensing questions. Run with `npm run soundtrack`.
import { mkdirSync, writeFileSync } from "node:fs";
import {
  DURATION,
  FPS,
  SCENES,
  soundCues,
  type Sound,
} from "../src/timeline.ts";

const RATE = 48_000;
const LENGTH = Math.ceil((DURATION / FPS) * RATE);
const seconds = (frame: number) => frame / FPS;
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

// Sounds that get the echo, and the dry pulse that shouldn't.
const wetL = new Float32Array(LENGTH);
const wetR = new Float32Array(LENGTH);
const dry = new Float32Array(LENGTH);

interface Tone {
  start: number;
  freq: number;
  amp: number;
  attack: number;
  decay: number;
  length: number;
  pan?: number;
  partials?: [ratio: number, gain: number][];
}

/** Adds a tone with a raised-cosine attack and exponential decay. */
function addTone({
  start,
  freq,
  amp,
  attack,
  decay,
  length,
  pan = 0,
  partials = [[1, 1]],
}: Tone): void {
  const first = Math.max(0, Math.floor(start * RATE));
  const last = Math.min(LENGTH, Math.floor((start + length) * RATE));
  const gainL = amp * Math.cos(((pan + 1) * Math.PI) / 4);
  const gainR = amp * Math.sin(((pan + 1) * Math.PI) / 4);
  for (let i = first; i < last; i++) {
    const t = i / RATE - start;
    const rise = t < attack ? 0.5 - 0.5 * Math.cos((Math.PI * t) / attack) : 1;
    const fall = Math.exp(-Math.max(0, t - attack) / decay);
    const tail = Math.min(1, (start + length - i / RATE) / 0.05);
    let sample = 0;
    for (const [ratio, gain] of partials)
      sample += gain * Math.sin(2 * Math.PI * freq * ratio * t);
    const value = sample * rise * fall * tail;
    wetL[i] += value * gainL;
    wetR[i] += value * gainR;
  }
}

// Pad: A minor, F major 7, C major, G major, two seconds of overlap between chords.
const CHORDS = [
  [45, 52, 57, 60, 64],
  [41, 48, 57, 60, 64],
  [48, 55, 60, 64, 67],
  [43, 50, 59, 62, 67],
];
const CHORD_SECONDS = 4.5;
const padEnd = seconds(SCENES.endCard.from);
for (let chord = 0; chord * CHORD_SECONDS < padEnd; chord++) {
  for (const [voice, note] of CHORDS[chord % CHORDS.length].entries()) {
    for (const detune of [-0.0015, 0.0015]) {
      addTone({
        start: chord * CHORD_SECONDS,
        freq: hz(note) * (1 + detune),
        amp: voice === 0 ? 0.05 : 0.032,
        attack: 1.6,
        decay: 9,
        length: CHORD_SECONDS + 2,
        pan: detune < 0 ? -0.6 : 0.6,
        partials: [
          [1, 1],
          [2, 0.3],
          [3, 0.1],
        ],
      });
    }
  }
}

// Final chord: A major, so the progression resolves on the end card.
for (const note of [45, 57, 61, 64, 69]) {
  addTone({
    start: padEnd,
    freq: hz(note),
    amp: 0.04,
    attack: 0.4,
    decay: 2.5,
    length: 5,
    partials: [
      [1, 1],
      [2, 0.25],
    ],
  });
}

// Pulse: a soft low thump at 96 beats per minute through the demos.
const BEAT = 60 / 96;
for (let t = seconds(SCENES.claims.from); t < padEnd - 0.3; t += BEAT) {
  const first = Math.floor(t * RATE);
  for (let i = first; i < Math.min(LENGTH, first + RATE * 0.4); i++) {
    const age = i / RATE - t;
    const freq = 48 + 62 * Math.exp(-age / 0.03);
    dry[i] += 0.2 * Math.exp(-age / 0.11) * Math.sin(2 * Math.PI * freq * age);
  }
}

// Riser: filtered noise swelling into the end card.
let seed = 1;
const random = () => {
  seed = (seed * 1_664_525 + 1_013_904_223) % 2 ** 32;
  return seed / 2 ** 32 - 0.5;
};
const riserStart = padEnd - 1.8;
let filtered = 0;
for (
  let i = Math.floor(riserStart * RATE);
  i < Math.floor(padEnd * RATE);
  i++
) {
  const amount = (i / RATE - riserStart) / 1.8;
  filtered += (0.02 + 0.25 * amount) * (random() - filtered);
  wetL[i] += filtered * 0.22 * amount;
  wetR[i] += filtered * 0.22 * amount;
}

const EFFECTS: Record<Sound, (start: number) => void> = {
  pop: (start) =>
    addTone({
      start,
      freq: 1046.5,
      amp: 0.16,
      attack: 0.002,
      decay: 0.06,
      length: 0.3,
      partials: [
        [1, 1],
        [1.5, 0.4],
      ],
    }),
  click: (start) => {
    addTone({
      start,
      freq: 1900,
      amp: 0.1,
      attack: 0.001,
      decay: 0.012,
      length: 0.08,
    });
    addTone({
      start,
      freq: 420,
      amp: 0.12,
      attack: 0.001,
      decay: 0.03,
      length: 0.12,
    });
  },
  supported: (start) => {
    addTone({
      start,
      freq: 1318.5,
      amp: 0.08,
      attack: 0.004,
      decay: 0.3,
      length: 1,
    });
    addTone({
      start: start + 0.07,
      freq: 1975.5,
      amp: 0.06,
      attack: 0.004,
      decay: 0.35,
      length: 1,
    });
  },
  contradicted: (start) => {
    addTone({
      start,
      freq: 880,
      amp: 0.08,
      attack: 0.004,
      decay: 0.3,
      length: 1,
    });
    addTone({
      start: start + 0.08,
      freq: 698.5,
      amp: 0.08,
      attack: 0.004,
      decay: 0.35,
      length: 1,
    });
  },
  unverified: (start) =>
    addTone({
      start,
      freq: 1174.7,
      amp: 0.05,
      attack: 0.004,
      decay: 0.22,
      length: 0.8,
    }),
  warn: (start) => {
    addTone({
      start,
      freq: 659.3,
      amp: 0.08,
      attack: 0.004,
      decay: 0.12,
      length: 0.5,
    });
    addTone({
      start: start + 0.1,
      freq: 659.3,
      amp: 0.08,
      attack: 0.004,
      decay: 0.2,
      length: 0.6,
    });
  },
  logo: (start) => {
    for (const [freq, amp] of [
      [440, 0.07],
      [659.3, 0.06],
      [880, 0.05],
      [1108.7, 0.04],
    ]) {
      addTone({
        start,
        freq,
        amp,
        attack: 0.005,
        decay: 1.6,
        length: 4,
        partials: [
          [1, 1],
          [2.76, 0.3],
          [5.4, 0.1],
        ],
      });
    }
  },
};
for (const cue of soundCues()) EFFECTS[cue.sound](seconds(cue.frame));

// Cross-feedback echo on the wet sounds, then mix, fade, and normalize.
const DELAY = Math.floor(0.375 * RATE);
const lineL = new Float32Array(LENGTH);
const lineR = new Float32Array(LENGTH);
const left = new Float32Array(LENGTH);
const right = new Float32Array(LENGTH);
for (let i = 0; i < LENGTH; i++) {
  const echoL = i >= DELAY ? lineR[i - DELAY] : 0;
  const echoR = i >= DELAY ? lineL[i - DELAY] : 0;
  lineL[i] = wetL[i] + 0.32 * echoL;
  lineR[i] = wetR[i] + 0.32 * echoR;
  const fade = Math.min(1, i / (1.2 * RATE), (LENGTH - i) / (2.5 * RATE));
  left[i] = (wetL[i] + 0.25 * echoL + dry[i]) * fade;
  right[i] = (wetR[i] + 0.25 * echoR + dry[i]) * fade;
}
let peak = 0;
for (let i = 0; i < LENGTH; i++)
  peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
const gain = 0.85 / peak;

const wav = Buffer.alloc(44 + LENGTH * 4);
wav.write("RIFF", 0);
wav.writeUInt32LE(36 + LENGTH * 4, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); // PCM
wav.writeUInt16LE(2, 22); // stereo
wav.writeUInt32LE(RATE, 24);
wav.writeUInt32LE(RATE * 4, 28);
wav.writeUInt16LE(4, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(LENGTH * 4, 40);
for (let i = 0; i < LENGTH; i++) {
  wav.writeInt16LE(Math.round(left[i] * gain * 32767), 44 + i * 4);
  wav.writeInt16LE(Math.round(right[i] * gain * 32767), 46 + i * 4);
}
mkdirSync(new URL("../public/", import.meta.url), { recursive: true });
writeFileSync(new URL("../public/soundtrack.wav", import.meta.url), wav);
console.log(`Wrote public/soundtrack.wav (${(LENGTH / RATE).toFixed(1)} s)`);
