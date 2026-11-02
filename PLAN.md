# PLAN

## The app

A schoolwork assistant that tells Dylan what to do right now. Assignments come
in from screenshots of any course site (Connect, PrairieLearn, Gradescope, a
syllabus) and later from Canvas's calendar feed. "What now?" picks one task,
says why, and gives a start-by time based on the deadline, how long the task
takes, and Dylan's energy. A focus timer runs the task, and the timer data
teaches the app how long Dylan's work really takes, so its estimates improve
every week. A Discord bot brings it to Dylan's phone: add tasks by message or
photo, ask "what now?", and get a morning debrief (due today, how Dylan is keeping
up, first class, weather) and an evening "prep for tomorrow" debrief. A website
handles what chat does badly: reviewing imports, seeing the whole week and
progress, and setup.

It's for Dylan first. Dylan stresses about assignments more than anything else:
what to do right now, when to start so a deadline isn't missed (including the
weekly CS 124 hours), staying focused, and being sleepy while working. A
classmate can try it from the website link or by joining the Discord server.

Design rules, agreed 2026-10-19 and 2026-10-20:

- One task at a time. "What now?" never shows the full menu; "Not now" skips.
- Imports are checked before saving: rows TypeSafe doubts get a "Check this"
  flag, and Dylan confirms.
- Duplicates across screenshots merge; a newer screenshot updates an
  assignment instead of adding a copy.
- Deadline math, sorting, and stored facts stay in code; AI makes the
  judgment calls (task size, fit for energy, same assignment or not).

## Done

- 2026-10-20: Milestone 1, screenshot import (command line). `npm run import`
  reads the Connect Capitolo 5 screenshot: all seven assignments with correct
  names, course, and due dates; Strutture III and Cultura open, the rest
  closed; nothing flagged. Dylan checked it against Connect.
- 2026-10-22: Milestone 2, the website. Plan page lays assignments out by day
  (past due, today, each day this week, later, needs a date, done); screenshots
  are added by button, paste, or drag and reviewed before saving; duplicates
  merge; grade totals left out are remembered; courses are inferred; Mark done
  has Undo and Reopen. Dylan tried their own Canvas and PHYS 110 screenshots,
  the 11:59 PM times, and Undo. Re-importing and the "Same assignment?"
  question were checked by Claude through the server, not yet by Dylan.
- 2026-10-22: Milestone 3, "What now?". The Now page shows the work in the
  order to do it: due soon, then today's share, then getting ahead. Big tasks
  are split into sessions; TypeSafe estimates each task's time once. Done /
  Done with this session / Finished it all log work (with Undo); Not now and
  Too tired? change the pick. Dylan checked that the order matches what they'd
  expect; more real use will test the logic.
- 2026-10-22: History page. Finished work and logged sessions by day, newest
  first, with weekly and daily totals; Reopen restores the status a task had
  before it was done; Remove deletes a session. Dylan tried Reopen.
- 2026-10-22: Canvas calendar feed. Connect once on Plan (the link stays in
  the local database and is never sent back to the page); Check Canvas, and an
  automatic check every 6 hours, bring in only new or changed upcoming
  assignments for review. Dylan connected the real feed (ENG 100, ITAL 101).
- 2026-10-23: Paste text or a link on Plan, beside screenshots. Text works on
  pages behind a login; links work for public pages. Dylan imported math by
  text and physics by screenshot; both led to the accuracy fixes below. The
  compact review (Save first, questions first, one-line rows) is not yet tried
  by Dylan; their physics and math rows were removed to re-import.
- 2026-10-27: Overview tab. One card per class (next 3, a one-line status,
  "+N more") or a month calendar with a color per course; a search box; click
  any assignment to Mark done (with Undo).

## Next

1. **New look for the whole app** (from Veeresh's feedback on 10/27: "it could
   be designed to look better"). Dylan: Now shows only the "What now?" card,
   and the style should be distinctive, not close to the default look.
2. Class schedule and time available; also feeds the Today itinerary and the
   debriefs.
3. Focus timer: records real time spent (sessions currently log the planned
   minutes).
4. Learning: compare real times with estimates, adjust per course; learn which
   hours Dylan focuses best; tune session sizes.
5. Discord bot: add tasks by message or photo, "what now?", morning debrief
   (due today, keeping up, first class, weather).
6. Evening "prep for tomorrow" debrief.
7. Exams: dated exams become study sessions (the scheduler already splits big
   tasks); "tests the next day take precedence."
8. Travel time to first class (needs a maps API).
9. Maybe: a Canvas access token for submission status (the feed doesn't say
   what's submitted), if Illinois allows student tokens.
10. Shelved for now: a character for the assistant (pickle, owl, or cat
    concepts were shown 2026-10-21).

**Reminder for Claude:** once import works, build a test set of real
screenshots across platforms and measure extraction accuracy before tuning;
once learning works, measure how far off estimates are week by week. These
numbers are the resume evidence Dylan wants.

## Decisions

- **2026-10-19 — Switched from the TikTok fact-checker to a schoolwork
  assistant.** Dylan's reasons: browser extensions aren't one of the allowed
  platforms (website, Android, iOS), and "realistically who would use this?"
  Dylan would actually use a schoolwork tool, and assignments are where their stress
  goes. An internship finder was considered, but Dylan isn't searching right now.
  A decision helper, focus sessions, and mood check-ins were also offered; the
  assistant folds in focus and energy. The TikTok work is saved in commit
  `f1b634d`; `RESEARCH.md` is the research behind it.
- **2026-10-19 — Screenshots instead of per-site scrapers.** Dylan's concern:
  sites like McGraw Hill Connect need clicking around to see dates, and a
  reader built for one site would be "so specifically tailored to me." A
  screenshot works for any site and anyone, needs no logins, and avoids
  scraping. Canvas gets its calendar feed; Gradescope and PrairieLearn have no
  public student API, so they use screenshots.
- **2026-10-19 — A language model reads screenshots; TypeSafe checks them**
  (Dylan picked this over OCR plus TypeSafe only). Jev can see images but
  returns typed judgments, not text, so a vision language model lists the
  assignments and TypeSafe verifies each row against the image. Images in
  TypeSafe are an early beta ("Dreamer-ready"), another reason to show
  "Check this" flags. Which language model: pending (Claude recommends Claude
  Haiku 5.5).
- **2026-10-19 — Learning from real time spent.** Dylan wanted it to improve
  over time. AI to-do apps already exist (Motion, Reclaim, Todoist); the parts
  you can't download are import from any course site and estimates that learn
  from Dylan's own pace.
- **2026-10-20 — Website plus Discord bot, both full.** Dylan wants to use it
  from their phone through Discord, and decided a website is still worth it for
  what a bot can't show. A website keeps it within the allowed platforms, so
  no email to course staff is needed. Discord over text messages because it's
  easier to build.
- **2026-10-20 — Ambitious scope on purpose.** Dylan wants everything from the
  website to the bot and isn't worried about the 24-hour budget. Build in the
  order under Next so each step is usable on its own.
- **2026-10-22 — A workload-driven plan, no daily budget.** Dylan rejected
  "start by" times right before the deadline ("a smart planner would plan
  ahead") and a daily time budget. Their workflow: everything goes in the app,
  Dylan works through it in order until stopping, things due soon (and tests the
  next day) come first, and the rest is spread over the days before it's due.
  The pace comes from the workload (for each deadline, work due by then over
  days left, finishing a day early, two for big tasks); sessions are 25-60
  min; an hour or less is done in one sitting.
- **2026-10-23 — Compact review.** Dylan wanted to save without reviewing every
  row: Save is at the top, rows needing a decision (Same assignment?, flags)
  come first and open, the rest are one-line summaries that open on click,
  and left-out rows are folded. A "Course for rows without one" box fills
  pages that don't show a course.
- **2026-10-22 — Direct imports.** Canvas has a calendar feed; Gradescope,
  PrairieLearn, and Connect need a login, so they stay screenshots or pasted
  text. Public course sites can be imported by link.
- **2026-10-22 — No energy picker; "Too tired?" instead.** Claude suggested
  asking for energy before each pick; Dylan asked whether that's really worth
  it. Agreed: asking every time adds friction and self-reports are unreliable.
  Instead the pick needs no input, "Too tired?" swaps in something smaller
  only when needed, time available (from class times) comes next, and the
  learning milestone infers energy patterns from the focus timer.
- **2026-10-22 — Two pages: Now and Plan.** Dylan felt showing everything
  next to the next task would still be overwhelming. Now shows only the next
  task; Plan is the organized "display" of everything, and holds importing.
- **2026-10-22 — The server saves to SQLite** (Node's built-in driver) so the
  website and the later Discord bot share one copy.
- **2026-10-22 — `npm start` restarts itself on code changes** and builds the
  page script in memory, after Dylan kept hitting a stale server.
- **2026-10-22 — "Mark done" can be undone.** Dylan found no way back: the
  confirmation now has Undo (restores the previous status, e.g. "Not open
  yet"), and items in Done have Reopen.
- **2026-10-20 — How the two models' answers combine.** If Claude can't tell
  whether a task is open and TypeSafe is confident, use TypeSafe; if TypeSafe
  is unsure (near 50%), go with Claude. Flag a row only for a doubtful due
  date, a confident contradiction, or a status neither can tell. The first
  rule flagged every row on Connect because it treated "unsure" as "disagrees."
- **2026-10-20 — "Closed" covers both past due and submitted.** Dylan: on
  Connect a lock means either, and either way the task is finished for Dylan,
  so the app doesn't separate them.
- **2026-10-20 — Stack: TypeScript on Node 24** (runs TypeScript directly),
  Anthropic and TypeSafe SDKs, zod for the extraction schema, sharp to resize
  images, Node's test runner, Prettier.
- Still to decide: stack, hosting (the bot needs an always-on server), and
  where data is stored (browser only, or an account so it reaches the phone).

## Problems

- **2026-10-23 — Accuracy check on Dylan's physics screenshot and math text.**
  Found: dates without a year that had passed went to next year (Oct 15 →
  2027); empty progress bars read as Closed; "Start: Oct 27" not read as Not
  open yet; four items named just "Homework" (would merge on re-import);
  pasted text can't tell a score of 100% from "80% until Oct 27" credit, so
  HW8 looked open; "Not for credit" practice imported as work. Fixed: nearest
  year, progress-bar and start-date rules, headings in generic names, an
  "optional" kind left out by default. Re-run on the same screenshots: physics
  and math statuses and dates all right. Advice recorded: screenshots for pages
  that show progress as bars or scores, text for pages that say it in words.
- **2026-10-23 — Past work and "eng_100" from a pasted Canvas page.** Dylan
  pasted the ENG 100 assignments page: 22 past, closed assignments came in as
  new, and the course read "eng_100" (saving would have renamed ENG 100).
  Imports now skip new rows that are already finished (the review says how
  many), and every import writes courses as codes.
- **2026-10-23 — "Same assignment as Chapter 1?"** A left-out row with no course
  or date paired with anything undated. Fuzzy matching now skips left-out rows
  and needs both due dates.
- **2026-10-22 — Canvas saved every Italian assignment twice.** The feed names
  courses with codes like "ital_101_120268_264325", which didn't match the
  saved "ITAL 101", so the duplicate check (which only compares within a
  course) saw new assignments, and the copies were marked Open. Found by
  looking at the data after Dylan's first check. Fixed by reading course codes
  from any spelling ("ITAL 101", "ital_101_...", "ITAL101") and comparing
  courses by code; removed the 8 copies and renamed the courses.
- **2026-10-22 — Restart loop.** Watch mode restarted the server endlessly:
  each start wrote `dist/app.js`, and Node's watcher on Windows reacted to it
  even though `dist/` wasn't watched (found by logging every file event).
  Fixed by serving the page script from memory. Also: an old server left
  running in another terminal held port 3000; the server now says so in
  plain words.
- **2026-10-21 — Grade totals can't be told apart from the image alone.**
  Canvas lists Connect work as "Chapter 1–4" grade lines. Without a hint taken
  from the test screenshot (removed as unfair), Haiku and TypeSafe disagree and
  vary run to run. Resolved by design: disagreements are flagged in review, and
  rows the student leaves out are saved as ignored so later imports skip them.
- **2026-10-22 — November deadlines showed 10:59 PM instead of 11:59 PM**
  (found by Dylan). The model wrote every date with October's daylight-time
  offset (-05:00), but Illinois is on -06:00 after Nov 1. Now the model only
  copies the clock time shown, and code adds the offset for the student's time
  zone (`TIME_ZONE`, default America/Chicago) on that date.
- **2026-10-22 — "Check the date" on every row of a cropped screenshot.**
  TypeSafe was asked to confirm "Nov 13, 2026", but the crop didn't show the
  year (the full page did, in the sidebar). Questions now leave out the year,
  and TypeSafe is told today's date, which also fixed it calling "Available
  until Oct 23" closed. Confidence went from 49-80% to 96-99%.
- **2026-10-22 — Course missing on a cropped screenshot** (found by Dylan, who
  typed "Italian" while the other rows said "ITAL 101"). A page's one shown
  course now fills its blank rows; with none shown, TypeSafe picks among the
  saved courses, so one course isn't saved under two names.
- **2026-10-21 — "Due Dec 4 → Dec 4" false change.** A screenshot without a
  time zone got a different guessed offset; changes now compare the clock time
  shown.

- **2026-10-20 — TypeSafe rejected the screenshot ("Invalid image
  dimensions").** TypeSafe accepts 280 to 1568 pixels per side and never
  resizes; the Connect screenshot was 1576 wide, and phone screenshots are
  larger. Fixed by shrinking every image to fit 1568 × 1568 before sending
  (`MAX_IMAGE_SIDE`); Claude shrinks to about that size anyway.
