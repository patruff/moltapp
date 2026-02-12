import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { AnimatedText } from "../components/AnimatedText";

const FUTURE_ITEMS = [
  { text: "Open Benchmark Standard", desc: "Any AI lab can run MoltApp scoring locally" },
  { text: "Reasoning Safety Certification", desc: "Gold/Silver/Bronze ratings for AI reasoning quality" },
  { text: "Research Partnerships", desc: "NeurIPS/ICML benchmark track submissions" },
];

export const CtaScene = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const pulseGlow = interpolate(
    frame % (2 * fps),
    [0, fps, 2 * fps],
    [0.2, 0.5, 0.2]
  );

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(135deg, #0a0a1a 0%, #1a0a2e 50%, #0a1a2e 100%)",
        padding: 80,
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
          width: 800,
          height: 800,
          borderRadius: "50%",
          background: `radial-gradient(circle, rgba(99,102,241,${pulseGlow}) 0%, transparent 70%)`,
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
        }}
      />

      <AnimatedText
        text="The MMLU of Real-World Decision Making"
        fontSize={52}
        fontWeight={800}
        color="#ffffff"
        delay={0}
        style={{ textAlign: "center" }}
      />

      <AnimatedText
        text="MoltApp is building the standard benchmark for AI reasoning under uncertainty"
        fontSize={26}
        color="#a5b4fc"
        delay={0.6}
        style={{ textAlign: "center", maxWidth: 800, marginTop: 16 }}
      />

      {/* Future items */}
      <div
        style={{
          display: "flex",
          gap: 24,
          marginTop: 60,
        }}
      >
        {FUTURE_ITEMS.map((item, i) => {
          const delay = 1.2 + i * 0.5;
          const opacity = interpolate(
            frame,
            [delay * fps, (delay + 0.5) * fps],
            [0, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
          );
          const y = interpolate(
            frame,
            [delay * fps, (delay + 0.4) * fps],
            [30, 0],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
          );

          return (
            <div
              key={item.text}
              style={{
                opacity,
                transform: `translateY(${y}px)`,
                background: "rgba(99,102,241,0.08)",
                border: "1px solid rgba(99,102,241,0.25)",
                borderRadius: 14,
                padding: "24px 28px",
                width: 400,
              }}
            >
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  color: "#a5b4fc",
                  fontFamily: "system-ui, sans-serif",
                }}
              >
                {item.text}
              </div>
              <div
                style={{
                  fontSize: 16,
                  color: "#64748b",
                  fontFamily: "system-ui, sans-serif",
                  marginTop: 8,
                  lineHeight: 1.5,
                }}
              >
                {item.desc}
              </div>
            </div>
          );
        })}
      </div>

      {/* Colosseum Agent Hackathon badge */}
      <div
        style={{
          marginTop: 60,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
        }}
      >
        <AnimatedText
          text="Built for the Colosseum Agent Hackathon"
          fontSize={20}
          color="#64748b"
          delay={3.5}
          style={{ textAlign: "center" }}
        />

        {(() => {
          const logoOpacity = interpolate(
            frame,
            [4 * fps, 4.5 * fps],
            [0, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
          );
          return (
            <div
              style={{
                opacity: logoOpacity,
                fontSize: 64,
                fontWeight: 900,
                fontFamily: "system-ui, sans-serif",
                letterSpacing: -2,
              }}
            >
              <span style={{ color: "#ffffff" }}>Molt</span>
              <span style={{ color: "#6366f1" }}>App</span>
            </div>
          );
        })()}

        <AnimatedText
          text="moltapp.com"
          fontSize={24}
          color="#6366f1"
          fontWeight={600}
          delay={4.5}
          style={{ textAlign: "center" }}
        />
      </div>
    </AbsoluteFill>
  );
};
