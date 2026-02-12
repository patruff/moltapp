import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";

type GlowBoxProps = {
  children: React.ReactNode;
  delay?: number;
  glowColor?: string;
  style?: React.CSSProperties;
};

export const GlowBox: React.FC<GlowBoxProps> = ({
  children,
  delay = 0,
  glowColor = "#6366f1",
  style = {},
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const opacity = interpolate(
    frame,
    [delay * fps, delay * fps + 0.5 * fps],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const scale = interpolate(
    frame,
    [delay * fps, delay * fps + 0.4 * fps],
    [0.9, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <div
      style={{
        opacity,
        transform: `scale(${scale})`,
        background: "rgba(255,255,255,0.05)",
        borderRadius: 16,
        border: `1px solid ${glowColor}44`,
        boxShadow: `0 0 40px ${glowColor}22`,
        padding: "24px 32px",
        ...style,
      }}
    >
      {children}
    </div>
  );
};
