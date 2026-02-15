/**
 * Benchmark Submission Validator
 *
 * Validates external agent submissions to the MoltApp benchmark.
 * External agents submit trade decisions with reasoning, and this service
 * validates, scores, and ranks them alongside the internal agents.
 *
 * Validation layers:
 * 1. SCHEMA: Zod validation of required fields
 * 2. REASONING QUALITY: Minimum reasoning length, source citations
 * 3. MARKET VALIDITY: Symbol exists, price is plausible
 * 4. ADVERSARIAL: Rate limiting, pattern detection, gaming prevention
 * 5. SCORING: Full benchmark evaluation via the gateway
 *
 * This enables any AI agent builder to submit to the MoltApp benchmark
 * and get scored on the same metrics as internal agents.
 */

import { z } from "zod";
import { tradingIntentEnum } from "../schemas/trade-reasoning.ts";
import {
  evaluateTrade,
  getAdversarialReport,
  type BenchmarkEvaluation,
} from "./benchmark-gateway.ts";
import type { MarketData } from "../agents/base-agent.ts";
import { countWords, round2 } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Reasoning validation parameters for benchmark submissions.
 */

/** Minimum reasoning length (characters) required by Zod schema validation */
const REASONING_MIN_LENGTH = 50;

/** Minimum word count for substantive analysis pre-check (prevents trivial submissions) */
const REASONING_WORD_COUNT_MIN = 10;

/**
 * Rate limiting and storage parameters for submission processing.
 */

/** Maximum submissions allowed per agent per hour (prevents spam) */
const MAX_SUBMISSIONS_PER_HOUR = 60;

/** Maximum submission store size (circular buffer, oldest entries evicted) */
const MAX_STORE_SIZE = 5000;

/** Milliseconds per hour for rate limit window calculation */
const HOUR_MS = 60 * 60 * 1000;

/**
 * Default agent configuration values for submission evaluation.
 * Used when external agents don't provide their own configuration.
 */

/** Default maximum position size (% of portfolio per symbol) */
const DEFAULT_MAX_POSITION_SIZE = 25;

/** Default maximum portfolio allocation (% in equities vs cash) */
const DEFAULT_MAX_PORTFOLIO_ALLOCATION = 80;

/** Default initial capital assumption for portfolio simulation (USDC) */
const DEFAULT_INITIAL_CAPITAL = 10000;

// ---------------------------------------------------------------------------
// Submission Schema
// ---------------------------------------------------------------------------

/** Schema for external benchmark submissions */
export const externalSubmissionSchema = z.object({
  /** Unique submission ID (client-generated, for idempotency) */
  submissionId: z.string().min(1).max(100),

  /** Agent identifier (must be consistent across submissions) */
  agentId: z.string().min(1).max(100).regex(
    /^[a-zA-Z0-9_-]+$/,
    "Agent ID must be alphanumeric with dashes/underscores",
  ),

  /** Agent display name */
  agentName: z.string().min(1).max(100),

  /** Model identifier (e.g., "gpt-4o", "claude-sonnet-4-20250514") */
  model: z.string().min(1).max(100),

  /** Provider (e.g., "openai", "anthropic", "custom") */
  provider: z.string().min(1).max(50),

  /** Trade decision */
  trade: z.object({
    action: z.enum(["buy", "sell", "hold"]),
    symbol: z.string().min(1).max(10),
    quantity: z.number().min(0),
    reasoning: z.string().min(REASONING_MIN_LENGTH, "Reasoning must be at least 50 characters for benchmark validity"),
    confidence: z.number().min(0).max(1),
    sources: z.array(z.string()).min(1, "Must cite at least one data source"),
    intent: tradingIntentEnum,
    predictedOutcome: z.string().optional(),
  }),

  /** Optional: market data snapshot at time of decision */
  marketSnapshot: z.record(z.string(), z.object({
    price: z.number().positive(),
    change24h: z.number().optional(),
  })).optional(),

  /** API key for authentication */
  apiKey: z.string().min(1),
});

export type ExternalSubmission = z.infer<typeof externalSubmissionSchema>;

// ---------------------------------------------------------------------------
// Submission Storage & Rate Limiting
// ---------------------------------------------------------------------------

interface StoredSubmission {
  submission: ExternalSubmission;
  evaluation: BenchmarkEvaluation | null;
  status: "pending" | "validated" | "scored" | "rejected";
  rejectionReason?: string;
  receivedAt: string;
  scoredAt?: string;
}

const submissionStore = new Map<string, StoredSubmission>();
const agentRateLimits = new Map<string, { count: number; windowStart: number }>();

// Valid API keys for external submissions (in production, this would be in a DB)
const validApiKeys = new Set<string>([
  "molt-benchmark-open-2026", // Public benchmark key for hackathon
]);

// ---------------------------------------------------------------------------
// Validation Functions
// ---------------------------------------------------------------------------

/**
 * Validate and process an external benchmark submission.
 *
 * Returns the evaluation result or rejection reason.
 */
export function validateAndScoreSubmission(
  rawSubmission: unknown,
  marketData: MarketData[],
): {
  ok: boolean;
  submissionId?: string;
  evaluation?: BenchmarkEvaluation;
  error?: string;
  validationErrors?: z.ZodIssue[];
} {
  // Step 1: Schema validation
  const parseResult = externalSubmissionSchema.safeParse(rawSubmission);
  if (!parseResult.success) {
    return {
      ok: false,
      error: "Schema validation failed",
      validationErrors: parseResult.error.issues,
    };
  }

  const submission = parseResult.data;

  // Step 2: API key validation
  if (!validApiKeys.has(submission.apiKey)) {
    return {
      ok: false,
      submissionId: submission.submissionId,
      error: "Invalid API key. Use 'molt-benchmark-open-2026' for the public benchmark.",
    };
  }

  // Step 3: Rate limiting
  const rateCheck = checkRateLimit(submission.agentId);
  if (!rateCheck.allowed) {
    return {
      ok: false,
      submissionId: submission.submissionId,
      error: `Rate limit exceeded. ${rateCheck.remaining} submissions remaining this hour.`,
    };
  }

  // Step 4: Idempotency check
  const existing = submissionStore.get(submission.submissionId);
  if (existing) {
    return {
      ok: true,
      submissionId: submission.submissionId,
      evaluation: existing.evaluation ?? undefined,
    };
  }

  // Step 5: Market data validation
  const symbolExists = marketData.some(
    (m) => m.symbol.toLowerCase() === submission.trade.symbol.toLowerCase(),
  );
  if (!symbolExists && submission.trade.action !== "hold") {
    return {
      ok: false,
      submissionId: submission.submissionId,
      error: `Unknown symbol: ${submission.trade.symbol}. Valid symbols: ${marketData.map((m) => m.symbol).join(", ")}`,
    };
  }

  // Step 6: Adversarial pre-check
  const adversarialReport = getAdversarialReport(submission.agentId);
  if (adversarialReport.riskLevel === "blocked") {
    return {
      ok: false,
      submissionId: submission.submissionId,
      error: "Agent has been blocked due to adversarial behavior patterns. Contact benchmark administrators.",
    };
  }

  // Step 7: Reasoning quality pre-check
  const reasoningWords = countWords(submission.trade.reasoning);
  if (reasoningWords < REASONING_WORD_COUNT_MIN) {
    return {
      ok: false,
      submissionId: submission.submissionId,
      error: "Reasoning too short. Benchmark requires substantive analysis (minimum 10 words).",
    };
  }

  // Step 8: Score the submission
  const evaluation = evaluateTrade({
    agentId: `ext_${submission.agentId}`,
    roundId: `ext_${Date.now()}`,
    trade: {
      action: submission.trade.action,
      symbol: submission.trade.symbol,
      quantity: submission.trade.quantity,
      reasoning: submission.trade.reasoning,
      confidence: submission.trade.confidence,
      sources: submission.trade.sources,
      intent: submission.trade.intent,
      predictedOutcome: submission.trade.predictedOutcome,
    },
    marketData,
    agentConfig: {
      maxPositionSize: DEFAULT_MAX_POSITION_SIZE,
      maxPortfolioAllocation: DEFAULT_MAX_PORTFOLIO_ALLOCATION,
      riskTolerance: "moderate",
    },
    portfolio: {
      cashBalance: DEFAULT_INITIAL_CAPITAL,
      totalValue: DEFAULT_INITIAL_CAPITAL,
      positions: [],
    },
  });

  // Step 9: Store the submission
  const stored: StoredSubmission = {
    submission,
    evaluation,
    status: evaluation.integrityPassed ? "scored" : "rejected",
    rejectionReason: evaluation.integrityPassed ? undefined : "Failed integrity checks",
    receivedAt: new Date().toISOString(),
    scoredAt: new Date().toISOString(),
  };
  submissionStore.set(submission.submissionId, stored);

  // Clean up old entries if needed
  if (submissionStore.size > MAX_STORE_SIZE) {
    const oldestKeys = Array.from(submissionStore.keys()).slice(0, 1000);
    for (const key of oldestKeys) {
      submissionStore.delete(key);
    }
  }

  return {
    ok: true,
    submissionId: submission.submissionId,
    evaluation,
  };
}

/**
 * Check rate limit for an agent.
 */
function checkRateLimit(agentId: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const hourMs = 60 * 60 * 1000;

  let limit = agentRateLimits.get(agentId);
  if (!limit || now - limit.windowStart > hourMs) {
    limit = { count: 0, windowStart: now };
    agentRateLimits.set(agentId, limit);
  }

  limit.count++;
  const remaining = Math.max(0, MAX_SUBMISSIONS_PER_HOUR - limit.count);
  return {
    allowed: limit.count <= MAX_SUBMISSIONS_PER_HOUR,
    remaining,
  };
}

// ---------------------------------------------------------------------------
// Query Functions
// ---------------------------------------------------------------------------

/**
 * Get a submission by ID.
 */
export function getSubmission(submissionId: string): StoredSubmission | null {
  return submissionStore.get(submissionId) ?? null;
}

/**
 * Get external leaderboard (all external agents ranked by composite score).
 */
export function getExternalLeaderboard(): {
  agentId: string;
  agentName: string;
  model: string;
  provider: string;
  submissions: number;
  avgComposite: number;
  avgCoherence: number;
  hallucinationRate: number;
  bestGrade: string;
}[] {
  const agentMap = new Map<string, StoredSubmission[]>();
  for (const stored of submissionStore.values()) {
    if (stored.status !== "scored" || !stored.evaluation) continue;
    const list = agentMap.get(stored.submission.agentId) ?? [];
    list.push(stored);
    agentMap.set(stored.submission.agentId, list);
  }

  const leaderboard = Array.from(agentMap.entries()).map(([agentId, submissions]) => {
    const scored = submissions.filter((s) => s.evaluation);
    const avgComposite = scored.reduce((s, sub) => s + (sub.evaluation?.scores.composite ?? 0), 0) / scored.length;
    const avgCoherence = scored.reduce((s, sub) => s + (sub.evaluation?.scores.coherence.score ?? 0), 0) / scored.length;
    const halCount = scored.filter((s) => (s.evaluation?.scores.hallucinations.flags.length ?? 0) > 0).length;

    // Best grade (lowest letter = best)
    const gradeOrder = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "F"];
    const grades = scored.map((s) => s.evaluation?.scores.grade ?? "F");
    const bestGrade = grades.reduce((best, g) =>
      gradeOrder.indexOf(g) < gradeOrder.indexOf(best) ? g : best, "F");

    const first = submissions[0];
    return {
      agentId,
      agentName: first.submission.agentName,
      model: first.submission.model,
      provider: first.submission.provider,
      submissions: scored.length,
      avgComposite: round2(avgComposite),
      avgCoherence: round2(avgCoherence),
      hallucinationRate: scored.length > 0 ? round2(halCount / scored.length) : 0,
      bestGrade,
    };
  });

  return leaderboard.sort((a, b) => b.avgComposite - a.avgComposite);
}

/**
 * Get submission statistics.
 */
export function getSubmissionStats(): {
  totalSubmissions: number;
  scoredCount: number;
  rejectedCount: number;
  uniqueAgents: number;
  uniqueModels: number;
  avgComposite: number;
} {
  let scored = 0;
  let rejected = 0;
  const agents = new Set<string>();
  const models = new Set<string>();
  let compositeSum = 0;

  for (const stored of submissionStore.values()) {
    if (stored.status === "scored") {
      scored++;
      compositeSum += stored.evaluation?.scores.composite ?? 0;
    }
    if (stored.status === "rejected") rejected++;
    agents.add(stored.submission.agentId);
    models.add(stored.submission.model);
  }

  return {
    totalSubmissions: submissionStore.size,
    scoredCount: scored,
    rejectedCount: rejected,
    uniqueAgents: agents.size,
    uniqueModels: models.size,
    avgComposite: scored > 0 ? round2(compositeSum / scored) : 0,
  };
}
