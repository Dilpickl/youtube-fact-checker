# Video Fact Check

A Chrome extension that watches TikTok alongside you: it finds checkable claims
in what a video says, checks them against sources when you ask, and reports
signs a video is AI-generated. See `PLAN.md` for where the project stands and
`RESEARCH.md` for why it is built this way.

Current state (milestone 1): when a TikTok video starts playing, the extension
prints its transcript and TikTok's AI label to the browser console.

## Requirements

- [Node.js](https://nodejs.org/) 24 or newer (the tests run TypeScript directly)
- Google Chrome

## Build

```bash
npm install
npm run build
```

The built scripts land in `extension/dist/`. Use `npm run watch` to rebuild on
every save.

## Load it in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose this project's `extension` folder.
4. After rebuilding, click the reload arrow on the extension's card, then
   reload the TikTok tab.

## Try it

1. Open [tiktok.com](https://www.tiktok.com) and play a video.
2. Open DevTools (F12) and go to the **Console** tab.
3. Type `[Fact check]` into the console's filter box.

Each video you watch prints once, with its AI label, caption, on-screen text,
and transcript.

## Develop

```bash
npm test           # unit tests
npm run typecheck  # TypeScript checks
npm run format     # format with Prettier
```

All code that depends on how TikTok's site is built lives in `src/tiktok.ts`.
When TikTok changes its site, start there.
