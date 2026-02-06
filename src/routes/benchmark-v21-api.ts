/**
 * Benchmark v21 API Routes
 *
 * Researcher-facing API for the 26-pillar benchmark. Provides structured
 * access to reasoning chain validation and strategy profiling data,
 * plus all v20 endpoints.
 *
 * Routes:
 *   GET /scores              — All agent scores with 26-pillar breakdown
 *   GET /score/:agentId      — Single agent score
 *   GET /chains              — All chain validation profiles
 *   GET /chains/:agentId     — Agent chain validation history
 *   GET /strategy            — All strategy profiles
 *   GET /strategy/:agentId   — Agent strategy profile details
 *   GET /health              — Benchmark health snapshot
 *   GET /weights             — Pillar weights configuration
 *   GET /schema              — Data schema for researchers
 *   GET /export/jsonl        — JSONL export of all v21 data
 *   GET /export/csv          — CSV export of leaderboard
 */

import { Hono } from "hono";
import { round2 } from "../lib/math-utils.ts";
import {
  getV17Rankings,
  getV17Health,
} from "../services/benchmark-intelligence-gateway.ts";
import {
  getArbitrationPillarScore,
} from "../services/benchmark-arbitration-engine.ts";
import {
  getDebatePillarScore,
} from "../services/cross-agent-debate-engine.ts";
import {
  getImpactPillarScore,
} from "../services/trade-impact-forecaster.ts";
import {
  getAdversarialPillarScore,
} from "../services/adversarial-robustness-engine.ts";
import {
  getMemoryPillarScore,
} from "../services/cross-session-memory-analyzer.ts";
import {
  getTransparencyPillarScore,
} from "../services/reasoning-transparency-engine.ts";
import {
  getAccountabilityPillarScore,
} from "../services/decision-accountability-tracker.ts";
import {
  getCertificationPillarScore,
} from "../services/reasoning-quality-certifier.ts";
import {
  getAllChainProfiles,
  getChainValidationPillarScore,
  getChainStats,
} from "../services/reasoning-chain-validator.ts";
import {
  getAllStrategyProfiles,
  getStrategyPillarScore,
  getStrategyStats,
  type StrategyProfile,
} from "../services/agent-strategy-profiler.ts";

export const benchmarkV21ApiRoutes = new Hono();

// ---------------------------------------------------------------------------
// v21 Weights — 26 pillars
// ---------------------------------------------------------------------------

const V21_WEIGHTS: Record<string, number> = {
  financial: 0.07, reasoning: 0.06, safety: 0.05, calibration: 0.05, patterns: 0.03,
  adaptability: 0.03, forensic_quality: 0.04, validation_quality: 0.04,
  prediction_accuracy: 0.04, reasoning_stability: 0.03, provenance_integrity: 0.04,
  model_comparison: 0.03, metacognition: 0.04, reasoning_efficiency: 0.03,
  forensic_ledger: 0.03, strategy_genome: 0.03, adversarial_robustness: 0.04,
  cross_session_memory: 0.03, arbitration_quality: 0.04, debate_performance: 0.04,
  impact_forecasting: 0.03, reasoning_transparency: 0.04, decision_accountability: 0.04,
  quality_certification: 0.04, reasoning_chain_integrity: 0.05, strategy_profiling: 0.05,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeGrade(score: number): string {
  if (score >= 0.95) return "A+";
  if (score >= 0.90) return "A";
  if (score >= 0.85) return "A-";
  if (score >= 0.80) return "B+";
  if (score >= 0.75) return "B";
  if (score >= 0.70) return "B-";
  if (score >= 0.65) return "C+";
  if (score >= 0.60) return "C";
  if (score >= 0.55) return "C-";
  if (score >= 0.50) return "D+";
  if (score >= 0.45) return "D";
  if (score >= 0.40) return "D-";
  return "F";
}

interface V21Score {
  agentId: string;
  composite: number;
  grade: string;
  rank: number;
  pillars: Record<string, number>;
}

/**
 * Compute the full 26-pillar v21 score for a single agent.
 * Pulls the first 24 pillars from the v17 base profile where available,
 * then overlays live pillar scores from individual engines.
 */
function computeV21Score(
  agentId: string,
  profile: { composite?: number; pillars?: { name: string; score: number }[] } | undefined,
): { score: number; pillars: Record<string, number> } {
  const pillars: Record<string, number> = {};

  // Seed from base profile if available
  if (profile?.pillars) {
    for (const p of profile.pillars) {
      pillars[p.name] = p.score;
    }
  }

  // Default any missing base pillars to 0.5
  for (const key of Object.keys(V21_WEIGHTS)) {
    if (!(key in pillars)) pillars[key] = 0.5;
  }

  // Override with live pillar engine scores (v19-v20 engines)
  pillars.arbitration_quality = getArbitrationPillarScore(agentId);
  pillars.debate_performance = getDebatePillarScore(agentId);
  pillars.impact_forecasting = getImpactPillarScore(agentId);
  pillars.adversarial_robustness = getAdversarialPillarScore(agentId);
  pillars.cross_session_memory = getMemoryPillarScore(agentId);
  pillars.reasoning_transparency = getTransparencyPillarScore(agentId);
  pillars.decision_accountability = getAccountabilityPillarScore(agentId);
  pillars.quality_certification = getCertificationPillarScore(agentId);

  // v21 new pillars
  pillars.reasoning_chain_integrity = getChainValidationPillarScore(agentId);
  pillars.strategy_profiling = getStrategyPillarScore(agentId);

  // Weighted composite
  let score = 0;
  for (const [pillar, weight] of Object.entries(V21_WEIGHTS)) {
    score += (pillars[pillar] ?? 0.5) * weight;
  }

  return { score: round2(score), pillars };
}

/**
 * Compute v21 scores for all known agents, sorted by composite descending.
 */
function computeAllScores(): V21Score[] {
  const rankings = getV17Rankings();
  const agentIds = rankings.length > 0
    ? rankings.map((r) => r.agentId)
    : ["claude-value-investor", "gpt-momentum-trader", "grok-contrarian"];

  const scores: V21Score[] = agentIds.map((agentId) => {
    const base = rankings.find((r) => r.agentId === agentId);
    const { score, pillars } = computeV21Score(agentId, base);

    return {
      agentId,
      composite: score,
      grade: computeGrade(score),
      rank: 0,
      pillars,
    };
  });

  scores.sort((a, b) => b.composite - a.composite);
  scores.forEach((s, i) => { s.rank = i + 1; });

  return scores;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

benchmarkV21ApiRoutes.get("/scores", (c) => {
  const scores = computeAllScores();
  return c.json({
    ok: true,
    benchmark: "moltapp-v21",
    pillars: 26,
    leaderboard: scores,
    weights: V21_WEIGHTS,
    generatedAt: new Date().toISOString(),
  });
});

benchmarkV21ApiRoutes.get("/score/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const scores = computeAllScores();
  const score = scores.find((s) => s.agentId === agentId);
  if (!score) {
    return c.json({ ok: false, error: "Agent not found" }, 404);
  }
  return c.json({ ok: true, score });
});

benchmarkV21ApiRoutes.get("/chains", (c) => {
  const profiles = getAllChainProfiles();
  const stats = getChainStats();
  return c.json({ ok: true, profiles, stats });
});

benchmarkV21ApiRoutes.get("/chains/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const profiles = getAllChainProfiles();
  const profile = profiles[agentId] ?? null;
  const pillarScore = getChainValidationPillarScore(agentId);
  if (!profile) {
    return c.json({ ok: false, error: "No chain data for agent", agentId }, 404);
  }
  return c.json({ ok: true, agentId, pillarScore, profile });
});

benchmarkV21ApiRoutes.get("/strategy", (c) => {
  const profiles = getAllStrategyProfiles();
  const stats = getStrategyStats();
  return c.json({ ok: true, profiles, stats });
});

benchmarkV21ApiRoutes.get("/strategy/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const profiles = getAllStrategyProfiles();
  const profile: StrategyProfile | undefined = profiles[agentId];
  const pillarScore = getStrategyPillarScore(agentId);
  if (!profile) {
    return c.json({ ok: false, error: "No strategy data for agent", agentId }, 404);
  }
  return c.json({ ok: true, agentId, pillarScore, profile });
});

benchmarkV21ApiRoutes.get("/health", (c) => {
  const health = getV17Health();
  const chainStats = getChainStats();
  const strategyStats = getStrategyStats();
  return c.json({
    ok: true,
    benchmark: "moltapp-v21",
    pillars: 26,
    health,
    v21Health: {
      chainsValidated: chainStats.totalValidations,
      avgChainIntegrity: chainStats.avgQuality,
      strategiesProfiled: strategyStats.totalAgents,
      avgStrategyScore: strategyStats.avgOverallScore,
    },
    timestamp: new Date().toISOString(),
  });
});

benchmarkV21ApiRoutes.get("/weights", (c) => {
  return c.json({
    ok: true,
    benchmark: "moltapp-v21",
    totalPillars: 26,
    weights: V21_WEIGHTS,
    newInV21: ["reasoning_chain_integrity", "strategy_profiling"],
  });
});

benchmarkV21ApiRoutes.get("/schema", (c) => {
  return c.json({
    ok: true,
    benchmark: "moltapp-v21",
    dataSchema: {
      chainValidation: {
        chainId: "string — unique chain identifier",
        agentId: "string — agent that produced the chain",
        steps: "ChainStep[] — ordered reasoning steps with type, content, valid flag",
        totalSteps: "number — count of steps in chain",
        validSteps: "number — count of logically valid steps",
        integrityScore: "number (0-1) — ratio of valid steps to total",
        gapCount: "number — logical gaps detected",
        circularCount: "number — circular references detected",
        contradictionCount: "number — internal contradictions detected",
        groundedRatio: "number (0-1) — fraction of claims grounded in evidence",
        timestamp: "string — ISO 8601",
      },
      strategyProfile: {
        agentId: "string — agent identifier",
        dominantStrategy: "string — most frequently used strategy archetype",
        strategyDistribution: "Record<string, number> — fraction of trades per strategy",
        adaptabilityScore: "number (0-1) — how well agent adapts strategy to conditions",
        consistencyScore: "number (0-1) — how consistent strategy application is",
        explorationRate: "number (0-1) — fraction of non-dominant strategy trades",
        winRateByStrategy: "Record<string, number> — success rate per strategy",
        compositeScore: "number (0-1) — weighted blend of strategy metrics",
        tradeCount: "number — total trades analyzed",
      },
      pillarWeights: {
        description: "26 pillars, weights sum to 1.00",
        pillars: Object.keys(V21_WEIGHTS),
        ranges: "All pillar scores normalized to 0-1",
        composite: "Weighted sum of all pillar scores (0-1)",
        grade: "A+ to F letter grade from composite",
      },
    },
  });
});

benchmarkV21ApiRoutes.get("/export/jsonl", (c) => {
  const scores = computeAllScores();
  const chainProfiles = getAllChainProfiles();
  const strategyProfiles = getAllStrategyProfiles();

  const records = scores.map((s) => ({
    ...s,
    chainValidation: chainProfiles[s.agentId] ?? null,
    strategyProfile: strategyProfiles[s.agentId] ?? null,
  }));

  const lines = records.map((r) => JSON.stringify(r));
  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "application/jsonl",
      "Content-Disposition": "attachment; filename=benchmark-v21-full.jsonl",
    },
  });
});

benchmarkV21ApiRoutes.get("/export/csv", (c) => {
  const scores = computeAllScores();
  const pillarKeys = Object.keys(V21_WEIGHTS);
  const header = [
    "rank",
    "agent_id",
    "provider",
    "v21_score",
    "chain_integrity",
    "strategy_profile",
    ...pillarKeys,
  ].join(",");

  const rankings = getV17Rankings();

  const rows = scores.map((s) => {
    const base = rankings.find((r) => r.agentId === s.agentId);
    const provider = base?.provider ?? "unknown";
    const pillarValues = pillarKeys.map((k) => (s.pillars[k] ?? 0.5).toFixed(3));
    return [
      s.rank,
      s.agentId,
      provider,
      s.composite.toFixed(3),
      (s.pillars.reasoning_chain_integrity ?? 0.5).toFixed(3),
      (s.pillars.strategy_profiling ?? 0.5).toFixed(3),
      ...pillarValues,
    ].join(",");
  });

  return new Response([header, ...rows].join("\n"), {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": "attachment; filename=benchmark-v21-leaderboard.csv",
    },
  });
});
