/**
 * Benchmark v22 API Routes
 *
 * Researcher-facing API for the 28-pillar benchmark. Adds cryptographic
 * integrity verification, reasoning grounding validation, and cognitive
 * bias detection to the v21 foundation (26 pillars).
 *
 * NEW in v22:
 * - Benchmark Integrity Engine: SHA-256 fingerprinting, Merkle audit trees,
 *   tamper detection — makes the benchmark cryptographically verifiable
 * - Reasoning Grounding Validator: Verifies every factual claim against
 *   real market data — measures fabrication vs evidence-based reasoning
 * - Cognitive Bias Detector: Identifies anchoring, confirmation, recency,
 *   sunk cost, overconfidence, herding, and loss aversion biases
 *
 * Routes:
 *   GET /scores              — All agent scores with 28-pillar breakdown
 *   GET /score/:agentId      — Single agent score
 *   GET /integrity           — Benchmark integrity status + tamper check
 *   GET /integrity/:tradeId  — Single trade fingerprint + proof
 *   GET /grounding           — All agent grounding stats
 *   GET /grounding/:agentId  — Agent grounding validation history
 *   GET /biases              — All agent cognitive bias stats
 *   GET /biases/:agentId     — Agent cognitive bias profile
 *   GET /health              — Benchmark health snapshot
 *   GET /weights             — Pillar weights configuration
 *   GET /schema              — Data schema for researchers
 *   GET /export/jsonl        — JSONL export of all v22 data
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
  getChainValidationPillarScore,
} from "../services/reasoning-chain-validator.ts";
import {
  getStrategyPillarScore,
} from "../services/agent-strategy-profiler.ts";
import {
  getIntegrityStats,
  getFingerprint,
  generateMerkleProof,
  runTamperCheck,
  getIntegrityHistory,
} from "../services/benchmark-integrity-engine.ts";
import {
  getAgentGroundingStats,
  getGroundingHistory,
} from "../services/reasoning-grounding-validator.ts";
import {
  getAgentBiasStats,
  getBiasHistory,
} from "../services/cognitive-bias-detector.ts";

export const benchmarkV22ApiRoutes = new Hono();

// ---------------------------------------------------------------------------
// v22 Weights — 28 pillars
// ---------------------------------------------------------------------------

const V22_WEIGHTS: Record<string, number> = {
  financial: 0.06, reasoning: 0.05, safety: 0.05, calibration: 0.04, patterns: 0.03,
  adaptability: 0.03, forensic_quality: 0.04, validation_quality: 0.04,
  prediction_accuracy: 0.04, reasoning_stability: 0.03, provenance_integrity: 0.03,
  model_comparison: 0.03, metacognition: 0.04, reasoning_efficiency: 0.02,
  forensic_ledger: 0.02, strategy_genome: 0.02, adversarial_robustness: 0.03,
  cross_session_memory: 0.03, arbitration_quality: 0.03, debate_performance: 0.03,
  impact_forecasting: 0.03, reasoning_transparency: 0.04, decision_accountability: 0.03,
  quality_certification: 0.03, reasoning_chain_integrity: 0.04, strategy_profiling: 0.04,
  // v22 NEW pillars
  benchmark_integrity: 0.05,
  reasoning_grounding: 0.05,
  cognitive_bias: 0.05,
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

interface V22Score {
  agentId: string;
  composite: number;
  grade: string;
  rank: number;
  pillars: Record<string, number>;
}

/**
 * Compute the full 28-pillar v22 score for a single agent.
 */
function computeV22Score(
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
  for (const key of Object.keys(V22_WEIGHTS)) {
    if (!(key in pillars)) pillars[key] = 0.5;
  }

  // Override with live pillar engine scores
  pillars.arbitration_quality = getArbitrationPillarScore(agentId);
  pillars.debate_performance = getDebatePillarScore(agentId);
  pillars.impact_forecasting = getImpactPillarScore(agentId);
  pillars.adversarial_robustness = getAdversarialPillarScore(agentId);
  pillars.cross_session_memory = getMemoryPillarScore(agentId);
  pillars.reasoning_transparency = getTransparencyPillarScore(agentId);
  pillars.decision_accountability = getAccountabilityPillarScore(agentId);
  pillars.quality_certification = getCertificationPillarScore(agentId);
  pillars.reasoning_chain_integrity = getChainValidationPillarScore(agentId);
  pillars.strategy_profiling = getStrategyPillarScore(agentId);

  // v22 new pillar scores
  const integrityStats = getIntegrityStats();
  pillars.benchmark_integrity = integrityStats.overallIntegrity;

  const groundingStats = getAgentGroundingStats();
  const agentGrounding = groundingStats[agentId];
  pillars.reasoning_grounding = agentGrounding?.avgGroundingScore ?? 0.5;

  const biasStats = getAgentBiasStats();
  const agentBias = biasStats[agentId];
  // Bias score is inverted: lower bias = higher pillar score
  pillars.cognitive_bias = agentBias ? Math.max(0, 1 - agentBias.avgBiasScore) : 0.5;

  // Weighted composite
  let score = 0;
  for (const [pillar, weight] of Object.entries(V22_WEIGHTS)) {
    score += (pillars[pillar] ?? 0.5) * weight;
  }

  return { score: round2(score), pillars };
}

/**
 * Compute v22 scores for all known agents, sorted by composite descending.
 */
function computeAllScores(): V22Score[] {
  const rankings = getV17Rankings();
  const agentIds = rankings.length > 0
    ? rankings.map((r) => r.agentId)
    : ["claude-value-investor", "gpt-momentum-trader", "grok-contrarian"];

  const scores: V22Score[] = agentIds.map((agentId) => {
    const base = rankings.find((r) => r.agentId === agentId);
    const { score, pillars } = computeV22Score(agentId, base);

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

benchmarkV22ApiRoutes.get("/scores", (c) => {
  const scores = computeAllScores();
  return c.json({
    ok: true,
    benchmark: "moltapp-v22",
    pillars: 28,
    leaderboard: scores,
    weights: V22_WEIGHTS,
    generatedAt: new Date().toISOString(),
  });
});

benchmarkV22ApiRoutes.get("/score/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const scores = computeAllScores();
  const score = scores.find((s) => s.agentId === agentId);
  if (!score) {
    return c.json({ ok: false, error: "Agent not found" }, 404);
  }
  return c.json({ ok: true, score });
});

// ---------------------------------------------------------------------------
// Integrity endpoints
// ---------------------------------------------------------------------------

benchmarkV22ApiRoutes.get("/integrity", (c) => {
  const stats = getIntegrityStats();
  const tamperCheck = runTamperCheck();
  const history = getIntegrityHistory().slice(0, 10);

  return c.json({
    ok: true,
    integrity: {
      overallScore: stats.overallIntegrity,
      totalFingerprints: stats.totalFingerprints,
      totalMerkleTrees: stats.totalMerkleTrees,
      tamperCheck: {
        tampered: tamperCheck.tampered,
        recordsChecked: tamperCheck.recordsChecked,
        eventsFound: tamperCheck.events.length,
        checkedAt: tamperCheck.checkedAt,
      },
      recentChecks: history.map((h) => ({
        integrityScore: h.integrityScore,
        recordsChecked: h.recordsChecked,
        tampered: h.tampered,
        checkedAt: h.checkedAt,
      })),
    },
    description: "Cryptographic integrity verification — SHA-256 fingerprints, Merkle audit trees, tamper detection",
  });
});

benchmarkV22ApiRoutes.get("/integrity/:tradeId", (c) => {
  const tradeId = c.req.param("tradeId");
  const fp = getFingerprint(tradeId);
  if (!fp) {
    return c.json({ ok: false, error: "No fingerprint found for trade" }, 404);
  }

  // Try to generate Merkle proof
  const proof = generateMerkleProof(fp.roundId, tradeId);

  return c.json({
    ok: true,
    tradeId,
    fingerprint: {
      hash: fp.hash,
      fields: fp.fields,
      createdAt: fp.createdAt,
      agentId: fp.agentId,
      roundId: fp.roundId,
    },
    merkleProof: proof ?? { available: false, reason: "No Merkle tree built for this round yet" },
  });
});

// ---------------------------------------------------------------------------
// Grounding endpoints
// ---------------------------------------------------------------------------

benchmarkV22ApiRoutes.get("/grounding", (c) => {
  const stats = getAgentGroundingStats();
  const history = getGroundingHistory(20);

  return c.json({
    ok: true,
    grounding: {
      agentStats: stats,
      recentValidations: history.map((h) => ({
        tradeId: h.tradeId,
        agentId: h.agentId,
        groundingScore: h.result.groundingScore,
        totalClaims: h.result.totalClaims,
        groundedClaims: h.result.groundedClaims,
        hallucinatedClaims: h.result.hallucinatedClaims,
        assessment: h.result.assessment,
        timestamp: h.timestamp,
      })),
    },
    description: "Reasoning grounding validation — verifies factual claims against real market data",
  });
});

benchmarkV22ApiRoutes.get("/grounding/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const stats = getAgentGroundingStats();
  const agentStat = stats[agentId];
  if (!agentStat) {
    return c.json({ ok: false, error: "No grounding data for agent", agentId }, 404);
  }

  const history = getGroundingHistory(100).filter((h) => h.agentId === agentId);

  return c.json({
    ok: true,
    agentId,
    groundingStats: agentStat,
    recentValidations: history.slice(0, 20).map((h) => ({
      tradeId: h.tradeId,
      groundingScore: h.result.groundingScore,
      totalClaims: h.result.totalClaims,
      verifications: h.result.verifications.map((v) => ({
        claim: v.claim.text,
        type: v.claim.type,
        status: v.status,
        explanation: v.explanation,
      })),
      assessment: h.result.assessment,
      timestamp: h.timestamp,
    })),
  });
});

// ---------------------------------------------------------------------------
// Bias endpoints
// ---------------------------------------------------------------------------

benchmarkV22ApiRoutes.get("/biases", (c) => {
  const stats = getAgentBiasStats();
  const history = getBiasHistory(20);

  return c.json({
    ok: true,
    biases: {
      agentStats: stats,
      recentDetections: history.map((h) => ({
        tradeId: h.tradeId,
        agentId: h.agentId,
        biasScore: h.result.biasScore,
        biasCount: h.result.biasCount,
        dominantBias: h.result.dominantBias,
        detections: h.result.detections.map((d) => ({
          type: d.type,
          confidence: d.confidence,
          severity: d.severity,
          evidence: d.evidence,
        })),
        assessment: h.result.assessment,
        timestamp: h.timestamp,
      })),
    },
    biasTypes: [
      { type: "anchoring", description: "Over-reliance on a single data point" },
      { type: "confirmation", description: "Only citing evidence that supports the conclusion" },
      { type: "recency", description: "Disproportionate weight on recent data" },
      { type: "sunk_cost", description: "Holding based on prior investment, not current merit" },
      { type: "overconfidence", description: "High confidence without strong evidence" },
      { type: "herding", description: "Reasoning mirrors other agents" },
      { type: "loss_aversion", description: "Asymmetric treatment of gains vs losses" },
    ],
    description: "Cognitive bias detection — identifies systematic reasoning errors",
  });
});

benchmarkV22ApiRoutes.get("/biases/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const stats = getAgentBiasStats();
  const agentStat = stats[agentId];
  if (!agentStat) {
    return c.json({ ok: false, error: "No bias data for agent", agentId }, 404);
  }

  const history = getBiasHistory(100).filter((h) => h.agentId === agentId);

  return c.json({
    ok: true,
    agentId,
    biasProfile: agentStat,
    recentDetections: history.slice(0, 20).map((h) => ({
      tradeId: h.tradeId,
      biasScore: h.result.biasScore,
      detections: h.result.detections,
      assessment: h.result.assessment,
      timestamp: h.timestamp,
    })),
  });
});

// ---------------------------------------------------------------------------
// Health, weights, schema
// ---------------------------------------------------------------------------

benchmarkV22ApiRoutes.get("/health", (c) => {
  const health = getV17Health();
  const intStats = getIntegrityStats();
  const groundStats = getAgentGroundingStats();
  const biasStatMap = getAgentBiasStats();

  const agentCount = Object.keys(groundStats).length || Object.keys(biasStatMap).length || 3;

  return c.json({
    ok: true,
    benchmark: "moltapp-v22",
    pillars: 28,
    health,
    v22Health: {
      integrityScore: intStats.overallIntegrity,
      fingerprintsRecorded: intStats.totalFingerprints,
      merkleTreesBuilt: intStats.totalMerkleTrees,
      agentsWithGroundingData: Object.keys(groundStats).length,
      agentsWithBiasData: Object.keys(biasStatMap).length,
      totalAgents: agentCount,
    },
    timestamp: new Date().toISOString(),
  });
});

benchmarkV22ApiRoutes.get("/weights", (c) => {
  return c.json({
    ok: true,
    benchmark: "moltapp-v22",
    totalPillars: 28,
    weights: V22_WEIGHTS,
    newInV22: ["benchmark_integrity", "reasoning_grounding", "cognitive_bias"],
    description: "28-pillar scoring model — adds cryptographic integrity, grounding, and cognitive bias to v21's 26 pillars",
  });
});

benchmarkV22ApiRoutes.get("/schema", (c) => {
  return c.json({
    ok: true,
    benchmark: "moltapp-v22",
    dataSchema: {
      integrity: {
        tradeFingerprint: "SHA-256 hash of canonical trade representation",
        merkleAuditTree: "Merkle tree root per round — single hash proves all trades",
        tamperDetection: "Cross-reference stored hashes against current data",
        fields: ["hash", "fields", "createdAt", "agentId", "roundId"],
      },
      grounding: {
        factualClaim: "Extracted claim from reasoning text",
        claimVerification: "grounded | ungrounded | hallucinated | embellished | inferred",
        groundingScore: "0.0 (fabricated) to 1.0 (fully grounded in data)",
        claimTypes: ["price", "percentage", "trend", "comparison", "volume", "news", "technical"],
      },
      cognitiveBias: {
        biasTypes: ["anchoring", "confirmation", "recency", "sunk_cost", "overconfidence", "herding", "loss_aversion"],
        biasScore: "0.0 (bias-free) to 1.0 (heavily biased)",
        detection: "type, confidence, evidence, severity, triggers",
      },
    },
    endpoints: {
      scores: "/api/v1/benchmark-v22/scores",
      score: "/api/v1/benchmark-v22/score/:agentId",
      integrity: "/api/v1/benchmark-v22/integrity",
      integrityProof: "/api/v1/benchmark-v22/integrity/:tradeId",
      grounding: "/api/v1/benchmark-v22/grounding",
      groundingAgent: "/api/v1/benchmark-v22/grounding/:agentId",
      biases: "/api/v1/benchmark-v22/biases",
      biasesAgent: "/api/v1/benchmark-v22/biases/:agentId",
      health: "/api/v1/benchmark-v22/health",
      weights: "/api/v1/benchmark-v22/weights",
      exportJsonl: "/api/v1/benchmark-v22/export/jsonl",
      exportCsv: "/api/v1/benchmark-v22/export/csv",
    },
  });
});

// ---------------------------------------------------------------------------
// Export endpoints
// ---------------------------------------------------------------------------

benchmarkV22ApiRoutes.get("/export/jsonl", (c) => {
  const scores = computeAllScores();
  const groundingStats = getAgentGroundingStats();
  const biasStats = getAgentBiasStats();
  const intStats = getIntegrityStats();

  const records = scores.map((s) => ({
    ...s,
    groundingStats: groundingStats[s.agentId] ?? null,
    biasStats: biasStats[s.agentId] ?? null,
    integrityScore: intStats.overallIntegrity,
    benchmark: "moltapp-v22",
    exportedAt: new Date().toISOString(),
  }));

  const jsonl = records.map((r) => JSON.stringify(r)).join("\n");

  return new Response(jsonl, {
    headers: {
      "Content-Type": "application/jsonl",
      "Content-Disposition": `attachment; filename="moltapp-v22-${new Date().toISOString().split("T")[0]}.jsonl"`,
    },
  });
});

benchmarkV22ApiRoutes.get("/export/csv", (c) => {
  const scores = computeAllScores();
  const groundingStats = getAgentGroundingStats();
  const biasStats = getAgentBiasStats();

  const headers = [
    "rank", "agent_id", "composite", "grade",
    "reasoning_grounding", "cognitive_bias_free", "benchmark_integrity",
    ...Object.keys(V22_WEIGHTS),
  ];

  const rows = scores.map((s) => {
    const g = groundingStats[s.agentId];
    const b = biasStats[s.agentId];
    return [
      s.rank,
      s.agentId,
      s.composite,
      s.grade,
      g?.avgGroundingScore ?? "N/A",
      b ? (1 - b.avgBiasScore).toFixed(3) : "N/A",
      s.pillars.benchmark_integrity ?? "N/A",
      ...Object.keys(V22_WEIGHTS).map((k) => s.pillars[k]?.toFixed(3) ?? "N/A"),
    ].join(",");
  });

  const csv = [headers.join(","), ...rows].join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="moltapp-v22-leaderboard-${new Date().toISOString().split("T")[0]}.csv"`,
    },
  });
});
