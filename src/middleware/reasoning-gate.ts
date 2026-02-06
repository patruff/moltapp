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
  } else if (reasoning.length < 20) {
    issues.push(`Reasoning too short (${reasoning.length} chars, min 20)`);
    score += 0.1;
  } else {
    // Score by length tiers
    if (reasoning.length >= 200) score += 0.3;
    else if (reasoning.length >= 100) score += 0.25;
    else if (reasoning.length >= 50) score += 0.2;
    else score += 0.15;

    // Bonus for multi-sentence reasoning
    const sentences = splitSentences(reasoning, 5);
    if (sentences.length >= 3) score += 0.1;
  }

  // Check 2: Confidence provided and valid
  const confidence = body.confidence as number | undefined;
  if (confidence === undefined || confidence === null) {
    issues.push("Missing confidence field");
  } else if (typeof confidence !== "number" || confidence < 0 || confidence > 1) {
    issues.push(`Invalid confidence: ${confidence} (must be 0-1)`);
  } else {
    score += 0.2;
  }

  // Check 3: Sources array provided
  const sources = body.sources as string[] | undefined;
  if (!sources || !Array.isArray(sources) || sources.length === 0) {
    issues.push("Missing or empty sources array");
  } else {
    score += 0.15;
    // Bonus for multiple sources
    if (sources.length >= 3) score += 0.05;
  }

  // Check 4: Intent classification provided
  const intent = body.intent as string | undefined;
  const validIntents = ["momentum", "mean_reversion", "value", "hedge", "contrarian", "arbitrage"];
  if (!intent || typeof intent !== "string") {
    issues.push("Missing intent classification");
  } else if (!validIntents.includes(intent)) {
    issues.push(`Invalid intent: ${intent}. Must be one of: ${validIntents.join(", ")}`);
  } else {
    score += 0.15;
  }

  // Check 5: Predicted outcome (bonus, not required)
  if (body.predictedOutcome && typeof body.predictedOutcome === "string" && body.predictedOutcome.length > 10) {
    score += 0.05;
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
