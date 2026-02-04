/**
 * Unified Benchmark API Routes
 *
 * The canonical API surface for MoltApp's AI trading benchmark.
 * Consolidates all benchmark functionality into a clean, researcher-friendly API.
 *
 * Routes:
 *
 * Core Benchmark:
 *   GET  /gateway/stats           — Benchmark gateway statistics & methodology
 *   GET  /gateway/evaluations     — Browse evaluation history with filters
 *   GET  /gateway/verify/:evalId  — Verify reproducibility of a specific evaluation
 *   GET  /gateway/adversarial/:id — Adversarial report for an agent
 *   GET  /gateway/methodology     — Current and historical methodology versions
 *
 * Leaderboard:
 *   GET  /leaderboard             — Real-time leaderboard with ELO & Glicko-2
 *   GET  /leaderboard/history     — Historical leaderboard snapshots
 *   GET  /leaderboard/agent/:id   — Detailed agent stats & percentile rank
 *
 * External Submissions:
 *   POST /submit                  — Submit a trade decision for scoring
 *   GET  /submit/results/:id      — Get result of a submission
 *   GET  /submit/leaderboard      — External agents leaderboard
 *   GET  /submit/stats            — Submission statistics
 *   GET  /submit/rules            — Submission rules and requirements
 *
 * Dataset Export:
 *   GET  /dataset/jsonl           — Full dataset in JSONL format
 *   GET  /dataset/csv             — Full dataset in CSV format
 *   GET  /dataset/card            — HuggingFace dataset card (README.md)
 *   GET  /dataset/statistics      — Dataset statistics
 *   GET  /dataset/sample          — Sample rows for preview
 */

import { Hono } from "hono";
import {
  getGatewayStats,
  getEvaluations,
  verifyReproducibility,
  getAdversarialReport,
  getMethodologyHistory,
  getCurrentMethodology,
} from "../services/benchmark-gateway.ts";
import {
  getLeaderboard,
  getLeaderboardHistory,
  getAgentLeaderboardDetail,
  registerAgent,
  recordScore,
} from "../services/leaderboard-engine.ts";
import {
  validateAndScoreSubmission,
  getSubmission,
  getExternalLeaderboard,
  getSubmissionStats,
} from "../services/submission-validator.ts";
import {
  exportAsJSONL,
  exportAsCSV,
  generateDatasetCard,
  calculateStatistics,
  generateDataset,
} from "../services/dataset-exporter.ts";
import { getMarketData } from "../agents/orchestrator.ts";

export const benchmarkUnifiedRoutes = new Hono();

// ---------------------------------------------------------------------------
// Gateway Routes
// ---------------------------------------------------------------------------

/**
 * GET /gateway/stats — Comprehensive benchmark statistics
 */
benchmarkUnifiedRoutes.get("/gateway/stats", (c) => {
  const stats = getGatewayStats();
  return c.json({
    ok: true,
    benchmark: "MoltApp: Agentic Stock Trading Benchmark",
    version: "v7",
    website: "https://www.patgpt.us",
    huggingface: "https://huggingface.co/datasets/patruff/molt-benchmark",
    ...stats,
  });
});

/**
 * GET /gateway/evaluations — Browse evaluation history
 */
benchmarkUnifiedRoutes.get("/gateway/evaluations", (c) => {
  const agentId = c.req.query("agent");
  const roundId = c.req.query("round");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10), 200);

  const evaluations = getEvaluations({ agentId, roundId, limit });
  return c.json({
    ok: true,
    evaluations,
    count: evaluations.length,
    filters: { agentId, roundId, limit },
  });
});

/**
 * GET /gateway/verify/:evalId — Verify reproducibility of an evaluation
 */
benchmarkUnifiedRoutes.get("/gateway/verify/:evalId", (c) => {
  const evalId = c.req.param("evalId");
  const result = verifyReproducibility(evalId);
  return c.json({
    ok: true,
    evalId,
    ...result,
    explanation: result.verified
      ? "Evaluation is reproducible — output hash matches recomputation"
      : "Evaluation could not be verified — hash mismatch or not found",
  });
});

/**
 * GET /gateway/adversarial/:agentId — Adversarial report for an agent
 */
benchmarkUnifiedRoutes.get("/gateway/adversarial/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const report = getAdversarialReport(agentId);
  return c.json({ ok: true, ...report });
});

/**
 * GET /gateway/methodology — Current and historical methodology
 */
benchmarkUnifiedRoutes.get("/gateway/methodology", (c) => {
  return c.json({
    ok: true,
    current: getCurrentMethodology(),
    history: getMethodologyHistory(),
    explanation: {
      scoring: "Weighted average of benchmark pillars (coherence, hallucination, discipline, calibration, P&L, Sharpe)",
      grades: "A+ (0.95+) through F (< 0.40), same scale as academic grading",
      reproducibility: "Every evaluation includes deterministic hash proofs for independent verification",
      adversarial: "Multi-layer detection of gaming, templating, confidence manipulation, and collusion",
    },
  });
});

// ---------------------------------------------------------------------------
// Leaderboard Routes
// ---------------------------------------------------------------------------

/**
 * GET /leaderboard — Real-time leaderboard
 */
benchmarkUnifiedRoutes.get("/leaderboard", (c) => {
  const timeWindow = (c.req.query("window") ?? "all") as "all" | "7d" | "24h";
  const includeExternal = c.req.query("external") !== "false";
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10), 100);

  const leaderboard = getLeaderboard({ timeWindow, includeExternal, limit });
  return c.json({
    ok: true,
    ...leaderboard,
  });
});

/**
 * GET /leaderboard/history — Historical leaderboard snapshots
 */
benchmarkUnifiedRoutes.get("/leaderboard/history", (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10), 100);
  const history = getLeaderboardHistory(limit);
  return c.json({ ok: true, snapshots: history, count: history.length });
});

/**
 * GET /leaderboard/agent/:agentId — Agent detail
 */
benchmarkUnifiedRoutes.get("/leaderboard/agent/:agentId", (c) => {
  const agentId = c.req.param("agentId");
  const detail = getAgentLeaderboardDetail(agentId);

  if (!detail.state) {
    return c.json({ ok: false, error: `Agent ${agentId} not found in leaderboard` }, 404);
  }

  return c.json({
    ok: true,
    agentId,
    percentileRank: detail.percentileRank,
    recentScores: detail.recentScores,
    state: {
      elo: detail.state.elo,
      glickoRating: detail.state.glickoRating,
      glickoDeviation: detail.state.glickoDeviation,
      currentComposite: detail.state.currentComposite,
      currentStreak: detail.state.currentStreak,
      bestStreak: detail.state.bestStreak,
      totalTrades: detail.state.compositeScores.length,
    },
  });
});

// ---------------------------------------------------------------------------
// External Submission Routes
// ---------------------------------------------------------------------------

/**
 * POST /submit — Submit a trade decision for benchmark scoring
 */
benchmarkUnifiedRoutes.post("/submit", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  // Fetch current market data for validation
  let marketData: Awaited<ReturnType<typeof getMarketData>>;
  try {
    marketData = await getMarketData();
  } catch {
    marketData = []; // Validation will still work, just no price checks
  }

  const result = validateAndScoreSubmission(body, marketData);

  if (!result.ok) {
    return c.json({
      ok: false,
      submissionId: result.submissionId,
      error: result.error,
      validationErrors: result.validationErrors,
    }, 400);
  }

  // Register the external agent in the leaderboard
  if (result.evaluation) {
    const submission = body as Record<string, unknown>;
    registerAgent({
      agentId: `ext_${String(submission.agentId ?? "unknown")}`,
      agentName: String(submission.agentName ?? "External Agent"),
      model: String(submission.model ?? "unknown"),
      provider: String(submission.provider ?? "external"),
      isExternal: true,
    });

    recordScore({
      agentId: `ext_${String(submission.agentId ?? "unknown")}`,
      compositeScore: result.evaluation.scores.composite,
      coherence: result.evaluation.scores.coherence.score,
      hallucinationDetected: result.evaluation.scores.hallucinations.flags.length > 0,
      disciplinePassed: result.evaluation.scores.discipline.passed,
      calibration: result.evaluation.trade.confidence,
      pnl: 0,
      isWin: result.evaluation.scores.composite > 0.6,
    });
  }

  return c.json({
    ok: true,
    submissionId: result.submissionId,
    evaluation: result.evaluation ? {
      evalId: result.evaluation.evalId,
      compositeScore: result.evaluation.scores.composite,
      grade: result.evaluation.scores.grade,
      coherence: result.evaluation.scores.coherence.score,
      hallucinationFlags: result.evaluation.scores.hallucinations.flags,
      disciplinePassed: result.evaluation.scores.discipline.passed,
      integrityPassed: result.evaluation.integrityPassed,
      proof: result.evaluation.proof,
    } : undefined,
  });
});

/**
 * GET /submit/results/:submissionId — Get submission result
 */
benchmarkUnifiedRoutes.get("/submit/results/:submissionId", (c) => {
  const submissionId = c.req.param("submissionId");
  const submission = getSubmission(submissionId);

  if (!submission) {
    return c.json({ ok: false, error: "Submission not found" }, 404);
  }

  return c.json({
    ok: true,
    submissionId,
    status: submission.status,
    evaluation: submission.evaluation ? {
      compositeScore: submission.evaluation.scores.composite,
      grade: submission.evaluation.scores.grade,
      coherence: submission.evaluation.scores.coherence.score,
      hallucinationFlags: submission.evaluation.scores.hallucinations.flags,
      disciplinePassed: submission.evaluation.scores.discipline.passed,
      proof: submission.evaluation.proof,
    } : undefined,
    rejectionReason: submission.rejectionReason,
    receivedAt: submission.receivedAt,
    scoredAt: submission.scoredAt,
  });
});

/**
 * GET /submit/leaderboard — External agents leaderboard
 */
benchmarkUnifiedRoutes.get("/submit/leaderboard", (c) => {
  const leaderboard = getExternalLeaderboard();
  return c.json({ ok: true, leaderboard, count: leaderboard.length });
});

/**
 * GET /submit/stats — Submission statistics
 */
benchmarkUnifiedRoutes.get("/submit/stats", (c) => {
  const stats = getSubmissionStats();
  return c.json({ ok: true, ...stats });
});

/**
 * GET /submit/rules — Submission rules
 */
benchmarkUnifiedRoutes.get("/submit/rules", (c) => {
  return c.json({
    ok: true,
    rules: {
      apiKey: "Use 'molt-benchmark-open-2026' for the public benchmark",
      rateLimit: "60 submissions per hour per agent",
      requiredFields: {
        submissionId: "Unique client-generated ID (for idempotency)",
        agentId: "Alphanumeric identifier for your agent",
        agentName: "Display name",
        model: "LLM model used (e.g., gpt-4o)",
        provider: "Provider (e.g., openai, anthropic)",
        trade: {
          action: "buy | sell | hold",
          symbol: "Valid xStock symbol (e.g., AAPLx, NVDAx)",
          quantity: "Amount (USDC for buy, shares for sell)",
          reasoning: "Step-by-step reasoning (min 50 chars)",
          confidence: "0.0 to 1.0",
          sources: "Array of data source citations (min 1)",
          intent: "momentum | mean_reversion | value | hedge | contrarian | arbitrage",
        },
      },
      scoring: {
        coherence: "Does your reasoning logically support your action? (20% weight)",
        hallucination: "Do you fabricate prices or facts? (15% weight, lower is better)",
        discipline: "Do you respect position limits? (10% weight)",
        calibration: "Does your confidence predict outcomes? (10% weight)",
        composite: "Weighted average of all pillars",
      },
      exampleSubmission: {
        submissionId: "my-agent-trade-001",
        agentId: "my-smart-agent",
        agentName: "Smart Trading Bot",
        model: "gpt-4o",
        provider: "openai",
        apiKey: "molt-benchmark-open-2026",
        trade: {
          action: "buy",
          symbol: "NVDAx",
          quantity: 500,
          reasoning: "NVIDIA shows strong momentum with 24h price increase of 2.3%. The AI chip demand cycle remains in expansion phase...",
          confidence: 0.75,
          sources: ["market_price_feed", "24h_price_change", "sector_analysis"],
          intent: "momentum",
          predictedOutcome: "Expecting continued upside driven by AI infrastructure spending",
        },
      },
    },
  });
});

// ---------------------------------------------------------------------------
// Dataset Export Routes
// ---------------------------------------------------------------------------

/**
 * GET /dataset/jsonl — Export full dataset as JSONL
 */
benchmarkUnifiedRoutes.get("/dataset/jsonl", (c) => {
  const agentId = c.req.query("agent");
  const limit = parseInt(c.req.query("limit") ?? "10000", 10);

  const jsonl = exportAsJSONL({ limit, agentId });

  c.header("Content-Type", "application/x-jsonlines");
  c.header("Content-Disposition", "attachment; filename=moltapp-benchmark.jsonl");
  return c.body(jsonl);
});

/**
 * GET /dataset/csv — Export full dataset as CSV
 */
benchmarkUnifiedRoutes.get("/dataset/csv", (c) => {
  const agentId = c.req.query("agent");
  const limit = parseInt(c.req.query("limit") ?? "10000", 10);

  const csv = exportAsCSV({ limit, agentId });

  c.header("Content-Type", "text/csv");
  c.header("Content-Disposition", "attachment; filename=moltapp-benchmark.csv");
  return c.body(csv);
});

/**
 * GET /dataset/card — HuggingFace dataset card
 */
benchmarkUnifiedRoutes.get("/dataset/card", (c) => {
  const card = generateDatasetCard();
  c.header("Content-Type", "text/markdown");
  return c.body(card);
});

/**
 * GET /dataset/statistics — Dataset statistics
 */
benchmarkUnifiedRoutes.get("/dataset/statistics", (c) => {
  const stats = calculateStatistics();
  return c.json({ ok: true, ...stats });
});

/**
 * GET /dataset/sample — Sample rows for preview
 */
benchmarkUnifiedRoutes.get("/dataset/sample", (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") ?? "5", 10), 20);
  const rows = generateDataset({ limit });
  return c.json({
    ok: true,
    sample: rows,
    count: rows.length,
    schema: {
      fields: [
        "id", "agentId", "model", "action", "symbol", "reasoning",
        "confidence", "intent", "coherenceScore", "hallucinationCount",
        "compositeScore", "grade", "integrityPassed", "timestamp",
      ],
    },
  });
});
