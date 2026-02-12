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

import { countByCondition, clamp, round2, calculateAverage, averageByKey, absMax } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Regime Detection Thresholds
 *
 * These constants control how market conditions are classified into regimes.
 * Bull/bear classification based on average 24h change across all stocks.
 * Volatility classification based on standard deviation and max change.
 */

/** Volatility standard deviation threshold (>2.5% = high volatility) */
const REGIME_VOLATILITY_STDDEV_THRESHOLD = 2.5;

/** Maximum daily change threshold (>5% = high volatility regardless of stddev) */
const REGIME_VOLATILITY_MAX_CHANGE_THRESHOLD = 5;

/** Bull regime threshold (avg change >0.5% = rising market) */
const REGIME_BULL_THRESHOLD = 0.5;

/** Bear regime threshold (avg change <-0.5% = falling market) */
const REGIME_BEAR_THRESHOLD = -0.5;

/** Sideways regime threshold (|avg change| ≤0.5% + low vol = range-bound) */
const REGIME_SIDEWAYS_THRESHOLD = 0.5;

/**
 * Confidence Calibration Thresholds
 *
 * Used to measure if high-confidence trades actually perform better.
 * Calibration score = correlation between confidence level and win rate.
 */

/** High confidence threshold (>60% = "high conviction" bucket) */
const CONFIDENCE_HIGH_THRESHOLD = 0.6;

/** Default calibration score when insufficient data (neutral 0.5) */
const CONFIDENCE_CALIBRATION_BASELINE = 0.5;

/**
 * Composite Score Weights (Per-Regime Quality)
 *
 * Weighted combination of coherence, depth, hallucination-free, calibration.
 * Total must sum to 1.0 for normalized scoring.
 */

/** Weight for coherence in per-regime composite score (30%) */
const COMPOSITE_WEIGHT_COHERENCE = 0.3;

/** Weight for reasoning depth in per-regime composite score (25%) */
const COMPOSITE_WEIGHT_DEPTH = 0.25;

/** Weight for hallucination-free rate in per-regime composite score (25%) */
const COMPOSITE_WEIGHT_HALLUCINATION_FREE = 0.25;

/** Weight for confidence calibration in per-regime composite score (20%) */
const COMPOSITE_WEIGHT_CALIBRATION = 0.2;

/**
 * Best/Worst Regime Sorting Weights
 *
 * Used to rank regimes by quality when determining agent's best/worst conditions.
 * Coherence weighted highest (40%) as primary quality indicator.
 */

/** Weight for coherence in best/worst regime sorting (40%) */
const BEST_WORST_WEIGHT_COHERENCE = 0.4;

/** Weight for depth in best/worst regime sorting (30%) */
const BEST_WORST_WEIGHT_DEPTH = 0.3;

/** Weight for hallucination-free rate in best/worst regime sorting (30%) */
const BEST_WORST_WEIGHT_HALLUCINATION_FREE = 0.3;

/**
 * Data Requirements and Defaults
 */

/** Minimum trade entries required for reliable adaptation speed calculation */
const MIN_ENTRIES_FOR_ADAPTATION = 4;

/** Minimum entries required for reliable calibration measurement */
const MIN_ENTRIES_FOR_CALIBRATION = 3;

/** Default robustness score when insufficient data (neutral 0.5) */
const ROBUSTNESS_DEFAULT = 0.5;

/** Default adaptation speed when insufficient regime transitions observed (neutral 0.5) */
const ADAPTATION_SPEED_DEFAULT = 0.5;

/** Adaptation speed gap multiplier (gap * 2 to convert coherence delta to speed penalty) */
const ADAPTATION_GAP_MULTIPLIER = 2;

/**
 * Display and Query Limits
 */

/** Maximum regime history snapshots returned in report (prevent overwhelming response) */
const REGIME_HISTORY_DISPLAY_LIMIT = 50;

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

  const avgChange = calculateAverage(changes);
  const maxChange = absMax(changes);
  const variance = changes.reduce((s, c) => s + (c - avgChange) ** 2, 0) / changes.length;
  const changeStdDev = Math.sqrt(variance);
  const stocksUp = countByCondition(changes, (c) => c > 0);
  const stocksDown = countByCondition(changes, (c) => c < 0);

  // Classify regime
  const isVolatile = changeStdDev > REGIME_VOLATILITY_STDDEV_THRESHOLD || maxChange > REGIME_VOLATILITY_MAX_CHANGE_THRESHOLD;
  const isBull = avgChange > REGIME_BULL_THRESHOLD;
  const isBear = avgChange < REGIME_BEAR_THRESHOLD;

  let regime: MarketRegime;
  if (isBull && isVolatile) regime = "bull_volatile";
  else if (isBull) regime = "bull_calm";
  else if (isBear && isVolatile) regime = "bear_volatile";
  else if (isBear) regime = "bear_calm";
  else if (Math.abs(avgChange) <= REGIME_SIDEWAYS_THRESHOLD && !isVolatile) regime = "sideways";
  else regime = "uncertain";

  const snapshot: RegimeSnapshot = {
    regime,
    avgChange: round2(avgChange),
    maxChange: round2(maxChange),
    changeStdDev: round2(changeStdDev),
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
      averageByKey(regimeEntries, 'coherenceScore') * 100,
    ) / 100;

    const avgDepth = Math.round(
      averageByKey(regimeEntries, 'depthScore') * 100,
    ) / 100;

    const hallucinationRate = Math.round(
      (countByCondition(regimeEntries, (e) => e.hadHallucinations) / regimeEntries.length) * 100,
    ) / 100;

    const avgConfidence = Math.round(
      averageByKey(regimeEntries, 'confidence') * 100,
    ) / 100;

    // Confidence calibration: correlation between confidence and correctness
    const withOutcomes = regimeEntries.filter((e) => e.wasCorrect !== null);
    let confidenceCalibration = CONFIDENCE_CALIBRATION_BASELINE;
    if (withOutcomes.length >= MIN_ENTRIES_FOR_CALIBRATION) {
      const highConf = withOutcomes.filter((e) => e.confidence > CONFIDENCE_HIGH_THRESHOLD);
      const lowConf = withOutcomes.filter((e) => e.confidence <= CONFIDENCE_HIGH_THRESHOLD);
      const highWinRate = highConf.length > 0
        ? countByCondition(highConf, (e) => e.wasCorrect === true) / highConf.length
        : CONFIDENCE_CALIBRATION_BASELINE;
      const lowWinRate = lowConf.length > 0
        ? countByCondition(lowConf, (e) => e.wasCorrect === true) / lowConf.length
        : CONFIDENCE_CALIBRATION_BASELINE;
      // Good calibration: high confidence -> higher win rate
      confidenceCalibration = Math.round(
        clamp(CONFIDENCE_CALIBRATION_BASELINE + (highWinRate - lowWinRate), 0, 1) * 100,
      ) / 100;
    }

    const actionDist = {
      buy: countByCondition(regimeEntries, (e) => e.action === "buy"),
      sell: countByCondition(regimeEntries, (e) => e.action === "sell"),
      hold: countByCondition(regimeEntries, (e) => e.action === "hold"),
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
    const compositeScore = avgCoherence * COMPOSITE_WEIGHT_COHERENCE + avgDepth * COMPOSITE_WEIGHT_DEPTH +
      halFree * COMPOSITE_WEIGHT_HALLUCINATION_FREE + confidenceCalibration * COMPOSITE_WEIGHT_CALIBRATION;
    regimeScores.push(compositeScore);
  }

  // Robustness: 1 - (stddev of regime scores / mean)
  let robustnessScore = ROBUSTNESS_DEFAULT;
  if (regimeScores.length >= 2) {
    const mean = calculateAverage(regimeScores);
    const variance = regimeScores.reduce((s, v) => s + (v - mean) ** 2, 0) / regimeScores.length;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 1;
    robustnessScore = Math.round(clamp(1 - cv, 0, 1) * 100) / 100;
  }

  // Best and worst regime
  const sortedPerf = [...regimePerformance].sort((a, b) => {
    const scoreA = a.avgCoherence * BEST_WORST_WEIGHT_COHERENCE + a.avgDepth * BEST_WORST_WEIGHT_DEPTH + (1 - a.hallucinationRate) * BEST_WORST_WEIGHT_HALLUCINATION_FREE;
    const scoreB = b.avgCoherence * BEST_WORST_WEIGHT_COHERENCE + b.avgDepth * BEST_WORST_WEIGHT_DEPTH + (1 - b.hallucinationRate) * BEST_WORST_WEIGHT_HALLUCINATION_FREE;
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
  if (entries.length < MIN_ENTRIES_FOR_ADAPTATION) return ADAPTATION_SPEED_DEFAULT;

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

  if (transitionScores.length === 0 || steadyScores.length === 0) return ADAPTATION_SPEED_DEFAULT;

  const transitionAvg = transitionScores.reduce((s, v) => s + v, 0) / transitionScores.length;
  const steadyAvg = steadyScores.reduce((s, v) => s + v, 0) / steadyScores.length;

  // If transition quality is close to steady quality, adaptation is fast
  const gap = Math.abs(steadyAvg - transitionAvg);
  return Math.round(clamp(1 - gap * ADAPTATION_GAP_MULTIPLIER, 0, 1) * 100) / 100;
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
    ? countByCondition(tradeEntries, (e) => e.hadHallucinations) / tradeEntries.length
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
    ? countByCondition(currentRegimeEntries, (e) => e.hadHallucinations) / currentRegimeEntries.length
    : allTimeHalRate;

  return {
    currentRegime,
    regimeHistory: regimeHistory.slice(0, REGIME_HISTORY_DISPLAY_LIMIT),
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
