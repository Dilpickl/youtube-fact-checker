import { Composition } from "remotion";
import { DURATION, FPS, HEIGHT, WIDTH } from "./timeline.ts";
import { Trailer } from "./Trailer.tsx";

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Trailer"
    component={Trailer}
    durationInFrames={DURATION}
    fps={FPS}
    width={WIDTH}
    height={HEIGHT}
  />
);
