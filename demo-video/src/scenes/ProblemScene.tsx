import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { AnimatedText } from "../components/AnimatedText";

const STATIC_BENCHMARKS = [
  { name: "MMLU", desc: "Multiple choice trivia", icon: "?" },
  { name: "HumanEval", desc: "Code puzzles", icon: "</>" },
  { name: "ARC", desc: "Pattern matching", icon: "~" },
  { name: "GPQA", desc: "Graduate Q&A", icon: "A" },
];

export const ProblemScene = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const headerOpacity = interpolate(frame, [0, 0.5 * fps], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(180deg, #0a0a1a 0%, #1a0a0a 100%)",
        padding: 80,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ opacity: headerOpacity }}>
        <AnimatedText
          text="The Problem"
          fontSize={56}
          fontWeight={800}
          color="#ef4444"
          delay={0}
        />
      </div>

      <AnimatedText
        text="Today's AI benchmarks test static puzzles with zero stakes"
        fontSize={32}
        color="#94a3b8"
        delay={0.5}
        style={{ marginTop: 20, maxWidth: 800 }}
      />

      <div
        style={{
          display: "flex",
          gap: 30,
          marginTop: 60,
          flexWrap: "wrap",
        }}
      >
        {STATIC_BENCHMARKS.map((b, i) => {
          const delay = 1 + i * 0.3;
          const opacity = interpolate(
            frame,
            [delay * fps, (delay + 0.4) * fps],
            [0, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
          );
          const x = interpolate(
            frame,
            [delay * fps, (delay + 0.4) * fps],
            [-30, 0],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
          );

          return (
            <div
              key={b.name}
              style={{
                opacity,
                transform: `translateX(${x}px)`,
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.2)",
                borderRadius: 12,
                padding: "20px 28px",
                width: 380,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span
                  style={{
                    fontSize: 28,
                    fontFamily: "monospace",
                    color: "#ef4444",
                    fontWeight: 700,
                  }}
                >
                  {b.icon}
                </span>
                <span
                  style={{
                    fontSize: 28,
                    fontWeight: 700,
                    color: "#ffffff",
                    fontFamily: "system-ui, sans-serif",
                  }}
                >
                  {b.name}
                </span>
              </div>
              <div
                style={{
                  fontSize: 18,
                  color: "#94a3b8",
                  fontFamily: "system-ui, sans-serif",
                  marginTop: 8,
                }}
              >
                {b.desc}
              </div>
            </div>
          );
        })}
      </div>

      {/* Strike-through line */}
      {(() => {
        const strikeProgress = interpolate(
          frame,
          [3 * fps, 3.5 * fps],
          [0, 100],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
        );
        return (
          <div
            style={{
              position: "absolute",
              top: 420,
              left: 80,
              width: `${strikeProgress}%`,
              maxWidth: 830,
              height: 3,
              background: "#ef4444",
              opacity: 0.7,
            }}
          />
        );
      })()}

      <AnimatedText
        text="None of this tells us how AI reasons under real economic pressure"
        fontSize={28}
        fontWeight={600}
        color="#fbbf24"
        delay={4}
        style={{ marginTop: 80 }}
      />
    </AbsoluteFill>
  );
};
