/**
 * Benchmark v17 API Routes
 *
 * Researcher-facing API for the v17 benchmark. Provides structured access
 * to all 16 pillars, forensic ledger, strategy genomes, and exports.
 *
 * Routes:
 *   GET /scores              — All agent composite scores
 *   GET /score/:agentId      — Single agent detailed score
 *   GET /pillar-history/:agentId — Pillar score history over time
 *   GET /ledger              — Forensic ledger query with filters
 *   GET /ledger/stats        — Ledger aggregate statistics
 *   GET /ledger/integrity    — Chain integrity verification
 *   GET /ledger/export       — JSONL ledger export
 *   GET /genome/:agentId     — Agent strategy genome
 *   GET /genome/compare      — Compare two agent genomes
 *   GET /genome/all          — All agent genomes
 *   GET /health              — Benchmark health report
 *   GET /weights             — Current pillar weights
 *   GET /schema              — API schema documentation
 *   GET /export/jsonl        — Full benchmark JSONL export
 *   GET /export/csv          — Full benchmark CSV export
 */

import { Hono } from "hono";
import {
  getV17Rankings,
  getV17AgentProfile,
  getV17Health,
  getV17PillarHistory,
  exportV17Benchmark,
  V17_PILLAR_WEIGHTS,
} from "../services/benchmark-intelligence-gateway.ts";
import {
  queryLedger,
  getLedgerStats,
  verifyLedgerIntegrity,
  exportLedgerJsonl,
} from "../services/trade-forensic-ledger.ts";
import {
  getAgentGenome,
  getAllGenomes,
  compareGenomes,
} from "../services/agent-strategy-genome.ts";

export const benchmarkV17ApiRoutes = new Hono();

// ---------------------------------------------------------------------------
// Scores
// ---------------------------------------------------------------------------

benchmarkV17ApiRoutes.get("/scores", (c) => {
  const rankings = getV17Rankings();
  return c.json({
    ok: true,
    version: "v17",
    pillarCount: Object.keys(V17_PILLAR_WEIGHTS).length,
    agents: rankings.map((r) => ({
      rank: r.rank,
      agentId: r.agentId,
      provider: r.provider,
      model: r.model,
      composite: r.composite,
      grade: r.grade,
      eloRating: r.eloRating,
      streak: r.streak,
      tradeCount: r.tradeCount,
      dataQuality: r.dataQuality,
      lastUpdated: r.lastUpdated,
      pillars: r.pillars,
      strengths: r.strengths,
      weaknesses: r.weaknesses,
    })),
  });
});

benchmarkV17ApiRoutes.get("/score/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const profile = getV17AgentProfile(agentId);

  if (!profile) {
    return c.json({ ok: false, error: `Agent '${agentId}' not found in v17 benchmark` }, 404);
  }

  return c.json({ ok: true, profile });
});

benchmarkV17ApiRoutes.get("/pillar-history/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const history = getV17PillarHistory(agentId);

  return c.json({
    ok: true,
    agentId,
    history: history.map((h) => ({
      timestamp: new Date(h.timestamp).toISOString(),
      scores: h.scores,
    })),
    total: history.length,
  });
});

// ---------------------------------------------------------------------------
// Forensic Ledger
// ---------------------------------------------------------------------------

benchmarkV17ApiRoutes.get("/ledger", (c) => {
  const agentId = c.req.query("agent") ?? undefined;
  const symbol = c.req.query("symbol") ?? undefined;
  const roundId = c.req.query("round") ?? undefined;
  const action = c.req.query("action") ?? undefined;
  const minCoherence = c.req.query("minCoherence") ? parseFloat(c.req.query("minCoherence")!) : undefined;
  const maxHallucinations = c.req.query("maxHallucinations") ? parseInt(c.req.query("maxHallucinations")!) : undefined;
  const outcomeResolved = c.req.query("outcomeResolved") === "true" ? true : c.req.query("outcomeResolved") === "false" ? false : undefined;
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50"), 200);
  const offset = parseInt(c.req.query("offset") ?? "0");

  const result = queryLedger({
    agentId, symbol, roundId, action,
    minCoherence, maxHallucinations, outcomeResolved,
    limit, offset,
  });

  return c.json({
    ok: true,
    entries: result.entries,
    total: result.total,
    limit,
    offset,
    filters: { agentId, symbol, roundId, action, minCoherence, maxHallucinations, outcomeResolved },
  });
});

benchmarkV17ApiRoutes.get("/ledger/stats", (c) => {
  return c.json({ ok: true, stats: getLedgerStats() });
});

benchmarkV17ApiRoutes.get("/ledger/integrity", (c) => {
  const result = verifyLedgerIntegrity();
  return c.json({ ok: true, integrity: result });
});

benchmarkV17ApiRoutes.get("/ledger/export", (c) => {
  const agentId = c.req.query("agent") ?? undefined;
  const jsonl = exportLedgerJsonl(agentId);

  return new Response(jsonl, {
    headers: {
      "Content-Type": "application/jsonl",
      "Content-Disposition": `attachment; filename=moltapp-v17-ledger${agentId ? `-${agentId}` : ""}.jsonl`,
    },
  });
});

// ---------------------------------------------------------------------------
// Strategy Genomes
// ---------------------------------------------------------------------------

benchmarkV17ApiRoutes.get("/genome/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const genome = getAgentGenome(agentId);

  if (!genome) {
    return c.json({ ok: false, error: `No genome data for agent '${agentId}'` }, 404);
  }

  return c.json({ ok: true, genome });
});

benchmarkV17ApiRoutes.get("/genome/compare", (c) => {
  const agentA = c.req.query("a");
  const agentB = c.req.query("b");

  if (!agentA || !agentB) {
    return c.json({ ok: false, error: "Query params 'a' and 'b' (agent IDs) are required" }, 400);
  }

  const comparison = compareGenomes(agentA, agentB);
  if (!comparison) {
    return c.json({ ok: false, error: "One or both agents don't have genome data yet" }, 404);
  }

  return c.json({ ok: true, comparison });
});

benchmarkV17ApiRoutes.get("/genome/all", (c) => {
  const genomes = getAllGenomes();
  return c.json({
    ok: true,
    genomes: genomes.map((g) => ({
      agentId: g.agentId,
      dominantPhenotype: g.dominantPhenotype,
      genomeStability: g.genomeStability,
      tradesSampled: g.tradesSampled,
      genes: g.genes.map((gene) => ({
        name: gene.name,
        score: gene.score,
        phenotype: gene.phenotype,
        sampleSize: gene.sampleSize,
      })),
      similarity: g.similarity,
    })),
  });
});

// ---------------------------------------------------------------------------
// Health & Config
// ---------------------------------------------------------------------------

benchmarkV17ApiRoutes.get("/health", (c) => {
  return c.json({ ok: true, health: getV17Health() });
});

benchmarkV17ApiRoutes.get("/weights", (c) => {
  const weights = Object.entries(V17_PILLAR_WEIGHTS).map(([name, weight]) => ({
    pillar: name,
    weight,
    percentage: `${(weight * 100).toFixed(1)}%`,
  }));
  const total = weights.reduce((s, w) => s + w.weight, 0);
  return c.json({ ok: true, version: "v17", pillars: weights, totalWeight: total });
});

benchmarkV17ApiRoutes.get("/schema", (c) => {
  return c.json({
    ok: true,
    version: "v17",
    description: "MoltApp Benchmark v17 — 16-pillar AI Trading Intelligence Benchmark",
    endpoints: {
      "/scores": "All agent composite scores and rankings",
      "/score/:agentId": "Single agent detailed score with all 16 pillars",
      "/pillar-history/:agentId": "Pillar score history over time for trend analysis",
      "/ledger": "Forensic ledger query with filters (agent, symbol, round, coherence, hallucinations)",
      "/ledger/stats": "Aggregate ledger statistics per agent",
      "/ledger/integrity": "Cryptographic chain integrity verification",
      "/ledger/export": "JSONL ledger export for researchers",
      "/genome/:agentId": "Agent strategy genome (8 behavioral genes)",
      "/genome/compare?a=X&b=Y": "Compare two agent genomes",
      "/genome/all": "All agent genomes with cross-similarity",
      "/health": "Benchmark health report (data quality, coverage, warnings)",
      "/weights": "Current pillar weight configuration",
      "/schema": "This schema documentation",
      "/export/jsonl": "Full benchmark JSONL export",
      "/export/csv": "Full benchmark CSV export",
    },
    pillars: Object.entries(V17_PILLAR_WEIGHTS).map(([name, weight]) => ({
      name,
      weight,
      description: getPillarDescription(name),
    })),
    genes: [
      "risk_appetite", "conviction", "adaptability", "contrarianism",
      "information_processing", "temporal_awareness", "emotional_regulation", "learning_rate",
    ],
  });
});

function getPillarDescription(name: string): string {
  const descriptions: Record<string, string> = {
    financial: "P&L, Sharpe Ratio, Win Rate, Max Drawdown",
    reasoning: "Coherence, Depth, Consistency of reasoning",
    safety: "Hallucination-free rate, Discipline compliance",
    calibration: "ECE, Brier Score, Confidence calibration",
    patterns: "Fallacy detection, Vocabulary sophistication",
    adaptability: "Cross-regime consistency, Performance variance",
    forensic_quality: "Structural quality, Originality, Clarity",
    validation_quality: "Source verification, Price grounding, Risk awareness",
    prediction_accuracy: "Direction accuracy, Target precision",
    reasoning_stability: "Sentiment volatility, Intent drift",
    provenance_integrity: "SHA-256 chain integrity, Cross-agent witness",
    model_comparison: "Vocabulary uniqueness, Reasoning independence",
    metacognition: "Epistemic humility, Error recognition, Adaptive strategy",
    reasoning_efficiency: "Information density, Signal-to-noise ratio",
    forensic_ledger: "Immutable trade audit trail, Outcome resolution",
    strategy_genome: "8-gene behavioral DNA profile, Cross-agent similarity",
  };
  return descriptions[name] ?? name;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

benchmarkV17ApiRoutes.get("/export/jsonl", (c) => {
  const payload = exportV17Benchmark();
  const lines = payload.agents.map((a) => JSON.stringify(a)).join("\n");

  return new Response(lines, {
    headers: {
      "Content-Type": "application/jsonl",
      "Content-Disposition": "attachment; filename=moltapp-v17-benchmark.jsonl",
    },
  });
});

benchmarkV17ApiRoutes.get("/export/csv", (c) => {
  const rankings = getV17Rankings();

  const pillarNames = Object.keys(V17_PILLAR_WEIGHTS);
  const headers = ["rank", "agent_id", "provider", "model", "composite", "grade", "elo", "trades", ...pillarNames];
  const rows = rankings.map((r) => {
    const pillarScores = pillarNames.map((name) => {
      const pillar = r.pillars.find((p) => p.name === name);
      return pillar ? pillar.score.toFixed(4) : "0.0000";
    });
    return [r.rank, r.agentId, r.provider, r.model, r.composite.toFixed(4), r.grade, r.eloRating, r.tradeCount, ...pillarScores].join(",");
  });

  const csv = [headers.join(","), ...rows].join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": "attachment; filename=moltapp-v17-benchmark.csv",
    },
  });
});
