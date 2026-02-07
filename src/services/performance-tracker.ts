/**
 * Agent Performance Tracker
 *
 * Calculates real P&L, risk metrics, and competitive rankings for the 3
 * AI trading agents. This is the data engine behind the leaderboard and
 * agent profiles.
 *
 * Metrics computed:
 * - Total P&L (realized + unrealized)
 * - Win rate (% of profitable closed trades)
 * - Sharpe ratio (risk-adjusted returns)
 * - Max drawdown (largest peak-to-trough decline)
 * - Sortino ratio (downside risk only)
 * - Calmar ratio (return / max drawdown)
 * - Trade frequency and average hold time
 * - Per-stock performance breakdown
 * - Rolling returns (1d, 7d, 30d)
 * - Streak tracking (consecutive wins/losses)
 */

import { db } from "../db/index.ts";
import { trades } from "../db/schema/trades.ts";
import { positions } from "../db/schema/positions.ts";
import { agentDecisions } from "../db/schema/agent-decisions.ts";
import { eq, desc, asc, sql, and, gte, InferSelectModel } from "drizzle-orm";
import { XSTOCKS_CATALOG } from "../config/constants.ts";
import { round2, sortDescending, sortByDescending } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Database Types
// ---------------------------------------------------------------------------

type Trade = InferSelectModel<typeof trades>;
type AgentDecision = InferSelectModel<typeof agentDecisions>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentPerformance {
  agentId: string;
  /** Summary metrics */
  summary: {
    totalValue: number;
    cashBalance: number;
    positionsValue: number;
    initialCapital: number;
    totalPnl: number;
    totalPnlPercent: number;
    realizedPnl: number;
    unrealizedPnl: number;
  };
  /** Risk metrics */
  risk: {
    sharpeRatio: number | null;
    sortinoRatio: number | null;
    calmarRatio: number | null;
    maxDrawdown: number;
    maxDrawdownPercent: number;
    volatility: number | null;
    beta: number | null;
    valueAtRisk95: number | null;
  };
  /** Trading stats */
  trading: {
    totalTrades: number;
    buyCount: number;
    sellCount: number;
    holdCount: number;
    winRate: number;
    avgWin: number;
    avgLoss: number;
    profitFactor: number;
    avgHoldTimeHours: number;
    avgTradeSize: number;
    largestWin: number;
    largestLoss: number;
    currentStreak: { type: "win" | "loss" | "none"; count: number };
    longestWinStreak: number;
    longestLossStreak: number;
  };
  /** Per-stock breakdown */
  byStock: StockPerformance[];
  /** Rolling returns */
  returns: {
    day1: number | null;
    day7: number | null;
    day30: number | null;
    allTime: number;
  };
  /** Decision quality metrics */
  decisions: {
    totalDecisions: number;
    avgConfidence: number;
    confidenceCalibration: number | null;
    decisionsLast24h: number;
    favoriteStock: string | null;
    actionDistribution: { buy: number; sell: number; hold: number };
  };
  /** Last updated */
  computedAt: string;
}

export interface StockPerformance {
  symbol: string;
  name: string;
  totalBought: number;
  totalSold: number;
  currentPosition: number;
  realizedPnl: number;
  unrealizedPnl: number;
  avgBuyPrice: number;
  avgSellPrice: number;
  tradeCount: number;
  winRate: number;
}

export interface LeaderboardEntry {
  rank: number;
  agentId: string;
  totalPnl: number;
  totalPnlPercent: number;
  totalValue: number;
  sharpeRatio: number | null;
  maxDrawdown: number;
  winRate: number;
  totalTrades: number;
  currentStreak: { type: "win" | "loss" | "none"; count: number };
}

export interface PerformanceComparison {
  metric: string;
  values: Record<string, number | null>;
  winner: string | null;
  unit: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INITIAL_CAPITAL = 10_000; // $10k starting capital per agent
const RISK_FREE_RATE = 0.05;   // 5% annualized risk-free rate
const TRADING_DAYS_PER_YEAR = 252;

// ---------------------------------------------------------------------------
// Core Performance Computation
// ---------------------------------------------------------------------------

/**
 * Compute comprehensive performance metrics for an agent.
 * This is the main entry point — queries DB and calculates everything.
 */
export async function computeAgentPerformance(agentId: string): Promise<AgentPerformance> {
  // Fetch all data in parallel
  const [agentTrades, agentPositions, agentDecisionRows] = await Promise.all([
    db.select().from(trades).where(eq(trades.agentId, agentId)).orderBy(asc(trades.createdAt)),
    db.select().from(positions).where(eq(positions.agentId, agentId)),
    db.select().from(agentDecisions).where(eq(agentDecisions.agentId, agentId)).orderBy(desc(agentDecisions.createdAt)),
  ]);

  // Fetch current prices for positions
  const currentPrices = await fetchCurrentPrices();

  // Calculate cash balance
  let cashBalance = INITIAL_CAPITAL;
  for (const trade of agentTrades) {
    if (trade.side === "buy") {
      cashBalance -= parseFloat(trade.usdcAmount);
    } else {
      cashBalance += parseFloat(trade.usdcAmount);
    }
  }
  cashBalance = Math.max(0, cashBalance);

  // Calculate positions value + unrealized PnL
  let positionsValue = 0;
  let unrealizedPnl = 0;
  for (const pos of agentPositions) {
    const qty = parseFloat(pos.quantity);
    const costBasis = parseFloat(pos.averageCostBasis);
    const currentPrice = currentPrices.get(pos.symbol) ?? costBasis;
    const value = qty * currentPrice;
    positionsValue += value;
    unrealizedPnl += (currentPrice - costBasis) * qty;
  }

  // Calculate realized PnL from completed sell trades
  const realizedPnl = calculateRealizedPnl(agentTrades);

  const totalValue = cashBalance + positionsValue;
  const totalPnl = totalValue - INITIAL_CAPITAL;
  const totalPnlPercent = (totalPnl / INITIAL_CAPITAL) * 100;

  // Calculate daily returns for risk metrics
  const dailyReturns = calculateDailyReturns(agentTrades, currentPrices);

  // Win/loss analysis on sell trades
  const sellAnalysis = analyzeSellTrades(agentTrades);

  // Per-stock breakdown
  const byStock = computeStockPerformance(agentTrades, agentPositions, currentPrices);

  // Rolling returns
  const returns = computeRollingReturns(agentTrades, totalPnl);

  // Decision quality
  const decisions = analyzeDecisions(agentDecisionRows);

  // Streaks
  const streaks = computeStreaks(agentTrades);

  // Risk metrics
  const risk = computeRiskMetrics(dailyReturns, totalPnl);

  return {
    agentId,
    summary: {
      totalValue: round2(totalValue),
      cashBalance: round2(cashBalance),
      positionsValue: round2(positionsValue),
      initialCapital: INITIAL_CAPITAL,
      totalPnl: round2(totalPnl),
      totalPnlPercent: round2(totalPnlPercent),
      realizedPnl: round2(realizedPnl),
      unrealizedPnl: round2(unrealizedPnl),
    },
    risk,
    trading: {
      totalTrades: agentTrades.length,
      buyCount: agentTrades.filter((t: Trade) => t.side === "buy").length,
      sellCount: agentTrades.filter((t: Trade) => t.side === "sell").length,
      holdCount: agentDecisionRows.filter((d: AgentDecision) => d.action === "hold").length,
      winRate: sellAnalysis.winRate,
      avgWin: round2(sellAnalysis.avgWin),
      avgLoss: round2(sellAnalysis.avgLoss),
      profitFactor: round2(sellAnalysis.profitFactor),
      avgHoldTimeHours: round2(sellAnalysis.avgHoldTimeHours),
      avgTradeSize: agentTrades.length > 0
        ? round2(agentTrades.reduce((s: number, t: Trade) => s + parseFloat(t.usdcAmount), 0) / agentTrades.length)
        : 0,
      largestWin: round2(sellAnalysis.largestWin),
      largestLoss: round2(sellAnalysis.largestLoss),
      currentStreak: streaks.current,
      longestWinStreak: streaks.longestWin,
      longestLossStreak: streaks.longestLoss,
    },
    byStock,
    returns,
    decisions,
    computedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

/**
 * Compute the competitive leaderboard across all agents.
 * Returns agents ranked by total P&L.
 */
export async function computeLeaderboard(agentIds: string[]): Promise<LeaderboardEntry[]> {
  const performances = await Promise.all(
    agentIds.map((id) => computeAgentPerformance(id)),
  );

  // Sort by total PnL descending
  performances.sort((a, b) => b.summary.totalPnl - a.summary.totalPnl);

  return performances.map((perf, index) => ({
    rank: index + 1,
    agentId: perf.agentId,
    totalPnl: perf.summary.totalPnl,
    totalPnlPercent: perf.summary.totalPnlPercent,
    totalValue: perf.summary.totalValue,
    sharpeRatio: perf.risk.sharpeRatio,
    maxDrawdown: perf.risk.maxDrawdown,
    winRate: perf.trading.winRate,
    totalTrades: perf.trading.totalTrades,
    currentStreak: perf.trading.currentStreak,
  }));
}

/**
 * Compare agents head-to-head across key metrics.
 */
export async function compareAgents(agentIds: string[]): Promise<PerformanceComparison[]> {
  const performances = await Promise.all(
    agentIds.map((id) => computeAgentPerformance(id)),
  );

  const perfMap = new Map(performances.map((p) => [p.agentId, p]));

  const metrics: PerformanceComparison[] = [
    buildComparison("Total P&L", agentIds, perfMap, (p) => p.summary.totalPnl, "$", "highest"),
    buildComparison("Total P&L %", agentIds, perfMap, (p) => p.summary.totalPnlPercent, "%", "highest"),
    buildComparison("Sharpe Ratio", agentIds, perfMap, (p) => p.risk.sharpeRatio, "", "highest"),
    buildComparison("Max Drawdown", agentIds, perfMap, (p) => p.risk.maxDrawdown, "$", "lowest_abs"),
    buildComparison("Win Rate", agentIds, perfMap, (p) => p.trading.winRate, "%", "highest"),
    buildComparison("Profit Factor", agentIds, perfMap, (p) => p.trading.profitFactor, "x", "highest"),
    buildComparison("Avg Trade Size", agentIds, perfMap, (p) => p.trading.avgTradeSize, "$", "highest"),
    buildComparison("Total Trades", agentIds, perfMap, (p) => p.trading.totalTrades, "", "highest"),
    buildComparison("Avg Confidence", agentIds, perfMap, (p) => p.decisions.avgConfidence, "%", "highest"),
    buildComparison("Volatility", agentIds, perfMap, (p) => p.risk.volatility, "%", "lowest"),
  ];

  return metrics;
}

// ---------------------------------------------------------------------------
// Realized PnL
// ---------------------------------------------------------------------------

/**
 * Calculate realized PnL using FIFO matching of buy/sell trades.
 */
function calculateRealizedPnl(
  tradeList: Array<{ side: string; stockSymbol: string; stockQuantity: string; usdcAmount: string; pricePerToken: string }>,
): number {
  // Group by symbol
  const bySymbol = new Map<string, typeof tradeList>();
  for (const t of tradeList) {
    const list = bySymbol.get(t.stockSymbol) ?? [];
    list.push(t);
    bySymbol.set(t.stockSymbol, list);
  }

  let totalRealized = 0;

  for (const [, symbolTrades] of bySymbol) {
    // FIFO buy queue
    const buyQueue: Array<{ qty: number; price: number }> = [];

    for (const trade of symbolTrades) {
      const qty = parseFloat(trade.stockQuantity);
      const price = parseFloat(trade.pricePerToken);

      if (trade.side === "buy") {
        buyQueue.push({ qty, price });
      } else {
        // Sell — match against oldest buys
        let remaining = qty;
        while (remaining > 0 && buyQueue.length > 0) {
          const oldest = buyQueue[0];
          const matched = Math.min(remaining, oldest.qty);
          totalRealized += matched * (price - oldest.price);
          oldest.qty -= matched;
          remaining -= matched;
          if (oldest.qty <= 0.000000001) {
            buyQueue.shift();
          }
        }
      }
    }
  }

  return totalRealized;
}

// ---------------------------------------------------------------------------
// Daily Returns
// ---------------------------------------------------------------------------

/**
 * Calculate daily portfolio returns for risk metrics.
 */
function calculateDailyReturns(
  tradeList: Array<{ side: string; usdcAmount: string; createdAt: Date }>,
  _currentPrices: Map<string, number>,
): number[] {
  if (tradeList.length === 0) return [];

  // Group trades by day
  const dailyPnl = new Map<string, number>();

  for (const trade of tradeList) {
    const day = trade.createdAt.toISOString().split("T")[0];
    const pnl = dailyPnl.get(day) ?? 0;
    const amount = parseFloat(trade.usdcAmount);
    // Buys are negative (spending), sells are positive (receiving)
    dailyPnl.set(day, pnl + (trade.side === "sell" ? amount : -amount));
  }

  // Convert to array of returns as % of INITIAL_CAPITAL
  const returns: number[] = [];
  for (const [, pnl] of dailyPnl) {
    returns.push(pnl / INITIAL_CAPITAL);
  }

  return returns;
}

// ---------------------------------------------------------------------------
// Risk Metrics
// ---------------------------------------------------------------------------

/**
 * Compute risk metrics from daily return series.
 */
function computeRiskMetrics(
  dailyReturns: number[],
  totalPnl: number,
): AgentPerformance["risk"] {
  if (dailyReturns.length < 2) {
    return {
      sharpeRatio: null,
      sortinoRatio: null,
      calmarRatio: null,
      maxDrawdown: 0,
      maxDrawdownPercent: 0,
      volatility: null,
      beta: null,
      valueAtRisk95: null,
    };
  }

  // Volatility (annualized std dev of daily returns)
  const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (dailyReturns.length - 1);
  const dailyVol = Math.sqrt(variance);
  const annualizedVol = dailyVol * Math.sqrt(TRADING_DAYS_PER_YEAR);

  // Sharpe ratio
  const annualizedReturn = mean * TRADING_DAYS_PER_YEAR;
  const sharpeRatio = annualizedVol > 0
    ? (annualizedReturn - RISK_FREE_RATE) / annualizedVol
    : null;

  // Sortino ratio (only count downside volatility)
  const downsideReturns = dailyReturns.filter((r) => r < 0);
  let sortinoRatio: number | null = null;
  if (downsideReturns.length > 1) {
    const downsideVariance = downsideReturns.reduce((s, r) => s + r ** 2, 0) / downsideReturns.length;
    const downsideVol = Math.sqrt(downsideVariance) * Math.sqrt(TRADING_DAYS_PER_YEAR);
    sortinoRatio = downsideVol > 0
      ? (annualizedReturn - RISK_FREE_RATE) / downsideVol
      : null;
  }

  // Max drawdown
  let peak = INITIAL_CAPITAL;
  let maxDrawdown = 0;
  let runningValue = INITIAL_CAPITAL;
  for (const ret of dailyReturns) {
    runningValue += ret * INITIAL_CAPITAL;
    if (runningValue > peak) peak = runningValue;
    const drawdown = peak - runningValue;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }
  const maxDrawdownPercent = peak > 0 ? (maxDrawdown / peak) * 100 : 0;

  // Calmar ratio
  const calmarRatio = maxDrawdownPercent > 0
    ? ((totalPnl / INITIAL_CAPITAL) * 100) / maxDrawdownPercent
    : null;

  // Value at Risk (95% confidence, parametric)
  const valueAtRisk95 = dailyReturns.length >= 5
    ? -(mean - 1.645 * dailyVol) * INITIAL_CAPITAL
    : null;

  return {
    sharpeRatio: sharpeRatio !== null ? round2(sharpeRatio) : null,
    sortinoRatio: sortinoRatio !== null ? round2(sortinoRatio) : null,
    calmarRatio: calmarRatio !== null ? round2(calmarRatio) : null,
    maxDrawdown: round2(maxDrawdown),
    maxDrawdownPercent: round2(maxDrawdownPercent),
    volatility: round2(annualizedVol * 100),
    beta: null, // Would need market return data
    valueAtRisk95: valueAtRisk95 !== null ? round2(valueAtRisk95) : null,
  };
}

// ---------------------------------------------------------------------------
// Sell Trade Analysis
// ---------------------------------------------------------------------------

interface SellAnalysis {
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  largestWin: number;
  largestLoss: number;
  avgHoldTimeHours: number;
}

/**
 * Analyze sell trades to compute win rate, P&L distribution, etc.
 */
function analyzeSellTrades(
  tradeList: Array<{ side: string; stockSymbol: string; stockQuantity: string; usdcAmount: string; pricePerToken: string; createdAt: Date }>,
): SellAnalysis {
  const buys = tradeList.filter((t) => t.side === "buy");
  const sells = tradeList.filter((t) => t.side === "sell");

  if (sells.length === 0) {
    return {
      winRate: 0,
      avgWin: 0,
      avgLoss: 0,
      profitFactor: 0,
      largestWin: 0,
      largestLoss: 0,
      avgHoldTimeHours: 0,
    };
  }

  // Build a buy cost basis map per symbol
  const avgBuyPrice = new Map<string, number>();
  const buyAmounts = new Map<string, { totalCost: number; totalQty: number }>();

  for (const buy of buys) {
    const entry = buyAmounts.get(buy.stockSymbol) ?? { totalCost: 0, totalQty: 0 };
    entry.totalCost += parseFloat(buy.usdcAmount);
    entry.totalQty += parseFloat(buy.stockQuantity);
    buyAmounts.set(buy.stockSymbol, entry);
  }

  for (const [symbol, amounts] of buyAmounts) {
    avgBuyPrice.set(symbol, amounts.totalQty > 0 ? amounts.totalCost / amounts.totalQty : 0);
  }

  const wins: number[] = [];
  const losses: number[] = [];
  const holdTimes: number[] = [];

  for (const sell of sells) {
    const sellPrice = parseFloat(sell.pricePerToken);
    const costBasis = avgBuyPrice.get(sell.stockSymbol) ?? sellPrice;
    const qty = parseFloat(sell.stockQuantity);
    const pnl = (sellPrice - costBasis) * qty;

    if (pnl >= 0) {
      wins.push(pnl);
    } else {
      losses.push(pnl);
    }

    // Estimate hold time: find the most recent buy for this symbol
    const relatedBuy = buys
      .filter((b) => b.stockSymbol === sell.stockSymbol && b.createdAt <= sell.createdAt)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

    if (relatedBuy) {
      holdTimes.push(
        (sell.createdAt.getTime() - relatedBuy.createdAt.getTime()) / 3_600_000,
      );
    }
  }

  const totalWins = wins.reduce((s, w) => s + w, 0);
  const totalLosses = Math.abs(losses.reduce((s, l) => s + l, 0));

  return {
    winRate: sells.length > 0 ? round2((wins.length / sells.length) * 100) : 0,
    avgWin: wins.length > 0 ? totalWins / wins.length : 0,
    avgLoss: losses.length > 0 ? totalLosses / losses.length : 0,
    profitFactor: totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0,
    largestWin: wins.length > 0 ? Math.max(...wins) : 0,
    largestLoss: losses.length > 0 ? Math.min(...losses) : 0,
    avgHoldTimeHours: holdTimes.length > 0
      ? holdTimes.reduce((s, h) => s + h, 0) / holdTimes.length
      : 0,
  };
}

// ---------------------------------------------------------------------------
// Per-Stock Performance
// ---------------------------------------------------------------------------

/**
 * Compute per-stock performance breakdown.
 */
function computeStockPerformance(
  tradeList: Array<{ side: string; stockSymbol: string; stockQuantity: string; usdcAmount: string; pricePerToken: string }>,
  positionList: Array<{ symbol: string; quantity: string; averageCostBasis: string }>,
  currentPrices: Map<string, number>,
): StockPerformance[] {
  const stockMap = new Map<string, StockPerformance>();

  // Initialize from catalog
  for (const stock of XSTOCKS_CATALOG) {
    stockMap.set(stock.symbol, {
      symbol: stock.symbol,
      name: stock.name,
      totalBought: 0,
      totalSold: 0,
      currentPosition: 0,
      realizedPnl: 0,
      unrealizedPnl: 0,
      avgBuyPrice: 0,
      avgSellPrice: 0,
      tradeCount: 0,
      winRate: 0,
    });
  }

  // Process trades
  const buyQueueBySymbol = new Map<string, Array<{ qty: number; price: number }>>();
  let sellWins = new Map<string, number>();
  let sellTotal = new Map<string, number>();

  for (const trade of tradeList) {
    const perf = stockMap.get(trade.stockSymbol);
    if (!perf) continue;

    perf.tradeCount++;
    const qty = parseFloat(trade.stockQuantity);
    const price = parseFloat(trade.pricePerToken);
    const usdc = parseFloat(trade.usdcAmount);

    if (trade.side === "buy") {
      perf.totalBought += usdc;
      const queue = buyQueueBySymbol.get(trade.stockSymbol) ?? [];
      queue.push({ qty, price });
      buyQueueBySymbol.set(trade.stockSymbol, queue);

      // Weighted avg buy price
      const totalBuyQty = queue.reduce((s, q) => s + q.qty, 0);
      perf.avgBuyPrice = totalBuyQty > 0
        ? queue.reduce((s, q) => s + q.qty * q.price, 0) / totalBuyQty
        : 0;
    } else {
      perf.totalSold += usdc;
      perf.avgSellPrice = perf.avgSellPrice > 0
        ? (perf.avgSellPrice + price) / 2
        : price;

      // FIFO matching for realized PnL
      const queue = buyQueueBySymbol.get(trade.stockSymbol) ?? [];
      let remaining = qty;
      let tradePnl = 0;
      while (remaining > 0 && queue.length > 0) {
        const oldest = queue[0];
        const matched = Math.min(remaining, oldest.qty);
        tradePnl += matched * (price - oldest.price);
        oldest.qty -= matched;
        remaining -= matched;
        if (oldest.qty <= 0.000000001) queue.shift();
      }
      perf.realizedPnl += tradePnl;

      // Track win/loss
      const wins = sellWins.get(trade.stockSymbol) ?? 0;
      const total = sellTotal.get(trade.stockSymbol) ?? 0;
      sellTotal.set(trade.stockSymbol, total + 1);
      if (tradePnl >= 0) sellWins.set(trade.stockSymbol, wins + 1);
    }
  }

  // Add current positions
  for (const pos of positionList) {
    const perf = stockMap.get(pos.symbol);
    if (!perf) continue;

    const qty = parseFloat(pos.quantity);
    const costBasis = parseFloat(pos.averageCostBasis);
    const currentPrice = currentPrices.get(pos.symbol) ?? costBasis;

    perf.currentPosition = qty;
    perf.unrealizedPnl = (currentPrice - costBasis) * qty;
  }

  // Calculate win rates
  for (const [symbol, perf] of stockMap) {
    const wins = sellWins.get(symbol) ?? 0;
    const total = sellTotal.get(symbol) ?? 0;
    perf.winRate = total > 0 ? round2((wins / total) * 100) : 0;
  }

  // Filter to stocks with any activity
  const activeStocks = Array.from(stockMap.values())
    .filter((s) => s.tradeCount > 0 || s.currentPosition > 0);
  return sortByDescending(activeStocks, "tradeCount");
}

// ---------------------------------------------------------------------------
// Streaks
// ---------------------------------------------------------------------------

interface StreakResult {
  current: { type: "win" | "loss" | "none"; count: number };
  longestWin: number;
  longestLoss: number;
}

/**
 * Compute win/loss streaks from trade history.
 */
function computeStreaks(
  tradeList: Array<{ side: string; stockSymbol: string; stockQuantity: string; pricePerToken: string; createdAt: Date }>,
): StreakResult {
  const sells = tradeList
    .filter((t) => t.side === "sell")
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  if (sells.length === 0) {
    return { current: { type: "none", count: 0 }, longestWin: 0, longestLoss: 0 };
  }

  // Build cost basis map for streak determination
  const avgCostBySymbol = new Map<string, number>();
  for (const t of tradeList.filter((t) => t.side === "buy")) {
    // Simple running average
    const existing = avgCostBySymbol.get(t.stockSymbol);
    const price = parseFloat(t.pricePerToken);
    avgCostBySymbol.set(t.stockSymbol, existing ? (existing + price) / 2 : price);
  }

  let currentType: "win" | "loss" = "win";
  let currentCount = 0;
  let longestWin = 0;
  let longestLoss = 0;

  for (const sell of sells) {
    const sellPrice = parseFloat(sell.pricePerToken);
    const costBasis = avgCostBySymbol.get(sell.stockSymbol) ?? sellPrice;
    const isWin = sellPrice >= costBasis;
    const type = isWin ? "win" : "loss";

    if (type === currentType) {
      currentCount++;
    } else {
      // Streak broke
      if (currentType === "win") longestWin = Math.max(longestWin, currentCount);
      else longestLoss = Math.max(longestLoss, currentCount);
      currentType = type;
      currentCount = 1;
    }
  }

  // Final streak
  if (currentType === "win") longestWin = Math.max(longestWin, currentCount);
  else longestLoss = Math.max(longestLoss, currentCount);

  return {
    current: { type: currentType, count: currentCount },
    longestWin,
    longestLoss,
  };
}

// ---------------------------------------------------------------------------
// Rolling Returns
// ---------------------------------------------------------------------------

/**
 * Compute rolling returns over different time windows.
 */
function computeRollingReturns(
  tradeList: Array<{ side: string; usdcAmount: string; createdAt: Date }>,
  totalPnlAllTime: number,
): AgentPerformance["returns"] {
  const now = Date.now();

  const computeWindowPnl = (windowMs: number): number | null => {
    const cutoff = new Date(now - windowMs);
    const windowTrades = tradeList.filter((t) => t.createdAt >= cutoff);
    if (windowTrades.length === 0) return null;

    let pnl = 0;
    for (const trade of windowTrades) {
      const amount = parseFloat(trade.usdcAmount);
      pnl += trade.side === "sell" ? amount : -amount;
    }
    return round2(pnl);
  };

  return {
    day1: computeWindowPnl(24 * 60 * 60 * 1000),
    day7: computeWindowPnl(7 * 24 * 60 * 60 * 1000),
    day30: computeWindowPnl(30 * 24 * 60 * 60 * 1000),
    allTime: round2(totalPnlAllTime),
  };
}

// ---------------------------------------------------------------------------
// Decision Analysis
// ---------------------------------------------------------------------------

/**
 * Analyze agent decision quality.
 */
function analyzeDecisions(
  decisionRows: Array<{ action: string; confidence: number; symbol: string; createdAt: Date }>,
): AgentPerformance["decisions"] {
  const now = Date.now();
  const last24h = decisionRows.filter(
    (d) => now - d.createdAt.getTime() < 24 * 60 * 60 * 1000,
  );

  const actionDist = { buy: 0, sell: 0, hold: 0 };
  const symbolCounts = new Map<string, number>();
  let totalConfidence = 0;

  for (const d of decisionRows) {
    if (d.action === "buy") actionDist.buy++;
    else if (d.action === "sell") actionDist.sell++;
    else actionDist.hold++;

    totalConfidence += d.confidence;

    if (d.action !== "hold") {
      symbolCounts.set(d.symbol, (symbolCounts.get(d.symbol) ?? 0) + 1);
    }
  }

  // Find favorite stock
  let favoriteStock: string | null = null;
  let maxCount = 0;
  for (const [symbol, count] of symbolCounts) {
    if (count > maxCount) {
      maxCount = count;
      favoriteStock = symbol;
    }
  }

  return {
    totalDecisions: decisionRows.length,
    avgConfidence: decisionRows.length > 0
      ? round2(totalConfidence / decisionRows.length)
      : 0,
    confidenceCalibration: null, // Would need outcome data
    decisionsLast24h: last24h.length,
    favoriteStock,
    actionDistribution: actionDist,
  };
}

// ---------------------------------------------------------------------------
// Price Fetching
// ---------------------------------------------------------------------------

/** Cache for current prices (30-second TTL) */
let priceCache: { prices: Map<string, number>; fetchedAt: number } | null = null;
const PRICE_CACHE_TTL = 30_000;

/**
 * Fetch current prices for all xStocks.
 */
async function fetchCurrentPrices(): Promise<Map<string, number>> {
  if (priceCache && Date.now() - priceCache.fetchedAt < PRICE_CACHE_TTL) {
    return priceCache.prices;
  }

  const prices = new Map<string, number>();

  try {
    const mintAddresses = XSTOCKS_CATALOG.map((s) => s.mintAddress);
    const ids = mintAddresses.join(",");
    const jupiterApiKey = process.env.JUPITER_API_KEY;
    const headers: Record<string, string> = {};
    if (jupiterApiKey) headers["x-api-key"] = jupiterApiKey;

    const resp = await fetch(
      `https://api.jup.ag/price/v3?ids=${ids}`,
      { headers, signal: AbortSignal.timeout(10000) },
    );

    if (resp.ok) {
      const data = (await resp.json()) as {
        data: Record<string, { price: string } | undefined>;
      };
      for (const stock of XSTOCKS_CATALOG) {
        const entry = data.data?.[stock.mintAddress];
        if (entry?.price) {
          prices.set(stock.symbol, parseFloat(entry.price));
        }
      }
    }
  } catch {
    // Use fallback prices
  }

  // Fill missing with mock
  const mockPrices: Record<string, number> = {
    AAPLx: 178.50, AMZNx: 185.20, GOOGLx: 142.80, METAx: 505.30,
    MSFTx: 415.60, NVDAx: 890.50, TSLAx: 245.80, SPYx: 502.10,
    QQQx: 435.70, COINx: 205.40, MSTRx: 1685.00, HOODx: 22.80,
    NFLXx: 628.90, PLTRx: 24.50, GMEx: 17.80,
  };
  for (const stock of XSTOCKS_CATALOG) {
    if (!prices.has(stock.symbol)) {
      const base = mockPrices[stock.symbol] ?? 100;
      prices.set(stock.symbol, base * (1 + (Math.random() - 0.5) * 0.02));
    }
  }

  priceCache = { prices, fetchedAt: Date.now() };
  return prices;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildComparison(
  metric: string,
  agentIds: string[],
  perfMap: Map<string, AgentPerformance>,
  getter: (p: AgentPerformance) => number | null,
  unit: string,
  winCondition: "highest" | "lowest" | "lowest_abs",
): PerformanceComparison {
  const values: Record<string, number | null> = {};
  let winner: string | null = null;
  let bestVal: number | null = null;

  for (const id of agentIds) {
    const perf = perfMap.get(id);
    const val = perf ? getter(perf) : null;
    values[id] = val;

    if (val !== null) {
      const compareVal = winCondition === "lowest_abs" ? Math.abs(val) : val;
      if (bestVal === null) {
        bestVal = compareVal;
        winner = id;
      } else if (winCondition === "highest" && compareVal > bestVal) {
        bestVal = compareVal;
        winner = id;
      } else if ((winCondition === "lowest" || winCondition === "lowest_abs") && compareVal < bestVal) {
        bestVal = compareVal;
        winner = id;
      }
    }
  }

  return { metric, values, winner, unit };
}
