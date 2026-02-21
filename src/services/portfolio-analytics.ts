/**
 * Portfolio Analytics Engine
 *
 * Comprehensive financial analytics for AI agent portfolios. Calculates
 * institutional-grade metrics that let users evaluate agent performance
 * beyond simple P&L.
 *
 * Metrics:
 * - Sharpe Ratio (risk-adjusted returns)
 * - Maximum Drawdown (worst peak-to-trough loss)
 * - Win Rate (percentage of profitable trades)
 * - Sortino Ratio (downside risk only)
 * - Calmar Ratio (return / max drawdown)
 * - Profit Factor (gross profit / gross loss)
 * - Average Win/Loss ratio
 * - Holding period analysis
 * - Streak tracking (consecutive wins/losses)
 * - Rolling performance (7d, 30d, 90d)
 */

import { db } from "../db/index.ts";
import { trades } from "../db/schema/trades.ts";
import { positions } from "../db/schema/positions.ts";
import { eq, asc, and, gte, InferSelectModel } from "drizzle-orm";
import { sumByKey, countByCondition, findMax, findMin, computeVariance, computeDownsideVariance } from "../lib/math-utils.ts";

// Infer types from database schema
type Trade = InferSelectModel<typeof trades>;
type Position = InferSelectModel<typeof positions>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TradeRecord {
  id: number;
  agentId: string;
  side: string;
  symbol: string;
  quantity: number;
  usdcAmount: number;
  pricePerToken: number;
  createdAt: Date;
  txSignature: string;
}

export interface PortfolioMetrics {
  agentId: string;
  calculatedAt: string;

  // P&L
  totalPnl: number;
  totalPnlPercent: number;
  realizedPnl: number;
  unrealizedPnl: number;

  // Return metrics
  totalReturn: number;
  annualizedReturn: number;

  // Risk metrics
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  calmarRatio: number | null;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  volatility: number;
  downsideDeviation: number;

  // Trade metrics
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  profitFactor: number | null;
  averageWin: number;
  averageLoss: number;
  avgWinLossRatio: number | null;
  largestWin: number;
  largestLoss: number;
  expectancy: number;

  // Streak metrics
  currentStreak: number;
  currentStreakType: "win" | "loss" | "none";
  longestWinStreak: number;
  longestLossStreak: number;

  // Holding metrics
  avgHoldingPeriodHours: number | null;
  shortestHoldHours: number | null;
  longestHoldHours: number | null;

  // Volume
  totalVolumeUsdc: number;
  avgTradeSize: number;

  // Activity
  firstTradeAt: string | null;
  lastTradeAt: string | null;
  activeTradingDays: number;
  tradesPerDay: number;
}

export interface RollingPerformance {
  period: "7d" | "30d" | "90d" | "all";
  pnl: number;
  pnlPercent: number;
  trades: number;
  winRate: number;
  sharpeRatio: number | null;
}

export interface AgentComparison {
  agents: Array<{
    agentId: string;
    metrics: PortfolioMetrics;
    rank: number;
  }>;
  bestSharpe: string | null;
  bestWinRate: string | null;
  bestPnl: string | null;
  lowestDrawdown: string | null;
}

export interface EquityCurvePoint {
  timestamp: string;
  portfolioValue: number;
  cashBalance: number;
  positionValue: number;
  cumulativePnl: number;
  drawdownPercent: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INITIAL_CAPITAL = 10_000;
// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Annual risk-free rate for Sharpe/Sortino calculations.
 * Based on U.S. Treasury bills (5% standard assumption).
 */
const RISK_FREE_RATE = 0.05;

/**
 * Trading days per year for annualization calculations.
 * Standard assumption: 252 trading days (365 days - weekends - holidays).
 */
const TRADING_DAYS_PER_YEAR = 252;

/**
 * Minimum daily returns required for ratio calculations.
 * Need at least 2 data points to compute meaningful variance/volatility.
 *
 * Used in: Sharpe, Sortino, volatility, downside deviation calculations.
 */
const MIN_RETURNS_FOR_RATIO_CALCULATION = 2;

/**
 * Zero volatility threshold for ratio validity checks.
 * If standard deviation is exactly 0, ratios are undefined (division by zero).
 *
 * Used in: Sharpe ratio, Sortino ratio denominator checks.
 */
const ZERO_VOLATILITY_THRESHOLD = 0;

/**
 * Minimum Tradeable Quantity Threshold
 *
 * Quantities below this threshold are considered negligible and treated as zero.
 * Used in FIFO matching to clean up rounding errors and prevent dust positions.
 *
 * Value: 0.000001 (1 millionth of a token)
 * Rationale: Prevents accumulation of rounding errors in position tracking while
 * allowing precise quantity matching for typical trade sizes (0.01-1000 tokens).
 */
const MIN_TRADEABLE_QUANTITY = 0.000001;

/**
 * Time Conversion Constants
 *
 * Milliseconds per day: Used for time window calculations (rolling performance, annualized returns)
 * Milliseconds per hour: Used for holding period conversions (trade duration analysis)
 *
 * Values:
 * - MS_PER_DAY = 86,400,000 ms (1000 * 60 * 60 * 24)
 * - MS_PER_HOUR = 3,600,000 ms (1000 * 60 * 60)
 */
const MS_PER_DAY = 1000 * 60 * 60 * 24;
const MS_PER_HOUR = 1000 * 60 * 60;

/**
 * Rolling Performance Window Sizes (in days)
 *
 * Standard time windows for rolling performance analysis. These periods enable
 * comparison of short-term momentum (7d), medium-term trends (30d), and
 * long-term performance (90d).
 *
 * Values:
 * - ROLLING_WINDOW_7D = 7 days (1 week — captures recent momentum)
 * - ROLLING_WINDOW_30D = 30 days (1 month — medium-term trend)
 * - ROLLING_WINDOW_90D = 90 days (1 quarter — long-term performance)
 *
 * These windows match industry standards and enable consistent performance
 * comparison across agents and benchmark versions.
 */
const ROLLING_WINDOW_7D = 7;
const ROLLING_WINDOW_30D = 30;
const ROLLING_WINDOW_90D = 90;

/**
 * Percentage Conversion Multiplier
 *
 * Converts decimal ratios (0.15) to percentage values (15%).
 * Used consistently for:
 * - P&L percentages (totalPnlPercent)
 * - Win rates (winRate)
 * - Drawdown percentages (maxDrawdownPercent)
 * - Return percentages (totalReturn)
 *
 * Value: 100
 */
const PERCENT_MULTIPLIER = 100;

/**
 * Annualization Parameters
 *
 * Used to convert historical returns (over N days) to annualized returns.
 * Formula: annualizedReturn = (1 + totalReturn)^(DAYS_PER_YEAR / actualDays) - 1
 *
 * Value: DAYS_PER_YEAR = 365 (calendar days for compounding calculation)
 *
 * Note: Different from TRADING_DAYS_PER_YEAR (252), which is used for volatility
 * annualization where only market-open days matter. Compounding returns over
 * calendar time uses 365 days.
 */
const DAYS_PER_YEAR = 365;

// ---------------------------------------------------------------------------
// Core Analytics
// ---------------------------------------------------------------------------

/**
 * Calculate comprehensive portfolio metrics for an agent.
 */
export async function calculatePortfolioMetrics(
  agentId: string,
): Promise<PortfolioMetrics> {
  const now = new Date();

  // Fetch all trades for this agent
  const allTrades = await db
    .select()
    .from(trades)
    .where(eq(trades.agentId, agentId))
    .orderBy(asc(trades.createdAt));

  // Fetch current positions for unrealized P&L
  const currentPositions = await db
    .select()
    .from(positions)
    .where(eq(positions.agentId, agentId));

  // Build trade records
  const tradeRecords: TradeRecord[] = allTrades.map((t: Trade) => ({
    id: t.id,
    agentId: t.agentId,
    side: t.side,
    symbol: t.stockSymbol,
    quantity: parseFloat(t.stockQuantity),
    usdcAmount: parseFloat(t.usdcAmount),
    pricePerToken: parseFloat(t.pricePerToken),
    createdAt: t.createdAt,
    txSignature: t.txSignature,
  }));

  // Calculate realized P&L from closed positions
  const { realizedPnl, tradeOutcomes } = calculateRealizedPnl(tradeRecords);

  // Calculate unrealized P&L from open positions
  const unrealizedPnl = currentPositions.reduce((sum: number, _pos: Position) => {
    // We don't have current prices here, so unrealized is estimated at 0
    // unless position has a cost basis (meaning it was bought)
    return sum + 0; // Will be enriched by caller with market prices
  }, 0);

  const totalPnl = realizedPnl + unrealizedPnl;
  const totalPnlPercent =
    INITIAL_CAPITAL > 0 ? (totalPnl / INITIAL_CAPITAL) * PERCENT_MULTIPLIER : 0;

  // Calculate return series for risk metrics
  const dailyReturns = calculateDailyReturns(tradeRecords, INITIAL_CAPITAL);

  // Sharpe Ratio
  const sharpeRatio = calculateSharpeRatio(dailyReturns);

  // Sortino Ratio (downside deviation only)
  const sortinoRatio = calculateSortinoRatio(dailyReturns);

  // Volatility
  const volatility = calculateVolatility(dailyReturns);
  const downsideDeviation = calculateDownsideDeviation(dailyReturns);

  // Max Drawdown
  const equityCurve = buildEquityCurve(tradeRecords, INITIAL_CAPITAL);
  const { maxDrawdown, maxDrawdownPercent } = calculateMaxDrawdown(equityCurve);

  // Calmar Ratio
  const totalReturn =
    INITIAL_CAPITAL > 0 ? totalPnl / INITIAL_CAPITAL : 0;
  const calmarRatio =
    maxDrawdownPercent > 0 ? totalReturn / (maxDrawdownPercent / PERCENT_MULTIPLIER) : null;

  // Trade statistics
  const winningTrades = tradeOutcomes.filter((t) => t.pnl > 0);
  const losingTrades = tradeOutcomes.filter((t) => t.pnl < 0);
  const winRate =
    tradeOutcomes.length > 0
      ? (winningTrades.length / tradeOutcomes.length) * PERCENT_MULTIPLIER
      : 0;

  const grossProfit = sumByKey(winningTrades, 'pnl');
  const grossLoss = Math.abs(sumByKey(losingTrades, 'pnl'));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : null;

  const averageWin =
    winningTrades.length > 0
      ? grossProfit / winningTrades.length
      : 0;
  const averageLoss =
    losingTrades.length > 0
      ? grossLoss / losingTrades.length
      : 0;
  const avgWinLossRatio = averageLoss > 0 ? averageWin / averageLoss : null;

  const largestWin = Math.max(0, findMax(tradeOutcomes, 'pnl')?.pnl ?? 0);
  const largestLoss = Math.min(0, findMin(tradeOutcomes, 'pnl')?.pnl ?? 0);

  // Expectancy: (winRate * avgWin) - (lossRate * avgLoss)
  const lossRate = tradeOutcomes.length > 0
    ? losingTrades.length / tradeOutcomes.length
    : 0;
  const expectancy =
    (winRate / PERCENT_MULTIPLIER) * averageWin - lossRate * averageLoss;

  // Streaks
  const { currentStreak, currentStreakType, longestWin, longestLoss } =
    calculateStreaks(tradeOutcomes);

  // Holding periods
  const holdingPeriods = calculateHoldingPeriods(tradeRecords);

  // Volume
  const totalVolumeUsdc = sumByKey(tradeRecords, 'usdcAmount');
  const avgTradeSize =
    tradeRecords.length > 0 ? totalVolumeUsdc / tradeRecords.length : 0;

  // Activity
  const firstTradeAt =
    tradeRecords.length > 0
      ? tradeRecords[0].createdAt.toISOString()
      : null;
  const lastTradeAt =
    tradeRecords.length > 0
      ? tradeRecords[tradeRecords.length - 1].createdAt.toISOString()
      : null;

  const tradeDays = new Set(
    tradeRecords.map((t) => t.createdAt.toISOString().split("T")[0]),
  );
  const activeTradingDays = tradeDays.size;

  const daysSinceFirst =
    firstTradeAt
      ? (now.getTime() - new Date(firstTradeAt).getTime()) / MS_PER_DAY
      : 1;
  const tradesPerDay =
    daysSinceFirst > 0 ? tradeRecords.length / daysSinceFirst : 0;

  // Annualized return
  const annualizedReturn =
    daysSinceFirst > 0
      ? Math.pow(1 + totalReturn, DAYS_PER_YEAR / Math.max(1, daysSinceFirst)) - 1
      : 0;

  return {
    agentId,
    calculatedAt: now.toISOString(),
    totalPnl,
    totalPnlPercent,
    realizedPnl,
    unrealizedPnl,
    totalReturn,
    annualizedReturn,
    sharpeRatio,
    sortinoRatio,
    calmarRatio,
    maxDrawdown,
    maxDrawdownPercent,
    volatility,
    downsideDeviation,
    totalTrades: tradeRecords.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    winRate,
    profitFactor,
    averageWin,
    averageLoss,
    avgWinLossRatio,
    largestWin,
    largestLoss,
    expectancy,
    currentStreak,
    currentStreakType,
    longestWinStreak: longestWin,
    longestLossStreak: longestLoss,
    avgHoldingPeriodHours: holdingPeriods.avgHours,
    shortestHoldHours: holdingPeriods.shortestHours,
    longestHoldHours: holdingPeriods.longestHours,
    totalVolumeUsdc,
    avgTradeSize,
    firstTradeAt,
    lastTradeAt,
    activeTradingDays,
    tradesPerDay,
  };
}

// ---------------------------------------------------------------------------
// Realized P&L Calculation
// ---------------------------------------------------------------------------

interface TradeOutcome {
  symbol: string;
  pnl: number;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  holdingPeriodMs: number;
}

/**
 * Calculate realized P&L using FIFO matching of buys to sells.
 */
function calculateRealizedPnl(tradeRecords: TradeRecord[]): {
  realizedPnl: number;
  tradeOutcomes: TradeOutcome[];
} {
  // Build buy queues per symbol (FIFO)
  const buyQueues = new Map<
    string,
    Array<{ quantity: number; price: number; date: Date }>
  >();
  const outcomes: TradeOutcome[] = [];
  let totalRealizedPnl = 0;

  for (const trade of tradeRecords) {
    if (trade.side === "buy") {
      const queue = buyQueues.get(trade.symbol) ?? [];
      queue.push({
        quantity: trade.quantity,
        price: trade.pricePerToken,
        date: trade.createdAt,
      });
      buyQueues.set(trade.symbol, queue);
    } else if (trade.side === "sell") {
      const queue = buyQueues.get(trade.symbol) ?? [];
      let remainingToSell = trade.quantity;

      while (remainingToSell > 0 && queue.length > 0) {
        const oldestBuy = queue[0];
        const matchedQty = Math.min(remainingToSell, oldestBuy.quantity);

        const pnl = matchedQty * (trade.pricePerToken - oldestBuy.price);
        totalRealizedPnl += pnl;

        outcomes.push({
          symbol: trade.symbol,
          pnl,
          entryPrice: oldestBuy.price,
          exitPrice: trade.pricePerToken,
          quantity: matchedQty,
          holdingPeriodMs:
            trade.createdAt.getTime() - oldestBuy.date.getTime(),
        });

        oldestBuy.quantity -= matchedQty;
        remainingToSell -= matchedQty;

        if (oldestBuy.quantity <= MIN_TRADEABLE_QUANTITY) {
          queue.shift();
        }
      }
    }
  }

  return { realizedPnl: totalRealizedPnl, tradeOutcomes: outcomes };
}

// ---------------------------------------------------------------------------
// Return Series & Risk Metrics
// ---------------------------------------------------------------------------

/**
 * Build daily return series from trade history.
 */
function calculateDailyReturns(
  tradeRecords: TradeRecord[],
  initialCapital: number,
): number[] {
  if (tradeRecords.length === 0) return [];

  // Group trades by day
  const tradesByDay = new Map<string, TradeRecord[]>();
  for (const t of tradeRecords) {
    const day = t.createdAt.toISOString().split("T")[0];
    const dayTrades = tradesByDay.get(day) ?? [];
    dayTrades.push(t);
    tradesByDay.set(day, dayTrades);
  }

  // Calculate daily P&L
  const dailyReturns: number[] = [];
  let runningCapital = initialCapital;

  for (const [, dayTrades] of tradesByDay) {
    let dayPnl = 0;
    for (const t of dayTrades) {
      if (t.side === "sell") {
        dayPnl += t.usdcAmount;
      } else {
        dayPnl -= t.usdcAmount;
      }
    }

    const dayReturn = runningCapital > 0 ? dayPnl / runningCapital : 0;
    dailyReturns.push(dayReturn);
    runningCapital += dayPnl;
  }

  return dailyReturns;
}

/**
 * Calculate annualized Sharpe Ratio.
 */
function calculateSharpeRatio(dailyReturns: number[]): number | null {
  if (dailyReturns.length < MIN_RETURNS_FOR_RATIO_CALCULATION) return null;

  const dailyRfRate = RISK_FREE_RATE / TRADING_DAYS_PER_YEAR;
  const excessReturns = dailyReturns.map((r) => r - dailyRfRate);

  const mean = excessReturns.reduce((s, r) => s + r, 0) / excessReturns.length;
  const variance = computeVariance(excessReturns);
  const stdDev = Math.sqrt(variance);

  if (stdDev === ZERO_VOLATILITY_THRESHOLD) return null;

  return (mean / stdDev) * Math.sqrt(TRADING_DAYS_PER_YEAR);
}

/**
 * Calculate Sortino Ratio (penalizes downside volatility only).
 */
function calculateSortinoRatio(dailyReturns: number[]): number | null {
  if (dailyReturns.length < MIN_RETURNS_FOR_RATIO_CALCULATION) return null;

  const dailyRfRate = RISK_FREE_RATE / TRADING_DAYS_PER_YEAR;
  const excessReturns = dailyReturns.map((r) => r - dailyRfRate);

  const mean = excessReturns.reduce((s, r) => s + r, 0) / excessReturns.length;

  // Only count negative deviations
  const downsideVariance = computeDownsideVariance(excessReturns, true);
  if (downsideVariance === ZERO_VOLATILITY_THRESHOLD) return null;

  const downsideDev = Math.sqrt(downsideVariance);

  if (downsideDev === ZERO_VOLATILITY_THRESHOLD) return null;

  return (mean / downsideDev) * Math.sqrt(TRADING_DAYS_PER_YEAR);
}

/**
 * Calculate annualized volatility.
 */
function calculateVolatility(dailyReturns: number[]): number {
  if (dailyReturns.length < 2) return 0;

  const variance = computeVariance(dailyReturns);

  return Math.sqrt(variance * TRADING_DAYS_PER_YEAR);
}

/**
 * Calculate downside deviation.
 */
function calculateDownsideDeviation(dailyReturns: number[]): number {
  if (dailyReturns.length < 2) return 0;

  const downsideVariance = computeDownsideVariance(dailyReturns, true);
  if (downsideVariance === 0) return 0;

  return Math.sqrt(downsideVariance * TRADING_DAYS_PER_YEAR);
}

// ---------------------------------------------------------------------------
// Equity Curve & Drawdown
// ---------------------------------------------------------------------------

/**
 * Build equity curve from trade history.
 */
function buildEquityCurve(
  tradeRecords: TradeRecord[],
  initialCapital: number,
): number[] {
  if (tradeRecords.length === 0) return [initialCapital];

  const curve: number[] = [initialCapital];
  let equity = initialCapital;

  for (const trade of tradeRecords) {
    if (trade.side === "buy") {
      // Cash decreases
      equity -= trade.usdcAmount;
    } else {
      // Cash increases
      equity += trade.usdcAmount;
    }
    curve.push(equity);
  }

  return curve;
}

/**
 * Calculate maximum drawdown from equity curve.
 */
function calculateMaxDrawdown(equityCurve: number[]): {
  maxDrawdown: number;
  maxDrawdownPercent: number;
} {
  if (equityCurve.length < 2) {
    return { maxDrawdown: 0, maxDrawdownPercent: 0 };
  }

  let peak = equityCurve[0];
  let maxDd = 0;
  let maxDdPercent = 0;

  for (const value of equityCurve) {
    if (value > peak) {
      peak = value;
    }
    const dd = peak - value;
    const ddPercent = peak > 0 ? (dd / peak) * PERCENT_MULTIPLIER : 0;

    if (dd > maxDd) {
      maxDd = dd;
      maxDdPercent = ddPercent;
    }
  }

  return { maxDrawdown: maxDd, maxDrawdownPercent: maxDdPercent };
}

// ---------------------------------------------------------------------------
// Streak Analysis
// ---------------------------------------------------------------------------

function calculateStreaks(outcomes: TradeOutcome[]): {
  currentStreak: number;
  currentStreakType: "win" | "loss" | "none";
  longestWin: number;
  longestLoss: number;
} {
  if (outcomes.length === 0) {
    return {
      currentStreak: 0,
      currentStreakType: "none",
      longestWin: 0,
      longestLoss: 0,
    };
  }

  let currentStreak = 0;
  let currentType: "win" | "loss" | "none" = "none";
  let longestWin = 0;
  let longestLoss = 0;
  let winStreak = 0;
  let lossStreak = 0;

  for (const outcome of outcomes) {
    if (outcome.pnl > 0) {
      winStreak++;
      lossStreak = 0;
      longestWin = Math.max(longestWin, winStreak);
    } else if (outcome.pnl < 0) {
      lossStreak++;
      winStreak = 0;
      longestLoss = Math.max(longestLoss, lossStreak);
    }
  }

  // Current streak from last trade
  const lastOutcome = outcomes[outcomes.length - 1];
  if (lastOutcome.pnl > 0) {
    currentType = "win";
    currentStreak = winStreak;
  } else if (lastOutcome.pnl < 0) {
    currentType = "loss";
    currentStreak = lossStreak;
  }

  return { currentStreak, currentStreakType: currentType, longestWin, longestLoss };
}

// ---------------------------------------------------------------------------
// Holding Period Analysis
// ---------------------------------------------------------------------------

function calculateHoldingPeriods(tradeRecords: TradeRecord[]): {
  avgHours: number | null;
  shortestHours: number | null;
  longestHours: number | null;
} {
  // Match buys to sells per symbol
  const buyTimes = new Map<string, Date[]>();
  const holdingPeriods: number[] = [];

  for (const trade of tradeRecords) {
    if (trade.side === "buy") {
      const times = buyTimes.get(trade.symbol) ?? [];
      times.push(trade.createdAt);
      buyTimes.set(trade.symbol, times);
    } else if (trade.side === "sell") {
      const times = buyTimes.get(trade.symbol) ?? [];
      if (times.length > 0) {
        const buyTime = times.shift()!;
        const holdMs = trade.createdAt.getTime() - buyTime.getTime();
        holdingPeriods.push(holdMs / MS_PER_HOUR); // Convert to hours
      }
    }
  }

  if (holdingPeriods.length === 0) {
    return { avgHours: null, shortestHours: null, longestHours: null };
  }

  return {
    avgHours:
      holdingPeriods.reduce((s, h) => s + h, 0) / holdingPeriods.length,
    shortestHours: findMin(holdingPeriods.map(h => ({value: h})), 'value')?.value ?? 0,
    longestHours: findMax(holdingPeriods.map(h => ({value: h})), 'value')?.value ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Rolling Performance
// ---------------------------------------------------------------------------

/**
 * Calculate rolling performance for different time windows.
 */
export async function calculateRollingPerformance(
  agentId: string,
): Promise<RollingPerformance[]> {
  const periods: Array<{ label: RollingPerformance["period"]; days: number }> =
    [
      { label: "7d", days: ROLLING_WINDOW_7D },
      { label: "30d", days: ROLLING_WINDOW_30D },
      { label: "90d", days: ROLLING_WINDOW_90D },
    ];

  const results: RollingPerformance[] = [];

  for (const { label, days } of periods) {
    const since = new Date(Date.now() - days * MS_PER_DAY);

    const periodTrades = await db
      .select()
      .from(trades)
      .where(and(eq(trades.agentId, agentId), gte(trades.createdAt, since)))
      .orderBy(asc(trades.createdAt));

    const records: TradeRecord[] = periodTrades.map((t: Trade) => ({
      id: t.id,
      agentId: t.agentId,
      side: t.side,
      symbol: t.stockSymbol,
      quantity: parseFloat(t.stockQuantity),
      usdcAmount: parseFloat(t.usdcAmount),
      pricePerToken: parseFloat(t.pricePerToken),
      createdAt: t.createdAt,
      txSignature: t.txSignature,
    }));

    const { realizedPnl, tradeOutcomes } = calculateRealizedPnl(records);
    const dailyReturns = calculateDailyReturns(records, INITIAL_CAPITAL);
    const winCount = countByCondition(tradeOutcomes, (t) => t.pnl > 0);

    results.push({
      period: label,
      pnl: realizedPnl,
      pnlPercent:
        INITIAL_CAPITAL > 0
          ? (realizedPnl / INITIAL_CAPITAL) * PERCENT_MULTIPLIER
          : 0,
      trades: records.length,
      winRate:
        tradeOutcomes.length > 0
          ? (winCount / tradeOutcomes.length) * PERCENT_MULTIPLIER
          : 0,
      sharpeRatio: calculateSharpeRatio(dailyReturns),
    });
  }

  // Add all-time
  const allMetrics = await calculatePortfolioMetrics(agentId);
  results.push({
    period: "all",
    pnl: allMetrics.realizedPnl,
    pnlPercent: allMetrics.totalPnlPercent,
    trades: allMetrics.totalTrades,
    winRate: allMetrics.winRate,
    sharpeRatio: allMetrics.sharpeRatio,
  });

  return results;
}

// ---------------------------------------------------------------------------
// Agent Comparison
// ---------------------------------------------------------------------------

/**
 * Compare all 3 agents across key metrics.
 */
export async function compareAgents(): Promise<AgentComparison> {
  const agentIds = ["claude-trader", "gpt-trader", "grok-trader"];

  const metricsResults = await Promise.allSettled(
    agentIds.map((id) => calculatePortfolioMetrics(id)),
  );

  const agents = metricsResults
    .filter(
      (r): r is PromiseFulfilledResult<PortfolioMetrics> =>
        r.status === "fulfilled",
    )
    .map((r) => r.value);

  // Rank by total P&L
  const sorted = [...agents].sort((a, b) => b.totalPnl - a.totalPnl);
  const ranked = sorted.map((metrics, i) => ({
    agentId: metrics.agentId,
    metrics,
    rank: i + 1,
  }));

  // Find best in each category
  const bestSharpe =
    agents.reduce<{ id: string | null; val: number }>(
      (best, a) => {
        if (a.sharpeRatio !== null && a.sharpeRatio > best.val) {
          return { id: a.agentId, val: a.sharpeRatio };
        }
        return best;
      },
      { id: null, val: -Infinity },
    ).id;

  const bestWinRate =
    agents.reduce<{ id: string | null; val: number }>(
      (best, a) => (a.winRate > best.val ? { id: a.agentId, val: a.winRate } : best),
      { id: null, val: -Infinity },
    ).id;

  const bestPnl =
    agents.reduce<{ id: string | null; val: number }>(
      (best, a) => (a.totalPnl > best.val ? { id: a.agentId, val: a.totalPnl } : best),
      { id: null, val: -Infinity },
    ).id;

  const lowestDrawdown =
    agents.reduce<{ id: string | null; val: number }>(
      (best, a) =>
        a.maxDrawdownPercent < best.val
          ? { id: a.agentId, val: a.maxDrawdownPercent }
          : best,
      { id: null, val: Infinity },
    ).id;

  return {
    agents: ranked,
    bestSharpe,
    bestWinRate,
    bestPnl,
    lowestDrawdown,
  };
}

// ---------------------------------------------------------------------------
// Equity Curve Generation
// ---------------------------------------------------------------------------

/**
 * Generate equity curve data points for charting.
 */
export async function generateEquityCurve(
  agentId: string,
): Promise<EquityCurvePoint[]> {
  const allTrades = await db
    .select()
    .from(trades)
    .where(eq(trades.agentId, agentId))
    .orderBy(asc(trades.createdAt));

  const points: EquityCurvePoint[] = [];
  let cash = INITIAL_CAPITAL;
  let positionValue = 0;
  let peak = INITIAL_CAPITAL;

  // Initial point
  points.push({
    timestamp: allTrades[0]?.createdAt.toISOString() ?? new Date().toISOString(),
    portfolioValue: INITIAL_CAPITAL,
    cashBalance: INITIAL_CAPITAL,
    positionValue: 0,
    cumulativePnl: 0,
    drawdownPercent: 0,
  });

  // Track positions for value calculation
  const posMap = new Map<string, { qty: number; avgCost: number }>();

  for (const trade of allTrades) {
    const qty = parseFloat(trade.stockQuantity);
    const usdc = parseFloat(trade.usdcAmount);
    const price = parseFloat(trade.pricePerToken);

    if (trade.side === "buy") {
      cash -= usdc;
      const pos = posMap.get(trade.stockSymbol) ?? { qty: 0, avgCost: 0 };
      const totalCost = pos.qty * pos.avgCost + qty * price;
      pos.qty += qty;
      pos.avgCost = pos.qty > 0 ? totalCost / pos.qty : 0;
      posMap.set(trade.stockSymbol, pos);
    } else {
      cash += usdc;
      const pos = posMap.get(trade.stockSymbol);
      if (pos) {
        pos.qty -= qty;
        if (pos.qty <= MIN_TRADEABLE_QUANTITY) {
          posMap.delete(trade.stockSymbol);
        }
      }
    }

    // Estimate position value (at trade price, not perfect but good enough)
    positionValue = 0;
    for (const [, pos] of posMap) {
      positionValue += pos.qty * pos.avgCost;
    }

    const portfolioValue = cash + positionValue;
    peak = Math.max(peak, portfolioValue);
    const drawdownPercent =
      peak > 0 ? ((peak - portfolioValue) / peak) * PERCENT_MULTIPLIER : 0;

    points.push({
      timestamp: trade.createdAt.toISOString(),
      portfolioValue,
      cashBalance: cash,
      positionValue,
      cumulativePnl: portfolioValue - INITIAL_CAPITAL,
      drawdownPercent,
    });
  }

  return points;
}
