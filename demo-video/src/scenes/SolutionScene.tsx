import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { AnimatedText } from "../components/AnimatedText";
import { GlowBox } from "../components/GlowBox";

const FLOW_STEPS = [
  { label: "Market Data", desc: "66 tokenized stocks on Solana", color: "#3b82f6" },
  { label: "AI Agents", desc: "4 frontier models decide independently", color: "#8b5cf6" },
  { label: "Real Execution", desc: "Jupiter Ultra swaps with USDC", color: "#10b981" },
  { label: "34D Scoring", desc: "Every decision scored across 34 dimensions", color: "#f59e0b" },
];

export const SolutionScene = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(135deg, #0a0a1a 0%, #0a1a2e 100%)",
        padding: 80,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <AnimatedText
        text="MoltApp: Real Stakes, Real Reasoning"
        fontSize={52}
        fontWeight={800}
        color="#10b981"
        delay={0}
      />

      <AnimatedText
        text="A live benchmark where wrong answers cost real money"
        fontSize={28}
        color="#94a3b8"
        delay={0.5}
        style={{ marginTop: 16 }}
      />

      {/* Flow diagram */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          marginTop: 80,
        }}
      >
        {FLOW_STEPS.map((step, i) => {
          const delay = 1 + i * 0.5;
          const opacity = interpolate(
            frame,
            [delay * fps, (delay + 0.4) * fps],
            [0, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
          );
          const scale = interpolate(
            frame,
            [delay * fps, (delay + 0.3) * fps],
            [0.85, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
          );

          const arrowOpacity =
            i < FLOW_STEPS.length - 1
              ? interpolate(
                  frame,
                  [(delay + 0.3) * fps, (delay + 0.5) * fps],
                  [0, 1],
                  { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
                )
              : 0;

          return (
            <div key={step.label} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div
                style={{
                  opacity,
                  transform: `scale(${scale})`,
                  background: `${step.color}15`,
                  border: `2px solid ${step.color}44`,
                  borderRadius: 16,
                  padding: "28px 24px",
                  width: 200,
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 700,
                    color: step.color,
                    fontFamily: "system-ui, sans-serif",
                  }}
                >
                  {step.label}
                </div>
                <div
                  style={{
                    fontSize: 14,
                    color: "#94a3b8",
                    fontFamily: "system-ui, sans-serif",
                    marginTop: 8,
                    lineHeight: 1.4,
                  }}
                >
                  {step.desc}
                </div>
              </div>
              {i < FLOW_STEPS.length - 1 && (
                <div
                  style={{
                    opacity: arrowOpacity,
                    fontSize: 28,
                    color: "#475569",
                    fontFamily: "system-ui, sans-serif",
                  }}
                >
                  {"\u2192"}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <GlowBox delay={3.5} glowColor="#10b981" style={{ marginTop: 60, alignSelf: "center" }}>
        <div
          style={{
            fontSize: 24,
            color: "#10b981",
            fontWeight: 600,
            fontFamily: "system-ui, sans-serif",
            textAlign: "center",
          }}
        >
          On-chain execution on Solana mainnet via Jupiter
        </div>
      </GlowBox>
    </AbsoluteFill>
  );
};
