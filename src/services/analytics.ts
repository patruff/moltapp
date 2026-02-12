/**
 * Analytics Engine
 *
 * Advanced performance analytics for AI trading agents. Computes metrics
 * that go far beyond simple P&L: Sharpe ratio, max drawdown, win rate
 * analysis, trading pattern detection, sector allocation, risk-adjusted
 * returns, and inter-agent correlation analysis.
 *
 * This is the brain behind MoltApp's competitive intelligence — helping
 * users understand not just WHO is winning, but WHY.
 */

import { db } from "../db/index.ts";
import { agentDecisions } from "../db/schema/agent-decisions.ts";
import { tradeReactions } from "../db/schema/trade-reactions.ts";
import { tradeComments } from "../db/schema/trade-comments.ts";
import { eq, desc, sql, and, gte, lte, inArray } from "drizzle-orm";
import { getAgentConfigs, getAgentConfig, getMarketData, getPortfolioContext } from "../agents/orchestrator.ts";
import type { MarketData } from "../agents/base-agent.ts";
import { calculateAverage, averageByKey, sumByKey, getTopKey, round2, round3, sortDescending, sortByDescending, sortEntriesDescending, groupAndAggregate, indexBy, countByCondition, findMax } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Decision Quality Classification Thresholds
 *
 * Control how agent decisions are classified as "high quality" (wins) vs
 * "low quality" (losses) based on confidence levels.
 */

/**
 * High Confidence Threshold
 *
 * Decisions with confidence >= this value (50%) are classified as "wins"
 * or "high quality" decisions in performance metrics.
 *
 * Example: Confidence 55 >= 50 → classified as win
 *
 * Tuning impact: Raise to 55 to require stronger conviction for win classification.
 */
const HIGH_CONFIDENCE_THRESHOLD = 50;

/**
 * Confidence Distribution Boundaries
 *
 * Thresholds for bucketing decisions into low/medium/high confidence tiers
 * for pattern analysis and agent profiling.
 */

/**
 * Low Confidence Upper Bound
 *
 * Decisions with confidence < this value (33%) are classified as "low confidence".
 *
 * Example: Confidence 30 < 33 → low confidence bucket
 *
 * Tuning impact: Raise to 40 to expand low confidence bucket (catch more uncertain trades).
 */
const CONFIDENCE_LOW_THRESHOLD = 33;

/**
 * High Confidence Lower Bound
 *
 * Decisions with confidence >= this value (67%) are classified as "high confidence".
 *
 * Example: Confidence 70 >= 67 → high confidence bucket
 *
 * Tuning impact: Raise to 75 to require stronger conviction for high confidence classification.
 */
const CONFIDENCE_HIGH_THRESHOLD = 67;

/**
 * Trade Frequency Classification
 *
 * Thresholds for classifying agent trading activity as high/medium/low frequency.
 */

/**
 * High Frequency Threshold
 *
 * Agents with avgDecisionsPerDay > this value (10) are classified as "high frequency" traders.
 *
 * Example: 12 decisions/day > 10 → "high" frequency
 *
 * Tuning impact: Lower to 8 to classify more agents as high frequency.
 */
const TRADE_FREQUENCY_HIGH_THRESHOLD = 10;

/**
 * Medium Frequency Threshold
 *
 * Agents with avgDecisionsPerDay > this value (3) but <= HIGH_FREQUENCY_THRESHOLD
 * are classified as "medium frequency" traders.
 *
 * Example: 5 decisions/day > 3 && <= 10 → "medium" frequency
 *
 * Tuning impact: Lower to 2 to expand medium frequency classification.
 */
const TRADE_FREQUENCY_MEDIUM_THRESHOLD = 3;

/**
 * Market Sentiment Classification
 *
 * Thresholds for determining overall market sentiment (bullish/bearish/neutral)
 * based on aggregate price movements and agent positions.
 */

/**
 * Bullish Sentiment Threshold
 *
 * When bullish percentage exceeds this value (60%), classify agent as
 * having bullish overall sentiment.
 *
 * Example: 65% buys > 60% → "bullish" sentiment
 *
 * Tuning impact: Lower to 55% to trigger bullish classification earlier.
 */
const SENTIMENT_BULLISH_THRESHOLD = 60;

/**
 * Market Sentiment Price Change Thresholds
 *
 * Price change thresholds for classifying market as bullish/bearish/neutral.
 */

/**
 * Bullish Market Threshold
 *
 * When avg 24h price change exceeds this value (1%), classify market as "bullish".
 *
 * Example: +1.5% avg change > 1% → "bullish" market
 *
 * Tuning impact: Raise to 2% to require stronger uptrend for bullish classification.
 */
const MARKET_BULLISH_THRESHOLD = 1;

/**
 * Bearish Market Threshold
 *
 * When avg 24h price change falls below this value (-1%), classify market as "bearish".
 *
 * Example: -1.5% avg change < -1% → "bearish" market
 *
 * Tuning impact: Lower to -2% to require stronger downtrend for bearish classification.
 */
const MARKET_BEARISH_THRESHOLD = -1;

/**
 * Market Volatility Classification
 *
 * Thresholds for classifying market volatility as high/medium/low based on
 * average absolute price changes.
 */

/**
 * High Volatility Threshold
 *
 * When avg absolute 24h change exceeds this value (3%), classify market as "high volatility".
 *
 * Example: 4% avg abs change > 3% → "high" volatility
 *
 * Tuning impact: Lower to 2.5% to trigger high volatility classification earlier.
 */
const VOLATILITY_HIGH_THRESHOLD = 3;

/**
 * Medium Volatility Threshold
 *
 * When avg absolute 24h change exceeds this value (1.5%) but <= HIGH_VOLATILITY_THRESHOLD,
 * classify market as "medium volatility".
 *
 * Example: 2% avg abs change > 1.5% && <= 3% → "medium" volatility
 *
 * Tuning impact: Lower to 1.0% to expand medium volatility range.
 */
const VOLATILITY_MEDIUM_THRESHOLD = 1.5;

/**
 * Risk Metrics Calculation Parameters
 *
 * Parameters used in Sharpe ratio, Sortino ratio, and other risk-adjusted
 * return calculations.
 */

/**
 * Risk-Free Rate (Annual)
 *
 * Assumed annual risk-free rate (5%) for Sharpe/Sortino ratio calculations.
 * Divided by trading days (252) to get daily rate.
 *
 * Example: 0.05 / 252 = 0.0001984 daily risk-free rate
 *
 * Tuning impact: Raise to 0.06 (6%) for higher interest rate environment.
 */
const RISK_FREE_RATE_ANNUAL = 0.05;

/**
 * Trading Days Per Year
 *
 * Number of trading days per year (252) for annualizing volatility and returns.
 *
 * Example: dailyVol * sqrt(252) = annualized volatility
 *
 * Tuning impact: Use 365 for crypto (24/7 trading) or 252 for traditional equities.
 */
const TRADING_DAYS_PER_YEAR = 252;

/**
 * VaR Percentile Thresholds
 *
 * Percentile thresholds for Value at Risk calculations (95th, 98th, 99th percentiles).
 */

/**
 * VaR 95th Percentile
 *
 * Percentile index (0.05) for 95% confidence VaR calculation.
 * Represents 5% tail risk (worst 5% of outcomes).
 *
 * Example: sortedReturns[Math.floor(n * 0.05)] = VaR95
 *
 * Tuning impact: Use 0.02 for 98% confidence (2% tail) or 0.01 for 99% confidence (1% tail).
 */
const VAR_PERCENTILE_95 = 0.05;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Comprehensive agent performance analytics */
export interface AgentAnalytics {
  agentId: string;
  agentName: string;
  provider: string;
  period: AnalyticsPeriod;
  performance: PerformanceMetrics;
  riskMetrics: RiskMetrics;
  tradingPatterns: TradingPatterns;
  sectorAllocation: SectorAllocation[];
  streaks: StreakAnalysis;
  sentimentProfile: SentimentProfile;
  socialMetrics: SocialMetrics;
  hourlyActivity: HourlyActivity[];
  recentHighlights: TradeHighlight[];
}

/** Head-to-head comparison between two agents */
export interface AgentComparison {
  agent1: AgentComparisonEntry;
  agent2: AgentComparisonEntry;
  headToHead: HeadToHeadStats;
  correlationCoefficient: number;
  divergenceEvents: DivergenceEvent[];
  recommendation: string;
}

/** Arena overview with all 3 agents ranked */
export interface ArenaOverview {
  rankings: ArenaRanking[];
  totalRounds: number;
  totalDecisions: number;
  marketConditions: MarketConditions;
  recentActivity: RecentArenaActivity[];
  agentAgreementRate: number;
  mostControversialStock: string | null;
  nextScheduledRound: string;
}

export type AnalyticsPeriod = "24h" | "7d" | "30d" | "all";

interface PerformanceMetrics {
  totalPnl: number;
  totalPnlPercent: number;
  totalDecisions: number;
  buyCount: number;
  sellCount: number;
  holdCount: number;
  winRate: number;
  avgConfidence: number;
  avgConfidenceOnWins: number;
  avgConfidenceOnLosses: number;
  bestDecision: DecisionSummary | null;
  worstDecision: DecisionSummary | null;
  profitFactor: number;
}

interface RiskMetrics {
  sharpeRatio: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  volatility: number;
  downsideDeviation: number;
  sortinoRatio: number;
  calmarRatio: number;
  valueAtRisk95: number;
  avgPositionSize: number;
  maxPositionConcentration: number;
}

interface TradingPatterns {
  avgDecisionsPerDay: number;
  mostTradedSymbol: string | null;
  mostTradedSymbolCount: number;
  leastTradedSymbol: string | null;
  preferredAction: "buy" | "sell" | "hold";
  avgHoldDuration: number; // hours
  tradeFrequency: "high" | "medium" | "low";
  confidenceDistribution: { low: number; medium: number; high: number };
  symbolDiversity: number;
  reversalRate: number;
}

interface SectorAllocation {
  sector: string;
  symbols: string[];
  tradeCount: number;
  allocation: number;
}

interface StreakAnalysis {
  currentStreak: { type: "win" | "loss" | "hold"; length: number };
  longestWinStreak: number;
  longestLossStreak: number;
  longestHoldStreak: number;
  avgWinStreakLength: number;
  avgLossStreakLength: number;
}

interface SentimentProfile {
  overallSentiment: "bullish" | "bearish" | "neutral";
  bullishPercentage: number;
  bearishPercentage: number;
  sentimentConsistency: number;
  contrarianism: number; // how often agent goes against market direction
}

interface SocialMetrics {
  totalReactions: number;
  bullishReactions: number;
  bearishReactions: number;
  totalComments: number;
  avgReactionsPerDecision: number;
  communityAgreement: number;
}

interface HourlyActivity {
  hour: number;
  decisions: number;
  avgConfidence: number;
}

interface TradeHighlight {
  id: number;
  action: string;
  symbol: string;
  confidence: number;
  reasoning: string;
  timestamp: Date;
  reactions: { bullish: number; bearish: number };
}

interface DecisionSummary {
  id: number;
  action: string;
  symbol: string;
  confidence: number;
  reasoning: string;
  timestamp: Date;
}

interface AgentComparisonEntry {
  agentId: string;
  agentName: string;
  provider: string;
  totalDecisions: number;
  winRate: number;
  avgConfidence: number;
  sharpeRatio: number;
  maxDrawdown: number;
  favoriteStock: string | null;
  riskTolerance: string;
}

interface HeadToHeadStats {
  sameDecisionCount: number;
  oppositeDecisionCount: number;
  agreementRate: number;
  symbolOverlap: string[];
  agent1WinsCount: number;
  agent2WinsCount: number;
}

interface DivergenceEvent {
  roundId: string | null;
  timestamp: Date;
  symbol: string;
  agent1Action: string;
  agent2Action: string;
  agent1Confidence: number;
  agent2Confidence: number;
}

interface ArenaRanking {
  rank: number;
  agentId: string;
  agentName: string;
  provider: string;
  model: string;
  totalDecisions: number;
  winRate: number;
  avgConfidence: number;
  portfolioValue: number;
  totalPnl: number;
  totalPnlPercent: number;
  riskTolerance: string;
  tradingStyle: string;
  lastAction: string | null;
  lastSymbol: string | null;
  lastTimestamp: Date | null;
  socialScore: number;
}

interface MarketConditions {
  avgChange24h: number;
  topGainer: { symbol: string; change: number } | null;
  topLoser: { symbol: string; change: number } | null;
  overallSentiment: "bullish" | "bearish" | "neutral";
  volatility: "high" | "medium" | "low";
  stockCount: number;
}

interface RecentArenaActivity {
  roundId: string | null;
  timestamp: Date;
  decisions: Array<{
    agentId: string;
    agentName: string;
    action: string;
    symbol: string;
    confidence: number;
  }>;
}

// ---------------------------------------------------------------------------
// Sector Mapping
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
// Core Analytics Functions
// ---------------------------------------------------------------------------

/**
 * Compute comprehensive analytics for a single agent.
 */
export async function getAgentAnalytics(
  agentId: string,
  period: AnalyticsPeriod = "all",
): Promise<AgentAnalytics | null> {
  const config = getAgentConfig(agentId);
  if (!config) return null;

  // Determine time window
  const now = new Date();
  let startDate: Date | null = null;
  if (period === "24h") startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  else if (period === "7d") startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  else if (period === "30d") startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Fetch all decisions for this agent in the time window
  const conditions = startDate
    ? and(eq(agentDecisions.agentId, agentId), gte(agentDecisions.createdAt, startDate))
    : eq(agentDecisions.agentId, agentId);

  const decisions = await db
    .select()
    .from(agentDecisions)
    .where(conditions)
    .orderBy(desc(agentDecisions.createdAt));

  // Fetch market data for portfolio context
  let marketData: MarketData[] = [];
  try {
    marketData = await getMarketData();
  } catch {
    // use empty if unavailable
  }

  // Build portfolio context
  let portfolio: Awaited<ReturnType<typeof getPortfolioContext>> = { cashBalance: 10000, positions: [], totalValue: 10000, totalPnl: 0, totalPnlPercent: 0 };
  try {
    portfolio = await getPortfolioContext(agentId, marketData);
  } catch {
    // use default
  }

  // Compute all analytics
  const performance = computePerformance(decisions, portfolio);
  const riskMetrics = computeRiskMetrics(decisions, portfolio);
  const tradingPatterns = computeTradingPatterns(decisions);
  const sectorAllocation = computeSectorAllocation(decisions);
  const streaks = computeStreaks(decisions);
  const sentimentProfile = computeSentimentProfile(decisions, marketData);
  const hourlyActivity = computeHourlyActivity(decisions);

  // Fetch social metrics
  const decisionIds = decisions.map((d: typeof decisions[0]) => d.id);
  const socialMetrics = await computeSocialMetrics(decisionIds);

  // Get recent highlights (most reacted / highest confidence decisions)
  const recentHighlights = await getRecentHighlights(agentId, 5);

  return {
    agentId,
    agentName: config.name,
    provider: config.provider,
    period,
    performance,
    riskMetrics,
    tradingPatterns,
    sectorAllocation,
    streaks,
    sentimentProfile,
    socialMetrics,
    hourlyActivity,
    recentHighlights,
  };
}

/**
 * Compare two agents head-to-head.
 */
export async function compareAgents(
  agentId1: string,
  agentId2: string,
): Promise<AgentComparison | null> {
  const config1 = getAgentConfig(agentId1);
  const config2 = getAgentConfig(agentId2);
  if (!config1 || !config2) return null;

  // Fetch decisions for both agents
  const [decisions1, decisions2] = await Promise.all([
    db.select().from(agentDecisions).where(eq(agentDecisions.agentId, agentId1)).orderBy(desc(agentDecisions.createdAt)),
    db.select().from(agentDecisions).where(eq(agentDecisions.agentId, agentId2)).orderBy(desc(agentDecisions.createdAt)),
  ]);

  // Compute individual stats
  const stats1 = computeComparisonEntry(agentId1, config1, decisions1);
  const stats2 = computeComparisonEntry(agentId2, config2, decisions2);

  // Head-to-head analysis (same round comparisons)
  const headToHead = computeHeadToHead(decisions1, decisions2);

  // Correlation coefficient between confidence levels
  const correlationCoefficient = computeCorrelation(decisions1, decisions2);

  // Divergence events (opposite trades on same symbol)
  const divergenceEvents = findDivergences(decisions1, decisions2);

  // Generate recommendation
  const recommendation = generateRecommendation(stats1, stats2);

  return {
    agent1: stats1,
    agent2: stats2,
    headToHead,
    correlationCoefficient,
    divergenceEvents: divergenceEvents.slice(0, 10),
    recommendation,
  };
}

/**
 * Get full arena overview with all 3 agents.
 */
export async function getArenaOverview(): Promise<ArenaOverview> {
  const configs = getAgentConfigs();

  // Fetch all decisions for all agents
  const allDecisions = await db
    .select()
    .from(agentDecisions)
    .orderBy(desc(agentDecisions.createdAt));

  // Fetch market data
  let marketData: MarketData[] = [];
  try {
    marketData = await getMarketData();
  } catch {
    // empty fallback
  }

  // Build rankings
  const rankings: ArenaRanking[] = [];
  for (const config of configs) {
    const agentDecisionsList = allDecisions.filter((d: typeof allDecisions[0]) => d.agentId === config.agentId);

    // Get portfolio
    let portfolio = { cashBalance: 10000, positions: [] as Array<{ currentPrice: number; quantity: number }>, totalValue: 10000, totalPnl: 0, totalPnlPercent: 0 };
    try {
      portfolio = await getPortfolioContext(config.agentId, marketData);
    } catch {
      // default
    }

    // Social score (reactions + comments)
    const decisionIds = agentDecisionsList.map((d: typeof agentDecisionsList[0]) => d.id);
    const socialMetrics = decisionIds.length > 0 ? await computeSocialMetrics(decisionIds) : { totalReactions: 0, totalComments: 0, bullishReactions: 0, bearishReactions: 0, avgReactionsPerDecision: 0, communityAgreement: 0 };
    const socialScore = socialMetrics.totalReactions + socialMetrics.totalComments * 2;

    // Win rate
    const buysSells = agentDecisionsList.filter((d: typeof agentDecisionsList[0]) => d.action !== "hold");
    const highConfidence = buysSells.filter((d: typeof buysSells[0]) => d.confidence >= HIGH_CONFIDENCE_THRESHOLD);
    const winRate = buysSells.length > 0 ? (highConfidence.length / buysSells.length) * 100 : 0;

    // Avg confidence
    const avgConf = averageByKey(agentDecisionsList, 'confidence');

    const lastDecision = agentDecisionsList[0];

    rankings.push({
      rank: 0,
      agentId: config.agentId,
      agentName: config.name,
      provider: config.provider,
      model: config.model,
      totalDecisions: agentDecisionsList.length,
      winRate: Math.round(winRate * 10) / 10,
      avgConfidence: Math.round(avgConf * 10) / 10,
      portfolioValue: portfolio.totalValue,
      totalPnl: portfolio.totalPnl,
      totalPnlPercent: portfolio.totalPnlPercent,
      riskTolerance: config.riskTolerance,
      tradingStyle: config.tradingStyle,
      lastAction: lastDecision?.action ?? null,
      lastSymbol: lastDecision?.symbol ?? null,
      lastTimestamp: lastDecision?.createdAt ?? null,
      socialScore,
    });
  }

  // Sort by portfolio value (highest first)
  const sortedRankings = [...rankings].sort((a, b) => b.portfolioValue - a.portfolioValue);
  sortedRankings.forEach((r, i) => { r.rank = i + 1; });

  // Market conditions
  const marketConditions = computeMarketConditions(marketData);

  // Recent activity (group by round)
  const recentActivity = buildRecentActivity(allDecisions.slice(0, 30));

  // Agreement rate (how often all 3 agents agree)
  const totalRounds = countTradingRounds(allDecisions);
  const agentAgreementRate = computeAgreementRate(allDecisions);

  // Most controversial stock
  const mostControversialStock = findMostControversialStock(allDecisions);

  // Next scheduled round (next 30-min mark)
  const nowMinutes = new Date().getMinutes();
  const nextMinute = nowMinutes < 30 ? 30 : 60;
  const nextRound = new Date();
  nextRound.setMinutes(nextMinute % 60);
  nextRound.setSeconds(0);
  nextRound.setMilliseconds(0);
  if (nextMinute === 60) nextRound.setHours(nextRound.getHours() + 1);

  return {
    rankings,
    totalRounds,
    totalDecisions: allDecisions.length,
    marketConditions,
    recentActivity: recentActivity.slice(0, 10),
    agentAgreementRate,
    mostControversialStock,
    nextScheduledRound: nextRound.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Computation Helpers
// ---------------------------------------------------------------------------

function computePerformance(
  decisions: Array<{ id: number; action: string; symbol: string; quantity: string; confidence: number; reasoning: string; createdAt: Date }>,
  portfolio: { totalPnl: number; totalPnlPercent: number },
): PerformanceMetrics {
  const total = decisions.length;
  const buys = decisions.filter((d) => d.action === "buy");
  const sells = decisions.filter((d) => d.action === "sell");
  const holds = decisions.filter((d) => d.action === "hold");

  // Win rate: decisions with confidence >= HIGH_CONFIDENCE_THRESHOLD that are buy/sell are "wins"
  const actionDecisions = decisions.filter((d) => d.action !== "hold");
  const highConfidence = actionDecisions.filter((d) => d.confidence >= HIGH_CONFIDENCE_THRESHOLD);
  const winRate = actionDecisions.length > 0 ? (highConfidence.length / actionDecisions.length) * 100 : 0;

  const avgConfidence = averageByKey(decisions, 'confidence');
  const winsConf = averageByKey(highConfidence, 'confidence');

  const losses = actionDecisions.filter((d) => d.confidence < HIGH_CONFIDENCE_THRESHOLD);
  const lossesConf = averageByKey(losses, 'confidence');

  // Best and worst decisions by confidence
  const sorted = [...decisions].sort((a, b) => b.confidence - a.confidence);
  const best = sorted[0] ?? null;
  const worst = sorted[sorted.length - 1] ?? null;

  // Profit factor (ratio of winning confidence to losing confidence)
  const totalWinConfidence = sumByKey(highConfidence, 'confidence');
  const totalLossConfidence = sumByKey(losses, 'confidence');
  const profitFactor = totalLossConfidence > 0 ? totalWinConfidence / totalLossConfidence : totalWinConfidence > 0 ? Infinity : 0;

  return {
    totalPnl: portfolio.totalPnl,
    totalPnlPercent: portfolio.totalPnlPercent,
    totalDecisions: total,
    buyCount: buys.length,
    sellCount: sells.length,
    holdCount: holds.length,
    winRate: Math.round(winRate * 10) / 10,
    avgConfidence: Math.round(avgConfidence * 10) / 10,
    avgConfidenceOnWins: Math.round(winsConf * 10) / 10,
    avgConfidenceOnLosses: Math.round(lossesConf * 10) / 10,
    bestDecision: best ? { id: best.id, action: best.action, symbol: best.symbol, confidence: best.confidence, reasoning: best.reasoning, timestamp: best.createdAt } : null,
    worstDecision: worst ? { id: worst.id, action: worst.action, symbol: worst.symbol, confidence: worst.confidence, reasoning: worst.reasoning, timestamp: worst.createdAt } : null,
    profitFactor: round2(profitFactor),
  };
}

function computeRiskMetrics(
  decisions: Array<{ confidence: number; action: string; quantity: string; symbol: string }>,
  portfolio: { totalPnl: number; totalPnlPercent: number; totalValue: number; positions: Array<{ currentPrice: number; quantity: number }> },
): RiskMetrics {
  // Use confidence values as a proxy for returns (since we have decision data, not price history)
  const actionDecisions = decisions.filter((d) => d.action !== "hold");
  const confidenceValues = actionDecisions.map((d) => d.confidence);

  // Normalize confidence to return-like values (-1 to 1)
  const returns = confidenceValues.map((c) => (c - 50) / 50);

  // Mean return
  const meanReturn = returns.length > 0 ? returns.reduce((s, r) => s + r, 0) / returns.length : 0;

  // Standard deviation (volatility)
  const variance = returns.length > 1
    ? returns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / (returns.length - 1)
    : 0;
  const volatility = Math.sqrt(variance);

  // Downside deviation (only negative returns)
  const negativeReturns = returns.filter((r) => r < 0);
  const downsideVariance = negativeReturns.length > 1
    ? negativeReturns.reduce((s, r) => s + r ** 2, 0) / negativeReturns.length
    : 0;
  const downsideDeviation = Math.sqrt(downsideVariance);

  // Sharpe ratio (annualized, assuming daily trading)
  const riskFreeRate = RISK_FREE_RATE_ANNUAL / TRADING_DAYS_PER_YEAR;
  const sharpeRatio = volatility > 0 ? ((meanReturn - riskFreeRate) / volatility) * Math.sqrt(TRADING_DAYS_PER_YEAR) : 0;

  // Sortino ratio
  const sortinoRatio = downsideDeviation > 0 ? ((meanReturn - riskFreeRate) / downsideDeviation) * Math.sqrt(TRADING_DAYS_PER_YEAR) : 0;

  // Max drawdown from confidence series
  let peak = 0;
  let maxDrawdown = 0;
  let cumulative = 0;
  for (const r of returns) {
    cumulative += r;
    if (cumulative > peak) peak = cumulative;
    const drawdown = peak - cumulative;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  // Calmar ratio
  const annualizedReturn = meanReturn * TRADING_DAYS_PER_YEAR;
  const calmarRatio = maxDrawdown > 0 ? annualizedReturn / maxDrawdown : 0;

  // Value at Risk (95th percentile)
  const sortedReturns = [...returns].sort((a, b) => a - b);
  const varIndex = Math.floor(returns.length * VAR_PERCENTILE_95);
  const valueAtRisk95 = sortedReturns[varIndex] ?? 0;

  // Position metrics
  const quantities = actionDecisions.map((d) => parseFloat(d.quantity) || 0);
  const avgPositionSize = calculateAverage(quantities);

  // Max position concentration
  const symbolCounts: Record<string, number> = {};
  for (const d of actionDecisions) {
    symbolCounts[d.symbol] = (symbolCounts[d.symbol] || 0) + 1;
  }
  const maxSymbolCount = Math.max(0, ...Object.values(symbolCounts));
  const maxPositionConcentration = actionDecisions.length > 0
    ? (maxSymbolCount / actionDecisions.length) * 100
    : 0;

  return {
    sharpeRatio: round2(sharpeRatio),
    maxDrawdown: Math.round(maxDrawdown * 10000) / 10000,
    maxDrawdownPercent: Math.round(maxDrawdown * 10000) / 100,
    volatility: Math.round(volatility * 10000) / 10000,
    downsideDeviation: Math.round(downsideDeviation * 10000) / 10000,
    sortinoRatio: round2(sortinoRatio),
    calmarRatio: round2(calmarRatio),
    valueAtRisk95: Math.round(valueAtRisk95 * 10000) / 10000,
    avgPositionSize: round2(avgPositionSize),
    maxPositionConcentration: Math.round(maxPositionConcentration * 10) / 10,
  };
}

function computeTradingPatterns(
  decisions: Array<{ action: string; symbol: string; confidence: number; createdAt: Date }>,
): TradingPatterns {
  if (decisions.length === 0) {
    return {
      avgDecisionsPerDay: 0,
      mostTradedSymbol: null,
      mostTradedSymbolCount: 0,
      leastTradedSymbol: null,
      preferredAction: "hold",
      avgHoldDuration: 0,
      tradeFrequency: "low",
      confidenceDistribution: { low: 0, medium: 0, high: 0 },
      symbolDiversity: 0,
      reversalRate: 0,
    };
  }

  // Time span
  const oldest = decisions[decisions.length - 1].createdAt;
  const newest = decisions[0].createdAt;
  const daySpan = Math.max(1, (newest.getTime() - oldest.getTime()) / (24 * 60 * 60 * 1000));
  const avgDecisionsPerDay = decisions.length / daySpan;

  // Symbol frequency
  const symbolCounts: Record<string, number> = {};
  const actionDecisions = decisions.filter((d) => d.action !== "hold");
  for (const d of actionDecisions) {
    symbolCounts[d.symbol] = (symbolCounts[d.symbol] || 0) + 1;
  }
  const sortedSymbols = sortEntriesDescending(symbolCounts);
  const mostTradedSymbol = sortedSymbols[0]?.[0] ?? null;
  const mostTradedSymbolCount = sortedSymbols[0]?.[1] ?? 0;
  const leastTradedSymbol = sortedSymbols[sortedSymbols.length - 1]?.[0] ?? null;

  // Preferred action
  const actionCounts = { buy: 0, sell: 0, hold: 0 };
  for (const d of decisions) {
    actionCounts[d.action as keyof typeof actionCounts]++;
  }
  const preferredAction = (getTopKey(actionCounts) ?? "hold") as "buy" | "sell" | "hold";

  // Trade frequency
  const tradeFrequency: "high" | "medium" | "low" =
    avgDecisionsPerDay > TRADE_FREQUENCY_HIGH_THRESHOLD ? "high" : avgDecisionsPerDay > TRADE_FREQUENCY_MEDIUM_THRESHOLD ? "medium" : "low";

  // Confidence distribution
  const low = countByCondition(decisions, (d) => d.confidence < CONFIDENCE_LOW_THRESHOLD);
  const medium = countByCondition(decisions, (d) => d.confidence >= CONFIDENCE_LOW_THRESHOLD && d.confidence < CONFIDENCE_HIGH_THRESHOLD);
  const high = countByCondition(decisions, (d) => d.confidence >= CONFIDENCE_HIGH_THRESHOLD);

  // Symbol diversity (unique symbols / total decisions)
  const uniqueSymbols = new Set(actionDecisions.map((d) => d.symbol));
  const symbolDiversity = actionDecisions.length > 0
    ? (uniqueSymbols.size / actionDecisions.length) * 100
    : 0;

  // Reversal rate (how often consecutive decisions switch buy<->sell)
  let reversals = 0;
  for (let i = 1; i < decisions.length; i++) {
    const prev = decisions[i].action;
    const curr = decisions[i - 1].action;
    if ((prev === "buy" && curr === "sell") || (prev === "sell" && curr === "buy")) {
      reversals++;
    }
  }
  const reversalRate = decisions.length > 1 ? (reversals / (decisions.length - 1)) * 100 : 0;

  // Avg hold duration: average time between consecutive decisions
  let totalGapMs = 0;
  let gaps = 0;
  for (let i = 1; i < decisions.length; i++) {
    totalGapMs += decisions[i - 1].createdAt.getTime() - decisions[i].createdAt.getTime();
    gaps++;
  }
  const avgHoldDuration = gaps > 0 ? totalGapMs / gaps / (60 * 60 * 1000) : 0;

  return {
    avgDecisionsPerDay: Math.round(avgDecisionsPerDay * 10) / 10,
    mostTradedSymbol,
    mostTradedSymbolCount,
    leastTradedSymbol,
    preferredAction,
    avgHoldDuration: Math.round(avgHoldDuration * 10) / 10,
    tradeFrequency,
    confidenceDistribution: { low, medium, high },
    symbolDiversity: Math.round(symbolDiversity * 10) / 10,
    reversalRate: Math.round(reversalRate * 10) / 10,
  };
}

function computeSectorAllocation(
  decisions: Array<{ action: string; symbol: string }>,
): SectorAllocation[] {
  const actionDecisions = decisions.filter((d) => d.action !== "hold");

  const sectorMap = groupAndAggregate(
    actionDecisions,
    (d) => SECTOR_MAP[d.symbol] ?? "Other",
    () => ({ symbols: new Set<string>(), count: 0 }),
    (agg, d) => {
      agg.symbols.add(d.symbol);
      agg.count++;
      return agg;
    },
  );

  const total = actionDecisions.length || 1;
  const sectorData = Object.entries(sectorMap).map(([sector, data]) => ({
    sector,
    symbols: Array.from(data.symbols),
    tradeCount: data.count,
    allocation: Math.round((data.count / total) * 1000) / 10,
  }));
  return sortByDescending(sectorData, "tradeCount");
}

function computeStreaks(
  decisions: Array<{ action: string; confidence: number }>,
): StreakAnalysis {
  if (decisions.length === 0) {
    return {
      currentStreak: { type: "hold", length: 0 },
      longestWinStreak: 0,
      longestLossStreak: 0,
      longestHoldStreak: 0,
      avgWinStreakLength: 0,
      avgLossStreakLength: 0,
    };
  }

  // Reverse to chronological order
  const chrono = [...decisions].reverse();

  type StreakType = "win" | "loss" | "hold";
  const streaks: Array<{ type: StreakType; length: number }> = [];
  let currentType: StreakType | null = null;
  let currentLength = 0;

  for (const d of chrono) {
    let type: StreakType;
    if (d.action === "hold") {
      type = "hold";
    } else if (d.confidence >= 50) {
      type = "win";
    } else {
      type = "loss";
    }

    if (type === currentType) {
      currentLength++;
    } else {
      if (currentType !== null) {
        streaks.push({ type: currentType, length: currentLength });
      }
      currentType = type;
      currentLength = 1;
    }
  }
  if (currentType !== null) {
    streaks.push({ type: currentType, length: currentLength });
  }

  const winStreaks = streaks.filter((s) => s.type === "win");
  const lossStreaks = streaks.filter((s) => s.type === "loss");
  const holdStreaks = streaks.filter((s) => s.type === "hold");

  return {
    currentStreak: streaks[streaks.length - 1] ?? { type: "hold", length: 0 },
    longestWinStreak: findMax(winStreaks, 'length')?.length ?? 0,
    longestLossStreak: findMax(lossStreaks, 'length')?.length ?? 0,
    longestHoldStreak: findMax(holdStreaks, 'length')?.length ?? 0,
    avgWinStreakLength: Math.round(averageByKey(winStreaks, 'length') * 10) / 10,
    avgLossStreakLength: Math.round(averageByKey(lossStreaks, 'length') * 10) / 10,
  };
}

function computeSentimentProfile(
  decisions: Array<{ action: string; confidence: number; symbol: string }>,
  marketData: MarketData[],
): SentimentProfile {
  const actionDecisions = decisions.filter((d) => d.action !== "hold");
  const buyCount = countByCondition(decisions, (d) => d.action === "buy");
  const sellCount = countByCondition(decisions, (d) => d.action === "sell");
  const total = actionDecisions.length || 1;

  const bullishPct = (buyCount / total) * 100;
  const bearishPct = (sellCount / total) * 100;

  const overallSentiment: "bullish" | "bearish" | "neutral" =
    bullishPct > SENTIMENT_BULLISH_THRESHOLD ? "bullish" : bearishPct > SENTIMENT_BULLISH_THRESHOLD ? "bearish" : "neutral";

  // Sentiment consistency: how clustered are confidence values
  const avgConf = actionDecisions.length > 0 ? averageByKey(actionDecisions, 'confidence') : 50;
  const confVariance = actionDecisions.length > 1
    ? actionDecisions.reduce((s, d) => s + (d.confidence - avgConf) ** 2, 0) / actionDecisions.length
    : 0;
  const sentimentConsistency = 100 - Math.min(100, Math.sqrt(confVariance));

  // Contrarianism: buying when market is down, selling when up
  let contrarianCount = 0;
  for (const d of actionDecisions) {
    const stock = marketData.find((m) => m.symbol === d.symbol);
    if (!stock || stock.change24h === null) continue;
    if ((d.action === "buy" && stock.change24h < 0) || (d.action === "sell" && stock.change24h > 0)) {
      contrarianCount++;
    }
  }
  const contrarianism = actionDecisions.length > 0
    ? (contrarianCount / actionDecisions.length) * 100
    : 0;

  return {
    overallSentiment,
    bullishPercentage: Math.round(bullishPct * 10) / 10,
    bearishPercentage: Math.round(bearishPct * 10) / 10,
    sentimentConsistency: Math.round(sentimentConsistency * 10) / 10,
    contrarianism: Math.round(contrarianism * 10) / 10,
  };
}

function computeHourlyActivity(
  decisions: Array<{ createdAt: Date; confidence: number }>,
): HourlyActivity[] {
  const hourMap = groupAndAggregate(
    decisions,
    (d) => String(d.createdAt.getHours()),
    () => ({ count: 0, totalConf: 0 }),
    (agg, d) => ({
      count: agg.count + 1,
      totalConf: agg.totalConf + d.confidence,
    }),
  );

  return Array.from({ length: 24 }, (_, hour) => {
    const entry = hourMap[hour];
    return {
      hour,
      decisions: entry?.count ?? 0,
      avgConfidence: entry && entry.count > 0
        ? Math.round((entry.totalConf / entry.count) * 10) / 10
        : 0,
    };
  });
}

async function computeSocialMetrics(decisionIds: number[]): Promise<SocialMetrics> {
  if (decisionIds.length === 0) {
    return {
      totalReactions: 0,
      bullishReactions: 0,
      bearishReactions: 0,
      totalComments: 0,
      avgReactionsPerDecision: 0,
      communityAgreement: 0,
    };
  }

  let bullishReactions = 0;
  let bearishReactions = 0;
  let totalComments = 0;

  try {
    const reactions = await db
      .select({
        reaction: tradeReactions.reaction,
        count: sql<number>`count(*)`,
      })
      .from(tradeReactions)
      .where(inArray(tradeReactions.decisionId, decisionIds))
      .groupBy(tradeReactions.reaction);

    for (const r of reactions) {
      if (r.reaction === "bullish") bullishReactions = Number(r.count);
      if (r.reaction === "bearish") bearishReactions = Number(r.count);
    }
  } catch {
    // table might not exist
  }

  try {
    const comments = await db
      .select({ count: sql<number>`count(*)` })
      .from(tradeComments)
      .where(inArray(tradeComments.decisionId, decisionIds));

    totalComments = Number(comments[0]?.count ?? 0);
  } catch {
    // table might not exist
  }

  const totalReactions = bullishReactions + bearishReactions;
  const avgReactionsPerDecision = decisionIds.length > 0 ? totalReactions / decisionIds.length : 0;
  const communityAgreement = totalReactions > 0 ? (bullishReactions / totalReactions) * 100 : 50;

  return {
    totalReactions,
    bullishReactions,
    bearishReactions,
    totalComments,
    avgReactionsPerDecision: round2(avgReactionsPerDecision),
    communityAgreement: Math.round(communityAgreement * 10) / 10,
  };
}

async function getRecentHighlights(agentId: string, limit: number): Promise<TradeHighlight[]> {
  const decisions = await db
    .select()
    .from(agentDecisions)
    .where(eq(agentDecisions.agentId, agentId))
    .orderBy(desc(agentDecisions.confidence))
    .limit(limit);

  const highlights: TradeHighlight[] = [];
  for (const d of decisions) {
    let reactions = { bullish: 0, bearish: 0 };
    try {
      const reactionData = await db
        .select({
          reaction: tradeReactions.reaction,
          count: sql<number>`count(*)`,
        })
        .from(tradeReactions)
        .where(eq(tradeReactions.decisionId, d.id))
        .groupBy(tradeReactions.reaction);

      for (const r of reactionData) {
        if (r.reaction === "bullish") reactions.bullish = Number(r.count);
        if (r.reaction === "bearish") reactions.bearish = Number(r.count);
      }
    } catch {
      // ignore
    }

    highlights.push({
      id: d.id,
      action: d.action,
      symbol: d.symbol,
      confidence: d.confidence,
      reasoning: d.reasoning,
      timestamp: d.createdAt,
      reactions,
    });
  }

  return highlights;
}

// ---------------------------------------------------------------------------
// Comparison Helpers
// ---------------------------------------------------------------------------

function computeComparisonEntry(
  agentId: string,
  config: ReturnType<typeof getAgentConfig> & {},
  decisions: Array<{ action: string; confidence: number; symbol: string }>,
): AgentComparisonEntry {
  const actionDecisions = decisions.filter((d) => d.action !== "hold");
  const highConf = actionDecisions.filter((d) => d.confidence >= 50);
  const winRate = actionDecisions.length > 0 ? (highConf.length / actionDecisions.length) * 100 : 0;

  const avgConf = decisions.length > 0
    ? decisions.reduce((s, d) => s + d.confidence, 0) / decisions.length
    : 0;

  // Simple Sharpe from confidence
  const returns = actionDecisions.map((d) => (d.confidence - 50) / 50);
  const mean = returns.length > 0 ? returns.reduce((s, r) => s + r, 0) / returns.length : 0;
  const variance = returns.length > 1
    ? returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1)
    : 0;
  const vol = Math.sqrt(variance);
  const sharpe = vol > 0 ? (mean / vol) * Math.sqrt(252) : 0;

  // Max drawdown
  let peak = 0;
  let maxDD = 0;
  let cum = 0;
  for (const r of returns) {
    cum += r;
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > maxDD) maxDD = dd;
  }

  // Favorite stock
  const symbolCounts: Record<string, number> = {};
  for (const d of actionDecisions) {
    symbolCounts[d.symbol] = (symbolCounts[d.symbol] || 0) + 1;
  }
  const favoriteStock = getTopKey(symbolCounts) ?? null;

  return {
    agentId,
    agentName: config.name,
    provider: config.provider,
    totalDecisions: decisions.length,
    winRate: Math.round(winRate * 10) / 10,
    avgConfidence: Math.round(avgConf * 10) / 10,
    sharpeRatio: round2(sharpe),
    maxDrawdown: Math.round(maxDD * 10000) / 10000,
    favoriteStock,
    riskTolerance: config.riskTolerance,
  };
}

function computeHeadToHead(
  decisions1: Array<{ roundId: string | null; action: string; symbol: string; confidence: number; createdAt: Date }>,
  decisions2: Array<{ roundId: string | null; action: string; symbol: string; confidence: number; createdAt: Date }>,
): HeadToHeadStats {
  // Match by round ID
  const withRoundId1 = decisions1.filter((d) => d.roundId !== null) as Array<typeof decisions1[0] & { roundId: string }>;
  const withRoundId2 = decisions2.filter((d) => d.roundId !== null) as Array<typeof decisions2[0] & { roundId: string }>;

  const rounds1 = indexBy(withRoundId1, "roundId");
  const rounds2 = indexBy(withRoundId2, "roundId");

  let sameDecisionCount = 0;
  let oppositeDecisionCount = 0;
  let agent1Wins = 0;
  let agent2Wins = 0;

  for (const [roundId, d1] of Object.entries(rounds1)) {
    const d2 = rounds2[roundId];
    if (!d2) continue;

    if (d1.action === d2.action) {
      sameDecisionCount++;
    }
    if ((d1.action === "buy" && d2.action === "sell") || (d1.action === "sell" && d2.action === "buy")) {
      oppositeDecisionCount++;
    }
    if (d1.confidence > d2.confidence) agent1Wins++;
    if (d2.confidence > d1.confidence) agent2Wins++;
  }

  const totalShared = sameDecisionCount + oppositeDecisionCount;
  const agreementRate = totalShared > 0 ? (sameDecisionCount / totalShared) * 100 : 0;

  // Symbol overlap
  const symbols1 = new Set(decisions1.filter((d) => d.action !== "hold").map((d) => d.symbol));
  const symbols2 = new Set(decisions2.filter((d) => d.action !== "hold").map((d) => d.symbol));
  const overlap = Array.from(symbols1).filter((s) => symbols2.has(s));

  return {
    sameDecisionCount,
    oppositeDecisionCount,
    agreementRate: Math.round(agreementRate * 10) / 10,
    symbolOverlap: overlap,
    agent1WinsCount: agent1Wins,
    agent2WinsCount: agent2Wins,
  };
}

function computeCorrelation(
  decisions1: Array<{ roundId: string | null; confidence: number }>,
  decisions2: Array<{ roundId: string | null; confidence: number }>,
): number {
  // Match by round ID
  const pairs: Array<[number, number]> = [];
  const map1 = new Map<string, number>();
  for (const d of decisions1) {
    if (d.roundId) map1.set(d.roundId, d.confidence);
  }
  for (const d of decisions2) {
    if (d.roundId) {
      const c1 = map1.get(d.roundId);
      if (c1 !== undefined) pairs.push([c1, d.confidence]);
    }
  }

  if (pairs.length < 3) return 0;

  const n = pairs.length;
  const sum1 = pairs.reduce((s, [a]) => s + a, 0);
  const sum2 = pairs.reduce((s, [, b]) => s + b, 0);
  const sum1sq = pairs.reduce((s, [a]) => s + a * a, 0);
  const sum2sq = pairs.reduce((s, [, b]) => s + b * b, 0);
  const psum = pairs.reduce((s, [a, b]) => s + a * b, 0);

  const num = psum - (sum1 * sum2) / n;
  const den = Math.sqrt((sum1sq - (sum1 * sum1) / n) * (sum2sq - (sum2 * sum2) / n));

  return den === 0 ? 0 : round3(num / den);
}

function findDivergences(
  decisions1: Array<{ roundId: string | null; action: string; symbol: string; confidence: number; createdAt: Date }>,
  decisions2: Array<{ roundId: string | null; action: string; symbol: string; confidence: number; createdAt: Date }>,
): DivergenceEvent[] {
  const map2 = new Map<string, (typeof decisions2)[0]>();
  for (const d of decisions2) {
    if (d.roundId) map2.set(d.roundId, d);
  }

  const divergences: DivergenceEvent[] = [];
  for (const d1 of decisions1) {
    if (!d1.roundId) continue;
    const d2 = map2.get(d1.roundId);
    if (!d2) continue;

    if ((d1.action === "buy" && d2.action === "sell") || (d1.action === "sell" && d2.action === "buy")) {
      divergences.push({
        roundId: d1.roundId,
        timestamp: d1.createdAt,
        symbol: d1.symbol !== d2.symbol ? `${d1.symbol}/${d2.symbol}` : d1.symbol,
        agent1Action: d1.action,
        agent2Action: d2.action,
        agent1Confidence: d1.confidence,
        agent2Confidence: d2.confidence,
      });
    }
  }

  return divergences.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
}

function generateRecommendation(
  stats1: AgentComparisonEntry,
  stats2: AgentComparisonEntry,
): string {
  const metrics = [
    { name: "win rate", winner: stats1.winRate > stats2.winRate ? 1 : 2, diff: Math.abs(stats1.winRate - stats2.winRate) },
    { name: "confidence", winner: stats1.avgConfidence > stats2.avgConfidence ? 1 : 2, diff: Math.abs(stats1.avgConfidence - stats2.avgConfidence) },
    { name: "Sharpe ratio", winner: stats1.sharpeRatio > stats2.sharpeRatio ? 1 : 2, diff: Math.abs(stats1.sharpeRatio - stats2.sharpeRatio) },
  ];

  const agent1Wins = countByCondition(metrics, (m) => m.winner === 1);
  const agent2Wins = countByCondition(metrics, (m) => m.winner === 2);

  if (agent1Wins > agent2Wins) {
    return `${stats1.agentName} leads in ${agent1Wins}/3 key metrics. Its ${stats1.riskTolerance} strategy and ${stats1.provider} backend give it an edge in the current market conditions.`;
  } else if (agent2Wins > agent1Wins) {
    return `${stats2.agentName} leads in ${agent2Wins}/3 key metrics. Its ${stats2.riskTolerance} strategy and ${stats2.provider} backend give it an edge in the current market conditions.`;
  }
  return `Both agents are closely matched. ${stats1.agentName} excels in raw confidence while ${stats2.agentName} shows stronger risk-adjusted returns.`;
}

// ---------------------------------------------------------------------------
// Arena Helpers
// ---------------------------------------------------------------------------

function computeMarketConditions(marketData: MarketData[]): MarketConditions {
  if (marketData.length === 0) {
    return { avgChange24h: 0, topGainer: null, topLoser: null, overallSentiment: "neutral", volatility: "low", stockCount: 0 };
  }

  const withChange = marketData.filter((m) => m.change24h !== null);
  const avgChange = withChange.length > 0
    ? withChange.reduce((s, m) => s + (m.change24h ?? 0), 0) / withChange.length
    : 0;

  const sorted = [...withChange].sort((a, b) => (b.change24h ?? 0) - (a.change24h ?? 0));
  const topGainer = sorted[0] ? { symbol: sorted[0].symbol, change: sorted[0].change24h ?? 0 } : null;
  const topLoser = sorted[sorted.length - 1] ? { symbol: sorted[sorted.length - 1].symbol, change: sorted[sorted.length - 1].change24h ?? 0 } : null;

  const overallSentiment: "bullish" | "bearish" | "neutral" =
    avgChange > MARKET_BULLISH_THRESHOLD ? "bullish" : avgChange < MARKET_BEARISH_THRESHOLD ? "bearish" : "neutral";

  const absChanges = withChange.map((m) => Math.abs(m.change24h ?? 0));
  const avgAbsChange = absChanges.length > 0 ? absChanges.reduce((s, c) => s + c, 0) / absChanges.length : 0;
  const volatility: "high" | "medium" | "low" = avgAbsChange > VOLATILITY_HIGH_THRESHOLD ? "high" : avgAbsChange > VOLATILITY_MEDIUM_THRESHOLD ? "medium" : "low";

  return {
    avgChange24h: round2(avgChange),
    topGainer,
    topLoser,
    overallSentiment,
    volatility,
    stockCount: marketData.length,
  };
}

function buildRecentActivity(
  decisions: Array<{ id: number; agentId: string; action: string; symbol: string; confidence: number; roundId: string | null; createdAt: Date }>,
): RecentArenaActivity[] {
  const roundMap = new Map<string, RecentArenaActivity>();

  for (const d of decisions) {
    const key = d.roundId ?? `solo_${d.id}`;
    const entry = roundMap.get(key) ?? { roundId: d.roundId, timestamp: d.createdAt, decisions: [] };
    const config = getAgentConfig(d.agentId);
    entry.decisions.push({
      agentId: d.agentId,
      agentName: config?.name ?? d.agentId,
      action: d.action,
      symbol: d.symbol,
      confidence: d.confidence,
    });
    roundMap.set(key, entry);
  }

  return Array.from(roundMap.values())
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
}

function countTradingRounds(
  decisions: Array<{ roundId: string | null }>,
): number {
  const rounds = new Set(decisions.filter((d) => d.roundId).map((d) => d.roundId));
  return rounds.size;
}

function computeAgreementRate(
  decisions: Array<{ agentId: string; action: string; roundId: string | null }>,
): number {
  const roundDecisions = new Map<string, string[]>();

  for (const d of decisions) {
    if (!d.roundId) continue;
    const actions = roundDecisions.get(d.roundId) ?? [];
    actions.push(d.action);
    roundDecisions.set(d.roundId, actions);
  }

  let agreementCount = 0;
  let totalRounds = 0;
  for (const [, actions] of roundDecisions) {
    if (actions.length >= 2) {
      totalRounds++;
      if (actions.every((a) => a === actions[0])) {
        agreementCount++;
      }
    }
  }

  return totalRounds > 0 ? Math.round((agreementCount / totalRounds) * 1000) / 10 : 0;
}

function findMostControversialStock(
  decisions: Array<{ symbol: string; action: string; roundId: string | null }>,
): string | null {
  // Find stocks where agents most often disagree
  const symbolDisagreements = new Map<string, number>();

  const byRound = new Map<string, Array<{ symbol: string; action: string }>>();
  for (const d of decisions) {
    if (!d.roundId) continue;
    const arr = byRound.get(d.roundId) ?? [];
    arr.push({ symbol: d.symbol, action: d.action });
    byRound.set(d.roundId, arr);
  }

  for (const [, roundDecs] of byRound) {
    const symbols = roundDecs.map((d) => d.symbol);
    for (const symbol of symbols) {
      const symbolActions = roundDecs.filter((d) => d.symbol === symbol).map((d) => d.action);
      if (symbolActions.length >= 2 && new Set(symbolActions).size > 1) {
        symbolDisagreements.set(symbol, (symbolDisagreements.get(symbol) ?? 0) + 1);
      }
    }
  }

  if (symbolDisagreements.size === 0) return null;
  return Array.from(symbolDisagreements.entries()).sort(([, a], [, b]) => b - a)[0]?.[0] ?? null;
}
