# Video Fact Check

A Chrome extension that fact-checks YouTube videos as you watch: it reads a
video's captions, finds the checkable claims, and (soon) checks each against
sources, live. See `PLAN.md` for where the project stands and `RESEARCH.md`
for why it is built this way.

Current state: on a YouTube video, a toggle in the player's controls finds the
claims worth checking ("Finding claims…", then "9 claims"); clicking it lists
them beside the video, and clicking a claim jumps to it. Checking them against
sources comes next.

It has two parts: the extension, and a small server on your own computer that
holds the Anthropic API key (it can't go inside the extension, where anyone
could read it) and asks Claude for the claims.

## Requirements

- [Node.js](https://nodejs.org/) 24 or newer (it runs TypeScript directly)
- Google Chrome
- An Anthropic API key in a `.env` file in this folder:
  `ANTHROPIC_API_KEY=...` (Git ignores `.env`)

## Build

```bash
npm install
npm run build
```

The built scripts land in `extension/dist/`. Use `npm run watch` to rebuild on
every save.

## Run the server

```bash
npm run server
```

Leave it running while you watch. It listens only on this computer
(`http://127.0.0.1:8787`), answers only the extension, and prints what each
video cost. Finding a video's claims costs well under a cent; it remembers
them until it stops, so reloading a video doesn't pay again.

## Load it in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose this project's `extension` folder.
4. After rebuilding, click the reload arrow on the extension's card, then
   reload the YouTube tab.

## Try it

Open a YouTube video with captions, such as
[this seed-oil video](https://www.youtube.com/watch?v=hmkoFDMAvkc). The toggle
appears next to the settings gear in the player's controls (move the mouse over
the video to show them). If it says "Couldn't check: retry", hover over it to
see why; usually the server isn't running.

## Develop

```bash
npm test           # unit tests
npm run typecheck  # TypeScript checks
npm run format     # format with Prettier
```

Code that depends on how YouTube's site is built lives in `src/page-hook.ts`
(reading captions through YouTube's player) and `src/content.ts` (where the
toggle and the list go). When YouTube changes its site, start there.

## Promo trailer

`promo/` holds a 36-second trailer made with [Remotion](https://www.remotion.dev/)
(videos written as React code). It shows the planned design and is labeled
"Concept preview" until those features exist. It has its own dependencies:

```bash
cd promo
npm install
npm run studio   # live preview with sound in the browser
npm run render   # writes out/trailer.mp4 (1080p, with soundtrack)
npm run poster   # writes out/poster.png
```

The script and timing live in `promo/src/timeline.ts`; the soundtrack is
synthesized by `promo/scripts/soundtrack.ts` from the same timeline, so sound
effects stay in sync when timing changes. Rendering needs Google Chrome
installed (see `promo/remotion.config.ts`).

## Accuracy check

`eval/check.ts` finds the checkable claims in a saved transcript and checks
each one with Claude and web search, writing a report to `eval/results/`. It
uses the same prompts as the server (`server/checker.ts`), needs
`ANTHROPIC_API_KEY` in `.env`, and costs about $0.17 per video with Haiku.

```bash
npm run check-claims -- eval/transcripts/<name>.txt
```

Transcripts are kept out of Git; results and grades are in `eval/RESULTS.md`.
