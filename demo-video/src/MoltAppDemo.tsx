import { AbsoluteFill } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { TitleScene } from "./scenes/TitleScene";
import { ProblemScene } from "./scenes/ProblemScene";
import { SolutionScene } from "./scenes/SolutionScene";
import { AgentsScene } from "./scenes/AgentsScene";
import { ScoringScene } from "./scenes/ScoringScene";
import { DataScene } from "./scenes/DataScene";
import { CtaScene } from "./scenes/CtaScene";

export const MoltAppDemo = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#0a0a0f" }}>
      <TransitionSeries>
        {/* Scene 1: Title (0-6s = 180 frames) */}
        <TransitionSeries.Sequence durationInFrames={180}>
          <TitleScene />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: 20 })}
        />

        {/* Scene 2: The Problem (6-14s = 240 frames) */}
        <TransitionSeries.Sequence durationInFrames={270}>
          <ProblemScene />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={slide({ direction: "from-right" })}
          timing={linearTiming({ durationInFrames: 15 })}
        />

        {/* Scene 3: The Solution (14-22s = 240 frames) */}
        <TransitionSeries.Sequence durationInFrames={240}>
          <SolutionScene />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: 15 })}
        />

        {/* Scene 4: The Agents (22-30s = 240 frames) */}
        <TransitionSeries.Sequence durationInFrames={270}>
          <AgentsScene />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={slide({ direction: "from-bottom" })}
          timing={linearTiming({ durationInFrames: 15 })}
        />

        {/* Scene 5: Scoring (30-40s = 300 frames) */}
        <TransitionSeries.Sequence durationInFrames={300}>
          <ScoringScene />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: 15 })}
        />

        {/* Scene 6: Data/Dataset (40-48s = 240 frames) */}
        <TransitionSeries.Sequence durationInFrames={240}>
          <DataScene />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: 20 })}
        />

        {/* Scene 7: CTA (48-60s = 360 frames) */}
        <TransitionSeries.Sequence durationInFrames={360}>
          <CtaScene />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  );
};
