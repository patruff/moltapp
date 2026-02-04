/**
 * Benchmark v12 API — Researcher-Facing Data Access
 *
 * Provides structured access to v12 benchmark data:
 * - Validation reports for individual trades
 * - Reasoning taxonomy classifications
 * - Cross-round consistency analysis
 * - Dataset-level quality metrics
 * - Exportable data in JSON, JSONL, CSV formats
 *
 * Routes:
 * - GET /validate/:agentId          — Agent validation summary
 * - GET /taxonomy/:agentId          — Agent taxonomy profile
 * - GET /taxonomy/compare           — Compare agent taxonomies
 * - GET /consistency/:agentId       — Cross-round consistency report
 * - GET /consistency/all            — All agent consistency reports
 * - GET /quality                    — Dataset quality summary
 * - GET /schema                     — Machine-readable schema
 */

import { Hono } from "hono";
import {
  getAgentTaxonomyProfile,
  classifyReasoning,
  type TaxonomyClassification,
} from "../services/reasoning-taxonomy.ts";
import {
  analyzeConsistency,
  getTrackedAgents,
  getConsistencyHistorySize,
} from "../services/cross-round-consistency.ts";
import {
  validateForBenchmark,
  type DatasetQualityReport,
} from "../services/benchmark-validation-engine.ts";

export const benchmarkV12ApiRoutes = new Hono();

// ---------------------------------------------------------------------------
// GET /taxonomy/:agentId — Agent taxonomy profile
// ---------------------------------------------------------------------------

benchmarkV12ApiRoutes.get("/taxonomy/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const profile = getAgentTaxonomyProfile(agentId);

  if (!profile) {
    return c.json({
      ok: false,
      error: "No taxonomy data for this agent yet",
      agentId,
    }, 404);
  }

  return c.json({
    ok: true,
    agentId,
    profile,
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// GET /taxonomy/compare — Compare agent taxonomies
// ---------------------------------------------------------------------------

benchmarkV12ApiRoutes.get("/taxonomy/compare", (c) => {
  const agents = getTrackedAgents();
  const profiles = agents
    .map((id) => getAgentTaxonomyProfile(id))
    .filter((p): p is NonNullable<typeof p> => p !== null);

  if (profiles.length < 2) {
    return c.json({
      ok: true,
      comparison: null,
      message: "Need at least 2 agents with taxonomy data for comparison",
      agentCount: profiles.length,
    });
  }

  // Compare strategy distributions
  const strategyComparison: Record<string, Record<string, number>> = {};
  for (const profile of profiles) {
    strategyComparison[profile.agentId] = profile.strategyDistribution;
  }

  // Compare sophistication
  const sophisticationComparison = profiles.map((p) => ({
    agentId: p.agentId,
    avgSophistication: p.avgSophistication,
    fingerprintDiversity: p.fingerprintDiversity,
  }));

  // Compare biases
  const biasComparison = profiles.map((p) => ({
    agentId: p.agentId,
    biases: p.frequentBiases,
    totalBiasFrequency: p.frequentBiases.reduce((s, b) => s + b.frequency, 0),
  }));

  // Find strategy overlap
  const allStrategies = new Set<string>();
  for (const profile of profiles) {
    for (const strategy of Object.keys(profile.strategyDistribution)) {
      allStrategies.add(strategy);
    }
  }

  return c.json({
    ok: true,
    comparison: {
      strategyDistributions: strategyComparison,
      sophistication: sophisticationComparison,
      biases: biasComparison,
      strategyOverlap: [...allStrategies],
      agentCount: profiles.length,
    },
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// GET /consistency/:agentId — Cross-round consistency report
// ---------------------------------------------------------------------------

benchmarkV12ApiRoutes.get("/consistency/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const historySize = getConsistencyHistorySize(agentId);

  if (historySize === 0) {
    return c.json({
      ok: false,
      error: "No consistency data for this agent yet",
      agentId,
    }, 404);
  }

  const report = analyzeConsistency(agentId);

  return c.json({
    ok: true,
    agentId,
    report,
    historySize,
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// GET /consistency/all — All agent consistency reports
// ---------------------------------------------------------------------------

benchmarkV12ApiRoutes.get("/consistency/all", (c) => {
  const agents = getTrackedAgents();
  const reports = agents.map((agentId) => ({
    agentId,
    historySize: getConsistencyHistorySize(agentId),
    report: analyzeConsistency(agentId),
  }));

  // Sort by overall score descending
  reports.sort((a, b) => b.report.overallScore - a.report.overallScore);

  // Aggregate anomalies
  const allAnomalies = reports.flatMap((r) =>
    r.report.anomalies.map((a) => ({ ...a, agentId: r.agentId })),
  );
  const anomaliesByType = new Map<string, number>();
  for (const a of allAnomalies) {
    anomaliesByType.set(a.type, (anomaliesByType.get(a.type) ?? 0) + 1);
  }

  return c.json({
    ok: true,
    agents: reports.map((r) => ({
      agentId: r.agentId,
      overallScore: r.report.overallScore,
      grade: r.report.grade,
      roundsAnalyzed: r.report.roundsAnalyzed,
      anomalyCount: r.report.anomalies.length,
      qualityTrend: r.report.qualityTrend,
      dimensions: r.report.dimensions,
    })),
    anomalySummary: Object.fromEntries(anomaliesByType),
    totalAnomalies: allAnomalies.length,
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// POST /classify — Classify a reasoning text (for researchers)
// ---------------------------------------------------------------------------

benchmarkV12ApiRoutes.post("/classify", async (c) => {
  try {
    const body = await c.req.json<{ reasoning: string; action?: string }>();

    if (!body.reasoning || typeof body.reasoning !== "string") {
      return c.json({ ok: false, error: "reasoning field is required (string)" }, 400);
    }

    const classification = classifyReasoning(body.reasoning, body.action ?? "hold");

    return c.json({
      ok: true,
      classification,
      timestamp: new Date().toISOString(),
    });
  } catch {
    return c.json({ ok: false, error: "Invalid JSON body" }, 400);
  }
});

// ---------------------------------------------------------------------------
// GET /quality — Dataset quality summary
// ---------------------------------------------------------------------------

benchmarkV12ApiRoutes.get("/quality", (c) => {
  const agents = getTrackedAgents();

  const agentQuality = agents.map((agentId) => {
    const consistency = analyzeConsistency(agentId);
    const taxonomy = getAgentTaxonomyProfile(agentId);

    return {
      agentId,
      consistencyScore: consistency.overallScore,
      consistencyGrade: consistency.grade,
      taxonomySophistication: taxonomy?.avgSophistication ?? 0,
      fingerprintDiversity: taxonomy?.fingerprintDiversity ?? 0,
      biasCount: taxonomy?.frequentBiases.length ?? 0,
      qualityTrend: consistency.qualityTrend,
      roundsAnalyzed: consistency.roundsAnalyzed,
      anomalies: consistency.anomalies.length,
    };
  });

  const avgConsistency = agentQuality.length > 0
    ? agentQuality.reduce((s, a) => s + a.consistencyScore, 0) / agentQuality.length
    : 0;

  return c.json({
    ok: true,
    benchmark: "moltapp-v12",
    quality: {
      avgConsistencyScore: Math.round(avgConsistency * 1000) / 1000,
      agentCount: agents.length,
      totalAnomalies: agentQuality.reduce((s, a) => s + a.anomalies, 0),
      totalRoundsAnalyzed: agentQuality.reduce((s, a) => s + a.roundsAnalyzed, 0),
    },
    agents: agentQuality,
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// GET /schema — Machine-readable schema (for HuggingFace and researchers)
// ---------------------------------------------------------------------------

benchmarkV12ApiRoutes.get("/schema", (c) => {
  return c.json({
    ok: true,
    benchmark: "moltapp-v12",
    schema: {
      validation_dimensions: [
        { name: "structural_validity", weight: 0.15, description: "Required fields present and valid" },
        { name: "reasoning_depth", weight: 0.20, description: "Multi-factor analytical depth" },
        { name: "source_verification", weight: 0.10, description: "Data source plausibility" },
        { name: "price_grounding", weight: 0.15, description: "Price claims match market data" },
        { name: "temporal_consistency", weight: 0.10, description: "References current conditions" },
        { name: "confidence_calibration", weight: 0.10, description: "Confidence within historical norms" },
        { name: "action_reasoning_alignment", weight: 0.15, description: "Reasoning supports chosen action" },
        { name: "risk_awareness", weight: 0.05, description: "Acknowledges relevant risks" },
      ],
      taxonomy_fields: {
        strategy: ["value_investing", "momentum_trading", "mean_reversion", "contrarian", "growth_investing", "risk_management", "index_tracking", "event_driven", "technical_pattern", "portfolio_rebalancing"],
        analyticalMethod: ["fundamental", "technical", "quantitative", "narrative", "comparative", "mixed"],
        reasoningStructure: ["deductive", "inductive", "abductive", "analogical", "rule_based", "mixed"],
        evidenceType: ["quantitative", "qualitative", "mixed", "anecdotal"],
        decisionFramework: ["threshold_based", "comparative", "risk_adjusted", "conviction_based", "rule_following", "mixed"],
        cognitivePatterns: ["anchoring_bias", "recency_bias", "confirmation_bias", "loss_aversion", "overconfidence", "herd_mentality", "sunk_cost_fallacy", "gambler_fallacy", "availability_bias", "framing_effect"],
      },
      consistency_dimensions: {
        stanceConsistency: "Stance reversals on same symbol",
        convictionStability: "Confidence standard deviation",
        narrativeCoherence: "Vocabulary overlap between consecutive trades",
        strategyAlignment: "Intent classification stability",
        reasoningEvolution: "Quality trend over time (improving/stable/degrading)",
      },
      scoring_pillars: [
        { name: "financial", weight: 0.18 },
        { name: "reasoning", weight: 0.18 },
        { name: "safety", weight: 0.14 },
        { name: "calibration", weight: 0.10 },
        { name: "patterns", weight: 0.08 },
        { name: "adaptability", weight: 0.08 },
        { name: "forensic_quality", weight: 0.12 },
        { name: "validation_quality", weight: 0.12 },
      ],
    },
    endpoints: {
      dashboard: "/benchmark-v12",
      data: "/benchmark-v12/data",
      stream: "/benchmark-v12/stream",
      export: "/benchmark-v12/export",
      taxonomy: "/api/v1/benchmark-v12/taxonomy/:agentId",
      taxonomy_compare: "/api/v1/benchmark-v12/taxonomy/compare",
      consistency: "/api/v1/benchmark-v12/consistency/:agentId",
      consistency_all: "/api/v1/benchmark-v12/consistency/all",
      classify: "/api/v1/benchmark-v12/classify (POST)",
      quality: "/api/v1/benchmark-v12/quality",
    },
    timestamp: new Date().toISOString(),
  });
});
