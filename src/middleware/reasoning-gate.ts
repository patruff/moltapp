/**
 * Reasoning Gate Middleware
 *
 * Enforces that all trades flowing through MoltApp's protected trading
 * endpoints include structured reasoning data. This is the enforcement
 * layer of the benchmark — without reasoning, trades are rejected.
 *
 * Enforcement levels:
 * - STRICT: Trade rejected if reasoning is missing or insufficient
 * - WARN: Trade executes but flagged as "unreasoned" in benchmark data
 * - OFF: No enforcement (backward compatibility)
 *
 * Applied to:
 * - POST /api/v1/trading/buy
 * - POST /api/v1/trading/sell
 * - POST /api/v1/trading/reasoned-buy
 * - POST /api/v1/trading/reasoned-sell
 */

import type { Context, Next } from "hono";
import { splitSentences } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export type ReasoningEnforcementLevel = "strict" | "warn" | "off";

// ---------------------------------------------------------------------------
// Reasoning Validation Thresholds
// ---------------------------------------------------------------------------

/**
 * Minimum character length for reasoning text.
 * Prevents trivial reasoning like "good trade" or "bullish".
 */
const REASONING_MIN_LENGTH = 20;

/**
 * Reasoning length scoring tiers (character counts).
 * Longer reasoning generally indicates more thorough analysis.
 */
const REASONING_LENGTH_TIER_EXCELLENT = 200; // 0.30 score
const REASONING_LENGTH_TIER_GOOD = 100;      // 0.25 score
const REASONING_LENGTH_TIER_ACCEPTABLE = 50; // 0.20 score
const REASONING_LENGTH_TIER_MINIMAL = 20;    // 0.15 score

/**
 * Minimum character length per sentence.
 * Filters out trivial sentences like "Buy." or "Good."
 */
const REASONING_MIN_SENTENCE_LENGTH = 5;

/**
 * Minimum number of sentences for multi-sentence bonus.
 * Encourages structured multi-point reasoning.
 */
const REASONING_MIN_SENTENCES_FOR_BONUS = 3;

/**
 * Minimum number of sources for multiple sources bonus.
 * Rewards diverse data gathering.
 */
const REASONING_MIN_SOURCES_FOR_BONUS = 3;

/**
 * Minimum character length for predicted outcome field.
 * Ensures outcome predictions are substantive.
 */
const REASONING_MIN_OUTCOME_LENGTH = 10;

// ---------------------------------------------------------------------------
// Reasoning Validation Scoring Weights
// ---------------------------------------------------------------------------

/**
 * Score penalty for reasoning that is too short.
 * Applied when reasoning exists but is below minimum length.
 */
const REASONING_SCORE_SHORT_PENALTY = 0.1;

/**
 * Score contributions for reasoning length tiers.
 * Higher scores reward more detailed analysis.
 */
const REASONING_SCORE_LENGTH_EXCELLENT = 0.30;
const REASONING_SCORE_LENGTH_GOOD = 0.25;
const REASONING_SCORE_LENGTH_ACCEPTABLE = 0.20;
const REASONING_SCORE_LENGTH_MINIMAL = 0.15;

/**
 * Bonus score for multi-sentence reasoning.
 * Rewards structured thought process.
 */
const REASONING_SCORE_MULTISENTENCE_BONUS = 0.1;

/**
 * Score for providing valid confidence value (0-1).
 */
const REASONING_SCORE_CONFIDENCE_FIELD = 0.2;

/**
 * Score for providing sources array.
 */
const REASONING_SCORE_SOURCES_FIELD = 0.15;

/**
 * Bonus score for multiple sources (3+).
 * Rewards diverse data gathering.
 */
const REASONING_SCORE_SOURCES_BONUS = 0.05;

/**
 * Score for providing valid intent classification.
 */
const REASONING_SCORE_INTENT_FIELD = 0.15;

/**
 * Bonus score for providing predicted outcome.
 * Optional field that rewards forward-looking analysis.
 */
const REASONING_SCORE_OUTCOME_BONUS = 0.05;

let enforcementLevel: ReasoningEnforcementLevel = "warn";

/** Set the global reasoning enforcement level */
export function setReasoningEnforcement(level: ReasoningEnforcementLevel): void {
  enforcementLevel = level;
  console.log(`[ReasoningGate] Enforcement level set to: ${level}`);
}

/** Get the current enforcement level */
export function getReasoningEnforcement(): ReasoningEnforcementLevel {
  return enforcementLevel;
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

interface ReasoningGateMetrics {
  totalChecked: number;
  totalPassed: number;
  totalWarned: number;
  totalRejected: number;
  avgReasoningLength: number;
  reasoningLengths: number[];
  rejectReasons: Map<string, number>;
}

const metrics: ReasoningGateMetrics = {
  totalChecked: 0,
  totalPassed: 0,
  totalWarned: 0,
  totalRejected: 0,
  avgReasoningLength: 0,
  reasoningLengths: [],
  rejectReasons: new Map(),
};

export function getReasoningGateMetrics() {
  const topRejectReasons = Array.from(metrics.rejectReasons.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([reason, count]) => ({ reason, count }));

  return {
    enforcementLevel,
    totalChecked: metrics.totalChecked,
    totalPassed: metrics.totalPassed,
    totalWarned: metrics.totalWarned,
    totalRejected: metrics.totalRejected,
    passRate: metrics.totalChecked > 0
      ? Math.round((metrics.totalPassed / metrics.totalChecked) * 10000) / 100
      : 100,
    avgReasoningLength: Math.round(metrics.avgReasoningLength),
    topRejectReasons,
  };
}

// ---------------------------------------------------------------------------
// Validation Logic
// ---------------------------------------------------------------------------

interface ReasoningValidation {
  valid: boolean;
  score: number; // 0.0 to 1.0 — how complete the reasoning is
  issues: string[];
}

/**
 * Validate the quality of reasoning provided with a trade.
 * Returns a score from 0 (no reasoning) to 1 (excellent reasoning).
 */
export function validateTradeReasoning(body: Record<string, unknown>): ReasoningValidation {
  const issues: string[] = [];
  let score = 0;

  // Check 1: Reasoning text exists and is substantial
  const reasoning = body.reasoning as string | undefined;
  if (!reasoning || typeof reasoning !== "string") {
    issues.push("Missing reasoning field");
  } else if (reasoning.length < REASONING_MIN_LENGTH) {
    issues.push(`Reasoning too short (${reasoning.length} chars, min ${REASONING_MIN_LENGTH})`);
    score += REASONING_SCORE_SHORT_PENALTY;
  } else {
    // Score by length tiers
    if (reasoning.length >= REASONING_LENGTH_TIER_EXCELLENT) score += REASONING_SCORE_LENGTH_EXCELLENT;
    else if (reasoning.length >= REASONING_LENGTH_TIER_GOOD) score += REASONING_SCORE_LENGTH_GOOD;
    else if (reasoning.length >= REASONING_LENGTH_TIER_ACCEPTABLE) score += REASONING_SCORE_LENGTH_ACCEPTABLE;
    else score += REASONING_SCORE_LENGTH_MINIMAL;

    // Bonus for multi-sentence reasoning
    const sentences = splitSentences(reasoning, REASONING_MIN_SENTENCE_LENGTH);
    if (sentences.length >= REASONING_MIN_SENTENCES_FOR_BONUS) score += REASONING_SCORE_MULTISENTENCE_BONUS;
  }

  // Check 2: Confidence provided and valid
  const confidence = body.confidence as number | undefined;
  if (confidence === undefined || confidence === null) {
    issues.push("Missing confidence field");
  } else if (typeof confidence !== "number" || confidence < 0 || confidence > 1) {
    issues.push(`Invalid confidence: ${confidence} (must be 0-1)`);
  } else {
    score += REASONING_SCORE_CONFIDENCE_FIELD;
  }

  // Check 3: Sources array provided
  const sources = body.sources as string[] | undefined;
  if (!sources || !Array.isArray(sources) || sources.length === 0) {
    issues.push("Missing or empty sources array");
  } else {
    score += REASONING_SCORE_SOURCES_FIELD;
    // Bonus for multiple sources
    if (sources.length >= REASONING_MIN_SOURCES_FOR_BONUS) score += REASONING_SCORE_SOURCES_BONUS;
  }

  // Check 4: Intent classification provided
  const intent = body.intent as string | undefined;
  const validIntents = ["momentum", "mean_reversion", "value", "hedge", "contrarian", "arbitrage"];
  if (!intent || typeof intent !== "string") {
    issues.push("Missing intent classification");
  } else if (!validIntents.includes(intent)) {
    issues.push(`Invalid intent: ${intent}. Must be one of: ${validIntents.join(", ")}`);
  } else {
    score += REASONING_SCORE_INTENT_FIELD;
  }

  // Check 5: Predicted outcome (bonus, not required)
  if (body.predictedOutcome && typeof body.predictedOutcome === "string" && body.predictedOutcome.length > REASONING_MIN_OUTCOME_LENGTH) {
    score += REASONING_SCORE_OUTCOME_BONUS;
  }

  // Clamp score to [0, 1]
  score = Math.min(1, Math.max(0, score));

  return {
    valid: issues.length === 0,
    score: Math.round(score * 100) / 100,
    issues,
  };
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Hono middleware that enforces reasoning on trade requests.
 *
 * Usage:
 *   app.use("/api/v1/trading/*", reasoningGateMiddleware);
 */
export async function reasoningGateMiddleware(c: Context, next: Next): Promise<Response | void> {
  // Only apply to POST requests (trade submissions)
  if (c.req.method !== "POST") {
    return next();
  }

  // Only apply to actual trade endpoints
  const path = c.req.path;
  const isTradePath = /\/(buy|sell|reasoned-buy|reasoned-sell)$/.test(path);
  if (!isTradePath) {
    return next();
  }

  // If enforcement is off, pass through
  if (enforcementLevel === "off") {
    return next();
  }

  metrics.totalChecked++;

  // Clone the request body for validation (don't consume it)
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
    // Store parsed body for downstream handlers
    c.set("parsedBody" as never, body as never);
  } catch {
    // Can't parse body — let the downstream handler deal with it
    return next();
  }

  const validation = validateTradeReasoning(body);

  // Track reasoning length
  const reasoning = body.reasoning as string | undefined;
  if (reasoning) {
    metrics.reasoningLengths.push(reasoning.length);
    // Keep only last 1000 entries
    if (metrics.reasoningLengths.length > 1000) {
      metrics.reasoningLengths.shift();
    }
    metrics.avgReasoningLength = metrics.reasoningLengths.reduce((s, v) => s + v, 0) / metrics.reasoningLengths.length;
  }

  if (validation.valid) {
    metrics.totalPassed++;
    // Add validation score to context for downstream use
    c.set("reasoningScore" as never, validation.score as never);
    return next();
  }

  // Track reject reasons
  for (const issue of validation.issues) {
    const current = metrics.rejectReasons.get(issue) ?? 0;
    metrics.rejectReasons.set(issue, current + 1);
  }

  if (enforcementLevel === "strict") {
    metrics.totalRejected++;
    return c.json(
      {
        ok: false,
        error: "REASONING_REQUIRED",
        enforcement: "strict",
        message:
          "MoltApp AI Trading Benchmark requires reasoning for all trades. " +
          "This is not just a leaderboard — we measure HOW agents think.",
        validation: {
          score: validation.score,
          issues: validation.issues,
        },
        required: {
          reasoning: "string (min 20 chars) — step-by-step logic behind your trade",
          confidence: "number (0-1) — self-assessed confidence in the trade",
          sources: "string[] (min 1) — data sources you consulted",
          intent: "string — one of: momentum, mean_reversion, value, hedge, contrarian, arbitrage",
          predictedOutcome: "string (optional) — what you expect to happen",
        },
        docs: "https://www.patgpt.us/api-docs",
      },
      400,
    );
  }

  // Warn mode: let trade through but flag it
  metrics.totalWarned++;
  c.set("reasoningWarning" as never, validation.issues as never);
  c.set("reasoningScore" as never, validation.score as never);
  return next();
}
