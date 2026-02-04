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

  forecast.actualDirection = priceChangePct > 0.005 ? "up"
    : priceChangePct < -0.005 ? "down"
    : "flat";
  forecast.actualMagnitude = priceChangePct;
  forecast.directionCorrect =
    forecast.predictedDirection === forecast.actualDirection ||
    (forecast.predictedDirection === "up" && priceChangePct > 0) ||
    (forecast.predictedDirection === "down" && priceChangePct < 0) ||
    (forecast.predictedDirection === "flat" && Math.abs(priceChangePct) < 0.01);

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
  const buckets: { range: string; min: number; max: number }[] = [
    { range: "0.0-0.25", min: 0, max: 0.25 },
    { range: "0.25-0.50", min: 0.25, max: 0.50 },
    { range: "0.50-0.75", min: 0.50, max: 0.75 },
    { range: "0.75-1.0", min: 0.75, max: 1.0 },
  ];

  return buckets.map(b => {
    const inBucket = resolved.filter(f => f.confidence >= b.min && f.confidence < (b.max === 1.0 ? 1.01 : b.max));
    const correct = inBucket.filter(f => f.directionCorrect).length;
    const withMag = inBucket.filter(f => f.magnitudeError !== undefined);
    const magSum = withMag.reduce((s, f) => s + (f.magnitudeError ?? 0), 0);

    return {
      range: b.range,
      count: inBucket.length,
      directionAccuracy: inBucket.length > 0 ? Math.round((correct / inBucket.length) * 100) / 100 : 0,
      avgMagnitudeError: withMag.length > 0 ? Math.round((magSum / withMag.length) * 1000) / 1000 : 0,
    };
  });
}

function computeLearningVelocity(agentForecasts: TradeImpactForecast[]): number {
  const resolved = agentForecasts.filter(f => f.status === "resolved");
  if (resolved.length < 10) return 0.5; // Not enough data

  const mid = Math.floor(resolved.length / 2);
  const firstHalf = resolved.slice(mid);
  const secondHalf = resolved.slice(0, mid);

  const firstAccuracy = firstHalf.filter(f => f.directionCorrect).length / firstHalf.length;
  const secondAccuracy = secondHalf.filter(f => f.directionCorrect).length / secondHalf.length;

  const improvement = secondAccuracy - firstAccuracy;
  // Normalize to 0-1: -0.3 = 0, 0 = 0.5, +0.3 = 1
  return Math.round(Math.max(0, Math.min(1, 0.5 + improvement * 1.667)) * 100) / 100;
}

function computeConvictionCorrelation(agentForecasts: TradeImpactForecast[]): number {
  const resolved = agentForecasts.filter(f => f.status === "resolved");
  if (resolved.length < 5) return 0;

  // Simple: does higher confidence predict correct direction?
  const highConf = resolved.filter(f => f.confidence > 0.7);
  const lowConf = resolved.filter(f => f.confidence <= 0.4);

  const highAccuracy = highConf.length > 0
    ? highConf.filter(f => f.directionCorrect).length / highConf.length
    : 0.5;
  const lowAccuracy = lowConf.length > 0
    ? lowConf.filter(f => f.directionCorrect).length / lowConf.length
    : 0.5;

  // Positive correlation: high confidence → better accuracy
  const correlation = highAccuracy - lowAccuracy;
  // Normalize to 0-1: -0.5 = 0, 0 = 0.5, +0.5 = 1
  return Math.round(Math.max(0, Math.min(1, 0.5 + correlation)) * 100) / 100;
}

export function getAgentImpactProfile(agentId: string): AgentImpactProfile {
  const agentForecasts = forecasts.filter(f => f.agentId === agentId);
  const resolved = agentForecasts.filter(f => f.status === "resolved");

  const directionCorrect = resolved.filter(f => f.directionCorrect).length;
  const directionAccuracy = resolved.length > 0
    ? Math.round((directionCorrect / resolved.length) * 100) / 100
    : 0;

  const withMag = resolved.filter(f => f.magnitudeError !== undefined);
  const avgMagError = withMag.length > 0
    ? Math.round((withMag.reduce((s, f) => s + (f.magnitudeError ?? 0), 0) / withMag.length) * 1000) / 1000
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
    if (stats.total < 2) continue;
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
    directionAccuracy * 0.30 +
    (1 - Math.min(1, avgMagError * 10)) * 0.15 +
    convictionCorrelation * 0.20 +
    horizonUsageRate * 0.10 +
    learningVelocity * 0.25
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
  const correct = resolved.filter(f => f.directionCorrect).length;
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
      ? Math.round((magSum / withMag.length) * 1000) / 1000
      : 0,
    horizonUsageRate: forecasts.length > 0
      ? Math.round((withHorizon.length / forecasts.length) * 100) / 100
      : 0,
  };
}
