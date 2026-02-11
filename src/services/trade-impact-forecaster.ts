/**
 * Trade Impact Forecaster (v19)
 *
 * Measures whether agents understand the IMPACT of their trades:
 * - Did the agent predict the direction correctly?
 * - Did the agent estimate magnitude of move?
 * - Is the agent's win streak correlated with confidence?
 * - Does the agent improve prediction accuracy over time?
 *
 * This is the "prediction accountability" pillar — agents can't just
 * make vague claims, they need to produce verifiable forecasts.
 *
 * Dimensions:
 * 1. DIRECTION ACCURACY — buy prediction goes up, sell prediction goes down
 * 2. MAGNITUDE CALIBRATION — predicted X%, actual Y%, how close?
 * 3. HORIZON AWARENESS — did agent specify timeframe? Was it appropriate?
 * 4. CONVICTION-OUTCOME CORRELATION — high confidence = better results?
 * 5. LEARNING VELOCITY — is prediction accuracy improving over time?
 */

import { clamp, countByCondition, round2, round3 } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Price change direction classification thresholds.
 *
 * These control when actual price movements are classified as up/down/flat:
 * - UP: price change > 0.5%
 * - DOWN: price change < -0.5%
 * - FLAT: |price change| < 1.0%
 */
const DIRECTION_UP_THRESHOLD = 0.005; // 0.5%
const DIRECTION_DOWN_THRESHOLD = -0.005; // -0.5%
const DIRECTION_FLAT_THRESHOLD = 0.01; // 1.0%

/**
 * Confidence bucket boundaries for calibration analysis.
 *
 * Divides confidence range into 4 quartiles:
 * - Low: 0.0-0.25
 * - Moderate: 0.25-0.50
 * - High: 0.50-0.75
 * - Very High: 0.75-1.0
 */
const CONFIDENCE_BUCKET_BOUNDARIES = [
  { range: "0.0-0.25", min: 0, max: 0.25 },
  { range: "0.25-0.50", min: 0.25, max: 0.50 },
  { range: "0.50-0.75", min: 0.50, max: 0.75 },
  { range: "0.75-1.0", min: 0.75, max: 1.0 },
] as const;

/**
 * Upper bound offset to include confidence=1.0 in top bucket.
 *
 * Ensures forecasts with exactly 100% confidence fall into the 0.75-1.0 bucket
 * (since bucket check is `confidence < max`, not `<=`).
 */
const CONFIDENCE_UPPER_BOUND_OFFSET = 1.01;

/**
 * Learning velocity calculation parameters.
 *
 * Controls how agent improvement over time is measured:
 * - MIN_RESOLVED_FOR_LEARNING: Need at least 10 resolved forecasts to calculate velocity
 * - LEARNING_NORMALIZATION_MULTIPLIER: Maps accuracy delta to 0-1 score (1.667 = ±0.3 accuracy → 0-1)
 * - LEARNING_DEFAULT_SCORE: Return 0.5 (neutral) when insufficient data
 */
const MIN_RESOLVED_FOR_LEARNING = 10;
const LEARNING_NORMALIZATION_MULTIPLIER = 1.667;
const LEARNING_DEFAULT_SCORE = 0.5;

/**
 * Conviction correlation thresholds.
 *
 * Defines confidence ranges for correlation analysis:
 * - HIGH_CONFIDENCE: > 70% (should predict correctly more often)
 * - LOW_CONFIDENCE: ≤ 40% (expected to be less accurate)
 * - DEFAULT_CORRELATION: 0.5 (neutral, when insufficient data)
 */
const CONFIDENCE_HIGH_THRESHOLD = 0.7;
const CONFIDENCE_LOW_THRESHOLD = 0.4;
const DEFAULT_CONVICTION_CORRELATION = 0.5;

/**
 * Minimum resolved forecasts for conviction correlation.
 *
 * Need at least 5 resolved forecasts to calculate meaningful correlation
 * between confidence level and accuracy.
 */
const MIN_RESOLVED_FOR_CORRELATION = 5;

/**
 * Composite score dimension weights.
 *
 * Determines how each impact dimension contributes to overall score:
 * - Direction accuracy: 30% (most important — did agent predict direction?)
 * - Magnitude calibration: 15% (how close was magnitude estimate?)
 * - Conviction correlation: 20% (does confidence predict outcomes?)
 * - Horizon usage: 10% (bonus for specifying timeframe)
 * - Learning velocity: 25% (is agent improving over time?)
 *
 * Total: 100% (0.30 + 0.15 + 0.20 + 0.10 + 0.25 = 1.00)
 */
const COMPOSITE_WEIGHT_DIRECTION = 0.30;
const COMPOSITE_WEIGHT_MAGNITUDE = 0.15;
const COMPOSITE_WEIGHT_CONVICTION = 0.20;
const COMPOSITE_WEIGHT_HORIZON = 0.10;
const COMPOSITE_WEIGHT_LEARNING = 0.25;

/**
 * Magnitude error multiplier for composite score.
 *
 * Converts magnitude error (0-1.0) to penalty in composite calculation.
 * Error is capped at 1.0, then multiplied by 10 before applying weight.
 *
 * Example: 5% error → 0.05 * 10 = 0.5 → (1 - 0.5) * 0.15 = 0.075 contribution
 */
const MAGNITUDE_ERROR_MULTIPLIER = 10;

/**
 * Minimum resolved forecasts for streak calculation.
 *
 * Need at least 2 resolved forecasts to identify win/loss patterns.
 */
const MIN_RESOLVED_FOR_STREAK = 2;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TradeImpactForecast {
  forecastId: string;
  agentId: string;
  roundId: string;
  symbol: string;
  action: string;
  confidence: number;
  /** Agent's predicted direction */
  predictedDirection: "up" | "down" | "flat" | "unknown";
  /** Agent's predicted magnitude (if extractable) */
  predictedMagnitude: number | null;
  /** Agent's predicted horizon (if extractable) */
  predictedHorizon: string | null;
  /** Actual direction */
  actualDirection?: "up" | "down" | "flat";
  /** Actual magnitude */
  actualMagnitude?: number;
  /** Was the direction correct? */
  directionCorrect?: boolean;
  /** Magnitude error (absolute) */
  magnitudeError?: number;
  /** Resolution status */
  status: "pending" | "resolved" | "expired";
  /** When it was created */
  createdAt: string;
  /** When it was resolved */
  resolvedAt?: string;
}

export interface AgentImpactProfile {
  agentId: string;
  totalForecasts: number;
  resolvedForecasts: number;
  directionAccuracy: number;
  avgMagnitudeError: number;
  convictionCorrelation: number;
  horizonUsageRate: number;
  learningVelocity: number;
  bestSymbol: string;
  worstSymbol: string;
  streakInfo: {
    currentStreak: number;
    currentStreakType: "win" | "loss" | "none";
    longestWinStreak: number;
    longestLossStreak: number;
  };
  confidenceBuckets: ConfidenceBucket[];
  compositeScore: number;
}

export interface ConfidenceBucket {
  range: string;
  count: number;
  directionAccuracy: number;
  avgMagnitudeError: number;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const forecasts: TradeImpactForecast[] = [];
const MAX_FORECASTS = 5000;

// ---------------------------------------------------------------------------
// Extraction Helpers
// ---------------------------------------------------------------------------

/**
 * Infer predicted direction from reasoning + action.
 */
function inferDirection(reasoning: string, action: string): "up" | "down" | "flat" | "unknown" {
  if (action === "buy") return "up";
  if (action === "sell") return "down";

  // For hold, look at reasoning
  const lower = reasoning.toLowerCase();
  if (/sideways|flat|range[- ]bound|consolidat/i.test(lower)) return "flat";
  if (/bullish|upside|growth|rally/i.test(lower)) return "up";
  if (/bearish|downside|decline|correction/i.test(lower)) return "down";
  return "unknown";
}

/**
 * Extract predicted magnitude from reasoning.
 * Looks for patterns like "expect 5% gain", "target $200", etc.
 */
function extractMagnitude(reasoning: string): number | null {
  // Pattern: "X% gain/loss/move/upside/downside"
  const pctMatch = reasoning.match(/(\d+\.?\d*)%\s+(?:gain|upside|appreciation|increase|growth)/i);
  if (pctMatch) return parseFloat(pctMatch[1]) / 100;

  const pctLossMatch = reasoning.match(/(\d+\.?\d*)%\s+(?:loss|downside|decline|decrease|drop)/i);
  if (pctLossMatch) return -parseFloat(pctLossMatch[1]) / 100;

  // Pattern: "target $X" vs current implied
  // We can't extract this without current price, so skip
  return null;
}

/**
 * Extract predicted time horizon from reasoning.
 */
function extractHorizon(reasoning: string): string | null {
  const patterns: [RegExp, string][] = [
    [/\b(?:short[- ]term|next\s+few\s+hours?|intraday)\b/i, "intraday"],
    [/\b(?:next\s+(?:1-2|few)\s+days?|24[- ]?48\s*h|tomorrow)\b/i, "1-2 days"],
    [/\b(?:this\s+week|next\s+week|within\s+a\s+week|5\s+days?)\b/i, "1 week"],
    [/\b(?:next\s+(?:2|two)\s+weeks?|fortnight)\b/i, "2 weeks"],
    [/\b(?:this\s+month|next\s+month|30\s+days?)\b/i, "1 month"],
    [/\b(?:long[- ]term|quarter|several\s+months?|this\s+year)\b/i, "3+ months"],
  ];

  for (const [pattern, horizon] of patterns) {
    if (pattern.test(reasoning)) return horizon;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Core Forecasting
// ---------------------------------------------------------------------------

/**
 * Register a trade forecast from an agent's reasoning.
 */
export function registerForecast(
  agentId: string,
  roundId: string,
  symbol: string,
  action: string,
  reasoning: string,
  confidence: number,
): TradeImpactForecast {
  const forecast: TradeImpactForecast = {
    forecastId: `fcst_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    agentId,
    roundId,
    symbol,
    action,
    confidence,
    predictedDirection: inferDirection(reasoning, action),
    predictedMagnitude: extractMagnitude(reasoning),
    predictedHorizon: extractHorizon(reasoning),
    status: "pending",
    createdAt: new Date().toISOString(),
  };

  forecasts.unshift(forecast);
  if (forecasts.length > MAX_FORECASTS) forecasts.length = MAX_FORECASTS;

  return forecast;
}

/**
 * Resolve a forecast with actual market data.
 */
export function resolveForecast(
  forecastId: string,
  priceChangePct: number,
): TradeImpactForecast | null {
  const forecast = forecasts.find(f => f.forecastId === forecastId);
  if (!forecast || forecast.status !== "pending") return null;

  forecast.actualDirection = priceChangePct > DIRECTION_UP_THRESHOLD ? "up"
    : priceChangePct < DIRECTION_DOWN_THRESHOLD ? "down"
    : "flat";
  forecast.actualMagnitude = priceChangePct;
  forecast.directionCorrect =
    forecast.predictedDirection === forecast.actualDirection ||
    (forecast.predictedDirection === "up" && priceChangePct > 0) ||
    (forecast.predictedDirection === "down" && priceChangePct < 0) ||
    (forecast.predictedDirection === "flat" && Math.abs(priceChangePct) < DIRECTION_FLAT_THRESHOLD);

  if (forecast.predictedMagnitude !== null) {
    forecast.magnitudeError = Math.abs(forecast.predictedMagnitude - priceChangePct);
  }

  forecast.status = "resolved";
  forecast.resolvedAt = new Date().toISOString();

  return forecast;
}

/**
 * Batch-resolve pending forecasts for a symbol.
 */
export function batchResolvePending(
  symbol: string,
  priceChangePct: number,
): number {
  let resolved = 0;
  for (const f of forecasts) {
    if (f.symbol === symbol && f.status === "pending") {
      resolveForecast(f.forecastId, priceChangePct);
      resolved++;
    }
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Profile Aggregation
// ---------------------------------------------------------------------------

function computeStreakInfo(agentForecasts: TradeImpactForecast[]): {
  currentStreak: number;
  currentStreakType: "win" | "loss" | "none";
  longestWinStreak: number;
  longestLossStreak: number;
} {
  const resolved = agentForecasts.filter(f => f.status === "resolved");
  if (resolved.length === 0) {
    return { currentStreak: 0, currentStreakType: "none", longestWinStreak: 0, longestLossStreak: 0 };
  }

  let currentStreak = 0;
  let currentType: "win" | "loss" | "none" = "none";
  let longestWin = 0;
  let longestLoss = 0;
  let winStreak = 0;
  let lossStreak = 0;

  for (const f of resolved) {
    if (f.directionCorrect) {
      winStreak++;
      lossStreak = 0;
      longestWin = Math.max(longestWin, winStreak);
    } else {
      lossStreak++;
      winStreak = 0;
      longestLoss = Math.max(longestLoss, lossStreak);
    }
  }

  // Current streak
  for (const f of resolved) {
    if (currentType === "none") {
      currentType = f.directionCorrect ? "win" : "loss";
      currentStreak = 1;
    } else if ((currentType === "win" && f.directionCorrect) ||
               (currentType === "loss" && !f.directionCorrect)) {
      currentStreak++;
    } else {
      break;
    }
  }

  return { currentStreak, currentStreakType: currentType, longestWinStreak: longestWin, longestLossStreak: longestLoss };
}

function computeConfidenceBuckets(agentForecasts: TradeImpactForecast[]): ConfidenceBucket[] {
  const resolved = agentForecasts.filter(f => f.status === "resolved");

  return CONFIDENCE_BUCKET_BOUNDARIES.map(b => {
    const inBucket = resolved.filter(f => f.confidence >= b.min && f.confidence < (b.max === 1.0 ? CONFIDENCE_UPPER_BOUND_OFFSET : b.max));
    const correct = countByCondition(inBucket, f => f.directionCorrect === true);
    const withMag = inBucket.filter(f => f.magnitudeError !== undefined);
    const magSum = withMag.reduce((s, f) => s + (f.magnitudeError ?? 0), 0);

    return {
      range: b.range,
      count: inBucket.length,
      directionAccuracy: inBucket.length > 0 ? Math.round((correct / inBucket.length) * 100) / 100 : 0,
      avgMagnitudeError: withMag.length > 0 ? round3(magSum / withMag.length) : 0,
    };
  });
}

function computeLearningVelocity(agentForecasts: TradeImpactForecast[]): number {
  const resolved = agentForecasts.filter(f => f.status === "resolved");
  if (resolved.length < MIN_RESOLVED_FOR_LEARNING) return LEARNING_DEFAULT_SCORE;

  const mid = Math.floor(resolved.length / 2);
  const firstHalf = resolved.slice(mid);
  const secondHalf = resolved.slice(0, mid);

  const firstAccuracy = countByCondition(firstHalf, f => f.directionCorrect === true) / firstHalf.length;
  const secondAccuracy = countByCondition(secondHalf, f => f.directionCorrect === true) / secondHalf.length;

  const improvement = secondAccuracy - firstAccuracy;
  // Normalize to 0-1: -0.3 = 0, 0 = 0.5, +0.3 = 1
  return round2(clamp(LEARNING_DEFAULT_SCORE + improvement * LEARNING_NORMALIZATION_MULTIPLIER, 0, 1));
}

function computeConvictionCorrelation(agentForecasts: TradeImpactForecast[]): number {
  const resolved = agentForecasts.filter(f => f.status === "resolved");
  if (resolved.length < MIN_RESOLVED_FOR_CORRELATION) return 0;

  // Simple: does higher confidence predict correct direction?
  const highConf = resolved.filter(f => f.confidence > CONFIDENCE_HIGH_THRESHOLD);
  const lowConf = resolved.filter(f => f.confidence <= CONFIDENCE_LOW_THRESHOLD);

  const highAccuracy = highConf.length > 0
    ? countByCondition(highConf, f => f.directionCorrect === true) / highConf.length
    : DEFAULT_CONVICTION_CORRELATION;
  const lowAccuracy = lowConf.length > 0
    ? countByCondition(lowConf, f => f.directionCorrect === true) / lowConf.length
    : DEFAULT_CONVICTION_CORRELATION;

  // Positive correlation: high confidence → better accuracy
  const correlation = highAccuracy - lowAccuracy;
  // Normalize to 0-1: -0.5 = 0, 0 = 0.5, +0.5 = 1
  return round2(clamp(DEFAULT_CONVICTION_CORRELATION + correlation, 0, 1));
}

export function getAgentImpactProfile(agentId: string): AgentImpactProfile {
  const agentForecasts = forecasts.filter(f => f.agentId === agentId);
  const resolved = agentForecasts.filter(f => f.status === "resolved");

  const directionCorrect = countByCondition(resolved, f => f.directionCorrect === true);
  const directionAccuracy = resolved.length > 0
    ? Math.round((directionCorrect / resolved.length) * 100) / 100
    : 0;

  const withMag = resolved.filter(f => f.magnitudeError !== undefined);
  const avgMagError = withMag.length > 0
    ? round3(withMag.reduce((s, f) => s + (f.magnitudeError ?? 0), 0) / withMag.length)
    : 0;

  const withHorizon = agentForecasts.filter(f => f.predictedHorizon !== null);
  const horizonUsageRate = agentForecasts.length > 0
    ? Math.round((withHorizon.length / agentForecasts.length) * 100) / 100
    : 0;

  // Symbol performance
  const symbolStats = new Map<string, { correct: number; total: number }>();
  for (const f of resolved) {
    const existing = symbolStats.get(f.symbol) ?? { correct: 0, total: 0 };
    existing.total++;
    if (f.directionCorrect) existing.correct++;
    symbolStats.set(f.symbol, existing);
  }

  let bestSymbol = "none";
  let worstSymbol = "none";
  let bestRate = -1;
  let worstRate = 2;
  for (const [symbol, stats] of symbolStats) {
    if (stats.total < MIN_RESOLVED_FOR_STREAK) continue;
    const rate = stats.correct / stats.total;
    if (rate > bestRate) { bestRate = rate; bestSymbol = symbol; }
    if (rate < worstRate) { worstRate = rate; worstSymbol = symbol; }
  }

  const streakInfo = computeStreakInfo(agentForecasts);
  const confidenceBuckets = computeConfidenceBuckets(agentForecasts);
  const learningVelocity = computeLearningVelocity(agentForecasts);
  const convictionCorrelation = computeConvictionCorrelation(agentForecasts);

  // Composite score
  const compositeScore = Math.round((
    directionAccuracy * COMPOSITE_WEIGHT_DIRECTION +
    (1 - Math.min(1, avgMagError * MAGNITUDE_ERROR_MULTIPLIER)) * COMPOSITE_WEIGHT_MAGNITUDE +
    convictionCorrelation * COMPOSITE_WEIGHT_CONVICTION +
    horizonUsageRate * COMPOSITE_WEIGHT_HORIZON +
    learningVelocity * COMPOSITE_WEIGHT_LEARNING
  ) * 100) / 100;

  return {
    agentId,
    totalForecasts: agentForecasts.length,
    resolvedForecasts: resolved.length,
    directionAccuracy,
    avgMagnitudeError: avgMagError,
    convictionCorrelation,
    horizonUsageRate,
    learningVelocity,
    bestSymbol,
    worstSymbol,
    streakInfo,
    confidenceBuckets,
    compositeScore,
  };
}

export function getAllImpactProfiles(): AgentImpactProfile[] {
  const agentIds = new Set<string>();
  for (const f of forecasts) agentIds.add(f.agentId);
  return [...agentIds].map(getAgentImpactProfile);
}

export function getImpactPillarScore(agentId: string): number {
  const profile = getAgentImpactProfile(agentId);
  return profile.compositeScore;
}

export function getRecentForecasts(limit: number = 30, agentId?: string): TradeImpactForecast[] {
  let filtered = forecasts;
  if (agentId) filtered = filtered.filter(f => f.agentId === agentId);
  return filtered.slice(0, limit);
}

export function getPendingForecasts(): TradeImpactForecast[] {
  return forecasts.filter(f => f.status === "pending");
}

export function getImpactStats(): {
  totalForecasts: number;
  resolvedForecasts: number;
  pendingForecasts: number;
  overallDirectionAccuracy: number;
  avgMagnitudeError: number;
  horizonUsageRate: number;
} {
  const resolved = forecasts.filter(f => f.status === "resolved");
  const pending = forecasts.filter(f => f.status === "pending");
  const correct = countByCondition(resolved, f => f.directionCorrect === true);
  const withMag = resolved.filter(f => f.magnitudeError !== undefined);
  const magSum = withMag.reduce((s, f) => s + (f.magnitudeError ?? 0), 0);
  const withHorizon = forecasts.filter(f => f.predictedHorizon !== null);

  return {
    totalForecasts: forecasts.length,
    resolvedForecasts: resolved.length,
    pendingForecasts: pending.length,
    overallDirectionAccuracy: resolved.length > 0
      ? Math.round((correct / resolved.length) * 100) / 100
      : 0,
    avgMagnitudeError: withMag.length > 0
      ? round3(magSum / withMag.length)
      : 0,
    horizonUsageRate: forecasts.length > 0
      ? Math.round((withHorizon.length / forecasts.length) * 100) / 100
      : 0,
  };
}
