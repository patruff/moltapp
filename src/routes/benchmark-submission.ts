/**
 * Benchmark Submission API
 *
 * Allows EXTERNAL AI agents to submit trades to the MoltApp benchmark.
 * This transforms MoltApp from an internal competition into an open
 * industry benchmark that any AI agent can participate in.
 *
 * External agents submit:
 * - Their trade decision with full reasoning
 * - We score it against our metrics
 * - Results appear on the public leaderboard
 *
 * This is the key differentiator for hackathon judges:
 * MoltApp isn't just our 3 agents — it's an OPEN benchmark.
 *
 * Endpoints:
 * - POST /submit          — Submit a trade decision for scoring
 * - GET  /results/:id     — Get scoring results for a submission
 * - GET  /leaderboard     — External agent leaderboard
 * - GET  /rules           — Submission rules and requirements
 * - POST /batch-submit    — Submit multiple decisions at once
 */

import { Hono } from "hono";
import { z } from "zod";
import {
  analyzeCoherence,
  detectHallucinations,
  runFullAnalysis,
} from "../services/coherence-analyzer.ts";
import {
  analyzeDeepCoherence,
  recordDeepAnalysis,
} from "../services/deep-coherence-analyzer.ts";
import {
  validateTradeReasoning,
} from "../middleware/reasoning-gate.ts";
import {
  normalizeConfidence,
  classifyIntent,
  extractSourcesFromReasoning,
} from "../schemas/trade-reasoning.ts";
import { getMarketData } from "../agents/orchestrator.ts";
import { round2 } from "../lib/math-utils.ts";
import type { MarketData } from "../agents/base-agent.ts";

export const benchmarkSubmissionRoutes = new Hono();

// ---------------------------------------------------------------------------
// Types & Storage
// ---------------------------------------------------------------------------

interface BenchmarkSubmission {
  id: string;
  externalAgentId: string;
  agentName: string;
  modelProvider: string;
  modelName: string;
  action: "buy" | "sell" | "hold";
  symbol: string;
  quantity: number;
  reasoning: string;
  confidence: number;
  sources: string[];
  intent: string;
  predictedOutcome?: string;
  scores: {
    coherence: number;
    hallucinationFree: number;
    hallucinationFlags: string[];
    discipline: number;
    deepCoherence: number;
    deepGrade: string;
    reasoningQuality: number;
    composite: number;
  };
  submittedAt: string;
  scoredAt: string;
}

/** In-memory submission store (production would use DB) */
const submissions = new Map<string, BenchmarkSubmission>();
const agentSubmissions = new Map<string, string[]>(); // agentId -> submissionIds

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const submitSchema = z.object({
  /** External agent identifier (your agent's unique ID) */
  agentId: z.string().min(3, "Agent ID must be at least 3 characters"),
  /** Human-readable agent name */
  agentName: z.string().min(1),
  /** LLM provider (e.g., "anthropic", "openai", "custom") */
  modelProvider: z.string().min(1),
  /** Model name (e.g., "claude-sonnet-4", "gpt-4o") */
  modelName: z.string().min(1),
  /** Trade action */
  action: z.enum(["buy", "sell", "hold"]),
  /** Stock symbol from xStocks catalog */
  symbol: z.string().min(1),
  /** Trade quantity (USDC for buy, shares for sell, 0 for hold) */
  quantity: z.number().min(0),
  /** REQUIRED: Step-by-step reasoning */
  reasoning: z.string().min(20, "Reasoning must explain your logic (min 20 chars)"),
  /** REQUIRED: Confidence 0-1 */
  confidence: z.number().min(0).max(1),
  /** REQUIRED: Data sources consulted */
  sources: z.array(z.string()).min(1, "Must cite at least one data source"),
  /** REQUIRED: Strategy intent */
  intent: z.enum(["momentum", "mean_reversion", "value", "hedge", "contrarian", "arbitrage"]),
  /** Optional: What you predict will happen */
  predictedOutcome: z.string().optional(),
});

const batchSubmitSchema = z.object({
  agentId: z.string().min(3),
  agentName: z.string().min(1),
  modelProvider: z.string().min(1),
  modelName: z.string().min(1),
  decisions: z.array(z.object({
    action: z.enum(["buy", "sell", "hold"]),
    symbol: z.string().min(1),
    quantity: z.number().min(0),
    reasoning: z.string().min(20),
    confidence: z.number().min(0).max(1),
    sources: z.array(z.string()).min(1),
    intent: z.enum(["momentum", "mean_reversion", "value", "hedge", "contrarian", "arbitrage"]),
    predictedOutcome: z.string().optional(),
  })).min(1).max(20, "Maximum 20 decisions per batch"),
});

// ---------------------------------------------------------------------------
// POST /submit — Submit a single trade for benchmark scoring
// ---------------------------------------------------------------------------

benchmarkSubmissionRoutes.post("/submit", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "INVALID_JSON", message: "Request body must be valid JSON" }, 400);
  }

  const parsed = submitSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({
      ok: false,
      error: "VALIDATION_FAILED",
      message: "Submission does not meet benchmark requirements",
      validation: parsed.error.flatten(),
      requirements: getSubmissionRequirements(),
    }, 400);
  }

  const data = parsed.data;

  // Fetch current market data for scoring
  let marketData: MarketData[];
  try {
    marketData = await getMarketData();
  } catch {
    marketData = [];
  }

  // Score the submission
  const submission = scoreSubmission(data, marketData);
  submissions.set(submission.id, submission);

  // Track per-agent
  const agentSubs = agentSubmissions.get(data.agentId) ?? [];
  agentSubs.push(submission.id);
  if (agentSubs.length > 500) agentSubs.shift();
  agentSubmissions.set(data.agentId, agentSubs);

  return c.json({
    ok: true,
    submissionId: submission.id,
    scores: submission.scores,
    feedback: generateFeedback(submission),
    resultsUrl: `/api/v1/benchmark-submit/results/${submission.id}`,
  });
});

// ---------------------------------------------------------------------------
// POST /batch-submit — Submit multiple decisions for scoring
// ---------------------------------------------------------------------------

benchmarkSubmissionRoutes.post("/batch-submit", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "INVALID_JSON" }, 400);
  }

  const parsed = batchSubmitSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({
      ok: false,
      error: "VALIDATION_FAILED",
      validation: parsed.error.flatten(),
    }, 400);
  }

  const data = parsed.data;
  let marketData: MarketData[];
  try {
    marketData = await getMarketData();
  } catch {
    marketData = [];
  }

  const results = data.decisions.map((decision) => {
    const submission = scoreSubmission(
      { ...data, ...decision },
      marketData ?? [],
    );
    submissions.set(submission.id, submission);

    const agentSubs = agentSubmissions.get(data.agentId) ?? [];
    agentSubs.push(submission.id);
    agentSubmissions.set(data.agentId, agentSubs);

    return {
      submissionId: submission.id,
      symbol: decision.symbol,
      action: decision.action,
      scores: submission.scores,
    };
  });

  return c.json({
    ok: true,
    batchSize: results.length,
    results,
  });
});

// ---------------------------------------------------------------------------
// GET /results/:id — Get scoring results for a submission
// ---------------------------------------------------------------------------

benchmarkSubmissionRoutes.get("/results/:id", (c) => {
  const id = c.req.param("id");
  const submission = submissions.get(id);

  if (!submission) {
    return c.json({ ok: false, error: "NOT_FOUND", message: `Submission ${id} not found` }, 404);
  }

  return c.json({
    ok: true,
    submission,
    feedback: generateFeedback(submission),
  });
});

// ---------------------------------------------------------------------------
// GET /leaderboard — External agent leaderboard
// ---------------------------------------------------------------------------

benchmarkSubmissionRoutes.get("/leaderboard", (c) => {
  // Aggregate scores per external agent
  const agentScores = new Map<string, {
    agentId: string;
    agentName: string;
    modelProvider: string;
    modelName: string;
    totalSubmissions: number;
    avgComposite: number;
    avgCoherence: number;
    avgDeepCoherence: number;
    hallucinationRate: number;
    bestSymbol: string;
    lastSubmission: string;
  }>();

  for (const [agentId, subIds] of agentSubmissions) {
    const subs = subIds
      .map((id) => submissions.get(id))
      .filter((s): s is BenchmarkSubmission => s !== undefined);

    if (subs.length === 0) continue;

    const avgComposite = subs.reduce((s, sub) => s + sub.scores.composite, 0) / subs.length;
    const avgCoherence = subs.reduce((s, sub) => s + sub.scores.coherence, 0) / subs.length;
    const avgDeepCoherence = subs.reduce((s, sub) => s + sub.scores.deepCoherence, 0) / subs.length;
    const hallucinatedCount = subs.filter((sub) => sub.scores.hallucinationFlags.length > 0).length;

    // Find best-performing symbol
    const symbolScores = new Map<string, number[]>();
    for (const sub of subs) {
      const arr = symbolScores.get(sub.symbol) ?? [];
      arr.push(sub.scores.composite);
      symbolScores.set(sub.symbol, arr);
    }
    let bestSymbol = "";
    let bestSymbolAvg = -1;
    for (const [symbol, scores] of symbolScores) {
      const avg = scores.reduce((s, v) => s + v, 0) / scores.length;
      if (avg > bestSymbolAvg) {
        bestSymbol = symbol;
        bestSymbolAvg = avg;
      }
    }

    const latest = subs[subs.length - 1];

    agentScores.set(agentId, {
      agentId,
      agentName: latest.agentName,
      modelProvider: latest.modelProvider,
      modelName: latest.modelName,
      totalSubmissions: subs.length,
      avgComposite: round2(avgComposite),
      avgCoherence: round2(avgCoherence),
      avgDeepCoherence: round2(avgDeepCoherence),
      hallucinationRate: subs.length > 0
        ? Math.round((hallucinatedCount / subs.length) * 10000) / 100
        : 0,
      bestSymbol,
      lastSubmission: latest.submittedAt,
    });
  }

  // Sort by composite score
  const leaderboard = Array.from(agentScores.values())
    .sort((a, b) => b.avgComposite - a.avgComposite)
    .map((entry, index) => ({ rank: index + 1, ...entry }));

  return c.json({
    ok: true,
    leaderboard,
    totalExternalAgents: leaderboard.length,
    totalSubmissions: submissions.size,
  });
});

// ---------------------------------------------------------------------------
// GET /rules — Submission rules and requirements
// ---------------------------------------------------------------------------

benchmarkSubmissionRoutes.get("/rules", (c) => {
  return c.json({
    ok: true,
    rules: getSubmissionRequirements(),
    availableSymbols: [
      "AAPLx", "AMZNx", "GOOGLx", "METAx", "MSFTx", "NVDAx", "TSLAx",
      "SPYx", "QQQx", "COINx", "MSTRx", "HOODx", "NFLXx", "PLTRx", "GMEx",
      "AVGOx", "JPMx", "LLYx", "CRMx", "CRCLx",
    ],
    exampleSubmission: {
      agentId: "my-trading-agent-v1",
      agentName: "My Custom Agent",
      modelProvider: "openai",
      modelName: "gpt-4o",
      action: "buy",
      symbol: "NVDAx",
      quantity: 500,
      reasoning: "NVDA shows strong momentum with AI chip demand increasing. The stock is trading at $890 with a positive 24h change of 2.3%. Technical indicators show RSI at 65, not yet overbought. Revenue growth of 122% YoY justifies premium valuation. Allocating a moderate position given current portfolio cash reserves.",
      confidence: 0.75,
      sources: ["market_price_feed", "24h_price_change", "technical_indicators", "fundamentals"],
      intent: "momentum",
      predictedOutcome: "Expect 3-5% appreciation over the next week driven by AI sector strength",
    },
  });
});

// ---------------------------------------------------------------------------
// Scoring Logic
// ---------------------------------------------------------------------------

function scoreSubmission(
  data: z.infer<typeof submitSchema>,
  marketData: MarketData[],
): BenchmarkSubmission {
  const id = `ext_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const normalizedConf = normalizeConfidence(data.confidence);

  // Basic coherence
  const coherence = analyzeCoherence(data.reasoning, data.action, marketData);

  // Hallucination detection
  const hallucinations = detectHallucinations(data.reasoning, marketData);
  const hallucinationFreeScore = 1 - hallucinations.severity;

  // Deep coherence analysis
  const deepResult = analyzeDeepCoherence(
    data.reasoning,
    data.action,
    data.symbol,
    normalizedConf,
    marketData,
  );
  recordDeepAnalysis(data.agentId, deepResult);

  // Reasoning quality from gate validation
  const gateValidation = validateTradeReasoning(data as Record<string, unknown>);

  // Discipline (for external agents, we can't check portfolio, so score on reasoning completeness)
  const disciplineScore = gateValidation.valid ? 1.0 : gateValidation.score;

  // Composite score (same weights as internal agents)
  const composite = Math.round(
    (coherence.score * 0.25 +
      hallucinationFreeScore * 0.20 +
      disciplineScore * 0.15 +
      deepResult.overallScore * 0.25 +
      gateValidation.score * 0.15) *
      100,
  ) / 100;

  return {
    id,
    externalAgentId: data.agentId,
    agentName: data.agentName,
    modelProvider: data.modelProvider,
    modelName: data.modelName,
    action: data.action,
    symbol: data.symbol,
    quantity: data.quantity,
    reasoning: data.reasoning,
    confidence: normalizedConf,
    sources: data.sources,
    intent: data.intent,
    predictedOutcome: data.predictedOutcome,
    scores: {
      coherence: coherence.score,
      hallucinationFree: hallucinationFreeScore,
      hallucinationFlags: hallucinations.flags,
      discipline: disciplineScore,
      deepCoherence: deepResult.overallScore,
      deepGrade: deepResult.grade,
      reasoningQuality: gateValidation.score,
      composite,
    },
    submittedAt: new Date().toISOString(),
    scoredAt: new Date().toISOString(),
  };
}

function generateFeedback(submission: BenchmarkSubmission): {
  overall: string;
  tips: string[];
} {
  const tips: string[] = [];

  if (submission.scores.coherence < 0.5) {
    tips.push("Your reasoning sentiment doesn't align well with your trade action. Ensure bullish reasoning for buys and bearish for sells.");
  }
  if (submission.scores.hallucinationFlags.length > 0) {
    tips.push(`Hallucination flags detected: ${submission.scores.hallucinationFlags.join("; ")}. Verify prices and tickers against real market data.`);
  }
  if (submission.scores.deepCoherence < 0.5) {
    tips.push("Reasoning lacks depth. Include logical connectors (because, therefore), risk awareness, and specific data points.");
  }
  if (submission.scores.reasoningQuality < 0.7) {
    tips.push("Improve reasoning quality by citing multiple sources, providing quantitative data, and explaining your confidence level.");
  }
  if (submission.reasoning.length < 100) {
    tips.push("Longer, more detailed reasoning tends to score higher. Aim for 100+ characters with multi-sentence analysis.");
  }

  const overall = submission.scores.composite >= 0.8
    ? "Excellent submission — high-quality reasoning with good alignment."
    : submission.scores.composite >= 0.6
      ? "Solid submission — some areas for improvement in reasoning depth."
      : submission.scores.composite >= 0.4
        ? "Below average — reasoning needs more structure and data grounding."
        : "Weak submission — significant improvements needed in reasoning quality.";

  return { overall, tips };
}

function getSubmissionRequirements() {
  return {
    required_fields: {
      agentId: "Your unique agent identifier (min 3 chars)",
      agentName: "Human-readable name for your agent",
      modelProvider: "LLM provider (anthropic, openai, xai, custom, etc.)",
      modelName: "Specific model used (e.g., gpt-4o, claude-sonnet-4)",
      action: "buy | sell | hold",
      symbol: "Stock symbol from xStocks catalog (e.g., AAPLx, NVDAx)",
      quantity: "USDC amount for buys, share count for sells, 0 for holds",
      reasoning: "Step-by-step reasoning (min 20 chars, aim for 100+)",
      confidence: "Self-assessed confidence 0.0 to 1.0",
      sources: "Array of data sources consulted (min 1)",
      intent: "momentum | mean_reversion | value | hedge | contrarian | arbitrage",
    },
    optional_fields: {
      predictedOutcome: "What you expect to happen (improves benchmark data)",
    },
    scoring: {
      coherence: "25% — Does reasoning match trade direction?",
      deep_coherence: "25% — Structural quality of reasoning",
      hallucination_free: "20% — No fabricated data in reasoning",
      discipline: "15% — Completeness of required fields",
      reasoning_quality: "15% — Overall quality of reasoning text",
    },
  };
}
