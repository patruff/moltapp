/**
 * Risk-Adjusted Portfolio Rebalancer
 *
 * Automatic position sizing and portfolio rebalancing using quantitative
 * finance methods. Runs after each trading round to ensure agents maintain
 * optimal allocations based on their risk tolerance profiles.
 *
 * Methods implemented:
 * 1. Mean-Variance Optimization (Markowitz) — maximize Sharpe ratio
 * 2. Risk Parity — equal risk contribution from each position
 * 3. Kelly Criterion — optimal bet sizing based on win probability
 * 4. Volatility Targeting — scale positions to target portfolio volatility
 * 5. Maximum Diversification — minimize correlation between holdings
 *
 * Each agent can have a different rebalancing strategy based on their
 * personality and risk tolerance.
 */

import { db } from "../db/index.ts";
import { trades } from "../db/schema/trades.ts";
import { positions } from "../db/schema/positions.ts";
import { eq, and, gte } from "drizzle-orm";
import { XSTOCKS_CATALOG } from "../config/constants.ts";
import { round2, round3, calculateAverage, computeVariance } from "../lib/math-utils.ts";
import { nowISO } from "../lib/format-utils.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Synthetic Return Generation Parameters
 *
 * When insufficient real trade history exists, synthetic returns are generated
 * using Box-Muller transform to simulate realistic daily price movements.
 */

/**
 * Minimum daily return data points required before triggering synthetic generation.
 * If trade history has fewer than this many data points, use synthetic returns
 * based on symbol volatility characteristics instead.
 *
 * Example: If TSLAx only has 3 trades in lookback window (< 5), generate synthetic
 * daily returns using baseVol=3.5% to fill the gap.
 */
const SYNTHETIC_RETURNS_MIN_DAILY = 5;

/**
 * Daily positive drift assumption for synthetic returns (as decimal).
 * Small upward bias (0.03% per day = ~7.6% annualized) matches long-term
 * equity market drift without overstating expected returns.
 *
 * Example: Synthetic return = z * baseVol * 0.01 + 0.0003 where z ~ N(0,1)
 */
const SYNTHETIC_DRIFT_POSITIVE = 0.0003;

/**
 * Volatility scaling factor for normal distribution in synthetic returns.
 * Converts baseVol percentage (e.g., 2.5%) to decimal volatility (0.025).
 *
 * Example: baseVol=2.5, scaling=0.01 → daily vol = 2.5 * 0.01 = 0.025 = 2.5%
 */
const SYNTHETIC_VOL_SCALING = 0.01;

/**
 * Annualization Parameters
 */

/**
 * Number of trading days per year for annualizing returns and volatility.
 * Standard assumption: 252 trading days (365 calendar days - weekends - holidays).
 *
 * Used for: meanReturn * 252, volatility * sqrt(252), covariance * 252
 *
 * Example: Daily return 0.1% → annualized return = 0.001 * 252 = 25.2%
 */
const TRADING_DAYS_PER_YEAR = 252;

/**
 * Stock Base Volatility Estimates
 *
 * Daily volatility percentages used for synthetic return generation when
 * insufficient trade history exists. Based on observed market characteristics.
 */

/**
 * High volatility tier: meme stocks, crypto-exposed, high retail participation.
 * Daily volatility ~3.5% (annualized ~55%).
 *
 * Stocks: TSLAx, COINx, MSTRx, HOODx, GMEx, PLTRx
 */
const STOCK_VOLATILITY_HIGH = 3.5;

/**
 * Medium volatility tier: growth tech stocks with moderate volatility.
 * Daily volatility ~2.5% (annualized ~40%).
 *
 * Stocks: NVDAx, METAx, AMZNx, NFLXx, CRMx
 */
const STOCK_VOLATILITY_MEDIUM = 2.5;

/**
 * Low volatility tier: large-cap tech, indexes, stable blue chips.
 * Daily volatility ~1.5% (annualized ~24%).
 *
 * Stocks: AAPLx, MSFTx, GOOGLx, SPYx, QQQx, JPMx, LLYx, AVGOx
 */
const STOCK_VOLATILITY_LOW = 1.5;

/**
 * Default volatility for unknown symbols.
 * Daily volatility ~2.0% (annualized ~32%).
 */
const STOCK_VOLATILITY_DEFAULT = 2.0;

/**
 * Transaction Cost Parameters
 */

/**
 * Estimated transaction cost rate per trade via Jupiter DEX (as decimal).
 * Assumes 0.3% total cost (0.25% Jupiter fees + 0.05% slippage).
 *
 * Example: $1,000 rebalance trade → estimated cost = $1,000 * 0.003 = $3
 */
const TRANSACTION_COST_RATE = 0.003;

/**
 * Kelly Criterion Safety Factor
 *
 * Industry standard: use half-Kelly (0.5) for conservative position sizing.
 * Full Kelly criterion maximizes long-term growth but can be too aggressive —
 * it assumes perfect knowledge of win probability and edge, which is never exact.
 * Half-Kelly reduces variance and drawdown risk while still capturing most
 * of the long-run growth benefit.
 *
 * Formula: optimal_position = fullKelly × KELLY_SAFETY_FACTOR
 *
 * Example: fullKelly = 0.20 (20% of portfolio) → actual position = 0.20 × 0.5 = 10%
 *
 * References: Edward Thorp, "The Kelly Criterion in Blackjack, Sports Betting, and
 * the Stock Market" — half-Kelly is the standard conservative implementation.
 */
const KELLY_SAFETY_FACTOR = 0.5;

/**
 * Rebalancing Decision Thresholds
 */

/**
 * Sharpe ratio improvement multiplier for net benefit calculation.
 * Converts Sharpe improvement to dollar benefit estimate.
 *
 * Formula: netBenefit = sharpeImprovement * totalValue * 0.01 - estimatedCost
 *
 * Example: Sharpe +0.15, portfolio $10,000 → benefit = 0.15 * 10000 * 0.01 = $15
 */
const SHARPE_IMPROVEMENT_MULTIPLIER = 0.01;

/**
 * Minimum Sharpe ratio improvement to recommend rebalancing (when concentration low).
 * If Sharpe improvement < 5% and HHI < 30%, skip rebalancing (already near-optimal).
 *
 * Example: currentSharpe=1.2, expectedSharpe=1.24 → improvement=0.04 < 0.05 → skip
 */
const SHARPE_IMPROVEMENT_THRESHOLD = 0.05;

/**
 * Concentration risk (HHI) threshold for triggering rebalancing.
 * If HHI > 30% (concentrated portfolio), recommend rebalancing regardless of Sharpe.
 *
 * HHI = sum of squared weights. Example: 3 equal positions → HHI = 3 * (0.33)^2 = 0.33
 * If HHI > 0.3, portfolio is too concentrated (diversification needed).
 */
const CONCENTRATION_RISK_THRESHOLD = 0.3;

/**
 * Query Limits
 */

/**
 * Default limit for rebalance history queries.
 * Prevents overwhelming API responses with full history.
 *
 * Example: getRebalanceHistory(agentId) returns last 20 rebalance records.
 */
const QUERY_LIMIT_DEFAULT = 20;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RebalanceStrategy =
  | "mean-variance"
  | "risk-parity"
  | "kelly"
  | "volatility-target"
  | "max-diversification"
  | "equal-weight";

export interface RebalanceConfig {
  /** Agent's preferred rebalancing strategy */
  strategy: RebalanceStrategy;
  /** Target portfolio volatility (annualized, as decimal) */
  targetVolatility: number;
  /** Maximum allocation to any single stock (0-1) */
  maxSingleAllocation: number;
  /** Minimum allocation to trigger a rebalance trade (0-1) */
  rebalanceThreshold: number;
  /** Minimum cash reserve (as fraction of total portfolio) */
  minCashReserve: number;
  /** Risk-free rate assumption (annualized, as decimal) */
  riskFreeRate: number;
  /** Lookback period for return calculations (days) */
  lookbackDays: number;
  /** Maximum number of positions */
  maxPositions: number;
}

export interface PortfolioWeight {
  symbol: string;
  /** Current weight in portfolio (0-1) */
  currentWeight: number;
  /** Target weight from optimization (0-1) */
  targetWeight: number;
  /** Delta: how much to adjust (positive = buy more, negative = sell) */
  delta: number;
  /** Dollar amount to trade to reach target */
  tradeAmountUsd: number;
  /** Trade direction */
  action: "buy" | "sell" | "hold";
}

export interface RebalanceProposal {
  /** Agent this proposal is for */
  agentId: string;
  /** Strategy used */
  strategy: RebalanceStrategy;
  /** Current portfolio value */
  totalValue: number;
  /** Current cash balance */
  cashBalance: number;
  /** Individual position adjustments */
  adjustments: PortfolioWeight[];
  /** Portfolio-level metrics */
  metrics: {
    /** Current portfolio Sharpe ratio estimate */
    currentSharpe: number;
    /** Expected Sharpe after rebalancing */
    expectedSharpe: number;
    /** Current portfolio volatility (annualized) */
    currentVolatility: number;
    /** Expected volatility after rebalancing */
    expectedVolatility: number;
    /** Concentration (HHI) index — lower = more diversified */
    concentrationIndex: number;
    /** Number of trades required to rebalance */
    tradesRequired: number;
    /** Estimated transaction cost (USDC) */
    estimatedCost: number;
    /** Net benefit of rebalancing (expected improvement minus costs) */
    netBenefit: number;
  };
  /** Whether rebalancing is recommended */
  recommended: boolean;
  /** Reason for recommendation */
  reason: string;
  /** Timestamp */
  timestamp: string;
}

export interface ReturnSeries {
  symbol: string;
  /** Daily returns as decimals */
  returns: number[];
  /** Annualized mean return */
  meanReturn: number;
  /** Annualized standard deviation */
  volatility: number;
}

export interface CovarianceMatrix {
  symbols: string[];
  /** Row-major covariance matrix */
  data: number[][];
}

// ---------------------------------------------------------------------------
// Default configs per risk tolerance
// ---------------------------------------------------------------------------

const DEFAULT_CONFIGS: Record<string, RebalanceConfig> = {
  conservative: {
    strategy: "risk-parity",
    targetVolatility: 0.1,
    maxSingleAllocation: 0.2,
    rebalanceThreshold: 0.05,
    minCashReserve: 0.3,
    riskFreeRate: 0.05,
    lookbackDays: 30,
    maxPositions: 5,
  },
  moderate: {
    strategy: "mean-variance",
    targetVolatility: 0.15,
    maxSingleAllocation: 0.25,
    rebalanceThreshold: 0.05,
    minCashReserve: 0.2,
    riskFreeRate: 0.05,
    lookbackDays: 30,
    maxPositions: 8,
  },
  aggressive: {
    strategy: "kelly",
    targetVolatility: 0.25,
    maxSingleAllocation: 0.35,
    rebalanceThreshold: 0.03,
    minCashReserve: 0.1,
    riskFreeRate: 0.05,
    lookbackDays: 14,
    maxPositions: 10,
  },
};

/**
 * Get rebalance config for an agent based on their risk tolerance.
 */
export function getRebalanceConfig(
  riskTolerance: "conservative" | "moderate" | "aggressive",
  overrides?: Partial<RebalanceConfig>,
): RebalanceConfig {
  return { ...DEFAULT_CONFIGS[riskTolerance], ...overrides };
}

// ---------------------------------------------------------------------------
// Price History & Return Calculations
// ---------------------------------------------------------------------------

/**
 * Build simulated return series from trade history.
 * In production, this would use real OHLCV data from the market aggregator.
 */
export async function getReturnSeries(
  agentId: string,
  symbols: string[],
  lookbackDays: number,
): Promise<ReturnSeries[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - lookbackDays);

  const series: ReturnSeries[] = [];

  for (const symbol of symbols) {
    // Get trade history for this symbol
    const tradeHistory = await db
      .select()
      .from(trades)
      .where(
        and(
          eq(trades.agentId, agentId),
          eq(trades.stockSymbol, symbol),
          gte(trades.createdAt, cutoff),
        ),
      )
      .orderBy(trades.createdAt);

    // Calculate daily returns from price changes between trades
    const dailyReturns: number[] = [];

    if (tradeHistory.length >= 2) {
      for (let i = 1; i < tradeHistory.length; i++) {
        const prevPrice = Number(tradeHistory[i - 1].pricePerToken);
        const currPrice = Number(tradeHistory[i].pricePerToken);
        if (prevPrice > 0) {
          dailyReturns.push((currPrice - prevPrice) / prevPrice);
        }
      }
    }

    // If insufficient trade data, generate from market characteristics
    if (dailyReturns.length < SYNTHETIC_RETURNS_MIN_DAILY) {
      const stockConfig = XSTOCKS_CATALOG.find((s) => s.symbol === symbol);
      if (stockConfig) {
        // Use realistic but synthetic returns based on symbol characteristics
        const baseVol = getSymbolBaseVolatility(symbol);
        for (let d = 0; d < lookbackDays; d++) {
          // Box-Muller transform for normal distribution
          const u1 = Math.random();
          const u2 = Math.random();
          const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
          dailyReturns.push(z * baseVol * SYNTHETIC_VOL_SCALING + SYNTHETIC_DRIFT_POSITIVE);
        }
      }
    }

    const n = dailyReturns.length;
    const meanDaily = n > 0 ? dailyReturns.reduce((s, r) => s + r, 0) / n : 0;
    const varianceDaily = computeVariance(dailyReturns);

    series.push({
      symbol,
      returns: dailyReturns,
      meanReturn: meanDaily * TRADING_DAYS_PER_YEAR, // Annualize
      volatility: Math.sqrt(varianceDaily * TRADING_DAYS_PER_YEAR), // Annualize
    });
  }

  return series;
}

/**
 * Build covariance matrix from return series.
 */
export function buildCovarianceMatrix(
  series: ReturnSeries[],
): CovarianceMatrix {
  const n = series.length;
  const data: number[][] = Array.from({ length: n }, () =>
    Array(n).fill(0),
  );

  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const cov = calculateCovariance(series[i].returns, series[j].returns);
      data[i][j] = cov * TRADING_DAYS_PER_YEAR; // Annualize
      data[j][i] = cov * TRADING_DAYS_PER_YEAR;
    }
  }

  return {
    symbols: series.map((s) => s.symbol),
    data,
  };
}

function calculateCovariance(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;

  const meanA = a.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const meanB = b.slice(0, n).reduce((s, v) => s + v, 0) / n;

  let cov = 0;
  for (let i = 0; i < n; i++) {
    cov += (a[i] - meanA) * (b[i] - meanB);
  }
  return cov / (n - 1);
}

// ---------------------------------------------------------------------------
// Optimization Algorithms
// ---------------------------------------------------------------------------

/**
 * Mean-Variance Optimization (Simplified Markowitz)
 * Finds weights that maximize Sharpe ratio given return and covariance estimates.
 * Uses inverse-variance weighting as an analytical approximation.
 */
function meanVarianceOptimize(
  series: ReturnSeries[],
  covMatrix: CovarianceMatrix,
  config: RebalanceConfig,
): number[] {
  const n = series.length;
  if (n === 0) return [];

  // Inverse-variance weighting (analytical approximation to max Sharpe)
  const excessReturns = series.map((s) => s.meanReturn - config.riskFreeRate);

  // Check if covariance matrix has valid diagonal
  const invVariances = series.map((s, i) => {
    const variance = covMatrix.data[i][i];
    return variance > 0 ? 1 / variance : 0;
  });

  // Weight proportional to excess return / variance (simplified tangency portfolio)
  const rawWeights = excessReturns.map((er, i) => {
    const w = er * invVariances[i];
    return Math.max(0, w); // Long-only constraint
  });

  // Normalize and apply constraints
  return normalizeWeights(rawWeights, config);
}

/**
 * Risk Parity — each position contributes equally to portfolio risk.
 * Positions with lower volatility get higher allocations.
 */
function riskParityOptimize(
  series: ReturnSeries[],
  covMatrix: CovarianceMatrix,
  config: RebalanceConfig,
): number[] {
  const n = series.length;
  if (n === 0) return [];

  // Inverse volatility weighting (risk parity approximation)
  const invVols = series.map((s) =>
    s.volatility > 0 ? 1 / s.volatility : 0,
  );

  return normalizeWeights(invVols, config);
}

/**
 * Kelly Criterion — optimal bet sizing based on edge and odds.
 * Kelly fraction = p/a - q/b where p=win prob, q=loss prob, a=loss size, b=win size
 */
function kellyOptimize(
  series: ReturnSeries[],
  _covMatrix: CovarianceMatrix,
  config: RebalanceConfig,
): number[] {
  const n = series.length;
  if (n === 0) return [];

  const kellyWeights = series.map((s) => {
    const returns = s.returns;
    if (returns.length < 5) return 0;

    const wins = returns.filter((r) => r > 0);
    const losses = returns.filter((r) => r < 0);

    const winProb = wins.length / returns.length;
    const lossProb = 1 - winProb;

    const avgWin = wins.length > 0 ? calculateAverage(wins) : 0;
    const avgLoss =
      losses.length > 0
        ? Math.abs(calculateAverage(losses))
        : 0.01;

    if (avgLoss === 0 || avgWin === 0) return 0;

    // Full Kelly
    const kelly = winProb / avgLoss - lossProb / avgWin;

    // Use half-Kelly for safety (common practice)
    return Math.max(0, kelly * KELLY_SAFETY_FACTOR);
  });

  return normalizeWeights(kellyWeights, config);
}

/**
 * Volatility Targeting — scale all positions to achieve target portfolio volatility.
 */
function volatilityTargetOptimize(
  series: ReturnSeries[],
  covMatrix: CovarianceMatrix,
  config: RebalanceConfig,
): number[] {
  // Start with equal weight, then scale
  const n = series.length;
  if (n === 0) return [];

  const equalWeights = Array(n).fill(1 / n);

  // Calculate portfolio volatility with equal weights
  const portVol = calculatePortfolioVolatility(equalWeights, covMatrix);

  if (portVol <= 0) return normalizeWeights(equalWeights, config);

  // Scale factor to hit target volatility
  const scaleFactor = config.targetVolatility / portVol;

  // Scale all weights (can't exceed total allocation = 1 - minCashReserve)
  const maxTotalAlloc = 1 - config.minCashReserve;
  const actualScale = Math.min(scaleFactor, maxTotalAlloc * n);

  const scaledWeights = equalWeights.map((w) => w * actualScale);

  return normalizeWeights(scaledWeights, config);
}

/**
 * Maximum Diversification — maximize ratio of weighted avg vol to portfolio vol.
 * Uses inverse-correlation weighting as approximation.
 */
function maxDiversificationOptimize(
  series: ReturnSeries[],
  covMatrix: CovarianceMatrix,
  config: RebalanceConfig,
): number[] {
  const n = series.length;
  if (n === 0) return [];

  // Calculate average correlation of each asset with all others
  const avgCorrelations = series.map((_, i) => {
    let totalCorr = 0;
    let count = 0;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const vol_i = Math.sqrt(Math.max(0, covMatrix.data[i][i]));
      const vol_j = Math.sqrt(Math.max(0, covMatrix.data[j][j]));
      if (vol_i > 0 && vol_j > 0) {
        totalCorr += covMatrix.data[i][j] / (vol_i * vol_j);
        count++;
      }
    }
    return count > 0 ? totalCorr / count : 0;
  });

  // Weight inversely proportional to average correlation (low corr = more weight)
  const weights = avgCorrelations.map((corr) => {
    const invCorr = 1 - Math.max(0, corr);
    return invCorr;
  });

  return normalizeWeights(weights, config);
}

/**
 * Equal Weight — simplest approach, just 1/N allocation.
 */
function equalWeightOptimize(
  series: ReturnSeries[],
  _covMatrix: CovarianceMatrix,
  config: RebalanceConfig,
): number[] {
  const n = series.length;
  if (n === 0) return [];
  return normalizeWeights(Array(n).fill(1), config);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize weights to sum to (1 - minCashReserve) with max position constraints.
 */
function normalizeWeights(
  rawWeights: number[],
  config: RebalanceConfig,
): number[] {
  const maxTotalAlloc = 1 - config.minCashReserve;
  const total = rawWeights.reduce((s, w) => s + w, 0);

  if (total <= 0) {
    // Can't allocate anything — return zeros
    return rawWeights.map(() => 0);
  }

  // Normalize to sum to maxTotalAlloc
  let weights = rawWeights.map((w) => (w / total) * maxTotalAlloc);

  // Clip to max single allocation
  let clipped = false;
  weights = weights.map((w) => {
    if (w > config.maxSingleAllocation) {
      clipped = true;
      return config.maxSingleAllocation;
    }
    return w;
  });

  // If we clipped, redistribute excess
  if (clipped) {
    const currentTotal = weights.reduce((s, w) => s + w, 0);
    if (currentTotal > maxTotalAlloc) {
      // Scale down non-capped weights
      const scale = maxTotalAlloc / currentTotal;
      weights = weights.map((w) => w * scale);
    }
  }

  return weights;
}

function calculatePortfolioVolatility(
  weights: number[],
  covMatrix: CovarianceMatrix,
): number {
  let variance = 0;
  for (let i = 0; i < weights.length; i++) {
    for (let j = 0; j < weights.length; j++) {
      variance += weights[i] * weights[j] * covMatrix.data[i][j];
    }
  }
  return Math.sqrt(Math.max(0, variance));
}

/**
 * Herfindahl-Hirschman Index for concentration.
 * Lower = more diversified. Range: 1/N (perfect) to 1 (single position).
 */
function calculateHHI(weights: number[]): number {
  const active = weights.filter((w) => w > 0);
  if (active.length === 0) return 0;
  return active.reduce((s, w) => s + w * w, 0);
}

/**
 * Get base volatility for a symbol (used for synthetic return generation).
 */
function getSymbolBaseVolatility(symbol: string): number {
  const highVol = ["TSLAx", "COINx", "MSTRx", "HOODx", "GMEx", "PLTRx"];
  const medVol = ["NVDAx", "METAx", "AMZNx", "NFLXx", "CRMx"];
  const lowVol = ["AAPLx", "MSFTx", "GOOGLx", "SPYx", "QQQx", "JPMx", "LLYx", "AVGOx"];

  if (highVol.includes(symbol)) return STOCK_VOLATILITY_HIGH;
  if (medVol.includes(symbol)) return STOCK_VOLATILITY_MEDIUM;
  if (lowVol.includes(symbol)) return STOCK_VOLATILITY_LOW;
  return STOCK_VOLATILITY_DEFAULT;
}

// ---------------------------------------------------------------------------
// Strategy Dispatcher
// ---------------------------------------------------------------------------

const STRATEGY_MAP: Record<
  RebalanceStrategy,
  (
    series: ReturnSeries[],
    covMatrix: CovarianceMatrix,
    config: RebalanceConfig,
  ) => number[]
> = {
  "mean-variance": meanVarianceOptimize,
  "risk-parity": riskParityOptimize,
  kelly: kellyOptimize,
  "volatility-target": volatilityTargetOptimize,
  "max-diversification": maxDiversificationOptimize,
  "equal-weight": equalWeightOptimize,
};

// ---------------------------------------------------------------------------
// Main Rebalance Function
// ---------------------------------------------------------------------------

/**
 * Generate a rebalance proposal for an agent.
 *
 * Analyzes current positions, runs the chosen optimization strategy, and
 * produces a list of trades to reach the target allocation.
 */
export async function generateRebalanceProposal(
  agentId: string,
  config: RebalanceConfig,
  currentPortfolio: {
    cashBalance: number;
    positions: Array<{
      symbol: string;
      quantity: number;
      currentPrice: number;
    }>;
  },
): Promise<RebalanceProposal> {
  const now = nowISO();

  // Calculate total portfolio value
  const positionsValue = currentPortfolio.positions.reduce(
    (sum, p) => sum + p.quantity * p.currentPrice,
    0,
  );
  const totalValue = currentPortfolio.cashBalance + positionsValue;

  if (totalValue <= 0) {
    return {
      agentId,
      strategy: config.strategy,
      totalValue: 0,
      cashBalance: currentPortfolio.cashBalance,
      adjustments: [],
      metrics: {
        currentSharpe: 0,
        expectedSharpe: 0,
        currentVolatility: 0,
        expectedVolatility: 0,
        concentrationIndex: 0,
        tradesRequired: 0,
        estimatedCost: 0,
        netBenefit: 0,
      },
      recommended: false,
      reason: "Portfolio has zero value — nothing to rebalance",
      timestamp: now,
    };
  }

  // Current weights
  const currentWeights: Record<string, number> = {};
  for (const pos of currentPortfolio.positions) {
    currentWeights[pos.symbol] =
      (pos.quantity * pos.currentPrice) / totalValue;
  }

  // Get symbols to consider (current holdings + top catalog stocks)
  const heldSymbols = currentPortfolio.positions.map((p) => p.symbol);
  const allSymbols = [
    ...new Set([
      ...heldSymbols,
      ...XSTOCKS_CATALOG.slice(0, config.maxPositions).map((s) => s.symbol),
    ]),
  ].slice(0, config.maxPositions);

  // Build return series and covariance matrix
  const series = await getReturnSeries(agentId, allSymbols, config.lookbackDays);
  const covMatrix = buildCovarianceMatrix(series);

  // Run optimization
  const optimizeFn = STRATEGY_MAP[config.strategy];
  const targetWeights = optimizeFn(series, covMatrix, config);

  // Calculate current portfolio metrics
  const currentWeightArray = allSymbols.map((s) => currentWeights[s] || 0);
  const currentVol = calculatePortfolioVolatility(currentWeightArray, covMatrix);
  const targetVol = calculatePortfolioVolatility(targetWeights, covMatrix);

  // Sharpe ratio estimates
  const currentReturn = allSymbols.reduce(
    (sum, sym, i) => sum + (currentWeights[sym] || 0) * series[i].meanReturn,
    0,
  );
  const targetReturn = allSymbols.reduce(
    (sum, _sym, i) => sum + targetWeights[i] * series[i].meanReturn,
    0,
  );
  const currentSharpe =
    currentVol > 0
      ? (currentReturn - config.riskFreeRate) / currentVol
      : 0;
  const expectedSharpe =
    targetVol > 0
      ? (targetReturn - config.riskFreeRate) / targetVol
      : 0;

  // Build adjustments
  const adjustments: PortfolioWeight[] = [];
  let tradesRequired = 0;

  for (let i = 0; i < allSymbols.length; i++) {
    const symbol = allSymbols[i];
    const current = currentWeights[symbol] || 0;
    const target = targetWeights[i];
    const delta = target - current;
    const tradeAmount = Math.abs(delta) * totalValue;

    // Only suggest trades above the threshold
    const isSignificant = Math.abs(delta) >= config.rebalanceThreshold;

    let action: "buy" | "sell" | "hold" = "hold";
    if (isSignificant && delta > 0) {
      action = "buy";
      tradesRequired++;
    } else if (isSignificant && delta < 0) {
      action = "sell";
      tradesRequired++;
    }

    adjustments.push({
      symbol,
      currentWeight: round2(current * 100),
      targetWeight: round2(target * 100),
      delta: round2(delta * 100),
      tradeAmountUsd: round2(tradeAmount),
      action,
    });
  }

  // Sort by absolute delta (biggest adjustments first)
  adjustments.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  // Estimated transaction costs (0.3% per trade via Jupiter)
  const estimatedCost =
    adjustments
      .filter((a) => a.action !== "hold")
      .reduce((sum, a) => sum + a.tradeAmountUsd, 0) * TRANSACTION_COST_RATE;

  const concentrationIndex = calculateHHI(
    allSymbols.map((s) => currentWeights[s] || 0),
  );

  const sharpeImprovement = expectedSharpe - currentSharpe;
  const netBenefit = sharpeImprovement * totalValue * SHARPE_IMPROVEMENT_MULTIPLIER - estimatedCost;

  // Recommendation logic
  const shouldRebalance =
    tradesRequired > 0 &&
    netBenefit > 0 &&
    (sharpeImprovement > SHARPE_IMPROVEMENT_THRESHOLD || concentrationIndex > CONCENTRATION_RISK_THRESHOLD);

  let reason: string;
  if (tradesRequired === 0) {
    reason = "Portfolio is within target allocation thresholds";
  } else if (netBenefit <= 0) {
    reason = `Transaction costs ($${estimatedCost.toFixed(2)}) exceed expected benefit`;
  } else if (sharpeImprovement <= SHARPE_IMPROVEMENT_THRESHOLD && concentrationIndex <= CONCENTRATION_RISK_THRESHOLD) {
    reason = "Current allocation is already near-optimal";
  } else {
    const reasons: string[] = [];
    if (sharpeImprovement > SHARPE_IMPROVEMENT_THRESHOLD) {
      reasons.push(`Sharpe improvement: ${currentSharpe.toFixed(2)} → ${expectedSharpe.toFixed(2)}`);
    }
    if (concentrationIndex > CONCENTRATION_RISK_THRESHOLD) {
      reasons.push(`High concentration (HHI=${concentrationIndex.toFixed(3)}) — diversification needed`);
    }
    reason = reasons.join("; ");
  }

  return {
    agentId,
    strategy: config.strategy,
    totalValue: round2(totalValue),
    cashBalance: round2(currentPortfolio.cashBalance),
    adjustments,
    metrics: {
      currentSharpe: round2(currentSharpe),
      expectedSharpe: round2(expectedSharpe),
      currentVolatility: round2(currentVol * 100),
      expectedVolatility: round2(targetVol * 100),
      concentrationIndex: round3(concentrationIndex),
      tradesRequired,
      estimatedCost: round2(estimatedCost),
      netBenefit: round2(netBenefit),
    },
    recommended: shouldRebalance,
    reason,
    timestamp: now,
  };
}

// ---------------------------------------------------------------------------
// Compare Strategies
// ---------------------------------------------------------------------------

/**
 * Run all rebalancing strategies and compare their proposals.
 * Helps determine which strategy works best for an agent's current situation.
 */
export async function compareStrategies(
  agentId: string,
  baseConfig: RebalanceConfig,
  currentPortfolio: {
    cashBalance: number;
    positions: Array<{
      symbol: string;
      quantity: number;
      currentPrice: number;
    }>;
  },
): Promise<{
  proposals: Record<RebalanceStrategy, RebalanceProposal>;
  bestStrategy: RebalanceStrategy;
  comparison: Array<{
    strategy: RebalanceStrategy;
    sharpe: number;
    volatility: number;
    trades: number;
    cost: number;
    netBenefit: number;
  }>;
}> {
  const strategies: RebalanceStrategy[] = [
    "mean-variance",
    "risk-parity",
    "kelly",
    "volatility-target",
    "max-diversification",
    "equal-weight",
  ];

  const proposals = {} as Record<RebalanceStrategy, RebalanceProposal>;

  for (const strategy of strategies) {
    const config = { ...baseConfig, strategy };
    proposals[strategy] = await generateRebalanceProposal(
      agentId,
      config,
      currentPortfolio,
    );
  }

  const comparison = strategies.map((strategy) => ({
    strategy,
    sharpe: proposals[strategy].metrics.expectedSharpe,
    volatility: proposals[strategy].metrics.expectedVolatility,
    trades: proposals[strategy].metrics.tradesRequired,
    cost: proposals[strategy].metrics.estimatedCost,
    netBenefit: proposals[strategy].metrics.netBenefit,
  }));

  // Best = highest expected Sharpe with positive net benefit
  const viable = comparison.filter((c) => c.netBenefit > 0);
  const bestStrategy =
    viable.length > 0
      ? viable.sort((a, b) => b.sharpe - a.sharpe)[0].strategy
      : baseConfig.strategy;

  return { proposals, bestStrategy, comparison };
}

// ---------------------------------------------------------------------------
// Rebalance History Tracking
// ---------------------------------------------------------------------------

interface RebalanceRecord {
  proposal: RebalanceProposal;
  executed: boolean;
  executedAt: string | null;
  actualAdjustments: PortfolioWeight[];
  postRebalanceValue: number | null;
}

const rebalanceHistory: RebalanceRecord[] = [];

/**
 * Record a rebalance execution.
 */
export function recordRebalanceExecution(
  proposal: RebalanceProposal,
  actualAdjustments: PortfolioWeight[],
  postRebalanceValue: number,
): void {
  rebalanceHistory.push({
    proposal,
    executed: true,
    executedAt: nowISO(),
    actualAdjustments,
    postRebalanceValue,
  });
}

/**
 * Get rebalance history for an agent.
 */
export function getRebalanceHistory(
  agentId: string,
  limit: number = QUERY_LIMIT_DEFAULT,
): RebalanceRecord[] {
  return rebalanceHistory
    .filter((r) => r.proposal.agentId === agentId)
    .slice(-limit);
}

/**
 * Get portfolio rebalancer status and statistics.
 */
export function getRebalancerStatus(): {
  totalProposals: number;
  executedCount: number;
  avgSharpeImprovement: number;
  strategiesUsed: Record<RebalanceStrategy, number>;
  recentHistory: RebalanceRecord[];
} {
  const executed = rebalanceHistory.filter((r) => r.executed);

  const strategyCounts: Record<RebalanceStrategy, number> = {
    "mean-variance": 0,
    "risk-parity": 0,
    kelly: 0,
    "volatility-target": 0,
    "max-diversification": 0,
    "equal-weight": 0,
  };

  let totalSharpeImprovement = 0;

  for (const record of rebalanceHistory) {
    strategyCounts[record.proposal.strategy]++;
    totalSharpeImprovement +=
      record.proposal.metrics.expectedSharpe -
      record.proposal.metrics.currentSharpe;
  }

  return {
    totalProposals: rebalanceHistory.length,
    executedCount: executed.length,
    avgSharpeImprovement:
      rebalanceHistory.length > 0
        ? round2(totalSharpeImprovement / rebalanceHistory.length)
        : 0,
    strategiesUsed: strategyCounts,
    recentHistory: rebalanceHistory.slice(-10),
  };
}
