/**
 * Market Regime Correlation Engine
 *
 * Tracks how agent reasoning quality varies across different market conditions.
 * This is essential for a credible benchmark because agents that perform well
 * in calm markets but fall apart during volatility are fundamentally weaker.
 *
 * Key insight: Most AI benchmarks test static scenarios. MoltApp tests agents
 * across LIVE market regimes — bull, bear, sideways, high-vol, low-vol.
 *
 * Features:
 * 1. REGIME DETECTION: Classify current market conditions
 * 2. PER-REGIME SCORING: Track coherence/depth/hallucination per regime
 * 3. REGIME ROBUSTNESS: Score agents on consistency across regimes
 * 4. STRESS ANALYSIS: How does reasoning quality change under volatility?
 * 5. ADAPTATION SPEED: How quickly do agents adjust to regime changes?
 */

import { normalize } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MarketRegime =
  | "bull_calm"       // Rising prices, low volatility
  | "bull_volatile"   // Rising prices, high volatility
  | "bear_calm"       // Falling prices, low volatility
  | "bear_volatile"   // Falling prices, high volatility (crash/panic)
  | "sideways"        // Range-bound, normal volatility
  | "uncertain";      // No clear direction

export interface RegimeSnapshot {
  regime: MarketRegime;
  avgChange: number;        // Avg 24h change across stocks
  maxChange: number;        // Largest absolute 24h change
  changeStdDev: number;     // Volatility measure
  stocksUp: number;         // Count of stocks with positive change
  stocksDown: number;       // Count of stocks with negative change
  timestamp: string;
}

export interface RegimePerformance {
  regime: MarketRegime;
  tradeCount: number;
  avgCoherence: number;
  avgDepth: number;
  hallucinationRate: number;
  avgConfidence: number;
  confidenceCalibration: number; // Were high-conf trades in this regime correct?
  actionDistribution: { buy: number; sell: number; hold: number };
}

export interface AgentRegimeProfile {
  agentId: string;
  regimePerformance: RegimePerformance[];
  /** Robustness: consistency of quality across regimes (0-1, higher = more robust) */
  robustnessScore: number;
  /** Which regime the agent performs best in */
  bestRegime: MarketRegime;
  /** Which regime the agent struggles most in */
  worstRegime: MarketRegime;
  /** How quickly the agent adapts to regime changes (rounds to normalize) */
  adaptationSpeed: number;
  /** Overall regime-adjusted benchmark score */
  regimeAdjustedScore: number;
  totalTradesAnalyzed: number;
}

export interface RegimeReport {
  currentRegime: RegimeSnapshot;
  regimeHistory: RegimeSnapshot[];
  agentProfiles: AgentRegimeProfile[];
  /** Which agent is most robust across regimes? */
  mostRobust: string | null;
  /** Which agent is least robust? */
  leastRobust: string | null;
  /** Current regime's impact on reasoning quality */
  regimeImpact: {
    regime: MarketRegime;
    avgCoherenceChange: number; // vs all-time avg
    avgDepthChange: number;
    hallucinationRateChange: number;
  };
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface RegimeTradeEntry {
  agentId: string;
  regime: MarketRegime;
  coherenceScore: number;
  depthScore: number;
  hadHallucinations: boolean;
  confidence: number;
  action: "buy" | "sell" | "hold";
  wasCorrect: boolean | null; // null = outcome unknown
  roundId: string;
  timestamp: string;
}

const tradeEntries: RegimeTradeEntry[] = [];
const regimeHistory: RegimeSnapshot[] = [];
const MAX_ENTRIES = 5000;
const MAX_REGIME_HISTORY = 500;

// ---------------------------------------------------------------------------
// Regime Detection
// ---------------------------------------------------------------------------

/**
 * Classify the current market regime from price data.
 */
export function detectMarketRegime(
  marketData: Array<{ symbol: string; price: number; change24h: number | null }>,
): RegimeSnapshot {
  const changes = marketData
    .map((d) => d.change24h)
    .filter((c): c is number => c !== null);

  if (changes.length === 0) {
    return {
      regime: "uncertain",
      avgChange: 0,
      maxChange: 0,
      changeStdDev: 0,
      stocksUp: 0,
      stocksDown: 0,
      timestamp: new Date().toISOString(),
    };
  }

  const avgChange = changes.reduce((s, c) => s + c, 0) / changes.length;
  const maxChange = Math.max(...changes.map(Math.abs));
  const variance = changes.reduce((s, c) => s + (c - avgChange) ** 2, 0) / changes.length;
  const changeStdDev = Math.sqrt(variance);
  const stocksUp = changes.filter((c) => c > 0).length;
  const stocksDown = changes.filter((c) => c < 0).length;

  // Classify regime
  const isVolatile = changeStdDev > 2.5 || maxChange > 5;
  const isBull = avgChange > 0.5;
  const isBear = avgChange < -0.5;

  let regime: MarketRegime;
  if (isBull && isVolatile) regime = "bull_volatile";
  else if (isBull) regime = "bull_calm";
  else if (isBear && isVolatile) regime = "bear_volatile";
  else if (isBear) regime = "bear_calm";
  else if (Math.abs(avgChange) <= 0.5 && !isVolatile) regime = "sideways";
  else regime = "uncertain";

  const snapshot: RegimeSnapshot = {
    regime,
    avgChange: Math.round(avgChange * 100) / 100,
    maxChange: Math.round(maxChange * 100) / 100,
    changeStdDev: Math.round(changeStdDev * 100) / 100,
    stocksUp,
    stocksDown,
    timestamp: new Date().toISOString(),
  };

  // Store regime history
  regimeHistory.unshift(snapshot);
  if (regimeHistory.length > MAX_REGIME_HISTORY) {
    regimeHistory.length = MAX_REGIME_HISTORY;
  }

  return snapshot;
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

/**
 * Record a trade's reasoning quality tagged with the current market regime.
 */
export function recordRegimeTradeEntry(
  agentId: string,
  regime: MarketRegime,
  coherenceScore: number,
  depthScore: number,
  hadHallucinations: boolean,
  confidence: number,
  action: "buy" | "sell" | "hold",
  roundId: string,
): void {
  tradeEntries.unshift({
    agentId,
    regime,
    coherenceScore,
    depthScore,
    hadHallucinations,
    confidence,
    action,
    wasCorrect: null, // filled later by outcome tracker
    roundId,
    timestamp: new Date().toISOString(),
  });

  if (tradeEntries.length > MAX_ENTRIES) {
    tradeEntries.length = MAX_ENTRIES;
  }
}

/**
 * Update outcome for a trade (called when outcome is known).
 */
export function updateRegimeTradeOutcome(
  agentId: string,
  roundId: string,
  wasCorrect: boolean,
): void {
  const entry = tradeEntries.find(
    (e) => e.agentId === agentId && e.roundId === roundId,
  );
  if (entry) {
    entry.wasCorrect = wasCorrect;
  }
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

/**
 * Get regime-adjusted performance profile for an agent.
 */
export function getAgentRegimeProfile(agentId: string): AgentRegimeProfile {
  const agentEntries = tradeEntries.filter((e) => e.agentId === agentId);

  if (agentEntries.length === 0) {
    return {
      agentId,
      regimePerformance: [],
      robustnessScore: 0,
      bestRegime: "uncertain",
      worstRegime: "uncertain",
      adaptationSpeed: 0,
      regimeAdjustedScore: 0,
      totalTradesAnalyzed: 0,
    };
  }

  // Group by regime
  const regimes: MarketRegime[] = [
    "bull_calm", "bull_volatile", "bear_calm", "bear_volatile", "sideways", "uncertain",
  ];

  const regimePerformance: RegimePerformance[] = [];
  const regimeScores: number[] = [];

  for (const regime of regimes) {
    const regimeEntries = agentEntries.filter((e) => e.regime === regime);
    if (regimeEntries.length === 0) continue;

    const avgCoherence = Math.round(
      (regimeEntries.reduce((s, e) => s + e.coherenceScore, 0) / regimeEntries.length) * 100,
    ) / 100;

    const avgDepth = Math.round(
      (regimeEntries.reduce((s, e) => s + e.depthScore, 0) / regimeEntries.length) * 100,
    ) / 100;

    const hallucinationRate = Math.round(
      (regimeEntries.filter((e) => e.hadHallucinations).length / regimeEntries.length) * 100,
    ) / 100;

    const avgConfidence = Math.round(
      (regimeEntries.reduce((s, e) => s + e.confidence, 0) / regimeEntries.length) * 100,
    ) / 100;

    // Confidence calibration: correlation between confidence and correctness
    const withOutcomes = regimeEntries.filter((e) => e.wasCorrect !== null);
    let confidenceCalibration = 0.5;
    if (withOutcomes.length >= 3) {
      const highConf = withOutcomes.filter((e) => e.confidence > 0.6);
      const lowConf = withOutcomes.filter((e) => e.confidence <= 0.6);
      const highWinRate = highConf.length > 0
        ? highConf.filter((e) => e.wasCorrect).length / highConf.length
        : 0.5;
      const lowWinRate = lowConf.length > 0
        ? lowConf.filter((e) => e.wasCorrect).length / lowConf.length
        : 0.5;
      // Good calibration: high confidence -> higher win rate
      confidenceCalibration = Math.round(
        normalize(0.5 + (highWinRate - lowWinRate)) * 100,
      ) / 100;
    }

    const actionDist = {
      buy: regimeEntries.filter((e) => e.action === "buy").length,
      sell: regimeEntries.filter((e) => e.action === "sell").length,
      hold: regimeEntries.filter((e) => e.action === "hold").length,
    };

    const perf: RegimePerformance = {
      regime,
      tradeCount: regimeEntries.length,
      avgCoherence,
      avgDepth,
      hallucinationRate,
      avgConfidence,
      confidenceCalibration,
      actionDistribution: actionDist,
    };
    regimePerformance.push(perf);

    // Composite score for this regime
    const halFree = 1 - hallucinationRate;
    const compositeScore = avgCoherence * 0.3 + avgDepth * 0.25 +
      halFree * 0.25 + confidenceCalibration * 0.2;
    regimeScores.push(compositeScore);
  }

  // Robustness: 1 - (stddev of regime scores / mean)
  let robustnessScore = 0.5;
  if (regimeScores.length >= 2) {
    const mean = regimeScores.reduce((s, v) => s + v, 0) / regimeScores.length;
    const variance = regimeScores.reduce((s, v) => s + (v - mean) ** 2, 0) / regimeScores.length;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 1;
    robustnessScore = Math.round(normalize(1 - cv) * 100) / 100;
  }

  // Best and worst regime
  const sortedPerf = [...regimePerformance].sort((a, b) => {
    const scoreA = a.avgCoherence * 0.4 + a.avgDepth * 0.3 + (1 - a.hallucinationRate) * 0.3;
    const scoreB = b.avgCoherence * 0.4 + b.avgDepth * 0.3 + (1 - b.hallucinationRate) * 0.3;
    return scoreB - scoreA;
  });

  const bestRegime = sortedPerf[0]?.regime ?? "uncertain";
  const worstRegime = sortedPerf.length > 0 ? sortedPerf[sortedPerf.length - 1].regime : "uncertain";

  // Adaptation speed: how many rounds after a regime change before quality stabilizes?
  const adaptationSpeed = computeAdaptationSpeed(agentEntries);

  // Regime-adjusted score: weighted average of per-regime scores
  const regimeAdjustedScore = regimeScores.length > 0
    ? Math.round((regimeScores.reduce((s, v) => s + v, 0) / regimeScores.length) * 100) / 100
    : 0;

  return {
    agentId,
    regimePerformance,
    robustnessScore,
    bestRegime,
    worstRegime,
    adaptationSpeed,
    regimeAdjustedScore,
    totalTradesAnalyzed: agentEntries.length,
  };
}

function computeAdaptationSpeed(entries: RegimeTradeEntry[]): number {
  if (entries.length < 4) return 0.5;

  // Look at quality right after regime changes
  let transitionScores: number[] = [];
  let steadyScores: number[] = [];

  for (let i = 1; i < entries.length; i++) {
    const isTransition = entries[i].regime !== entries[i - 1]?.regime;
    const score = entries[i].coherenceScore;

    if (isTransition) {
      transitionScores.push(score);
    } else {
      steadyScores.push(score);
    }
  }

  if (transitionScores.length === 0 || steadyScores.length === 0) return 0.5;

  const transitionAvg = transitionScores.reduce((s, v) => s + v, 0) / transitionScores.length;
  const steadyAvg = steadyScores.reduce((s, v) => s + v, 0) / steadyScores.length;

  // If transition quality is close to steady quality, adaptation is fast
  const gap = Math.abs(steadyAvg - transitionAvg);
  return Math.round(normalize(1 - gap * 2) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Full Report
// ---------------------------------------------------------------------------

/**
 * Generate the complete regime analysis report.
 */
export function generateRegimeReport(): RegimeReport {
  const agentIds = [...new Set(tradeEntries.map((e) => e.agentId))];
  const agentProfiles = agentIds.map((id) => getAgentRegimeProfile(id));

  // Current regime
  const currentRegime = regimeHistory[0] ?? {
    regime: "uncertain" as MarketRegime,
    avgChange: 0,
    maxChange: 0,
    changeStdDev: 0,
    stocksUp: 0,
    stocksDown: 0,
    timestamp: new Date().toISOString(),
  };

  // Most and least robust
  const sortedByRobustness = [...agentProfiles].sort(
    (a, b) => b.robustnessScore - a.robustnessScore,
  );
  const mostRobust = sortedByRobustness[0]?.agentId ?? null;
  const leastRobust = sortedByRobustness.length > 0
    ? sortedByRobustness[sortedByRobustness.length - 1].agentId
    : null;

  // Regime impact on current trades
  const allTimeAvgCoherence = tradeEntries.length > 0
    ? tradeEntries.reduce((s, e) => s + e.coherenceScore, 0) / tradeEntries.length
    : 0;
  const allTimeAvgDepth = tradeEntries.length > 0
    ? tradeEntries.reduce((s, e) => s + e.depthScore, 0) / tradeEntries.length
    : 0;
  const allTimeHalRate = tradeEntries.length > 0
    ? tradeEntries.filter((e) => e.hadHallucinations).length / tradeEntries.length
    : 0;

  const currentRegimeEntries = tradeEntries.filter(
    (e) => e.regime === currentRegime.regime,
  );
  const currentCoherence = currentRegimeEntries.length > 0
    ? currentRegimeEntries.reduce((s, e) => s + e.coherenceScore, 0) / currentRegimeEntries.length
    : allTimeAvgCoherence;
  const currentDepth = currentRegimeEntries.length > 0
    ? currentRegimeEntries.reduce((s, e) => s + e.depthScore, 0) / currentRegimeEntries.length
    : allTimeAvgDepth;
  const currentHalRate = currentRegimeEntries.length > 0
    ? currentRegimeEntries.filter((e) => e.hadHallucinations).length / currentRegimeEntries.length
    : allTimeHalRate;

  return {
    currentRegime,
    regimeHistory: regimeHistory.slice(0, 50),
    agentProfiles,
    mostRobust,
    leastRobust,
    regimeImpact: {
      regime: currentRegime.regime,
      avgCoherenceChange: Math.round((currentCoherence - allTimeAvgCoherence) * 100) / 100,
      avgDepthChange: Math.round((currentDepth - allTimeAvgDepth) * 100) / 100,
      hallucinationRateChange: Math.round((currentHalRate - allTimeHalRate) * 100) / 100,
    },
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Get recent regime history.
 */
export function getRegimeHistory(limit = 20): RegimeSnapshot[] {
  return regimeHistory.slice(0, limit);
}
