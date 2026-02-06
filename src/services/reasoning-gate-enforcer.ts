/**
 * Reasoning Gate Enforcer
 *
 * Strict enforcement layer that ensures every trade on MoltApp includes
 * structured reasoning data. This is the enforcement mechanism behind
 * the benchmark — without it, agents could trade with empty reasoning
 * and the benchmark would be meaningless.
 *
 * Gate Levels:
 * - STRICT: Trade is rejected if reasoning is missing or fails validation
 * - WARN: Trade executes but is flagged in benchmark data
 * - OFF: No enforcement (backward compatibility)
 *
 * Validation checks:
 * 1. Reasoning text exists and meets minimum length
 * 2. Confidence is a valid number in [0, 1]
 * 3. At least one data source is cited
 * 4. Intent classification is valid
 * 5. Reasoning quality passes minimum coherence threshold
 * 6. No copy-paste / template reasoning (originality check)
 */

import {
  tradeWithReasoningSchema,
  holdWithReasoningSchema,
  normalizeConfidence,
  extractSourcesFromReasoning,
  classifyIntent,
} from "../schemas/trade-reasoning.ts";
import { analyzeCoherence } from "./coherence-analyzer.ts";
import type { TradingDecision } from "../agents/base-agent.ts";
import { getFilteredWords } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GateLevel = "strict" | "warn" | "off";

export interface GateResult {
  /** Whether the trade passed the gate */
  passed: boolean;
  /** Gate level that was applied */
  level: GateLevel;
  /** Validation errors found */
  errors: GateError[];
  /** Warnings (non-blocking issues) */
  warnings: string[];
  /** The validated/enriched decision (with normalized fields) */
  decision: TradingDecision;
  /** Coherence score computed during validation */
  coherenceScore: number;
  /** Whether reasoning appears to be templated/copied */
  isOriginal: boolean;
  /** Gate check duration in ms */
  durationMs: number;
}

export interface GateError {
  field: string;
  message: string;
  severity: "error" | "warning";
}

export interface GateMetrics {
  totalChecked: number;
  totalPassed: number;
  totalRejected: number;
  totalWarned: number;
  rejectionsByReason: Record<string, number>;
  avgCoherenceAtGate: number;
  avgReasoningLength: number;
  templateDetections: number;
  gateLevel: GateLevel;
  lastCheckedAt: string | null;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

let currentGateLevel: GateLevel = "warn";
const MIN_REASONING_LENGTH = 20;
const MIN_COHERENCE_THRESHOLD = 0.15;
const TEMPLATE_SIMILARITY_THRESHOLD = 0.85;

/**
 * Set the reasoning gate enforcement level.
 */
export function setGateLevel(level: GateLevel): void {
  currentGateLevel = level;
  console.log(`[ReasoningGate] Level set to: ${level}`);
}

/**
 * Get the current gate level.
 */
export function getGateLevel(): GateLevel {
  return currentGateLevel;
}

// ---------------------------------------------------------------------------
// Metrics Tracking
// ---------------------------------------------------------------------------

const metrics: GateMetrics = {
  totalChecked: 0,
  totalPassed: 0,
  totalRejected: 0,
  totalWarned: 0,
  rejectionsByReason: {},
  avgCoherenceAtGate: 0,
  avgReasoningLength: 0,
  templateDetections: 0,
  gateLevel: currentGateLevel,
  lastCheckedAt: null,
};

let coherenceSum = 0;
let lengthSum = 0;

/**
 * Get current gate enforcement metrics.
 */
export function getGateMetrics(): GateMetrics {
  return {
    ...metrics,
    gateLevel: currentGateLevel,
    avgCoherenceAtGate: metrics.totalChecked > 0
      ? Math.round((coherenceSum / metrics.totalChecked) * 1000) / 1000
      : 0,
    avgReasoningLength: metrics.totalChecked > 0
      ? Math.round(lengthSum / metrics.totalChecked)
      : 0,
  };
}

// ---------------------------------------------------------------------------
// Recent Reasoning Cache (for template detection)
// ---------------------------------------------------------------------------

const recentReasonings: string[] = [];
const MAX_RECENT = 50;

function recordReasoning(reasoning: string): void {
  recentReasonings.push(reasoning);
  if (recentReasonings.length > MAX_RECENT) {
    recentReasonings.shift();
  }
}

/**
 * Check if reasoning appears to be a template or copy of previous reasoning.
 * Uses Jaccard similarity on word sets.
 */
function checkOriginality(reasoning: string): { isOriginal: boolean; maxSimilarity: number } {
  const words = new Set(getFilteredWords(reasoning, 3));
  if (words.size < 5) return { isOriginal: true, maxSimilarity: 0 };

  let maxSimilarity = 0;
  for (const prev of recentReasonings) {
    const prevWords = new Set(getFilteredWords(prev, 3));
    if (prevWords.size < 5) continue;

    // Jaccard similarity
    let intersection = 0;
    for (const w of words) {
      if (prevWords.has(w)) intersection++;
    }
    const union = words.size + prevWords.size - intersection;
    const similarity = union > 0 ? intersection / union : 0;

    if (similarity > maxSimilarity) {
      maxSimilarity = similarity;
    }
  }

  return {
    isOriginal: maxSimilarity < TEMPLATE_SIMILARITY_THRESHOLD,
    maxSimilarity,
  };
}

// ---------------------------------------------------------------------------
// Core Gate Function
// ---------------------------------------------------------------------------

/**
 * Run the reasoning gate on a trading decision.
 *
 * In STRICT mode: returns passed=false if validation fails
 * In WARN mode: always returns passed=true but includes warnings
 * In OFF mode: always passes, no validation
 */
export function enforceReasoningGate(
  decision: TradingDecision,
  agentId: string,
): GateResult {
  const startTime = Date.now();
  const errors: GateError[] = [];
  const warnings: string[] = [];

  metrics.totalChecked++;
  metrics.lastCheckedAt = new Date().toISOString();

  // OFF mode — skip everything
  if (currentGateLevel === "off") {
    return {
      passed: true,
      level: "off",
      errors: [],
      warnings: [],
      decision,
      coherenceScore: 0,
      isOriginal: true,
      durationMs: Date.now() - startTime,
    };
  }

  // --- Validation 1: Reasoning text exists and has substance ---
  if (!decision.reasoning || decision.reasoning.trim().length === 0) {
    errors.push({
      field: "reasoning",
      message: "Reasoning is required — no black-box trades allowed",
      severity: "error",
    });
  } else if (decision.reasoning.length < MIN_REASONING_LENGTH) {
    errors.push({
      field: "reasoning",
      message: `Reasoning too short (${decision.reasoning.length} chars, min ${MIN_REASONING_LENGTH})`,
      severity: "error",
    });
  }

  // Track reasoning length
  const reasoningLength = decision.reasoning?.length ?? 0;
  lengthSum += reasoningLength;

  // --- Validation 2: Confidence is valid ---
  const normalizedConf = normalizeConfidence(decision.confidence);
  if (isNaN(normalizedConf) || normalizedConf < 0 || normalizedConf > 1) {
    errors.push({
      field: "confidence",
      message: `Invalid confidence value: ${decision.confidence}`,
      severity: "error",
    });
  }

  // --- Validation 3: Sources validation ---
  const sources = decision.sources ?? extractSourcesFromReasoning(decision.reasoning ?? "");
  if (sources.length === 0) {
    warnings.push("No data sources cited in reasoning");
  }

  // --- Validation 4: Intent classification ---
  const intent = decision.intent ?? classifyIntent(decision.reasoning ?? "", decision.action);
  const validIntents = ["momentum", "mean_reversion", "value", "hedge", "contrarian", "arbitrage"];
  if (!validIntents.includes(intent)) {
    warnings.push(`Unrecognized intent: ${intent}`);
  }

  // --- Validation 5: Zod schema validation ---
  if (decision.action === "buy" || decision.action === "sell") {
    const zodResult = tradeWithReasoningSchema.safeParse({
      symbol: decision.symbol,
      side: decision.action,
      quantity: decision.quantity,
      reasoning: decision.reasoning,
      confidence: normalizedConf,
      sources,
      intent,
      predictedOutcome: decision.predictedOutcome,
    });

    if (!zodResult.success) {
      for (const issue of zodResult.error.issues) {
        errors.push({
          field: String(issue.path[0] ?? "unknown"),
          message: issue.message,
          severity: "error",
        });
      }
    }
  } else if (decision.action === "hold") {
    const zodResult = holdWithReasoningSchema.safeParse({
      symbol: decision.symbol,
      reasoning: decision.reasoning,
      confidence: normalizedConf,
      sources,
    });

    if (!zodResult.success) {
      for (const issue of zodResult.error.issues) {
        errors.push({
          field: String(issue.path[0] ?? "unknown"),
          message: issue.message,
          severity: "error",
        });
      }
    }
  }

  // --- Validation 6: Coherence check ---
  let coherenceScore = 0;
  if (decision.reasoning && decision.reasoning.length >= MIN_REASONING_LENGTH) {
    const coherenceResult = analyzeCoherence(
      decision.reasoning,
      decision.action,
    );
    coherenceScore = coherenceResult.score;
    coherenceSum += coherenceScore;

    if (coherenceScore < MIN_COHERENCE_THRESHOLD) {
      errors.push({
        field: "coherence",
        message: `Reasoning coherence too low: ${coherenceScore.toFixed(2)} (min ${MIN_COHERENCE_THRESHOLD})`,
        severity: "warning",
      });
    }
  }

  // --- Validation 7: Originality check ---
  const originality = checkOriginality(decision.reasoning ?? "");
  if (!originality.isOriginal) {
    warnings.push(`Reasoning appears templated (${(originality.maxSimilarity * 100).toFixed(0)}% similar to recent)`);
    metrics.templateDetections++;
  }
  recordReasoning(decision.reasoning ?? "");

  // --- Determine pass/fail ---
  const criticalErrors = errors.filter((e) => e.severity === "error");
  const passed = currentGateLevel === "warn"
    ? true
    : criticalErrors.length === 0;

  if (!passed) {
    metrics.totalRejected++;
    for (const err of criticalErrors) {
      metrics.rejectionsByReason[err.field] = (metrics.rejectionsByReason[err.field] ?? 0) + 1;
    }
  } else if (errors.length > 0 || warnings.length > 0) {
    metrics.totalWarned++;
  }

  if (passed) {
    metrics.totalPassed++;
  }

  // Enrich decision with normalized fields
  const enrichedDecision: TradingDecision = {
    ...decision,
    confidence: decision.confidence > 1 ? decision.confidence : normalizedConf * 100,
    sources: sources.length > 0 ? sources : decision.sources,
    intent: intent,
  };

  return {
    passed,
    level: currentGateLevel,
    errors,
    warnings,
    decision: passed ? enrichedDecision : {
      ...decision,
      action: "hold",
      quantity: 0,
      reasoning: `[REASONING GATE REJECTED] ${criticalErrors.map((e) => e.message).join("; ")}. Original: ${decision.reasoning ?? "none"}`,
      confidence: 0,
    },
    coherenceScore,
    isOriginal: originality.isOriginal,
    durationMs: Date.now() - startTime,
  };
}

/**
 * Validate an external agent's trade submission.
 * Returns detailed validation results for the submitter.
 */
export function validateExternalSubmission(submission: Record<string, unknown>): {
  valid: boolean;
  errors: GateError[];
  suggestions: string[];
} {
  const errors: GateError[] = [];
  const suggestions: string[] = [];

  // Check required fields
  const requiredFields = ["symbol", "action", "reasoning", "confidence"];
  for (const field of requiredFields) {
    if (!(field in submission) || submission[field] === null || submission[field] === undefined) {
      errors.push({ field, message: `Missing required field: ${field}`, severity: "error" });
    }
  }

  // Check reasoning quality
  const reasoning = String(submission.reasoning ?? "");
  if (reasoning.length < 50) {
    suggestions.push("Reasoning should be at least 50 characters for meaningful benchmark scoring");
  }
  if (reasoning.length < 100) {
    suggestions.push("Longer, more detailed reasoning typically scores higher on coherence metrics");
  }

  // Check confidence range
  const confidence = Number(submission.confidence ?? 0);
  if (confidence > 1) {
    suggestions.push("Confidence should be 0.0-1.0 scale. Values >1 will be normalized from 0-100");
  }

  // Check sources
  if (!Array.isArray(submission.sources) || (submission.sources as unknown[]).length === 0) {
    suggestions.push("Include 'sources' array citing data you used (e.g., ['market_price_feed', 'news_feed'])");
  }

  // Check intent
  const validIntents = ["momentum", "mean_reversion", "value", "hedge", "contrarian", "arbitrage"];
  if (submission.intent && !validIntents.includes(String(submission.intent))) {
    errors.push({
      field: "intent",
      message: `Invalid intent: ${submission.intent}. Must be one of: ${validIntents.join(", ")}`,
      severity: "error",
    });
  }

  return {
    valid: errors.filter((e) => e.severity === "error").length === 0,
    errors,
    suggestions,
  };
}
