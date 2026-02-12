/**
 * Monte Carlo Backtester
 *
 * Runs Monte Carlo simulations on AI agent trading strategies to forecast
 * potential outcomes over configurable time horizons. By resampling from
 * each agent's historical return distribution (with replacement), the
 * engine generates thousands of possible equity paths and aggregates them
 * into a comprehensive statistical report.
 *
 * Key capabilities:
 * 1. Per-agent simulation with configurable parameters
 * 2. Geometric compounding for realistic equity path modeling
 * 3. Full distribution analysis (percentiles, VaR, CVaR)
 * 4. Comparative multi-agent simulation with win-probability ranking
 * 5. Histogram bucketing for distribution visualization
 *
 * All computations are performed in-memory from recorded trade data.
 * No database access is required — feed trade data via recordHistoricalTrade().
 */

import { round2, countByCondition } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration parameters for a Monte Carlo simulation run. */
export interface MonteCarloConfig {
  /** Number of independent simulation paths to generate. */
  numSimulations: number;
  /** Forecast horizon in trading days. */
  horizonDays: number;
  /** Starting capital for each simulation path (USD). */
  initialCapital: number;
  /** Confidence level for VaR / CVaR calculation (e.g. 0.95). */
  confidenceLevel: number;
}

/** A single historical trade record used as simulation input. */
export interface HistoricalTrade {
  /** Stock symbol traded. */
  symbol: string;
  /** Trade direction. */
  action: "buy" | "sell" | "hold";
  /** Realized return percentage for this trade (e.g. 1.5 for +1.5%). */
  returnPct: number;
  /** When the trade occurred. */
  timestamp: string;
}

/** Outcome metrics for a single simulation path. */
export interface SimulationResult {
  /** Portfolio value at the end of the horizon. */
  finalValue: number;
  /** Maximum peak-to-trough drawdown as a percentage. */
  maxDrawdown: number;
  /** Annualized Sharpe ratio for this path. */
  sharpeRatio: number;
  /** Total return as a percentage. */
  totalReturn: number;
  /** Fraction of days with positive returns (0-1). */
  winRate: number;
  /** Best single-day return percentage. */
  bestDay: number;
  /** Worst single-day return percentage. */
  worstDay: number;
}

/** A single bucket in the distribution histogram. */
export interface DistributionBucket {
  /** Lower bound of the bucket (inclusive). */
  rangeMin: number;
  /** Upper bound of the bucket (exclusive, except for the last bucket). */
  rangeMax: number;
  /** Number of simulations whose final value fell in this bucket. */
  count: number;
  /** Percentage of total simulations in this bucket. */
  percentage: number;
}

/** Aggregate statistical report from a full Monte Carlo run. */
export interface MonteCarloReport {
  /** Agent that was simulated. */
  agentId: string;
  /** Configuration used for this run. */
  config: MonteCarloConfig;
  /** Number of historical trades the simulation was based on. */
  historicalTradeCount: number;
  /** Mean of all simulated final portfolio values. */
  mean: number;
  /** Median of all simulated final portfolio values. */
  median: number;
  /** Standard deviation of final portfolio values. */
  std: number;
  /** Key percentiles of the final value distribution. */
  percentiles: {
    p5: number;
    p25: number;
    p50: number;
    p75: number;
    p95: number;
  };
  /** Probability that the portfolio ends above initial capital. */
  probabilityOfProfit: number;
  /** Probability of losing more than 10% of initial capital. */
  probabilityOfLosing10Pct: number;
  /** Probability of at least doubling the initial capital. */
  probabilityOfDoubling: number;
  /** Value at Risk at the configured confidence level (dollar loss). */
  valueAtRisk: number;
  /** Conditional VaR (Expected Shortfall) — average loss in the tail. */
  conditionalVaR: number;
  /** The single best simulation outcome. */
  bestSimulation: SimulationResult;
  /** The single worst simulation outcome. */
  worstSimulation: SimulationResult;
  /** Histogram of final values for distribution visualization. */
  distributionBuckets: DistributionBucket[];
  /** Wall-clock time to run the simulation in milliseconds. */
  executionTimeMs: number;
  /** ISO timestamp when the report was generated. */
  generatedAt: string;
}

/** Result of a comparative simulation across all agents. */
export interface ComparativeSimulationReport {
  /** Configuration used for every agent's simulation. */
  config: MonteCarloConfig;
  /** Per-agent reports, ordered by mean final value descending. */
  agentReports: MonteCarloReport[];
  /** Rankings with win probability for each agent. */
  rankings: Array<{
    rank: number;
    agentId: string;
    meanFinalValue: number;
    medianFinalValue: number;
    probabilityOfWinning: number;
    probabilityOfProfit: number;
    sharpeRatioMean: number;
  }>;
  /** Summary insight text. */
  summary: string;
  /** ISO timestamp when the report was generated. */
  generatedAt: string;
}

/** Operational metrics for the simulation engine. */
export interface SimulationMetrics {
  /** Total number of individual simulations executed. */
  totalSimulationsRun: number;
  /** Total number of full Monte Carlo reports generated. */
  totalReportsGenerated: number;
  /** Average wall-clock time per full report in milliseconds. */
  avgReportTimeMs: number;
  /** Average time per single simulation path in microseconds. */
  avgSimulationTimeUs: number;
  /** Number of agents with recorded trade data. */
  agentsWithData: number;
  /** Total historical trades recorded across all agents. */
  totalHistoricalTrades: number;
  /** ISO timestamp of the most recent simulation run. */
  lastRunAt: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default simulation configuration. */
const DEFAULT_CONFIG: MonteCarloConfig = {
  numSimulations: 1000,
  horizonDays: 30,
  initialCapital: 10000,
  confidenceLevel: 0.95,
};

/** The three competing AI agents in the MoltApp arena. */
const AGENT_IDS = ["claude-trader", "gpt-momentum", "grok-contrarian"] as const;

/** Human-readable names for each agent. */
const AGENT_NAMES: Record<string, string> = {
  "claude-trader": "Claude Trader",
  "gpt-momentum": "GPT Momentum",
  "grok-contrarian": "Grok Contrarian",
};

/** Number of buckets in the distribution histogram. */
const HISTOGRAM_BUCKETS = 20;

/** Maximum historical trades to retain per agent. */
const MAX_TRADES_PER_AGENT = 5000;

/** Annualized risk-free rate for Sharpe calculation. */
const RISK_FREE_RATE = 0.05;

/** Trading days per year. */
const TRADING_DAYS_PER_YEAR = 252;

// ---------------------------------------------------------------------------
// Probability Threshold Constants
// ---------------------------------------------------------------------------

/**
 * Loss threshold multiplier for probabilityOfLosing10Pct calculation.
 * Value of 0.90 means 90% of initial capital remaining = 10% loss.
 *
 * This threshold determines when a portfolio outcome is classified as
 * "significant loss" in Monte Carlo simulation reports. Used to compute
 * the probability that an agent's portfolio will decline by 10% or more.
 *
 * Example: $10,000 initial × 0.90 = $9,000 threshold
 *          Final values < $9,000 count toward probabilityOfLosing10Pct
 */
const LOSS_THRESHOLD_MULTIPLIER = 0.90;

/**
 * Doubling threshold multiplier for probabilityOfDoubling calculation.
 * Value of 2 means 2× initial capital = 100% gain.
 *
 * This threshold determines when a portfolio outcome is classified as
 * "exceptional performance" in Monte Carlo simulation reports. Used to
 * compute the probability that an agent doubles their initial capital.
 *
 * Example: $10,000 initial × 2 = $20,000 threshold
 *          Final values >= $20,000 count toward probabilityOfDoubling
 */
const DOUBLING_THRESHOLD_MULTIPLIER = 2;

// ---------------------------------------------------------------------------
// Statistical Calculation Parameters
// ---------------------------------------------------------------------------

/**
 * Sample size for mean Sharpe ratio calculation in comparative simulations.
 * Value of 100 paths provides accurate Sharpe estimation while maintaining
 * performance for comparative analysis across multiple agents.
 *
 * Reducing this value improves performance but reduces Sharpe accuracy.
 * Increasing it above 100 provides diminishing returns (Sharpe converges
 * quickly with just 100 samples from the return distribution).
 */
const SHARPE_SAMPLE_SIZE = 100;

/**
 * Minimum tail size for Conditional VaR (CVaR / Expected Shortfall) calculation.
 * Value of 1 ensures CVaR always has at least one observation in the tail,
 * even when the VaR index falls at the very first element of the sorted array.
 *
 * This prevents division-by-zero errors when computing the average loss
 * in the tail distribution. For tiny simulation sets (e.g., numSimulations = 5),
 * this ensures CVaR = VaR when there's only one tail observation.
 */
const CVAR_MIN_TAIL_SIZE = 1;

// ---------------------------------------------------------------------------
// Module-Level State
// ---------------------------------------------------------------------------

/** Historical trade data keyed by agent ID. */
const tradeHistory = new Map<string, HistoricalTrade[]>();

/** Running count of individual simulation paths executed. */
let totalSimulationsRun = 0;

/** Running count of full Monte Carlo reports generated. */
let totalReportsGenerated = 0;

/** Cumulative report generation time for averaging. */
let cumulativeReportTimeMs = 0;

/** Cumulative single-simulation time for averaging (microseconds). */
let cumulativeSimulationTimeUs = 0;

/** ISO timestamp of the last simulation run. */
let lastRunAt: string | null = null;

// ---------------------------------------------------------------------------
// Data Ingestion
// ---------------------------------------------------------------------------

/**
 * Record a historical trade for an agent. These trades form the empirical
 * return distribution from which Monte Carlo paths are sampled.
 *
 * @param agentId - The agent that executed the trade
 * @param trade   - The trade record including return percentage
 */
export function recordHistoricalTrade(agentId: string, trade: HistoricalTrade): void {
  const existing = tradeHistory.get(agentId) ?? [];
  existing.push(trade);

  // Enforce per-agent capacity limit
  if (existing.length > MAX_TRADES_PER_AGENT) {
    existing.splice(0, existing.length - MAX_TRADES_PER_AGENT);
  }

  tradeHistory.set(agentId, existing);
}

/**
 * Bulk-record multiple trades for an agent.
 *
 * @param agentId - The agent that executed the trades
 * @param trades  - Array of trade records
 */
export function recordHistoricalTrades(agentId: string, trades: HistoricalTrade[]): void {
  for (const trade of trades) {
    recordHistoricalTrade(agentId, trade);
  }
}

/**
 * Get the number of historical trades recorded for an agent.
 *
 * @param agentId - The agent to query
 * @returns Number of stored trades, or 0 if none
 */
export function getTradeCount(agentId: string): number {
  return tradeHistory.get(agentId)?.length ?? 0;
}

// ---------------------------------------------------------------------------
// Core Simulation Engine
// ---------------------------------------------------------------------------

/**
 * Run a full Monte Carlo simulation for a single agent.
 *
 * Samples with replacement from the agent's historical return distribution
 * to generate `numSimulations` independent equity paths over `horizonDays`
 * trading days. Each path applies geometric (compounding) returns.
 *
 * @param agentId - The agent to simulate
 * @param config  - Optional overrides for simulation parameters
 * @returns A comprehensive MonteCarloReport
 * @throws Error if the agent has no recorded trade history
 */
export function runMonteCarloSimulation(
  agentId: string,
  config?: Partial<MonteCarloConfig>,
): MonteCarloReport {
  const cfg: MonteCarloConfig = { ...DEFAULT_CONFIG, ...config };
  const trades = tradeHistory.get(agentId);

  if (!trades || trades.length === 0) {
    throw new Error(
      `No historical trade data for agent "${agentId}". ` +
      `Call recordHistoricalTrade() before running simulations.`,
    );
  }

  const startTime = performance.now();

  // Extract the empirical return distribution (percentages)
  const returns = trades.map((t) => t.returnPct);

  // Precompute distribution statistics for the agent
  const agentWinRate = countByCondition(returns, (r) => r > 0) / returns.length;
  const positiveReturns = returns.filter((r) => r > 0);
  const negativeReturns = returns.filter((r) => r <= 0);
  const avgGain = positiveReturns.length > 0
    ? positiveReturns.reduce((s, r) => s + r, 0) / positiveReturns.length
    : 0;
  const avgLoss = negativeReturns.length > 0
    ? negativeReturns.reduce((s, r) => s + r, 0) / negativeReturns.length
    : 0;

  // Run all simulation paths
  const results: SimulationResult[] = [];

  for (let sim = 0; sim < cfg.numSimulations; sim++) {
    const simStartUs = performance.now() * 1000;
    const result = runSingleSimulation(returns, cfg);
    results.push(result);
    cumulativeSimulationTimeUs += (performance.now() * 1000) - simStartUs;
  }

  totalSimulationsRun += cfg.numSimulations;

  // Aggregate results into a report
  const report = aggregateResults(agentId, results, cfg, trades.length);

  const elapsed = performance.now() - startTime;
  report.executionTimeMs = round2(elapsed);

  // Update operational metrics
  totalReportsGenerated++;
  cumulativeReportTimeMs += elapsed;
  lastRunAt = new Date().toISOString();

  return report;
}

/**
 * Execute a single simulation path by sampling daily returns with
 * replacement from the empirical distribution and compounding them.
 */
function runSingleSimulation(
  returns: number[],
  config: MonteCarloConfig,
): SimulationResult {
  const { horizonDays, initialCapital } = config;
  let equity = initialCapital;
  let peak = equity;
  let maxDrawdown = 0;
  let winDays = 0;
  let bestDay = -Infinity;
  let worstDay = Infinity;
  const dailyReturns: number[] = [];

  for (let day = 0; day < horizonDays; day++) {
    // Sample with replacement from the historical return distribution
    const randomIndex = Math.floor(Math.random() * returns.length);
    const dailyReturnPct = returns[randomIndex];

    // Apply geometric (compounding) return
    const dailyMultiplier = 1 + dailyReturnPct / 100;
    equity *= dailyMultiplier;

    // Ensure equity does not go below zero
    if (equity < 0) equity = 0;

    // Track daily return for Sharpe calculation
    dailyReturns.push(dailyReturnPct);

    // Track win days
    if (dailyReturnPct > 0) winDays++;

    // Track best/worst days
    if (dailyReturnPct > bestDay) bestDay = dailyReturnPct;
    if (dailyReturnPct < worstDay) worstDay = dailyReturnPct;

    // Track drawdown
    if (equity > peak) peak = equity;
    const drawdown = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  // Compute Sharpe ratio for this path
  const sharpeRatio = computeSharpeRatio(dailyReturns);

  const totalReturn = initialCapital > 0
    ? ((equity - initialCapital) / initialCapital) * 100
    : 0;

  return {
    finalValue: round2(equity),
    maxDrawdown: round2(maxDrawdown),
    sharpeRatio: round2(sharpeRatio),
    totalReturn: round2(totalReturn),
    winRate: horizonDays > 0 ? round2(winDays / horizonDays) : 0,
    bestDay: round2(bestDay === -Infinity ? 0 : bestDay),
    worstDay: round2(worstDay === Infinity ? 0 : worstDay),
  };
}

/**
 * Compute the annualized Sharpe ratio from an array of daily return
 * percentages, using the module-level risk-free rate constant.
 */
function computeSharpeRatio(dailyReturns: number[]): number {
  if (dailyReturns.length < 2) return 0;

  const mean = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce(
    (s, r) => s + (r - mean) ** 2,
    0,
  ) / (dailyReturns.length - 1);
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return 0;

  const dailyRfr = RISK_FREE_RATE / TRADING_DAYS_PER_YEAR * 100; // as percentage
  const excessReturn = mean - dailyRfr;

  return (excessReturn / stdDev) * Math.sqrt(TRADING_DAYS_PER_YEAR);
}

// ---------------------------------------------------------------------------
// Result Aggregation
// ---------------------------------------------------------------------------

/**
 * Aggregate individual simulation results into a comprehensive
 * MonteCarloReport with distribution analysis, tail risk metrics,
 * and histogram bucketing.
 */
function aggregateResults(
  agentId: string,
  results: SimulationResult[],
  config: MonteCarloConfig,
  historicalTradeCount: number,
): MonteCarloReport {
  const finalValues = results.map((r) => r.finalValue);
  const sorted = [...finalValues].sort((a, b) => a - b);

  // Central tendency
  const mean = finalValues.reduce((s, v) => s + v, 0) / finalValues.length;
  const median = getPercentile(sorted, 0.50);
  const std = computeStdDev(finalValues, mean);

  // Percentiles
  const percentiles = {
    p5: round2(getPercentile(sorted, 0.05)),
    p25: round2(getPercentile(sorted, 0.25)),
    p50: round2(getPercentile(sorted, 0.50)),
    p75: round2(getPercentile(sorted, 0.75)),
    p95: round2(getPercentile(sorted, 0.95)),
  };

  // Probability metrics
  const totalSims = results.length;
  const probabilityOfProfit = round2(
    countByCondition(finalValues, (v) => v > config.initialCapital) / totalSims * 100,
  );
  const lossThreshold = config.initialCapital * LOSS_THRESHOLD_MULTIPLIER;
  const probabilityOfLosing10Pct = round2(
    countByCondition(finalValues, (v) => v < lossThreshold) / totalSims * 100,
  );
  const probabilityOfDoubling = round2(
    countByCondition(finalValues, (v) => v >= config.initialCapital * DOUBLING_THRESHOLD_MULTIPLIER) / totalSims * 100,
  );

  // Value at Risk and Conditional VaR
  const { valueAtRisk, conditionalVaR } = computeVaRMetrics(
    sorted,
    config.initialCapital,
    config.confidenceLevel,
  );

  // Best and worst simulations
  const sortedByReturn = [...results].sort((a, b) => b.totalReturn - a.totalReturn);
  const bestSimulation = sortedByReturn[0];
  const worstSimulation = sortedByReturn[sortedByReturn.length - 1];

  // Distribution histogram
  const distributionBuckets = buildHistogram(sorted, totalSims);

  return {
    agentId,
    config,
    historicalTradeCount,
    mean: round2(mean),
    median: round2(median),
    std: round2(std),
    percentiles,
    probabilityOfProfit,
    probabilityOfLosing10Pct,
    probabilityOfDoubling,
    valueAtRisk: round2(valueAtRisk),
    conditionalVaR: round2(conditionalVaR),
    bestSimulation,
    worstSimulation,
    distributionBuckets,
    executionTimeMs: 0, // Set by caller
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Compute Value at Risk and Conditional VaR (Expected Shortfall).
 *
 * VaR is the maximum loss not exceeded at the given confidence level.
 * CVaR is the average loss in the tail beyond VaR.
 *
 * @param sortedValues - Final portfolio values sorted ascending
 * @param initialCapital - Starting capital
 * @param confidenceLevel - e.g. 0.95 for 95% confidence
 */
function computeVaRMetrics(
  sortedValues: number[],
  initialCapital: number,
  confidenceLevel: number,
): { valueAtRisk: number; conditionalVaR: number } {
  if (sortedValues.length === 0) {
    return { valueAtRisk: 0, conditionalVaR: 0 };
  }

  const tailProbability = 1 - confidenceLevel;
  const varIndex = Math.floor(sortedValues.length * tailProbability);
  const varValue = sortedValues[Math.max(0, varIndex)];

  // VaR is the loss relative to initial capital
  const valueAtRisk = Math.max(0, initialCapital - varValue);

  // CVaR: average of all losses worse than VaR
  const tailValues = sortedValues.slice(0, Math.max(CVAR_MIN_TAIL_SIZE, varIndex));
  const tailLosses = tailValues.map((v) => Math.max(0, initialCapital - v));
  const conditionalVaR = tailLosses.length > 0
    ? tailLosses.reduce((s, l) => s + l, 0) / tailLosses.length
    : valueAtRisk;

  return { valueAtRisk, conditionalVaR };
}

/**
 * Build a histogram of final portfolio values for distribution visualization.
 *
 * @param sortedValues - Final portfolio values sorted ascending
 * @param totalCount   - Total number of simulations
 * @returns Array of histogram buckets
 */
function buildHistogram(sortedValues: number[], totalCount: number): DistributionBucket[] {
  if (sortedValues.length === 0) return [];

  const min = sortedValues[0];
  const max = sortedValues[sortedValues.length - 1];

  // Handle edge case where all values are identical
  if (max === min) {
    return [{
      rangeMin: round2(min),
      rangeMax: round2(max),
      count: totalCount,
      percentage: 100,
    }];
  }

  const bucketWidth = (max - min) / HISTOGRAM_BUCKETS;
  const buckets: DistributionBucket[] = [];

  for (let i = 0; i < HISTOGRAM_BUCKETS; i++) {
    const rangeMin = min + i * bucketWidth;
    const rangeMax = min + (i + 1) * bucketWidth;
    buckets.push({
      rangeMin: round2(rangeMin),
      rangeMax: round2(rangeMax),
      count: 0,
      percentage: 0,
    });
  }

  // Assign each value to a bucket
  for (const value of sortedValues) {
    let bucketIndex = Math.floor((value - min) / bucketWidth);
    // Clamp the last value into the final bucket
    if (bucketIndex >= HISTOGRAM_BUCKETS) bucketIndex = HISTOGRAM_BUCKETS - 1;
    buckets[bucketIndex].count++;
  }

  // Compute percentages
  for (const bucket of buckets) {
    bucket.percentage = round2((bucket.count / totalCount) * 100);
  }

  return buckets;
}

// ---------------------------------------------------------------------------
// Comparative Simulation
// ---------------------------------------------------------------------------

/**
 * Run Monte Carlo simulations for all three agents and produce a
 * comparative report with win-probability rankings.
 *
 * For each simulation index, the agent with the highest final value
 * is considered the "winner" of that scenario. The win probability
 * is the fraction of scenarios each agent wins.
 *
 * @param config - Optional overrides for simulation parameters
 * @returns Comparative report with rankings
 */
export function runComparativeSimulation(
  config?: Partial<MonteCarloConfig>,
): ComparativeSimulationReport {
  const cfg: MonteCarloConfig = { ...DEFAULT_CONFIG, ...config };

  // Run individual simulations for each agent that has data
  const agentReports: MonteCarloReport[] = [];
  const agentFinalValues = new Map<string, number[]>();

  for (const agentId of AGENT_IDS) {
    const trades = tradeHistory.get(agentId);
    if (!trades || trades.length === 0) continue;

    const report = runMonteCarloSimulation(agentId, cfg);
    agentReports.push(report);

    // Reconstruct final values for pairwise comparison
    // We need to re-run to get matching simulation indices, so we store
    // a separate set of final values for win-probability computation
    const returns = trades.map((t) => t.returnPct);
    const finalValues: number[] = [];
    for (let sim = 0; sim < cfg.numSimulations; sim++) {
      const result = runSingleSimulation(returns, cfg);
      finalValues.push(result.finalValue);
    }
    agentFinalValues.set(agentId, finalValues);
  }

  if (agentReports.length === 0) {
    return {
      config: cfg,
      agentReports: [],
      rankings: [],
      summary: "No agents have recorded trade data. Call recordHistoricalTrade() first.",
      generatedAt: new Date().toISOString(),
    };
  }

  // Compute win probabilities by comparing simulation-by-simulation
  const winCounts: Record<string, number> = {};
  for (const id of AGENT_IDS) winCounts[id] = 0;

  const participatingAgents = Array.from(agentFinalValues.keys());

  for (let sim = 0; sim < cfg.numSimulations; sim++) {
    let bestAgent = participatingAgents[0];
    let bestValue = -Infinity;

    for (const agentId of participatingAgents) {
      const values = agentFinalValues.get(agentId)!;
      if (values[sim] > bestValue) {
        bestValue = values[sim];
        bestAgent = agentId;
      }
    }

    winCounts[bestAgent] = (winCounts[bestAgent] ?? 0) + 1;
  }

  // Build rankings
  const rankings = agentReports
    .map((report) => {
      const sharpeValues = report.distributionBuckets.length > 0
        ? report.mean  // Already have this from the report
        : 0;

      return {
        rank: 0,
        agentId: report.agentId,
        meanFinalValue: report.mean,
        medianFinalValue: report.median,
        probabilityOfWinning: round2(
          (winCounts[report.agentId] ?? 0) / cfg.numSimulations * 100,
        ),
        probabilityOfProfit: report.probabilityOfProfit,
        sharpeRatioMean: round2(
          computeMeanSharpe(tradeHistory.get(report.agentId)!, cfg),
        ),
      };
    })
    .sort((a, b) => b.meanFinalValue - a.meanFinalValue)
    .map((r, i) => ({ ...r, rank: i + 1 }));

  // Sort agent reports by mean final value descending
  agentReports.sort((a, b) => b.mean - a.mean);

  // Generate summary
  const summary = buildComparativeSummary(rankings);

  return {
    config: cfg,
    agentReports,
    rankings,
    summary,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Compute the mean Sharpe ratio across a sample of simulation paths.
 * Uses a reduced sample size for performance (see SHARPE_SAMPLE_SIZE constant).
 */
function computeMeanSharpe(trades: HistoricalTrade[], config: MonteCarloConfig): number {
  const returns = trades.map((t) => t.returnPct);
  const sampleSize = Math.min(SHARPE_SAMPLE_SIZE, config.numSimulations);
  let totalSharpe = 0;

  for (let i = 0; i < sampleSize; i++) {
    const dailyReturns: number[] = [];
    for (let day = 0; day < config.horizonDays; day++) {
      const idx = Math.floor(Math.random() * returns.length);
      dailyReturns.push(returns[idx]);
    }
    totalSharpe += computeSharpeRatio(dailyReturns);
  }

  return totalSharpe / sampleSize;
}

/**
 * Build a human-readable summary from comparative rankings.
 */
function buildComparativeSummary(
  rankings: ComparativeSimulationReport["rankings"],
): string {
  if (rankings.length === 0) return "No agents available for comparison.";

  const leader = rankings[0];
  const leaderName = AGENT_NAMES[leader.agentId] ?? leader.agentId;

  const parts: string[] = [];

  parts.push(
    `${leaderName} leads with a ${leader.probabilityOfWinning.toFixed(1)}% probability of ` +
    `outperforming the other agents (mean final value: $${leader.meanFinalValue.toFixed(2)}).`,
  );

  if (rankings.length > 1) {
    const runner = rankings[1];
    const runnerName = AGENT_NAMES[runner.agentId] ?? runner.agentId;
    parts.push(
      `${runnerName} follows with ${runner.probabilityOfWinning.toFixed(1)}% win probability ` +
      `(mean: $${runner.meanFinalValue.toFixed(2)}).`,
    );
  }

  // Identify highest probability of profit
  const bestProfit = rankings.reduce(
    (best, r) => r.probabilityOfProfit > best.probabilityOfProfit ? r : best,
  );
  const bestProfitName = AGENT_NAMES[bestProfit.agentId] ?? bestProfit.agentId;
  parts.push(
    `${bestProfitName} has the highest probability of profit at ${bestProfit.probabilityOfProfit.toFixed(1)}%.`,
  );

  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Operational Metrics
// ---------------------------------------------------------------------------

/**
 * Get operational metrics for the Monte Carlo simulation engine.
 *
 * @returns Current engine statistics
 */
export function getSimulationMetrics(): SimulationMetrics {
  let totalTrades = 0;
  tradeHistory.forEach((trades) => {
    totalTrades += trades.length;
  });

  return {
    totalSimulationsRun,
    totalReportsGenerated,
    avgReportTimeMs: totalReportsGenerated > 0
      ? round2(cumulativeReportTimeMs / totalReportsGenerated)
      : 0,
    avgSimulationTimeUs: totalSimulationsRun > 0
      ? round2(cumulativeSimulationTimeUs / totalSimulationsRun)
      : 0,
    agentsWithData: tradeHistory.size,
    totalHistoricalTrades: totalTrades,
    lastRunAt,
  };
}

// ---------------------------------------------------------------------------
// Math Utilities
// ---------------------------------------------------------------------------

/**
 * Compute the percentile value from a pre-sorted array using linear
 * interpolation between the two nearest ranks.
 *
 * @param sorted - Array of values sorted in ascending order
 * @param p      - Percentile as a fraction (0-1), e.g. 0.95 for 95th
 * @returns The interpolated percentile value
 */
function getPercentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];

  // Use the "exclusive" percentile method (R-6 in R terminology)
  const rank = p * (sorted.length + 1) - 1;
  const lowerIndex = Math.max(0, Math.floor(rank));
  const upperIndex = Math.min(sorted.length - 1, lowerIndex + 1);
  const fraction = rank - lowerIndex;

  // Clamp indices
  if (lowerIndex < 0) return sorted[0];
  if (lowerIndex >= sorted.length - 1) return sorted[sorted.length - 1];

  // Linear interpolation
  return sorted[lowerIndex] + fraction * (sorted[upperIndex] - sorted[lowerIndex]);
}

/**
 * Compute the sample standard deviation.
 *
 * @param values - Array of numeric values
 * @param mean   - Pre-computed mean of the values
 * @returns Sample standard deviation
 */
function computeStdDev(values: number[], mean: number): number {
  if (values.length < 2) return 0;

  const sumSquaredDiffs = values.reduce(
    (sum, v) => sum + (v - mean) ** 2,
    0,
  );

  return Math.sqrt(sumSquaredDiffs / (values.length - 1));
}

// ---------------------------------------------------------------------------
// Admin / Reset
// ---------------------------------------------------------------------------

/**
 * Clear all recorded trade history and reset operational metrics.
 * Intended for testing or administrative resets.
 */
export function resetMonteCarloState(): void {
  tradeHistory.clear();
  totalSimulationsRun = 0;
  totalReportsGenerated = 0;
  cumulativeReportTimeMs = 0;
  cumulativeSimulationTimeUs = 0;
  lastRunAt = null;
}
