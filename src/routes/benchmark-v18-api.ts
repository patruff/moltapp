/**
 * Benchmark v18 API Routes
 *
 * Researcher-facing API for the 18-pillar benchmark scoring system.
 * New in v18: Adversarial Robustness, Cross-Session Memory, Benchmark Regression.
 *
 * Routes:
 *   GET /scores              — All agent scores (18-pillar composite)
 *   GET /score/:agentId      — Single agent detailed scorecard
 *   GET /robustness          — All agents adversarial robustness profiles
 *   GET /robustness/:agentId — Single agent robustness analysis
 *   GET /memory              — All agents cross-session memory profiles
 *   GET /memory/:agentId     — Single agent memory analysis
 *   GET /regression          — Benchmark health report + regression alerts
 *   GET /regression/alerts   — Active regression alerts
 *   GET /regression/history  — Health snapshot history for trend charts
 *   GET /health              — v18 system health
 *   GET /weights             — Pillar weights
 *   GET /schema              — v18 schema documentation
 *   GET /export/jsonl        — JSONL export
 *   GET /export/csv          — CSV export
 */

import { Hono } from "hono";
import { round3, countByCondition } from "../lib/math-utils.ts";
import { computeGrade } from "../lib/grade-calculator.ts";
import {
  getAgentRobustnessProfile,
  getAllRobustnessProfiles,
  getAdversarialPillarScore,
} from "../services/adversarial-robustness-engine.ts";
import {
  getAgentMemoryProfile,
  getAllMemoryProfiles,
  getMemoryPillarScore,
} from "../services/cross-session-memory-analyzer.ts";
import {
  getBenchmarkHealthReport,
  getActiveAlerts,
  getHealthSnapshotHistory,
  getBenchmarkHealthPillarScore,
} from "../services/benchmark-regression-detector.ts";
import {
  getV17Rankings,
  getV17Health,
  type AgentBenchmarkProfile,
} from "../services/benchmark-intelligence-gateway.ts";

export const benchmarkV18ApiRoutes = new Hono();

// ---------------------------------------------------------------------------
// Pillar weights (18 pillars)
// ---------------------------------------------------------------------------

const V18_PILLAR_WEIGHTS: Record<string, number> = {
  financial: 0.10,
  reasoning: 0.09,
  safety: 0.08,
  calibration: 0.07,
  patterns: 0.04,
  adaptability: 0.05,
  forensic_quality: 0.06,
  validation_quality: 0.07,
  prediction_accuracy: 0.05,
  reasoning_stability: 0.05,
  provenance_integrity: 0.05,
  model_comparison: 0.04,
  metacognition: 0.05,
  reasoning_efficiency: 0.04,
  forensic_ledger: 0.03,
  strategy_genome: 0.03,
  adversarial_robustness: 0.05,
  cross_session_memory: 0.05,
};

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /scores — All agent v18 scores
 */
benchmarkV18ApiRoutes.get("/scores", (c) => {
  const v17Rankings = getV17Rankings();
  const robustnessProfiles = getAllRobustnessProfiles();
  const memoryProfiles = getAllMemoryProfiles();
  const healthReport = getBenchmarkHealthReport();

  const agentScores = v17Rankings.map((agent) => {
    const robustness = robustnessProfiles.find((r) => r.agentId === agent.agentId);
    const memory = memoryProfiles.find((m) => m.agentId === agent.agentId);

    const v18Pillars = {
      ...extractV17Pillars(agent),
      adversarial_robustness: robustness?.overallScore ?? 0.5,
      cross_session_memory: memory?.memoryScore ?? 0.5,
    };

    const composite = computeV18Composite(v18Pillars);
    const grade = computeGrade(composite);

    return {
      agentId: agent.agentId,
      provider: agent.provider,
      model: agent.model,
      composite,
      grade,
      rank: 0, // Will be set after sorting
      pillars: v18Pillars,
      elo: agent.eloRating,
      tradeCount: agent.tradeCount,
      lastUpdated: new Date().toISOString(),
    };
  });

  // Sort by composite and assign ranks
  agentScores.sort((a, b) => b.composite - a.composite);
  agentScores.forEach((a, i) => { a.rank = i + 1; });

  return c.json({
    ok: true,
    version: "v18",
    pillars: 18,
    scores: agentScores,
    benchmarkHealth: healthReport.status,
    pillarWeights: V18_PILLAR_WEIGHTS,
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /score/:agentId — Detailed v18 scorecard for one agent
 */
benchmarkV18ApiRoutes.get("/score/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const v17Rankings = getV17Rankings();
  const agent = v17Rankings.find((a) => a.agentId === agentId);

  const robustness = getAgentRobustnessProfile(agentId);
  const memory = getAgentMemoryProfile(agentId);

  const basePillars: Record<string, number> = agent
    ? extractV17Pillars(agent)
    : {
        financial: 0.5, reasoning: 0.5, safety: 0.5, calibration: 0.5,
        patterns: 0.5, adaptability: 0.5, forensic_quality: 0.5,
        validation_quality: 0.5, prediction_accuracy: 0.5,
        reasoning_stability: 0.5, provenance_integrity: 0.5,
        model_comparison: 0.5, metacognition: 0.5, reasoning_efficiency: 0.5,
        forensic_ledger: 0.5, strategy_genome: 0.5,
      };
  const v18Pillars: Record<string, number> = {
    ...basePillars,
    adversarial_robustness: robustness.overallScore,
    cross_session_memory: memory.memoryScore,
  };

  const composite = computeV18Composite(v18Pillars);

  return c.json({
    ok: true,
    agentId,
    composite,
    grade: computeGrade(composite),
    pillars: v18Pillars,
    pillarDetails: Object.entries(v18Pillars).map(([name, score]) => ({
      name,
      score,
      weight: V18_PILLAR_WEIGHTS[name] ?? 0,
      weightedContribution: score * (V18_PILLAR_WEIGHTS[name] ?? 0),
    })),
    robustness: {
      overallScore: robustness.overallScore,
      testCount: robustness.testCount,
      topVulnerabilities: robustness.topVulnerabilities,
      trend: robustness.trend,
    },
    memory: {
      memoryScore: memory.memoryScore,
      dimensions: memory.dimensions,
      repeatedMistakes: memory.repeatedMistakes.length,
      learningCurve: memory.learningCurve,
      strengths: memory.memoryStrengths,
      weaknesses: memory.memoryWeaknesses,
      trend: memory.trend,
    },
    elo: agent?.eloRating ?? 1500,
    tradeCount: agent?.tradeCount ?? 0,
  });
});

/**
 * GET /robustness — All agents adversarial robustness
 */
benchmarkV18ApiRoutes.get("/robustness", (c) => {
  const profiles = getAllRobustnessProfiles();
  return c.json({
    ok: true,
    agents: profiles,
    summary: {
      avgScore: profiles.length > 0
        ? round3(profiles.reduce((s, p) => s + p.overallScore, 0) / profiles.length)
        : 0,
      totalTests: profiles.reduce((s, p) => s + p.testCount, 0),
      mostVulnerable: profiles.length > 0
        ? profiles.sort((a, b) => a.overallScore - b.overallScore)[0]?.agentId ?? null
        : null,
      mostRobust: profiles.length > 0
        ? profiles.sort((a, b) => b.overallScore - a.overallScore)[0]?.agentId ?? null
        : null,
    },
  });
});

/**
 * GET /robustness/:agentId — Single agent robustness
 */
benchmarkV18ApiRoutes.get("/robustness/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const profile = getAgentRobustnessProfile(agentId);
  return c.json({ ok: true, profile });
});

/**
 * GET /memory — All agents cross-session memory
 */
benchmarkV18ApiRoutes.get("/memory", (c) => {
  const profiles = getAllMemoryProfiles();
  return c.json({
    ok: true,
    agents: profiles,
    summary: {
      avgMemoryScore: profiles.length > 0
        ? round3(profiles.reduce((s, p) => s + p.memoryScore, 0) / profiles.length)
        : 0,
      bestLearner: profiles.length > 0
        ? profiles.sort((a, b) => b.memoryScore - a.memoryScore)[0]?.agentId ?? null
        : null,
      worstLearner: profiles.length > 0
        ? profiles.sort((a, b) => a.memoryScore - b.memoryScore)[0]?.agentId ?? null
        : null,
      totalRepeatedMistakes: profiles.reduce((s, p) => s + p.repeatedMistakes.length, 0),
    },
  });
});

/**
 * GET /memory/:agentId — Single agent memory
 */
benchmarkV18ApiRoutes.get("/memory/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const profile = getAgentMemoryProfile(agentId);
  return c.json({ ok: true, profile });
});

/**
 * GET /regression — Benchmark health report
 */
benchmarkV18ApiRoutes.get("/regression", (c) => {
  const report = getBenchmarkHealthReport();
  return c.json({ ok: true, report });
});

/**
 * GET /regression/alerts — Active regression alerts
 */
benchmarkV18ApiRoutes.get("/regression/alerts", (c) => {
  const alerts = getActiveAlerts();
  return c.json({
    ok: true,
    alerts,
    count: alerts.length,
    bySeverity: {
      critical: countByCondition(alerts, (a) => a.severity === "critical"),
      high: countByCondition(alerts, (a) => a.severity === "high"),
      medium: countByCondition(alerts, (a) => a.severity === "medium"),
      low: countByCondition(alerts, (a) => a.severity === "low"),
    },
  });
});

/**
 * GET /regression/history — Health snapshot history
 */
benchmarkV18ApiRoutes.get("/regression/history", (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10), 200);
  const history = getHealthSnapshotHistory().slice(-limit);
  return c.json({ ok: true, snapshots: history, count: history.length });
});

/**
 * GET /health — v18 system health
 */
benchmarkV18ApiRoutes.get("/health", (c) => {
  const v17Health = getV17Health();
  const benchmarkHealth = getBenchmarkHealthReport();

  return c.json({
    ok: true,
    version: "v18",
    pillars: 18,
    newPillars: ["adversarial_robustness", "cross_session_memory"],
    newServices: ["AdversarialRobustnessEngine", "CrossSessionMemoryAnalyzer", "BenchmarkRegressionDetector"],
    benchmarkStatus: benchmarkHealth.status,
    agentCount: v17Health.totalAgents ?? 0,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /weights — Pillar weights
 */
benchmarkV18ApiRoutes.get("/weights", (c) => {
  const total = Object.values(V18_PILLAR_WEIGHTS).reduce((s, w) => s + w, 0);
  return c.json({
    ok: true,
    version: "v18",
    pillarCount: Object.keys(V18_PILLAR_WEIGHTS).length,
    weights: V18_PILLAR_WEIGHTS,
    totalWeight: round3(total),
    newInV18: {
      adversarial_robustness: {
        weight: V18_PILLAR_WEIGHTS.adversarial_robustness,
        description: "Agent reasoning quality under adversarial conditions: conflicting signals, anchoring, noise, edge cases, framing bias",
      },
      cross_session_memory: {
        weight: V18_PILLAR_WEIGHTS.cross_session_memory,
        description: "Does the agent learn across sessions? Mistake repetition, lesson retention, strategy evolution, symbol knowledge, confidence recalibration",
      },
    },
  });
});

/**
 * GET /schema — v18 schema documentation
 */
benchmarkV18ApiRoutes.get("/schema", (c) => {
  return c.json({
    ok: true,
    version: "v18",
    description: "MoltApp AI Trading Benchmark v18 — 18-Pillar Scoring with Adversarial Robustness, Cross-Session Memory, and Benchmark Regression Detection",
    pillars: [
      { name: "financial", weight: 0.10, source: "v9+", description: "P&L, Sharpe, Win Rate, Max Drawdown" },
      { name: "reasoning", weight: 0.09, source: "v9+", description: "Coherence, Depth, Consistency" },
      { name: "safety", weight: 0.08, source: "v9+", description: "Hallucination-Free Rate, Discipline" },
      { name: "calibration", weight: 0.07, source: "v10+", description: "ECE, Brier Score, Monotonic Calibration" },
      { name: "patterns", weight: 0.04, source: "v10+", description: "Fallacy Detection, Vocabulary Sophistication" },
      { name: "adaptability", weight: 0.05, source: "v9+", description: "Cross-Regime Consistency" },
      { name: "forensic_quality", weight: 0.06, source: "v11+", description: "Structure, Originality, Clarity, Integrity" },
      { name: "validation_quality", weight: 0.07, source: "v12+", description: "Depth, Sources, Grounding, Risk Awareness" },
      { name: "prediction_accuracy", weight: 0.05, source: "v14+", description: "Direction, Target Precision, Resolution" },
      { name: "reasoning_stability", weight: 0.05, source: "v14+", description: "Sentiment/Confidence Volatility, Intent Drift" },
      { name: "provenance_integrity", weight: 0.05, source: "v15+", description: "Pre-Commit Seals, Chain Integrity, Witnesses" },
      { name: "model_comparison", weight: 0.04, source: "v15+", description: "Vocabulary Uniqueness, Reasoning Independence" },
      { name: "metacognition", weight: 0.05, source: "v16+", description: "Epistemic Humility, Error Recognition, Adaptive Strategy" },
      { name: "reasoning_efficiency", weight: 0.04, source: "v16+", description: "Information Density, Signal-to-Noise" },
      { name: "forensic_ledger", weight: 0.03, source: "v17+", description: "Hash-Chain Integrity, Outcome Resolution" },
      { name: "strategy_genome", weight: 0.03, source: "v17+", description: "8-Gene Behavioral DNA, Cosine Similarity" },
      { name: "adversarial_robustness", weight: 0.05, source: "v18", description: "Signal Conflict Handling, Anchoring Resistance, Noise Sensitivity, Edge Cases, Framing Bias Detection" },
      { name: "cross_session_memory", weight: 0.05, source: "v18", description: "Mistake Repetition, Lesson Retention, Strategy Evolution, Symbol Knowledge, Confidence Recalibration" },
    ],
    gradeScale: {
      "A+": ">= 0.95", A: ">= 0.90", "A-": ">= 0.85",
      "B+": ">= 0.80", B: ">= 0.75", "B-": ">= 0.70",
      "C+": ">= 0.65", C: ">= 0.60", "C-": ">= 0.55",
      "D+": ">= 0.50", D: ">= 0.45", "D-": ">= 0.40",
      F: "< 0.40",
    },
    endpoints: {
      dashboard: "/benchmark-v18",
      scores: "/api/v1/benchmark-v18/scores",
      agentScore: "/api/v1/benchmark-v18/score/:agentId",
      robustness: "/api/v1/benchmark-v18/robustness",
      robustnessAgent: "/api/v1/benchmark-v18/robustness/:agentId",
      memory: "/api/v1/benchmark-v18/memory",
      memoryAgent: "/api/v1/benchmark-v18/memory/:agentId",
      regression: "/api/v1/benchmark-v18/regression",
      regressionAlerts: "/api/v1/benchmark-v18/regression/alerts",
      regressionHistory: "/api/v1/benchmark-v18/regression/history",
      health: "/api/v1/benchmark-v18/health",
      weights: "/api/v1/benchmark-v18/weights",
      schema: "/api/v1/benchmark-v18/schema",
    },
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractV17Pillars(agent: AgentBenchmarkProfile): Record<string, number> {
  const pillarMap: Record<string, number> = {};
  for (const p of agent.pillars) {
    pillarMap[p.name] = p.score;
  }
  return pillarMap;
}

function computeV18Composite(pillars: Record<string, number>): number {
  let composite = 0;
  let totalWeight = 0;
  for (const [name, weight] of Object.entries(V18_PILLAR_WEIGHTS)) {
    const score = pillars[name] ?? 0.5;
    composite += score * weight;
    totalWeight += weight;
  }
  return totalWeight > 0
    ? round3(composite / totalWeight)
    : 0.5;
}
