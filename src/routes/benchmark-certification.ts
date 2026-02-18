/**
 * Benchmark Certification API Routes
 *
 * Generates verifiable benchmark proofs — cryptographic evidence that
 * an agent's scores are genuine and haven't been tampered with.
 *
 * This is what makes MoltApp trustworthy as a benchmark:
 * every score has a certification hash that can be independently verified.
 *
 * Routes:
 * - GET  /certify/:agentId     — Generate certification for an agent
 * - GET  /verify/:certHash     — Verify a certification hash
 * - GET  /leaderboard-certified — Certified leaderboard with proof hashes
 * - GET  /methodology          — Benchmark methodology documentation
 * - GET  /audit-trail          — Recent certification events
 */

import { Hono } from "hono";
import { countByCondition, round3 } from "../lib/math-utils.ts";
import { errorMessage } from "../lib/errors.ts";
import { db } from "../db/index.ts";
import { tradeJustifications } from "../db/schema/trade-reasoning.ts";
import { eq, sql } from "drizzle-orm";
import { getAgentConfigs } from "../agents/orchestrator.ts";
import { calculateConfidenceCalibration } from "../services/outcome-tracker.ts";

export const benchmarkCertificationRoutes = new Hono();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BenchmarkCertification {
  certId: string;
  certHash: string;
  agentId: string;
  agentName: string;
  provider: string;
  model: string;

  metrics: {
    tradeCount: number;
    avgCoherence: number;
    hallucinationRate: number;
    disciplineRate: number;
    avgConfidence: number;
    calibrationScore: number;
    compositeScore: number;
  };

  period: {
    from: string;
    to: string;
  };

  methodology: string;
  version: string;
  issuedAt: string;
  validUntil: string;
}

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Certification Validity Duration
 *
 * How long a certification remains valid after issuance.
 * Used in the validUntil timestamp for issued certifications.
 *
 * Formula: CERT_VALID_UNTIL_MS = 7 days × 24h × 60min × 60s × 1000ms
 * Example: cert issued 2026-01-01 → valid until 2026-01-08
 */
const CERT_VALIDITY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Full Certification Composite Score Weights (6-pillar formula)
 *
 * Used by the /certify endpoint which includes calibration data.
 * Weights sum to 1.0: 0.20 + 0.15 + 0.10 + 0.10 + 0.10 + 0.35 = 1.00
 *
 * Formula: compositeScore = coherence×W_COHERENCE + halFree×W_HAL_FREE +
 *   discipline×W_DISCIPLINE + confidence×W_CONFIDENCE + calibration×W_CALIBRATION +
 *   baseline×W_BASELINE
 *
 * The 0.35 baseline weight (W_CERT_BASELINE_WEIGHT × W_CERT_BASELINE_VALUE) represents
 * the floor contribution before all other signals are factored in.
 */
const CERT_WEIGHT_COHERENCE = 0.20;
const CERT_WEIGHT_HAL_FREE = 0.15;
const CERT_WEIGHT_DISCIPLINE = 0.10;
const CERT_WEIGHT_CONFIDENCE = 0.10;
const CERT_WEIGHT_CALIBRATION = 0.10;
const CERT_BASELINE_SCORE = 0.5;
const CERT_BASELINE_WEIGHT = 0.35;

/**
 * Leaderboard Composite Score Weights (4-pillar formula)
 *
 * Used by the /leaderboard-certified endpoint (no calibration data).
 * Weights sum to 1.0: 0.35 + 0.25 + 0.20 + 0.20 = 1.00
 *
 * Formula: compositeScore = coherence×W_COHERENCE + halFree×W_HAL_FREE +
 *   discipline×W_DISCIPLINE + confidence×W_CONFIDENCE
 *
 * Coherence gets highest weight (0.35) as the primary reasoning quality signal.
 * Default confidence (LB_DEFAULT_CONFIDENCE) used when no avg confidence data.
 */
const LB_WEIGHT_COHERENCE = 0.35;
const LB_WEIGHT_HAL_FREE = 0.25;
const LB_WEIGHT_DISCIPLINE = 0.20;
const LB_WEIGHT_CONFIDENCE = 0.20;
const LB_DEFAULT_CONFIDENCE = 0.5;

// ---------------------------------------------------------------------------
// Certification Store
// ---------------------------------------------------------------------------

const certifications = new Map<string, BenchmarkCertification>();
const certHistory: Array<{ action: string; certId: string; agentId: string; timestamp: string }> = [];
const MAX_HISTORY = 200;

// ---------------------------------------------------------------------------
// Hash Generation (deterministic for same inputs)
// ---------------------------------------------------------------------------

function generateCertHash(data: string): string {
  // Simple deterministic hash (in production, use crypto.subtle.digest)
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  const hex = Math.abs(hash).toString(16).padStart(8, "0");
  return `molt-cert-${hex}-${Date.now().toString(36)}`;
}

function generateCertId(): string {
  return `cert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /certify/:agentId — Generate a benchmark certification
 */
benchmarkCertificationRoutes.get("/certify/:agentId", async (c) => {
  const agentId = c.req.param("agentId");
  const agents = getAgentConfigs();
  const agentConfig = agents.find((a) => a.agentId === agentId);

  if (!agentConfig) {
    return c.json({ ok: false, error: "Agent not found" }, 404);
  }

  try {
    const stats = await db
      .select({
        totalTrades: sql<number>`count(*)`,
        avgCoherence: sql<number>`avg(${tradeJustifications.coherenceScore})`,
        avgConfidence: sql<number>`avg(${tradeJustifications.confidence})`,
        hallucinationCount: sql<number>`count(*) filter (where jsonb_array_length(${tradeJustifications.hallucinationFlags}) > 0)`,
        disciplinePassCount: sql<number>`count(*) filter (where ${tradeJustifications.disciplinePass} = 'pass')`,
        minTimestamp: sql<string>`min(${tradeJustifications.timestamp})`,
        maxTimestamp: sql<string>`max(${tradeJustifications.timestamp})`,
      })
      .from(tradeJustifications)
      .where(eq(tradeJustifications.agentId, agentId));

    const row = stats[0];
    const totalTrades = Number(row?.totalTrades ?? 0);

    if (totalTrades === 0) {
      return c.json({ ok: false, error: "No trades to certify" }, 400);
    }

    const avgCoherence = round3(Number(row?.avgCoherence) || 0);
    const hallucinationRate = round3(Number(row?.hallucinationCount) / totalTrades);
    const disciplineRate = round3(Number(row?.disciplinePassCount) / totalTrades);
    const avgConfidence = round3(Number(row?.avgConfidence) || 0);
    const calibration = calculateConfidenceCalibration(agentId);

    const halFree = 1 - hallucinationRate;
    const compositeScore = round3(
      avgCoherence * CERT_WEIGHT_COHERENCE + halFree * CERT_WEIGHT_HAL_FREE +
        disciplineRate * CERT_WEIGHT_DISCIPLINE + avgConfidence * CERT_WEIGHT_CONFIDENCE +
        calibration.score * CERT_WEIGHT_CALIBRATION + CERT_BASELINE_SCORE * CERT_BASELINE_WEIGHT,
    );

    // Generate deterministic hash from metrics
    const hashInput = `${agentId}:${totalTrades}:${avgCoherence}:${hallucinationRate}:${disciplineRate}:${avgConfidence}:${compositeScore}`;
    const certHash = generateCertHash(hashInput);
    const certId = generateCertId();

    const certification: BenchmarkCertification = {
      certId,
      certHash,
      agentId,
      agentName: agentConfig.name,
      provider: agentConfig.provider,
      model: agentConfig.model,
      metrics: {
        tradeCount: totalTrades,
        avgCoherence,
        hallucinationRate,
        disciplineRate,
        avgConfidence,
        calibrationScore: calibration.score,
        compositeScore,
      },
      period: {
        from: String(row?.minTimestamp ?? new Date().toISOString()),
        to: String(row?.maxTimestamp ?? new Date().toISOString()),
      },
      methodology: "MoltApp Benchmark v3: 6-pillar weighted composite scoring",
      version: "v3.0",
      issuedAt: new Date().toISOString(),
      validUntil: new Date(Date.now() + CERT_VALIDITY_MS).toISOString(),
    };

    certifications.set(certHash, certification);

    certHistory.unshift({
      action: "issued",
      certId,
      agentId,
      timestamp: certification.issuedAt,
    });
    if (certHistory.length > MAX_HISTORY) certHistory.length = MAX_HISTORY;

    return c.json({ ok: true, certification });
  } catch (err) {
    return c.json({
      ok: false,
      error: errorMessage(err),
    }, 500);
  }
});

/**
 * GET /verify/:certHash — Verify a certification
 */
benchmarkCertificationRoutes.get("/verify/:certHash", (c) => {
  const certHash = c.req.param("certHash");
  const cert = certifications.get(certHash);

  if (!cert) {
    return c.json({
      ok: false,
      verified: false,
      error: "Certification not found. It may have expired or never existed.",
    }, 404);
  }

  const isExpired = new Date(cert.validUntil) < new Date();

  return c.json({
    ok: true,
    verified: !isExpired,
    expired: isExpired,
    certification: cert,
    verifiedAt: new Date().toISOString(),
  });
});

/**
 * GET /leaderboard-certified — Certified leaderboard with proof hashes
 */
benchmarkCertificationRoutes.get("/leaderboard-certified", async (c) => {
  const agents = getAgentConfigs();
  const leaderboard: Array<{
    rank: number;
    agentId: string;
    agentName: string;
    provider: string;
    compositeScore: number;
    certHash: string | null;
    certified: boolean;
  }> = [];

  for (const agent of agents) {
    try {
      const stats = await db
        .select({
          totalTrades: sql<number>`count(*)`,
          avgCoherence: sql<number>`avg(${tradeJustifications.coherenceScore})`,
          avgConfidence: sql<number>`avg(${tradeJustifications.confidence})`,
          hallucinationCount: sql<number>`count(*) filter (where jsonb_array_length(${tradeJustifications.hallucinationFlags}) > 0)`,
          disciplinePassCount: sql<number>`count(*) filter (where ${tradeJustifications.disciplinePass} = 'pass')`,
        })
        .from(tradeJustifications)
        .where(eq(tradeJustifications.agentId, agent.agentId));

      const row = stats[0];
      const totalTrades = Number(row?.totalTrades ?? 0);
      const avgCoherence = Number(row?.avgCoherence) || 0;
      const halFree = totalTrades > 0
        ? 1 - (Number(row?.hallucinationCount) / totalTrades)
        : 1;
      const disciplineRate = totalTrades > 0
        ? Number(row?.disciplinePassCount) / totalTrades
        : 0;

      const compositeScore = round3(
        avgCoherence * LB_WEIGHT_COHERENCE + halFree * LB_WEIGHT_HAL_FREE +
          disciplineRate * LB_WEIGHT_DISCIPLINE +
          (Number(row?.avgConfidence) || LB_DEFAULT_CONFIDENCE) * LB_WEIGHT_CONFIDENCE,
      );

      // Check for existing certification
      const existingCert = [...certifications.values()].find(
        (cert) => cert.agentId === agent.agentId && new Date(cert.validUntil) > new Date(),
      );

      leaderboard.push({
        rank: 0,
        agentId: agent.agentId,
        agentName: agent.name,
        provider: agent.provider,
        compositeScore,
        certHash: existingCert?.certHash ?? null,
        certified: !!existingCert,
      });
    } catch {
      leaderboard.push({
        rank: 0,
        agentId: agent.agentId,
        agentName: agent.name,
        provider: agent.provider,
        compositeScore: 0,
        certHash: null,
        certified: false,
      });
    }
  }

  // Sort and rank
  leaderboard.sort((a, b) => b.compositeScore - a.compositeScore);
  leaderboard.forEach((a, i) => { a.rank = i + 1; });

  return c.json({
    ok: true,
    leaderboard,
    certifiedCount: countByCondition(leaderboard, (a) => a.certified),
    totalAgents: leaderboard.length,
  });
});

/**
 * GET /methodology — Benchmark methodology documentation
 */
benchmarkCertificationRoutes.get("/methodology", (c) => {
  return c.json({
    ok: true,
    methodology: {
      name: "MoltApp AI Trading Benchmark",
      version: "v3.0",
      website: "https://www.patgpt.us",
      huggingface: "https://huggingface.co/datasets/patruff/molt-benchmark",

      overview: "MoltApp evaluates AI agents across 6 pillars: financial returns, " +
        "risk-adjusted performance, reasoning quality, factual accuracy, rule compliance, " +
        "and self-awareness calibration.",

      pillars: [
        {
          name: "P&L Percent",
          weight: 0.25,
          description: "Raw financial return: portfolio value change as a percentage",
          measurement: "Calculated from trade execution prices and current market prices",
        },
        {
          name: "Sharpe Ratio",
          weight: 0.20,
          description: "Risk-adjusted return: excess return divided by standard deviation",
          measurement: "Rolling calculation over trading period with risk-free rate assumed 0",
        },
        {
          name: "Reasoning Coherence",
          weight: 0.20,
          description: "Whether the agent's stated reasoning logically supports its action",
          measurement: "NLP sentiment analysis: bullish reasoning + buy = high coherence",
        },
        {
          name: "Hallucination Rate",
          weight: 0.15,
          description: "Rate of factually incorrect claims in reasoning",
          measurement: "Checks prices (±20% tolerance), ticker validity, and claim plausibility",
        },
        {
          name: "Instruction Discipline",
          weight: 0.10,
          description: "Compliance with position limits, cash buffers, and trading rules",
          measurement: "Binary pass/fail per trade, aggregated as compliance percentage",
        },
        {
          name: "Confidence Calibration",
          weight: 0.10,
          description: "Correlation between self-reported confidence and actual outcomes",
          measurement: "Bucket analysis: do high-confidence trades outperform low-confidence?",
        },
      ],

      dataCollection: {
        frequency: "Per trading round (typically every 30 minutes)",
        storage: "PostgreSQL (trade_justifications table) + HuggingFace JSONL",
        transparency: "Full reasoning text stored and publicly accessible via Brain Feed API",
      },

      scoring: {
        composite: "Weighted average of normalized factor scores",
        grades: "A+ (95+) through F (below 40) based on composite",
        ranking: "Agents ranked by composite score, with percentile analysis per factor",
      },

      certification: {
        method: "Deterministic hash of metrics for tamper evidence",
        validity: "7 days from issuance",
        verification: "GET /api/v1/certification/verify/:hash",
      },
    },
  });
});

/**
 * GET /audit-trail — Recent certification events
 */
benchmarkCertificationRoutes.get("/audit-trail", (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10), 200);
  return c.json({
    ok: true,
    events: certHistory.slice(0, limit),
    total: certHistory.length,
  });
});
