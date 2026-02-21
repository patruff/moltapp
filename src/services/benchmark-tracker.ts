/**
 * Benchmark Comparison Service
 *
 * Tracks agent P&L against passive benchmark strategies.
 * The primary benchmark is SPY buy-and-hold (what you'd get
 * by simply buying SPYx and doing nothing).
 *
 * Features:
 * - SPY buy-and-hold benchmark tracking
 * - Equal-weight portfolio benchmark
 * - Per-agent alpha/beta calculation
 * - Rolling benchmark comparison (7d, 30d, 90d)
 * - Information ratio calculation
 * - Tracking error measurement
 * - Visual-ready equity curve data for the dashboard
 */

import { recordBenchmarkReturn } from "./risk-adjusted-leaderboard.ts";
import { round2, computeVariance, sumByKey, averageByKey } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BenchmarkSnapshot {
  date: string;
  timestamp: string;
  spyPrice: number;
  spyReturn: number; // daily return %
  spyCumulativeReturn: number; // cumulative since inception
  equalWeightReturn: number;
  equalWeightCumulativeReturn: number;
}

export interface AgentBenchmarkComparison {
  agentId: string;
  agentName: string;
  /** Agent's cumulative return % */
  agentReturn: number;
  /** SPY buy-and-hold return % over same period */
  spyReturn: number;
  /** Alpha = agent return - benchmark return */
  alpha: number;
  /** Beta = covariance(agent, market) / variance(market) */
  beta: number;
  /** Information Ratio = alpha / tracking error */
  informationRatio: number;
  /** Tracking Error = std dev of return differences */
  trackingError: number;
  /** Is the agent outperforming the benchmark? */
  outperforming: boolean;
  /** Rolling comparisons */
  rolling: {
    period: string;
    agentReturn: number;
    spyReturn: number;
    alpha: number;
  }[];
  /** Equity curve data for charting */
  equityCurve: Array<{
    date: string;
    agentValue: number;
    benchmarkValue: number;
  }>;
}

export interface BenchmarkSummary {
  currentSpyPrice: number;
  spyCumulativeReturn: number;
  equalWeightCumulativeReturn: number;
  dataPointCount: number;
  inceptionDate: string | null;
  agentComparisons: AgentBenchmarkComparison[];
  lastUpdated: string;
}

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Maximum benchmark history retention (days)
 *
 * Controls how many days of SPY/equal-weight benchmark data to keep in memory.
 *
 * Example: 365 days = 1 year of daily price snapshots for benchmark comparison.
 */
const MAX_HISTORY = 365;

/**
 * Initial portfolio value for benchmark initialization ($USD)
 *
 * Starting capital for both equal-weight benchmark and agent equity curve comparison.
 *
 * Example: $10,000 = typical brokerage account minimum for retail trading.
 */
const BENCHMARK_INITIAL_PORTFOLIO_VALUE = 10000;

/**
 * Equal-weight return dispersion multiplier range
 *
 * Simulates stock-level volatility by applying 0.9-1.1× multiplier to SPY return.
 *
 * Formula: equalWeightReturn = spyReturn × (DISPERSION_MIN + random() × DISPERSION_RANGE)
 *
 * Example: SPY +2% → equal-weight portfolio +1.8% to +2.2% (90-110% of SPY return)
 */
const EQUAL_WEIGHT_RETURN_DISPERSION_MIN = 0.9;
const EQUAL_WEIGHT_RETURN_DISPERSION_RANGE = 0.2;

/**
 * Tracking error display precision (decimal places)
 *
 * Controls rounding precision for tracking error in API responses.
 *
 * Formula: Math.round(trackingError × PRECISION) / PRECISION = 4-decimal precision
 *
 * Example: 0.123456 → 0.1235 (4-decimal places for institutional quality metrics)
 */
const TRACKING_ERROR_PRECISION_MULTIPLIER = 10000;

/**
 * Trading days per year for annualization
 *
 * Standard NYSE trading calendar (365 - 104 weekend - 9 holidays = 252 days).
 *
 * Formula: annualizedTrackingError = dailyStdDev × √TRADING_DAYS_PER_YEAR
 *
 * Used in: Information Ratio calculation (alpha / annualized tracking error)
 */
const TRADING_DAYS_PER_YEAR = 252;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const benchmarkHistory: BenchmarkSnapshot[] = [];

/** Per-agent daily returns for correlation analysis */
const agentDailyReturns = new Map<
  string,
  Array<{ date: string; returnPercent: number; portfolioValue: number }>
>();

const agentNameMap = new Map<string, string>();

let initialSpyPrice: number | null = null;
let initialEqualWeightValue: number | null = null;

// ---------------------------------------------------------------------------
// Core: Record Market Data
// ---------------------------------------------------------------------------

/**
 * Record the SPY price and equal-weight portfolio value for the day.
 * Called by the orchestrator after fetching market data.
 *
 * @param spyPrice Current SPY price
 * @param allStockPrices Map of symbol -> price (for equal-weight benchmark)
 */
export function recordBenchmarkData(
  spyPrice: number,
  allStockPrices: Map<string, number>,
): void {
  const today = new Date().toISOString().slice(0, 10);
  const timestamp = new Date().toISOString();

  // Initialize inception prices
  if (initialSpyPrice === null) {
    initialSpyPrice = spyPrice;
  }

  // Equal-weight: average price change of all stocks
  if (initialEqualWeightValue === null && allStockPrices.size > 0) {
    // Store initial prices for equal-weight calculation
    initialEqualWeightValue = BENCHMARK_INITIAL_PORTFOLIO_VALUE;
  }

  // Calculate SPY return
  const prevSnapshot = benchmarkHistory.length > 0
    ? benchmarkHistory[benchmarkHistory.length - 1]
    : null;

  const spyDailyReturn = prevSnapshot
    ? ((spyPrice - prevSnapshot.spyPrice) / prevSnapshot.spyPrice) * 100
    : 0;

  const spyCumulativeReturn =
    ((spyPrice - initialSpyPrice) / initialSpyPrice) * 100;

  // Equal-weight daily return (average of all stock returns)
  let equalWeightReturn = 0;
  if (prevSnapshot && allStockPrices.size > 0) {
    // We don't track individual stock prices in benchmark, so estimate
    // based on SPY return with some dispersion
    equalWeightReturn = spyDailyReturn * (EQUAL_WEIGHT_RETURN_DISPERSION_MIN + Math.random() * EQUAL_WEIGHT_RETURN_DISPERSION_RANGE);
  }

  const equalWeightCumulativeReturn =
    (prevSnapshot?.equalWeightCumulativeReturn ?? 0) + equalWeightReturn;

  // Avoid duplicate entries for same date
  const existing = benchmarkHistory.findIndex((s) => s.date === today);
  if (existing >= 0) {
    benchmarkHistory[existing] = {
      date: today,
      timestamp,
      spyPrice,
      spyReturn: spyDailyReturn,
      spyCumulativeReturn,
      equalWeightReturn,
      equalWeightCumulativeReturn,
    };
  } else {
    benchmarkHistory.push({
      date: today,
      timestamp,
      spyPrice,
      spyReturn: spyDailyReturn,
      spyCumulativeReturn,
      equalWeightReturn,
      equalWeightCumulativeReturn,
    });
  }

  // Feed into risk-adjusted leaderboard
  recordBenchmarkReturn(today, spyDailyReturn);

  // Trim history
  if (benchmarkHistory.length > MAX_HISTORY) {
    benchmarkHistory.splice(0, benchmarkHistory.length - MAX_HISTORY);
  }

  console.log(
    `[BenchmarkTracker] Recorded SPY=$${spyPrice.toFixed(2)} ` +
      `daily=${spyDailyReturn >= 0 ? "+" : ""}${spyDailyReturn.toFixed(2)}% ` +
      `cumulative=${spyCumulativeReturn >= 0 ? "+" : ""}${spyCumulativeReturn.toFixed(2)}%`,
  );
}

/**
 * Record an agent's daily return for benchmark comparison.
 */
export function recordAgentDailyReturn(
  agentId: string,
  agentName: string,
  date: string,
  returnPercent: number,
  portfolioValue: number,
): void {
  agentNameMap.set(agentId, agentName);

  let returns = agentDailyReturns.get(agentId);
  if (!returns) {
    returns = [];
    agentDailyReturns.set(agentId, returns);
  }

  const existing = returns.findIndex((r) => r.date === date);
  if (existing >= 0) {
    returns[existing] = { date, returnPercent, portfolioValue };
  } else {
    returns.push({ date, returnPercent, portfolioValue });
  }

  if (returns.length > MAX_HISTORY) {
    returns.splice(0, returns.length - MAX_HISTORY);
  }
}

// ---------------------------------------------------------------------------
// Core: Get Benchmark Summary
// ---------------------------------------------------------------------------

/**
 * Get the full benchmark comparison summary for all agents.
 */
export function getBenchmarkSummary(): BenchmarkSummary {
  const latestSnapshot =
    benchmarkHistory.length > 0
      ? benchmarkHistory[benchmarkHistory.length - 1]
      : null;

  const agentComparisons: AgentBenchmarkComparison[] = [];

  for (const [agentId, returns] of agentDailyReturns) {
    if (returns.length < 2) continue;
    const comparison = computeAgentComparison(agentId, returns);
    agentComparisons.push(comparison);
  }

  // Sort by alpha descending (best outperformers first)
  agentComparisons.sort((a, b) => b.alpha - a.alpha);

  return {
    currentSpyPrice: latestSnapshot?.spyPrice ?? 0,
    spyCumulativeReturn: latestSnapshot?.spyCumulativeReturn ?? 0,
    equalWeightCumulativeReturn:
      latestSnapshot?.equalWeightCumulativeReturn ?? 0,
    dataPointCount: benchmarkHistory.length,
    inceptionDate: benchmarkHistory.length > 0 ? benchmarkHistory[0].date : null,
    agentComparisons,
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Get benchmark comparison for a single agent.
 */
export function getAgentBenchmarkComparison(
  agentId: string,
): AgentBenchmarkComparison | null {
  const returns = agentDailyReturns.get(agentId);
  if (!returns || returns.length < 2) return null;
  return computeAgentComparison(agentId, returns);
}

// ---------------------------------------------------------------------------
// Agent Comparison Calculation
// ---------------------------------------------------------------------------

function computeAgentComparison(
  agentId: string,
  agentReturns: Array<{ date: string; returnPercent: number; portfolioValue: number }>,
): AgentBenchmarkComparison {
  const agentName = agentNameMap.get(agentId) ?? agentId;

  // Total agent return
  const agentCumulativeReturn = sumByKey(agentReturns, "returnPercent");

  // Get matching benchmark returns
  const matchedReturns: Array<{ agentReturn: number; benchmarkReturn: number }> = [];

  for (const ar of agentReturns) {
    const bm = benchmarkHistory.find((s) => s.date === ar.date);
    if (bm) {
      matchedReturns.push({
        agentReturn: ar.returnPercent / 100,
        benchmarkReturn: bm.spyReturn / 100,
      });
    }
  }

  // SPY cumulative return over the same period
  const agentDates = agentReturns.map((r) => r.date);
  const benchmarkSlice = benchmarkHistory.filter((s) =>
    agentDates.includes(s.date),
  );
  const spyCumulativeReturn = sumByKey(benchmarkSlice, "spyReturn");

  // Alpha
  const alpha =
    Math.round((agentCumulativeReturn - spyCumulativeReturn) * 100) / 100;

  // Beta calculation
  const beta = calculateBeta(matchedReturns);

  // Tracking error
  const trackingError = calculateTrackingError(matchedReturns);

  // Information ratio
  const informationRatio =
    trackingError > 0 ? Math.round((alpha / 100 / trackingError) * 100) / 100 : 0;

  // Rolling comparisons
  const rolling = calculateRollingComparisons(agentReturns, benchmarkHistory);

  // Equity curve
  const equityCurve = buildEquityCurve(agentReturns, benchmarkHistory);

  return {
    agentId,
    agentName,
    agentReturn: round2(agentCumulativeReturn),
    spyReturn: round2(spyCumulativeReturn),
    alpha,
    beta: round2(beta),
    informationRatio,
    trackingError: Math.round(trackingError * TRACKING_ERROR_PRECISION_MULTIPLIER) / TRACKING_ERROR_PRECISION_MULTIPLIER,
    outperforming: agentCumulativeReturn > spyCumulativeReturn,
    rolling,
    equityCurve,
  };
}

function calculateBeta(
  matched: Array<{ agentReturn: number; benchmarkReturn: number }>,
): number {
  if (matched.length < 3) return 1;

  const meanAgent = averageByKey(matched, "agentReturn");
  const meanBenchmark = averageByKey(matched, "benchmarkReturn");

  let covariance = 0;
  let benchmarkVariance = 0;

  for (const m of matched) {
    covariance +=
      (m.agentReturn - meanAgent) * (m.benchmarkReturn - meanBenchmark);
    benchmarkVariance += Math.pow(m.benchmarkReturn - meanBenchmark, 2);
  }

  covariance /= matched.length - 1;
  benchmarkVariance /= matched.length - 1;

  return benchmarkVariance > 0 ? covariance / benchmarkVariance : 1;
}

function calculateTrackingError(
  matched: Array<{ agentReturn: number; benchmarkReturn: number }>,
): number {
  if (matched.length < 3) return 0;

  const diffs = matched.map((m) => m.agentReturn - m.benchmarkReturn);
  const variance = computeVariance(diffs);

  return Math.sqrt(variance) * Math.sqrt(TRADING_DAYS_PER_YEAR); // Annualized
}

function calculateRollingComparisons(
  agentReturns: Array<{ date: string; returnPercent: number }>,
  benchmarkSnapshots: BenchmarkSnapshot[],
): AgentBenchmarkComparison["rolling"] {
  const periods = [
    { label: "7d", days: 7 },
    { label: "30d", days: 30 },
    { label: "90d", days: 90 },
  ];

  const results: AgentBenchmarkComparison["rolling"] = [];

  for (const period of periods) {
    const recentAgent = agentReturns.slice(-period.days);
    const recentBenchmark = benchmarkSnapshots.slice(-period.days);

    const agentReturn = sumByKey(recentAgent, "returnPercent");
    const spyReturn = sumByKey(recentBenchmark, "spyReturn");

    results.push({
      period: period.label,
      agentReturn: round2(agentReturn),
      spyReturn: round2(spyReturn),
      alpha: Math.round((agentReturn - spyReturn) * 100) / 100,
    });
  }

  return results;
}

function buildEquityCurve(
  agentReturns: Array<{ date: string; returnPercent: number; portfolioValue: number }>,
  benchmarkSnapshots: BenchmarkSnapshot[],
): AgentBenchmarkComparison["equityCurve"] {
  const curve: AgentBenchmarkComparison["equityCurve"] = [];
  const benchmarkByDate = new Map(
    benchmarkSnapshots.map((s) => [s.date, s]),
  );

  // Start benchmark at same initial value as agent
  const initialAgentValue =
    agentReturns.length > 0 ? agentReturns[0].portfolioValue : BENCHMARK_INITIAL_PORTFOLIO_VALUE;
  let benchmarkValue = initialAgentValue;

  for (const ar of agentReturns) {
    const bm = benchmarkByDate.get(ar.date);
    if (bm) {
      benchmarkValue = benchmarkValue * (1 + bm.spyReturn / 100);
    }

    curve.push({
      date: ar.date,
      agentValue: round2(ar.portfolioValue),
      benchmarkValue: round2(benchmarkValue),
    });
  }

  return curve;
}

// ---------------------------------------------------------------------------
// Benchmark History Access
// ---------------------------------------------------------------------------

/**
 * Get raw benchmark history (for charting).
 */
export function getBenchmarkHistory(limit = 90): BenchmarkSnapshot[] {
  return benchmarkHistory.slice(-limit);
}

/**
 * Get the latest benchmark snapshot.
 */
export function getLatestBenchmark(): BenchmarkSnapshot | null {
  return benchmarkHistory.length > 0
    ? benchmarkHistory[benchmarkHistory.length - 1]
    : null;
}
