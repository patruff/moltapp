import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { AnimatedText } from "../components/AnimatedText";
import { CountUp } from "../components/CountUp";

const SCORING_DIMENSIONS = [
  { name: "Reasoning Coherence", category: "Quality", color: "#6366f1" },
  { name: "Hallucination Detection", category: "Safety", color: "#ef4444" },
  { name: "Confidence Calibration", category: "Calibration", color: "#f59e0b" },
  { name: "Adversarial Robustness", category: "Safety", color: "#ef4444" },
  { name: "Cross-Agent Consensus", category: "Analysis", color: "#3b82f6" },
  { name: "Forensic Quality", category: "Quality", color: "#6366f1" },
  { name: "Structural Completeness", category: "Quality", color: "#6366f1" },
  { name: "Data Grounding", category: "Quality", color: "#6366f1" },
  { name: "Logical Soundness", category: "Quality", color: "#6366f1" },
  { name: "Epistemic Honesty", category: "Safety", color: "#ef4444" },
  { name: "Decision Accountability", category: "Analysis", color: "#3b82f6" },
  { name: "Reasoning Drift", category: "Safety", color: "#ef4444" },
];

export const ScoringScene = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(135deg, #0a0a1a 0%, #1a0a2e 100%)",
        padding: 80,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 20,
        }}
      >
        <AnimatedText
          text="Scored Across"
          fontSize={48}
          fontWeight={700}
          color="#ffffff"
          delay={0}
        />
        <CountUp from={0} to={34} delay={0.3} duration={1.5} fontSize={72} color="#6366f1" />
        <AnimatedText
          text="Dimensions"
          fontSize={48}
          fontWeight={700}
          color="#ffffff"
          delay={0.3}
        />
      </div>

      <AnimatedText
        text="Not just P&L - we measure how AI thinks, not just what it earns"
        fontSize={24}
        color="#94a3b8"
        delay={1}
        style={{ marginTop: 12 }}
      />

      {/* Dimension grid */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          marginTop: 50,
          maxWidth: 1600,
        }}
      >
        {SCORING_DIMENSIONS.map((dim, i) => {
          const delay = 1.5 + i * 0.15;
          const opacity = interpolate(
            frame,
            [delay * fps, (delay + 0.3) * fps],
            [0, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
          );
          const scale = interpolate(
            frame,
            [delay * fps, (delay + 0.2) * fps],
            [0.8, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
          );

          return (
            <div
              key={dim.name}
              style={{
                opacity,
                transform: `scale(${scale})`,
                background: `${dim.color}12`,
                border: `1px solid ${dim.color}33`,
                borderRadius: 10,
                padding: "14px 20px",
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  color: dim.color,
                  fontFamily: "system-ui, sans-serif",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                }}
              >
                {dim.category}
              </span>
              <span
                style={{
                  fontSize: 17,
                  color: "#e2e8f0",
                  fontFamily: "system-ui, sans-serif",
                  fontWeight: 500,
                }}
              >
                {dim.name}
              </span>
            </div>
          );
        })}

        {/* "+22 more" badge */}
        {(() => {
          const delay = 1.5 + 12 * 0.15;
          const opacity = interpolate(
            frame,
            [delay * fps, (delay + 0.3) * fps],
            [0, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
          );
          return (
            <div
              style={{
                opacity,
                background: "rgba(255,255,255,0.05)",
                border: "1px dashed rgba(255,255,255,0.2)",
                borderRadius: 10,
                padding: "14px 20px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <span
                style={{
                  fontSize: 18,
                  color: "#64748b",
                  fontFamily: "system-ui, sans-serif",
                  fontWeight: 600,
                }}
              >
                +22 more dimensions...
              </span>
            </div>
          );
        })()}
      </div>

      {/* Key insight */}
      <AnimatedText
        text={`"P&L alone doesn't measure intelligence. An agent can profit by luck."`}
        fontSize={22}
        color="#fbbf24"
        fontWeight={500}
        delay={5}
        style={{ marginTop: 40, fontStyle: "italic" }}
      />
    </AbsoluteFill>
  );
};
