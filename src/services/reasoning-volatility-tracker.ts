/**
 * Reasoning Volatility Tracker (v14)
 *
 * Measures how much an agent's reasoning CHANGES between trading rounds.
 * A stable, disciplined agent should have consistent reasoning patterns;
 * wild swings in logic suggest the agent is unreliable or reactive.
 *
 * Volatility dimensions:
 * - Sentiment volatility: How much does bullish/bearish tone change?
 * - Confidence volatility: How much does self-reported confidence swing?
 * - Intent drift: How often does the agent switch strategies?
 * - Conviction flip rate: How often does the agent reverse on a stock?
 * - Vocabulary stability: Does the agent use consistent terminology?
 */

import { mean, round3, findMax, findMin, standardDeviation } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReasoningSnapshot {
  agentId: string;
  roundId: string;
  symbol: string;
  action: "buy" | "sell" | "hold";
  confidence: number;
  intent: string;
  sentimentScore: number; // -1 (bearish) to +1 (bullish)
  wordCount: number;
  coherenceScore: number;
  keyPhrases: string[];
  timestamp: string;
}

export interface VolatilityMetrics {
  agentId: string;
  /** Number of rounds analyzed */
  roundsAnalyzed: number;
  /** Sentiment volatility: std deviation of sentiment scores */
  sentimentVolatility: number;
  /** Confidence volatility: std deviation of confidence values */
  confidenceVolatility: number;
  /** Intent drift rate: fraction of rounds where intent changed vs previous */
  intentDriftRate: number;
  /** Conviction flip rate: how often agent reverses buy↔sell on same stock */
  convictionFlipRate: number;
  /** Average reasoning length coefficient of variation */
  lengthVariability: number;
  /** Composite stability score: 0 (chaos) to 1 (rock-solid) */
  stabilityScore: number;
  /** Grade: A+ (very stable) to F (erratic) */
  grade: string;
  /** Verbal description */
  assessment: string;
  /** Recent trend: stabilizing, volatile, or consistent */
  recentTrend: "stabilizing" | "volatile" | "consistent";
  /** Per-symbol breakdown */
  bySymbol: Record<string, SymbolVolatility>;
}

export interface SymbolVolatility {
  symbol: string;
  tradeCount: number;
  sentimentRange: number; // max - min sentiment
  avgConfidence: number;
  flipCount: number; // buy→sell or sell→buy transitions
  lastAction: string;
}

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Volatility analysis window and trend comparison parameters.
 */

/** Maximum history snapshots retained per agent (circular buffer) */
const MAX_HISTORY_PER_AGENT = 200;

/** Minimum rounds required for reliable trend comparison */
const TREND_MIN_ROUNDS = 10;

/** Recent trend window size (proportion of history for recency bias) */
const TREND_RECENT_WINDOW_DIVISOR = 2;

/** Minimum rounds required for agent volatility comparison ranking */
const COMPARISON_MIN_ROUNDS = 3;

/**
 * Volatility-to-stability conversion multipliers.
 *
 * Each volatility metric is inverted to stability score using:
 * stability = max(0, 1 - volatility × multiplier)
 *
 * Higher multiplier = stricter stability requirements (penalizes volatility more).
 */

/** Sentiment volatility multiplier (vol=0.5 → 0% stability) */
const SENTIMENT_VOLATILITY_MULTIPLIER = 2.0;

/** Confidence volatility multiplier (vol=0.25 → 0% stability) */
const CONFIDENCE_VOLATILITY_MULTIPLIER = 4.0;

/**
 * Composite stability score component weights.
 *
 * Weighted average of 5 stability dimensions:
 * - Sentiment stability (sentiment volatility inverted)
 * - Confidence stability (confidence volatility inverted)
 * - Intent stability (1 - intent drift rate)
 * - Flip stability (1 - conviction flip rate)
 * - Length stability (1 - length variability coefficient of variation)
 */

/** Weight for sentiment stability in composite score */
const STABILITY_WEIGHT_SENTIMENT = 0.25;

/** Weight for confidence stability in composite score */
const STABILITY_WEIGHT_CONFIDENCE = 0.20;

/** Weight for intent stability (consistency of strategy) in composite score */
const STABILITY_WEIGHT_INTENT = 0.25;

/** Weight for flip stability (conviction consistency) in composite score */
const STABILITY_WEIGHT_FLIP = 0.20;

/** Weight for length stability (reasoning depth consistency) in composite score */
const STABILITY_WEIGHT_LENGTH = 0.10;

/**
 * Recent trend classification thresholds.
 *
 * Compares recent volatility (last N rounds) to older volatility to detect:
 * - "stabilizing": Agent becoming more consistent (recent < older × 0.7)
 * - "volatile": Agent becoming more erratic (recent > older × 1.3)
 * - "consistent": Volatility roughly unchanged
 */

/** Threshold for "stabilizing" trend (recent volatility < older × 0.7) */
const TREND_STABILIZING_THRESHOLD = 0.7;

/** Threshold for "volatile" trend (recent volatility > older × 1.3) */
const TREND_VOLATILE_THRESHOLD = 1.3;

/**
 * Stability grade boundaries (A+ through F).
 *
 * Grade based on composite stability score (0-1 scale):
 * - A+ (0.90+): Highly disciplined, rock-solid reasoning
 * - A (0.85-0.90): Very consistent approach
 * - B/C: Moderate variation
 * - D/F: Erratic, unreliable reasoning patterns
 */

const GRADE_THRESHOLD_A_PLUS = 0.90;
const GRADE_THRESHOLD_A = 0.85;
const GRADE_THRESHOLD_A_MINUS = 0.80;
const GRADE_THRESHOLD_B_PLUS = 0.75;
const GRADE_THRESHOLD_B = 0.70;
const GRADE_THRESHOLD_B_MINUS = 0.65;
const GRADE_THRESHOLD_C_PLUS = 0.60;
const GRADE_THRESHOLD_C = 0.50;
const GRADE_THRESHOLD_D = 0.40;

/**
 * Verbal assessment severity thresholds.
 *
 * Thresholds for flagging specific volatility dimensions in assessment text:
 * - High stability: 0.8+ composite score
 * - Moderate stability: 0.6-0.8 composite score
 * - Low stability: <0.6 composite score
 *
 * Individual dimension warnings:
 * - Sentiment volatility > 0.3 = "high sentiment swings"
 * - Confidence volatility > 0.2 = "confidence varies significantly"
 * - Intent drift > 0.4 = "frequently switches strategy"
 * - Flip rate > 0.3 = "frequently reverses conviction"
 */

/** Composite score threshold for "highly consistent" assessment */
const ASSESSMENT_HIGH_STABILITY_THRESHOLD = 0.8;

/** Composite score threshold for "moderately stable" assessment */
const ASSESSMENT_MODERATE_STABILITY_THRESHOLD = 0.6;

/** Sentiment volatility threshold for "high sentiment swings" warning */
const ASSESSMENT_SENTIMENT_VOLATILITY_THRESHOLD = 0.3;

/** Confidence volatility threshold for "confidence varies significantly" warning */
const ASSESSMENT_CONFIDENCE_VOLATILITY_THRESHOLD = 0.2;

/** Intent drift rate threshold for "frequently switches strategy" warning */
const ASSESSMENT_INTENT_DRIFT_THRESHOLD = 0.4;

/** Conviction flip rate threshold for "frequently reverses conviction" warning */
const ASSESSMENT_FLIP_RATE_THRESHOLD = 0.3;

/**
 * Text processing and calculation parameters.
 */

/** Maximum key phrases extracted from reasoning text for vocabulary comparison */
const MAX_KEY_PHRASES = 10;

/**
 * Sentiment range rounding precision (2 decimal places).
 *
 * Example: sentimentRange = Math.round((maxSent - minSent) * 100) / 100
 * Converts 0.1234... to 0.12 for cleaner display.
 */
const SENTIMENT_RANGE_ROUNDING_PRECISION = 100;

/**
 * Number of volatility dimensions averaged for trend comparison.
 *
 * Used in computeRecentTrend() to average sentiment and confidence volatility
 * into a single metric for comparing recent vs older behavior.
 */
const TREND_VOLATILITY_DIMENSIONS = 2;

// ---------------------------------------------------------------------------
// In-Memory Storage
// ---------------------------------------------------------------------------

/** Per-agent reasoning history (circular buffer) */
const agentHistory: Map<string, ReasoningSnapshot[]> = new Map();

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

/**
 * Record a reasoning snapshot for volatility tracking.
 */
export function recordReasoningForVolatility(snapshot: ReasoningSnapshot): void {
  const history = agentHistory.get(snapshot.agentId) ?? [];
  history.push(snapshot);

  if (history.length > MAX_HISTORY_PER_AGENT) {
    history.splice(0, history.length - MAX_HISTORY_PER_AGENT);
  }

  agentHistory.set(snapshot.agentId, history);
}

/**
 * Extract a sentiment score from reasoning text using keyword analysis.
 * Returns -1 (very bearish) to +1 (very bullish).
 */
export function computeSentimentScore(reasoning: string): number {
  const bullishTerms = [
    "bullish", "upside", "growth", "opportunity", "undervalued",
    "momentum", "rally", "breakout", "accumulate", "favorable",
    "optimistic", "recovery", "strong", "increase", "gain",
  ];

  const bearishTerms = [
    "bearish", "downside", "risk", "overvalued", "declining",
    "correction", "breakdown", "distribute", "unfavorable",
    "pessimistic", "weakness", "decrease", "loss", "caution",
  ];

  const lower = reasoning.toLowerCase();
  let bullCount = 0;
  let bearCount = 0;

  for (const term of bullishTerms) {
    if (lower.includes(term)) bullCount++;
  }
  for (const term of bearishTerms) {
    if (lower.includes(term)) bearCount++;
  }

  const total = bullCount + bearCount;
  if (total === 0) return 0;

  return (bullCount - bearCount) / total;
}

/**
 * Extract key phrases from reasoning for comparison.
 */
export function extractKeyPhrases(reasoning: string): string[] {
  const phrases: string[] = [];

  // Extract quoted phrases
  const quoted = reasoning.match(/"([^"]+)"/g);
  if (quoted) phrases.push(...quoted.map((q) => q.replace(/"/g, "")));

  // Extract key financial terms
  const financialTerms = reasoning.match(
    /\b(support|resistance|moving average|RSI|MACD|P\/E|earnings|revenue|volume|trend|momentum|mean reversion|value play|hedge|contrarian)\b/gi,
  );
  if (financialTerms) phrases.push(...financialTerms.map((t) => t.toLowerCase()));

  return [...new Set(phrases)].slice(0, MAX_KEY_PHRASES);
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

/**
 * Analyze reasoning volatility for an agent.
 */
export function analyzeVolatility(agentId: string): VolatilityMetrics {
  const history = agentHistory.get(agentId) ?? [];

  if (history.length < 2) {
    return emptyVolatility(agentId, history.length);
  }

  const n = history.length;

  // 1. Sentiment volatility (standard deviation)
  const sentiments = history.map((h) => h.sentimentScore);
  const sentimentVolatility = standardDeviation(sentiments);

  // 2. Confidence volatility
  const confidences = history.map((h) => h.confidence);
  const confidenceVolatility = standardDeviation(confidences);

  // 3. Intent drift rate
  let intentChanges = 0;
  for (let i = 1; i < n; i++) {
    if (history[i].intent !== history[i - 1].intent) {
      intentChanges++;
    }
  }
  const intentDriftRate = (n - 1) > 0 ? intentChanges / (n - 1) : 0;

  // 4. Conviction flip rate (per stock)
  const symbolActions = new Map<string, string[]>();
  for (const snap of history) {
    const actions = symbolActions.get(snap.symbol) ?? [];
    actions.push(snap.action);
    symbolActions.set(snap.symbol, actions);
  }

  let totalFlips = 0;
  let totalTransitions = 0;
  for (const actions of symbolActions.values()) {
    for (let i = 1; i < actions.length; i++) {
      totalTransitions++;
      if (
        (actions[i] === "buy" && actions[i - 1] === "sell") ||
        (actions[i] === "sell" && actions[i - 1] === "buy")
      ) {
        totalFlips++;
      }
    }
  }
  const convictionFlipRate = totalTransitions > 0 ? totalFlips / totalTransitions : 0;

  // 5. Length variability (coefficient of variation)
  const lengths = history.map((h) => h.wordCount);
  const avgLength = mean(lengths);
  const lengthVariability = avgLength > 0 ? standardDeviation(lengths) / avgLength : 0;

  // 6. Composite stability score
  const stabilityScore = computeStabilityScore(
    sentimentVolatility,
    confidenceVolatility,
    intentDriftRate,
    convictionFlipRate,
    lengthVariability,
  );

  // 7. Recent trend (last 10 vs overall)
  const recentTrend = computeRecentTrend(history);

  // 8. Per-symbol breakdown
  const bySymbol: Record<string, SymbolVolatility> = {};
  for (const [symbol, actions] of symbolActions) {
    const symbolSnaps = history.filter((h) => h.symbol === symbol);
    const symSentiments = symbolSnaps.map((s) => s.sentimentScore);
    const sentimentObjects = symSentiments.map((sent) => ({ sent }));
    const maxSent = findMax(sentimentObjects, 'sent')?.sent ?? 0;
    const minSent = findMin(sentimentObjects, 'sent')?.sent ?? 0;

    let flips = 0;
    for (let i = 1; i < actions.length; i++) {
      if (
        (actions[i] === "buy" && actions[i - 1] === "sell") ||
        (actions[i] === "sell" && actions[i - 1] === "buy")
      ) {
        flips++;
      }
    }

    bySymbol[symbol] = {
      symbol,
      tradeCount: symbolSnaps.length,
      sentimentRange: Math.round((maxSent - minSent) * SENTIMENT_RANGE_ROUNDING_PRECISION) / SENTIMENT_RANGE_ROUNDING_PRECISION,
      avgConfidence: round3(mean(symbolSnaps.map((s) => s.confidence))),
      flipCount: flips,
      lastAction: actions[actions.length - 1],
    };
  }

  const grade = gradeStability(stabilityScore);
  const assessment = assessStability(
    sentimentVolatility,
    confidenceVolatility,
    intentDriftRate,
    convictionFlipRate,
    stabilityScore,
  );

  return {
    agentId,
    roundsAnalyzed: n,
    sentimentVolatility: round3(sentimentVolatility),
    confidenceVolatility: round3(confidenceVolatility),
    intentDriftRate: round3(intentDriftRate),
    convictionFlipRate: round3(convictionFlipRate),
    lengthVariability: round3(lengthVariability),
    stabilityScore: round3(stabilityScore),
    grade,
    assessment,
    recentTrend,
    bySymbol,
  };
}

/**
 * Compare volatility across all agents.
 */
export function compareAgentVolatility(): {
  agents: VolatilityMetrics[];
  mostStable: string | null;
  mostVolatile: string | null;
  rankings: { agentId: string; stabilityScore: number; rank: number }[];
} {
  const agentIds = [...agentHistory.keys()];
  const agents = agentIds.map((id) => analyzeVolatility(id));

  const ranked = agents
    .filter((a) => a.roundsAnalyzed >= COMPARISON_MIN_ROUNDS)
    .sort((a, b) => b.stabilityScore - a.stabilityScore);

  return {
    agents,
    mostStable: ranked.length > 0 ? ranked[0].agentId : null,
    mostVolatile: ranked.length > 0 ? ranked[ranked.length - 1].agentId : null,
    rankings: ranked.map((a, i) => ({
      agentId: a.agentId,
      stabilityScore: a.stabilityScore,
      rank: i + 1,
    })),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// Note: standardDeviation() now imported from math-utils.ts (Session 132)

function computeStabilityScore(
  sentVol: number,
  confVol: number,
  intentDrift: number,
  flipRate: number,
  lengthVar: number,
): number {
  // Each dimension contributes to instability; convert to stability
  const sentStability = Math.max(0, 1 - sentVol * SENTIMENT_VOLATILITY_MULTIPLIER);
  const confStability = Math.max(0, 1 - confVol * CONFIDENCE_VOLATILITY_MULTIPLIER);
  const intentStability = 1 - intentDrift;
  const flipStability = 1 - flipRate;
  const lengthStability = Math.max(0, 1 - lengthVar);

  // Weighted average
  return (
    sentStability * STABILITY_WEIGHT_SENTIMENT +
    confStability * STABILITY_WEIGHT_CONFIDENCE +
    intentStability * STABILITY_WEIGHT_INTENT +
    flipStability * STABILITY_WEIGHT_FLIP +
    lengthStability * STABILITY_WEIGHT_LENGTH
  );
}

function computeRecentTrend(
  history: ReasoningSnapshot[],
): "stabilizing" | "volatile" | "consistent" {
  if (history.length < TREND_MIN_ROUNDS) return "consistent";

  const recentN = Math.min(TREND_MIN_ROUNDS, Math.floor(history.length / TREND_RECENT_WINDOW_DIVISOR));
  const recent = history.slice(-recentN);
  const older = history.slice(0, -recentN);

  const recentSentVol = standardDeviation(recent.map((h) => h.sentimentScore));
  const olderSentVol = standardDeviation(older.map((h) => h.sentimentScore));

  const recentConfVol = standardDeviation(recent.map((h) => h.confidence));
  const olderConfVol = standardDeviation(older.map((h) => h.confidence));

  const avgRecentVol = (recentSentVol + recentConfVol) / TREND_VOLATILITY_DIMENSIONS;
  const avgOlderVol = (olderSentVol + olderConfVol) / TREND_VOLATILITY_DIMENSIONS;

  if (avgRecentVol < avgOlderVol * TREND_STABILIZING_THRESHOLD) return "stabilizing";
  if (avgRecentVol > avgOlderVol * TREND_VOLATILE_THRESHOLD) return "volatile";
  return "consistent";
}

function gradeStability(score: number): string {
  if (score >= GRADE_THRESHOLD_A_PLUS) return "A+";
  if (score >= GRADE_THRESHOLD_A) return "A";
  if (score >= GRADE_THRESHOLD_A_MINUS) return "A-";
  if (score >= GRADE_THRESHOLD_B_PLUS) return "B+";
  if (score >= GRADE_THRESHOLD_B) return "B";
  if (score >= GRADE_THRESHOLD_B_MINUS) return "B-";
  if (score >= GRADE_THRESHOLD_C_PLUS) return "C+";
  if (score >= GRADE_THRESHOLD_C) return "C";
  if (score >= GRADE_THRESHOLD_D) return "D";
  return "F";
}

function assessStability(
  sentVol: number,
  confVol: number,
  intentDrift: number,
  flipRate: number,
  stabilityScore: number,
): string {
  const parts: string[] = [];

  if (stabilityScore >= ASSESSMENT_HIGH_STABILITY_THRESHOLD) {
    parts.push("Highly consistent reasoning patterns across trading rounds.");
  } else if (stabilityScore >= ASSESSMENT_MODERATE_STABILITY_THRESHOLD) {
    parts.push("Moderately stable reasoning with some variation between rounds.");
  } else {
    parts.push("Volatile reasoning patterns — agent changes approach frequently.");
  }

  if (sentVol > ASSESSMENT_SENTIMENT_VOLATILITY_THRESHOLD) {
    parts.push("High sentiment swings between rounds.");
  }
  if (confVol > ASSESSMENT_CONFIDENCE_VOLATILITY_THRESHOLD) {
    parts.push("Confidence levels vary significantly.");
  }
  if (intentDrift > ASSESSMENT_INTENT_DRIFT_THRESHOLD) {
    parts.push("Frequently switches strategy intent (momentum→value→contrarian).");
  }
  if (flipRate > ASSESSMENT_FLIP_RATE_THRESHOLD) {
    parts.push("Frequently reverses conviction on the same stocks.");
  }

  return parts.join(" ");
}


function emptyVolatility(agentId: string, rounds: number): VolatilityMetrics {
  return {
    agentId,
    roundsAnalyzed: rounds,
    sentimentVolatility: 0,
    confidenceVolatility: 0,
    intentDriftRate: 0,
    convictionFlipRate: 0,
    lengthVariability: 0,
    stabilityScore: 1,
    grade: "N/A",
    assessment: "Insufficient data for volatility analysis (need 2+ rounds).",
    recentTrend: "consistent",
    bySymbol: {},
  };
}
