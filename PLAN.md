# PLAN

## The app

An active fact-checker for TikTok. While you watch, a Chrome extension reads the
video's transcript, finds the checkable factual claims, and (when you ask)
checks each one against sources: supported, contradicted, misleading, or
unverified. It also reports signs a video is AI-generated. It's for anyone who
watches short-form video, which is a broad audience. Dylan wanted a project with
real-world impact and room for nuance, and wanted to find a good use for
TypeSafe.

Design rules, agreed 2026-10-12:
- Out of the way: no UI when nothing is checkable; otherwise a small button
  just outside the video's corner, anchored to the `<video>` element rather than
  TikTok's layout.
- The popover opens beside the video, never over it, and the video pauses while
  it's open.
- Each claim is judged on its own. No single score for the whole video.
- "Unverified" and "no signs of AI" are honest answers, not "false" or "real."
- AI detection reports which signals fired (TikTok's label, caption and hashtags,
  comments), never a bare "this is AI."

## Done

(nothing yet)

## Next

1. **Milestone 1:** on a real TikTok page, print the transcript and whether
   TikTok labels the video as AI-generated. Done when the transcript matches
   what was said and the label is reported correctly. *Built 2026-10-12 (tests
   pass); waiting on Dylan's live test in Chrome.*
2. Claim detection with TypeSafe behind a small server endpoint; show the button
   with a claim count.
3. On-demand checking: Google Fact Check Tools API, then web evidence, then
   per-source supports/contradicts judgments.
4. AI-signal section: TikTok label, caption and hashtags, comments.
5. Audio fallback for videos without captions.
6. Stretch, after TikTok works well: Android app as a second client to the
   same endpoint; other platforms.

**Reminder for Claude:** once milestone 3 works end to end, remind Dylan to
build the test set (20-30 TikToks with known answers) and measure accuracy per
topic before tuning anything. He asked for this reminder on 2026-10-12.

## Done (unverified until Dylan reviews)

- 2026-10-12: Promo trailer (`promo/`), 36 s at 1080p with a synthesized
  soundtrack. Shows the planned design, labeled "Concept preview."

## Decisions

- **2026-10-12 — Idea: fact-checker for short-form video.** Dylan's own idea,
  chosen over suggestions (scam shield, section-swap market, others) that didn't
  interest him. Plain written-claim fact-checking already exists (Google's
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
