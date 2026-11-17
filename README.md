# Video Fact Check

A Chrome extension that fact-checks YouTube videos as you watch: it reads a
video's captions, finds the checkable claims, and (soon) checks each against
sources, live. See `PLAN.md` for where the project stands and `RESEARCH.md`
for why it is built this way.

Current state: on a YouTube video, click **Fact-check** in the player's
controls ("Finding claims…", then "9 claims"). Each claim is checked against
web sources a few minutes before it is said; a chip appears on the video with
the verdict, and the list beside the video shows every verdict with its
sources. Press V or "Check this" to check something the list missed. The
extension's icon opens a popup with the on/off switch, a switch to always
check the current video's channel, and what is left of today's budget.

On a Short, the **Fact-check** button sits with the Short's own pause and
volume buttons. Each claim pops up beside the video as it is said and fades
after a few seconds; clicking one opens its explanation and sources, and the
button pulls all of them up as a panel. Shorts are checked only when asked,
unless "Check every Short" is on in the popup.

It has two parts: the extension, and a small server that holds the Anthropic
API key (it can't go inside the extension, where anyone could read it) and
asks Claude for the claims and verdicts. The server is hosted on Render, so
the extension works on any computer without running anything else.

## Requirements

- [Node.js](https://nodejs.org/) 24 or newer (it runs TypeScript directly)
- Google Chrome
- Only to run the server yourself or the accuracy check: an Anthropic API key
  in a `.env` file in this folder: `ANTHROPIC_API_KEY=...` (Git ignores `.env`)

## Build

```bash
npm install
npm run build
```

The built scripts land in `extension/dist/`. Use `npm run watch` to rebuild on
every save.

## The server

The extension talks to `https://video-fact-check-6p2n.onrender.com`, which
Render builds from `render.yaml` and the `main` branch of
`Dilpickl/youtube-fact-checker`. Pushes have not redeployed it by themselves
so far, so after a server change use **Manual Deploy** in Render's dashboard. The API key is set on the service's
Environment page in Render's dashboard, never in this repository. It is on
the free plan, so it sleeps after 15 idle minutes and the first video after a
break takes about a minute longer. It stops for the day once everyone
together has spent $0.50 ("today's fact-checking budget is used up"). The
day's spend is kept in a Render Key Value store (also in `render.yaml`), so it
survives those restarts.

To run it on your own computer instead, `npm run server` listens on
`http://127.0.0.1:8787`; put that address in `SERVER` in `src/background.ts`
and in `host_permissions` in `extension/manifest.json`, then rebuild.

## Load it in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose this project's `extension` folder.
4. After rebuilding, click the reload arrow on the extension's card, then
   reload the YouTube tab.

## Try it

Open a YouTube video with captions, such as
[this seed-oil video](https://www.youtube.com/watch?v=hmkoFDMAvkc). The
**Fact-check** button appears next to the settings gear in the player's
controls (move the mouse over the video to show them); nothing is read or
spent until you click it. If it says "Couldn't check: retry", hover over it to
see why; after a break, the server may still be waking up, so retry in a
minute.

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
