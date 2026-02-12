import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";

type CountUpProps = {
  from: number;
  to: number;
  delay?: number;
  duration?: number;
  suffix?: string;
  prefix?: string;
  fontSize?: number;
  color?: string;
  decimals?: number;
};

export const CountUp: React.FC<CountUpProps> = ({
  from,
  to,
  delay = 0,
  duration = 1.5,
  suffix = "",
  prefix = "",
  fontSize = 72,
  color = "#00ff88",
  decimals = 0,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const value = interpolate(
    frame,
    [delay * fps, (delay + duration) * fps],
    [from, to],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const opacity = interpolate(
    frame,
    [delay * fps, delay * fps + 0.3 * fps],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <span
      style={{
        fontSize,
        fontWeight: 800,
        color,
        fontFamily: "system-ui, -apple-system, sans-serif",
        opacity,
      }}
    >
      {prefix}
      {value.toFixed(decimals)}
      {suffix}
    </span>
  );
};
