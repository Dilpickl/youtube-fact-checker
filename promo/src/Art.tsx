// Stand-in footage for the demo videos, drawn with shapes so the trailer uses
// no real people or real TikTok content. `videoFrame` stops while paused.
import { AbsoluteFill } from "remotion";

// Deterministic "random" numbers so every render is identical.
const noise = (seed: number): number => {
  const x = Math.sin(seed * 127.1) * 43758.5453;
  return x - Math.floor(x);
};

/** A backlit person talking to the camera in warm light. */
export const TalkingHeadArt: React.FC<{ videoFrame: number }> = ({
  videoFrame,
}) => {
  const nod = Math.sin(videoFrame / 5) * 2.5 + Math.sin(videoFrame / 13) * 1.5;
  const tilt = Math.sin(videoFrame / 17) * 1.2;
  return (
    <AbsoluteFill
      style={{
        background:
          "linear-gradient(165deg, #F7C58F 0%, #E08A7E 42%, #6A3460 100%)",
      }}
    >
      {Array.from({ length: 9 }, (_, i) => {
        const size = 60 + noise(i + 1) * 120;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left:
                noise(i + 11) * 461 -
                size / 2 +
                Math.sin(videoFrame / 40 + i) * 10,
              top: noise(i + 21) * 420 - size / 2,
              width: size,
              height: size,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(255,240,220,0.45), rgba(255,240,220,0) 70%)",
            }}
          />
        );
      })}
      <svg
        viewBox="0 0 461 820"
        width={461}
        height={820}
        style={{ position: "absolute", inset: 0, filter: "blur(1.2px)" }}
      >
        <defs>
          <linearGradient id="figure" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#4A2340" />
            <stop offset="1" stopColor="#24102A" />
          </linearGradient>
          <radialGradient id="rim" cx="0.5" cy="0.72" r="0.62">
            <stop offset="0.75" stopColor="rgba(255,214,170,0)" />
            <stop offset="1" stopColor="rgba(255,214,170,0.55)" />
          </radialGradient>
        </defs>
        <path
          d="M 30 820 C 40 640, 130 585, 230 585 C 330 585, 421 640, 431 820 Z"
          fill="url(#figure)"
        />
        <g transform={`translate(0 ${nod}) rotate(${tilt} 230 470)`}>
          <rect
            x="196"
            y="470"
            width="68"
            height="130"
            rx="28"
            fill="#33182F"
          />
          <ellipse cx="230" cy="395" rx="92" ry="110" fill="url(#figure)" />
          <ellipse cx="230" cy="395" rx="92" ry="110" fill="url(#rim)" />
        </g>
      </svg>
    </AbsoluteFill>
  );
};

/** A stormy city street "flooding": the kind of clip AI tools now make. */
export const FloodArt: React.FC<{ videoFrame: number }> = ({ videoFrame }) => {
  const wave = (offset: number, height: number, speed: number) => {
    const points = Array.from({ length: 24 }, (_, i) => {
      const x = (i / 23) * 461;
      const y = height + Math.sin(i * 0.9 + videoFrame / speed + offset) * 10;
      return `L ${x.toFixed(1)} ${y.toFixed(1)}`;
    });
    return `M 0 820 ${points.join(" ")} L 461 820 Z`;
  };
  return (
    <AbsoluteFill
      style={{
        background:
          "linear-gradient(180deg, #34496A 0%, #1C2B42 55%, #0E1A2A 100%)",
      }}
    >
      <svg
        viewBox="0 0 461 820"
        width={461}
        height={820}
        style={{ position: "absolute", inset: 0 }}
      >
        {[
          [0, 300, 90],
          [80, 230, 70],
          [140, 340, 100],
          [230, 260, 80],
          [300, 190, 95],
          [385, 290, 76],
        ].map(([x, top, width], i) => (
          <g key={i}>
            <rect
              x={x}
              y={top}
              width={width}
              height={820 - top}
              fill={i % 2 ? "#142033" : "#18263B"}
            />
            {Array.from({ length: 14 }, (_, w) => (
              <rect
                key={w}
                x={x + 10 + (w % 3) * (width / 3.4)}
                y={top + 18 + Math.floor(w / 3) * 34}
                width={10}
                height={14}
                fill="#F5D88A"
                opacity={noise(i * 31 + w) > 0.55 ? 0.55 : 0.08}
              />
            ))}
          </g>
        ))}
        <path d={wave(0, 600, 9)} fill="rgba(74, 122, 168, 0.55)" />
        <path d={wave(2, 625, 7)} fill="rgba(48, 92, 140, 0.75)" />
        {Array.from({ length: 46 }, (_, i) => {
          const x = noise(i + 3) * 461;
          const y = ((noise(i + 7) * 820 + videoFrame * 30) % 900) - 80;
          return (
            <line
              key={i}
              x1={x}
              y1={y}
              x2={x - 6}
              y2={y + 34}
              stroke="rgba(200,220,255,0.35)"
              strokeWidth={1.5}
            />
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};
