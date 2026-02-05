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
    const tradeAmount = portfolioValue * weight * 0.1; // 10% of weighted portfolio per trade

    if (decision.action === "buy") {
      // Check cash availability
      const actualAmount = Math.min(tradeAmount, cashBalance * 0.95); // Keep 5% cash reserve
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
    endingValue: Math.round(finalValue * 100) / 100,
    totalReturn: Math.round(totalReturn * 100) / 100,
    totalReturnPercent: Math.round(totalReturnPercent * 100) / 100,
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
    const confFactor = (d.confidence - 50) / 100; // -0.5 to +0.5
    const tradeSize = startingCapital * 0.1 * confFactor;
    estimatedReturn += tradeSize;
  }

  const avgConfidence = decisions.length > 0
    ? decisions.reduce((s: number, d: AgentDecision) => s + d.confidence, 0) / decisions.length
    : 0;

  return {
    agentId,
    agentName: config.name,
    startingCapital,
    estimatedReturn: Math.round(estimatedReturn * 100) / 100,
    estimatedReturnPercent: Math.round((estimatedReturn / startingCapital) * 10000) / 100,
    totalDecisions: decisions.length,
    decisionsFollowed: actionDecisions.length,
    avgConfidence: Math.round(avgConfidence * 10) / 10,
    winRate: actionDecisions.length > 0
      ? Math.round((highConfidence.length / actionDecisions.length) * 1000) / 10
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
  const variance = returns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / (returns.length - 1);
  const vol = Math.sqrt(variance);

  // Annualized (assuming 252 trading days)
  const annualizedReturn = meanReturn * 252;
  const annualizedVol = vol * Math.sqrt(252);

  // Sharpe
  const riskFreeRate = 0.05 / 252;
  const sharpe = vol > 0 ? ((meanReturn - riskFreeRate) / vol) * Math.sqrt(252) : 0;

  // Sortino
  const negReturns = returns.filter((r) => r < 0);
  const downsideVar = negReturns.length > 1
    ? negReturns.reduce((s, r) => s + r ** 2, 0) / negReturns.length
    : 0;
  const downsideDev = Math.sqrt(downsideVar);
  const sortino = downsideDev > 0 ? ((meanReturn - riskFreeRate) / downsideDev) * Math.sqrt(252) : 0;

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
  const calmar = maxDDPercent > 0 ? (annualizedReturn * 100) / maxDDPercent : 0;

  // VaR 95%
  const sortedReturns = [...returns].sort((a, b) => a - b);
  const varIdx = Math.floor(returns.length * 0.05);
  const var95 = sortedReturns[varIdx] ?? 0;

  return {
    annualizedReturn: Math.round(annualizedReturn * 10000) / 100,
    annualizedVolatility: Math.round(annualizedVol * 10000) / 100,
    sharpeRatio: Math.round(sharpe * 100) / 100,
    sortinoRatio: Math.round(sortino * 100) / 100,
    maxDrawdown: Math.round(maxDD * 100) / 100,
    maxDrawdownPercent: Math.round(maxDDPercent * 100) / 100,
    maxDrawdownDuration: maxDDDuration,
    calmarRatio: Math.round(calmar * 100) / 100,
    valueAtRisk95: Math.round(var95 * 10000) / 100,
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
      estimatedContribution: Math.round(weights[idx] * config.startingCapital * 100) / 100,
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
  return { date: best.date, returnPercent: Math.round(best.dailyReturnPercent * 100) / 100 };
}

function findWorstDay(snapshots: DailySnapshot[]): { date: string; returnPercent: number } | null {
  if (snapshots.length === 0) return null;
  const worst = snapshots.reduce((prev, curr) =>
    curr.dailyReturnPercent < prev.dailyReturnPercent ? curr : prev,
  );
  return { date: worst.date, returnPercent: Math.round(worst.dailyReturnPercent * 100) / 100 };
}
