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

(nothing yet for this app)

## Next

1. **Milestone 1, screenshot import (server side).** Done when Dylan drops in
   the Connect Capitolo 5 screenshot and gets all seven assignments with the
   right due dates, with Strutture III (Oct 20) and Cultura (Oct 21) marked
   still open.
2. Website: review and fix an import, save assignments, add more screenshots
   (merge duplicates, apply updates).
3. "What now?": energy level, one task, reason, start-by time, "Not now".
4. Focus timer: start, done, next up; records time actually spent.
5. Learning: compare timer data with estimates, adjust per course; learn which
   hours Dylan focuses best.
6. Discord bot: add tasks by message or photo, "what now?", morning debrief
   (due today, keeping up, first class, weather).
7. Evening "prep for tomorrow" debrief.
8. Canvas calendar feed import.
9. Exams: split into study sessions spread over the days before.
10. Travel time to first class (needs a maps API).

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
- Still to decide: stack, hosting (the bot needs an always-on server), and
  where data is stored (browser only, or an account so it reaches the phone).

## Problems

(none yet for this app)
