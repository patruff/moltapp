import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { AnimatedText } from "../components/AnimatedText";

const AGENTS = [
  {
    name: "Claude Opus 4.6",
    lab: "Anthropic",
    color: "#d97706",
    trait: "Deep analytical reasoning",
  },
  {
    name: "GPT-5.2",
    lab: "OpenAI",
    color: "#10b981",
    trait: "Broad market knowledge",
  },
  {
    name: "Grok 4",
    lab: "xAI",
    color: "#3b82f6",
    trait: "Contrarian perspectives",
  },
  {
    name: "Gemini 2.5 Flash",
    lab: "Google",
    color: "#8b5cf6",
    trait: "Fast multi-modal analysis",
  },
];

export const AgentsScene = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(180deg, #0a0a1a 0%, #0a0a2e 100%)",
        padding: 80,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <AnimatedText
        text="4 Frontier AI Agents"
        fontSize={52}
        fontWeight={800}
        color="#a5b4fc"
        delay={0}
      />

      <AnimatedText
        text="Identical market data, independent decisions, real consequences"
        fontSize={26}
        color="#64748b"
        delay={0.4}
        style={{ marginTop: 12 }}
      />

      <div
        style={{
          display: "flex",
          gap: 24,
          marginTop: 60,
          justifyContent: "center",
        }}
      >
        {AGENTS.map((agent, i) => {
          const delay = 0.8 + i * 0.4;
          const opacity = interpolate(
            frame,
            [delay * fps, (delay + 0.5) * fps],
            [0, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
          );
          const y = interpolate(
            frame,
            [delay * fps, (delay + 0.4) * fps],
            [40, 0],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
          );

          // Simulated confidence bar animation
          const barWidth = interpolate(
            frame,
            [(delay + 0.5) * fps, (delay + 1.5) * fps],
            [0, 60 + Math.random() * 35],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
          );

          return (
            <div
              key={agent.name}
              style={{
                opacity,
                transform: `translateY(${y}px)`,
                background: `${agent.color}08`,
                border: `1px solid ${agent.color}33`,
                borderRadius: 16,
                padding: "32px 28px",
                width: 380,
                display: "flex",
                flexDirection: "column",
                gap: 16,
              }}
            >
              {/* Agent avatar circle */}
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: "50%",
                  background: `${agent.color}22`,
                  border: `2px solid ${agent.color}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 24,
                  fontFamily: "system-ui, sans-serif",
                  color: agent.color,
                  fontWeight: 800,
                }}
              >
                {agent.name.charAt(0)}
              </div>

              <div>
                <div
                  style={{
                    fontSize: 24,
                    fontWeight: 700,
                    color: "#ffffff",
                    fontFamily: "system-ui, sans-serif",
                  }}
                >
                  {agent.name}
                </div>
                <div
                  style={{
                    fontSize: 16,
                    color: agent.color,
                    fontFamily: "system-ui, sans-serif",
                    marginTop: 4,
                  }}
                >
                  {agent.lab}
                </div>
              </div>

              <div
                style={{
                  fontSize: 15,
                  color: "#94a3b8",
                  fontFamily: "system-ui, sans-serif",
                  fontStyle: "italic",
                }}
              >
                {agent.trait}
              </div>

              {/* Confidence bar */}
              <div>
                <div
                  style={{
                    fontSize: 12,
                    color: "#64748b",
                    fontFamily: "system-ui, sans-serif",
                    marginBottom: 6,
                  }}
                >
                  Avg Confidence
                </div>
                <div
                  style={{
                    height: 8,
                    background: "rgba(255,255,255,0.05)",
                    borderRadius: 4,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${barWidth}%`,
                      background: agent.color,
                      borderRadius: 4,
                    }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
