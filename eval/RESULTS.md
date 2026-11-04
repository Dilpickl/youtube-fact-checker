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

# Haiku 5.5 on the same claims, 2026-11-02

Same 30 claims as above (read back from the Opus reports with
`eval/check.ts <transcript> <report>`), same five-search cap. Graded by Claude
against the sources each checker cited; not yet reviewed by Dylan.

| Video | Opus cost | Haiku cost | Of which searches | Haiku agrees with Opus |
| --- | --- | --- | --- | --- |
| Kurzgesagt | $1.39 | $0.15 | $0.13 | 6 of 10 |
| Berg (seed oils) | $1.24 | $0.15 | $0.13 | 6 of 10 |
| PBS NewsHour | $1.24 | $0.20 | $0.17 | 7 of 10 |

Of the 11 disagreements:

- **Haiku better (4).** Opus's Berg and PBS reports were the first run, with
  failed searches. Haiku had no failures and fixed Opus's one too-soft verdict
  ("one serving is toxic for three years": contradicted), and sourced "fryer oil
  reused 100 times" (contradicted), the smoking claim, and Bresnahan's votes.
- **Haiku wrong (2).** Karahan Tepe "about 12,000 years ago" called misleading
  over 11,400 vs 12,000; "the New York Times reported X" called misleading
  because X is disputed, though the claim is only that the Times reported it.
- **Haiku harsher, arguable (5).** World population 5–10 million, Çatalhöyük
  "hundreds", the 8.2 ka drainage, seed oils "not burned as fuel"
  (contradicted, where its own text says partly true), Musk "biggest donor"
  (drops "modern").

The pattern: Haiku calls 14 of 30 claims misleading (Opus 9), flagging round
numbers and missing qualifiers. Searches are now about 85% of the cost.

## Second run, with a tuned prompt

`CHECK_CLAIM` now says rounded numbers and numbers inside the experts' range
are supported, "misleading" means a viewer would come away believing something
false, and "X reported Y" is judged on whether X reported it.

| Video | Haiku cost | Searches | Misleading verdicts |
| --- | --- | --- | --- |
| Kurzgesagt | $0.17 | 15 | 0 (was 6) |
| Berg (seed oils) | $0.14 | 12 | 2 (was 5) |
| PBS NewsHour | $0.21 | 18 | 0 (was 2) |

- **Fixed:** all five nitpicks and both wrong verdicts (Karahan Tepe, the New
  York Times claim). The four verdicts Haiku did better than Opus held.
- **Now too soft (1):** "seed oils were developed around 1865 and not meant
  for human consumption" is supported, though its own explanation says it
  generalizes cottonseed oil to all seed oils. Opus said misleading. Dylan
  agrees it's misleading (2026-11-03): it sounds like a general history of
  all seed oils, which it isn't.
- **Arguable (2):** Kushim "considered the first known name" supported (Opus:
  misleading, scholars debate it); seed-oil fats "replace components of cell
  membranes" supported (accurate as written, but the video said membranes).
- **Honest downgrade:** the oil peroxidation ranking is now unverified; Opus's
  misleading came from a failed search.

About as accurate as Opus (one verdict wrong each) at an eighth of the cost.
It leans a little soft on the health video, which is worth watching.

# TypeSafe filter before searching, 2026-11-02

Could a cheap judgment skip the claims that don't need a web search?
`eval/filter.ts` asks Jev (jev-latest) two questions about each of the 30
claims, with no sources: "could this plausibly be false, exaggerated, or
misleading?" (a yes/no probability) and "how likely is a fact-checker to find a
problem?" (four levels). Full table in `results/filter.md`.

Bar set before running: keep all 8 claims the tuned Haiku run didn't call
supported, and skip at least half of the 22 supported ones. **It missed.**

- Keeping all 8, the best cutoff (doubt ≥ 0.6) skips only 5 of 22 claims,
  roughly a 15% saving on searches.
- The one flagged claim it ranks low is Göbekli Tepe "largest", which can't be
  graded anyway. Without it, doubt ≥ 0.7 keeps 7 of 7 and skips 10 of 22:
  close to the bar, not over it.
- It works as a "sounds suspicious" detector: seed-oil scares rank at the top
  and textbook dates at the bottom. But every news claim from this week ranks
  high (Pope Leo's ballot: 0.96), because it can't know recent events, so news
  videos would get no savings at all.
- About 560 input tokens per claim. TypeSafe's price per token isn't in its
  docs, so the cost of the filter itself is unknown.

# Third prompt tune, seed-oil video only, 2026-11-03

Two lines added to `CHECK_CLAIM`: guidelines about what people should do don't
contradict claims about what they actually do (Dylan's catch on the fryer-oil
verdict), and a specific claim no research supports, where sources say the
effect doesn't exist, is contradicted rather than unverified. Only the
seed-oil video was rerun, to keep tuning cheap ($0.18).

- **Fixed (2):** "one serving is toxic for three years" is now contradicted
  (was unverified in the live test); "seed oils developed around 1865, not
  meant for food" is now misleading, as Dylan judged.
- **Not fixed (1):** "fast food reuses oil a hundred times" is still
  contradicted, again on reuse guidance and replacement schedules rather than
  a count of batches. The claim is ambiguous (a week of busy frying could
  pass 100 batches), so a prompt line may not settle it.
- **Other changes:** the oil peroxidation ranking went from unverified to
  misleading; the rest matched the earlier tuned run.
