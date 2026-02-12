import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { AnimatedText } from "../components/AnimatedText";
import { CountUp } from "../components/CountUp";
import { GlowBox } from "../components/GlowBox";

const STATS = [
  { label: "Lines of Scoring Infrastructure", value: 178000, suffix: "K+", displayValue: 178, color: "#6366f1" },
  { label: "TypeScript Files", value: 398, suffix: "", displayValue: 398, color: "#3b82f6" },
  { label: "Scoring Dimensions", value: 34, suffix: "", displayValue: 34, color: "#10b981" },
  { label: "AI-Authored", value: 100, suffix: "%", displayValue: 100, color: "#f59e0b" },
];

export const DataScene = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(180deg, #0a0a1a 0%, #0a1a0a 100%)",
        padding: 80,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <AnimatedText
        text="Open Data, Open Science"
        fontSize={52}
        fontWeight={800}
        color="#10b981"
        delay={0}
      />

      <AnimatedText
        text="Public benchmark dataset on HuggingFace for the research community"
        fontSize={26}
        color="#94a3b8"
        delay={0.4}
        style={{ marginTop: 12 }}
      />

      {/* Stats grid */}
      <div
        style={{
          display: "flex",
          gap: 28,
          marginTop: 60,
          justifyContent: "center",
        }}
      >
        {STATS.map((stat, i) => (
          <GlowBox
            key={stat.label}
            delay={0.8 + i * 0.4}
            glowColor={stat.color}
            style={{
              width: 360,
              textAlign: "center",
              padding: "36px 24px",
            }}
          >
            <CountUp
              from={0}
              to={stat.displayValue}
              delay={0.8 + i * 0.4}
              duration={1.5}
              suffix={stat.suffix}
              fontSize={56}
              color={stat.color}
            />
            <div
              style={{
                fontSize: 18,
                color: "#94a3b8",
                fontFamily: "system-ui, sans-serif",
                marginTop: 12,
              }}
            >
              {stat.label}
            </div>
          </GlowBox>
        ))}
      </div>

      {/* HuggingFace badge */}
      <GlowBox delay={3} glowColor="#fbbf24" style={{ alignSelf: "center", marginTop: 50 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            fontSize: 26,
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <span style={{ fontSize: 36 }}>{"\uD83E\uDD17"}</span>
          <span style={{ color: "#fbbf24", fontWeight: 700 }}>
            HuggingFace Dataset
          </span>
          <span style={{ color: "#64748b" }}>
            patruff/moltapp-benchmark
          </span>
        </div>
      </GlowBox>

      {/* Tech stack */}
      <div
        style={{
          display: "flex",
          gap: 16,
          marginTop: 40,
          justifyContent: "center",
        }}
      >
        {["Hono", "Drizzle ORM", "Neon PostgreSQL", "@solana/kit v5", "Jupiter Ultra", "AWS Lambda"].map(
          (tech, i) => {
            const delay = 4 + i * 0.15;
            const opacity = interpolate(
              frame,
              [delay * fps, (delay + 0.3) * fps],
              [0, 1],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
            );
            return (
              <div
                key={tech}
                style={{
                  opacity,
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 8,
                  padding: "8px 16px",
                  fontSize: 14,
                  color: "#64748b",
                  fontFamily: "monospace",
                }}
              >
                {tech}
              </div>
            );
          }
        )}
      </div>
    </AbsoluteFill>
  );
};
