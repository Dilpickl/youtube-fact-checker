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

- 2026-11-02: Accuracy check before building the interface (`eval/`,
  `eval/RESULTS.md`). Opus 5.5 with web search on Kurzgesagt, a seed-oil
  health video, and a PBS news clip, 10 claims each: 28 of 29 gradable
  verdicts right, one too soft. Graded by Claude, not yet reviewed by Dylan.
- 2026-11-02: Haiku 5.5 on the same 30 claims (`eval/RESULTS.md`): about
  $0.15–0.20 a video instead of $1.24–1.39; 2 verdicts wrong, 5 harsher than
  needed, 4 better than Opus. After a prompt tune (rounding counts as
  supported; misleading means a viewer believes something false): 1 wrong
  (too soft; Dylan confirmed that one), 2 arguable, $0.14–0.21 a video.
- 2026-11-02: TypeSafe filter before searching (`eval/filter.ts`): missed the
  bar. Keeping every flagged claim, it skips only 5 of 22 supported ones; news
  claims all look doubtful to it. Graded by Claude, not yet reviewed by Dylan.
- 2026-11-03: Claims from a YouTube video (step a of live verdicts). A toggle
  in the player's controls finds the claims through a server on Dylan's laptop
  (`npm run server`, Haiku), and a list beside the video jumps to each one.
  Dylan tried it in Chrome on a PBS video: 10 claims about the primaries. The
  first load failed until Dylan turned captions on (see Problems); fixed, and
  Dylan confirmed the fix.
- 2026-11-03: Live verdicts (step b). Claims are checked about three minutes
  ahead of the playhead, two at a time; chips appear on the video as each is
  said (red for contradicted or misleading, a quiet green check, grey for
  unverified or still checking), and the list shows each verdict with its
  sources. Dylan tried it in Chrome on the PBS video: chips and verdicts
  worked. About 2.3¢ a check. Open question from Dylan: a "contradicted" for
  "fast food reuses oil a hundred times" rested on reuse guidelines, not on
  what restaurants actually do.
- 2026-11-05: "Check this" (button by the toggle, or V; C is YouTube's
  captions key). Finds the claim in the last 20 seconds of captions and checks
  it; jumps to a listed claim instead when one is from that moment. Can't be
  spammed: one at a time, 20 an hour (server). Dylan tried it in Chrome: it
  worked. Clicking a chip now also centers and highlights its claim in the
  list. Open question from Dylan: "identifying your circadian clock reveals
  your ideal sleep times" came back misleading because there's no single
  universal ideal time, which the claim never said.

## Next

1. **Current milestone: live verdicts on YouTube.** Finish line agreed with
   Dylan 2026-11-03: with the local server running, open the seed-oil video
   and press play. The toggle by the video controls says "Finding claims…",
   then "10 claims". Around 4:31, where it's said (4:03 in the test
   transcript's 30-second chunks), a red chip appears ("Contradicted: one
   serving toxic for 3 years"), stays a few seconds, then fades; clicking it pauses the
   video and shows the explanation and sources beside the video, never over
   it. On the Kurzgesagt video, small green checks appear as claims are
   spoken, and no red chips. Other toggle states: "Nothing to check", "No
   captions", "Couldn't check: retry". Steps: (a) the claim count and a list
   of claims (time, click to jump) on a real YouTube video, done 2026-11-03;
   (b) checks a few minutes ahead of the playhead, chips, and verdicts in the
   list, done 2026-11-03. A prompt tune (2026-11-03) made the three-year
   seed-oil claim contradicted; the fryer-oil verdict still rests on
   guidelines (see `eval/RESULTS.md`).
2. More checking: Google Fact Check Tools API as extra evidence (first test
   how many of the 30 eval claims it matches; Dylan is getting a key), then a
   supports/contradicts label on each source. "Check this" done 2026-11-05.
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

- **2026-11-03 — Show every verdict, weighted by how much it matters.**
  Replaces red flags only (2026-11-02). Dylan's reasoning: a viewer may not
  know a claim is credible, and that validation is useful too. The evidence
  agrees: with only false claims flagged, people read unflagged ones as true,
  even ones nobody checked (the "implied truth effect", Pennycook et al.,
  2020). So: a red chip for contradicted or misleading; a small, quiet green
  check for supported; grey for unverified or not checked yet, so no mark
  never means "true."
- **2026-11-03 — A server on Dylan's laptop first.** Claude's choice, open to
  overrule: the API keys can't go inside the extension, where anyone who
  installs it could read them. Classmates try it on Dylan's laptop; hosting
  it so anyone can install the extension comes later.
- **2026-11-03 — Haiku 5.5 checks the claims.** The tuned Haiku matched Opus
  on 30 claims (one wrong verdict each) at about an eighth of the cost, and
  Dylan wants a daily tool, so cost matters. Dylan doubted live verdicts were
  worth paying for at Opus prices; at about 17¢ a video they are the plan. A
  TypeSafe filter to skip searches was tried and dropped (see Done).

- **2026-11-02 — Live verdicts for red flags only.** Dylan wants a verdict to
  appear when the claim is spoken. Claude's concern: if every supported claim
  pops up, people learn to ignore them. Agreed: only contradicted or misleading
  claims appear live (a small chip by the controls for a few seconds, click for
  details); supported ones stay in the list and the count. Claims are checked
  in time order a few minutes ahead of the playhead, so verdicts are ready in
  time and nothing past where the viewer stops gets paid for.
- **2026-11-02 — Test verdict quality before building the interface.** Claude
  suggested it (the biggest unknown is whether verdicts are any good); Dylan
  agreed and asked for health-influencer and news videos besides Kurzgesagt,
  since a Kurzgesagt video is a good answer key but not one people doubt. A
  toggle that's always visible and says "Nothing to check" was Dylan's call,
  over hiding it on videos with no claims.
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

- **2026-11-03 — Captions failed on a video's first load.** YouTube's player
  ignores caption requests until the video itself plays, and a fresh page
  usually starts with an ad, so the extension gave up after 10 seconds. It
  now waits out the ad, asks every few seconds (for up to 10 minutes), and
  uses the viewer's own caption request if they turn captions on. Claude's
  tests in its browser pane missed this because those pages were already
  playing.
- **2026-11-02 — YouTube guards its captions.** Fetching a video's caption
  file or transcript from outside the page returns nothing (it needs a token
  the player adds). Inside the page it works: the player's own caption request
  carries the token, and so does YouTube's "Show transcript" panel. The
  extension will read captions from inside the page.
- **2026-11-02 — Verdicts from memory.** With 12 checks at once, about a third
  of web searches failed and the model answered from memory; those were the
  wrong verdicts. The script now runs two at a time, retries, and reports
  failed searches. Rule for the app: no source, no verdict.
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
