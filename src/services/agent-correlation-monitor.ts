/**
 * Agent Correlation Monitor
 *
 * Monitors real-time statistical correlations between AI trading agents'
 * return streams and decision-making patterns. Provides:
 *
 * 1. Pairwise Pearson correlation matrix across all agent pairs
 * 2. Herding detection — scoring how often agents act in unison
 * 3. Divergence alerts — flagging rounds where agents strongly disagree
 * 4. Rolling correlation — sliding-window correlation for regime detection
 * 5. Regime analysis — are agents converging or diverging over time?
 *
 * Statistical notes:
 * - Pearson r = cov(X,Y) / (sigmaX * sigmaY)
 * - Variance uses Bessel's correction (N-1 denominator)
 * - Rolling window defaults to 20 observations
 * - Herding score = (rounds with unanimous agreement / total rounds) * 100
 *
 * All computations are in-memory from recorded return samples. No DB required.
 */

import { mean } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single return observation for one agent in one round. */
export interface AgentReturnSample {
  agentId: string;
  timestamp: string;
  returnPct: number;
  decision: {
    action: "buy" | "sell" | "hold";
    symbol: string;
    confidence: number;
  };
}

/** Pairwise correlation entry between two agents. */
export interface PairwiseCorrelation {
  pair: [string, string];
  /** Pearson correlation coefficient (-1 to 1) */
  correlation: number;
  /** Sample covariance between the two agents' return streams */
  covariance: number;
  /** Number of overlapping observations used */
  sampleSize: number;
}

/** Full NxN correlation matrix result. */
export interface CorrelationMatrix {
  generatedAt: string;
  agentIds: string[];
  pairs: PairwiseCorrelation[];
  /** Average absolute correlation across all pairs */
  avgAbsCorrelation: number;
  /** The most correlated pair */
  mostCorrelated: PairwiseCorrelation | null;
  /** The least correlated (most divergent) pair */
  leastCorrelated: PairwiseCorrelation | null;
}

/** A single round where all agents agreed on the same action + symbol. */
export interface HerdingEvent {
  timestamp: string;
  action: "buy" | "sell" | "hold";
  symbol: string;
  agentConfidences: Record<string, number>;
  avgConfidence: number;
}

/** Full herding analysis report. */
export interface HerdingAnalysis {
  generatedAt: string;
  totalRoundsAnalyzed: number;
  /** Percentage of rounds where all agents chose the same action + symbol (0-100) */
  herdingScore: number;
  /** Last N rounds where unanimous agreement occurred */
  recentHerdingEvents: HerdingEvent[];
  /** Per-agent contrarianism: how often each agent disagreed with the majority */
  contrarianismScores: Record<string, number>;
  /** Distribution of agreement levels */
  agreementDistribution: {
    unanimous: number;
    majorityAgrees: number;
    allDisagree: number;
  };
}

/** An alert fired when agents take opposing positions on the same stock. */
export interface DivergenceAlert {
  timestamp: string;
  symbol: string;
  /** Agent that decided to buy */
  buyAgent: { agentId: string; confidence: number };
  /** Agent that decided to sell */
  sellAgent: { agentId: string; confidence: number };
  /** Absolute difference in confidence between opposing agents */
  convictionDifference: number;
  /** Average return across the diverging agents in that round */
  avgReturnPct: number;
}

/** Rolling correlation result for a specific pair. */
export interface RollingCorrelationResult {
  pair: [string, string];
  windowSize: number;
  /** Array of { windowEnd, correlation } ordered chronologically */
  windows: Array<{
    windowEndTimestamp: string;
    correlation: number;
    sampleSize: number;
  }>;
  /** Current (most recent window) correlation */
  currentCorrelation: number | null;
  /** Trend direction over last 5 windows */
  trend: "converging" | "diverging" | "stable" | "insufficient_data";
}

/** High-level regime analysis: are agents acting more alike or differently? */
export interface RegimeAnalysis {
  generatedAt: string;
  /** Current regime label */
  regime: "high_correlation" | "moderate_correlation" | "low_correlation" | "anti_correlated";
  /** Average pairwise correlation over the most recent window */
  currentAvgCorrelation: number;
  /** Average pairwise correlation over the prior window (for comparison) */
  priorAvgCorrelation: number;
  /** Direction of regime shift */
  regimeShift: "converging" | "diverging" | "stable";
  /** Per-pair regime details */
  pairRegimes: Array<{
    pair: [string, string];
    currentCorrelation: number;
    priorCorrelation: number;
    shift: "converging" | "diverging" | "stable";
  }>;
}

/** Full correlation report combining all analyses. */
export interface CorrelationReport {
  generatedAt: string;
  sampleCount: number;
  correlationMatrix: CorrelationMatrix;
  herdingAnalysis: HerdingAnalysis;
  divergenceAlerts: DivergenceAlert[];
  regimeAnalysis: RegimeAnalysis;
  rollingCorrelations: Record<string, RollingCorrelationResult>;
  summary: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Configuration Constants
 *
 * All tunable parameters for correlation monitoring, herding detection,
 * divergence alerts, and regime classification. Extracting these enables
 * systematic experimentation and benchmark reproducibility.
 */

// --- Data Retention Limits ---

/**
 * MAX_SAMPLES: Maximum return samples retained in memory for correlation analysis.
 * Default: 10,000 samples (~3,333 rounds with 3 agents)
 *
 * Why 10,000: Provides sufficient history for rolling correlation analysis while
 * preventing unbounded memory growth. At 3 rounds/hour, this is ~1,111 hours (~46 days)
 * of continuous trading history.
 */
const MAX_SAMPLES = 10_000;

/**
 * MAX_HERDING_EVENTS: Maximum herding events cached for display.
 * Default: 50 events
 *
 * Why 50: Enough to show recent herding patterns without overwhelming UI, while
 * preventing unbounded growth of cached events.
 */
const MAX_HERDING_EVENTS = 50;

/**
 * MAX_DIVERGENCE_ALERTS: Maximum divergence alerts cached for display.
 * Default: 200 alerts
 *
 * Why 200: Higher than herding events because divergences are more common
 * (any buy-sell conflict triggers alert). Provides sufficient history for
 * pattern detection while maintaining circular buffer efficiency.
 */
const MAX_DIVERGENCE_ALERTS = 200;

// --- Rolling Correlation Parameters ---

/**
 * DEFAULT_ROLLING_WINDOW: Default window size for rolling correlation calculations.
 * Default: 20 observations
 *
 * Why 20: Standard statistical practice (minimum ~20 samples for reliable correlation).
 * At 3 rounds/hour, this is ~6-7 hours of trading data per window. Balances
 * responsiveness (detects regime shifts) vs stability (avoids noise).
 */
const DEFAULT_ROLLING_WINDOW = 20;

/**
 * TREND_WINDOW_SIZE: Number of recent windows used for trend detection.
 * Default: 5 windows
 *
 * Why 5: Last 5 windows = ~100 observations (5 * 20 window size) = ~33 hours
 * of trading history for trend classification. Provides reliable trend direction
 * without over-smoothing short-term regime shifts.
 */
const TREND_WINDOW_SIZE = 5;

// --- Regime Detection Thresholds ---

/**
 * CORRELATION_CONVERGENCE_THRESHOLD: Minimum absolute correlation change to classify
 * as "converging" or "diverging" trend (vs "stable").
 * Default: 0.15 (15 percentage points of correlation change)
 *
 * Why 0.15: Statistical significance threshold. Changes >15pp indicate meaningful
 * regime shift (e.g., correlation 0.4 → 0.55 = converging). Below this is noise.
 *
 * Example: If avgChange = +0.18, classify as "converging" (agents acting more alike).
 * If avgChange = -0.18, classify as "diverging" (agents acting more independently).
 */
const CORRELATION_CONVERGENCE_THRESHOLD = 0.15;

/**
 * REGIME_ANTI_CORRELATED_THRESHOLD: Maximum signed correlation for "anti_correlated" regime.
 * Default: -0.3 (negative correlation stronger than -30%)
 *
 * Why -0.3: Strong negative correlation indicates agents systematically oppose each other.
 * Below -0.3 = anti_correlated regime (e.g., Claude buys when GPT sells).
 */
const REGIME_ANTI_CORRELATED_THRESHOLD = -0.3;

/**
 * REGIME_LOW_CORRELATION_THRESHOLD: Maximum absolute correlation for "low_correlation" regime.
 * Default: 0.3 (|correlation| < 30%)
 *
 * Why 0.3: Standard threshold for "weak correlation" in statistics. Below 0.3 indicates
 * agents are largely independent in their decision-making.
 */
const REGIME_LOW_CORRELATION_THRESHOLD = 0.3;

/**
 * REGIME_MODERATE_CORRELATION_THRESHOLD: Maximum absolute correlation for "moderate_correlation" regime.
 * Default: 0.6 (|correlation| between 30-60%)
 *
 * Why 0.6: Standard threshold for "moderate correlation". Between 0.3-0.6 indicates
 * some shared patterns but not complete agreement. Above 0.6 = high_correlation regime.
 */
const REGIME_MODERATE_CORRELATION_THRESHOLD = 0.6;

// --- Herding Alert Thresholds ---

/**
 * HERDING_SCORE_HIGH_THRESHOLD: Herding score above this triggers WARNING alerts.
 * Default: 50 (>50% of rounds had unanimous agreement)
 *
 * Why 50: High herding (>50% unanimity) indicates potential groupthink risk.
 * Agents should maintain some independence to avoid correlated failures.
 *
 * Example: If 55% of rounds have all 3 agents buying the same stock, flag as
 * "WARNING: High herding detected" for safety review.
 */
const HERDING_SCORE_HIGH_THRESHOLD = 50;

/**
 * HERDING_SCORE_MODERATE_THRESHOLD: Herding score above this triggers moderate alerts.
 * Default: 25 (>25% of rounds had unanimous agreement)
 *
 * Why 25: Moderate herding (25-50% unanimity) is notable but not critical.
 * Some agreement is expected (agents share same market data), but sustained
 * >25% unanimity warrants monitoring.
 */
const HERDING_SCORE_MODERATE_THRESHOLD = 25;

// --- Divergence Alert Thresholds ---

/**
 * DIVERGENCE_HIGH_CONVICTION_THRESHOLD: Minimum confidence gap for "high conviction" divergence.
 * Default: 30 (>30 percentage points difference between buy/sell confidence)
 *
 * Why 30: Large conviction gap indicates strong disagreement on same stock.
 * Example: Claude buys TSLAx with 85% confidence, GPT sells TSLAx with 50% confidence
 * = conviction gap 35 points = high conviction divergence worth highlighting.
 */
const DIVERGENCE_HIGH_CONVICTION_THRESHOLD = 30;

/**
 * Percentage Calculation Precision Constants
 *
 * Controls decimal precision for percentage display in herding and contrarianism scores.
 * Uses multiplier/divisor pattern for consistent rounding.
 */

/**
 * Multiplier for 2-decimal percentage precision.
 * Formula: Math.round(fraction * PERCENTAGE_PRECISION_MULTIPLIER) / PERCENTAGE_PRECISION_DIVISOR
 * Example: 0.6789 → Math.round(0.6789 * 10000) / 100 = 6789 / 100 = 67.89%
 */
const PERCENTAGE_PRECISION_MULTIPLIER = 10000;

/**
 * Divisor for 2-decimal percentage precision (produces XX.YZ format).
 * Used with PERCENTAGE_PRECISION_MULTIPLIER to achieve 2-decimal rounding.
 */
const PERCENTAGE_PRECISION_DIVISOR = 100;

// ---------------------------------------------------------------------------
// Module-level State
// ---------------------------------------------------------------------------

/** All return samples, ordered by insertion time. */
const returnSamples: AgentReturnSample[] = [];

/** Cached divergence alerts. */
const divergenceAlerts: DivergenceAlert[] = [];

/** Cached herding events. */
const herdingEvents: HerdingEvent[] = [];

/** Samples indexed by agentId for fast lookup. */
const samplesByAgent = new Map<string, AgentReturnSample[]>();

/** Samples grouped by timestamp (round) for cross-agent analysis. */
const samplesByRound = new Map<string, AgentReturnSample[]>();

// ---------------------------------------------------------------------------
// Internal Helpers — Statistics
// ---------------------------------------------------------------------------

/**
 * Compute sample variance with Bessel's correction (N-1 denominator).
 * Returns 0 if fewer than 2 values are provided.
 */
function sampleVariance(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  let sumSq = 0;
  for (const v of values) {
    const diff = v - m;
    sumSq += diff * diff;
  }
  return sumSq / (values.length - 1);
}

/**
 * Compute sample standard deviation (square root of sample variance).
 */
function sampleStdDev(values: number[]): number {
  return Math.sqrt(sampleVariance(values));
}

/**
 * Compute sample covariance between two equal-length arrays.
 * Uses Bessel's correction (N-1 denominator).
 */
function sampleCovariance(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  const mx = mean(xs);
  const my = mean(ys);
  let sumProd = 0;
  for (let i = 0; i < n; i++) {
    sumProd += (xs[i] - mx) * (ys[i] - my);
  }
  return sumProd / (n - 1);
}

/**
 * Compute Pearson correlation coefficient between two equal-length arrays.
 * Returns 0 if either standard deviation is zero (no variation).
 *
 * Formula: r = cov(X,Y) / (sigmaX * sigmaY)
 */
function pearsonCorrelation(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;

  const sx = sampleStdDev(xs.slice(0, n));
  const sy = sampleStdDev(ys.slice(0, n));

  if (sx === 0 || sy === 0) return 0;

  const cov = sampleCovariance(xs.slice(0, n), ys.slice(0, n));
  const r = cov / (sx * sy);

  // Clamp to [-1, 1] to handle floating-point imprecision
  return Math.max(-1, Math.min(1, r));
}

// ---------------------------------------------------------------------------
// Internal Helpers — Data Access
// ---------------------------------------------------------------------------

/**
 * Get all unique agent pairs as [agentA, agentB] tuples.
 */
function getAgentPairs(): Array<[string, string]> {
  const agents = Array.from(samplesByAgent.keys()).sort();
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < agents.length; i++) {
    for (let j = i + 1; j < agents.length; j++) {
      pairs.push([agents[i], agents[j]]);
    }
  }
  return pairs;
}

/**
 * Get aligned return arrays for two agents (only overlapping timestamps).
 * Returns two arrays of the same length with matching time indices.
 */
function getAlignedReturns(
  agentA: string,
  agentB: string
): { returnsA: number[]; returnsB: number[]; timestamps: string[] } {
  const samplesA = samplesByAgent.get(agentA) || [];
  const samplesB = samplesByAgent.get(agentB) || [];

  // Build timestamp -> returnPct map for agent B
  const bByTimestamp = new Map<string, number>();
  for (const s of samplesB) {
    bByTimestamp.set(s.timestamp, s.returnPct);
  }

  const returnsA: number[] = [];
  const returnsB: number[] = [];
  const timestamps: string[] = [];

  for (const s of samplesA) {
    const bReturn = bByTimestamp.get(s.timestamp);
    if (bReturn !== undefined) {
      returnsA.push(s.returnPct);
      returnsB.push(bReturn);
      timestamps.push(s.timestamp);
    }
  }

  return { returnsA, returnsB, timestamps };
}

/**
 * Detect divergences (buy vs sell on same symbol) within a single round's samples.
 */
function detectRoundDivergences(roundSamples: AgentReturnSample[]): DivergenceAlert[] {
  const alerts: DivergenceAlert[] = [];

  // Group by symbol
  const bySymbol = new Map<string, AgentReturnSample[]>();
  for (const s of roundSamples) {
    const existing = bySymbol.get(s.decision.symbol) || [];
    existing.push(s);
    bySymbol.set(s.decision.symbol, existing);
  }

  for (const [symbol, samples] of bySymbol) {
    const buyers = samples.filter((s) => s.decision.action === "buy");
    const sellers = samples.filter((s) => s.decision.action === "sell");

    // Generate alert for each buy-sell pair
    for (const buyer of buyers) {
      for (const seller of sellers) {
        const convictionDifference = Math.abs(
          buyer.decision.confidence - seller.decision.confidence
        );
        const avgReturn = (buyer.returnPct + seller.returnPct) / 2;

        alerts.push({
          timestamp: buyer.timestamp,
          symbol,
          buyAgent: {
            agentId: buyer.agentId,
            confidence: buyer.decision.confidence,
          },
          sellAgent: {
            agentId: seller.agentId,
            confidence: seller.decision.confidence,
          },
          convictionDifference,
          avgReturnPct: avgReturn,
        });
      }
    }
  }

  return alerts;
}

/**
 * Check if all samples in a round represent unanimous agreement.
 * Returns a HerdingEvent if so, or null.
 */
function detectHerdingEvent(roundSamples: AgentReturnSample[]): HerdingEvent | null {
  if (roundSamples.length < 2) return null;

  const firstAction = roundSamples[0].decision.action;
  const firstSymbol = roundSamples[0].decision.symbol;

  const unanimous = roundSamples.every(
    (s) => s.decision.action === firstAction && s.decision.symbol === firstSymbol
  );

  if (!unanimous) return null;

  const confidences: Record<string, number> = {};
  let totalConfidence = 0;
  for (const s of roundSamples) {
    confidences[s.agentId] = s.decision.confidence;
    totalConfidence += s.decision.confidence;
  }

  return {
    timestamp: roundSamples[0].timestamp,
    action: firstAction,
    symbol: firstSymbol,
    agentConfidences: confidences,
    avgConfidence: totalConfidence / roundSamples.length,
  };
}

// ---------------------------------------------------------------------------
// Public API — Data Recording
// ---------------------------------------------------------------------------

/**
 * Record a single agent's return and decision for a round.
 * This is the primary ingestion point — call once per agent per round.
 *
 * Automatically detects herding and divergence events on each new round.
 *
 * @param agentId - The agent identifier (e.g., "claude-trader")
 * @param returnPct - The agent's return for this round as a percentage
 * @param decision - The agent's trading decision (action, symbol, confidence)
 */
export function recordAgentReturn(
  agentId: string,
  returnPct: number,
  decision: { action: "buy" | "sell" | "hold"; symbol: string; confidence: number }
): void {
  const timestamp = new Date().toISOString();
  const sample: AgentReturnSample = { agentId, timestamp, returnPct, decision };

  // Append to global sample list
  returnSamples.push(sample);
  if (returnSamples.length > MAX_SAMPLES) {
    const removed = returnSamples.shift()!;
    // Also clean up indices
    const agentArr = samplesByAgent.get(removed.agentId);
    if (agentArr && agentArr[0]?.timestamp === removed.timestamp) {
      agentArr.shift();
    }
    samplesByRound.delete(removed.timestamp);
  }

  // Index by agent
  if (!samplesByAgent.has(agentId)) {
    samplesByAgent.set(agentId, []);
  }
  samplesByAgent.get(agentId)!.push(sample);

  // Index by round (timestamp)
  if (!samplesByRound.has(timestamp)) {
    samplesByRound.set(timestamp, []);
  }
  samplesByRound.get(timestamp)!.push(sample);

  // Run event detection for the current round
  const roundSamples = samplesByRound.get(timestamp)!;

  // Detect divergence events
  const newDivergences = detectRoundDivergences(roundSamples);
  for (const alert of newDivergences) {
    divergenceAlerts.push(alert);
    if (divergenceAlerts.length > MAX_DIVERGENCE_ALERTS) {
      divergenceAlerts.shift();
    }
  }

  // Detect herding events
  const herdEvent = detectHerdingEvent(roundSamples);
  if (herdEvent) {
    herdingEvents.push(herdEvent);
    if (herdingEvents.length > MAX_HERDING_EVENTS) {
      herdingEvents.shift();
    }
  }
}

// ---------------------------------------------------------------------------
// Public API — Correlation Matrix
// ---------------------------------------------------------------------------

/**
 * Compute the full NxN Pearson correlation matrix between all agents.
 * Uses aligned (overlapping) return observations for each pair.
 *
 * @returns CorrelationMatrix with pairwise correlations and summary stats
 */
export function getCorrelationMatrix(): CorrelationMatrix {
  const pairs = getAgentPairs();
  const pairResults: PairwiseCorrelation[] = [];

  for (const [agentA, agentB] of pairs) {
    const { returnsA, returnsB } = getAlignedReturns(agentA, agentB);
    const n = returnsA.length;

    const cov = sampleCovariance(returnsA, returnsB);
    const corr = pearsonCorrelation(returnsA, returnsB);

    pairResults.push({
      pair: [agentA, agentB],
      correlation: corr,
      covariance: cov,
      sampleSize: n,
    });
  }

  // Summary stats
  const validPairs = pairResults.filter((p) => p.sampleSize >= 2);
  const absCorrelations = validPairs.map((p) => Math.abs(p.correlation));
  const avgAbs = absCorrelations.length > 0 ? mean(absCorrelations) : 0;

  let mostCorrelated: PairwiseCorrelation | null = null;
  let leastCorrelated: PairwiseCorrelation | null = null;

  if (validPairs.length > 0) {
    mostCorrelated = validPairs.reduce((best, p) =>
      Math.abs(p.correlation) > Math.abs(best.correlation) ? p : best
    );
    leastCorrelated = validPairs.reduce((best, p) =>
      Math.abs(p.correlation) < Math.abs(best.correlation) ? p : best
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    agentIds: Array.from(samplesByAgent.keys()).sort(),
    pairs: pairResults,
    avgAbsCorrelation: avgAbs,
    mostCorrelated,
    leastCorrelated,
  };
}

// ---------------------------------------------------------------------------
// Public API — Herding Analysis
// ---------------------------------------------------------------------------

/**
 * Perform herding analysis across all recorded rounds.
 * Computes a herding score (0-100), lists recent herding events,
 * and calculates per-agent contrarianism scores.
 *
 * @returns HerdingAnalysis with scores and event history
 */
export function getHerdingAnalysis(): HerdingAnalysis {
  const totalRounds = samplesByRound.size;
  let unanimousCount = 0;
  let majorityAgreesCount = 0;
  let allDisagreeCount = 0;

  // Track per-agent disagreement with majority
  const agentDisagreements = new Map<string, number>();
  const agentRoundCount = new Map<string, number>();

  for (const agentId of samplesByAgent.keys()) {
    agentDisagreements.set(agentId, 0);
    agentRoundCount.set(agentId, 0);
  }

  for (const [, roundSamples] of samplesByRound) {
    if (roundSamples.length < 2) continue;

    // Count action frequencies for this round
    const actionCounts = new Map<string, number>();
    for (const s of roundSamples) {
      const key = `${s.decision.action}:${s.decision.symbol}`;
      actionCounts.set(key, (actionCounts.get(key) || 0) + 1);
    }

    // Find majority action
    let majorityKey = "";
    let majorityCount = 0;
    for (const [key, count] of actionCounts) {
      if (count > majorityCount) {
        majorityKey = key;
        majorityCount = count;
      }
    }

    if (majorityCount === roundSamples.length) {
      unanimousCount++;
    } else if (majorityCount > roundSamples.length / 2) {
      majorityAgreesCount++;
    } else {
      allDisagreeCount++;
    }

    // Track individual agent contrarianism
    for (const s of roundSamples) {
      const key = `${s.decision.action}:${s.decision.symbol}`;
      agentRoundCount.set(s.agentId, (agentRoundCount.get(s.agentId) || 0) + 1);
      if (key !== majorityKey) {
        agentDisagreements.set(
          s.agentId,
          (agentDisagreements.get(s.agentId) || 0) + 1
        );
      }
    }
  }

  // Contrarianism scores: percentage of rounds where agent disagreed with majority
  const contrarianismScores: Record<string, number> = {};
  for (const [agentId, disagreements] of agentDisagreements) {
    const rounds = agentRoundCount.get(agentId) || 0;
    contrarianismScores[agentId] = rounds > 0
      ? Math.round((disagreements / rounds) * PERCENTAGE_PRECISION_MULTIPLIER) / PERCENTAGE_PRECISION_DIVISOR
      : 0;
  }

  const herdingScore =
    totalRounds > 0
      ? Math.round((unanimousCount / totalRounds) * PERCENTAGE_PRECISION_MULTIPLIER) / PERCENTAGE_PRECISION_DIVISOR
      : 0;

  return {
    generatedAt: new Date().toISOString(),
    totalRoundsAnalyzed: totalRounds,
    herdingScore,
    recentHerdingEvents: herdingEvents.slice(-MAX_HERDING_EVENTS),
    contrarianismScores,
    agreementDistribution: {
      unanimous: unanimousCount,
      majorityAgrees: majorityAgreesCount,
      allDisagree: allDisagreeCount,
    },
  };
}

// ---------------------------------------------------------------------------
// Public API — Divergence Alerts
// ---------------------------------------------------------------------------

/**
 * Retrieve recent divergence alerts (rounds where agents took opposing positions).
 * Sorted by timestamp descending (most recent first).
 *
 * @param limit - Maximum number of alerts to return (default 20)
 * @returns Array of DivergenceAlert sorted newest first
 */
export function getDivergenceAlerts(limit: number = 20): DivergenceAlert[] {
  return divergenceAlerts
    .slice()
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Public API — Rolling Correlation
// ---------------------------------------------------------------------------

/**
 * Compute rolling Pearson correlation for a specific agent pair over a
 * sliding window.
 *
 * @param pair - Tuple of two agent IDs, e.g., ["claude-trader", "gpt-momentum"]
 * @param windowSize - Number of observations per window (default 20)
 * @returns RollingCorrelationResult with per-window correlations and trend
 */
export function getRollingCorrelation(
  pair: [string, string],
  windowSize: number = DEFAULT_ROLLING_WINDOW
): RollingCorrelationResult {
  const { returnsA, returnsB, timestamps } = getAlignedReturns(pair[0], pair[1]);

  const windows: Array<{
    windowEndTimestamp: string;
    correlation: number;
    sampleSize: number;
  }> = [];

  // Slide window through the aligned observations
  for (let end = windowSize; end <= returnsA.length; end++) {
    const start = end - windowSize;
    const windowA = returnsA.slice(start, end);
    const windowB = returnsB.slice(start, end);
    const corr = pearsonCorrelation(windowA, windowB);

    windows.push({
      windowEndTimestamp: timestamps[end - 1],
      correlation: corr,
      sampleSize: windowSize,
    });
  }

  // Determine trend from last 5 windows
  let trend: "converging" | "diverging" | "stable" | "insufficient_data" =
    "insufficient_data";

  if (windows.length >= TREND_WINDOW_SIZE) {
    const recentWindows = windows.slice(-TREND_WINDOW_SIZE);
    const correlationChanges: number[] = [];

    for (let i = 1; i < recentWindows.length; i++) {
      correlationChanges.push(
        Math.abs(recentWindows[i].correlation) -
          Math.abs(recentWindows[i - 1].correlation)
      );
    }

    const avgChange = mean(correlationChanges);

    if (avgChange > CORRELATION_CONVERGENCE_THRESHOLD) {
      trend = "converging";
    } else if (avgChange < -CORRELATION_CONVERGENCE_THRESHOLD) {
      trend = "diverging";
    } else {
      trend = "stable";
    }
  }

  return {
    pair,
    windowSize,
    windows,
    currentCorrelation: windows.length > 0 ? windows[windows.length - 1].correlation : null,
    trend,
  };
}

// ---------------------------------------------------------------------------
// Public API — Regime Analysis
// ---------------------------------------------------------------------------

/**
 * Detect the current correlation regime across all agent pairs.
 * Compares the most recent rolling window to the prior window
 * to determine if agents are converging or diverging.
 *
 * @returns RegimeAnalysis with regime label, shift direction, and per-pair details
 */
export function getRegimeAnalysis(): RegimeAnalysis {
  const pairs = getAgentPairs();
  const pairRegimes: RegimeAnalysis["pairRegimes"] = [];

  const currentCorrelations: number[] = [];
  const priorCorrelations: number[] = [];

  for (const pair of pairs) {
    const rolling = getRollingCorrelation(pair, DEFAULT_ROLLING_WINDOW);

    let currentCorr = 0;
    let priorCorr = 0;

    if (rolling.windows.length >= 2) {
      currentCorr = rolling.windows[rolling.windows.length - 1].correlation;
      priorCorr = rolling.windows[rolling.windows.length - 2].correlation;
    } else if (rolling.windows.length === 1) {
      currentCorr = rolling.windows[0].correlation;
      priorCorr = 0;
    }

    currentCorrelations.push(currentCorr);
    priorCorrelations.push(priorCorr);

    const shift =
      Math.abs(currentCorr) - Math.abs(priorCorr) > CORRELATION_CONVERGENCE_THRESHOLD
        ? "converging"
        : Math.abs(currentCorr) - Math.abs(priorCorr) < -CORRELATION_CONVERGENCE_THRESHOLD
          ? "diverging"
          : "stable";

    pairRegimes.push({
      pair: pair as [string, string],
      currentCorrelation: currentCorr,
      priorCorrelation: priorCorr,
      shift,
    });
  }

  const currentAvg = mean(currentCorrelations.map(Math.abs));
  const priorAvg = mean(priorCorrelations.map(Math.abs));

  // Classify regime based on average absolute correlation
  let regime: RegimeAnalysis["regime"];
  const currentAvgSigned = mean(currentCorrelations);

  if (currentAvgSigned < REGIME_ANTI_CORRELATED_THRESHOLD) {
    regime = "anti_correlated";
  } else if (currentAvg < REGIME_LOW_CORRELATION_THRESHOLD) {
    regime = "low_correlation";
  } else if (currentAvg < REGIME_MODERATE_CORRELATION_THRESHOLD) {
    regime = "moderate_correlation";
  } else {
    regime = "high_correlation";
  }

  const regimeShift =
    currentAvg - priorAvg > CORRELATION_CONVERGENCE_THRESHOLD
      ? "converging"
      : currentAvg - priorAvg < -CORRELATION_CONVERGENCE_THRESHOLD
        ? "diverging"
        : "stable";

  return {
    generatedAt: new Date().toISOString(),
    regime,
    currentAvgCorrelation: currentAvgSigned,
    priorAvgCorrelation: mean(priorCorrelations),
    regimeShift: regimeShift as "converging" | "diverging" | "stable",
    pairRegimes,
  };
}

// ---------------------------------------------------------------------------
// Public API — Full Report
// ---------------------------------------------------------------------------

/**
 * Generate a comprehensive correlation report combining all analyses.
 * This is the primary entry point for the dashboard and API layer.
 *
 * @returns CorrelationReport with matrix, herding, divergence, regime, and rolling data
 */
export function getCorrelationReport(): CorrelationReport {
  const matrix = getCorrelationMatrix();
  const herding = getHerdingAnalysis();
  const alerts = getDivergenceAlerts(20);
  const regime = getRegimeAnalysis();

  // Compute rolling correlations for all pairs
  const rollingCorrelations: Record<string, RollingCorrelationResult> = {};
  for (const pair of getAgentPairs()) {
    const key = `${pair[0]}__${pair[1]}`;
    rollingCorrelations[key] = getRollingCorrelation(pair);
  }

  // Generate human-readable summary insights
  const summary: string[] = [];

  if (matrix.mostCorrelated) {
    const mc = matrix.mostCorrelated;
    summary.push(
      `Most correlated pair: ${mc.pair[0]} & ${mc.pair[1]} (r=${mc.correlation.toFixed(3)}, n=${mc.sampleSize})`
    );
  }

  if (matrix.leastCorrelated) {
    const lc = matrix.leastCorrelated;
    summary.push(
      `Least correlated pair: ${lc.pair[0]} & ${lc.pair[1]} (r=${lc.correlation.toFixed(3)}, n=${lc.sampleSize})`
    );
  }

  summary.push(
    `Average |correlation|: ${matrix.avgAbsCorrelation.toFixed(3)}`
  );

  if (herding.herdingScore > HERDING_SCORE_HIGH_THRESHOLD) {
    summary.push(
      `WARNING: High herding detected — ${herding.herdingScore.toFixed(1)}% of rounds had unanimous agreement`
    );
  } else if (herding.herdingScore > HERDING_SCORE_MODERATE_THRESHOLD) {
    summary.push(
      `Moderate herding: ${herding.herdingScore.toFixed(1)}% of rounds had unanimous agreement`
    );
  } else {
    summary.push(
      `Low herding: only ${herding.herdingScore.toFixed(1)}% of rounds had unanimous agreement`
    );
  }

  if (alerts.length > 0) {
    const highConviction = alerts.filter((a) => a.convictionDifference > DIVERGENCE_HIGH_CONVICTION_THRESHOLD);
    summary.push(
      `${alerts.length} divergence alert(s) recorded, ${highConviction.length} with high conviction gap (>${DIVERGENCE_HIGH_CONVICTION_THRESHOLD})`
    );
  }

  summary.push(`Current regime: ${regime.regime.replace(/_/g, " ")} (${regime.regimeShift})`);

  // Find most contrarian agent
  const contrarianEntries = Object.entries(herding.contrarianismScores);
  if (contrarianEntries.length > 0) {
    const mostContrarian = contrarianEntries.reduce((best, entry) =>
      entry[1] > best[1] ? entry : best
    );
    summary.push(
      `Most contrarian agent: ${mostContrarian[0]} (disagrees ${mostContrarian[1].toFixed(1)}% of rounds)`
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    sampleCount: returnSamples.length,
    correlationMatrix: matrix,
    herdingAnalysis: herding,
    divergenceAlerts: alerts,
    regimeAnalysis: regime,
    rollingCorrelations,
    summary,
  };
}

// ---------------------------------------------------------------------------
// Utility — Reset (for testing)
// ---------------------------------------------------------------------------

/**
 * Clear all stored samples and cached events.
 * Intended for use in tests and development resets only.
 */
export function resetCorrelationMonitor(): void {
  returnSamples.length = 0;
  divergenceAlerts.length = 0;
  herdingEvents.length = 0;
  samplesByAgent.clear();
  samplesByRound.clear();
}
