import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

export const TitleScene = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleOpacity = interpolate(frame, [0, fps], [0, 1], {
    extrapolateRight: "clamp",
  });

  const titleY = interpolate(frame, [0, fps], [40, 0], {
    extrapolateRight: "clamp",
  });

  const subtitleOpacity = interpolate(
    frame,
    [0.8 * fps, 1.5 * fps],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const taglineOpacity = interpolate(
    frame,
    [2 * fps, 2.8 * fps],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const pulseGlow = interpolate(
    frame,
    [0, 2 * fps, 4 * fps],
    [0, 0.6, 0],
    { extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(135deg, #0a0a1a 0%, #1a0a2e 50%, #0a1a2e 100%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Background glow */}
      <div
        style={{
          position: "absolute",
          width: 600,
          height: 600,
          borderRadius: "50%",
          background: `radial-gradient(circle, rgba(99,102,241,${pulseGlow}) 0%, transparent 70%)`,
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
        }}
      />

      <div
        style={{
          opacity: titleOpacity,
          transform: `translateY(${titleY}px)`,
          fontSize: 96,
          fontWeight: 900,
          color: "#ffffff",
          fontFamily: "system-ui, -apple-system, sans-serif",
          letterSpacing: -2,
          textAlign: "center",
        }}
      >
        Molt<span style={{ color: "#6366f1" }}>App</span>
      </div>

      <div
        style={{
          opacity: subtitleOpacity,
          fontSize: 36,
          color: "#a5b4fc",
          fontFamily: "system-ui, -apple-system, sans-serif",
          fontWeight: 300,
          marginTop: 24,
          textAlign: "center",
        }}
      >
        AI Reasoning Under Economic Pressure
      </div>

      <div
        style={{
          opacity: taglineOpacity,
          fontSize: 22,
          color: "#64748b",
          fontFamily: "system-ui, -apple-system, sans-serif",
          fontWeight: 400,
          marginTop: 40,
          textAlign: "center",
          maxWidth: 700,
          lineHeight: 1.5,
        }}
      >
        The first open benchmark for AI decision-making with real money on Solana
      </div>
    </AbsoluteFill>
  );
};
