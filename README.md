# Video Fact Check

A Chrome extension that fact-checks YouTube videos and Shorts while you watch
them. It reads the video's captions, pulls out the claims that can actually
be checked, and checks each one against web sources just before it's said.
Each verdict shows up on screen as the claim is spoken: supported,
contradicted, misleading, or unverified, with the sources behind it.

I built this because I watch a lot of explainer, science, and news content,
and kept pausing to look things up. Fact-checking tools exist for written
articles, but nothing worked inside the video itself. This started as a class
project (CS 124 at Illinois) and turned into something I use every day.

## What it does

- **Long videos:** a **Fact-check** button sits in the player's controls.
  Click it and it finds the claims ("Finding claims…", then "9 claims").
  Claims are checked a few minutes ahead of the playhead, so a verdict is
  ready by the time the claim is said. Each one appears as a chip on the video,
  and a side list shows every verdict with its sources.
- **Shorts:** the button sits beside the Short's own pause and volume buttons.
  Claims pop up in the empty space next to the video and fade after a few
  seconds. Click one to pause and read the explanation, click it again (or
  press play) to keep watching. Dots on the progress bar mark where each
  claim is said.
- **"Check this" (V):** checks whatever was said in the last 20 seconds, for
  claims the automatic pass missed.
- **Popup:** an on/off switch, an "always check this channel" switch, and how
  much of today's budget is left. Nothing runs and nothing is spent until you
  ask, because most of what I watch isn't meant to be fact-checked.

## How it works

```
YouTube page ── captions ──▶ extension ──▶ server (Render) ──▶ Claude + web search
                                 ▲                                     │
                                 └────────── claims and verdicts ◀─────┘
```

- **Extension** (TypeScript, Manifest V3, bundled with esbuild): reads captions
  through YouTube's own player, decides when to check, and draws the UI.
- **Server** (Node): holds the Anthropic API key, which can't be put inside an
  extension where anyone could read it. It asks Claude Haiku to find the
  claims and to judge each one with web search. A $0.50 daily budget is kept
  in a Render Key Value store so it survives restarts.
- **Rule: no source, no verdict.** A claim the model can't back with a source
  comes back "unverified", not "true". The one exception is pure mathematics
  or logic, which is worked out instead.

## Things that were harder than they looked

- **YouTube guards its captions.** Asking for a video's caption file from
  outside the page returns nothing, because the request needs a token the
  player adds. The extension listens for the player's own caption request
  instead, and if captions are off it turns them on (hidden) for a moment so
  the player makes one, after waiting for any ad to finish.
- **Is the AI actually right?** Before building any UI I wrote an accuracy
  harness (`eval/`) and graded verdicts on 30 claims from science, health,
  and news videos. Opus got 28 of 29 gradable verdicts right; after prompt
  tuning, Haiku came close at about an eighth of the cost (around 2¢ a
  check). Results are in `eval/RESULTS.md`.
- **Showing only false claims backfires.** People read unflagged claims as
  true even when nobody checked them (the "implied truth effect"), so every
  verdict is shown, weighted by how much it matters: red ones stay up longest.
- **Ideas that didn't make it.** The Google Fact Check API matched 1 of 30
  claims, so it was dropped. A TypeSafe pre-filter to skip searches didn't
  save enough to keep. Both are written up in `PLAN.md`.

`PLAN.md` is the full running log: what's done, what's next, and why each
decision went the way it did. `RESEARCH.md` covers the background research.

## Try it

You need [Node.js](https://nodejs.org/) 24+ and Google Chrome.

```bash
npm install
npm run build
```

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and choose this project's `extension` folder.
3. Open a YouTube video with captions, such as
   [this seed-oil video](https://www.youtube.com/watch?v=hmkoFDMAvkc), and
   click **Fact-check** in the player's controls.

The server runs on Render's free plan and sleeps after 15 idle minutes, so
after a break the first check takes about a minute. If the button says
"Couldn't check: retry", hover over it to see why. After rebuilding, click
the reload arrow on the extension's card and reload the YouTube tab.

## Develop

```bash
npm run watch      # rebuild on every save
npm test           # unit tests (Node's built-in runner)
npm run typecheck  # TypeScript checks
npm run format     # Prettier
```

Code that depends on how YouTube's site is built lives in `src/page-hook.ts`
(reading captions through the player) and `src/content.ts` (where the UI
goes). When YouTube changes its site, start there.

### Running the server yourself

Put an Anthropic API key in a `.env` file in this folder
(`ANTHROPIC_API_KEY=...`; Git ignores `.env`), then run `npm run server`,
which listens on `http://127.0.0.1:8787`. Put that address in `SERVER` in
`src/background.ts` and in `host_permissions` in `extension/manifest.json`,
then rebuild.

The hosted server (`https://video-fact-check-6p2n.onrender.com`) is built
from `render.yaml` and the `main` branch. Pushes don't redeploy it on their
own yet, so after a server change use **Manual Deploy** in Render's
dashboard. The API key is set on the service's Environment page, never in
this repository.

### Accuracy check

`eval/check.ts` finds the claims in a saved transcript and checks each one,
writing a report to `eval/results/`. It uses the same prompts as the server
(`server/checker.ts`), needs the API key in `.env`, and costs about $0.17 a
video.

```bash
npm run check-claims -- eval/transcripts/<name>.txt
```

### Promo trailer

`promo/` holds a 36-second trailer written in React with
[Remotion](https://www.remotion.dev/), with a soundtrack synthesized from the
same timeline so sound stays in sync with the cuts. It shows an early design
and is labeled "Concept preview".

```bash
cd promo
npm install
npm run studio   # live preview in the browser
npm run render   # writes out/trailer.mp4
```
