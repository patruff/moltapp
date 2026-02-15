/**
 * Whale Tracker Service
 *
 * Monitors large position changes by AI trading agents, detects unusual
 * trading patterns, generates alerts for significant moves, and provides
 * conviction tracking for high-confidence trades.
 *
 * Features:
 * - Large position change detection
 * - Unusual volume / conviction spike alerts
 * - Agent conviction tracker (high-confidence trade monitoring)
 * - Smart money flow analysis
 * - Position size anomaly detection
 * - Cross-agent convergence alerts
 */

import { db } from "../db/index.ts";
import { agentDecisions } from "../db/schema/agent-decisions.ts";
import { eq, desc, sql, and, gte } from "drizzle-orm";
import { getAgentConfigs, getAgentConfig, getMarketData } from "../agents/orchestrator.ts";
import type { MarketData } from "../agents/base-agent.ts";
import { getTopKey, weightedSumByKey } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Conviction Spike Detection Thresholds
 *
 * Controls when high-confidence trades trigger whale alerts based on conviction level.
 */

/**
 * Minimum confidence threshold to trigger conviction spike alert.
 * Trades at or above this level show exceptionally high agent conviction.
 */
const CONVICTION_SPIKE_THRESHOLD = 85;

/**
 * Critical conviction threshold for maximum severity alerts.
 * Trades at or above this level represent extreme conviction (top 1-2% of decisions).
 */
const CONVICTION_CRITICAL_THRESHOLD = 95;

/**
 * Position Size Multipliers
 *
 * Thresholds for detecting abnormally large position sizes relative to agent's baseline.
 */

/**
 * Position size multiplier threshold for "large position" alerts.
 * Triggers when trade size exceeds agent's average position size by this factor.
 * Example: 2× means trade is double the typical size for this agent.
 */
const POSITION_SIZE_LARGE_MULTIPLIER = 2;

/**
 * Position size multiplier threshold for "critical" large position severity.
 * Trades 5× larger than baseline represent outsized bets requiring maximum attention.
 */
const POSITION_SIZE_CRITICAL_MULTIPLIER = 5;

/**
 * Cross-Agent Convergence Thresholds
 *
 * Detects when multiple agents independently agree on the same action for a stock.
 */

/**
 * Minimum number of agents required to trigger convergence alert.
 * When 2+ agents agree on same stock + action, it signals potential consensus trade.
 */
const CONVERGENCE_MIN_AGENTS = 2;

/**
 * Number of agents for critical convergence severity.
 * When 3+ agents converge, it represents strong cross-strategy alignment.
 */
const CONVERGENCE_CRITICAL_AGENTS = 3;

/**
 * Accumulation/Distribution Pattern Detection
 *
 * Identifies systematic buying or selling patterns over time for a single agent+symbol.
 */

/**
 * Minimum number of trades required to classify as accumulation/distribution pattern.
 * Prevents false positives from single trades or temporary fluctuations.
 */
const ACCUMULATION_MIN_TRADES = 3;

/**
 * Threshold for classifying directional bias in trading pattern.
 * When 75%+ of trades are buys → accumulation, 75%+ sells → distribution.
 */
const ACCUMULATION_DIRECTION_THRESHOLD = 0.75;

/**
 * Smart Money Flow Analysis
 *
 * Parameters for analyzing net capital flows into/out of stocks and sectors.
 */

/**
 * Default time window for smart money flow analysis (hours).
 * 168 hours = 7 days of trading activity.
 */
const SMART_MONEY_FLOW_DEFAULT_HOURS = 168;

/**
 * Default time window for whale alerts (hours).
 * 24 hours = recent activity only.
 */
const WHALE_ALERTS_DEFAULT_HOURS = 24;

/**
 * Net flow threshold for classifying inflow/outflow direction.
 * |netFlow| > 50 = meaningful flow, < 50 = neutral.
 */
const FLOW_DIRECTION_THRESHOLD = 50;

/**
 * Net flow threshold for aggregate flow classification.
 * |netFlow| > 100 = strong directional flow, < 100 = balanced.
 */
const AGGREGATE_FLOW_THRESHOLD = 100;

/**
 * Maximum number of alerts to return in whale activity summary.
 * Prevents overwhelming users with excessive alerts.
 */
const ALERTS_DISPLAY_LIMIT = 50;

/**
 * Maximum number of decisions to fetch for baseline calculations.
 * Provides statistical significance for agent behavior baselines.
 */
const BASELINE_DECISIONS_LIMIT = 1000;

/**
 * Maximum number of recent decisions to fetch for alert scanning.
 * Limits query size while capturing sufficient recent activity.
 */
const RECENT_DECISIONS_LIMIT = 500;

/**
 * Conviction Interpretation Thresholds
 *
 * Classifies overall market conviction levels based on average agent confidence.
 */

/**
 * High conviction threshold (>75%).
 * Markets showing strong agent confidence — watch for crowded trades.
 */
const CONVICTION_HIGH_THRESHOLD = 75;

/**
 * Moderate conviction threshold (>60%).
 * Reasonable confidence but no extreme certainty.
 */
const CONVICTION_MODERATE_THRESHOLD = 60;

/**
 * Low conviction threshold (>45%).
 * Agents uncertain — expect more holds and smaller sizes.
 */
const CONVICTION_LOW_THRESHOLD = 45;

/**
 * Conviction Trend Detection
 *
 * Parameters for detecting changes in agent conviction over time.
 */

/**
 * Minimum confidence point change to classify conviction trend as increasing/decreasing.
 * Changes < 3 points are considered stable (normal variation).
 */
const CONVICTION_TREND_THRESHOLD = 3;

/**
 * Activity Level Classification
 *
 * Thresholds for classifying overall whale alert activity intensity.
 */

/**
 * Maximum alerts for "quiet" activity level.
 * ≤2 alerts = minimal whale activity.
 */
const ACTIVITY_QUIET_MAX = 2;

/**
 * Maximum alerts for "moderate" activity level.
 * 3-5 alerts = normal whale activity.
 */
const ACTIVITY_MODERATE_MAX = 5;

/**
 * Maximum alerts for "elevated" activity level.
 * 6-10 alerts = heightened whale activity.
 */
const ACTIVITY_ELEVATED_MAX = 10;

/**
 * Smart Money Flow Direction Multiplier
 *
 * Determines when bullish/bearish flow is strong enough to classify vs neutral.
 */

/**
 * Multiplier for classifying strong directional flow.
 * Bullish if netBullish > netBearish × 1.2, bearish if netBearish > netBullish × 1.2.
 */
const FLOW_STRENGTH_MULTIPLIER = 1.2;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Database agent decision type inferred from schema */
type AgentDecision = typeof agentDecisions.$inferSelect;

export interface WhaleAlert {
  id: string;
  type: "large_position" | "conviction_spike" | "unusual_volume" | "convergence" | "reversal" | "accumulation" | "distribution";
  severity: "info" | "notable" | "significant" | "critical";
  agentId: string;
  agentName: string;
  provider: string;
  symbol: string;
  action: string;
  quantity: number;
  confidence: number;
  reasoning: string;
  timestamp: string;
  details: string;
  marketContext: {
    currentPrice: number;
    change24h: number | null;
  } | null;
}

export interface WhaleActivity {
  alerts: WhaleAlert[];
  alertsByType: Record<string, number>;
  alertsBySeverity: Record<string, number>;
  mostActiveWhale: { agentId: string; agentName: string; alertCount: number } | null;
  mostTargetedStock: { symbol: string; alertCount: number } | null;
  overallActivity: "quiet" | "moderate" | "elevated" | "intense";
  smartMoneyFlow: {
    netBullish: number;
    netBearish: number;
    flowDirection: string;
    topBullishSymbol: string | null;
    topBearishSymbol: string | null;
  };
  summary: string;
}

export interface ConvictionTracker {
  highConvictionTrades: Array<{
    agentId: string;
    agentName: string;
    provider: string;
    symbol: string;
    action: string;
    confidence: number;
    reasoning: string;
    timestamp: string;
    priceAtDecision: number | null;
  }>;
  avgConvictionByAgent: Array<{
    agentId: string;
    agentName: string;
    avgConfidence: number;
    highConvictionCount: number;
    totalDecisions: number;
    highConvictionRate: number;
    trend: string;
  }>;
  convictionBySymbol: Array<{
    symbol: string;
    avgConfidence: number;
    tradeCount: number;
    direction: string;
  }>;
  overallConviction: number;
  interpretation: string;
}

export interface PositionHeatmap {
  cells: Array<{
    agentId: string;
    agentName: string;
    symbol: string;
    intensity: number;
    action: string;
    confidence: number;
    tradeCount: number;
  }>;
  agents: string[];
  symbols: string[];
  hottestCell: { agentId: string; symbol: string; intensity: number } | null;
  coldestCell: { agentId: string; symbol: string; intensity: number } | null;
}

export interface SmartMoneyFlow {
  period: string;
  flows: Array<{
    symbol: string;
    name: string;
    netFlow: number;
    buyVolume: number;
    sellVolume: number;
    flowDirection: "inflow" | "outflow" | "neutral";
    agentBreakdown: Array<{
      agentId: string;
      agentName: string;
      action: string;
      confidence: number;
    }>;
    conviction: number;
  }>;
  sectorFlows: Array<{
    sector: string;
    netFlow: number;
    direction: string;
    topSymbol: string;
  }>;
  aggregateFlow: {
    totalInflow: number;
    totalOutflow: number;
    netFlow: number;
    direction: string;
    strength: number;
  };
  narrative: string;
}

// ---------------------------------------------------------------------------
// Sector mapping
// ---------------------------------------------------------------------------

const SECTOR_MAP: Record<string, string> = {
  AAPLx: "Tech", MSFTx: "Tech", GOOGLx: "Tech", METAx: "Tech",
  NVDAx: "Tech", AVGOx: "Tech", CRMx: "Tech", PLTRx: "Tech", NFLXx: "Tech",
  COINx: "Crypto", MSTRx: "Crypto", HOODx: "Crypto",
  SPYx: "Index", QQQx: "Index",
  GMEx: "Meme", TSLAx: "Meme",
  LLYx: "Healthcare", CRCLx: "Fintech", JPMx: "Finance",
};

// ---------------------------------------------------------------------------
// Whale Alert Detection
// ---------------------------------------------------------------------------

/**
 * Scan recent agent decisions for whale-level moves and generate alerts.
 */
export async function getWhaleAlerts(hours = WHALE_ALERTS_DEFAULT_HOURS): Promise<WhaleActivity> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  // Get all recent decisions
  const decisions = await db
    .select()
    .from(agentDecisions)
    .where(gte(agentDecisions.createdAt, since))
    .orderBy(desc(agentDecisions.createdAt))
    .limit(RECENT_DECISIONS_LIMIT);

  // Also get older decisions for comparison
  const olderDecisions = await db
    .select()
    .from(agentDecisions)
    .orderBy(desc(agentDecisions.createdAt))
    .limit(BASELINE_DECISIONS_LIMIT);

  // Get market data for context
  let marketData: MarketData[];
  try {
    marketData = await getMarketData();
  } catch {
    marketData = [];
  }

  const alerts: WhaleAlert[] = [];
  let alertCounter = 0;

  // Calculate baselines per agent
  const agentBaselines: Record<string, { avgConfidence: number; avgQuantity: number; actionCounts: Record<string, number> }> = {};
  for (const d of olderDecisions) {
    if (!agentBaselines[d.agentId]) {
      agentBaselines[d.agentId] = { avgConfidence: 0, avgQuantity: 0, actionCounts: { buy: 0, sell: 0, hold: 0 } };
    }
    agentBaselines[d.agentId].avgConfidence += d.confidence;
    agentBaselines[d.agentId].avgQuantity += parseFloat(d.quantity) || 0;
    agentBaselines[d.agentId].actionCounts[d.action] = (agentBaselines[d.agentId].actionCounts[d.action] || 0) + 1;
  }

  for (const [agentId, baseline] of Object.entries(agentBaselines)) {
    const count = olderDecisions.filter((d: AgentDecision) => d.agentId === agentId).length;
    if (count > 0) {
      baseline.avgConfidence /= count;
      baseline.avgQuantity /= count;
    }
  }

  // Scan recent decisions for alerts
  for (const d of decisions) {
    const config = getAgentConfig(d.agentId);
    if (!config) continue;

    const market = marketData.find((m) => m.symbol.toLowerCase() === d.symbol.toLowerCase());
    const baseline = agentBaselines[d.agentId];
    const quantity = parseFloat(d.quantity) || 0;

    // Alert 1: High conviction spike (confidence >= threshold)
    if (d.confidence >= CONVICTION_SPIKE_THRESHOLD && d.action !== "hold") {
      alerts.push(createAlert({
        type: "conviction_spike",
        severity: d.confidence >= CONVICTION_CRITICAL_THRESHOLD ? "critical" : "significant",
        decision: d,
        config,
        market,
        details: `${config.name} shows extremely high conviction (${d.confidence}%) on ${d.action.toUpperCase()} ${d.symbol}. Baseline avg: ${Math.round(baseline?.avgConfidence ?? 50)}%.`,
        counter: alertCounter++,
      }));
    }

    // Alert 2: Large position (quantity significantly above average)
    if (baseline && quantity > 0 && baseline.avgQuantity > 0 && quantity > baseline.avgQuantity * POSITION_SIZE_LARGE_MULTIPLIER) {
      alerts.push(createAlert({
        type: "large_position",
        severity: quantity > baseline.avgQuantity * POSITION_SIZE_CRITICAL_MULTIPLIER ? "critical" : "notable",
        decision: d,
        config,
        market,
        details: `${config.name} placed an unusually large ${d.action} order on ${d.symbol} (${quantity.toFixed(2)} vs avg ${baseline.avgQuantity.toFixed(2)}).`,
        counter: alertCounter++,
      }));
    }

    // Alert 3: Reversal detection (agent switches from buy to sell or vice versa)
    const previousForSymbol = olderDecisions.find(
      (old: AgentDecision) => old.agentId === d.agentId && old.symbol === d.symbol && old.action !== "hold" && old.action !== d.action && old.id !== d.id,
    );
    if (previousForSymbol && d.action !== "hold") {
      alerts.push(createAlert({
        type: "reversal",
        severity: "significant",
        decision: d,
        config,
        market,
        details: `${config.name} reversed position on ${d.symbol}: was ${previousForSymbol.action.toUpperCase()}, now ${d.action.toUpperCase()}. Confidence: ${d.confidence}%.`,
        counter: alertCounter++,
      }));
    }
  }

  // Alert 4: Cross-agent convergence (multiple agents agree on same stock + action)
  const symbolActionMap: Record<string, Array<{ agentId: string; agentName: string; action: string; confidence: number }>> = {};
  for (const d of decisions) {
    const config = getAgentConfig(d.agentId);
    if (!config || d.action === "hold") continue;
    const key = `${d.symbol}:${d.action}`;
    if (!symbolActionMap[key]) symbolActionMap[key] = [];
    // Avoid duplicates from same agent
    if (!symbolActionMap[key].find((e) => e.agentId === d.agentId)) {
      symbolActionMap[key].push({
        agentId: d.agentId,
        agentName: config.name,
        action: d.action,
        confidence: d.confidence,
      });
    }
  }

  for (const [key, agents] of Object.entries(symbolActionMap)) {
    if (agents.length >= CONVERGENCE_MIN_AGENTS) {
      const [symbol, action] = key.split(":");
      const market = marketData.find((m) => m.symbol.toLowerCase() === symbol.toLowerCase());
      const avgConf = agents.reduce((s, a) => s + a.confidence, 0) / agents.length;

      alerts.push({
        id: `whale_conv_${alertCounter++}`,
        type: "convergence",
        severity: agents.length >= CONVERGENCE_CRITICAL_AGENTS ? "critical" : "significant",
        agentId: agents[0].agentId,
        agentName: agents.map((a) => a.agentName).join(", "),
        provider: "multiple",
        symbol,
        action,
        quantity: 0,
        confidence: Math.round(avgConf),
        reasoning: `${agents.length} agents converge on ${action.toUpperCase()} ${symbol}`,
        timestamp: new Date().toISOString(),
        details: `Cross-agent convergence: ${agents.map((a) => `${a.agentName} (${a.confidence}%)`).join(", ")} all ${action.toUpperCase()} ${symbol}.`,
        marketContext: market ? { currentPrice: market.price, change24h: market.change24h } : null,
      });
    }
  }

  // Alert 5: Accumulation/Distribution patterns
  const agentSymbolActions: Record<string, { buys: number; sells: number }> = {};
  for (const d of decisions) {
    if (d.action === "hold") continue;
    const key = `${d.agentId}:${d.symbol}`;
    if (!agentSymbolActions[key]) agentSymbolActions[key] = { buys: 0, sells: 0 };
    if (d.action === "buy") agentSymbolActions[key].buys++;
    else agentSymbolActions[key].sells++;
  }

  for (const [key, counts] of Object.entries(agentSymbolActions)) {
    const [agentId, symbol] = key.split(":");
    const config = getAgentConfig(agentId);
    if (!config) continue;
    const market = marketData.find((m) => m.symbol.toLowerCase() === symbol.toLowerCase());
    const total = counts.buys + counts.sells;

    if (total >= ACCUMULATION_MIN_TRADES && counts.buys >= total * ACCUMULATION_DIRECTION_THRESHOLD) {
      alerts.push({
        id: `whale_acc_${alertCounter++}`,
        type: "accumulation",
        severity: "notable",
        agentId,
        agentName: config.name,
        provider: config.provider,
        symbol,
        action: "buy",
        quantity: 0,
        confidence: 0,
        reasoning: `${config.name} accumulating ${symbol}`,
        timestamp: new Date().toISOString(),
        details: `Accumulation pattern: ${config.name} has ${counts.buys} buys vs ${counts.sells} sells on ${symbol} in last ${hours}h.`,
        marketContext: market ? { currentPrice: market.price, change24h: market.change24h } : null,
      });
    } else if (total >= ACCUMULATION_MIN_TRADES && counts.sells >= total * ACCUMULATION_DIRECTION_THRESHOLD) {
      alerts.push({
        id: `whale_dist_${alertCounter++}`,
        type: "distribution",
        severity: "notable",
        agentId,
        agentName: config.name,
        provider: config.provider,
        symbol,
        action: "sell",
        quantity: 0,
        confidence: 0,
        reasoning: `${config.name} distributing ${symbol}`,
        timestamp: new Date().toISOString(),
        details: `Distribution pattern: ${config.name} has ${counts.sells} sells vs ${counts.buys} buys on ${symbol} in last ${hours}h.`,
        marketContext: market ? { currentPrice: market.price, change24h: market.change24h } : null,
      });
    }
  }

  // Sort alerts by severity and time
  const severityOrder: Record<string, number> = { critical: 0, significant: 1, notable: 2, info: 3 };
  alerts.sort((a, b) => {
    const sevDiff = (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3);
    if (sevDiff !== 0) return sevDiff;
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });

  // Aggregate stats
  const alertsByType: Record<string, number> = {};
  const alertsBySeverity: Record<string, number> = {};
  const agentAlertCounts: Record<string, { name: string; count: number }> = {};
  const stockAlertCounts: Record<string, number> = {};

  for (const alert of alerts) {
    alertsByType[alert.type] = (alertsByType[alert.type] || 0) + 1;
    alertsBySeverity[alert.severity] = (alertsBySeverity[alert.severity] || 0) + 1;

    if (alert.type !== "convergence") {
      agentAlertCounts[alert.agentId] = agentAlertCounts[alert.agentId] ?? { name: alert.agentName, count: 0 };
      agentAlertCounts[alert.agentId].count++;
    }
    stockAlertCounts[alert.symbol] = (stockAlertCounts[alert.symbol] || 0) + 1;
  }

  const mostActiveWhale = Object.entries(agentAlertCounts)
    .sort(([, a], [, b]) => b.count - a.count)[0];
  const mostTargetedStock = Object.entries(stockAlertCounts)
    .sort(([, a], [, b]) => b - a)[0];

  // Smart money flow
  const buyDecisions = decisions.filter((d: AgentDecision) => d.action === "buy");
  const sellDecisions = decisions.filter((d: AgentDecision) => d.action === "sell");
  const netBullish = buyDecisions.reduce((s: number, d: AgentDecision) => s + d.confidence, 0);
  const netBearish = sellDecisions.reduce((s: number, d: AgentDecision) => s + d.confidence, 0);

  const bullishSymbols: Record<string, number> = {};
  const bearishSymbols: Record<string, number> = {};
  for (const d of buyDecisions) bullishSymbols[d.symbol] = (bullishSymbols[d.symbol] || 0) + d.confidence;
  for (const d of sellDecisions) bearishSymbols[d.symbol] = (bearishSymbols[d.symbol] || 0) + d.confidence;

  const topBullish = getTopKey(bullishSymbols);
  const topBearish = getTopKey(bearishSymbols);

  let overallActivity: WhaleActivity["overallActivity"];
  if (alerts.length <= ACTIVITY_QUIET_MAX) overallActivity = "quiet";
  else if (alerts.length <= ACTIVITY_MODERATE_MAX) overallActivity = "moderate";
  else if (alerts.length <= ACTIVITY_ELEVATED_MAX) overallActivity = "elevated";
  else overallActivity = "intense";

  const criticalCount = alertsBySeverity["critical"] ?? 0;

  return {
    alerts: alerts.slice(0, ALERTS_DISPLAY_LIMIT),
    alertsByType,
    alertsBySeverity,
    mostActiveWhale: mostActiveWhale
      ? { agentId: mostActiveWhale[0], agentName: mostActiveWhale[1].name, alertCount: mostActiveWhale[1].count }
      : null,
    mostTargetedStock: mostTargetedStock
      ? { symbol: mostTargetedStock[0], alertCount: mostTargetedStock[1] }
      : null,
    overallActivity,
    smartMoneyFlow: {
      netBullish: Math.round(netBullish),
      netBearish: Math.round(netBearish),
      flowDirection: netBullish > netBearish * FLOW_STRENGTH_MULTIPLIER ? "bullish" : netBearish > netBullish * FLOW_STRENGTH_MULTIPLIER ? "bearish" : "neutral",
      topBullishSymbol: topBullish?.[0] ?? null,
      topBearishSymbol: topBearish?.[0] ?? null,
    },
    summary: `${alerts.length} whale alert(s) in last ${hours}h. ${criticalCount} critical. Activity level: ${overallActivity}. Smart money flow: ${netBullish > netBearish ? "BULLISH" : netBearish > netBullish ? "BEARISH" : "NEUTRAL"}.`,
  };
}

// ---------------------------------------------------------------------------
// Conviction Tracker
// ---------------------------------------------------------------------------

/**
 * Track high-conviction trades across all agents.
 */
export async function getConvictionTracker(minConfidence = CONVICTION_HIGH_THRESHOLD): Promise<ConvictionTracker> {
  const decisions = await db
    .select()
    .from(agentDecisions)
    .where(gte(agentDecisions.confidence, minConfidence))
    .orderBy(desc(agentDecisions.createdAt))
    .limit(200);

  const allDecisions = await db
    .select()
    .from(agentDecisions)
    .orderBy(desc(agentDecisions.createdAt))
    .limit(BASELINE_DECISIONS_LIMIT);

  let marketData: MarketData[];
  try {
    marketData = await getMarketData();
  } catch {
    marketData = [];
  }

  const highConvictionTrades = decisions.map((d: AgentDecision) => {
    const config = getAgentConfig(d.agentId);
    const market = marketData.find((m) => m.symbol.toLowerCase() === d.symbol.toLowerCase());
    return {
      agentId: d.agentId,
      agentName: config?.name ?? d.agentId,
      provider: config?.provider ?? "unknown",
      symbol: d.symbol,
      action: d.action,
      confidence: d.confidence,
      reasoning: d.reasoning,
      timestamp: d.createdAt.toISOString(),
      priceAtDecision: market?.price ?? null,
    };
  });

  // Per-agent conviction stats
  const configs = getAgentConfigs();
  const avgConvictionByAgent = configs.map((config) => {
    const agentAll = allDecisions.filter((d: AgentDecision) => d.agentId === config.agentId);
    const agentHigh = decisions.filter((d: AgentDecision) => d.agentId === config.agentId);
    const avgConfidence = agentAll.length > 0
      ? agentAll.reduce((s: number, d: AgentDecision) => s + d.confidence, 0) / agentAll.length
      : 0;

    // Conviction trend: compare first half vs second half
    const half = Math.floor(agentAll.length / 2);
    const firstHalf = agentAll.slice(half);
    const secondHalf = agentAll.slice(0, half);
    const avgFirst = firstHalf.length > 0
      ? firstHalf.reduce((s: number, d: AgentDecision) => s + d.confidence, 0) / firstHalf.length
      : 0;
    const avgSecond = secondHalf.length > 0
      ? secondHalf.reduce((s: number, d: AgentDecision) => s + d.confidence, 0) / secondHalf.length
      : 0;

    return {
      agentId: config.agentId,
      agentName: config.name,
      avgConfidence: Math.round(avgConfidence * 10) / 10,
      highConvictionCount: agentHigh.length,
      totalDecisions: agentAll.length,
      highConvictionRate: agentAll.length > 0
        ? Math.round((agentHigh.length / agentAll.length) * 10000) / 100
        : 0,
      trend: avgSecond > avgFirst + CONVICTION_TREND_THRESHOLD ? "increasing" : avgFirst > avgSecond + CONVICTION_TREND_THRESHOLD ? "decreasing" : "stable",
    };
  });

  // Per-symbol conviction stats
  const symbolConviction: Record<string, { totalConf: number; count: number; buys: number; sells: number }> = {};
  for (const d of decisions) {
    if (!symbolConviction[d.symbol]) symbolConviction[d.symbol] = { totalConf: 0, count: 0, buys: 0, sells: 0 };
    symbolConviction[d.symbol].totalConf += d.confidence;
    symbolConviction[d.symbol].count++;
    if (d.action === "buy") symbolConviction[d.symbol].buys++;
    if (d.action === "sell") symbolConviction[d.symbol].sells++;
  }

  const convictionBySymbol = Object.entries(symbolConviction)
    .map(([symbol, stats]) => ({
      symbol,
      avgConfidence: Math.round((stats.totalConf / stats.count) * 10) / 10,
      tradeCount: stats.count,
      direction: stats.buys > stats.sells ? "bullish" : stats.sells > stats.buys ? "bearish" : "mixed",
    }))
    .sort((a, b) => b.avgConfidence - a.avgConfidence);

  const overallConviction = allDecisions.length > 0
    ? Math.round((allDecisions.reduce((s: number, d: AgentDecision) => s + d.confidence, 0) / allDecisions.length) * 10) / 10
    : 0;

  let interpretation: string;
  if (overallConviction > CONVICTION_HIGH_THRESHOLD) interpretation = "Markets showing high conviction — agents are confident in their positions. Watch for potential crowded trades.";
  else if (overallConviction > CONVICTION_MODERATE_THRESHOLD) interpretation = "Moderate conviction levels — agents have reasonable confidence but no extreme certainty.";
  else if (overallConviction > CONVICTION_LOW_THRESHOLD) interpretation = "Low conviction environment — agents are uncertain. Expect more hold decisions and smaller position sizes.";
  else interpretation = "Very low conviction — agents are highly uncertain. Minimal trading activity expected.";

  return {
    highConvictionTrades: highConvictionTrades.slice(0, ALERTS_DISPLAY_LIMIT),
    avgConvictionByAgent,
    convictionBySymbol: convictionBySymbol.slice(0, 15),
    overallConviction,
    interpretation,
  };
}

// ---------------------------------------------------------------------------
// Position Heatmap
// ---------------------------------------------------------------------------

/**
 * Generate a heatmap of agent activity across stocks.
 */
export async function getPositionHeatmap(): Promise<PositionHeatmap> {
  const decisions = await db
    .select()
    .from(agentDecisions)
    .orderBy(desc(agentDecisions.createdAt))
    .limit(RECENT_DECISIONS_LIMIT);

  const configs = getAgentConfigs();
  const agents = configs.map((c) => c.agentId);

  // Collect all unique symbols from decisions
  const symbolSet = new Set<string>();
  for (const d of decisions) {
    if (d.action !== "hold") symbolSet.add(d.symbol);
  }
  const symbols = Array.from(symbolSet).sort();

  // Build heatmap cells
  const cells: PositionHeatmap["cells"] = [];
  for (const agentId of agents) {
    const config = getAgentConfig(agentId);
    if (!config) continue;

    for (const symbol of symbols) {
      const symbolDecisions = decisions.filter(
        (d: AgentDecision) => d.agentId === agentId && d.symbol === symbol && d.action !== "hold",
      );
      if (symbolDecisions.length === 0) continue;

      const avgConfidence = symbolDecisions.reduce((s: number, d: AgentDecision) => s + d.confidence, 0) / symbolDecisions.length;
      const latestAction = symbolDecisions[0]?.action ?? "hold";
      // Intensity: combination of trade count and avg confidence
      const intensity = Math.min(100, Math.round(symbolDecisions.length * 10 + avgConfidence * 0.5));

      cells.push({
        agentId,
        agentName: config.name,
        symbol,
        intensity,
        action: latestAction,
        confidence: Math.round(avgConfidence),
        tradeCount: symbolDecisions.length,
      });
    }
  }

  cells.sort((a, b) => b.intensity - a.intensity);

  return {
    cells,
    agents: configs.map((c) => c.name),
    symbols,
    hottestCell: cells.length > 0 ? { agentId: cells[0].agentId, symbol: cells[0].symbol, intensity: cells[0].intensity } : null,
    coldestCell: cells.length > 0
      ? { agentId: cells[cells.length - 1].agentId, symbol: cells[cells.length - 1].symbol, intensity: cells[cells.length - 1].intensity }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Smart Money Flow
// ---------------------------------------------------------------------------

/**
 * Analyze net flows of "smart money" (agent capital) into/out of stocks.
 */
export async function getSmartMoneyFlow(hours = SMART_MONEY_FLOW_DEFAULT_HOURS): Promise<SmartMoneyFlow> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const decisions = await db
    .select()
    .from(agentDecisions)
    .where(gte(agentDecisions.createdAt, since))
    .orderBy(desc(agentDecisions.createdAt))
    .limit(RECENT_DECISIONS_LIMIT);

  let marketData: MarketData[];
  try {
    marketData = await getMarketData();
  } catch {
    marketData = [];
  }

  // Calculate flows per symbol
  const symbolFlows: Record<string, {
    buys: Array<{ agentId: string; agentName: string; confidence: number; quantity: number }>;
    sells: Array<{ agentId: string; agentName: string; confidence: number; quantity: number }>;
  }> = {};

  for (const d of decisions) {
    if (d.action === "hold") continue;
    if (!symbolFlows[d.symbol]) symbolFlows[d.symbol] = { buys: [], sells: [] };
    const config = getAgentConfig(d.agentId);
    const entry = {
      agentId: d.agentId,
      agentName: config?.name ?? d.agentId,
      confidence: d.confidence,
      quantity: parseFloat(d.quantity) || 0,
    };
    if (d.action === "buy") symbolFlows[d.symbol].buys.push(entry);
    else symbolFlows[d.symbol].sells.push(entry);
  }

  const flows = Object.entries(symbolFlows).map(([symbol, data]) => {
    const market = marketData.find((m) => m.symbol.toLowerCase() === symbol.toLowerCase());
    const buyVolume = weightedSumByKey(data.buys, 'confidence', 'quantity');
    const sellVolume = weightedSumByKey(data.sells, 'confidence', 'quantity');
    const netFlow = buyVolume - sellVolume;

    const agentBreakdown = [
      ...data.buys.map((b) => ({ ...b, action: "buy" })),
      ...data.sells.map((s) => ({ ...s, action: "sell" })),
    ].map(({ agentId, agentName, action, confidence }) => ({ agentId, agentName, action, confidence }));

    const conviction = agentBreakdown.length > 0
      ? Math.round(agentBreakdown.reduce((s, a) => s + a.confidence, 0) / agentBreakdown.length)
      : 0;

    return {
      symbol,
      name: market?.name ?? symbol,
      netFlow: Math.round(netFlow),
      buyVolume: Math.round(buyVolume),
      sellVolume: Math.round(sellVolume),
      flowDirection: (netFlow > FLOW_DIRECTION_THRESHOLD ? "inflow" : netFlow < -FLOW_DIRECTION_THRESHOLD ? "outflow" : "neutral") as "inflow" | "outflow" | "neutral",
      agentBreakdown,
      conviction,
    };
  });

  flows.sort((a, b) => Math.abs(b.netFlow) - Math.abs(a.netFlow));

  // Sector flows
  const sectorFlowMap: Record<string, { netFlow: number; topSymbol: string; topFlow: number }> = {};
  for (const flow of flows) {
    const sector = SECTOR_MAP[flow.symbol] ?? "Other";
    if (!sectorFlowMap[sector]) sectorFlowMap[sector] = { netFlow: 0, topSymbol: "", topFlow: 0 };
    sectorFlowMap[sector].netFlow += flow.netFlow;
    if (Math.abs(flow.netFlow) > Math.abs(sectorFlowMap[sector].topFlow)) {
      sectorFlowMap[sector].topSymbol = flow.symbol;
      sectorFlowMap[sector].topFlow = flow.netFlow;
    }
  }

  const sectorFlows = Object.entries(sectorFlowMap)
    .map(([sector, data]) => ({
      sector,
      netFlow: data.netFlow,
      direction: data.netFlow > FLOW_DIRECTION_THRESHOLD ? "inflow" : data.netFlow < -FLOW_DIRECTION_THRESHOLD ? "outflow" : "neutral",
      topSymbol: data.topSymbol,
    }))
    .sort((a, b) => Math.abs(b.netFlow) - Math.abs(a.netFlow));

  const totalInflow = flows.filter((f) => f.netFlow > 0).reduce((s, f) => s + f.netFlow, 0);
  const totalOutflow = Math.abs(flows.filter((f) => f.netFlow < 0).reduce((s, f) => s + f.netFlow, 0));
  const netFlowTotal = totalInflow - totalOutflow;

  const topInflow = flows.filter((f) => f.flowDirection === "inflow")[0];
  const topOutflow = flows.filter((f) => f.flowDirection === "outflow")[0];

  const period = hours <= 24 ? "24h" : hours <= 168 ? "7d" : `${Math.round(hours / 24)}d`;

  return {
    period,
    flows: flows.slice(0, 20),
    sectorFlows,
    aggregateFlow: {
      totalInflow: Math.round(totalInflow),
      totalOutflow: Math.round(totalOutflow),
      netFlow: Math.round(netFlowTotal),
      direction: netFlowTotal > AGGREGATE_FLOW_THRESHOLD ? "net_inflow" : netFlowTotal < -AGGREGATE_FLOW_THRESHOLD ? "net_outflow" : "balanced",
      strength: Math.min(100, Math.round(Math.abs(netFlowTotal) / 10)),
    },
    narrative: `Smart money flow over ${period}: ${topInflow ? `Strongest inflow into ${topInflow.symbol}.` : "No significant inflows."} ${topOutflow ? `Largest outflow from ${topOutflow.symbol}.` : "No significant outflows."} Overall direction: ${netFlowTotal > 0 ? "NET BULLISH" : netFlowTotal < 0 ? "NET BEARISH" : "BALANCED"}.`,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createAlert(params: {
  type: WhaleAlert["type"];
  severity: WhaleAlert["severity"];
  decision: {
    agentId: string;
    symbol: string;
    action: string;
    quantity: string;
    confidence: number;
    reasoning: string;
    createdAt: Date;
  };
  config: { name: string; provider: string };
  market: { price: number; change24h: number | null } | undefined;
  details: string;
  counter: number;
}): WhaleAlert {
  return {
    id: `whale_${params.type}_${params.counter}`,
    type: params.type,
    severity: params.severity,
    agentId: params.decision.agentId,
    agentName: params.config.name,
    provider: params.config.provider,
    symbol: params.decision.symbol,
    action: params.decision.action,
    quantity: parseFloat(params.decision.quantity) || 0,
    confidence: params.decision.confidence,
    reasoning: params.decision.reasoning,
    timestamp: params.decision.createdAt.toISOString(),
    details: params.details,
    marketContext: params.market
      ? { currentPrice: params.market.price, change24h: params.market.change24h }
      : null,
  };
}
