/**
 * Forensic API Routes (v11)
 *
 * Researcher-facing API for deep forensic analysis of agent reasoning.
 * Provides structured data for ML researchers studying AI agent behavior.
 *
 * Routes:
 * - GET /health/:agentId   — Agent reasoning health summary
 * - GET /reports/:agentId  — Detailed forensic reports per trade
 * - GET /compare           — Cross-agent forensic comparison
 * - GET /violations        — All integrity violations across agents
 * - GET /export/csv        — CSV export of forensic data
 * - GET /schema            — Machine-readable schema for the forensic data
 */

import { Hono } from "hono";
import { parseQueryInt } from "../lib/query-params.ts";
import { getAgentConfigs } from "../agents/orchestrator.ts";
import {
  getAgentForensicHealth,
  getAgentForensicReports,
  type ForensicReport,
} from "../services/reasoning-forensic-engine.ts";
import {
  computeV11ScoreCard,
  computeV11Leaderboard,
} from "../services/benchmark-v11-scorer.ts";

export const forensicApiRoutes = new Hono();

// ---------------------------------------------------------------------------
// Agent Reasoning Health
// ---------------------------------------------------------------------------

forensicApiRoutes.get("/health/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const health = getAgentForensicHealth(agentId);
  const scoreCard = computeV11ScoreCard(agentId);

  return c.json({
    ok: true,
    agentId,
    health,
    scoreCard: {
      compositeScore: scoreCard.compositeScore,
      compositeGrade: scoreCard.compositeGrade,
      trend: scoreCard.trend,
      tradeCount: scoreCard.tradeCount,
      pillars: scoreCard.pillars.map((p) => ({
        name: p.name,
        score: p.score,
        grade: p.grade,
        weight: p.weight,
      })),
    },
  });
});

// ---------------------------------------------------------------------------
// Detailed Forensic Reports
// ---------------------------------------------------------------------------

forensicApiRoutes.get("/reports/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const limit = parseQueryInt(c.req.query("limit"), 20, 1, 100);

  const reports = getAgentForensicReports(agentId, limit);

  return c.json({
    ok: true,
    agentId,
    reports: reports.map(summarizeReport),
    total: reports.length,
  });
});

// ---------------------------------------------------------------------------
// Cross-Agent Comparison
// ---------------------------------------------------------------------------

forensicApiRoutes.get("/compare", (c) => {
  const agentConfigs = getAgentConfigs();
  const leaderboard = computeV11Leaderboard(agentConfigs);

  const comparison = agentConfigs.map((a) => {
    const health = getAgentForensicHealth(a.agentId);
    const entry = leaderboard.find((e) => e.agentId === a.agentId);

    return {
      agentId: a.agentId,
      name: a.name,
      model: a.model,
      provider: a.provider,
      compositeScore: entry?.compositeScore ?? 0,
      compositeGrade: entry?.compositeGrade ?? "F",
      pillarScores: entry?.pillarScores ?? {},
      forensicHealth: health,
      rank: entry?.rank ?? 0,
      rankChange: entry?.rankChange ?? "new",
    };
  });

  // Cross-agent metrics
  const allHealths = comparison.map((c) => c.forensicHealth);
  const avgDepth = allHealths.length > 0
    ? allHealths.reduce((s, h) => s + h.avgDepth, 0) / allHealths.length
    : 0;
  const avgOriginality = allHealths.length > 0
    ? allHealths.reduce((s, h) => s + h.avgOriginality, 0) / allHealths.length
    : 0;
  const totalViolations = allHealths.reduce((s, h) => s + h.integrityViolations, 0);

  return c.json({
    ok: true,
    agents: comparison,
    crossAgentMetrics: {
      avgDepth: Math.round(avgDepth * 100) / 100,
      avgOriginality: Math.round(avgOriginality * 100) / 100,
      totalViolations,
      agentCount: comparison.length,
    },
  });
});

// ---------------------------------------------------------------------------
// Integrity Violations
// ---------------------------------------------------------------------------

forensicApiRoutes.get("/violations", (c) => {
  const agentConfigs = getAgentConfigs();
  const allViolations: Array<{
    agentId: string;
    flag: string;
    tradeAction: string;
    symbol: string;
  }> = [];

  for (const agent of agentConfigs) {
    const reports = getAgentForensicReports(agent.agentId, 50);
    for (const report of reports) {
      for (const flag of report.crossTrade.flags) {
        allViolations.push({
          agentId: agent.agentId,
          flag,
          tradeAction: report.tradeAction,
          symbol: report.symbol,
        });
      }
    }
  }

  // Sort by most recent (reports are already ordered by recency)
  return c.json({
    ok: true,
    violations: allViolations,
    total: allViolations.length,
    byAgent: groupBy(allViolations, "agentId"),
  });
});

// ---------------------------------------------------------------------------
// CSV Export
// ---------------------------------------------------------------------------

forensicApiRoutes.get("/export/csv", (c) => {
  const agentConfigs = getAgentConfigs();
  const headers = [
    "agent_id", "action", "symbol", "composite_score", "grade",
    "structure_score", "depth_score", "depth_classification",
    "originality_score", "template_probability",
    "clarity_score", "dimensions_covered",
    "sentence_count", "quantitative_claims", "hedge_words",
    "causal_connectors", "cross_trade_flags",
  ];

  const rows: string[] = [headers.join(",")];

  for (const agent of agentConfigs) {
    const reports = getAgentForensicReports(agent.agentId, 100);
    for (const report of reports) {
      rows.push([
        report.agentId,
        report.tradeAction,
        report.symbol,
        report.compositeScore.toFixed(3),
        report.grade,
        report.structural.structureScore.toFixed(3),
        report.depth.depthScore.toFixed(3),
        report.depth.classification,
        report.originality.originalityScore.toFixed(3),
        report.originality.templateProbability.toFixed(3),
        report.clarity.clarityScore.toFixed(3),
        report.depth.dimensionCount.toString(),
        report.structural.sentenceCount.toString(),
        report.structural.quantitativeClaimCount.toString(),
        report.structural.hedgeWordCount.toString(),
        report.structural.causalConnectorCount.toString(),
        `"${report.crossTrade.flags.join("; ")}"`,
      ].join(","));
    }
  }

  c.header("Content-Type", "text/csv");
  c.header("Content-Disposition", `attachment; filename="moltapp-forensic-${new Date().toISOString().split("T")[0]}.csv"`);
  return c.body(rows.join("\n"));
});

// ---------------------------------------------------------------------------
// Schema (machine-readable)
// ---------------------------------------------------------------------------

forensicApiRoutes.get("/schema", (c) => {
  return c.json({
    ok: true,
    version: "v11",
    schema: {
      forensic_report: {
        agent_id: "string",
        round_id: "string",
        trade_action: "buy | sell | hold",
        symbol: "string",
        composite_score: "number (0-1)",
        grade: "string (A+ to F)",
        structural: {
          sentence_count: "integer",
          avg_sentence_length: "number",
          quantitative_claim_count: "integer",
          hedge_word_count: "integer",
          causal_connector_count: "integer",
          has_thesis: "boolean",
          has_evidence: "boolean",
          has_conclusion: "boolean",
          structure_score: "number (0-1)",
        },
        depth: {
          dimensions: "Record<string, boolean> — which analytical angles are covered",
          dimension_count: "integer (0-10)",
          depth_score: "number (0-1)",
          classification: "shallow | moderate | deep | exceptional",
        },
        originality: {
          jaccard_similarity_to_previous: "number (0-1)",
          unique_ngram_ratio: "number (0-1)",
          template_probability: "number (0-1)",
          originality_score: "number (0-1)",
        },
        clarity: {
          readability_score: "number (0-1)",
          avg_word_length: "number",
          jargon_ratio: "number (0-1)",
          clarity_score: "number (0-1)",
        },
        cross_trade: {
          contradicts_previous: "boolean",
          similar_to_previous: "boolean",
          stance_shift: "boolean",
          confidence_delta: "number",
          flags: "string[]",
        },
      },
      scoring_pillars: [
        { name: "Financial", weight: 0.20 },
        { name: "Reasoning", weight: 0.20 },
        { name: "Safety", weight: 0.15 },
        { name: "Calibration", weight: 0.10 },
        { name: "Patterns", weight: 0.10 },
        { name: "Adaptability", weight: 0.10 },
        { name: "Forensic Quality", weight: 0.15 },
      ],
    },
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function summarizeReport(report: ForensicReport) {
  return {
    agentId: report.agentId,
    roundId: report.roundId,
    action: report.tradeAction,
    symbol: report.symbol,
    compositeScore: report.compositeScore,
    grade: report.grade,
    structure: {
      score: report.structural.structureScore,
      sentences: report.structural.sentenceCount,
      quantitativeClaims: report.structural.quantitativeClaimCount,
      hedgeWords: report.structural.hedgeWordCount,
      causalConnectors: report.structural.causalConnectorCount,
      hasThesis: report.structural.hasThesis,
      hasEvidence: report.structural.hasEvidence,
      hasConclusion: report.structural.hasConclusion,
    },
    depth: {
      score: report.depth.depthScore,
      classification: report.depth.classification,
      dimensionsCovered: report.depth.dimensionCount,
      dimensions: report.depth.dimensions,
    },
    originality: {
      score: report.originality.originalityScore,
      templateProbability: report.originality.templateProbability,
      similarityToPrevious: report.originality.jaccardSimilarityToPrevious,
    },
    clarity: {
      score: report.clarity.clarityScore,
      jargonRatio: report.clarity.jargonRatio,
    },
    crossTrade: {
      contradictsPrevious: report.crossTrade.contradictsPrevious,
      stanceShift: report.crossTrade.stanceShift,
      flags: report.crossTrade.flags,
    },
  };
}

function groupBy<T extends Record<string, unknown>>(arr: T[], key: string): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of arr) {
    const k = String(item[key]);
    if (!result[k]) result[k] = [];
    result[k].push(item);
  }
  return result;
}
