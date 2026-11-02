# Accuracy check, 2026-11-02

Three videos, the ten claims per video the checker judged most worth checking,
Claude Opus 5.5 with web search (`eval/check.ts`). Claude graded each verdict
against the video's own sources (Kurzgesagt) or the sources the checker cited.
Full reports with sources are in `results/`.

| Video | Captions | Right | Too soft | Can't grade | Cost |
| --- | --- | --- | --- | --- | --- |
| Kurzgesagt, humanity's first civilization | automatic | 9 | 0 | 1 | $1.39 |
| Dr. Eric Berg, "Do NOT Cook with This!!!" (seed oils) | automatic, no punctuation | 9 | 1 | 0 | $1.24 |
| PBS NewsHour, final midterm stops | written by the channel | 10* | 0 | 0 | $1.24 |

\* News from this week can only be checked against other reports of the same
events (CBS, NBC, ABC, the Anchorage Daily News). "Supported" there means
"other outlets report it too", not independent proof.

## What worked

- **Messy captions are fine.** Misheard names ("Chatt Huk", "Gerberite",
  "Tash Teleer") came back as Çatalhöyük, Göbekli Tepe, Taş Tepeler. A
  transcript with no punctuation at all (Berg) still gave ten sensible claims.
- **Nuance beats the answer key.** On Çatalhöyük "hundreds of people", the
  checker found a newer study (600–800 people) that Kurzgesagt's own sources
  page doesn't cite, and said the older, larger estimates are still debated.
- **The health video got the verdicts a skeptic would want**: "seed oils cause
  insulin resistance, obesity, heart disease, cancer" contradicted; "25–30% of
  calories" misleading, traced to an advocacy group's figure.
- **Claim choice was good**: statistics, dates, forecasts; no opinions or jokes.

## What went wrong

- **Verdicts without sources are the bad ones.** In the first run, 12 checks
  ran at once and about 9 of 30 lost their web search; the model then answered
  from memory. Those were the wrong or weak verdicts (Çatalhöyük "contradicted";
  "one serving poisons you for 3 years" only "unverified"). Rule for the app:
  never show a verdict without a source; show "couldn't check" instead.
- **Weak sources slip in**: one verdict leaned on Flickr and Medium posts.
- **Cost**: about $0.12 per claim, $1.10–1.40 per video with this model. Too
  much to check every video someone opens. Cheaper models are the next test.
- **Credits ran out** during the rerun, so the Berg and PBS reports are from
  the first run (with its search failures, marked in the text).

## Can't grade

- "Göbekli Tepe is the largest Taş Tepeler site": the captions say
  "Gerberite", so we don't know which site the narrator named.
