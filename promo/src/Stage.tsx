// The demo layout: headline on the left, a vertical video in the middle, the
// extension's button beside its corner, and the popover to the right.
import type { ReactNode } from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLORS, TONE_COLORS, progress } from "./theme.ts";
import type { Sentence, Tone } from "./timeline.ts";

export const PLAYER = { left: 800, top: 130, width: 461, height: 820 };
const BUTTON = {
  left: PLAYER.left + PLAYER.width + 22,
  top: PLAYER.top,
  size: 60,
};
const POPOVER = {
  left: BUTTON.left + BUTTON.size + 22,
  top: PLAYER.top,
  width: 450,
};
const BUTTON_CENTER = {
  x: BUTTON.left + BUTTON.size / 2,
  y: BUTTON.top + BUTTON.size / 2,
};

export interface Beat {
  from: number;
  to: number;
  eyebrow: string;
  title: string;
  sub: string;
}

export const Headlines: React.FC<{ beats: Beat[] }> = ({ beats }) => {
  const frame = useCurrentFrame();
  const beat = beats.find(
    (candidate) => frame >= candidate.from && frame < candidate.to,
  );
  if (!beat) return null;
  const exit = progress(frame, beat.to - 12, 12);
  const part = (delay: number) => {
    const enter = progress(frame, beat.from + delay, 20);
    return {
      opacity: enter * (1 - exit),
      transform: `translateY(${(1 - enter) * 26 - exit * 14}px)`,
    };
  };
  return (
    <div
      style={{
        position: "absolute",
        left: 120,
        width: 600,
        top: 0,
        bottom: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          ...part(0),
          color: COLORS.accent,
          fontSize: 26,
          fontWeight: 600,
        }}
      >
        {beat.eyebrow}
      </div>
      <div
        style={{
          ...part(4),
          color: COLORS.text,
          fontSize: 66,
          fontWeight: 800,
          lineHeight: 1.08,
          letterSpacing: "-0.025em",
          marginTop: 18,
        }}
      >
        {beat.title}
      </div>
      <div
        style={{
          ...part(9),
          color: COLORS.muted,
          fontSize: 29,
          lineHeight: 1.4,
          marginTop: 28,
        }}
      >
        {beat.sub}
      </div>
    </div>
  );
};

interface PlayerProps {
  handle: string;
  caption: string;
  sentences: Sentence[];
  pauseAt: number;
  resumeAt?: number;
  renderArt: (videoFrame: number) => ReactNode;
  topTag?: string;
}

/** A generic vertical video player. Its clock stops while paused. */
export const Player: React.FC<PlayerProps> = ({
  handle,
  caption,
  sentences,
  pauseAt,
  resumeAt,
  renderArt,
  topTag,
}) => {
  const frame = useCurrentFrame();
  const resume = resumeAt ?? Number.POSITIVE_INFINITY;
  const videoFrame =
    frame < pauseAt
      ? frame
      : frame < resume
        ? pauseAt
        : pauseAt + frame - resume;
  const paused =
    resumeAt === undefined
      ? progress(frame, pauseAt, 8)
      : progress(frame, pauseAt, 8) * (1 - progress(frame, resumeAt - 4, 8));

  return (
    <div
      style={{
        position: "absolute",
        ...PLAYER,
        borderRadius: 34,
        overflow: "hidden",
        boxShadow:
          "0 50px 140px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.10)",
      }}
    >
      {renderArt(videoFrame)}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.30) 0%, transparent 16%, transparent 60%, rgba(0,0,0,0.75) 100%)",
        }}
      />
      {topTag && (
        <div
          style={{
            position: "absolute",
            top: 34,
            left: 28,
            background: "#E5383B",
            color: "white",
            fontSize: 21,
            fontWeight: 800,
            letterSpacing: "0.06em",
            padding: "6px 12px",
            borderRadius: 6,
          }}
        >
          {topTag}
        </div>
      )}
      <BurnedCaptions sentences={sentences} videoFrame={videoFrame} />
      <ActionRail />
      <div
        style={{
          position: "absolute",
          left: 28,
          right: 96,
          bottom: 40,
          color: "white",
        }}
      >
        <div style={{ fontSize: 25, fontWeight: 700 }}>{handle}</div>
        <div
          style={{ fontSize: 21, marginTop: 8, opacity: 0.9, lineHeight: 1.35 }}
        >
          {caption}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 4,
          background: "rgba(255,255,255,0.18)",
        }}
      >
        <div
          style={{
            width: `${Math.min(100, (videoFrame / 520) * 100)}%`,
            height: "100%",
            background: "white",
          }}
        />
      </div>
      <AbsoluteFill
        style={{
          background: `rgba(0, 0, 0, ${0.42 * paused})`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            opacity: paused,
            transform: `scale(${0.7 + 0.3 * paused})`,
            color: "white",
            width: 96,
            height: 96,
          }}
        >
          <Icon name="pause" filled />
        </div>
      </AbsoluteFill>
    </div>
  );
};

const BurnedCaptions: React.FC<{
  sentences: Sentence[];
  videoFrame: number;
}> = ({ sentences, videoFrame }) => {
  const sentence = sentences.find(
    (s) => videoFrame >= s.from && videoFrame < s.to + 8,
  );
  if (!sentence) return null;
  const words = sentence.text.split(" ");
  const perWord = (sentence.to - sentence.from - 14) / words.length;
  const leaving = progress(videoFrame, sentence.to + 2, 6);
  const underline = sentence.claim
    ? progress(videoFrame, sentence.to - 12, 12)
    : 0;
  return (
    <div
      style={{
        position: "absolute",
        left: 56,
        right: 100,
        top: 455,
        textAlign: "center",
        opacity: 1 - leaving,
      }}
    >
      <div
        style={{
          color: "white",
          fontSize: 40,
          fontWeight: 800,
          lineHeight: 1.22,
          textShadow: "0 2px 12px rgba(0,0,0,0.65)",
        }}
      >
        {words.map((word, index) => {
          const shown = progress(
            videoFrame,
            sentence.from + index * perWord,
            5,
          );
          return (
            <span key={index}>
              <span
                style={{
                  display: "inline-block",
                  opacity: shown,
                  transform: `translateY(${(1 - shown) * 8}px)`,
                }}
              >
                {word}
              </span>{" "}
            </span>
          );
        })}
      </div>
      <div
        style={{
          margin: "14px auto 0",
          width: 120,
          height: 5,
          borderRadius: 3,
          background: COLORS.accent,
          transform: `scaleX(${underline})`,
          opacity: underline,
        }}
      />
    </div>
  );
};

const ActionRail: React.FC = () => (
  <div
    style={{
      position: "absolute",
      right: 18,
      bottom: 150,
      display: "flex",
      flexDirection: "column",
      gap: 26,
      color: "white",
      alignItems: "center",
      fontSize: 17,
      fontWeight: 600,
    }}
  >
    {(
      [
        ["heart", "48.2K"],
        ["comment", "1,204"],
        ["share", "806"],
      ] as const
    ).map(([icon, count]) => (
      <div
        key={icon}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 6,
        }}
      >
        <div style={{ width: 40, height: 40 }}>
          <Icon name={icon} />
        </div>
        {count}
      </div>
    ))}
  </div>
);

interface ClaimButtonProps {
  appearAt: number;
  label: string;
  tone: "neutral" | "warn";
  bumps: number[];
  activeFrom: number;
  activeTo?: number;
}

/** The extension's button, anchored outside the video's top-right corner. */
export const ClaimButton: React.FC<ClaimButtonProps> = ({
  appearAt,
  label,
  tone,
  bumps,
  activeFrom,
  activeTo,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < appearAt) return null;
  const appear = spring({
    frame: frame - appearAt,
    fps,
    config: { damping: 11, stiffness: 170 },
  });
  const bump = Math.max(
    0,
    ...bumps.map((at) =>
      frame >= at && frame < at + 14
        ? Math.sin(((frame - at) / 14) * Math.PI) * 0.18
        : 0,
    ),
  );
  const closed = activeTo === undefined ? 0 : progress(frame, activeTo, 8);
  const active = progress(frame, activeFrom, 6) * (1 - closed);
  const toneColor = tone === "warn" ? TONE_COLORS.warn : COLORS.text;
  return (
    <div
      style={{
        position: "absolute",
        left: BUTTON.left,
        top: BUTTON.top,
        width: BUTTON.size,
        height: BUTTON.size,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: label.length > 1 ? 21 : 25,
        fontWeight: 800,
        color: toneColor,
        background: `rgba(91, 140, 255, ${0.08 + 0.22 * active})`,
        border: `2px solid ${tone === "warn" ? TONE_COLORS.warn : `rgba(255,255,255,${0.22 + 0.5 * active})`}`,
        opacity: Math.min(1, appear * 1.4),
        transform: `scale(${(0.5 + 0.5 * appear) * (1 + bump)})`,
      }}
    >
      {label}
    </div>
  );
};

export const Tooltip: React.FC<{ from: number; to: number; text: string }> = ({
  from,
  to,
  text,
}) => {
  const frame = useCurrentFrame();
  if (frame < from || frame >= to) return null;
  const shown = progress(frame, from, 12) * (1 - progress(frame, to - 6, 6));
  return (
    <div
      style={{
        position: "absolute",
        left: BUTTON.left + BUTTON.size + 16,
        top: BUTTON.top + 9,
        padding: "9px 16px",
        borderRadius: 10,
        background: COLORS.surface,
        border: `1px solid ${COLORS.border}`,
        color: COLORS.text,
        fontSize: 21,
        fontWeight: 500,
        whiteSpace: "nowrap",
        opacity: shown,
        transform: `translateX(${(1 - shown) * -10}px)`,
      }}
    >
      {text}
    </div>
  );
};

/** A mouse pointer that glides to the button and clicks it. */
export const Cursor: React.FC<{
  from: number;
  clickAt: number;
  start: { x: number; y: number };
}> = ({ from, clickAt, start }) => {
  const frame = useCurrentFrame();
  if (frame < from || frame > clickAt + 40) return null;
  const travel = interpolate(frame, [from, clickAt - 3], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.45, 0, 0.15, 1),
  });
  const x = start.x + (BUTTON_CENTER.x + 6 - start.x) * travel;
  const y =
    start.y +
    (BUTTON_CENTER.y + 8 - start.y) * travel -
    Math.sin(travel * Math.PI) * 50;
  const press = interpolate(
    frame,
    [clickAt - 1, clickAt + 2, clickAt + 8],
    [1, 0.8, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );
  const ripple = progress(frame, clickAt, 20);
  const fade = 1 - progress(frame, clickAt + 22, 16);
  return (
    <>
      {frame >= clickAt && (
        <div
          style={{
            position: "absolute",
            left: BUTTON_CENTER.x - 60 * ripple,
            top: BUTTON_CENTER.y - 60 * ripple,
            width: 120 * ripple,
            height: 120 * ripple,
            borderRadius: "50%",
            border: `3px solid ${COLORS.accent}`,
            opacity: 0.7 * (1 - ripple),
          }}
        />
      )}
      <svg
        viewBox="0 0 26 28"
        width={38}
        height={41}
        style={{
          position: "absolute",
          left: x - 4,
          top: y - 3,
          opacity: fade,
          transform: `scale(${press})`,
          transformOrigin: "4px 3px",
          filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.5))",
        }}
      >
        <path
          d="M3 2 L3 22 L8.5 16.8 L12.2 25 L15.6 23.5 L11.9 15.4 L19 15.4 Z"
          fill="white"
          stroke={COLORS.background}
          strokeWidth={1.4}
          strokeLinejoin="round"
        />
      </svg>
    </>
  );
};

export interface PopoverRow {
  text: string;
  detail: string;
  tone: Tone;
  resolveAt: number;
}

export const Popover: React.FC<{
  openAt: number;
  closeAt?: number;
  sections: { title: string; rows: PopoverRow[] }[];
}> = ({ openAt, closeAt, sections }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < openAt) return null;
  const open = spring({
    frame: frame - openAt,
    fps,
    config: { damping: 18, stiffness: 150 },
  });
  const close = closeAt === undefined ? 0 : progress(frame, closeAt, 10);
  let rowIndex = 0;
  return (
    <div
      style={{
        position: "absolute",
        left: POPOVER.left,
        top: POPOVER.top,
        width: POPOVER.width,
        padding: "26px 28px 14px",
        borderRadius: 24,
        background: COLORS.surface,
        border: `1px solid ${COLORS.border}`,
        boxShadow: "0 40px 100px rgba(0,0,0,0.5)",
        opacity: Math.min(1, open) * (1 - close),
        transform: `translateX(${(1 - open) * -24 - close * 14}px)`,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ color: COLORS.muted, fontSize: 20 }}>
          Paused while you read
        </span>
        <div style={{ width: 22, height: 22, color: COLORS.faint }}>
          <Icon name="close" />
        </div>
      </div>
      {sections.map((section) => (
        <div key={section.title}>
          <div
            style={{
              color: COLORS.faint,
              fontSize: 18,
              fontWeight: 600,
              marginTop: 24,
              marginBottom: 4,
            }}
          >
            {section.title}
          </div>
          {section.rows.map((row) => (
            <Row
              key={row.text}
              row={row}
              appearAt={openAt + 6 + 4 * rowIndex++}
            />
          ))}
        </div>
      ))}
    </div>
  );
};

const Row: React.FC<{ row: PopoverRow; appearAt: number }> = ({
  row,
  appearAt,
}) => {
  const frame = useCurrentFrame();
  const shown = progress(frame, appearAt, 10);
  const resolved = progress(frame, row.resolveAt, 10);
  const pop =
    frame >= row.resolveAt && frame < row.resolveAt + 12
      ? Math.sin(((frame - row.resolveAt) / 12) * Math.PI) * 0.5
      : 0;
  const pulse = 0.4 + 0.6 * Math.abs(Math.sin(frame / 7));
  const [verdict, rest] = row.detail.split(" · ");
  return (
    <div
      style={{
        display: "flex",
        gap: 16,
        padding: "13px 0",
        borderTop: `1px solid ${COLORS.border}`,
        opacity: shown,
        transform: `translateY(${(1 - shown) * 8}px)`,
      }}
    >
      <div
        style={{
          position: "relative",
          width: 14,
          height: 14,
          marginTop: 8,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            background: COLORS.accent,
            opacity: (1 - resolved) * pulse,
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            background: TONE_COLORS[row.tone],
            opacity: resolved,
            transform: `scale(${1 + pop})`,
          }}
        />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: COLORS.text, fontSize: 22, lineHeight: 1.35 }}>
          {row.text}
        </div>
        <div
          style={{
            position: "relative",
            height: 26,
            marginTop: 3,
            fontSize: 18,
          }}
        >
          <span
            style={{
              position: "absolute",
              color: COLORS.faint,
              opacity: 1 - resolved,
              whiteSpace: "nowrap",
            }}
          >
            Checking sources…
          </span>
          <span
            style={{
              position: "absolute",
              opacity: resolved,
              whiteSpace: "nowrap",
            }}
          >
            <span style={{ color: TONE_COLORS[row.tone], fontWeight: 600 }}>
              {verdict}
            </span>
            {rest && <span style={{ color: COLORS.muted }}> · {rest}</span>}
          </span>
        </div>
      </div>
    </div>
  );
};

// Icon paths from Feather (MIT licensed, feathericons.com).
type IconName =
  | "heart"
  | "comment"
  | "share"
  | "pause"
  | "close"
  | "moon"
  | "check"
  | "help"
  | "lock";

export const Icon: React.FC<{ name: IconName; filled?: boolean }> = ({
  name,
  filled,
}) => (
  <svg
    viewBox="0 0 24 24"
    width="100%"
    height="100%"
    fill={filled ? "currentColor" : "none"}
    stroke="currentColor"
    strokeWidth={filled ? 0 : 2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {ICON_PATHS[name]}
  </svg>
);

const ICON_PATHS: Record<IconName, ReactNode> = {
  heart: (
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
  ),
  comment: (
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  ),
  share: (
    <>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </>
  ),
  pause: (
    <>
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </>
  ),
  close: (
    <>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </>
  ),
  moon: <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />,
  check: (
    <>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </>
  ),
  lock: (
    <>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </>
  ),
};
