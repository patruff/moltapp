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

import { round2 } from "../lib/math-utils.ts";

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

  const buyCount = trades.filter((t) => t.action === "buy").length;
  const sellCount = trades.filter((t) => t.action === "sell").length;
  const holdCount = allDecisions.length - trades.length;

  // Win rate
  const tradesWithPnl = trades.filter((t) => t.pnl !== undefined);
  const wins = tradesWithPnl.filter((t) => (t.pnl ?? 0) > 0);
  const losses = tradesWithPnl.filter((t) => (t.pnl ?? 0) < 0);
  const winRate = tradesWithPnl.length > 0 ? (wins.length / tradesWithPnl.length) * 100 : 0;

  // Confidence metrics
  const avgConfidence =
    allDecisions.length > 0
      ? allDecisions.reduce((s, d) => s + d.confidence, 0) / allDecisions.length
      : 0;

  const avgConfidenceOnWins =
    wins.length > 0
      ? wins.reduce((s, t) => s + t.confidence, 0) / wins.length
      : 0;

  const avgConfidenceOnLosses =
    losses.length > 0
      ? losses.reduce((s, t) => s + t.confidence, 0) / losses.length
      : 0;

  // Conviction accuracy: success rate on high-confidence trades (>70%)
  const highConfTrades = tradesWithPnl.filter((t) => t.confidence > 70);
  const highConfWins = highConfTrades.filter((t) => (t.pnl ?? 0) > 0);
  const convictionAccuracy =
    highConfTrades.length > 0
      ? (highConfWins.length / highConfTrades.length) * 100
      : 0;

  // P&L
  const totalPnl = tradesWithPnl.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const bestTrade = tradesWithPnl.length > 0
    ? tradesWithPnl.reduce((best, t) => (t.pnl ?? 0) > (best.pnl ?? 0) ? t : best)
    : null;
  const worstTrade = tradesWithPnl.length > 0
    ? tradesWithPnl.reduce((worst, t) => (t.pnl ?? 0) < (worst.pnl ?? 0) ? t : worst)
    : null;

  // Favorite stock
  const symbolCounts: Record<string, number> = {};
  for (const t of trades) {
    symbolCounts[t.symbol] = (symbolCounts[t.symbol] ?? 0) + 1;
  }
  const favoriteStock = Object.entries(symbolCounts).sort(([, a], [, b]) => b - a)[0]?.[0] ?? null;

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
    stats.avgConfidence =
      symbolTrades.length > 0
        ? symbolTrades.reduce((s, t) => s + t.confidence, 0) / symbolTrades.length
        : 0;
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
  const avgReturn = returns.reduce((s, r) => s + r, 0) / returns.length;

  // Volatility (standard deviation)
  const variance =
    returns.length > 1
      ? returns.reduce((s, r) => s + Math.pow(r - avgReturn, 2), 0) / (returns.length - 1)
      : 0;
  const volatility = Math.sqrt(variance);

  // Sharpe ratio (annualized, assuming ~250 trading days, ~12 rounds/day)
  const roundsPerYear = 250 * 12;
  const annualizedReturn = avgReturn * roundsPerYear;
  const annualizedVol = volatility * Math.sqrt(roundsPerYear);
  const sharpeRatio = annualizedVol > 0 ? annualizedReturn / annualizedVol : 0;

  // Sortino ratio (uses only downside deviation)
  const downsideReturns = returns.filter((r) => r < 0);
  const downsideVariance =
    downsideReturns.length > 1
      ? downsideReturns.reduce((s, r) => s + Math.pow(r, 2), 0) / downsideReturns.length
      : 0;
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
  const totalReturn = returns.reduce((s, r) => s + r, 0);
  const calmarRatio = maxDrawdown > 0 ? totalReturn / maxDrawdown : 0;

  // Profit factor
  const grossProfit = returns.filter((r) => r > 0).reduce((s, r) => s + r, 0);
  const grossLoss = Math.abs(
    returns.filter((r) => r < 0).reduce((s, r) => s + r, 0),
  );
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  // Average position size (as % of assumed $10k portfolio)
  const avgQty = trades.reduce((s, t) => s + t.quantity, 0) / trades.length;
  const avgPositionSizePercent = (avgQty / 10000) * 100;

  return {
    sharpeRatio: round2(sharpeRatio),
    sortinoRatio: round2(sortinoRatio),
    maxDrawdownPercent: round2(maxDrawdown),
    avgPositionSizePercent: round2(avgPositionSizePercent),
    calmarRatio: round2(calmarRatio),
    profitFactor: round2(profitFactor === Infinity ? 999 : profitFactor),
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
  const avgQty = trades.length > 0
    ? trades.reduce((s, t) => s + t.quantity, 0) / trades.length
    : 0;
  const riskAppetite = Math.min(100, (avgQty / 50) * 100); // 50 USDC is max

  // Diversification: unique stocks traded / total stock universe
  const uniqueSymbols = new Set(trades.map((t) => t.symbol)).size;
  const diversificationScore = Math.min(100, (uniqueSymbols / 20) * 100);

  // Conviction strength: avg confidence when not holding
  const convictionStrength =
    trades.length > 0
      ? trades.reduce((s, t) => s + t.confidence, 0) / trades.length
      : 0;

  // Consistency: inverse of confidence standard deviation
  const confidences = allDecisions.map((d) => d.confidence);
  const avgConf =
    confidences.length > 0
      ? confidences.reduce((s, c) => s + c, 0) / confidences.length
      : 0;
  const confVariance =
    confidences.length > 1
      ? confidences.reduce((s, c) => s + Math.pow(c - avgConf, 2), 0) / confidences.length
      : 0;
  const confStdDev = Math.sqrt(confVariance);
  const consistencyScore = Math.max(0, 100 - confStdDev * 2);

  // Dominant style
  const buys = trades.filter((t) => t.action === "buy").length;
  const sells = trades.filter((t) => t.action === "sell").length;
  const holds = totalDecisions - trades.length;
  let dominantStyle = "passive";
  if (holds > buys + sells) dominantStyle = "passive";
  else if (buys > sells * 2) dominantStyle = "momentum";
  else if (sells > buys * 2) dominantStyle = "contrarian";
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
  const bestPnl = snapshots.reduce((best, s) =>
    s.totalPnl > best.totalPnl ? s : best,
  );
  if (bestPnl.totalPnl !== 0) {
    insights.push(
      `${bestPnl.agentName} leads with $${bestPnl.totalPnl.toFixed(2)} total P&L`,
    );
  }

  // Best win rate
  const bestWinRate = snapshots.reduce((best, s) =>
    s.winRate > best.winRate ? s : best,
  );
  if (bestWinRate.winRate > 0) {
    insights.push(
      `${bestWinRate.agentName} has the highest win rate at ${bestWinRate.winRate.toFixed(1)}%`,
    );
  }

  // Most active trader
  const mostActive = snapshots.reduce((most, s) =>
    s.totalTrades > most.totalTrades ? s : most,
  );
  if (mostActive.totalTrades > 0) {
    insights.push(
      `${mostActive.agentName} is the most active with ${mostActive.totalTrades} trades across ${roundHistory.length} rounds`,
    );
  }

  // Conviction accuracy comparison
  const bestConviction = snapshots.reduce((best, s) =>
    s.convictionAccuracy > best.convictionAccuracy ? s : best,
  );
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
