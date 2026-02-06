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
import { getTopEntry } from "../lib/math-utils.ts";

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
export async function getWhaleAlerts(hours = 24): Promise<WhaleActivity> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  // Get all recent decisions
  const decisions = await db
    .select()
    .from(agentDecisions)
    .where(gte(agentDecisions.createdAt, since))
    .orderBy(desc(agentDecisions.createdAt))
    .limit(500);

  // Also get older decisions for comparison
  const olderDecisions = await db
    .select()
    .from(agentDecisions)
    .orderBy(desc(agentDecisions.createdAt))
    .limit(1000);

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

    // Alert 1: High conviction spike (confidence >= 85)
    if (d.confidence >= 85 && d.action !== "hold") {
      alerts.push(createAlert({
        type: "conviction_spike",
        severity: d.confidence >= 95 ? "critical" : "significant",
        decision: d,
        config,
        market,
        details: `${config.name} shows extremely high conviction (${d.confidence}%) on ${d.action.toUpperCase()} ${d.symbol}. Baseline avg: ${Math.round(baseline?.avgConfidence ?? 50)}%.`,
        counter: alertCounter++,
      }));
    }

    // Alert 2: Large position (quantity significantly above average)
    if (baseline && quantity > 0 && baseline.avgQuantity > 0 && quantity > baseline.avgQuantity * 2) {
      alerts.push(createAlert({
        type: "large_position",
        severity: quantity > baseline.avgQuantity * 5 ? "critical" : "notable",
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
    if (agents.length >= 2) {
      const [symbol, action] = key.split(":");
      const market = marketData.find((m) => m.symbol.toLowerCase() === symbol.toLowerCase());
      const avgConf = agents.reduce((s, a) => s + a.confidence, 0) / agents.length;

      alerts.push({
        id: `whale_conv_${alertCounter++}`,
        type: "convergence",
        severity: agents.length >= 3 ? "critical" : "significant",
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

    if (total >= 3 && counts.buys >= total * 0.75) {
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
    } else if (total >= 3 && counts.sells >= total * 0.75) {
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

  const topBullish = getTopEntry(bullishSymbols);
  const topBearish = getTopEntry(bearishSymbols);

  let overallActivity: WhaleActivity["overallActivity"];
  if (alerts.length <= 2) overallActivity = "quiet";
  else if (alerts.length <= 5) overallActivity = "moderate";
  else if (alerts.length <= 10) overallActivity = "elevated";
  else overallActivity = "intense";

  const criticalCount = alertsBySeverity["critical"] ?? 0;

  return {
    alerts: alerts.slice(0, 50),
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
      flowDirection: netBullish > netBearish * 1.2 ? "bullish" : netBearish > netBullish * 1.2 ? "bearish" : "neutral",
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
export async function getConvictionTracker(minConfidence = 75): Promise<ConvictionTracker> {
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
    .limit(1000);

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
      trend: avgSecond > avgFirst + 3 ? "increasing" : avgFirst > avgSecond + 3 ? "decreasing" : "stable",
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
  if (overallConviction > 75) interpretation = "Markets showing high conviction — agents are confident in their positions. Watch for potential crowded trades.";
  else if (overallConviction > 60) interpretation = "Moderate conviction levels — agents have reasonable confidence but no extreme certainty.";
  else if (overallConviction > 45) interpretation = "Low conviction environment — agents are uncertain. Expect more hold decisions and smaller position sizes.";
  else interpretation = "Very low conviction — agents are highly uncertain. Minimal trading activity expected.";

  return {
    highConvictionTrades: highConvictionTrades.slice(0, 50),
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
    .limit(500);

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
export async function getSmartMoneyFlow(hours = 168): Promise<SmartMoneyFlow> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const decisions = await db
    .select()
    .from(agentDecisions)
    .where(gte(agentDecisions.createdAt, since))
    .orderBy(desc(agentDecisions.createdAt))
    .limit(500);

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
    const buyVolume = data.buys.reduce((s, b) => s + b.confidence * (b.quantity || 1), 0);
    const sellVolume = data.sells.reduce((s, s2) => s + s2.confidence * (s2.quantity || 1), 0);
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
      flowDirection: (netFlow > 50 ? "inflow" : netFlow < -50 ? "outflow" : "neutral") as "inflow" | "outflow" | "neutral",
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
      direction: data.netFlow > 50 ? "inflow" : data.netFlow < -50 ? "outflow" : "neutral",
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
      direction: netFlowTotal > 100 ? "net_inflow" : netFlowTotal < -100 ? "net_outflow" : "balanced",
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
