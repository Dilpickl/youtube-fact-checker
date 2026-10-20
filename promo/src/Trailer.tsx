import type { ReactNode } from "react";
import {
  AbsoluteFill,
  getRemotionEnvironment,
  Html5Audio,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { FloodArt, TalkingHeadArt } from "./Art.tsx";
import {
  ClaimButton,
  Cursor,
  Headlines,
  Icon,
  Player,
  Popover,
  Tooltip,
  type Beat,
} from "./Stage.tsx";
import { COLORS, TONE_COLORS, fontFamily, progress } from "./theme.ts";
import { AI, CLAIMS, SCENES } from "./timeline.ts";

const CROSSFADE = 15;

export const Trailer: React.FC = () => (
  <AbsoluteFill style={{ fontFamily, background: COLORS.background }}>
    <Backdrop />
    <Scene timing={SCENES.hook}>
      <Hook />
    </Scene>
    <Scene timing={SCENES.claims}>
      <ClaimsScene />
    </Scene>
    <Scene timing={SCENES.aiSignals}>
      <AiScene />
    </Scene>
    <Scene timing={SCENES.principles}>
      <Principles />
    </Scene>
    <Scene timing={SCENES.endCard} fadeOut={24}>
      <EndCard />
    </Scene>
    {/* Renders add the soundtrack afterwards with ffmpeg (see `npm run render`):
        Remotion's audio step needs ffprobe, which Windows can block. */}
    {getRemotionEnvironment().isStudio && (
      <Html5Audio src={staticFile("soundtrack.wav")} />
    )}
  </AbsoluteFill>
);

const Scene: React.FC<{
  timing: { from: number; duration: number };
  fadeOut?: number;
  children: ReactNode;
}> = ({ timing, fadeOut = CROSSFADE, children }) => (
  <Sequence from={timing.from} durationInFrames={timing.duration}>
    <Fade duration={timing.duration} fadeOut={fadeOut}>
      {children}
    </Fade>
  </Sequence>
);

const Fade: React.FC<{
  duration: number;
  fadeOut: number;
  children: ReactNode;
}> = ({ duration, fadeOut, children }) => {
  const frame = useCurrentFrame();
  const opacity =
    progress(frame, 0, CROSSFADE) *
    (1 - progress(frame, duration - fadeOut, fadeOut));
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

/** Slow-drifting glows so the dark background never feels static. */
const Backdrop: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      <AbsoluteFill
        style={{
          background: `radial-gradient(1000px circle at ${28 + Math.sin(frame / 80) * 8}% ${40 + Math.cos(frame / 95) * 10}%, rgba(91,140,255,0.16), transparent 62%)`,
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(800px circle at ${78 + Math.cos(frame / 70) * 6}% ${70 + Math.sin(frame / 110) * 8}%, rgba(47,191,113,0.07), transparent 60%)`,
        }}
      />
    </AbsoluteFill>
  );
};

const Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const line = (from: number) => {
    const shown = progress(frame, from, 22);
    return {
      opacity: shown,
      transform: `translateY(${(1 - shown) * 30}px)`,
      filter: `blur(${(1 - shown) * 10}px)`,
    };
  };
  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        fontSize: 96,
        fontWeight: 800,
        letterSpacing: "-0.035em",
        lineHeight: 1.1,
      }}
    >
      <div style={{ ...line(6), color: COLORS.text }}>
        Short videos make big claims.
      </div>
      <div style={{ ...line(40), color: COLORS.muted, marginTop: 12 }}>
        Most of them go <span style={{ color: COLORS.accent }}>unchecked.</span>
      </div>
    </AbsoluteFill>
  );
};

const CLAIM_BEATS: Beat[] = [
  {
    from: 0,
    to: 150,
    eyebrow: "As you watch",
    title: "It reads along with every video.",
    sub: "Spoken words and on-screen text, the moment they appear.",
  },
  {
    from: 150,
    to: 288,
    eyebrow: "Claim detection",
    title: "It spots the claims worth checking.",
    sub: "Nothing to check? It stays out of sight.",
  },
  {
    from: 288,
    to: SCENES.claims.duration,
    eyebrow: "Fact checking",
    title: "Then checks each one against real sources.",
    sub: "Supported, contradicted, or honestly unverified.",
  },
];

const ClaimsScene: React.FC = () => {
  const frame = useCurrentFrame();
  const claimEnds = CLAIMS.sentences.filter((s) => s.claim).map((s) => s.to);
  const detected = claimEnds.filter((end) => frame >= end).length;
  return (
    <AbsoluteFill>
      <Headlines beats={CLAIM_BEATS} />
      <Player
        handle="@wellnesscoach"
        caption="3 things your doctor won't tell you"
        sentences={CLAIMS.sentences}
        pauseAt={CLAIMS.click}
        resumeAt={CLAIMS.resume}
        renderArt={(videoFrame) => <TalkingHeadArt videoFrame={videoFrame} />}
      />
      <ClaimButton
        appearAt={claimEnds[0]}
        label={String(detected)}
        tone="neutral"
        bumps={claimEnds.slice(1)}
        activeFrom={CLAIMS.click}
        activeTo={CLAIMS.close}
      />
      <Tooltip
        from={claimEnds[claimEnds.length - 1] + 6}
        to={CLAIMS.click}
        text="3 claims to check"
      />
      <Cursor
        from={CLAIMS.cursorFrom}
        clickAt={CLAIMS.click}
        start={{ x: 1700, y: 1000 }}
      />
      <Popover
        openAt={CLAIMS.click + 3}
        closeAt={CLAIMS.close}
        sections={[
          { title: "Claims", rows: CLAIMS.rows },
          {
            title: "Made with AI?",
            rows: [
              {
                text: "No signs found",
                detail: "Clear · no label or AI tags",
                tone: "supported",
                resolveAt: CLAIMS.noAiSignsAt,
              },
            ],
          },
        ]}
      />
    </AbsoluteFill>
  );
};

const AiScene: React.FC = () => (
  <AbsoluteFill>
    <Headlines
      beats={[
        {
          from: 0,
          to: SCENES.aiSignals.duration,
          eyebrow: "AI signals",
          title: "It flags signs a video was made with AI.",
          sub: "From TikTok's own label, the hashtags, and what viewers notice.",
        },
      ]}
    />
    <Player
      handle="@breakingclips"
      caption="Flooding in downtown Chicago right now #veo3"
      sentences={AI.sentences}
      pauseAt={AI.click}
      renderArt={(videoFrame) => <FloodArt videoFrame={videoFrame} />}
      topTag="BREAKING"
    />
    <ClaimButton
      appearAt={AI.buttonIn}
      label="AI"
      tone="warn"
      bumps={[]}
      activeFrom={AI.click}
    />
    <Tooltip from={AI.buttonIn + 8} to={AI.click} text="Signs of AI found" />
    <Cursor
      from={AI.cursorFrom}
      clickAt={AI.click}
      start={{ x: 1650, y: 1010 }}
    />
    <Popover
      openAt={AI.click + 3}
      sections={[
        {
          title: "Made with AI?",
          rows: [
            {
              text: "Likely made with AI",
              detail: "2 of 3 signals found",
              tone: "warn",
              resolveAt: AI.verdictAt,
            },
            ...AI.signals,
          ],
        },
        {
          title: "Claims",
          rows: [
            {
              text: "Downtown Chicago is flooding right now",
              detail: "Contradicted · 2 sources",
              tone: "contradicted",
              resolveAt: AI.claimAt,
            },
          ],
        },
      ]}
    />
  </AbsoluteFill>
);

const PRINCIPLES = [
  {
    icon: "moon",
    title: "Quiet by default",
    body: "Nothing appears unless there's something to check.",
  },
  {
    icon: "check",
    title: "Each claim on its own",
    body: "One false claim doesn't condemn a whole video.",
  },
  {
    icon: "help",
    title: "Honest about doubt",
    body: "Unverified means unverified. Never a guess.",
  },
  {
    icon: "lock",
    title: "Private by design",
    body: "Only claim text is checked. Never your history.",
  },
] as const;

const Principles: React.FC = () => {
  const frame = useCurrentFrame();
  const heading = progress(frame, 4, 20);
  return (
    <AbsoluteFill style={{ alignItems: "center", paddingTop: 255 }}>
      <div
        style={{
          opacity: heading,
          transform: `translateY(${(1 - heading) * 20}px)`,
          textAlign: "center",
        }}
      >
        <div style={{ color: COLORS.accent, fontSize: 26, fontWeight: 600 }}>
          Design principles
        </div>
        <div
          style={{
            color: COLORS.text,
            fontSize: 72,
            fontWeight: 800,
            letterSpacing: "-0.03em",
            marginTop: 14,
          }}
        >
          Built to earn your trust.
        </div>
      </div>
      <div style={{ display: "flex", gap: 24, marginTop: 80 }}>
        {PRINCIPLES.map((principle, index) => {
          const shown = progress(frame, 16 + index * 9, 20);
          return (
            <div
              key={principle.title}
              style={{
                width: 392,
                padding: 36,
                borderRadius: 26,
                background: COLORS.surface,
                border: `1px solid ${COLORS.border}`,
                opacity: shown,
                transform: `translateY(${(1 - shown) * 34}px)`,
              }}
            >
              <div
                style={{
                  width: 60,
                  height: 60,
                  borderRadius: 16,
                  background: "rgba(91,140,255,0.14)",
                  color: COLORS.accent,
                  padding: 15,
                  boxSizing: "border-box",
                }}
              >
                <Icon name={principle.icon} />
              </div>
              <div
                style={{
                  color: COLORS.text,
                  fontSize: 30,
                  fontWeight: 700,
                  marginTop: 28,
                  whiteSpace: "nowrap",
                }}
              >
                {principle.title}
              </div>
              <div
                style={{
                  color: COLORS.muted,
                  fontSize: 24,
                  lineHeight: 1.45,
                  marginTop: 12,
                }}
              >
                {principle.body}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const logo = spring({
    frame: frame - 6,
    fps,
    config: { damping: 12, stiffness: 120 },
  });
  const part = (from: number) => {
    const shown = progress(frame, from, 20);
    return { opacity: shown, transform: `translateY(${(1 - shown) * 18}px)` };
  };
  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
      }}
    >
      <div
        style={{
          transform: `scale(${logo})`,
          opacity: Math.min(1, logo * 1.5),
        }}
      >
        <Logo size={128} />
      </div>
      <div
        style={{
          ...part(14),
          color: COLORS.text,
          fontSize: 92,
          fontWeight: 800,
          letterSpacing: "-0.035em",
          marginTop: 40,
        }}
      >
        Video Fact Check
      </div>
      <div
        style={{
          ...part(26),
          color: COLORS.muted,
          fontSize: 40,
          marginTop: 14,
        }}
      >
        Know what you're watching.
      </div>
      <div
        style={{
          ...part(42),
          color: COLORS.faint,
          fontSize: 24,
          marginTop: 64,
        }}
      >
        Chrome extension · for TikTok on the web
      </div>
      <div
        style={{
          ...part(50),
          marginTop: 22,
          padding: "8px 18px",
          borderRadius: 999,
          border: `1px solid ${COLORS.border}`,
          color: TONE_COLORS.warn,
          fontSize: 20,
          fontWeight: 600,
        }}
      >
        Concept preview · in development
      </div>
    </AbsoluteFill>
  );
};

/** The mark: a magnifying glass with a check inside, on the accent color. */
export const Logo: React.FC<{ size: number }> = ({ size }) => (
  <svg viewBox="0 0 96 96" width={size} height={size}>
    <rect width="96" height="96" rx="26" fill={COLORS.accent} />
    <circle cx="42" cy="42" r="20" fill="none" stroke="white" strokeWidth="7" />
    <line
      x1="57"
      y1="57"
      x2="72"
      y2="72"
      stroke="white"
      strokeWidth="8"
      strokeLinecap="round"
    />
    <polyline
      points="33,42 40,49 52,36"
      fill="none"
      stroke="white"
      strokeWidth="6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
