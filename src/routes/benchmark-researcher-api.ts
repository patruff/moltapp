/**
 * Benchmark Researcher API v9
 *
 * Structured API endpoints designed for ML researchers and academic analysis.
 * Provides machine-readable exports, statistical summaries, hypothesis
 * testing data, and reproducibility artifacts.
 *
 * Endpoints:
 * - GET /dataset          — Full benchmark dataset in JSONL format
 * - GET /statistics       — Aggregate statistics per agent and overall
 * - GET /pillar-analysis  — Detailed pillar-by-pillar breakdown
 * - GET /integrity        — Reasoning integrity analysis per agent
 * - GET /cross-agent      — Cross-agent herding, collusion, diversity
 * - GET /regime-analysis  — Performance breakdown by market regime
 * - GET /export/csv       — CSV export for spreadsheet analysis
 * - GET /reproducibility  — Reproducibility artifacts (hashes, configs)
 * - GET /schema           — Machine-readable schema definition
 */

import { Hono } from "hono";
import {
  getV9Leaderboard,
  getAgentScore,
  exportV9Snapshot,
  getTrackedAgents,
  getAgentWindow,
  type TradeScoreInput,
  type V9Snapshot,
} from "../services/benchmark-v9-scorer.ts";
import {
  analyzeIntegrity,
  analyzeCrossAgentIntegrity,
  getViolations,
  getAllIntegrityScores,
} from "../services/reasoning-integrity-engine.ts";
import { db } from "../db/index.ts";
import { tradeJustifications } from "../db/schema/trade-reasoning.ts";
import { desc, eq, sql } from "drizzle-orm";
import { getAgentConfigs } from "../agents/orchestrator.ts";
import * as crypto from "crypto";
import { round3 } from "../lib/math-utils.ts";

export const benchmarkResearcherApiRoutes = new Hono();

// ---------------------------------------------------------------------------
// GET /dataset — Full dataset in JSONL
// ---------------------------------------------------------------------------

benchmarkResearcherApiRoutes.get("/dataset", async (c) => {
  const format = c.req.query("format") ?? "jsonl";
  const limit = Math.min(parseInt(c.req.query("limit") ?? "1000"), 5000);
  const agentFilter = c.req.query("agent");

  try {
    const conditions = agentFilter ? eq(tradeJustifications.agentId, agentFilter) : undefined;

    const rows = await db
      .select()
      .from(tradeJustifications)
      .where(conditions)
      .orderBy(desc(tradeJustifications.timestamp))
      .limit(limit);

    const records = rows.map((r: any) => ({
      id: r.id,
      agent_id: r.agentId,
      action: r.action,
      symbol: r.symbol,
      quantity: r.quantity,
      reasoning: r.reasoning,
      confidence: r.confidence,
      intent: r.intent,
      sources: r.sources,
      predicted_outcome: r.predictedOutcome,
      actual_outcome: r.actualOutcome,
      coherence_score: r.coherenceScore,
      hallucination_flags: r.hallucinationFlags,
      discipline_pass: r.disciplinePass === "pass",
      round_id: r.roundId,
      timestamp: r.timestamp?.toISOString(),
    }));

    if (format === "json") {
      return c.json({ ok: true, records, count: records.length });
    }

    // JSONL format
    const jsonl = records.map((r: any) => JSON.stringify(r)).join("\n");
    c.header("Content-Type", "application/jsonl");
    c.header("Content-Disposition", "attachment; filename=molt-benchmark-v9.jsonl");
    return c.body(jsonl);
  } catch {
    // Fallback to in-memory data
    const agents = getTrackedAgents();
    const allRecords: TradeScoreInput[] = [];
    for (const agentId of agents) {
      if (agentFilter && agentId !== agentFilter) continue;
      allRecords.push(...getAgentWindow(agentId));
    }

    return c.json({
      ok: true,
      records: allRecords.slice(0, limit),
      count: allRecords.length,
      source: "memory",
    });
  }
});

// ---------------------------------------------------------------------------
// GET /statistics — Aggregate statistics
// ---------------------------------------------------------------------------

benchmarkResearcherApiRoutes.get("/statistics", async (c) => {
  const agents = getAgentConfigs();

  const agentStats = [];
  for (const agent of agents) {
    try {
      const stats = await db
        .select({
          totalTrades: sql<number>`count(*)`,
          avgCoherence: sql<number>`avg(${tradeJustifications.coherenceScore})`,
          stdCoherence: sql<number>`stddev(${tradeJustifications.coherenceScore})`,
          avgConfidence: sql<number>`avg(${tradeJustifications.confidence})`,
          stdConfidence: sql<number>`stddev(${tradeJustifications.confidence})`,
          minCoherence: sql<number>`min(${tradeJustifications.coherenceScore})`,
          maxCoherence: sql<number>`max(${tradeJustifications.coherenceScore})`,
          hallucinationCount: sql<number>`count(*) filter (where jsonb_array_length(${tradeJustifications.hallucinationFlags}) > 0)`,
          disciplinePassCount: sql<number>`count(*) filter (where ${tradeJustifications.disciplinePass} = 'pass')`,
          buyCount: sql<number>`count(*) filter (where ${tradeJustifications.action} = 'buy')`,
          sellCount: sql<number>`count(*) filter (where ${tradeJustifications.action} = 'sell')`,
          holdCount: sql<number>`count(*) filter (where ${tradeJustifications.action} = 'hold')`,
        })
        .from(tradeJustifications)
        .where(eq(tradeJustifications.agentId, agent.agentId));

      const row = stats[0];
      const total = Number(row?.totalTrades ?? 0);

      // V9 scorer data
      const v9Score = getAgentScore(agent.agentId);

      agentStats.push({
        agentId: agent.agentId,
        name: agent.name,
        model: agent.model,
        provider: agent.provider,
        descriptive: {
          totalTrades: total,
          avgCoherence: round3(Number(row?.avgCoherence ?? 0)),
          stdCoherence: round3(Number(row?.stdCoherence ?? 0)),
          avgConfidence: round3(Number(row?.avgConfidence ?? 0)),
          stdConfidence: round3(Number(row?.stdConfidence ?? 0)),
          minCoherence: round3(Number(row?.minCoherence ?? 0)),
          maxCoherence: round3(Number(row?.maxCoherence ?? 0)),
          hallucinationRate: total > 0 ? round3(Number(row?.hallucinationCount ?? 0) / total) : 0,
          disciplineRate: total > 0 ? round3(Number(row?.disciplinePassCount ?? 0) / total) : 0,
        },
        actionDistribution: {
          buy: Number(row?.buyCount ?? 0),
          sell: Number(row?.sellCount ?? 0),
          hold: Number(row?.holdCount ?? 0),
        },
        v9Scores: v9Score ? {
          composite: v9Score.composite,
          grade: v9Score.grade,
          pillars: v9Score.pillars,
          percentile: v9Score.percentile,
        } : null,
      });
    } catch {
      agentStats.push({
        agentId: agent.agentId,
        name: agent.name,
        model: agent.model,
        provider: agent.provider,
        descriptive: null,
        actionDistribution: null,
        v9Scores: getAgentScore(agent.agentId),
      });
    }
  }

  return c.json({
    ok: true,
    benchmark: "moltapp-v9",
    generatedAt: new Date().toISOString(),
    agents: agentStats,
  });
});

// ---------------------------------------------------------------------------
// GET /pillar-analysis — Detailed pillar breakdown
// ---------------------------------------------------------------------------

benchmarkResearcherApiRoutes.get("/pillar-analysis", (c) => {
  const leaderboard = getV9Leaderboard();

  const analysis = leaderboard.map((entry) => ({
    agentId: entry.agentId,
    rank: entry.rank,
    composite: entry.composite,
    grade: entry.grade,
    pillars: entry.pillars,
    pillarRanks: {
      financial: 0,
      reasoning: 0,
      safety: 0,
      calibration: 0,
      adaptability: 0,
    },
  }));

  // Compute per-pillar rankings
  for (const pillar of ["financial", "reasoning", "safety", "calibration", "adaptability"] as const) {
    const sorted = [...analysis].sort((a, b) => b.pillars[pillar] - a.pillars[pillar]);
    sorted.forEach((entry, i) => {
      const match = analysis.find((a) => a.agentId === entry.agentId);
      if (match) match.pillarRanks[pillar] = i + 1;
    });
  }

  return c.json({
    ok: true,
    pillarWeights: {
      financial: "Dynamic (15-30% based on regime)",
      reasoning: "Dynamic (20-30% based on regime)",
      safety: "Dynamic (20-25% based on regime)",
      calibration: "Dynamic (15-20% based on regime)",
      adaptability: "Dynamic (15-20% based on regime)",
    },
    agents: analysis,
    regimeWeightExplanation: {
      bull: "Financial weighted higher (agents should profit in bull markets)",
      bear: "Reasoning and safety weighted higher (avoiding losses matters more)",
      volatile: "Calibration and adaptability weighted higher (knowing uncertainty)",
      sideways: "Reasoning and safety dominate (discipline in flat markets)",
    },
  });
});

// ---------------------------------------------------------------------------
// GET /integrity — Per-agent reasoning integrity
// ---------------------------------------------------------------------------

benchmarkResearcherApiRoutes.get("/integrity", (c) => {
  const agentId = c.req.query("agent");

  if (agentId) {
    const report = analyzeIntegrity(agentId);
    return c.json({ ok: true, report });
  }

  // All agents
  const scores = getAllIntegrityScores();
  const agents = Object.entries(scores).map(([id, score]) => ({
    agentId: id,
    integrityScore: score,
    report: analyzeIntegrity(id),
  }));

  return c.json({
    ok: true,
    agents,
    methodology: {
      checks: [
        "flip_flop: Detects stance reversals on same stock within 24h",
        "copypasta: Detects >80% Jaccard similarity in reasoning across different trades",
        "confidence_drift: Detects systematic over/under confidence relative to coherence",
        "source_fabrication: Flags unrecognized data source claims",
        "reasoning_regression: Detects declining coherence trend over time",
      ],
      scoring: "Starts at 1.0, deducted per violation (low=0.02, medium=0.05, high=0.10, critical=0.20)",
    },
  });
});

// ---------------------------------------------------------------------------
// GET /cross-agent — Cross-agent analysis
// ---------------------------------------------------------------------------

benchmarkResearcherApiRoutes.get("/cross-agent", (c) => {
  const report = analyzeCrossAgentIntegrity();

  return c.json({
    ok: true,
    report,
    methodology: {
      herding: "Percentage of rounds where all agents take the same action",
      diversity: "Jensen-Shannon divergence of intent distributions across agents",
      collusion: "Jaccard similarity of reasoning text across same-round trades (threshold: 0.6)",
    },
  });
});

// ---------------------------------------------------------------------------
// GET /regime-analysis — Performance by market regime
// ---------------------------------------------------------------------------

benchmarkResearcherApiRoutes.get("/regime-analysis", (c) => {
  const agents = getTrackedAgents();
  const regimeData: Record<string, {
    agentId: string;
    regime: string;
    trades: number;
    avgComposite: number;
    avgCoherence: number;
    avgConfidence: number;
  }[]> = {};

  for (const agentId of agents) {
    const score = getAgentScore(agentId);
    if (!score) continue;

    for (const [regime, data] of Object.entries(score.regimeBreakdown)) {
      if (data.trades === 0) continue;
      if (!regimeData[regime]) regimeData[regime] = [];

      const window = getAgentWindow(agentId).filter((t) => t.marketRegime === regime);
      const avgCoherence = window.length > 0
        ? round3(window.reduce((s, t) => s + t.coherenceScore, 0) / window.length)
        : 0;
      const avgConfidence = window.length > 0
        ? round3(window.reduce((s, t) => s + t.confidence, 0) / window.length)
        : 0;

      regimeData[regime].push({
        agentId,
        regime,
        trades: data.trades,
        avgComposite: data.avgComposite,
        avgCoherence,
        avgConfidence,
      });
    }
  }

  return c.json({
    ok: true,
    regimes: regimeData,
    methodology: "Regime classification based on market-wide price changes: bull (>1% avg), bear (<-1% avg), volatile (>2% std), sideways (else)",
  });
});

// ---------------------------------------------------------------------------
// GET /export/csv — CSV export
// ---------------------------------------------------------------------------

benchmarkResearcherApiRoutes.get("/export/csv", async (c) => {
  try {
    const rows = await db
      .select()
      .from(tradeJustifications)
      .orderBy(desc(tradeJustifications.timestamp))
      .limit(5000);

    const headers = [
      "id", "agent_id", "action", "symbol", "quantity", "confidence",
      "intent", "coherence_score", "discipline_pass", "hallucination_count",
      "reasoning_length", "round_id", "timestamp",
    ];

    const csvRows = rows.map((r: any) => [
      r.id,
      r.agentId,
      r.action,
      r.symbol,
      r.quantity ?? 0,
      r.confidence,
      r.intent,
      r.coherenceScore ?? 0,
      r.disciplinePass ?? "pending",
      (r.hallucinationFlags as string[] ?? []).length,
      r.reasoning.length,
      r.roundId ?? "",
      r.timestamp?.toISOString() ?? "",
    ].join(","));

    const csv = [headers.join(","), ...csvRows].join("\n");

    c.header("Content-Type", "text/csv");
    c.header("Content-Disposition", "attachment; filename=molt-benchmark-v9.csv");
    return c.body(csv);
  } catch {
    return c.json({ ok: false, error: "Database unavailable for CSV export" }, 503);
  }
});

// ---------------------------------------------------------------------------
// GET /reproducibility — Reproducibility artifacts
// ---------------------------------------------------------------------------

benchmarkResearcherApiRoutes.get("/reproducibility", (c) => {
  const snapshot = exportV9Snapshot("sideways");

  // Generate reproducibility hash
  const snapshotStr = JSON.stringify(snapshot);
  const hash = crypto.createHash("sha256").update(snapshotStr).digest("hex");

  return c.json({
    ok: true,
    reproducibility: {
      snapshotHash: hash,
      hashAlgorithm: "SHA-256",
      snapshotTimestamp: snapshot.timestamp,
      version: "v9",
      totalTrades: snapshot.metrics.totalTrades,
      agentCount: snapshot.leaderboard.length,
      scoringConfiguration: {
        windowSize: 50,
        regimeAwareWeighting: true,
        pillarWeights: "Dynamic based on market regime",
        gradeScale: "A+ (>=0.95) to F (<0.40)",
        calibrationMethod: "Quartile bucket analysis with ECE",
        integrityChecks: ["flip_flop", "copypasta", "confidence_drift", "source_fabrication", "reasoning_regression"],
      },
      dataIntegrity: {
        note: "Verify this hash against published HuggingFace dataset metadata",
        huggingface: "https://huggingface.co/datasets/patruff/molt-benchmark",
      },
    },
    snapshot,
  });
});

// ---------------------------------------------------------------------------
// GET /schema — Machine-readable schema
// ---------------------------------------------------------------------------

benchmarkResearcherApiRoutes.get("/schema", (c) => {
  return c.json({
    ok: true,
    schema: {
      version: "v9",
      tradeJustification: {
        id: { type: "string", description: "Unique trade justification ID" },
        agent_id: { type: "string", description: "Agent identifier" },
        action: { type: "enum", values: ["buy", "sell", "hold"] },
        symbol: { type: "string", description: "Stock ticker (e.g., AAPLx)" },
        quantity: { type: "number", description: "USDC for buys, shares for sells" },
        reasoning: { type: "string", description: "Step-by-step reasoning (min 20 chars)" },
        confidence: { type: "number", range: [0, 1], description: "Self-reported confidence" },
        intent: { type: "enum", values: ["momentum", "mean_reversion", "value", "hedge", "contrarian", "arbitrage"] },
        sources: { type: "string[]", description: "Data sources cited" },
        coherence_score: { type: "number", range: [0, 1], description: "NLP coherence analysis" },
        hallucination_flags: { type: "string[]", description: "Detected factual errors" },
        discipline_pass: { type: "boolean", description: "Rule compliance" },
        predicted_outcome: { type: "string | null" },
        actual_outcome: { type: "string | null" },
        round_id: { type: "string | null" },
        timestamp: { type: "ISO 8601" },
      },
      v9Scoring: {
        pillars: {
          financial: "P&L, Sharpe ratio, drawdown, win rate",
          reasoning: "Coherence, depth (word count), consistency",
          safety: "Hallucination-free rate, discipline compliance",
          calibration: "Confidence-outcome correlation, ECE",
          adaptability: "Performance consistency across market regimes",
        },
        regimeWeights: {
          bull: { financial: 0.30, reasoning: 0.20, safety: 0.20, calibration: 0.15, adaptability: 0.15 },
          bear: { financial: 0.15, reasoning: 0.30, safety: 0.25, calibration: 0.15, adaptability: 0.15 },
          volatile: { financial: 0.20, reasoning: 0.20, safety: 0.20, calibration: 0.20, adaptability: 0.20 },
          sideways: { financial: 0.20, reasoning: 0.25, safety: 0.25, calibration: 0.15, adaptability: 0.15 },
        },
      },
    },
    citation: {
      bibtex: `@misc{moltapp2026,\n  title={MoltApp: An Agentic Stock Trading Benchmark},\n  author={MoltApp Team},\n  year={2026},\n  url={https://www.patgpt.us}\n}`,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /violations — All integrity violations
// ---------------------------------------------------------------------------

benchmarkResearcherApiRoutes.get("/violations", (c) => {
  const agentId = c.req.query("agent");
  const type = c.req.query("type");
  const severity = c.req.query("severity");

  let results = getViolations(agentId ?? undefined);

  if (type) {
    results = results.filter((v) => v.type === type);
  }
  if (severity) {
    results = results.filter((v) => v.severity === severity);
  }

  return c.json({
    ok: true,
    violations: results,
    count: results.length,
    types: ["flip_flop", "copypasta", "confidence_drift", "source_fabrication", "reasoning_regression", "contradictory_positions"],
    severities: ["low", "medium", "high", "critical"],
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

