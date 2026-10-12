# Feasibility research: active fact-checker for short-form video

Date: 2026-10-12. Status: pre-decision. Nothing here is committed yet.

The question that decides the project: **can we get at what a reel actually
says, or only its caption text?** A tool that reads hashtags is a toy. A tool
that reads the spoken claims is real.

## Finding 1: TikTok and Instagram are not symmetric

**TikTok exposes caption tracks, including auto-generated ASR ones, in its
public web player data.** No login, no cookies. Multiple third-party tools do
exactly this today and output WebVTT/SRT. Videos with recognizable speech get
auto-captions; music-only and dance videos legitimately have none.

**Instagram does not.** Its auto-captions are a creator-side authoring feature
(a Captions sticker in the Reels editor), not a public transcript track. The
only route to Instagram transcripts is intercepting internal GraphQL responses
— undocumented, changes without notice, and squarely against their terms. Meta
also enforces this aggressively: cease-and-desists, partner bans, litigation.

**Consequence: build for TikTok first.** Instagram is a stretch goal at best
and possibly should be dropped. This is the single most important finding and
it was not obvious going in.

## Finding 2: "Active" is achievable, but only via caption tracks

If the transcript already exists in the page, there is no transcription step.
That removes the latency wall. TypeSafe judgments return in roughly 150ms, so a
claim-detection pass can finish while the user is still watching the video.

That makes a live badge genuinely feasible — not a promise we have to fake.

Evidence retrieval is the slow part (web search per claim, measured in
seconds). So the design splits:

- **Fast path, automatic:** transcript -> per-sentence judgments -> badge.
  "3 checkable claims" appears during playback.
- **Slow path, on demand:** user taps the badge -> retrieval -> per-source
  stance judgments -> verdicts.

## Finding 3: Audio capture works as a fallback, with real costs

`chrome.tabCapture` plus an MV3 offscreen document can capture tab audio and
feed Whisper. Constraints found:

- Requires a user gesture (extension action click). Cannot run automatically.
- Capturing **mutes the tab** unless the stream is routed back through an
  `AudioContext` to its destination.
- Stream IDs are single-use and expire in seconds.
- Transcription is slow and costs money per minute.

So this is the fallback for videos with no caption track, triggered manually.
Not the primary path.

## Finding 4: Posture matters more than technique

The defensible version is a **local-only extension that reads what the
logged-in user is already looking at**, one video at a time, at human pace,
with nothing shipped to a server beyond the claim text we need to check.

What we will not do: bulk collection, crawling feeds we are not watching,
bypassing authentication, or retaining anyone's data. Those are the things that
draw enforcement and they are also just not necessary for this tool.

## The options, weighed

| Option | Gets spoken claims? | Active? | Effort | Verdict |
|---|---|---|---|---|
| TikTok extension, caption tracks | Yes | Yes | Medium | **Recommended** |
| TikTok extension, audio capture | Yes | No, manual | High | Fallback only |
| Instagram extension | Only via GraphQL interception | Yes | High + ToS risk | Avoid for now |
| Paste-a-link web app | Yes | No | Low | Rejected: not active |
| Android screen reading | Yes | Yes | Very high | Out of scope |

## Recommended architecture

1. Content script on `tiktok.com`, anchored to stable attributes (`aria`,
   `role`, `href` patterns) rather than obfuscated class names. Needs a
   MutationObserver — it is a single-page app that loads as you scroll.
2. Pull caption track + description + hashtags for the video in view.
3. TypeSafe fan-out per sentence: `Noul(is a checkable factual claim)`,
   `Choice(domain)`, `Score(harm if wrong)`. Badge renders from this.
4. On demand: Google Fact Check Tools API first (cheap, authoritative, finds
   already-published checks), then web retrieval, then `Noul(supports)` /
   `Noul(contradicts)` per source. Compose into a verdict in code.
5. Low confidence resolves to "unverified," never to a guess.
6. TypeSafe API key stays server-side. The extension talks to our endpoint,
   never directly to TypeSafe.

## The crux assumption, still unverified

Everything above rests on TikTok's caption tracks being readable from a content
script on a normal video page in 2026. The evidence is strong but indirect —
third-party tools doing it, not documentation.

**Milestone 1 should be proving exactly this and nothing else:** load a TikTok
video page, extract the transcript, print it. If that works, the project is
real. If it does not, we find out in session one instead of session six.

## Finding 5: AI-video detection — signals, not a detector

Researched 2026-10-12 after deciding to add AI detection alongside claims.

**Pixel-level detectors are not trustworthy enough to show as a verdict.**
Commercial video detectors (Hive, BitMind, others) publish no accuracy or
false-positive rates on recent generators. A University of Toronto project
testing research detectors on Sora 2 output found consistently high false
positives, worst on fast cuts and stylized footage — exactly what TikTok is
full of. Humans score about 52% on Veo/Sora clips, near chance; general
chatbots missed 78–95% of Sora videos in a NewsGuard test. Flagging a real
video as fake is the worst error this tool can make.

**What we can use instead, strongest first:**

1. **TikTok's own AI label.** TikTok auto-labels uploads carrying C2PA
   Content Credentials (since May 2024) and requires creators to label
   realistic AI content. If the label is on the page, a content script can
   read it. Definitive when present, often absent: most pipelines strip
   metadata before upload.
2. **Caption and hashtags.** Creators often say so themselves (#sora, #veo3,
   "made with AI"). A TypeSafe judgment over the caption text.
3. **Comments.** Viewers are often quick to call out AI ("look at the hands").
   A TypeSafe judgment over the comments the user can already see. Must
   separate genuine observations from jokes and reflexive "it's AI" replies.

**Presentation rule:** report which signals fired ("2 of 3 signals"), never a
bare "this is AI." No signals means "no signs found," not "real."

**Possible later addition:** a frame-level detector API as a fourth, weakest
signal, labeled as unreliable. Only after measuring its false-positive rate on
our own sample of real TikToks.

**Separate question from claims.** An AI video can make true claims and a real
video can make false ones, so the popover shows the two sections independently.

### Sources for finding 5
- https://www.nbcnews.com/tech/tech-news/tiktok-will-automatically-label-ai-generated-content-rcna151446
- https://www.imore.com/apps/tiktok-will-auto-label-ai-generated-content-including-images-and-videos-made-elsewhere-in-social-media-world-first
- https://billo.app/blog/ai-labeling/
- https://www.cs.toronto.edu/~lindell/teaching/2529/past_projects/2025/report/jaswin-hargun.pdf
- https://popularaitools.ai/blog/ai-video-detector/
- https://the-decoder.com/chatgpt-fails-to-spot-92-of-fake-videos-made-by-openais-own-sora-tool/
- https://arxiv.org/pdf/2602.17260

## Sources

- https://developer.chrome.com/docs/extensions/mv3/screen_capture
- https://github.com/recallai/chrome-recording-transcription-extension
- https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- https://apify.com/eliai/tiktok-transcript-clean
- https://help.instagram.com/740480200552298
- https://dev.to/hamdi_laadhari/chrome-extension-network-interception-the-modern-way-to-scrape-instagram-and-beyond-49bl
