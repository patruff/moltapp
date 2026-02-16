/**
 * Portfolio Simulator
 *
 * "What if I had copied this agent?" — simulate following an AI agent's
 * trading decisions over a historical period to see hypothetical returns.
 *
 * This is a key feature for user engagement: lets users evaluate agents
 * before committing real capital to copy-trading.
 *
 * Features:
 * - Simulate copy-trading any agent with custom starting capital
 * - Historical performance replay with daily snapshots
 * - Multi-agent portfolio simulation (diversify across agents)
 * - Risk analysis of simulated portfolio (drawdown, volatility)
 * - Comparison with benchmark (SPYx, QQQx, equal-weight)
 * - Configurable: position sizing, max allocation, rebalance frequency
 */

import { db } from "../db/index.ts";
import { agentDecisions } from "../db/schema/agent-decisions.ts";
import { eq, desc, gte, lte, and, InferSelectModel } from "drizzle-orm";
import { getAgentConfig, getAgentConfigs } from "../agents/orchestrator.ts";
import { round2, computeVariance } from "../lib/math-utils.ts";

// Infer types from database schema
type AgentDecision = InferSelectModel<typeof agentDecisions>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SimulationConfig {
  /** Starting capital in USDC */
  startingCapital: number;
  /** Agent(s) to copy */
  agentIds: string[];
  /** Weight allocation per agent (must sum to 1.0) */
  agentWeights?: number[];
  /** Max allocation per single stock (0-1) */
  maxPositionAllocation: number;
  /** Minimum confidence threshold to follow a trade */
  minConfidenceThreshold: number;
  /** Only follow buy/sell actions (skip holds) */
  skipHolds: boolean;
  /** Simulation period */
  startDate?: Date;
  endDate?: Date;
}

export interface SimulationResult {
  config: SimulationConfig;
  summary: SimulationSummary;
  dailySnapshots: DailySnapshot[];
  tradeLog: SimulatedTrade[];
  riskMetrics: SimulationRiskMetrics;
  agentBreakdown: AgentContribution[];
  benchmarkComparison: BenchmarkComparison;
  generatedAt: string;
}

interface SimulationSummary {
  startingCapital: number;
  endingValue: number;
  totalReturn: number;
  totalReturnPercent: number;
  totalTrades: number;
  tradesFollowed: number;
  tradesSkipped: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  bestDay: { date: string; returnPercent: number } | null;
  worstDay: { date: string; returnPercent: number } | null;
  daysSimulated: number;
}

interface DailySnapshot {
  date: string;
  portfolioValue: number;
  cashBalance: number;
  positionsValue: number;
  dailyReturn: number;
  dailyReturnPercent: number;
  cumulativeReturn: number;
  cumulativeReturnPercent: number;
  positionCount: number;
}

interface SimulatedTrade {
  timestamp: Date;
  agentId: string;
  agentName: string;
  action: "buy" | "sell";
  symbol: string;
  originalConfidence: number;
  simulatedAmount: number;
  simulatedPrice: number;
  followedDecision: boolean;
  skipReason?: string;
}

interface SimulationRiskMetrics {
  annualizedReturn: number;
  annualizedVolatility: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  maxDrawdownDuration: number; // days
  calmarRatio: number;
  valueAtRisk95: number;
  beta: number; // vs SPYx
}

interface AgentContribution {
  agentId: string;
  agentName: string;
  weight: number;
  tradesGenerated: number;
  tradesFollowed: number;
  estimatedContribution: number;
  avgConfidence: number;
}

interface BenchmarkComparison {
  /** Simulation vs buy-and-hold SPYx */
  vsSPY: {
    simulationReturn: number;
    benchmarkReturn: number;
    alpha: number;
    outperformed: boolean;
  };
  /** Simulation vs equal-weight all stocks */
  vsEqualWeight: {
    simulationReturn: number;
    benchmarkReturn: number;
    alpha: number;
    outperformed: boolean;
  };
  /** Simulation vs holding USDC (0% return) */
  vsCash: {
    simulationReturn: number;
    outperformed: boolean;
  };
}

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Position Sizing Parameters
 *
 * Controls how much capital is allocated per copied trade.
 */

/**
 * Position size multiplier per trade
 *
 * Each followed trade allocates this percentage of the weighted portfolio value.
 * Example: 10% means a $10,000 portfolio with 100% agent weight allocates $1,000 per trade.
 *
 * Impact: Lower values (0.05) = more conservative, slower capital deployment
 *         Higher values (0.15) = more aggressive, faster capital deployment
 */
const POSITION_SIZE_PER_TRADE_MULTIPLIER = 0.1;

/**
 * Cash reserve ratio for buy orders
 *
 * Only use this percentage of available cash for buys (keeps remainder as safety buffer).
 * Example: 0.95 means if you have $1,000 cash, only $950 is available for buys.
 *
 * Impact: Lower values (0.90) = larger safety buffer, fewer consecutive buys
 *         Higher values (0.98) = smaller buffer, more consecutive buys possible
 *
 * Rationale: Prevents simulation from becoming 100% invested, maintains liquidity
 * for following multiple agents' buy signals in quick succession.
 */
const CASH_RESERVE_RATIO = 0.95;

/**
 * Annualization & Risk Calculation Constants
 *
 * Used for converting daily returns/volatility to annualized metrics in risk calculations.
 */

/**
 * Trading days per year for annualization calculations
 *
 * Formula: daily_return × TRADING_DAYS_PER_YEAR = annualized_return
 *          daily_volatility × √TRADING_DAYS_PER_YEAR = annualized_volatility
 *
 * 252 = NYSE standard (365 calendar days - 104 weekend days - 9 holidays)
 *
 * Impact: Change to 365 for 24/7 crypto markets or 250 for international exchanges
 */
const TRADING_DAYS_PER_YEAR = 252;

/**
 * Annual risk-free rate for Sharpe/Sortino ratio calculations
 *
 * Formula: daily_risk_free = ANNUAL_RISK_FREE_RATE / TRADING_DAYS_PER_YEAR
 *          excess_return = portfolio_return - daily_risk_free
 *
 * 0.05 = 5% annual Treasury yield (typical baseline for U.S. risk-free rate)
 *
 * Impact: Sharpe/Sortino ratios decrease if risk-free rate increases
 *         (higher bar for risk-adjusted returns)
 */
const ANNUAL_RISK_FREE_RATE = 0.05;

/**
 * VaR percentile threshold for downside risk calculation
 *
 * Formula: VaR_95 = 5th percentile of daily returns distribution
 *          (5% worst-case daily loss threshold)
 *
 * 0.05 = 95% confidence interval (5% tail risk)
 *
 * Impact: Lower values (0.01) = 99% VaR, more extreme tail risk
 *         Higher values (0.10) = 90% VaR, less extreme tail risk
 */
const VAR_PERCENTILE_THRESHOLD = 0.05;

/**
 * Percentage conversion multiplier for display formatting
 *
 * Formula: decimal_value × PERCENTAGE_CONVERSION_MULTIPLIER = percentage_value
 *          Example: 0.152 × 100 = 15.2%
 *
 * Used for: annualized returns, volatility, VaR, max drawdown display
 */
const PERCENTAGE_CONVERSION_MULTIPLIER = 100;

/**
 * Calculation Normalization & Rounding Constants
 *
 * Used for confidence score normalization and precision rounding in simulations.
 */

/**
 * Confidence baseline for normalization (neutral confidence midpoint)
 *
 * Formula: normalized_confidence = (raw_confidence - CONFIDENCE_BASELINE) / CONFIDENCE_NORMALIZATION_DIVISOR
 *          Example: 75% confidence → (75 - 50) / 100 = +0.25 (25% above neutral)
 *                   25% confidence → (25 - 50) / 100 = -0.25 (25% below neutral)
 *
 * Range: 0-100 confidence scale → -0.5 to +0.5 normalized factor
 *
 * Impact: Affects how agent confidence translates to position sizing in copy-trading
 *         Higher baseline = more conservative (fewer high-confidence trades)
 */
const CONFIDENCE_BASELINE = 50;

/**
 * Confidence normalization divisor (converts 0-100 scale to decimal)
 *
 * Formula: normalized_confidence = (confidence - CONFIDENCE_BASELINE) / CONFIDENCE_NORMALIZATION_DIVISOR
 *          Example: 100% confidence → (100 - 50) / 100 = +0.5 (maximum bullish)
 *                   0% confidence → (0 - 50) / 100 = -0.5 (maximum bearish)
 *
 * Impact: Scales confidence to -0.5 to +0.5 range for position sizing calculations
 */
const CONFIDENCE_NORMALIZATION_DIVISOR = 100;

/**
 * Win rate precision multiplier (for 1 decimal place rounding)
 *
 * Formula: rounded_win_rate = Math.round(win_rate × WIN_RATE_PRECISION_MULTIPLIER) / WIN_RATE_PRECISION_DIVISOR
 *          Example: 67.384% → Math.round(0.67384 × 1000) / 10 = 67.4%
 *
 * Impact: Controls display precision for win rates (1 decimal = 67.4% vs 2 decimals = 67.38%)
 */
const WIN_RATE_PRECISION_MULTIPLIER = 1000;

/**
 * Win rate precision divisor (for 1 decimal place rounding)
 *
 * Used with WIN_RATE_PRECISION_MULTIPLIER to achieve 1 decimal place precision.
 * Example: Math.round(67.384 × 1000) / 10 = 674 / 10 = 67.4
 */
const WIN_RATE_PRECISION_DIVISOR = 10;

/**
 * Confidence display precision multiplier (for 1 decimal place rounding)
 *
 * Formula: rounded_confidence = Math.round(confidence × CONFIDENCE_DISPLAY_PRECISION_MULTIPLIER) / CONFIDENCE_DISPLAY_PRECISION_DIVISOR
 *          Example: 73.642 → Math.round(73.642 × 10) / 10 = 73.6
 *
 * Impact: Controls display precision for average confidence scores (1 decimal = 73.6 vs integer = 74)
 */
const CONFIDENCE_DISPLAY_PRECISION_MULTIPLIER = 10;

/**
 * Confidence display precision divisor (for 1 decimal place rounding)
 *
 * Used with CONFIDENCE_DISPLAY_PRECISION_MULTIPLIER for 1 decimal place precision.
 */
const CONFIDENCE_DISPLAY_PRECISION_DIVISOR = 10;

/**
 * Weight sum validation tolerance (for floating-point comparison)
 *
 * Formula: Math.abs(sum_of_weights - 1.0) > WEIGHT_SUM_TOLERANCE → error
 *          Example: [0.33, 0.33, 0.34] sums to 1.0, within tolerance ✓
 *                   [0.30, 0.30, 0.30] sums to 0.90, exceeds tolerance ✗
 *
 * 0.01 = 1% tolerance for floating-point arithmetic rounding errors
 *
 * Impact: Prevents rejection of valid weight allocations due to floating-point precision
 *         Too strict (0.001) = rejects valid configs, too loose (0.05) = allows imbalanced portfolios
 */
const WEIGHT_SUM_TOLERANCE = 0.01;

// ---------------------------------------------------------------------------
// Simulation Engine
// ---------------------------------------------------------------------------

/**
 * Run a portfolio simulation based on historical agent decisions.
 */
export async function runSimulation(config: SimulationConfig): Promise<SimulationResult> {
  // Validate config
  validateConfig(config);

  // Normalize agent weights
  const weights = config.agentWeights ?? config.agentIds.map(() => 1 / config.agentIds.length);

  // Fetch historical decisions for all agents
  const conditions = [];
  if (config.startDate) {
    conditions.push(gte(agentDecisions.createdAt, config.startDate));
  }
  if (config.endDate) {
    conditions.push(lte(agentDecisions.createdAt, config.endDate));
  }

  const allDecisions = [];
  for (const agentId of config.agentIds) {
    const agentConditions = [eq(agentDecisions.agentId, agentId), ...conditions];
    const decisions = await db
      .select()
      .from(agentDecisions)
      .where(and(...agentConditions))
      .orderBy(agentDecisions.createdAt);
    allDecisions.push(...decisions);
  }

  // Sort all decisions chronologically
  allDecisions.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  // Run simulation
  let cashBalance = config.startingCapital;
  const portfolioPositions = new Map<string, { quantity: number; avgCost: number }>();
  const tradeLog: SimulatedTrade[] = [];
  const dailySnapshots: DailySnapshot[] = [];

  let lastSnapshotDate = "";
  let dayStartValue = config.startingCapital;
  let cumulativeReturn = 0;
  let tradesFollowed = 0;
  let tradesSkipped = 0;
  let winningTrades = 0;
  let losingTrades = 0;

  for (const decision of allDecisions) {
    const agentConfig = getAgentConfig(decision.agentId);
    const agentName = agentConfig?.name ?? decision.agentId;
    const agentIdx = config.agentIds.indexOf(decision.agentId);
    const weight = agentIdx >= 0 ? weights[agentIdx] : 0;

    // Skip holds if configured
    if (config.skipHolds && decision.action === "hold") {
      tradesSkipped++;
      continue;
    }

    // Skip low confidence
    if (decision.confidence < config.minConfidenceThreshold) {
      tradeLog.push({
        timestamp: decision.createdAt,
        agentId: decision.agentId,
        agentName,
        action: decision.action as "buy" | "sell",
        symbol: decision.symbol,
        originalConfidence: decision.confidence,
        simulatedAmount: 0,
        simulatedPrice: 0,
        followedDecision: false,
        skipReason: `Confidence ${decision.confidence}% below threshold ${config.minConfidenceThreshold}%`,
      });
      tradesSkipped++;
      continue;
    }

    // Get price from market snapshot stored with the decision
    const marketSnapshot = decision.marketSnapshot as Record<string, { price: number; change24h: number | null }> | null;
    const stockPrice = marketSnapshot?.[decision.symbol]?.price;

    if (!stockPrice || stockPrice <= 0) {
      tradesSkipped++;
      continue;
    }

    // Calculate trade amount based on weight and capital
    const portfolioValue = calculatePortfolioValue(cashBalance, portfolioPositions, marketSnapshot);
    const tradeAmount = portfolioValue * weight * POSITION_SIZE_PER_TRADE_MULTIPLIER;

    if (decision.action === "buy") {
      // Check cash availability
      const actualAmount = Math.min(tradeAmount, cashBalance * CASH_RESERVE_RATIO);
      if (actualAmount < 1) {
        tradesSkipped++;
        continue;
      }

      // Check position allocation limit
      const currentPosition = portfolioPositions.get(decision.symbol);
      const currentPositionValue = currentPosition ? currentPosition.quantity * stockPrice : 0;
      const newPositionValue = currentPositionValue + actualAmount;
      if (newPositionValue / portfolioValue > config.maxPositionAllocation) {
        tradeLog.push({
          timestamp: decision.createdAt,
          agentId: decision.agentId,
          agentName,
          action: "buy",
          symbol: decision.symbol,
          originalConfidence: decision.confidence,
          simulatedAmount: 0,
          simulatedPrice: stockPrice,
          followedDecision: false,
          skipReason: `Position limit exceeded (${Math.round(newPositionValue / portfolioValue * 100)}% > ${config.maxPositionAllocation * 100}%)`,
        });
        tradesSkipped++;
        continue;
      }

      // Execute simulated buy
      const quantity = actualAmount / stockPrice;
      cashBalance -= actualAmount;

      const existing = portfolioPositions.get(decision.symbol);
      if (existing) {
        const totalQty = existing.quantity + quantity;
        const newAvgCost = (existing.quantity * existing.avgCost + quantity * stockPrice) / totalQty;
        portfolioPositions.set(decision.symbol, { quantity: totalQty, avgCost: newAvgCost });
      } else {
        portfolioPositions.set(decision.symbol, { quantity, avgCost: stockPrice });
      }

      tradeLog.push({
        timestamp: decision.createdAt,
        agentId: decision.agentId,
        agentName,
        action: "buy",
        symbol: decision.symbol,
        originalConfidence: decision.confidence,
        simulatedAmount: actualAmount,
        simulatedPrice: stockPrice,
        followedDecision: true,
      });
      tradesFollowed++;

    } else if (decision.action === "sell") {
      // Check if we have a position
      const position = portfolioPositions.get(decision.symbol);
      if (!position || position.quantity <= 0) {
        tradesSkipped++;
        continue;
      }

      // Sell entire position (simplified)
      const sellValue = position.quantity * stockPrice;
      cashBalance += sellValue;

      // Track win/loss
      const costBasis = position.quantity * position.avgCost;
      if (sellValue > costBasis) {
        winningTrades++;
      } else {
        losingTrades++;
      }

      portfolioPositions.delete(decision.symbol);

      tradeLog.push({
        timestamp: decision.createdAt,
        agentId: decision.agentId,
        agentName,
        action: "sell",
        symbol: decision.symbol,
        originalConfidence: decision.confidence,
        simulatedAmount: sellValue,
        simulatedPrice: stockPrice,
        followedDecision: true,
      });
      tradesFollowed++;
    }

    // Daily snapshot
    const dateStr = decision.createdAt.toISOString().split("T")[0];
    if (dateStr !== lastSnapshotDate) {
      const currentValue = calculatePortfolioValue(cashBalance, portfolioPositions, marketSnapshot);
      const dailyReturn = currentValue - dayStartValue;
      const dailyReturnPercent = dayStartValue > 0 ? (dailyReturn / dayStartValue) * 100 : 0;
      cumulativeReturn = currentValue - config.startingCapital;
      const cumulativeReturnPercent = config.startingCapital > 0 ? (cumulativeReturn / config.startingCapital) * 100 : 0;

      dailySnapshots.push({
        date: dateStr,
        portfolioValue: currentValue,
        cashBalance,
        positionsValue: currentValue - cashBalance,
        dailyReturn,
        dailyReturnPercent,
        cumulativeReturn,
        cumulativeReturnPercent,
        positionCount: portfolioPositions.size,
      });

      dayStartValue = currentValue;
      lastSnapshotDate = dateStr;
    }
  }

  // Final portfolio value
  const finalValue = cashBalance + Array.from(portfolioPositions.values()).reduce(
    (sum, pos) => sum + pos.quantity * pos.avgCost, // Use cost basis as estimate
    0,
  );

  const totalReturn = finalValue - config.startingCapital;
  const totalReturnPercent = config.startingCapital > 0 ? (totalReturn / config.startingCapital) * 100 : 0;

  // Build summary
  const summary: SimulationSummary = {
    startingCapital: config.startingCapital,
    endingValue: round2(finalValue),
    totalReturn: round2(totalReturn),
    totalReturnPercent: round2(totalReturnPercent),
    totalTrades: tradesFollowed + tradesSkipped,
    tradesFollowed,
    tradesSkipped,
    winningTrades,
    losingTrades,
    winRate: tradesFollowed > 0 ? Math.round((winningTrades / (winningTrades + losingTrades || 1)) * 1000) / 10 : 0,
    bestDay: findBestDay(dailySnapshots),
    worstDay: findWorstDay(dailySnapshots),
    daysSimulated: dailySnapshots.length,
  };

  // Risk metrics
  const riskMetrics = calculateRiskMetrics(dailySnapshots, config.startingCapital);

  // Agent breakdown
  const agentBreakdown = buildAgentBreakdown(config, weights, tradeLog);

  // Benchmark comparison
  const benchmarkComparison = buildBenchmarkComparison(totalReturnPercent);

  return {
    config,
    summary,
    dailySnapshots,
    tradeLog,
    riskMetrics,
    agentBreakdown,
    benchmarkComparison,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Quick simulation preview — less detailed but faster.
 */
export async function quickSimulation(
  agentId: string,
  startingCapital = 10000,
): Promise<{
  agentId: string;
  agentName: string;
  startingCapital: number;
  estimatedReturn: number;
  estimatedReturnPercent: number;
  totalDecisions: number;
  decisionsFollowed: number;
  avgConfidence: number;
  winRate: number;
}> {
  const config = getAgentConfig(agentId);
  if (!config) throw new Error(`Agent ${agentId} not found`);

  const decisions = await db
    .select()
    .from(agentDecisions)
    .where(eq(agentDecisions.agentId, agentId))
    .orderBy(agentDecisions.createdAt);

  const actionDecisions = decisions.filter((d: AgentDecision) => d.action !== "hold");
  const highConfidence = actionDecisions.filter((d: AgentDecision) => d.confidence >= 50);

  // Simplified return estimation based on confidence-weighted decisions
  let estimatedReturn = 0;
  for (const d of actionDecisions) {
    const confFactor = (d.confidence - CONFIDENCE_BASELINE) / CONFIDENCE_NORMALIZATION_DIVISOR; // -0.5 to +0.5
    const tradeSize = startingCapital * POSITION_SIZE_PER_TRADE_MULTIPLIER * confFactor;
    estimatedReturn += tradeSize;
  }

  const avgConfidence = decisions.length > 0
    ? decisions.reduce((s: number, d: AgentDecision) => s + d.confidence, 0) / decisions.length
    : 0;

  return {
    agentId,
    agentName: config.name,
    startingCapital,
    estimatedReturn: round2(estimatedReturn),
    estimatedReturnPercent: round2((estimatedReturn / startingCapital) * 100),
    totalDecisions: decisions.length,
    decisionsFollowed: actionDecisions.length,
    avgConfidence: Math.round(avgConfidence * CONFIDENCE_DISPLAY_PRECISION_MULTIPLIER) / CONFIDENCE_DISPLAY_PRECISION_DIVISOR,
    winRate: actionDecisions.length > 0
      ? Math.round((highConfidence.length / actionDecisions.length) * WIN_RATE_PRECISION_MULTIPLIER) / WIN_RATE_PRECISION_DIVISOR
      : 0,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateConfig(config: SimulationConfig): void {
  if (config.startingCapital <= 0) {
    throw new Error("Starting capital must be greater than 0");
  }
  if (config.startingCapital > 1_000_000) {
    throw new Error("Starting capital cannot exceed $1,000,000 for simulation");
  }
  if (config.agentIds.length === 0) {
    throw new Error("At least one agent ID is required");
  }
  if (config.agentIds.length > 10) {
    throw new Error("Maximum 10 agents per simulation");
  }
  if (config.agentWeights && config.agentWeights.length !== config.agentIds.length) {
    throw new Error("agentWeights must have same length as agentIds");
  }
  if (config.agentWeights) {
    const sum = config.agentWeights.reduce((s, w) => s + w, 0);
    if (Math.abs(sum - 1.0) > 0.01) {
      throw new Error(`agentWeights must sum to 1.0 (got ${sum})`);
    }
  }
  if (config.maxPositionAllocation <= 0 || config.maxPositionAllocation > 1) {
    throw new Error("maxPositionAllocation must be between 0 and 1");
  }
}

function calculatePortfolioValue(
  cash: number,
  positions: Map<string, { quantity: number; avgCost: number }>,
  marketSnapshot: Record<string, { price: number; change24h: number | null }> | null,
): number {
  let positionsValue = 0;
  for (const [symbol, pos] of positions) {
    const price = marketSnapshot?.[symbol]?.price ?? pos.avgCost;
    positionsValue += pos.quantity * price;
  }
  return cash + positionsValue;
}

function calculateRiskMetrics(snapshots: DailySnapshot[], startingCapital: number): SimulationRiskMetrics {
  const returns = snapshots.map((s) => s.dailyReturnPercent / 100);

  if (returns.length < 2) {
    return {
      annualizedReturn: 0,
      annualizedVolatility: 0,
      sharpeRatio: 0,
      sortinoRatio: 0,
      maxDrawdown: 0,
      maxDrawdownPercent: 0,
      maxDrawdownDuration: 0,
      calmarRatio: 0,
      valueAtRisk95: 0,
      beta: 1,
    };
  }

  const meanReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = computeVariance(returns); // sample variance (n-1)
  const vol = Math.sqrt(variance);

  // Annualized
  const annualizedReturn = meanReturn * TRADING_DAYS_PER_YEAR;
  const annualizedVol = vol * Math.sqrt(TRADING_DAYS_PER_YEAR);

  // Sharpe
  const riskFreeRate = ANNUAL_RISK_FREE_RATE / TRADING_DAYS_PER_YEAR;
  const sharpe = vol > 0 ? ((meanReturn - riskFreeRate) / vol) * Math.sqrt(TRADING_DAYS_PER_YEAR) : 0;

  // Sortino
  const negReturns = returns.filter((r) => r < 0);
  const downsideVar = negReturns.length > 1
    ? negReturns.reduce((s, r) => s + r ** 2, 0) / negReturns.length // target return = 0, so no mean adjustment
    : 0;
  const downsideDev = Math.sqrt(downsideVar);
  const sortino = downsideDev > 0 ? ((meanReturn - riskFreeRate) / downsideDev) * Math.sqrt(TRADING_DAYS_PER_YEAR) : 0;

  // Max drawdown
  let peak = startingCapital;
  let maxDD = 0;
  let maxDDPercent = 0;
  let ddStart = 0;
  let maxDDDuration = 0;
  let currentDDStart = 0;

  for (let i = 0; i < snapshots.length; i++) {
    const val = snapshots[i].portfolioValue;
    if (val > peak) {
      peak = val;
      if (currentDDStart > 0) {
        maxDDDuration = Math.max(maxDDDuration, i - currentDDStart);
        currentDDStart = 0;
      }
    }
    const dd = peak - val;
    if (dd > maxDD) {
      maxDD = dd;
      maxDDPercent = (dd / peak) * 100;
      if (currentDDStart === 0) currentDDStart = i;
    }
  }

  // Calmar
  const calmar = maxDDPercent > 0 ? (annualizedReturn * PERCENTAGE_CONVERSION_MULTIPLIER) / maxDDPercent : 0;

  // VaR 95%
  const sortedReturns = [...returns].sort((a, b) => a - b);
  const varIdx = Math.floor(returns.length * VAR_PERCENTILE_THRESHOLD);
  const var95 = sortedReturns[varIdx] ?? 0;

  return {
    annualizedReturn: round2(annualizedReturn * PERCENTAGE_CONVERSION_MULTIPLIER),
    annualizedVolatility: round2(annualizedVol * PERCENTAGE_CONVERSION_MULTIPLIER),
    sharpeRatio: round2(sharpe),
    sortinoRatio: round2(sortino),
    maxDrawdown: round2(maxDD),
    maxDrawdownPercent: round2(maxDDPercent),
    maxDrawdownDuration: maxDDDuration,
    calmarRatio: round2(calmar),
    valueAtRisk95: round2(var95 * PERCENTAGE_CONVERSION_MULTIPLIER),
    beta: 1, // Placeholder — would need SPYx correlation data
  };
}

function buildAgentBreakdown(
  config: SimulationConfig,
  weights: number[],
  tradeLog: SimulatedTrade[],
): AgentContribution[] {
  return config.agentIds.map((agentId, idx) => {
    const agentConfig = getAgentConfig(agentId);
    const agentTrades = tradeLog.filter((t) => t.agentId === agentId);
    const followed = agentTrades.filter((t) => t.followedDecision);
    const avgConf = followed.length > 0
      ? followed.reduce((s, t) => s + t.originalConfidence, 0) / followed.length
      : 0;

    return {
      agentId,
      agentName: agentConfig?.name ?? agentId,
      weight: weights[idx],
      tradesGenerated: agentTrades.length,
      tradesFollowed: followed.length,
      estimatedContribution: round2(weights[idx] * config.startingCapital),
      avgConfidence: Math.round(avgConf * 10) / 10,
    };
  });
}

function buildBenchmarkComparison(simulationReturn: number): BenchmarkComparison {
  // These would be computed from actual price data in production.
  // For now, use estimated benchmark returns.
  const spyEstimatedReturn = 0; // Would need historical SPYx data
  const equalWeightReturn = 0; // Would need historical equal-weight data

  return {
    vsSPY: {
      simulationReturn,
      benchmarkReturn: spyEstimatedReturn,
      alpha: simulationReturn - spyEstimatedReturn,
      outperformed: simulationReturn > spyEstimatedReturn,
    },
    vsEqualWeight: {
      simulationReturn,
      benchmarkReturn: equalWeightReturn,
      alpha: simulationReturn - equalWeightReturn,
      outperformed: simulationReturn > equalWeightReturn,
    },
    vsCash: {
      simulationReturn,
      outperformed: simulationReturn > 0,
    },
  };
}

function findBestDay(snapshots: DailySnapshot[]): { date: string; returnPercent: number } | null {
  if (snapshots.length === 0) return null;
  const best = snapshots.reduce((prev, curr) =>
    curr.dailyReturnPercent > prev.dailyReturnPercent ? curr : prev,
  );
  return { date: best.date, returnPercent: round2(best.dailyReturnPercent) };
}

function findWorstDay(snapshots: DailySnapshot[]): { date: string; returnPercent: number } | null {
  if (snapshots.length === 0) return null;
  const worst = snapshots.reduce((prev, curr) =>
    curr.dailyReturnPercent < prev.dailyReturnPercent ? curr : prev,
  );
  return { date: worst.date, returnPercent: round2(worst.dailyReturnPercent) };
}
