# PLAN

## The app

An active fact-checker for YouTube videos, starting on desktop. While you watch,
a Chrome extension reads the video's captions, finds the checkable factual
claims on any topic, and (when you ask) checks each one against sources:
supported, contradicted, misleading, or unverified. Dylan's test videos:
informative channels like Kurzgesagt, news channels, and science. Later, a
hotkey checker for any text on screen uses the same checking server. Dylan
wanted a project with real-world impact and room for nuance, and wanted to find
a good use for TypeSafe.

Design rules, agreed 2026-10-12 for TikTok (to revisit for YouTube's longer
videos):

- Out of the way: no UI when nothing is checkable; otherwise a small button
  just outside the video's corner, anchored to the `<video>` element rather than
  the site's layout.
- The popover opens beside the video, never over it, and the video pauses while
  it's open.
- Each claim is judged on its own. No single score for the whole video.
- "Unverified" and "no signs of AI" are honest answers, not "false" or "real."
- AI detection reports which signals fired, never a bare "this is AI."

## Done

(nothing yet on YouTube)

## Next

1. **Current milestone: claims from a YouTube video.** Read the captions of the
   video being watched and find its checkable claims with TypeSafe behind a
   small server endpoint. What done looks like: to be agreed with Dylan before
   building. The TikTok reader (`src/tiktok.ts`) is replaced by a YouTube one;
   the caption parsing and extension plumbing carry over.
2. On-demand checking: Google Fact Check Tools API, then web evidence, then
   per-source supports/contradicts judgments.
3. Hotkey checker: press a key (or drag a box) to check the claims in whatever
   is on screen, through the same server.
4. AI signals and an audio fallback for videos without captions, if still
   wanted.

**Reminder for Claude:** once on-demand checking works end to end, remind Dylan
to build the test set (20-30 videos with known answers) and measure accuracy
per topic before tuning anything. Kurzgesagt publishes a sources document for
each video, which makes its videos a ready-made answer key. Dylan asked for this
reminder on 2026-10-12.

## Done (unverified until Dylan reviews)

- 2026-10-12: Promo trailer (`promo/`), 36 s at 1080p with a synthesized
  soundtrack. Shows the planned design, labeled "Concept preview."

## Decisions

- **2026-11-02 — YouTube first, any topic, desktop.** Dylan wants to focus on
  desktop, where YouTube is far more practical than TikTok. A share-to-Discord
  bot was considered and dropped: Dylan pointed out people could just share a
  link with their own AI app. A universal checker that reads the whole screen
  automatically was Dylan's idea; Claude raised privacy, cost, and noise, so it
  becomes a later hotkey checker sharing the same server. Dylan chose any topic
  over one area (health, money, science) because it's more appealing.
- **2026-11-01 — Back to the fact-checker.** Dylan switched back because it's
  the more interesting project. The reason for shelving it on 2026-10-19
  (browser extensions aren't one of the listed platforms) is resolved: course
  staff said an extension is OK. The schoolwork assistant built in between
  (screenshot and Canvas import, What now?, History, Overview) is saved at the
  `schoolwork-assistant` tag, with its own PLAN.md there; its unfinished new
  look was never tried by Dylan.
- **2026-10-12 — Idea: fact-checker for short-form video.** Dylan's own idea,
  chosen over suggestions (scam shield, section-swap market, others) that didn't
  interest Dylan. Plain written-claim fact-checking already exists (Google's
  tool), so the value is in checking video as you watch it.
- **2026-10-12 — Chrome extension, not a paste-a-link web app.** Dylan found
  pasting links "too useless"; the point is to be active while watching.
- **2026-10-12 — TikTok first, Instagram deferred.** TikTok's page includes
  caption tracks (including auto-generated ones). Instagram has no public
  transcript, and the only route goes against its terms of service.
- **2026-10-12 — Check anything checkable**, not one topic.
- **2026-10-12 — TypeSafe for judgments.** Fast, parallel typed judgments per
  sentence fit the "is this a checkable claim?" filter.
- **2026-10-12 — Mobile: Android later, iOS out.** iOS doesn't let apps read
  other apps' screens. Android can (screen capture plus on-device OCR, or a
  share-sheet target). The extension comes first because debugging the
  judging is easier there; Android reuses the same server endpoint.
- **2026-10-12 — Smaller UI.** Dylan felt the first mockup took too much space
  and would hurt the viewing experience. Iterated: corner dot, then a button
  in TikTok's side buttons, then (because TikTok's layout could change and
  break it) a button anchored to the video element itself. Pausing while
  reading was Dylan's pick from the suggestions.
- **2026-10-12 — AI detection as signals, not a detector.** Frame-analysis
  detectors don't publish false-positive rates and do badly on real footage
  with fast cuts. Use TikTok's label, caption and hashtags, and comments
  instead. See `RESEARCH.md`.

- **2026-10-12 — TikTok is the goal; expand afterwards.** Android moved from
  committed goal to stretch, given 24 hours and six milestones.
- **2026-10-12 — Add a small language model alongside TypeSafe.** TypeSafe
  judges and selects but doesn't write text; rewriting messy caption claims
  into searchable form needs a language model. Dylan sees combining the two as
  part of what makes the project nuanced. Which model: pending (Claude
  recommended Claude Haiku 5.5; Dylan to decide after comparing).
- **2026-10-12 — Read the data TikTok already downloads; never request
  TikTok pages.** The extension reads copies of TikTok's own feed responses
  and the data embedded in video pages. While researching, TikTok showed a
  CAPTCHA after quick page-to-page navigation, so making extra requests would
  risk bot checks for users. Only the caption file for the video being watched
  is fetched. Risk to watch: TikTok could notice the extension reading its
  network responses.
- **2026-10-12 — Stack: TypeScript, esbuild, Node's built-in test runner,
  Prettier.** No extension framework until one is needed.
- **2026-10-12 — Promo trailer made with Remotion, labeled as a concept.**
  Dylan asked for a store-page trailer. It shows the planned UI, not the
  current console-only build, so the end card says "Concept preview · in
  development"; re-render without that label once the UI exists. No TikTok
  logo or real footage: a generic player with drawn stand-in videos. The
  soundtrack is synthesized in code, so there's no music licensing.
- **2026-10-12 — Cost protection.** Prepaid credits with auto-reload off,
  a daily cap in the server, a per-install rate limit, a verdict cache keyed by
  claim text, and checking only on click. No user accounts.

## Problems

- **2026-10-12 — Couldn't confirm caption field names.** Both videos inspected
  live were music-only, and then TikTok showed a CAPTCHA, which Claude does not
  solve. Caption parsing uses field names from earlier TikTok pages and accepts
  both known spellings; Dylan's first live test confirms them.
- **2026-10-12 — Trailer render failed on this laptop.** Windows blocks some
  unsigned programs (Smart App Control): Remotion's downloaded headless Chrome
  and its `ffprobe.exe` were refused, while `ffmpeg.exe` was allowed. Fixes:
  `promo/remotion.config.ts` renders with the installed (signed) Chrome, and
  the soundtrack is added with ffmpeg after rendering so ffprobe is never
  needed. Also, TypeScript 7 lacks the API Remotion uses to read tsconfig
  (JSX broke), so `promo/` pins TypeScript 5.
