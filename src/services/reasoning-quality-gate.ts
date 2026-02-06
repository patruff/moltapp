/**
 * Reasoning Quality Gate
 *
 * Validates that agent reasoning meets minimum quality standards before
 * allowing a trade to execute. This is the enforcement layer that makes
 * MoltApp a REAL benchmark — agents can't just output "buy AAPL" without
 * explaining why.
 *
 * Quality checks:
 * 1. MINIMUM LENGTH: Reasoning must be substantive (not one-liners)
 * 2. DATA REFERENCE: Must reference actual market data provided
 * 3. COHERENCE THRESHOLD: Coherence score must be above minimum
 * 4. NO PURE HALLUCINATION: Can't be 100% hallucinated
 * 5. STRUCTURAL COMPLETENESS: Must include sources and intent
 *
 * If reasoning fails the gate, the trade is REJECTED and logged.
 * The agent's hold rate increases (penalizing bad reasoning).
 */

import type { TradingDecision, MarketData } from "../agents/base-agent.ts";
import {
  analyzeCoherence,
  detectHallucinations,
  type CoherenceResult,
  type HallucinationResult,
} from "./coherence-analyzer.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QualityGateResult {
  /** Whether the trade is allowed to execute */
  passed: boolean;
  /** The (possibly modified) decision */
  decision: TradingDecision;
  /** Why it was rejected (if applicable) */
  rejectionReasons: string[];
  /** Quality scores */
  scores: {
    reasoningLength: number;       // 0 or 1
    dataReference: number;         // 0-1
    coherence: number;             // 0-1
    hallucinationFree: number;     // 0-1
    structuralCompleteness: number; // 0-1
    composite: number;             // weighted average
  };
  /** Coherence analysis result */
  coherence: CoherenceResult;
  /** Hallucination check result */
  hallucinations: HallucinationResult;
}

export interface QualityGateConfig {
  /** Minimum reasoning length in characters */
  minReasoningLength: number;
  /** Minimum coherence score (0-1) */
  minCoherenceScore: number;
  /** Maximum hallucination severity (0-1) */
  maxHallucinationSeverity: number;
  /** Minimum composite quality score (0-1) */
  minCompositeScore: number;
  /** Whether to reject or just warn on failure */
  enforceRejection: boolean;
}

// ---------------------------------------------------------------------------
// Composite Score Weights
// ---------------------------------------------------------------------------

/**
 * Weight for reasoning length score in composite calculation.
 * Lower weight (10%) as length alone doesn't guarantee quality.
 */
const COMPOSITE_WEIGHT_LENGTH = 0.1;

/**
 * Weight for data reference score in composite calculation.
 * Medium weight (20%) - important that reasoning references actual market data.
 */
const COMPOSITE_WEIGHT_DATA_REFERENCE = 0.2;

/**
 * Weight for coherence score in composite calculation.
 * Highest weight (35%) - logical consistency is the primary quality indicator.
 */
const COMPOSITE_WEIGHT_COHERENCE = 0.35;

/**
 * Weight for hallucination-free score in composite calculation.
 * Medium weight (20%) - critical to avoid fabricated data.
 */
const COMPOSITE_WEIGHT_HALLUCINATION_FREE = 0.2;

/**
 * Weight for structural completeness score in composite calculation.
 * Lower weight (15%) - nice-to-have but not essential for quality.
 */
const COMPOSITE_WEIGHT_STRUCTURAL = 0.15;

// ---------------------------------------------------------------------------
// Data Reference Scoring Weights
// ---------------------------------------------------------------------------

/**
 * Score bonus for mentioning actual stock symbols from market data.
 * Largest single bonus (0.4) as symbol mention proves reasoning is grounded.
 */
const DATA_REFERENCE_SYMBOL_BONUS = 0.4;

/**
 * Score bonus for mentioning specific prices (e.g., "$125.50").
 * Medium bonus (0.2) as price data shows quantitative grounding.
 */
const DATA_REFERENCE_PRICE_BONUS = 0.2;

/**
 * Score bonus for mentioning percentages or changes (e.g., "up 3%").
 * Medium bonus (0.2) as change data shows market awareness.
 */
const DATA_REFERENCE_CHANGE_BONUS = 0.2;

/**
 * Score bonus for using analysis keywords (because, therefore, given that).
 * Medium bonus (0.2) as keywords indicate logical reasoning structure.
 */
const DATA_REFERENCE_ANALYSIS_BONUS = 0.2;

/**
 * Minimum data reference score required to pass quality gate.
 * Set at 0.3 to require at least 2 types of references (symbol + price, etc.).
 */
const DATA_REFERENCE_MIN_SCORE = 0.3;

// ---------------------------------------------------------------------------
// Structural Completeness Weights
// ---------------------------------------------------------------------------

/**
 * Score contribution for including sources array with at least one entry.
 * Largest weight (0.4) as sources enable verification and accountability.
 */
const STRUCTURAL_WEIGHT_SOURCES = 0.4;

/**
 * Score contribution for including intent classification.
 * Medium weight (0.3) as intent shows understanding of trade purpose.
 */
const STRUCTURAL_WEIGHT_INTENT = 0.3;

/**
 * Score contribution for including predicted outcome.
 * Medium weight (0.3) as outcome shows forward-looking thesis.
 */
const STRUCTURAL_WEIGHT_PREDICTED_OUTCOME = 0.3;

/**
 * Minimum structural completeness score required to pass quality gate.
 * Set at 0.5 to require at least 2 of 3 fields (sources, intent, outcome).
 */
const STRUCTURAL_MIN_SCORE = 0.5;

// ---------------------------------------------------------------------------
// Default Config
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: QualityGateConfig = {
  minReasoningLength: 30,
  minCoherenceScore: 0.2,
  maxHallucinationSeverity: 0.75,
  minCompositeScore: 0.3,
  enforceRejection: true,
};

let activeConfig: QualityGateConfig = { ...DEFAULT_CONFIG };

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

interface GateStats {
  totalChecked: number;
  totalPassed: number;
  totalRejected: number;
  rejectionsByReason: Record<string, number>;
  avgCompositeScore: number;
  recentScores: number[];
}

const stats: GateStats = {
  totalChecked: 0,
  totalPassed: 0,
  totalRejected: 0,
  rejectionsByReason: {},
  avgCompositeScore: 0,
  recentScores: [],
};

const MAX_RECENT_SCORES = 100;

// ---------------------------------------------------------------------------
// Core: Quality Gate Check
// ---------------------------------------------------------------------------

/**
 * Run the reasoning quality gate on a trading decision.
 *
 * If the decision fails quality checks and enforcement is on,
 * the decision is converted to a hold with rejection reasoning.
 */
export function checkReasoningQuality(
  decision: TradingDecision,
  marketData: MarketData[],
  config?: Partial<QualityGateConfig>,
): QualityGateResult {
  const cfg = { ...activeConfig, ...config };
  const rejectionReasons: string[] = [];

  // Skip quality gate for hold decisions (they're always "safe")
  if (decision.action === "hold") {
    const coherence = analyzeCoherence(decision.reasoning, "hold", marketData);
    const hallucinations = detectHallucinations(decision.reasoning, marketData);

    return {
      passed: true,
      decision,
      rejectionReasons: [],
      scores: {
        reasoningLength: 1,
        dataReference: 1,
        coherence: coherence.score,
        hallucinationFree: 1 - hallucinations.severity,
        structuralCompleteness: 1,
        composite: 1,
      },
      coherence,
      hallucinations,
    };
  }

  // ----- Check 1: Reasoning Length -----
  const reasoningLength = decision.reasoning.length;
  const lengthScore = reasoningLength >= cfg.minReasoningLength ? 1 : 0;
  if (lengthScore === 0) {
    rejectionReasons.push(
      `Reasoning too short (${reasoningLength} chars, min ${cfg.minReasoningLength})`,
    );
  }

  // ----- Check 2: Data Reference -----
  // Does the reasoning reference actual market data (prices, symbols, changes)?
  const dataReferenceScore = scoreDataReferences(decision.reasoning, marketData);
  if (dataReferenceScore < DATA_REFERENCE_MIN_SCORE) {
    rejectionReasons.push(
      `Reasoning doesn't reference market data (score: ${dataReferenceScore.toFixed(2)})`,
    );
  }

  // ----- Check 3: Coherence -----
  const coherence = analyzeCoherence(decision.reasoning, decision.action, marketData);
  if (coherence.score < cfg.minCoherenceScore) {
    rejectionReasons.push(
      `Coherence too low (${coherence.score.toFixed(2)}, min ${cfg.minCoherenceScore}): ${coherence.explanation}`,
    );
  }

  // ----- Check 4: Hallucination Check -----
  const hallucinations = detectHallucinations(decision.reasoning, marketData);
  const hallucinationFreeScore = 1 - hallucinations.severity;
  if (hallucinations.severity > cfg.maxHallucinationSeverity) {
    rejectionReasons.push(
      `Too many hallucinations (severity: ${hallucinations.severity.toFixed(2)}, max ${cfg.maxHallucinationSeverity}): ${hallucinations.flags.join("; ")}`,
    );
  }

  // ----- Check 5: Structural Completeness -----
  const structuralScore = scoreStructuralCompleteness(decision);
  if (structuralScore < STRUCTURAL_MIN_SCORE) {
    rejectionReasons.push(
      `Reasoning structurally incomplete (score: ${structuralScore.toFixed(2)}). Missing sources or intent.`,
    );
  }

  // ----- Composite Score -----
  const compositeScore =
    Math.round(
      (lengthScore * COMPOSITE_WEIGHT_LENGTH +
        dataReferenceScore * COMPOSITE_WEIGHT_DATA_REFERENCE +
        coherence.score * COMPOSITE_WEIGHT_COHERENCE +
        hallucinationFreeScore * COMPOSITE_WEIGHT_HALLUCINATION_FREE +
        structuralScore * COMPOSITE_WEIGHT_STRUCTURAL) *
        100,
    ) / 100;

  if (compositeScore < cfg.minCompositeScore) {
    rejectionReasons.push(
      `Composite quality score too low (${compositeScore.toFixed(2)}, min ${cfg.minCompositeScore})`,
    );
  }

  // ----- Decision -----
  const passed = rejectionReasons.length === 0;

  // Update stats
  stats.totalChecked++;
  stats.recentScores.push(compositeScore);
  if (stats.recentScores.length > MAX_RECENT_SCORES) {
    stats.recentScores.shift();
  }
  stats.avgCompositeScore =
    stats.recentScores.reduce((a, b) => a + b, 0) / stats.recentScores.length;

  let finalDecision = decision;

  if (!passed && cfg.enforceRejection) {
    stats.totalRejected++;
    for (const reason of rejectionReasons) {
      const key = reason.split("(")[0].trim();
      stats.rejectionsByReason[key] = (stats.rejectionsByReason[key] ?? 0) + 1;
    }

    // Convert to hold with rejection explanation
    finalDecision = {
      action: "hold",
      symbol: decision.symbol,
      quantity: 0,
      reasoning: `[QUALITY GATE REJECTED] Original action: ${decision.action} ${decision.symbol}. ` +
        `Rejection reasons: ${rejectionReasons.join("; ")}. ` +
        `Original reasoning: ${decision.reasoning.slice(0, 200)}`,
      confidence: 0,
      timestamp: decision.timestamp,
      sources: decision.sources,
      intent: decision.intent,
    };

    console.log(
      `[QualityGate] REJECTED ${decision.action} ${decision.symbol}: ` +
        `composite=${compositeScore.toFixed(2)}, reasons=${rejectionReasons.length}`,
    );
  } else {
    stats.totalPassed++;
  }

  return {
    passed,
    decision: finalDecision,
    rejectionReasons,
    scores: {
      reasoningLength: lengthScore,
      dataReference: dataReferenceScore,
      coherence: coherence.score,
      hallucinationFree: hallucinationFreeScore,
      structuralCompleteness: structuralScore,
      composite: compositeScore,
    },
    coherence,
    hallucinations,
  };
}

// ---------------------------------------------------------------------------
// Scoring Helpers
// ---------------------------------------------------------------------------

/**
 * Score how well reasoning references actual market data.
 * Checks for symbol mentions, price references, and change references.
 */
function scoreDataReferences(
  reasoning: string,
  marketData: MarketData[],
): number {
  let score = 0;
  const lower = reasoning.toLowerCase();

  // Check for symbol mentions
  const symbolsFound = marketData.filter((md) =>
    lower.includes(md.symbol.toLowerCase()),
  );
  if (symbolsFound.length > 0) score += DATA_REFERENCE_SYMBOL_BONUS;

  // Check for price mentions (any dollar amount)
  if (/\$\d+\.?\d*/i.test(reasoning)) score += DATA_REFERENCE_PRICE_BONUS;

  // Check for percentage/change mentions
  if (/[\d.]+%|percent|change|up\s+\d|down\s+\d/i.test(reasoning)) score += DATA_REFERENCE_CHANGE_BONUS;

  // Check for analysis keywords
  if (/because|therefore|given that|based on|considering|analysis/i.test(reasoning)) {
    score += DATA_REFERENCE_ANALYSIS_BONUS;
  }

  return Math.min(1, score);
}

/**
 * Score the structural completeness of a trade decision.
 * Checks for sources, intent, and predicted outcome.
 */
function scoreStructuralCompleteness(decision: TradingDecision): number {
  let score = 0;

  // Has sources array with at least one entry
  if (decision.sources && decision.sources.length > 0) score += STRUCTURAL_WEIGHT_SOURCES;

  // Has intent classification
  if (decision.intent) score += STRUCTURAL_WEIGHT_INTENT;

  // Has predicted outcome
  if (decision.predictedOutcome) score += STRUCTURAL_WEIGHT_PREDICTED_OUTCOME;

  return score;
}

// ---------------------------------------------------------------------------
// Config & Stats API
// ---------------------------------------------------------------------------

/**
 * Update the quality gate configuration.
 */
export function updateQualityGateConfig(
  updates: Partial<QualityGateConfig>,
): QualityGateConfig {
  activeConfig = { ...activeConfig, ...updates };
  return { ...activeConfig };
}

/**
 * Get current quality gate configuration.
 */
export function getQualityGateConfig(): QualityGateConfig {
  return { ...activeConfig };
}

/**
 * Get quality gate statistics.
 */
export function getQualityGateStats(): GateStats & { config: QualityGateConfig } {
  return {
    ...stats,
    config: { ...activeConfig },
  };
}

/**
 * Reset quality gate stats (for testing).
 */
export function resetQualityGateStats(): void {
  stats.totalChecked = 0;
  stats.totalPassed = 0;
  stats.totalRejected = 0;
  stats.rejectionsByReason = {};
  stats.avgCompositeScore = 0;
  stats.recentScores = [];
}
