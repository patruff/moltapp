/**
 * Benchmark v19 API Routes
 *
 * Researcher-facing API for the 21-pillar benchmark scoring system.
 * New in v19: Benchmark Arbitration Engine, Cross-Agent Debate Engine,
 * Trade Impact Forecaster.
 *
 * Routes:
 *   GET /scores              — All agent scores (21-pillar composite)
 *   GET /score/:agentId      — Single agent detailed scorecard
 *   GET /arbitration         — All arbitration cases (recent)
 *   GET /arbitration/:agentId — Single agent arbitration profile
 *   GET /arbitration/case/:caseId — Specific arbitration case
 *   GET /arbitration/disagreements — Disagreement cases only
 *   GET /debates             — All debate rounds (recent)
 *   GET /debates/:agentId    — Single agent debate profile
 *   GET /debates/detail/:debateId — Specific debate detail
 *   GET /impact              — All trade impact profiles
 *   GET /impact/:agentId     — Single agent impact forecast profile
 *   GET /impact/forecasts    — Recent forecasts
 *   GET /impact/pending      — Pending forecast resolution
 *   GET /health              — v19 system health
 *   GET /weights             — Pillar weights
 *   GET /schema              — v19 schema documentation
 *   GET /export/jsonl        — JSONL export
 *   GET /export/csv          — CSV export
 */

import { Hono } from "hono";
import { round2 } from "../lib/math-utils.ts";
import {
  getAgentArbitrationProfile,
  getAllArbitrationProfiles,
  getRecentCases,
  getDisagreementCases,
  getCaseById,
  getArbitrationPillarScore,
  getArbitrationStats,
} from "../services/benchmark-arbitration-engine.ts";
import {
  getAgentDebateProfile,
  getAllDebateProfiles,
  getRecentDebates,
  getDebateById,
  getDebatePillarScore,
  getDebateStats,
} from "../services/cross-agent-debate-engine.ts";
import {
  getAgentImpactProfile,
  getAllImpactProfiles,
  getImpactPillarScore,
  getRecentForecasts,
  getPendingForecasts,
  getImpactStats,
} from "../services/trade-impact-forecaster.ts";
import {
  getV17Rankings,
  getV17Health,
  type AgentBenchmarkProfile,
} from "../services/benchmark-intelligence-gateway.ts";
import {
  getAdversarialPillarScore,
} from "../services/adversarial-robustness-engine.ts";
import {
  getMemoryPillarScore,
} from "../services/cross-session-memory-analyzer.ts";
import {
  getBenchmarkHealthPillarScore,
} from "../services/benchmark-regression-detector.ts";

export const benchmarkV19ApiRoutes = new Hono();

// ---------------------------------------------------------------------------
// Pillar weights (21 pillars)
// ---------------------------------------------------------------------------

const V19_PILLAR_WEIGHTS: Record<string, number> = {
  financial: 0.09,
  reasoning: 0.08,
  safety: 0.07,
  calibration: 0.06,
  patterns: 0.04,
  adaptability: 0.04,
  forensic_quality: 0.06,
  validation_quality: 0.06,
  prediction_accuracy: 0.05,
  reasoning_stability: 0.04,
  provenance_integrity: 0.05,
  model_comparison: 0.04,
  metacognition: 0.05,
  reasoning_efficiency: 0.03,
  forensic_ledger: 0.03,
  strategy_genome: 0.03,
  adversarial_robustness: 0.04,
  cross_session_memory: 0.04,
  arbitration_quality: 0.05,
  debate_performance: 0.05,
  impact_forecasting: 0.05,
};

function computeV19Score(
  agentId: string,
  v17Profile: AgentBenchmarkProfile | undefined,
): {
  composite: number;
  grade: string;
  pillars: Record<string, number>;
} {
  const pillars: Record<string, number> = {};

  // Extract base pillars from v17 profile (array-based)
  if (v17Profile) {
    for (const p of v17Profile.pillars) {
      pillars[p.name] = p.score;
    }
  }
  // Fill defaults for any missing pillars
  for (const key of Object.keys(V19_PILLAR_WEIGHTS)) {
    if (pillars[key] === undefined) pillars[key] = 0.5;
  }

  // v18 pillars
  pillars.adversarial_robustness = getAdversarialPillarScore(agentId);
  pillars.cross_session_memory = getMemoryPillarScore(agentId);

  // v19 NEW pillars
  pillars.arbitration_quality = getArbitrationPillarScore(agentId);
  pillars.debate_performance = getDebatePillarScore(agentId);
  pillars.impact_forecasting = getImpactPillarScore(agentId);

  // Compute composite
  let composite = 0;
  for (const [pillar, weight] of Object.entries(V19_PILLAR_WEIGHTS)) {
    composite += (pillars[pillar] ?? 0.5) * weight;
  }
  composite = round2(composite);

  // Grade assignment
  const grade = composite >= 0.95 ? "A+"
    : composite >= 0.90 ? "A"
    : composite >= 0.85 ? "A-"
    : composite >= 0.80 ? "B+"
    : composite >= 0.75 ? "B"
    : composite >= 0.70 ? "B-"
    : composite >= 0.65 ? "C+"
    : composite >= 0.60 ? "C"
    : composite >= 0.55 ? "C-"
    : composite >= 0.50 ? "D+"
    : composite >= 0.45 ? "D"
    : composite >= 0.40 ? "D-"
    : "F";

  return { composite, grade, pillars };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /scores — All agent v19 scores
 */
benchmarkV19ApiRoutes.get("/scores", (c) => {
  const v17Rankings = getV17Rankings();

  const scores = (v17Rankings.length > 0
    ? v17Rankings
    : [
        { agentId: "claude-value-investor" },
        { agentId: "gpt-momentum-trader" },
        { agentId: "grok-contrarian" },
      ] as Array<{ agentId: string } & Partial<AgentBenchmarkProfile>>
  ).map((r) => {
    const v19 = computeV19Score(r.agentId, r as AgentBenchmarkProfile);
    return {
      agentId: r.agentId,
      composite: v19.composite,
      grade: v19.grade,
      pillars: v19.pillars,
      v19Pillars: {
        arbitration: v19.pillars.arbitration_quality,
        debate: v19.pillars.debate_performance,
        impact: v19.pillars.impact_forecasting,
      },
    };
  });

  scores.sort((a, b) => b.composite - a.composite);

  return c.json({
    ok: true,
    benchmark: "moltapp-v19",
    pillarCount: 21,
    scores,
    weights: V19_PILLAR_WEIGHTS,
  });
});

/**
 * GET /score/:agentId — Single agent detailed scorecard
 */
benchmarkV19ApiRoutes.get("/score/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const v17Rankings = getV17Rankings();
  const v17Profile = v17Rankings.find((r) => r.agentId === agentId);
  const v19 = computeV19Score(agentId, v17Profile);

  const arbitration = getAgentArbitrationProfile(agentId);
  const debate = getAgentDebateProfile(agentId);
  const impact = getAgentImpactProfile(agentId);

  return c.json({
    ok: true,
    agentId,
    benchmark: "moltapp-v19",
    composite: v19.composite,
    grade: v19.grade,
    pillars: v19.pillars,
    v19Details: {
      arbitration,
      debate,
      impact,
    },
    weights: V19_PILLAR_WEIGHTS,
  });
});

/**
 * GET /arbitration — Recent arbitration cases
 */
benchmarkV19ApiRoutes.get("/arbitration", (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10), 100);
  const cases = getRecentCases(limit);
  const profiles = getAllArbitrationProfiles();
  const stats = getArbitrationStats();

  return c.json({ ok: true, cases, profiles, stats });
});

/**
 * GET /arbitration/disagreements — Only disagreement cases
 */
benchmarkV19ApiRoutes.get("/arbitration/disagreements", (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10), 100);
  const cases = getDisagreementCases(limit);

  return c.json({ ok: true, disagreements: cases, total: cases.length });
});

/**
 * GET /arbitration/case/:caseId — Specific case detail
 */
benchmarkV19ApiRoutes.get("/arbitration/case/:caseId", (c) => {
  const caseId = c.req.param("caseId");
  const arCase = getCaseById(caseId);
  if (!arCase) return c.json({ ok: false, error: "Case not found" }, 404);
  return c.json({ ok: true, case: arCase });
});

/**
 * GET /arbitration/:agentId — Agent arbitration profile
 */
benchmarkV19ApiRoutes.get("/arbitration/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const profile = getAgentArbitrationProfile(agentId);
  return c.json({ ok: true, profile });
});

/**
 * GET /debates — Recent debate rounds
 */
benchmarkV19ApiRoutes.get("/debates", (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10), 100);
  const recentDebates = getRecentDebates(limit);
  const profiles = getAllDebateProfiles();
  const stats = getDebateStats();

  return c.json({ ok: true, debates: recentDebates, profiles, stats });
});

/**
 * GET /debates/detail/:debateId — Specific debate detail
 */
benchmarkV19ApiRoutes.get("/debates/detail/:debateId", (c) => {
  const debateId = c.req.param("debateId");
  const debate = getDebateById(debateId);
  if (!debate) return c.json({ ok: false, error: "Debate not found" }, 404);
  return c.json({ ok: true, debate });
});

/**
 * GET /debates/:agentId — Agent debate profile
 */
benchmarkV19ApiRoutes.get("/debates/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const profile = getAgentDebateProfile(agentId);
  return c.json({ ok: true, profile });
});

/**
 * GET /impact — All impact forecast profiles
 */
benchmarkV19ApiRoutes.get("/impact", (c) => {
  const profiles = getAllImpactProfiles();
  const stats = getImpactStats();
  return c.json({ ok: true, profiles, stats });
});

/**
 * GET /impact/forecasts — Recent forecasts
 */
benchmarkV19ApiRoutes.get("/impact/forecasts", (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") ?? "30", 10), 200);
  const agentId = c.req.query("agent");
  const recentForecasts = getRecentForecasts(limit, agentId);
  return c.json({ ok: true, forecasts: recentForecasts });
});

/**
 * GET /impact/pending — Pending forecasts needing resolution
 */
benchmarkV19ApiRoutes.get("/impact/pending", (c) => {
  const pending = getPendingForecasts();
  return c.json({ ok: true, pending, count: pending.length });
});

/**
 * GET /impact/:agentId — Agent impact forecast profile
 */
benchmarkV19ApiRoutes.get("/impact/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const profile = getAgentImpactProfile(agentId);
  return c.json({ ok: true, profile });
});

/**
 * GET /health — v19 system health
 */
benchmarkV19ApiRoutes.get("/health", (c) => {
  const v17Health = getV17Health();
  const arbStats = getArbitrationStats();
  const debateStats = getDebateStats();
  const impactStats = getImpactStats();

  return c.json({
    ok: true,
    benchmark: "moltapp-v19",
    pillarCount: 21,
    v17Health,
    v19Health: {
      arbitration: {
        totalCases: arbStats.totalCases,
        disagreements: arbStats.disagreements,
        resolvedOutcomes: arbStats.resolvedOutcomes,
        healthy: true,
      },
      debates: {
        totalDebates: debateStats.totalDebates,
        avgQuality: debateStats.avgQuality,
        totalEvidenceClashes: debateStats.totalEvidenceClashes,
        healthy: true,
      },
      impact: {
        totalForecasts: impactStats.totalForecasts,
        resolvedForecasts: impactStats.resolvedForecasts,
        pendingForecasts: impactStats.pendingForecasts,
        overallDirectionAccuracy: impactStats.overallDirectionAccuracy,
        healthy: true,
      },
    },
  });
});

/**
 * GET /weights — 21-pillar weights
 */
benchmarkV19ApiRoutes.get("/weights", (c) => {
  return c.json({
    ok: true,
    version: "v19",
    pillarCount: 21,
    weights: V19_PILLAR_WEIGHTS,
    newInV19: {
      arbitration_quality: "Win rate + composite quality in pairwise reasoning arbitration",
      debate_performance: "Structured debate scoring: thesis, evidence, logic, rebuttal, honesty",
      impact_forecasting: "Direction accuracy, magnitude calibration, learning velocity, conviction correlation",
    },
  });
});

/**
 * GET /schema — v19 schema documentation
 */
benchmarkV19ApiRoutes.get("/schema", (c) => {
  return c.json({
    ok: true,
    version: "v19",
    pillarCount: 21,
    newPillars: {
      arbitration_quality: {
        description: "Pairwise reasoning arbitration — who has better evidence, logic, calibration?",
        dimensions: ["evidenceWeight", "logicalConsistency", "calibrationAccuracy", "riskDisclosure", "originality"],
        scoring: "Win rate 40%, composite 30%, outcome accuracy 20%, trend 10%",
      },
      debate_performance: {
        description: "Structured cross-agent debates with evidence clashes and logical chain analysis",
        dimensions: ["thesisClarity", "evidenceQuality", "logicalStrength", "rebuttalPower", "intellectualHonesty"],
        scoring: "Win rate 30%, avg score 30%, rebuttal win rate 20%, debate quality 20%",
      },
      impact_forecasting: {
        description: "Trade impact prediction accountability — direction, magnitude, learning velocity",
        dimensions: ["directionAccuracy", "magnitudeCalibration", "convictionCorrelation", "horizonAwareness", "learningVelocity"],
        scoring: "Direction 30%, conviction correlation 20%, learning velocity 25%, magnitude 15%, horizon 10%",
      },
    },
    endpoints: {
      scores: "/api/v1/benchmark-v19/scores",
      agent_score: "/api/v1/benchmark-v19/score/:agentId",
      arbitration: "/api/v1/benchmark-v19/arbitration",
      arbitration_agent: "/api/v1/benchmark-v19/arbitration/:agentId",
      arbitration_case: "/api/v1/benchmark-v19/arbitration/case/:caseId",
      arbitration_disagreements: "/api/v1/benchmark-v19/arbitration/disagreements",
      debates: "/api/v1/benchmark-v19/debates",
      debate_agent: "/api/v1/benchmark-v19/debates/:agentId",
      debate_detail: "/api/v1/benchmark-v19/debates/detail/:debateId",
      impact: "/api/v1/benchmark-v19/impact",
      impact_agent: "/api/v1/benchmark-v19/impact/:agentId",
      impact_forecasts: "/api/v1/benchmark-v19/impact/forecasts",
      impact_pending: "/api/v1/benchmark-v19/impact/pending",
      health: "/api/v1/benchmark-v19/health",
      weights: "/api/v1/benchmark-v19/weights",
      schema: "/api/v1/benchmark-v19/schema",
    },
  });
});

/**
 * GET /export/jsonl — JSONL export
 */
benchmarkV19ApiRoutes.get("/export/jsonl", (c) => {
  const v17Rankings = getV17Rankings();
  const agents = v17Rankings.length > 0
    ? v17Rankings
    : [
        { agentId: "claude-value-investor" },
        { agentId: "gpt-momentum-trader" },
        { agentId: "grok-contrarian" },
      ] as Array<{ agentId: string } & Partial<AgentBenchmarkProfile>>;

  const lines = agents.map((r) => {
    const v19 = computeV19Score(r.agentId, r as AgentBenchmarkProfile);
    const arb = getAgentArbitrationProfile(r.agentId);
    const debate = getAgentDebateProfile(r.agentId);
    const impact = getAgentImpactProfile(r.agentId);

    return JSON.stringify({
      agent_id: r.agentId,
      benchmark_version: "v19",
      composite: v19.composite,
      grade: v19.grade,
      pillars: v19.pillars,
      arbitration: {
        wins: arb.wins,
        losses: arb.losses,
        winRate: arb.winRate,
        avgComposite: arb.avgComposite,
        strength: arb.strengthDimension,
        weakness: arb.weaknessDimension,
      },
      debate: {
        wins: debate.wins,
        losses: debate.losses,
        winRate: debate.winRate,
        avgScore: debate.avgScore,
        bestDimension: debate.bestDimension,
      },
      impact: {
        directionAccuracy: impact.directionAccuracy,
        learningVelocity: impact.learningVelocity,
        convictionCorrelation: impact.convictionCorrelation,
        compositeScore: impact.compositeScore,
      },
      timestamp: new Date().toISOString(),
    });
  });

  c.header("Content-Type", "application/jsonl");
  c.header("Content-Disposition", "attachment; filename=moltapp-v19-benchmark.jsonl");
  return c.text(lines.join("\n"));
});

/**
 * GET /export/csv — CSV export
 */
benchmarkV19ApiRoutes.get("/export/csv", (c) => {
  const v17Rankings = getV17Rankings();
  const agents = v17Rankings.length > 0
    ? v17Rankings
    : [
        { agentId: "claude-value-investor" },
        { agentId: "gpt-momentum-trader" },
        { agentId: "grok-contrarian" },
      ] as Array<{ agentId: string } & Partial<AgentBenchmarkProfile>>;

  const header = "agent_id,composite,grade,arb_wins,arb_losses,arb_winrate,debate_wins,debate_losses,debate_winrate,impact_direction_accuracy,impact_learning_velocity,timestamp";
  const rows = agents.map((r) => {
    const v19 = computeV19Score(r.agentId, r as AgentBenchmarkProfile);
    const arb = getAgentArbitrationProfile(r.agentId);
    const debate = getAgentDebateProfile(r.agentId);
    const impact = getAgentImpactProfile(r.agentId);
    return `${r.agentId},${v19.composite},${v19.grade},${arb.wins},${arb.losses},${arb.winRate},${debate.wins},${debate.losses},${debate.winRate},${impact.directionAccuracy},${impact.learningVelocity},${new Date().toISOString()}`;
  });

  c.header("Content-Type", "text/csv");
  c.header("Content-Disposition", "attachment; filename=moltapp-v19-benchmark.csv");
  return c.text([header, ...rows].join("\n"));
});
