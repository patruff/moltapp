/**
 * Agent Performance Comparison Engine
 *
 * Deep head-to-head analytics for comparing AI trading agents.
 * Provides comprehensive statistical comparison including:
 *
 * - Cumulative P&L curves
 * - Sharpe/Sortino ratio comparison
 * - Win rate by stock, by time period
 * - Risk-adjusted performance ranking
 * - Conviction accuracy (high-confidence trade success rate)
 * - Style consistency metrics
 * - Head-to-head matchups (when agents traded the same stock)
 * - Agreement/disagreement frequency
 * - Reaction time to market events
 *
 * All computations are done in-memory from round history. No DB required.
 */

import { averageByKey, computeDownsideVariance, computeVariance, countByCondition, findMax, findMin, getTopKey, mean, round2, sumByKey } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * High Confidence Threshold for Conviction Accuracy Calculation
 *
 * Trades with confidence > 70% are classified as "high-confidence" for conviction
 * accuracy scoring. This measures how well agents perform when they're most certain.
 *
 * Why 70%: Empirically separates "confident" from "uncertain" trades. Lowering to 65%
 * would include more borderline trades; raising to 75% would only count very strong bets.
 */
const HIGH_CONFIDENCE_CONVICTION_THRESHOLD = 70;

/**
 * Trading Calendar Assumptions for Annualization
 *
 * Risk metrics (Sharpe, Sortino) are annualized using these assumptions:
 * - 252 trading days per year (NYSE standard)
 * - 12 rounds per trading day (MoltApp's trading frequency)
 * Total: 3024 annualized periods per year
 *
 * Why these values:
 * - 252 days: NYSE standard (365 calendar days - 104 weekend days - 9 holidays = 252)
 * - 12 rounds/day: MoltApp benchmark executes hourly during market hours
 */
const TRADING_DAYS_PER_YEAR = 252;
const ROUNDS_PER_TRADING_DAY = 12;

/**
 * Portfolio Size Assumption for Position Size Normalization
 *
 * Average position size is calculated as percentage of assumed $10,000 portfolio.
 * This baseline enables cross-agent risk appetite comparison.
 *
 * Why $10,000: Standard benchmark portfolio size. If changed to $50k, all
 * avgPositionSizePercent values will be 5× smaller (same absolute size = lower %).
 */
const ASSUMED_PORTFOLIO_SIZE_USDC = 10_000;

/**
 * Maximum Trade Size for Risk Appetite Calculation
 *
 * Risk appetite score is calculated as (avgQuantity / MAX_TRADE_SIZE) × 100.
 * Assumes 50 USDC is the maximum position size for aggressive traders.
 *
 * Why 50 USDC: Current MoltApp position size cap. If cap increases to 100 USDC,
 * this constant should update to maintain accurate risk appetite scoring (0-100 scale).
 */
const MAX_TRADE_SIZE_USDC = 50;

/**
 * Stock Universe Size for Diversification Scoring
 *
 * Diversification score is calculated as (uniqueSymbols / STOCK_UNIVERSE_SIZE) × 100.
 * Assumes 20 stocks in the tradeable universe.
 *
 * Why 20: Current MoltApp benchmark includes ~20 xStocks (SPYx, AAPLx, TSLAx, etc.).
 * If universe expands to 40 stocks, agent trading 10 stocks would score 25% instead of 50%.
 */
const STOCK_UNIVERSE_SIZE = 20;

/**
 * Confidence Standard Deviation Multiplier for Consistency Scoring
 *
 * Consistency score is calculated as: 100 - (confidenceStdDev × MULTIPLIER)
 * Higher stdDev = more volatile confidence = lower consistency.
 *
 * Why 2×: Scales stdDev to 0-100 range. Agent with stdDev=50 (very inconsistent)
 * would score 0. Agent with stdDev=0 (perfectly consistent) scores 100.
 */
const CONFIDENCE_STDDEV_MULTIPLIER = 2;

/**
 * Buy/Sell Ratio Thresholds for Trading Style Classification
 *
 * Trading style is classified as:
 * - Momentum: buys > sells × MULTIPLIER (e.g., 60 buys, 25 sells → 60 > 50 → momentum)
 * - Contrarian: sells > buys × MULTIPLIER (e.g., 60 sells, 25 buys → 60 > 50 → contrarian)
 * - Value: neither condition met (balanced buy/sell ratio)
 * - Passive: holds > buys + sells (mostly holding)
 *
 * Why 2×: Requires strong directional bias. Lowering to 1.5× would classify
 * more agents as momentum/contrarian; raising to 3× would require extreme bias.
 */
const MOMENTUM_CONTRARIAN_MULTIPLIER = 2;

/**
 * Maximum Scores for Risk Appetite and Diversification Metrics
 *
 * Both metrics are capped at 100 to maintain 0-100 scale:
 * - Risk appetite: min(100, (avgQty / MAX_TRADE_SIZE) × 100)
 * - Diversification: min(100, (uniqueSymbols / STOCK_UNIVERSE_SIZE) × 100)
 *
 * Prevents scores exceeding 100 when agents trade larger than expected sizes
 * or trade more stocks than assumed universe size.
 */
const MAX_RISK_APPETITE_SCORE = 100;
const MAX_DIVERSIFICATION_SCORE = 100;

/**
 * Consistency Score Floor
 *
 * Consistency cannot go below 0 (prevents negative scores when stdDev is very high).
 * Formula: max(0, 100 - confStdDev × 2)
 */
const MIN_CONSISTENCY_SCORE = 0;

/**
 * Profit Factor Infinity Cap for Display
 *
 * When profit factor is Infinity (no losses), cap at 999 for clean display.
 * Actual value remains Infinity internally but rounds to 999 for reports.
 */
const PROFIT_FACTOR_INFINITY_CAP = 999;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentPerformanceSnapshot {
  agentId: string;
  agentName: string;
  totalTrades: number;
  buyCount: number;
  sellCount: number;
  holdCount: number;
  totalDecisions: number;
  winRate: number;
  avgConfidence: number;
  avgConfidenceOnWins: number;
  avgConfidenceOnLosses: number;
  convictionAccuracy: number;
  totalPnl: number;
  bestTrade: TradeRecord | null;
  worstTrade: TradeRecord | null;
  favoriteStock: string | null;
  symbolBreakdown: Record<string, SymbolStats>;
  riskMetrics: RiskMetrics;
  styleProfile: StyleProfile;
}

export interface TradeRecord {
  symbol: string;
  action: "buy" | "sell" | "hold";
  quantity: number;
  confidence: number;
  reasoning: string;
  pnl?: number;
  timestamp: string;
  roundId: string;
}

export interface SymbolStats {
  symbol: string;
  totalTrades: number;
  buys: number;
  sells: number;
  avgConfidence: number;
  winRate: number;
  totalPnl: number;
}

export interface RiskMetrics {
  /** Annualized Sharpe ratio (excess return / volatility) */
  sharpeRatio: number;
  /** Sortino ratio (excess return / downside deviation) */
  sortinoRatio: number;
  /** Maximum peak-to-trough drawdown percentage */
  maxDrawdownPercent: number;
  /** Average position size as % of portfolio */
  avgPositionSizePercent: number;
  /** Calmar ratio (return / max drawdown) */
  calmarRatio: number;
  /** Percentage of trades that are profitable */
  profitFactor: number;
  /** Standard deviation of returns */
  volatility: number;
}

export interface StyleProfile {
  /** Dominant style: momentum, value, contrarian, passive */
  dominantStyle: string;
  /** Risk appetite: 0-100 (100 = most aggressive) */
  riskAppetite: number;
  /** Frequency: trades per round on average */
  tradeFrequency: number;
  /** Diversification score: 0-100 (100 = most diversified) */
  diversificationScore: number;
  /** Conviction strength: avg confidence when trading (not holding) */
  convictionStrength: number;
  /** Consistency: standard deviation of confidence scores */
  consistencyScore: number;
}

export interface HeadToHeadResult {
  agent1Id: string;
  agent2Id: string;
  agent1Name: string;
  agent2Name: string;
  /** Rounds where both agents made non-hold decisions */
  sharedActiveRounds: number;
  /** Rounds where agents agreed on direction (same stock, same action) */
  agreementCount: number;
  /** Rounds where agents disagreed (same stock, opposite action) */
  disagreementCount: number;
  agreementRate: number;
  /** Who performed better when they disagreed */
  disagreementWinner: {
    agentId: string;
    winCount: number;
  };
  /** Stock-level matchups */
  stockMatchups: Array<{
    symbol: string;
    agent1Action: string;
    agent2Action: string;
    agent1Pnl: number;
    agent2Pnl: number;
    winner: string;
  }>;
}

export interface ComparisonReport {
  generatedAt: string;
  roundsAnalyzed: number;
  agents: AgentPerformanceSnapshot[];
  rankings: {
    byTotalPnl: RankedAgent[];
    bySharpeRatio: RankedAgent[];
    byWinRate: RankedAgent[];
    byConvictionAccuracy: RankedAgent[];
    byConsistency: RankedAgent[];
  };
  headToHead: HeadToHeadResult[];
  insights: string[];
}

export interface RankedAgent {
  rank: number;
  agentId: string;
  agentName: string;
  value: number;
  label: string;
}

// ---------------------------------------------------------------------------
// In-Memory Round Store
// ---------------------------------------------------------------------------

interface StoredRound {
  roundId: string;
  timestamp: string;
  decisions: Array<{
    agentId: string;
    agentName: string;
    action: "buy" | "sell" | "hold";
    symbol: string;
    quantity: number;
    confidence: number;
    reasoning: string;
    executed: boolean;
    pnl?: number;
  }>;
}

const roundHistory: StoredRound[] = [];
const MAX_ROUNDS = 1000;

// ---------------------------------------------------------------------------
// Data Ingestion
// ---------------------------------------------------------------------------

/**
 * Record a completed trading round for comparison analysis.
 * Call this from the orchestrator after each round completes.
 */
export function recordRoundForComparison(round: StoredRound): void {
  roundHistory.push(round);
  if (roundHistory.length > MAX_ROUNDS) {
    roundHistory.splice(0, roundHistory.length - MAX_ROUNDS);
  }
}

/**
 * Get the number of rounds stored.
 */
export function getStoredRoundCount(): number {
  return roundHistory.length;
}

// ---------------------------------------------------------------------------
// Core Analysis
// ---------------------------------------------------------------------------

/**
 * Build a comprehensive performance snapshot for an agent.
 */
export function buildAgentSnapshot(
  agentId: string,
  agentName: string,
): AgentPerformanceSnapshot {
  const trades: TradeRecord[] = [];
  const allDecisions: TradeRecord[] = [];

  for (const round of roundHistory) {
    for (const d of round.decisions) {
      if (d.agentId !== agentId) continue;

      const record: TradeRecord = {
        symbol: d.symbol,
        action: d.action,
        quantity: d.quantity,
        confidence: d.confidence,
        reasoning: d.reasoning,
        pnl: d.pnl,
        timestamp: round.timestamp,
        roundId: round.roundId,
      };

      allDecisions.push(record);
      if (d.action !== "hold") {
        trades.push(record);
      }
    }
  }

  const buyCount = countByCondition(trades, (t) => t.action === "buy");
  const sellCount = countByCondition(trades, (t) => t.action === "sell");
  const holdCount = allDecisions.length - trades.length;

  // Win rate
  const tradesWithPnl = trades.filter((t) => t.pnl !== undefined);
  const wins = tradesWithPnl.filter((t) => (t.pnl ?? 0) > 0);
  const losses = tradesWithPnl.filter((t) => (t.pnl ?? 0) < 0);
  const winRate = tradesWithPnl.length > 0 ? (wins.length / tradesWithPnl.length) * 100 : 0;

  // Confidence metrics
  const avgConfidence = averageByKey(allDecisions, "confidence");

  const avgConfidenceOnWins = averageByKey(wins, "confidence");

  const avgConfidenceOnLosses = averageByKey(losses, "confidence");

  // Conviction accuracy: success rate on high-confidence trades
  const highConfTrades = tradesWithPnl.filter((t) => t.confidence > HIGH_CONFIDENCE_CONVICTION_THRESHOLD);
  const highConfWins = highConfTrades.filter((t) => (t.pnl ?? 0) > 0);
  const convictionAccuracy =
    highConfTrades.length > 0
      ? (highConfWins.length / highConfTrades.length) * 100
      : 0;

  // P&L
  const totalPnl = sumByKey(tradesWithPnl, "pnl");
  const bestTrade = findMax(tradesWithPnl, "pnl") ?? null;
  const worstTrade = findMin(tradesWithPnl, "pnl") ?? null;

  // Favorite stock
  const symbolCounts: Record<string, number> = {};
  for (const t of trades) {
    symbolCounts[t.symbol] = (symbolCounts[t.symbol] ?? 0) + 1;
  }
  const favoriteStock = getTopKey(symbolCounts) ?? null;

  // Symbol breakdown
  const symbolBreakdown: Record<string, SymbolStats> = {};
  for (const t of trades) {
    const stats = symbolBreakdown[t.symbol] ?? {
      symbol: t.symbol,
      totalTrades: 0,
      buys: 0,
      sells: 0,
      avgConfidence: 0,
      winRate: 0,
      totalPnl: 0,
    };
    stats.totalTrades++;
    if (t.action === "buy") stats.buys++;
    if (t.action === "sell") stats.sells++;
    stats.totalPnl += t.pnl ?? 0;
    symbolBreakdown[t.symbol] = stats;
  }

  // Finalize symbol stats
  for (const [sym, stats] of Object.entries(symbolBreakdown)) {
    const symbolTrades = trades.filter((t) => t.symbol === sym);
    stats.avgConfidence = averageByKey(symbolTrades, "confidence");
    const symbolWins = symbolTrades.filter((t) => (t.pnl ?? 0) > 0);
    const symbolWithPnl = symbolTrades.filter((t) => t.pnl !== undefined);
    stats.winRate =
      symbolWithPnl.length > 0
        ? (symbolWins.length / symbolWithPnl.length) * 100
        : 0;
  }

  // Risk metrics
  const riskMetrics = computeRiskMetrics(tradesWithPnl);

  // Style profile
  const styleProfile = computeStyleProfile(allDecisions, trades);

  return {
    agentId,
    agentName,
    totalTrades: trades.length,
    buyCount,
    sellCount,
    holdCount,
    totalDecisions: allDecisions.length,
    winRate,
    avgConfidence,
    avgConfidenceOnWins,
    avgConfidenceOnLosses,
    convictionAccuracy,
    totalPnl,
    bestTrade,
    worstTrade,
    favoriteStock,
    symbolBreakdown,
    riskMetrics,
    styleProfile,
  };
}

// ---------------------------------------------------------------------------
// Risk Computations
// ---------------------------------------------------------------------------

function computeRiskMetrics(trades: TradeRecord[]): RiskMetrics {
  if (trades.length === 0) {
    return {
      sharpeRatio: 0,
      sortinoRatio: 0,
      maxDrawdownPercent: 0,
      avgPositionSizePercent: 0,
      calmarRatio: 0,
      profitFactor: 0,
      volatility: 0,
    };
  }

  const returns = trades.map((t) => t.pnl ?? 0);
  const avgReturn = mean(returns);

  // Volatility (standard deviation)
  const variance = computeVariance(returns); // sample variance (default)
  const volatility = Math.sqrt(variance);

  // Sharpe ratio (annualized)
  const roundsPerYear = TRADING_DAYS_PER_YEAR * ROUNDS_PER_TRADING_DAY;
  const annualizedReturn = avgReturn * roundsPerYear;
  const annualizedVol = volatility * Math.sqrt(roundsPerYear);
  const sharpeRatio = annualizedVol > 0 ? annualizedReturn / annualizedVol : 0;

  // Sortino ratio (uses only downside deviation)
  const downsideVariance = computeDownsideVariance(returns, true); // true = population variance
  const downsideDeviation = Math.sqrt(downsideVariance);
  const annualizedDownsideDev = downsideDeviation * Math.sqrt(roundsPerYear);
  const sortinoRatio =
    annualizedDownsideDev > 0 ? annualizedReturn / annualizedDownsideDev : 0;

  // Max drawdown
  let peak = 0;
  let cumulative = 0;
  let maxDrawdown = 0;
  for (const r of returns) {
    cumulative += r;
    if (cumulative > peak) peak = cumulative;
    const drawdown = peak > 0 ? ((peak - cumulative) / peak) * 100 : 0;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  // Calmar ratio
  const totalReturn = returns.reduce((s, r) => s + r, 0); // cumulative sum needed for Calmar
  const calmarRatio = maxDrawdown > 0 ? totalReturn / maxDrawdown : 0;

  // Profit factor
  const positiveReturns = returns.filter((r) => r > 0);
  const negativeReturns = returns.filter((r) => r < 0);
  const grossProfit = positiveReturns.reduce((s, r) => s + r, 0);
  const grossLoss = Math.abs(negativeReturns.reduce((s, r) => s + r, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  // Average position size (as % of assumed portfolio)
  const avgQty = averageByKey(trades, "quantity");
  const avgPositionSizePercent = (avgQty / ASSUMED_PORTFOLIO_SIZE_USDC) * 100;

  return {
    sharpeRatio: round2(sharpeRatio),
    sortinoRatio: round2(sortinoRatio),
    maxDrawdownPercent: round2(maxDrawdown),
    avgPositionSizePercent: round2(avgPositionSizePercent),
    calmarRatio: round2(calmarRatio),
    profitFactor: round2(profitFactor === Infinity ? PROFIT_FACTOR_INFINITY_CAP : profitFactor),
    volatility: round2(volatility),
  };
}

// ---------------------------------------------------------------------------
// Style Profile
// ---------------------------------------------------------------------------

function computeStyleProfile(
  allDecisions: TradeRecord[],
  trades: TradeRecord[],
): StyleProfile {
  const totalDecisions = allDecisions.length;
  const totalRounds = new Set(allDecisions.map((d) => d.roundId)).size;
  const tradeFrequency = totalRounds > 0 ? trades.length / totalRounds : 0;

  // Risk appetite: based on average quantity relative to max trade size
  const avgQty = averageByKey(trades, "quantity");
  const riskAppetite = Math.min(MAX_RISK_APPETITE_SCORE, (avgQty / MAX_TRADE_SIZE_USDC) * 100);

  // Diversification: unique stocks traded / total stock universe
  const uniqueSymbols = new Set(trades.map((t) => t.symbol)).size;
  const diversificationScore = Math.min(MAX_DIVERSIFICATION_SCORE, (uniqueSymbols / STOCK_UNIVERSE_SIZE) * 100);

  // Conviction strength: avg confidence when not holding
  const convictionStrength = averageByKey(trades, "confidence");

  // Consistency: inverse of confidence standard deviation
  const confidences = allDecisions.map((d) => d.confidence);
  const avgConf = mean(confidences);
  const confVariance = computeVariance(confidences, true); // population variance
  const confStdDev = Math.sqrt(confVariance);
  const consistencyScore = Math.max(MIN_CONSISTENCY_SCORE, 100 - confStdDev * CONFIDENCE_STDDEV_MULTIPLIER);

  // Dominant style
  const buys = countByCondition(trades, (t) => t.action === "buy");
  const sells = countByCondition(trades, (t) => t.action === "sell");
  const holds = totalDecisions - trades.length;
  let dominantStyle = "passive";
  if (holds > buys + sells) dominantStyle = "passive";
  else if (buys > sells * MOMENTUM_CONTRARIAN_MULTIPLIER) dominantStyle = "momentum";
  else if (sells > buys * MOMENTUM_CONTRARIAN_MULTIPLIER) dominantStyle = "contrarian";
  else dominantStyle = "value";

  return {
    dominantStyle,
    riskAppetite: round2(riskAppetite),
    tradeFrequency: round2(tradeFrequency),
    diversificationScore: round2(diversificationScore),
    convictionStrength: round2(convictionStrength),
    consistencyScore: round2(consistencyScore),
  };
}

// ---------------------------------------------------------------------------
// Head-to-Head Comparison
// ---------------------------------------------------------------------------

/**
 * Compare two agents head-to-head on rounds where both traded.
 */
export function compareHeadToHead(
  agent1Id: string,
  agent1Name: string,
  agent2Id: string,
  agent2Name: string,
): HeadToHeadResult {
  let sharedActiveRounds = 0;
  let agreementCount = 0;
  let disagreementCount = 0;
  let agent1DisagreementWins = 0;
  let agent2DisagreementWins = 0;
  const stockMatchups: HeadToHeadResult["stockMatchups"] = [];

  for (const round of roundHistory) {
    const d1 = round.decisions.find((d) => d.agentId === agent1Id);
    const d2 = round.decisions.find((d) => d.agentId === agent2Id);
    if (!d1 || !d2) continue;

    // Both made non-hold decisions
    if (d1.action !== "hold" && d2.action !== "hold") {
      sharedActiveRounds++;

      // Same stock comparison
      if (d1.symbol === d2.symbol) {
        if (d1.action === d2.action) {
          agreementCount++;
        } else {
          disagreementCount++;

          const pnl1 = d1.pnl ?? 0;
          const pnl2 = d2.pnl ?? 0;
          if (pnl1 > pnl2) agent1DisagreementWins++;
          else if (pnl2 > pnl1) agent2DisagreementWins++;

          stockMatchups.push({
            symbol: d1.symbol,
            agent1Action: d1.action,
            agent2Action: d2.action,
            agent1Pnl: pnl1,
            agent2Pnl: pnl2,
            winner: pnl1 > pnl2 ? agent1Id : agent2Id,
          });
        }
      }
    }
  }

  const totalComparisons = agreementCount + disagreementCount;
  const agreementRate = totalComparisons > 0 ? (agreementCount / totalComparisons) * 100 : 0;

  return {
    agent1Id,
    agent2Id,
    agent1Name,
    agent2Name,
    sharedActiveRounds,
    agreementCount,
    disagreementCount,
    agreementRate: round2(agreementRate),
    disagreementWinner:
      agent1DisagreementWins >= agent2DisagreementWins
        ? { agentId: agent1Id, winCount: agent1DisagreementWins }
        : { agentId: agent2Id, winCount: agent2DisagreementWins },
    stockMatchups: stockMatchups.slice(-20), // Last 20
  };
}

// ---------------------------------------------------------------------------
// Full Comparison Report
// ---------------------------------------------------------------------------

/**
 * Generate a full comparison report for all 3 agents.
 */
export function generateComparisonReport(): ComparisonReport {
  const agents = [
    { id: "claude-trader", name: "Claude Trader" },
    { id: "gpt-trader", name: "GPT Trader" },
    { id: "grok-trader", name: "Grok Trader" },
  ];

  const snapshots = agents.map((a) => buildAgentSnapshot(a.id, a.name));

  // Rankings
  const byTotalPnl = rankAgents(snapshots, (s) => s.totalPnl, "P&L");
  const bySharpeRatio = rankAgents(snapshots, (s) => s.riskMetrics.sharpeRatio, "Sharpe");
  const byWinRate = rankAgents(snapshots, (s) => s.winRate, "Win Rate");
  const byConvictionAccuracy = rankAgents(
    snapshots,
    (s) => s.convictionAccuracy,
    "Conviction Accuracy",
  );
  const byConsistency = rankAgents(
    snapshots,
    (s) => s.styleProfile.consistencyScore,
    "Consistency",
  );

  // Head-to-head
  const headToHead: HeadToHeadResult[] = [];
  for (let i = 0; i < agents.length; i++) {
    for (let j = i + 1; j < agents.length; j++) {
      headToHead.push(
        compareHeadToHead(
          agents[i].id,
          agents[i].name,
          agents[j].id,
          agents[j].name,
        ),
      );
    }
  }

  // Generate insights
  const insights = generateInsights(snapshots, headToHead);

  return {
    generatedAt: new Date().toISOString(),
    roundsAnalyzed: roundHistory.length,
    agents: snapshots,
    rankings: {
      byTotalPnl,
      bySharpeRatio,
      byWinRate,
      byConvictionAccuracy,
      byConsistency,
    },
    headToHead,
    insights,
  };
}

// ---------------------------------------------------------------------------
// Rankings
// ---------------------------------------------------------------------------

function rankAgents(
  snapshots: AgentPerformanceSnapshot[],
  getValue: (s: AgentPerformanceSnapshot) => number,
  label: string,
): RankedAgent[] {
  return snapshots
    .map((s) => ({
      agentId: s.agentId,
      agentName: s.agentName,
      value: round2(getValue(s)),
      label,
    }))
    .sort((a, b) => b.value - a.value)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

// ---------------------------------------------------------------------------
// Insight Generation
// ---------------------------------------------------------------------------

function generateInsights(
  snapshots: AgentPerformanceSnapshot[],
  headToHead: HeadToHeadResult[],
): string[] {
  const insights: string[] = [];

  // Best P&L
  const bestPnl = findMax(snapshots, "totalPnl")!;
  if (bestPnl.totalPnl !== 0) {
    insights.push(
      `${bestPnl.agentName} leads with $${bestPnl.totalPnl.toFixed(2)} total P&L`,
    );
  }

  // Best win rate
  const bestWinRate = findMax(snapshots, "winRate")!;
  if (bestWinRate.winRate > 0) {
    insights.push(
      `${bestWinRate.agentName} has the highest win rate at ${bestWinRate.winRate.toFixed(1)}%`,
    );
  }

  // Most active trader
  const mostActive = findMax(snapshots, "totalTrades")!;
  if (mostActive.totalTrades > 0) {
    insights.push(
      `${mostActive.agentName} is the most active with ${mostActive.totalTrades} trades across ${roundHistory.length} rounds`,
    );
  }

  // Conviction accuracy comparison
  const bestConviction = findMax(snapshots, "convictionAccuracy")!;
  if (bestConviction.convictionAccuracy > 0) {
    insights.push(
      `${bestConviction.agentName} has best conviction accuracy: ${bestConviction.convictionAccuracy.toFixed(1)}% success on high-confidence trades`,
    );
  }

  // Head-to-head insights
  for (const h2h of headToHead) {
    if (h2h.disagreementCount > 0) {
      const winnerName =
        h2h.disagreementWinner.agentId === h2h.agent1Id
          ? h2h.agent1Name
          : h2h.agent2Name;
      insights.push(
        `When ${h2h.agent1Name} and ${h2h.agent2Name} disagree, ${winnerName} wins ${h2h.disagreementWinner.winCount}/${h2h.disagreementCount} times`,
      );
    }
  }

  // Style diversity
  const styles = snapshots.map((s) => s.styleProfile.dominantStyle);
  const uniqueStyles = new Set(styles);
  if (uniqueStyles.size === snapshots.length) {
    insights.push(
      `All agents have distinct trading styles: ${styles.join(", ")}`,
    );
  }

  return insights;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Reset all stored round history (for testing).
 */
export function resetComparisonData(): void {
  roundHistory.length = 0;
}
