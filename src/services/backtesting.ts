/**
 * Backtesting Engine
 *
 * Comprehensive historical simulation engine for AI trading agents. Replays
 * agent decisions against realistic mock price histories to compute
 * risk-adjusted performance metrics, equity curves, drawdown analysis,
 * strategy profiling, and cross-agent comparisons.
 *
 * This is MoltApp's "what-if" layer — allowing users to evaluate how each
 * agent's strategy would have performed over arbitrary historical windows,
 * and to compare the three competing agents (Claude, GPT, Grok) on a
 * level playing field.
 */

import { db } from "../db/index.ts";
import { agentDecisions } from "../db/schema/agent-decisions.ts";
import { eq, desc, sql, and, gte, lte } from "drizzle-orm";
import { getAgentConfigs, getAgentConfig } from "../agents/orchestrator.ts";
import { XSTOCKS_CATALOG } from "../config/constants.ts";
import { round2, round4, calculateAverage, averageByKey, MS_PER_DAY } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Synthetic Price Generation Parameters
 */

/** Daily drift (expected return) for synthetic price generation: +0.03% per day */
const SYNTHETIC_DAILY_DRIFT = 0.0003;

/** Daily volatility for synthetic price generation: 1.5% per day (realistic equity volatility) */
const SYNTHETIC_DAILY_VOLATILITY = 0.015;

/** Minimum price floor as fraction of base price to prevent nonsensical prices: 1% of base */
const SYNTHETIC_PRICE_FLOOR_MULTIPLIER = 0.01;

/** Weekend day-of-week values to skip in backtesting: Sunday=0, Saturday=6 */
const WEEKEND_SUNDAY = 0;
const WEEKEND_SATURDAY = 6;

/**
 * Default Backtest Parameters
 */

/** Default initial capital for backtests: $10,000 USDC */
const DEFAULT_INITIAL_CAPITAL = 10000;

/** Default backtest period: 90 calendar days */
const DEFAULT_BACKTEST_DAYS = 90;

/**
 * Conviction Profile Classification Thresholds
 */

/** High conviction threshold: confidence >= 70% */
const CONVICTION_HIGH_THRESHOLD = 70;

/** Medium conviction floor: confidence >= 40% (and < 70%) */
const CONVICTION_MEDIUM_FLOOR = 40;

/**
 * Trading Style Scoring Thresholds
 */

/** Contrarian style: high-confidence sell threshold (confident bearish calls) */
const STYLE_CONTRARIAN_SELL_THRESHOLD = 60;

/** Contrarian style: low-confidence buy threshold (contrarian value plays) */
const STYLE_CONTRARIAN_BUY_THRESHOLD = 40;

/** Momentum style: high-confidence buy threshold (chasing momentum) */
const STYLE_MOMENTUM_BUY_THRESHOLD = 60;

/**
 * Risk Appetite Classification Thresholds
 */

/** Risk appetite classification: aggressive threshold (score >= 70) */
const RISK_APPETITE_AGGRESSIVE_THRESHOLD = 70;

/** Risk appetite classification: moderate threshold (score >= 40) */
const RISK_APPETITE_MODERATE_THRESHOLD = 40;

/**
 * Conviction Label Classification Thresholds
 */

/** Conviction label: high-conviction threshold (avg confidence >= 65%) */
const CONVICTION_LABEL_HIGH_THRESHOLD = 65;

/** Conviction label: measured threshold (avg confidence >= 45%) */
const CONVICTION_LABEL_MEASURED_THRESHOLD = 45;

/**
 * Directional Bias Thresholds
 */

/** Directional bias: bullish bias threshold (buy ratio > 50%) */
const DIRECTIONAL_BIAS_BULLISH_THRESHOLD = 0.5;

/** Directional bias: bearish bias threshold (sell ratio > 50%) */
const DIRECTIONAL_BIAS_BEARISH_THRESHOLD = 0.5;

/**
 * Risk Metrics Parameters
 */

/** Annual risk-free rate for Sharpe/Sortino ratio calculations: 5% */
const ANNUAL_RISK_FREE_RATE = 0.05;

/** Trading days per year for annualization: 252 */
const TRADING_DAYS_PER_YEAR = 252;

/** VaR percentile threshold: 5% (95th percentile VaR) */
const VAR_PERCENTILE_THRESHOLD = 0.05;

/**
 * Style Score Thresholds
 */

/** Minimum style score for primary style classification: 40 */
const STYLE_PRIMARY_MIN_SCORE = 40;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Comprehensive result of a single-agent backtest run */
export interface BacktestResult {
  agentId: string;
  agentName: string;
  period: { start: string; end: string; tradingDays: number };
  initialCapital: number;
  finalCapital: number;
  totalReturn: number;
  totalReturnPercent: number;
  annualizedReturn: number;
  metrics: {
    sharpeRatio: number;
    sortinoRatio: number;
    maxDrawdown: number;
    maxDrawdownPercent: number;
    winRate: number;
    profitFactor: number;
    avgWinAmount: number;
    avgLossAmount: number;
    payoffRatio: number;
    avgHoldingPeriod: number;
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    calmarRatio: number;
    volatility: number;
    valueAtRisk95: number;
  };
  equityCurve: Array<{ date: string; equity: number; drawdown: number; highWaterMark: number }>;
  tradeLog: Array<{
    date: string;
    action: string;
    symbol: string;
    quantity: number;
    price: number;
    pnl: number;
    reasoning: string;
    confidence: number;
  }>;
  bestTrade: { symbol: string; pnl: number; pnlPercent: number; date: string } | null;
  worstTrade: { symbol: string; pnl: number; pnlPercent: number; date: string } | null;
  monthlyReturns: Array<{ month: string; return: number; returnPercent: number; trades: number }>;
}

/** Structured profile describing an agent's trading style */
export interface StrategyProfile {
  agentId: string;
  agentName: string;
  tradingFrequency: string;
  avgDecisionsPerDay: number;
  preferredActions: { buy: number; sell: number; hold: number };
  convictionProfile: {
    highConviction: number;
    mediumConviction: number;
    lowConviction: number;
    avgConfidence: number;
  };
  sectorPreferences: Array<{ sector: string; weight: number; tradeCount: number }>;
  timeOfDayPreference: Array<{ hour: number; count: number; avgConfidence: number }>;
  contrarianScore: number;
  momentumScore: number;
  valueScore: number;
  riskAppetiteScore: number;
  diversificationScore: number;
  overallStyle: string;
}

/** Side-by-side comparison of all 3 agents */
interface BacktestComparison {
  period: { start: string; end: string; tradingDays: number };
  agents: Array<{
    agentId: string;
    agentName: string;
    totalReturnPercent: number;
    annualizedReturn: number;
    sharpeRatio: number;
    sortinoRatio: number;
    maxDrawdownPercent: number;
    winRate: number;
    profitFactor: number;
    totalTrades: number;
    calmarRatio: number;
    volatility: number;
  }>;
  winner: { agentId: string; agentName: string; metric: string } | null;
  riskAdjustedWinner: { agentId: string; agentName: string; metric: string } | null;
  summary: string;
}

/** Equity curve data point */
interface EquityCurvePoint {
  date: string;
  equity: number;
  drawdown: number;
  highWaterMark: number;
}

/** Period performance metrics */
interface PeriodPerformance {
  agentId: string;
  agentName: string;
  period: string;
  startDate: string;
  endDate: string;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  winRate: number;
  avgTradePnl: number;
  totalReturn: number;
  totalReturnPercent: number;
  totalTrades: number;
  volatility: number;
}

// ---------------------------------------------------------------------------
// Sector Mapping (mirrors analytics.ts)
// ---------------------------------------------------------------------------

const SECTOR_MAP: Record<string, string> = {
  AAPLx: "Technology",
  AMZNx: "E-Commerce",
  GOOGLx: "Technology",
  METAx: "Social Media",
  MSFTx: "Technology",
  NVDAx: "Semiconductors",
  TSLAx: "Automotive/EV",
  SPYx: "Index/ETF",
  QQQx: "Index/ETF",
  COINx: "Crypto/Fintech",
  CRCLx: "Fintech",
  MSTRx: "Crypto/Enterprise",
  AVGOx: "Semiconductors",
  JPMx: "Banking",
  HOODx: "Crypto/Fintech",
  LLYx: "Healthcare/Pharma",
  CRMx: "Enterprise Software",
  NFLXx: "Entertainment",
  PLTRx: "AI/Defense",
  GMEx: "Retail/Meme",
};

// ---------------------------------------------------------------------------
// Mock Historical Price Generation
// ---------------------------------------------------------------------------

/** Base prices for realistic mock price history */
const BASE_PRICES: Record<string, number> = {
  AAPLx: 178.50,
  AMZNx: 185.20,
  GOOGLx: 142.80,
  METAx: 505.30,
  MSFTx: 415.60,
  NVDAx: 890.50,
  TSLAx: 245.80,
  SPYx: 502.10,
  QQQx: 435.70,
  COINx: 205.40,
  CRCLx: 32.15,
  MSTRx: 1685.00,
  AVGOx: 168.90,
  JPMx: 198.50,
  HOODx: 22.80,
  LLYx: 785.20,
  CRMx: 272.60,
  NFLXx: 628.90,
  PLTRx: 24.50,
  GMEx: 17.80,
};

/**
 * Generate deterministic mock historical prices for a symbol over a date range.
 *
 * Uses a seeded random walk with upward drift to simulate realistic equity
 * price movements. The seed is derived from the symbol name so results are
 * reproducible across calls.
 *
 * Parameters:
 *  - Daily drift:      +0.03% (annualizes to ~7.8%)
 *  - Daily volatility:  1.5%  (annualizes to ~23.8%)
 */
function generateHistoricalPrices(
  symbol: string,
  startDate: Date,
  endDate: Date,
): Map<string, number> {
  const prices = new Map<string, number>();
  const basePrice = BASE_PRICES[symbol] ?? 100;

  // Deterministic seed from symbol
  let seed = 0;
  for (let i = 0; i < symbol.length; i++) {
    seed = ((seed << 5) - seed + symbol.charCodeAt(i)) | 0;
  }

  // Seeded PRNG (simple LCG)
  const nextRandom = (): number => {
    seed = (seed * 1664525 + 1013904223) | 0;
    return ((seed >>> 0) / 4294967296);
  };

  // Box-Muller transform for normal distribution
  const nextGaussian = (): number => {
    const u1 = nextRandom() || 0.0001;
    const u2 = nextRandom();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };

  let currentPrice = basePrice;
  const current = new Date(startDate);

  while (current <= endDate) {
    // Skip weekends (Saturday=6, Sunday=0)
    const dayOfWeek = current.getDay();
    if (dayOfWeek !== WEEKEND_SUNDAY && dayOfWeek !== WEEKEND_SATURDAY) {
      const dateKey = current.toISOString().slice(0, 10);
      prices.set(dateKey, round2(currentPrice));

      // Geometric Brownian Motion step
      const shock = nextGaussian();
      const dailyReturn = SYNTHETIC_DAILY_DRIFT + SYNTHETIC_DAILY_VOLATILITY * shock;
      currentPrice *= (1 + dailyReturn);

      // Floor at minimum price to prevent nonsensical prices
      if (currentPrice < basePrice * SYNTHETIC_PRICE_FLOOR_MULTIPLIER) {
        currentPrice = basePrice * SYNTHETIC_PRICE_FLOOR_MULTIPLIER;
      }
    }

    current.setDate(current.getDate() + 1);
  }

  return prices;
}

/**
 * Generate a full price history map for every stock in the catalog.
 */
function generateAllPriceHistories(
  startDate: Date,
  endDate: Date,
): Map<string, Map<string, number>> {
  const allPrices = new Map<string, Map<string, number>>();
  for (const stock of XSTOCKS_CATALOG) {
    allPrices.set(stock.symbol, generateHistoricalPrices(stock.symbol, startDate, endDate));
  }
  return allPrices;
}

// ---------------------------------------------------------------------------
// Core Backtest Engine
// ---------------------------------------------------------------------------

/**
 * Run a complete backtest simulation for a single agent.
 *
 * Replays the agent's historical decisions from the database against mock
 * price data, computing a full trade log, equity curve, and comprehensive
 * performance metrics.
 */
export async function runBacktest(params: {
  agentId: string;
  startDate: string;
  endDate: string;
  initialCapital: number;
  strategy?: string;
}): Promise<BacktestResult> {
  const { agentId, startDate, endDate, initialCapital } = params;
  const config = getAgentConfig(agentId);
  const agentName = config?.name ?? agentId;

  const start = new Date(startDate);
  const end = new Date(endDate);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new Error(`Invalid date range: ${startDate} to ${endDate}`);
  }
  if (start >= end) {
    throw new Error("startDate must be before endDate");
  }
  if (initialCapital <= 0) {
    throw new Error("initialCapital must be positive");
  }

  // Fetch agent decisions within the date range
  const decisions = await db
    .select()
    .from(agentDecisions)
    .where(
      and(
        eq(agentDecisions.agentId, agentId),
        gte(agentDecisions.createdAt, start),
        lte(agentDecisions.createdAt, end),
      ),
    )
    .orderBy(agentDecisions.createdAt);

  // Generate mock price histories
  const priceHistories = generateAllPriceHistories(start, end);

  // Simulation state
  let cash = initialCapital;
  const holdings: Map<string, { quantity: number; avgCost: number }> = new Map();
  const tradeLog: BacktestResult["tradeLog"] = [];
  const equityCurve: EquityCurvePoint[] = [];
  const dailyReturns: number[] = [];
  let highWaterMark = initialCapital;
  let previousEquity = initialCapital;

  // Collect all trading dates for the equity curve
  const tradingDates: string[] = [];
  const samplePrices = priceHistories.values().next().value;
  if (samplePrices) {
    for (const dateKey of samplePrices.keys()) {
      tradingDates.push(dateKey);
    }
  }
  tradingDates.sort();

  // Build a lookup of decisions by date
  const decisionsByDate = new Map<string, typeof decisions>();
  for (const decision of decisions) {
    const dateKey = decision.createdAt.toISOString().slice(0, 10);
    const existing = decisionsByDate.get(dateKey) ?? [];
    existing.push(decision);
    decisionsByDate.set(dateKey, existing);
  }

  // Walk through each trading day
  for (const dateKey of tradingDates) {
    // Process decisions for this day
    const dayDecisions = decisionsByDate.get(dateKey) ?? [];

    for (const decision of dayDecisions) {
      if (decision.action === "hold") continue;

      const symbolPrices = priceHistories.get(decision.symbol);
      const price = symbolPrices?.get(dateKey);
      if (!price) continue;

      const quantity = parseFloat(decision.quantity) || 0;
      if (quantity <= 0) continue;

      if (decision.action === "buy") {
        const cost = Math.min(quantity, cash); // quantity is USDC amount for buys
        if (cost <= 0) continue;

        const sharesBought = cost / price;
        const existing = holdings.get(decision.symbol);

        if (existing) {
          const totalQty = existing.quantity + sharesBought;
          const totalCost = existing.avgCost * existing.quantity + cost;
          existing.avgCost = totalCost / totalQty;
          existing.quantity = totalQty;
        } else {
          holdings.set(decision.symbol, { quantity: sharesBought, avgCost: price });
        }

        cash -= cost;
        tradeLog.push({
          date: dateKey,
          action: "buy",
          symbol: decision.symbol,
          quantity: sharesBought,
          price,
          pnl: 0, // P&L realized only on sell
          reasoning: decision.reasoning,
          confidence: decision.confidence,
        });
      } else if (decision.action === "sell") {
        const existing = holdings.get(decision.symbol);
        if (!existing || existing.quantity <= 0) continue;

        const sharesToSell = Math.min(quantity, existing.quantity);
        const proceeds = sharesToSell * price;
        const costBasis = sharesToSell * existing.avgCost;
        const pnl = proceeds - costBasis;

        existing.quantity -= sharesToSell;
        if (existing.quantity < 0.000001) {
          holdings.delete(decision.symbol);
        }

        cash += proceeds;
        tradeLog.push({
          date: dateKey,
          action: "sell",
          symbol: decision.symbol,
          quantity: sharesToSell,
          price,
          pnl,
          reasoning: decision.reasoning,
          confidence: decision.confidence,
        });
      }
    }

    // Calculate portfolio value at end of day
    let portfolioValue = cash;
    holdings.forEach((holding, symbol) => {
      const symbolPrices = priceHistories.get(symbol);
      const price = symbolPrices?.get(dateKey);
      if (price) {
        portfolioValue += holding.quantity * price;
      }
    });

    // Update high water mark and drawdown
    if (portfolioValue > highWaterMark) {
      highWaterMark = portfolioValue;
    }
    const drawdown = highWaterMark - portfolioValue;

    equityCurve.push({
      date: dateKey,
      equity: round2(portfolioValue),
      drawdown: round2(drawdown),
      highWaterMark: round2(highWaterMark),
    });

    // Track daily returns
    if (previousEquity > 0) {
      dailyReturns.push((portfolioValue - previousEquity) / previousEquity);
    }
    previousEquity = portfolioValue;
  }

  // Compute final portfolio value
  const finalCapital = equityCurve.length > 0
    ? equityCurve[equityCurve.length - 1].equity
    : initialCapital;

  const totalReturn = finalCapital - initialCapital;
  const totalReturnPercent = initialCapital > 0
    ? (totalReturn / initialCapital) * 100
    : 0;

  // Annualized return
  const tradingDaysCount = tradingDates.length || 1;
  const yearsElapsed = tradingDaysCount / 252;
  const annualizedReturn = yearsElapsed > 0
    ? (Math.pow(finalCapital / initialCapital, 1 / yearsElapsed) - 1) * 100
    : 0;

  // Compute risk metrics
  const metrics = computeBacktestMetrics(dailyReturns, tradeLog, tradingDaysCount, totalReturnPercent, annualizedReturn);

  // Best and worst trades
  const sellTrades = tradeLog.filter((t) => t.action === "sell" && t.pnl !== 0);
  const sortedByPnl = [...sellTrades].sort((a, b) => b.pnl - a.pnl);
  const bestTrade = sortedByPnl[0]
    ? {
        symbol: sortedByPnl[0].symbol,
        pnl: round2(sortedByPnl[0].pnl),
        pnlPercent: sortedByPnl[0].price > 0
          ? round2((sortedByPnl[0].pnl / (sortedByPnl[0].quantity * sortedByPnl[0].price)) * 100)
          : 0,
        date: sortedByPnl[0].date,
      }
    : null;
  const worstTrade = sortedByPnl[sortedByPnl.length - 1]
    ? {
        symbol: sortedByPnl[sortedByPnl.length - 1].symbol,
        pnl: round2(sortedByPnl[sortedByPnl.length - 1].pnl),
        pnlPercent: sortedByPnl[sortedByPnl.length - 1].price > 0
          ? round2((sortedByPnl[sortedByPnl.length - 1].pnl / (sortedByPnl[sortedByPnl.length - 1].quantity * sortedByPnl[sortedByPnl.length - 1].price)) * 100)
          : 0,
        date: sortedByPnl[sortedByPnl.length - 1].date,
      }
    : null;

  // Monthly returns
  const monthlyReturns = computeMonthlyReturns(equityCurve, tradeLog, initialCapital);

  return {
    agentId,
    agentName,
    period: { start: startDate, end: endDate, tradingDays: tradingDaysCount },
    initialCapital,
    finalCapital: round2(finalCapital),
    totalReturn: round2(totalReturn),
    totalReturnPercent: round2(totalReturnPercent),
    annualizedReturn: round2(annualizedReturn),
    metrics,
    equityCurve,
    tradeLog,
    bestTrade,
    worstTrade,
    monthlyReturns,
  };
}

// ---------------------------------------------------------------------------
// Cross-Agent Comparison
// ---------------------------------------------------------------------------

/**
 * Run backtests for all 3 agents over the same period and return a
 * side-by-side comparison with a winner determination.
 */
export async function getBacktestComparison(): Promise<BacktestComparison> {
  const configs = getAgentConfigs();

  // Default to last 90 days
  const end = new Date();
  const start = new Date(end.getTime() - DEFAULT_BACKTEST_DAYS * MS_PER_DAY);
  const startDate = start.toISOString().slice(0, 10);
  const endDate = end.toISOString().slice(0, 10);
  const initialCapital = DEFAULT_INITIAL_CAPITAL;

  const results: BacktestResult[] = [];

  for (const config of configs) {
    try {
      const result = await runBacktest({
        agentId: config.agentId,
        startDate,
        endDate,
        initialCapital,
      });
      results.push(result);
    } catch (error) {
      console.error(`[Backtesting] Failed to backtest ${config.agentId}:`, error);
    }
  }

  if (results.length === 0) {
    return {
      period: { start: startDate, end: endDate, tradingDays: 0 },
      agents: [],
      winner: null,
      riskAdjustedWinner: null,
      summary: "No backtest results available. Agents may have no decision history.",
    };
  }

  const agents = results.map((r) => ({
    agentId: r.agentId,
    agentName: r.agentName,
    totalReturnPercent: r.totalReturnPercent,
    annualizedReturn: r.annualizedReturn,
    sharpeRatio: r.metrics.sharpeRatio,
    sortinoRatio: r.metrics.sortinoRatio,
    maxDrawdownPercent: r.metrics.maxDrawdownPercent,
    winRate: r.metrics.winRate,
    profitFactor: r.metrics.profitFactor,
    totalTrades: r.metrics.totalTrades,
    calmarRatio: r.metrics.calmarRatio,
    volatility: r.metrics.volatility,
  }));

  // Determine winner by total return
  const sortedByReturn = [...agents].sort((a, b) => b.totalReturnPercent - a.totalReturnPercent);
  const winner = sortedByReturn[0]
    ? { agentId: sortedByReturn[0].agentId, agentName: sortedByReturn[0].agentName, metric: "totalReturn" }
    : null;

  // Determine risk-adjusted winner by Sharpe ratio
  const sortedBySharpe = [...agents].sort((a, b) => b.sharpeRatio - a.sharpeRatio);
  const riskAdjustedWinner = sortedBySharpe[0]
    ? { agentId: sortedBySharpe[0].agentId, agentName: sortedBySharpe[0].agentName, metric: "sharpeRatio" }
    : null;

  // Build summary
  let summary = "";
  if (winner && riskAdjustedWinner) {
    if (winner.agentId === riskAdjustedWinner.agentId) {
      summary = `${winner.agentName} dominates both raw returns (${sortedByReturn[0].totalReturnPercent.toFixed(2)}%) and risk-adjusted performance (Sharpe ${sortedBySharpe[0].sharpeRatio.toFixed(2)}) over the 90-day backtest period.`;
    } else {
      summary = `${winner.agentName} leads on raw returns (${sortedByReturn[0].totalReturnPercent.toFixed(2)}%), but ${riskAdjustedWinner.agentName} wins on risk-adjusted basis (Sharpe ${sortedBySharpe[0].sharpeRatio.toFixed(2)}). The choice depends on risk preference.`;
    }
  } else {
    summary = "Insufficient data to determine a clear winner.";
  }

  const tradingDays = results[0]?.period.tradingDays ?? 0;

  return {
    period: { start: startDate, end: endDate, tradingDays },
    agents,
    winner,
    riskAdjustedWinner,
    summary,
  };
}

// ---------------------------------------------------------------------------
// Equity Curve Generator
// ---------------------------------------------------------------------------

/**
 * Generate a day-by-day equity curve for an agent over the specified number
 * of trailing calendar days. Uses agent decisions to build a simulation.
 */
export async function generateEquityCurve(
  agentId: string,
  days: number,
): Promise<EquityCurvePoint[]> {
  if (days <= 0) {
    throw new Error("days must be a positive integer");
  }

  const end = new Date();
  const start = new Date(end.getTime() - days * MS_PER_DAY);
  const initialCapital = DEFAULT_INITIAL_CAPITAL;

  try {
    const result = await runBacktest({
      agentId,
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
      initialCapital,
    });

    return result.equityCurve;
  } catch (error) {
    console.error(`[Backtesting] Failed to generate equity curve for ${agentId}:`, error);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Strategy Breakdown
// ---------------------------------------------------------------------------

/**
 * Analyze an agent's historical decisions and produce a structured strategy
 * profile that describes their trading personality.
 */
export async function getStrategyBreakdown(agentId: string): Promise<StrategyProfile | null> {
  const config = getAgentConfig(agentId);
  if (!config) return null;

  const decisions = await db
    .select()
    .from(agentDecisions)
    .where(eq(agentDecisions.agentId, agentId))
    .orderBy(desc(agentDecisions.createdAt));

  if (decisions.length === 0) {
    return {
      agentId,
      agentName: config.name,
      tradingFrequency: "none",
      avgDecisionsPerDay: 0,
      preferredActions: { buy: 0, sell: 0, hold: 0 },
      convictionProfile: { highConviction: 0, mediumConviction: 0, lowConviction: 0, avgConfidence: 0 },
      sectorPreferences: [],
      timeOfDayPreference: [],
      contrarianScore: 0,
      momentumScore: 0,
      valueScore: 0,
      riskAppetiteScore: 0,
      diversificationScore: 0,
      overallStyle: "Inactive — no decisions recorded",
    };
  }

  // --- Action distribution ---
  const buys = decisions.filter((d: typeof decisions[0]) => d.action === "buy").length;
  const sells = decisions.filter((d: typeof decisions[0]) => d.action === "sell").length;
  const holds = decisions.filter((d: typeof decisions[0]) => d.action === "hold").length;

  // --- Trading frequency ---
  const oldest = decisions[decisions.length - 1].createdAt;
  const newest = decisions[0].createdAt;
  const daySpan = Math.max(1, (newest.getTime() - oldest.getTime()) / MS_PER_DAY);
  const avgDecisionsPerDay = decisions.length / daySpan;
  const tradingFrequency = avgDecisionsPerDay > 10
    ? "very-high"
    : avgDecisionsPerDay > 5
      ? "high"
      : avgDecisionsPerDay > 2
        ? "medium"
        : avgDecisionsPerDay > 0.5
          ? "low"
          : "very-low";

  // --- Conviction profile ---
  const highConviction = decisions.filter((d: typeof decisions[0]) => d.confidence >= CONVICTION_HIGH_THRESHOLD).length;
  const mediumConviction = decisions.filter((d: typeof decisions[0]) => d.confidence >= CONVICTION_MEDIUM_FLOOR && d.confidence < CONVICTION_HIGH_THRESHOLD).length;
  const lowConviction = decisions.filter((d: typeof decisions[0]) => d.confidence < CONVICTION_MEDIUM_FLOOR).length;
  const avgConfidence = averageByKey(decisions, 'confidence');

  // --- Sector preferences ---
  const sectorCounts = new Map<string, number>();
  const actionDecisions = decisions.filter((d: typeof decisions[0]) => d.action !== "hold");
  for (const d of actionDecisions) {
    const sector = SECTOR_MAP[d.symbol] ?? "Other";
    sectorCounts.set(sector, (sectorCounts.get(sector) ?? 0) + 1);
  }
  const totalActions = actionDecisions.length || 1;
  const sectorPreferences = Array.from(sectorCounts.entries())
    .map(([sector, count]) => ({
      sector,
      weight: Math.round((count / totalActions) * 10000) / 100,
      tradeCount: count,
    }))
    .sort((a, b) => b.tradeCount - a.tradeCount);

  // --- Time of day preference ---
  const hourMap = new Map<number, { count: number; totalConf: number }>();
  for (const d of decisions) {
    const hour = d.createdAt.getHours();
    const entry = hourMap.get(hour) ?? { count: 0, totalConf: 0 };
    entry.count++;
    entry.totalConf += d.confidence;
    hourMap.set(hour, entry);
  }
  const timeOfDayPreference = Array.from(hourMap.entries())
    .map(([hour, data]) => ({
      hour,
      count: data.count,
      avgConfidence: Math.round((data.totalConf / data.count) * 10) / 10,
    }))
    .sort((a, b) => a.hour - b.hour);

  // --- Style scores (0-100) ---

  // Contrarian score: high confidence sells + low confidence buys = more contrarian
  const highConfSells = decisions.filter((d: typeof decisions[0]) => d.action === "sell" && d.confidence >= STYLE_CONTRARIAN_SELL_THRESHOLD).length;
  const lowConfBuys = decisions.filter((d: typeof decisions[0]) => d.action === "buy" && d.confidence < STYLE_CONTRARIAN_BUY_THRESHOLD).length;
  const contrarianSignals = highConfSells + lowConfBuys;
  const contrarianScore = Math.min(100, Math.round((contrarianSignals / Math.max(1, actionDecisions.length)) * 200));

  // Momentum score: high conviction buys dominating = momentum chasing
  const highConfBuys = decisions.filter((d: typeof decisions[0]) => d.action === "buy" && d.confidence >= STYLE_MOMENTUM_BUY_THRESHOLD).length;
  const momentumScore = Math.min(100, Math.round((highConfBuys / Math.max(1, actionDecisions.length)) * 150));

  // Value score: holds + lower frequency + diversification
  const holdRatio = holds / Math.max(1, decisions.length);
  const valueScore = Math.min(100, Math.round(holdRatio * 100 + (1 / Math.max(0.1, avgDecisionsPerDay)) * 10));

  // Risk appetite: large position sizes, concentrated bets, high frequency
  const quantities = actionDecisions.map((d: typeof decisions[0]) => parseFloat(d.quantity) || 0);
  const avgQuantity = quantities.length > 0 ? quantities.reduce((s: number, q: number) => s + q, 0) / quantities.length : 0;
  const riskAppetiteScore = Math.min(100, Math.round(
    avgDecisionsPerDay * 10 +
    avgQuantity * 0.01 +
    (1 - holdRatio) * 50,
  ));

  // Diversification: unique symbols / total action decisions
  const uniqueSymbols = new Set(actionDecisions.map((d: typeof decisions[0]) => d.symbol));
  const diversificationScore = Math.min(100, Math.round(
    (uniqueSymbols.size / Math.max(1, XSTOCKS_CATALOG.length)) * 100,
  ));

  // Determine overall style label
  const overallStyle = determineOverallStyle({
    contrarianScore,
    momentumScore,
    valueScore,
    riskAppetiteScore,
    avgConfidence,
    tradingFrequency,
    buys,
    sells,
    holds,
  });

  return {
    agentId,
    agentName: config.name,
    tradingFrequency,
    avgDecisionsPerDay: round2(avgDecisionsPerDay),
    preferredActions: { buy: buys, sell: sells, hold: holds },
    convictionProfile: {
      highConviction,
      mediumConviction,
      lowConviction,
      avgConfidence: Math.round(avgConfidence * 10) / 10,
    },
    sectorPreferences,
    timeOfDayPreference,
    contrarianScore,
    momentumScore,
    valueScore,
    riskAppetiteScore,
    diversificationScore,
    overallStyle,
  };
}

// ---------------------------------------------------------------------------
// Historical Performance
// ---------------------------------------------------------------------------

/**
 * Compute performance metrics for an agent over a specific lookback period.
 */
export async function getHistoricalPerformance(
  agentId: string,
  period: "1w" | "1m" | "3m" | "6m" | "all",
): Promise<PeriodPerformance | null> {
  const config = getAgentConfig(agentId);
  if (!config) return null;

  const now = new Date();
  let startDate: Date;
  switch (period) {
    case "1w":
      startDate = new Date(now.getTime() - 7 * MS_PER_DAY);
      break;
    case "1m":
      startDate = new Date(now.getTime() - 30 * MS_PER_DAY);
      break;
    case "3m":
      startDate = new Date(now.getTime() - 90 * MS_PER_DAY);
      break;
    case "6m":
      startDate = new Date(now.getTime() - 180 * MS_PER_DAY);
      break;
    case "all":
      startDate = new Date("2024-01-01");
      break;
    default:
      startDate = new Date(now.getTime() - 30 * MS_PER_DAY);
  }

  const startStr = startDate.toISOString().slice(0, 10);
  const endStr = now.toISOString().slice(0, 10);

  try {
    const result = await runBacktest({
      agentId,
      startDate: startStr,
      endDate: endStr,
      initialCapital: 10000,
    });

    return {
      agentId,
      agentName: config.name,
      period,
      startDate: startStr,
      endDate: endStr,
      sharpeRatio: result.metrics.sharpeRatio,
      sortinoRatio: result.metrics.sortinoRatio,
      maxDrawdown: result.metrics.maxDrawdown,
      maxDrawdownPercent: result.metrics.maxDrawdownPercent,
      winRate: result.metrics.winRate,
      avgTradePnl: result.metrics.totalTrades > 0
        ? round2(result.totalReturn / result.metrics.totalTrades)
        : 0,
      totalReturn: result.totalReturn,
      totalReturnPercent: result.totalReturnPercent,
      totalTrades: result.metrics.totalTrades,
      volatility: result.metrics.volatility,
    };
  } catch (error) {
    console.error(`[Backtesting] Failed to compute historical performance for ${agentId}:`, error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Metric Computation Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the full suite of performance and risk metrics from daily returns
 * and the trade log produced by the simulation.
 */
function computeBacktestMetrics(
  dailyReturns: number[],
  tradeLog: BacktestResult["tradeLog"],
  tradingDays: number,
  totalReturnPercent: number,
  annualizedReturn: number,
): BacktestResult["metrics"] {
  // Filter to realized trades (sells with P&L)
  const realizedTrades = tradeLog.filter((t) => t.action === "sell");
  const wins = realizedTrades.filter((t) => t.pnl > 0);
  const losses = realizedTrades.filter((t) => t.pnl <= 0);

  const totalTrades = tradeLog.length;
  const winningTrades = wins.length;
  const losingTrades = losses.length;

  // Win rate
  const winRate = realizedTrades.length > 0
    ? Math.round((winningTrades / realizedTrades.length) * 10000) / 100
    : 0;

  // Average win/loss amounts
  const avgWinAmount = wins.length > 0
    ? round2(wins.reduce((s, t) => s + t.pnl, 0) / wins.length)
    : 0;
  const avgLossAmount = losses.length > 0
    ? round2(losses.reduce((s, t) => s + Math.abs(t.pnl), 0) / losses.length)
    : 0;

  // Payoff ratio
  const payoffRatio = avgLossAmount > 0
    ? round2(avgWinAmount / avgLossAmount)
    : avgWinAmount > 0 ? Infinity : 0;

  // Profit factor
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLoss > 0
    ? round2(grossProfit / grossLoss)
    : grossProfit > 0 ? Infinity : 0;

  // Average holding period (approximate: days between buy and sell for same symbol)
  const buyDates = new Map<string, string[]>();
  for (const t of tradeLog) {
    if (t.action === "buy") {
      const existing = buyDates.get(t.symbol) ?? [];
      existing.push(t.date);
      buyDates.set(t.symbol, existing);
    }
  }
  let totalHoldingDays = 0;
  let holdingCount = 0;
  for (const t of realizedTrades) {
    const symbolBuys = buyDates.get(t.symbol);
    if (symbolBuys && symbolBuys.length > 0) {
      const buyDate = symbolBuys.shift()!;
      const diff = (new Date(t.date).getTime() - new Date(buyDate).getTime()) / MS_PER_DAY;
      totalHoldingDays += Math.max(1, diff);
      holdingCount++;
    }
  }
  const avgHoldingPeriod = holdingCount > 0
    ? Math.round((totalHoldingDays / holdingCount) * 10) / 10
    : 0;

  // Daily return statistics
  const meanReturn = dailyReturns.length > 0
    ? dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length
    : 0;

  const variance = dailyReturns.length > 1
    ? dailyReturns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / (dailyReturns.length - 1)
    : 0;
  const dailyVol = Math.sqrt(variance);
  const annualizedVol = dailyVol * Math.sqrt(252);

  // Downside deviation (negative returns only)
  const negativeReturns = dailyReturns.filter((r) => r < 0);
  const downsideVariance = negativeReturns.length > 1
    ? negativeReturns.reduce((s, r) => s + r ** 2, 0) / negativeReturns.length
    : 0;
  const downsideDeviation = Math.sqrt(downsideVariance);
  const annualizedDownside = downsideDeviation * Math.sqrt(252);

  // Risk-free rate
  const dailyRfr = ANNUAL_RISK_FREE_RATE / TRADING_DAYS_PER_YEAR;

  // Sharpe ratio
  const sharpeRatio = annualizedVol > 0
    ? round2((meanReturn - dailyRfr) / dailyVol * Math.sqrt(252))
    : 0;

  // Sortino ratio
  const sortinoRatio = annualizedDownside > 0
    ? round2((meanReturn - dailyRfr) / downsideDeviation * Math.sqrt(252))
    : 0;

  // Max drawdown
  let peak = 0;
  let maxDrawdown = 0;
  let cumulative = 0;
  for (const r of dailyReturns) {
    cumulative += r;
    if (cumulative > peak) peak = cumulative;
    const dd = peak - cumulative;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }
  const maxDrawdownPercent = Math.round(maxDrawdown * 10000) / 100;

  // Calmar ratio
  const calmarRatio = maxDrawdownPercent > 0
    ? round2(annualizedReturn / maxDrawdownPercent)
    : 0;

  // Value at Risk (95th percentile)
  const sortedReturns = [...dailyReturns].sort((a, b) => a - b);
  const varIndex = Math.floor(dailyReturns.length * 0.05);
  const valueAtRisk95 = sortedReturns[varIndex] !== undefined
    ? Math.round(Math.abs(sortedReturns[varIndex]) * 10000) / 100
    : 0;

  return {
    sharpeRatio,
    sortinoRatio,
    maxDrawdown: Math.round(maxDrawdown * 10000) / 10000,
    maxDrawdownPercent,
    winRate,
    profitFactor: profitFactor === Infinity ? 999.99 : profitFactor,
    avgWinAmount,
    avgLossAmount,
    payoffRatio: payoffRatio === Infinity ? 999.99 : payoffRatio,
    avgHoldingPeriod,
    totalTrades,
    winningTrades,
    losingTrades,
    calmarRatio,
    volatility: Math.round(annualizedVol * 10000) / 100,
    valueAtRisk95,
  };
}

/**
 * Aggregate equity curve and trades into monthly buckets.
 */
function computeMonthlyReturns(
  equityCurve: EquityCurvePoint[],
  tradeLog: BacktestResult["tradeLog"],
  initialCapital: number,
): BacktestResult["monthlyReturns"] {
  if (equityCurve.length === 0) return [];

  const monthMap = new Map<string, { startEquity: number; endEquity: number; trades: number }>();

  for (const point of equityCurve) {
    const monthKey = point.date.slice(0, 7); // YYYY-MM
    const entry = monthMap.get(monthKey);
    if (!entry) {
      monthMap.set(monthKey, { startEquity: point.equity, endEquity: point.equity, trades: 0 });
    } else {
      entry.endEquity = point.equity;
    }
  }

  // Count trades per month
  for (const trade of tradeLog) {
    const monthKey = trade.date.slice(0, 7);
    const entry = monthMap.get(monthKey);
    if (entry) {
      entry.trades++;
    }
  }

  // Fix start equities: each month's start should be the previous month's end
  const sortedMonths = Array.from(monthMap.keys()).sort();
  let prevEnd = initialCapital;
  for (const month of sortedMonths) {
    const entry = monthMap.get(month)!;
    entry.startEquity = prevEnd;
    prevEnd = entry.endEquity;
  }

  return sortedMonths.map((month) => {
    const entry = monthMap.get(month)!;
    const monthReturn = entry.endEquity - entry.startEquity;
    const monthReturnPercent = entry.startEquity > 0
      ? (monthReturn / entry.startEquity) * 100
      : 0;

    return {
      month,
      return: round2(monthReturn),
      returnPercent: round2(monthReturnPercent),
      trades: entry.trades,
    };
  });
}

/**
 * Determine an overall style label from computed scores.
 */
function determineOverallStyle(params: {
  contrarianScore: number;
  momentumScore: number;
  valueScore: number;
  riskAppetiteScore: number;
  avgConfidence: number;
  tradingFrequency: string;
  buys: number;
  sells: number;
  holds: number;
}): string {
  const {
    contrarianScore,
    momentumScore,
    valueScore,
    riskAppetiteScore,
    avgConfidence,
    tradingFrequency,
    buys,
    sells,
    holds,
  } = params;

  const dominant = Math.max(contrarianScore, momentumScore, valueScore);

  // Primary style
  let primary: string;
  if (dominant === contrarianScore && contrarianScore > 40) {
    primary = "Contrarian";
  } else if (dominant === momentumScore && momentumScore > 40) {
    primary = "Momentum";
  } else if (dominant === valueScore && valueScore > 40) {
    primary = "Value";
  } else {
    primary = "Balanced";
  }

  // Risk modifier
  let riskLabel: string;
  if (riskAppetiteScore >= 70) {
    riskLabel = "Aggressive";
  } else if (riskAppetiteScore >= 40) {
    riskLabel = "Moderate";
  } else {
    riskLabel = "Conservative";
  }

  // Conviction modifier
  let convictionLabel: string;
  if (avgConfidence >= 65) {
    convictionLabel = "High-Conviction";
  } else if (avgConfidence >= 45) {
    convictionLabel = "Measured";
  } else {
    convictionLabel = "Cautious";
  }

  // Frequency modifier
  let freqLabel: string;
  if (tradingFrequency === "very-high" || tradingFrequency === "high") {
    freqLabel = "Active";
  } else if (tradingFrequency === "medium") {
    freqLabel = "Selective";
  } else {
    freqLabel = "Patient";
  }

  // Directional bias
  const total = buys + sells + holds;
  let directionLabel = "";
  if (total > 0) {
    const buyRatio = buys / total;
    const sellRatio = sells / total;
    if (buyRatio > 0.5) directionLabel = " (Bullish Bias)";
    else if (sellRatio > 0.5) directionLabel = " (Bearish Bias)";
  }

  return `${freqLabel} ${riskLabel} ${primary} — ${convictionLabel}${directionLabel}`;
}
