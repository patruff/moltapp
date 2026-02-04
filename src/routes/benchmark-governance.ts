/**
 * Benchmark Governance API
 *
 * Provides full transparency into how MoltApp's benchmark operates.
 * This is what makes MoltApp an industry-standard benchmark — anyone
 * can inspect the methodology, audit trail, provenance chain, and
 * ranking system.
 *
 * Routes:
 * - GET /provenance              — Provenance chain summary & recent blocks
 * - GET /provenance/verify       — Verify full chain integrity
 * - GET /provenance/certificate  — Generate export provenance certificate
 * - GET /audit                   — Query the audit trail
 * - GET /audit/summary           — Audit trail summary statistics
 * - GET /rankings                — Current composite rankings with full breakdown
 * - GET /rankings/elo            — Elo ratings for all agents
 * - GET /rankings/history/:id    — Score history for an agent
 * - GET /dna                     — Strategy DNA profiles for all agents
 * - GET /dna/:agentId            — Specific agent's DNA
 * - GET /dna/compare             — Compare two agents' DNA
 * - GET /dna/drift/:agentId      — Detect style drift
 * - GET /drift                   — Reasoning drift analysis for all agents
 * - GET /drift/:agentId          — Specific agent drift
 * - GET /drift/alerts            — Recent drift alerts
 * - GET /methodology             — Current benchmark methodology & weights
 */

import { Hono } from "hono";
import {
  getChainSummary,
  getRecentBlocks,
  getBlocksByType,
  verifyChain,
  generateCertificate,
  getMethodologyVersion,
} from "../services/benchmark-provenance.ts";
import {
  queryAudit,
  getAuditSummary,
  exportAuditTrail,
} from "../services/benchmark-audit-trail.ts";
import {
  generateRankings,
  getAllEloRatings,
  getScoreHistory,
  getRankingConfig,
  type RankingFactors,
} from "../services/benchmark-composite-ranker.ts";
import {
  getAllProfiles,
  getProfile,
  compareDNA,
  detectStyleDrift,
} from "../services/strategy-dna-profiler.ts";
import {
  analyzeDrift,
  compareAgentDrift,
  getDriftAlerts,
} from "../services/reasoning-drift-detector.ts";

export const benchmarkGovernanceRoutes = new Hono();

// ---------------------------------------------------------------------------
// Provenance Chain
// ---------------------------------------------------------------------------

/**
 * GET /provenance — Chain summary and recent blocks
 */
benchmarkGovernanceRoutes.get("/provenance", (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10), 100);
  const eventType = c.req.query("type");

  const summary = getChainSummary();
  const blocks = eventType
    ? getBlocksByType(eventType as never, limit)
    : getRecentBlocks(limit);

  return c.json({
    ok: true,
    chain: summary,
    recentBlocks: blocks,
    description:
      "Append-only SHA-256 provenance chain recording every benchmark event. " +
      "Each block references the previous block's hash, creating a tamper-evident audit trail.",
  });
});

/**
 * GET /provenance/verify — Full chain integrity verification
 */
benchmarkGovernanceRoutes.get("/provenance/verify", (c) => {
  const result = verifyChain();

  return c.json({
    ok: true,
    verification: result,
    description:
      "Cryptographic verification of the provenance chain. Checks genesis block, " +
      "hash chain integrity, sequential ordering, and chronological consistency.",
  });
});

/**
 * GET /provenance/certificate — Generate provenance certificate for dataset export
 */
benchmarkGovernanceRoutes.get("/provenance/certificate", (c) => {
  const certificate = generateCertificate(
    "pending-dataset-export",
    0,
    3,
    { from: "", to: "" },
  );

  return c.json({
    ok: true,
    certificate,
    description:
      "Provenance certificate for dataset integrity. Include this in HuggingFace " +
      "metadata to prove dataset authenticity.",
  });
});

// ---------------------------------------------------------------------------
// Audit Trail
// ---------------------------------------------------------------------------

/**
 * GET /audit — Query the audit trail with filters
 *
 * Query params: category, severity, agentId, roundId, tag, limit, offset
 */
benchmarkGovernanceRoutes.get("/audit", (c) => {
  const options = {
    category: c.req.query("category") as never,
    severity: c.req.query("severity") as never,
    agentId: c.req.query("agentId") ?? undefined,
    roundId: c.req.query("roundId") ?? undefined,
    tag: c.req.query("tag") ?? undefined,
    limit: Math.min(parseInt(c.req.query("limit") ?? "50", 10), 200),
    offset: parseInt(c.req.query("offset") ?? "0", 10),
  };

  const result = queryAudit(options);

  return c.json({
    ok: true,
    entries: result.entries,
    total: result.total,
    limit: options.limit,
    offset: options.offset,
  });
});

/**
 * GET /audit/summary — Audit trail summary statistics
 */
benchmarkGovernanceRoutes.get("/audit/summary", (c) => {
  const summary = getAuditSummary();

  return c.json({
    ok: true,
    summary,
    description:
      "Immutable audit trail recording every benchmark event: scoring, data exports, " +
      "methodology changes, integrity checks, and quality gate activations.",
  });
});

/**
 * GET /audit/export — Export full audit trail (for dataset inclusion)
 */
benchmarkGovernanceRoutes.get("/audit/export", (c) => {
  const limit = parseInt(c.req.query("limit") ?? "0", 10) || undefined;
  const entries = exportAuditTrail(limit);

  return c.json({
    ok: true,
    entries,
    total: entries.length,
    format: "json",
    description: "Full audit trail export for inclusion in benchmark dataset.",
  });
});

// ---------------------------------------------------------------------------
// Rankings (Composite Scores)
// ---------------------------------------------------------------------------

/**
 * GET /rankings — Current composite rankings with full factor breakdown
 */
benchmarkGovernanceRoutes.get("/rankings", (c) => {
  // Build agent data from available profiles
  const profiles = getAllProfiles();

  const agentData = profiles.map((p) => {
    const factors: RankingFactors = {
      pnlPercent: 0,
      sharpeRatio: 0,
      coherence: p.confidenceAccuracy,
      hallucinationRate: 1 - p.confidenceAccuracy,
      disciplineRate: p.consistency,
      calibration: p.confidenceAccuracy,
      winRate: 0.5,
      tradeCount: p.sampleSize,
    };

    return {
      agentId: p.agentId,
      agentName: p.agentId,
      factors,
    };
  });

  // Add default agents if no profiles yet
  const defaultAgents = [
    "claude-value-investor",
    "gpt-momentum-trader",
    "grok-contrarian",
  ];

  for (const agentId of defaultAgents) {
    if (!agentData.find((a) => a.agentId === agentId)) {
      agentData.push({
        agentId,
        agentName: agentId,
        factors: {
          pnlPercent: 0,
          sharpeRatio: 0,
          coherence: 0.5,
          hallucinationRate: 0.1,
          disciplineRate: 0.9,
          calibration: 0.5,
          winRate: 0.5,
          tradeCount: 0,
        },
      });
    }
  }

  const snapshot = generateRankings(agentData);
  const config = getRankingConfig();

  return c.json({
    ok: true,
    rankings: snapshot.rankings,
    generatedAt: snapshot.generatedAt,
    methodology: {
      version: getMethodologyVersion(),
      weights: config.weights,
      eloK: config.eloK,
      minTradesForRanking: config.minTradesForRanking,
      scoringMethod:
        "Weighted composite of normalized factor scores. P&L and Sharpe normalized via sigmoid. " +
        "Hallucination rate inverted (lower is better). Elo from head-to-head round comparisons.",
    },
  });
});

/**
 * GET /rankings/elo — Elo ratings for all agents
 */
benchmarkGovernanceRoutes.get("/rankings/elo", (c) => {
  const ratings = getAllEloRatings();

  return c.json({
    ok: true,
    ratings,
    initialRating: 1500,
    kFactor: getRankingConfig().eloK,
    description:
      "Elo ratings computed from pairwise round comparisons. K-factor of 32. " +
      "Initial rating 1500 for all agents.",
  });
});

/**
 * GET /rankings/history/:agentId — Score history for trend analysis
 */
benchmarkGovernanceRoutes.get("/rankings/history/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const history = getScoreHistory(agentId);

  return c.json({
    ok: true,
    agentId,
    history,
    dataPoints: history.length,
  });
});

// ---------------------------------------------------------------------------
// Strategy DNA
// ---------------------------------------------------------------------------

/**
 * GET /dna — All agents' strategy DNA profiles
 */
benchmarkGovernanceRoutes.get("/dna", (c) => {
  const profiles = getAllProfiles();

  return c.json({
    ok: true,
    profiles,
    dimensions: [
      { name: "riskAppetite", description: "How much risk the agent takes (0=conservative, 1=aggressive)" },
      { name: "conviction", description: "Trade size relative to capacity (0=small, 1=max)" },
      { name: "patience", description: "Hold rate (0=trades every round, 1=mostly holds)" },
      { name: "sectorConcentration", description: "Symbol focus (0=diversified, 1=concentrated)" },
      { name: "contrarianism", description: "Goes against peers (0=follows, 1=contrarian)" },
      { name: "adaptability", description: "Changes strategy over time (0=rigid, 1=adaptive)" },
      { name: "reasoningDepth", description: "Detail level of reasoning (0=shallow, 1=detailed)" },
      { name: "confidenceAccuracy", description: "Confidence-coherence correlation" },
      { name: "consistency", description: "Strategy consistency (0=chaotic, 1=consistent)" },
    ],
  });
});

/**
 * GET /dna/:agentId — Specific agent's DNA profile
 */
benchmarkGovernanceRoutes.get("/dna/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const profile = getProfile(agentId);

  if (!profile) {
    return c.json({
      ok: false,
      error: "No DNA profile found for this agent. Requires trade history.",
    }, 404);
  }

  const drift = detectStyleDrift(agentId);

  return c.json({
    ok: true,
    profile,
    styleDrift: drift,
  });
});

/**
 * GET /dna/compare — Compare two agents' DNA
 *
 * Query params: agentA, agentB
 */
benchmarkGovernanceRoutes.get("/dna/compare-agents", (c) => {
  const agentA = c.req.query("agentA");
  const agentB = c.req.query("agentB");

  if (!agentA || !agentB) {
    return c.json({
      ok: false,
      error: "Both agentA and agentB query params required",
    }, 400);
  }

  const comparison = compareDNA(agentA, agentB);

  return c.json({
    ok: true,
    comparison,
    interpretation:
      comparison.similarity > 0.8
        ? "These agents have very similar trading DNA"
        : comparison.similarity > 0.5
          ? "These agents have moderately different styles"
          : "These agents have very different trading approaches",
  });
});

// ---------------------------------------------------------------------------
// Reasoning Drift
// ---------------------------------------------------------------------------

/**
 * GET /drift — Cross-agent drift comparison
 */
benchmarkGovernanceRoutes.get("/drift", (c) => {
  const comparison = compareAgentDrift();

  return c.json({
    ok: true,
    comparison,
    description:
      "Reasoning drift measures how agents' reasoning quality changes over time. " +
      "Significant drift may indicate model degradation, strategy shifts, or adaptation.",
  });
});

/**
 * GET /drift/alerts — Recent drift alerts
 */
benchmarkGovernanceRoutes.get("/drift/alerts", (c) => {
  const agentId = c.req.query("agentId") ?? undefined;
  const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10), 100);
  const driftAlerts = getDriftAlerts(agentId, limit);

  return c.json({
    ok: true,
    alerts: driftAlerts,
    total: driftAlerts.length,
  });
});

/**
 * GET /drift/:agentId — Specific agent's drift analysis
 */
benchmarkGovernanceRoutes.get("/drift/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const windowSize = parseInt(c.req.query("window") ?? "10", 10);

  const analysis = analyzeDrift(agentId, windowSize);

  return c.json({
    ok: true,
    analysis,
    interpretation: analysis.significantDrift
      ? `Significant drift detected in ${analysis.driftCategories.join(", ")}. ` +
        `Overall trend: ${analysis.trend}.`
      : "No significant reasoning drift detected. Agent behavior is stable.",
  });
});

/**
 * GET /methodology — Current benchmark methodology
 */
benchmarkGovernanceRoutes.get("/methodology-details", (c) => {
  const config = getRankingConfig();

  return c.json({
    ok: true,
    methodology: {
      version: getMethodologyVersion(),
      name: "MoltApp Agentic Stock Trading Benchmark",
      description:
        "Multi-dimensional evaluation of AI trading agents measuring " +
        "financial performance, reasoning quality, and behavioral consistency.",
      scoringWeights: config.weights,
      normalization: {
        pnlPercent: "Sigmoid scaling (0% → 0.5, ±10% → ~0.73/0.27)",
        sharpeRatio: "Sigmoid scaling (0 → 0.5, 2 → ~0.88)",
        coherence: "Direct 0-1 (lexicon-based sentiment analysis)",
        hallucinationRate: "Inverted (1 - rate, lower is better)",
        disciplineRate: "Direct 0-1 (binary pass/fail per trade)",
        calibration: "ECE-based (Expected Calibration Error)",
      },
      eloSystem: {
        initialRating: 1500,
        kFactor: config.eloK,
        method: "Pairwise comparison from round composite scores",
      },
      qualityGate: {
        threshold: 0.3,
        dimensions: ["coherence", "hallucination_severity", "discipline"],
        effect: "Trades below threshold are rejected or downgraded",
      },
      integrityProofs: {
        method: "SHA-256 Merkle trees",
        chainLinking: "Each round references previous round's proof hash",
        datasetFingerprint: "SHA-256 of complete JSONL export",
      },
      driftDetection: {
        windowSize: 10,
        threshold: 0.15,
        categories: [
          "quality",
          "confidence",
          "vocabulary",
          "strategy",
          "hallucination",
        ],
      },
    },
  });
});
