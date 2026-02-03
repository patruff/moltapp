/**
 * Agent Context Enricher
 *
 * The intelligence layer that transforms raw market data into rich,
 * actionable context for AI trading agents. Instead of agents receiving
 * just prices and portfolio data, they now get:
 *
 * 1. Technical Indicators — SMA, EMA, RSI, MACD, trend signals
 * 2. Market Regime — bull/bear/sideways classification with confidence
 * 3. Memory & Lessons — past trade outcomes and extracted learnings
 * 4. Sentiment Analysis — market mood, agent consensus direction
 * 5. Peer Actions — what the other 2 agents did recently
 * 6. Risk Warnings — concentration alerts, drawdown warnings
 * 7. News Context — cached news headlines relevant to positions
 *
 * This is the KEY DIFFERENTIATOR: agents that learn and adapt vs.
 * agents that just see prices. The enriched context makes trading
 * decisions dramatically better.
 *
 * Architecture:
 * - Called by the orchestrator before each agent's analyze() call
 * - Gathers data from multiple services (market-aggregator, sentiment,
 *   agent-memory, consensus-engine, etc.)
 * - Produces a structured text block that gets appended to the user prompt
 * - Each agent gets personalized context (their own memory, their own risk)
 */

import { computeIndicators, computeMarketBreadth, type TechnicalIndicators, type MarketBreadth } from "./market-aggregator.ts";
import { XSTOCKS_CATALOG } from "../config/constants.ts";
import { db } from "../db/index.ts";
import { agentDecisions } from "../db/schema/agent-decisions.ts";
import { positions } from "../db/schema/positions.ts";
import { trades } from "../db/schema/trades.ts";
import { eq, desc, and, gte, ne, sql } from "drizzle-orm";
import type { MarketData, PortfolioContext } from "../agents/base-agent.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EnrichedContext {
  /** Technical analysis section for the prompt */
  technicalAnalysis: string;
  /** Market regime section */
  marketRegime: string;
  /** Memory and lessons from past trades */
  memorySection: string;
  /** What other agents did recently */
  peerActions: string;
  /** Risk warnings specific to this agent */
  riskWarnings: string;
  /** Sentiment summary */
  sentimentSummary: string;
  /** Full formatted prompt section to append */
  fullPromptSection: string;
  /** Metadata for logging */
  metadata: {
    indicatorsAvailable: number;
    memoriesInjected: number;
    peerActionsIncluded: number;
    riskWarningsCount: number;
    generatedAt: string;
  };
}

export interface EnricherStats {
  totalEnrichments: number;
  enrichmentsByAgent: Record<string, number>;
  averageContextSize: number;
  lastEnrichmentAt: string | null;
  indicatorCoverage: number;
  memoryCoverage: number;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let totalEnrichments = 0;
const enrichmentsByAgent: Record<string, number> = {};
let contextSizes: number[] = [];
let lastEnrichmentAt: string | null = null;
const MAX_CONTEXT_SIZES = 200;

// ---------------------------------------------------------------------------
// Core Enrichment
// ---------------------------------------------------------------------------

/**
 * Generate enriched context for a specific agent before their trading decision.
 *
 * @param agentId - The agent about to make a decision
 * @param marketData - Current market data
 * @param portfolio - Agent's current portfolio
 * @returns Enriched context sections ready for prompt injection
 */
export async function enrichAgentContext(
  agentId: string,
  marketData: MarketData[],
  portfolio: PortfolioContext,
): Promise<EnrichedContext> {
  const startTime = Date.now();

  // Gather all context in parallel for speed
  const [
    technicalData,
    breadth,
    recentDecisions,
    peerDecisions,
    tradeHistory,
  ] = await Promise.all([
    gatherTechnicalIndicators(marketData),
    Promise.resolve(computeMarketBreadth()),
    getRecentDecisions(agentId, 10),
    getPeerDecisions(agentId, 5),
    getTradeOutcomes(agentId, 5),
  ]);

  // Build each section
  const technicalAnalysis = buildTechnicalSection(technicalData, marketData);
  const marketRegime = buildRegimeSection(breadth);
  const memorySection = buildMemorySection(recentDecisions, tradeHistory, agentId);
  const peerActions = buildPeerSection(peerDecisions, agentId);
  const riskWarnings = buildRiskSection(portfolio, marketData);
  const sentimentSummary = buildSentimentSection(breadth, technicalData);

  // Combine into full prompt section
  const fullPromptSection = [
    technicalAnalysis,
    marketRegime,
    sentimentSummary,
    memorySection,
    peerActions,
    riskWarnings,
  ]
    .filter((s) => s.length > 0)
    .join("\n\n");

  // Track stats
  totalEnrichments++;
  enrichmentsByAgent[agentId] = (enrichmentsByAgent[agentId] ?? 0) + 1;
  contextSizes.push(fullPromptSection.length);
  if (contextSizes.length > MAX_CONTEXT_SIZES) {
    contextSizes = contextSizes.slice(-MAX_CONTEXT_SIZES);
  }
  lastEnrichmentAt = new Date().toISOString();

  const metadata = {
    indicatorsAvailable: technicalData.length,
    memoriesInjected: recentDecisions.length + tradeHistory.length,
    peerActionsIncluded: peerDecisions.length,
    riskWarningsCount: riskWarnings.split("\n").filter((l) => l.includes("⚠") || l.includes("WARNING")).length,
    generatedAt: new Date().toISOString(),
  };

  console.log(
    `[ContextEnricher] Enriched context for ${agentId}: ` +
    `${fullPromptSection.length} chars, ${metadata.indicatorsAvailable} indicators, ` +
    `${metadata.memoriesInjected} memories, ${metadata.peerActionsIncluded} peer actions ` +
    `(${Date.now() - startTime}ms)`,
  );

  return {
    technicalAnalysis,
    marketRegime,
    memorySection,
    peerActions,
    riskWarnings,
    sentimentSummary,
    fullPromptSection,
    metadata,
  };
}

// ---------------------------------------------------------------------------
// Technical Indicators Section
// ---------------------------------------------------------------------------

function gatherTechnicalIndicators(
  marketData: MarketData[],
): Promise<TechnicalIndicators[]> {
  const indicators: TechnicalIndicators[] = [];
  for (const stock of marketData) {
    try {
      const ind = computeIndicators(stock.symbol);
      indicators.push(ind);
    } catch {
      // Skip stocks without enough history for indicators
    }
  }
  return Promise.resolve(indicators);
}

function buildTechnicalSection(
  indicators: TechnicalIndicators[],
  marketData: MarketData[],
): string {
  if (indicators.length === 0) return "";

  const lines: string[] = ["TECHNICAL ANALYSIS:"];

  // Only include stocks with actionable signals
  const actionable = indicators.filter(
    (ind) => ind.signalStrength >= 60 || ind.rsi14 !== null,
  );

  if (actionable.length === 0) {
    lines.push("  No strong technical signals detected. Market is range-bound.");
    return lines.join("\n");
  }

  for (const ind of actionable.slice(0, 10)) {
    const parts: string[] = [`  ${ind.symbol}:`];

    if (ind.trend !== "sideways") {
      parts.push(`Trend=${ind.trend.toUpperCase()} (strength: ${ind.signalStrength}%)`);
    }

    if (ind.rsi14 !== null) {
      let rsiLabel = "neutral";
      if (ind.rsi14 > 70) rsiLabel = "OVERBOUGHT";
      else if (ind.rsi14 > 60) rsiLabel = "bullish";
      else if (ind.rsi14 < 30) rsiLabel = "OVERSOLD";
      else if (ind.rsi14 < 40) rsiLabel = "bearish";
      parts.push(`RSI=${ind.rsi14.toFixed(1)} (${rsiLabel})`);
    }

    if (ind.sma20 !== null) {
      const market = marketData.find((m) => m.symbol === ind.symbol);
      if (market) {
        const aboveSma = market.price > ind.sma20;
        parts.push(`Price ${aboveSma ? "ABOVE" : "BELOW"} SMA20 ($${ind.sma20.toFixed(2)})`);
      }
    }

    if (ind.ema12 !== null && ind.ema26 !== null) {
      const macdSign = ind.ema12 > ind.ema26 ? "BULLISH" : "BEARISH";
      parts.push(`MACD: ${macdSign}`);
    }

    if (ind.momentum !== null && Math.abs(ind.momentum) > 1) {
      parts.push(`Momentum: ${ind.momentum > 0 ? "+" : ""}${ind.momentum.toFixed(1)}%`);
    }

    lines.push(parts.join(" | "));
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Market Regime Section
// ---------------------------------------------------------------------------

function buildRegimeSection(breadth: MarketBreadth): string {
  const lines: string[] = ["MARKET REGIME:"];

  const regimeEmoji: Record<string, string> = {
    bull: "BULL",
    bear: "BEAR",
    sideways: "SIDEWAYS",
    volatile: "VOLATILE",
  };

  lines.push(
    `  Overall: ${regimeEmoji[breadth.regime] ?? "UNKNOWN"} market ` +
    `(confidence: ${breadth.regimeConfidence}%)`,
  );
  lines.push(
    `  Advance/Decline: ${breadth.advancing} up, ${breadth.declining} down, ${breadth.unchanged} flat`,
  );
  lines.push(`  Average change: ${breadth.averageChange > 0 ? "+" : ""}${breadth.averageChange.toFixed(2)}%`);

  if (breadth.regime === "volatile") {
    lines.push("  WARNING: High volatility detected. Consider smaller position sizes.");
  } else if (breadth.regime === "bear" && breadth.regimeConfidence > 70) {
    lines.push("  CAUTION: Strong bearish regime. Defensive positioning recommended.");
  } else if (breadth.regime === "bull" && breadth.regimeConfidence > 70) {
    lines.push("  OPPORTUNITY: Strong bullish regime. Quality dip buys may be favorable.");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Memory Section
// ---------------------------------------------------------------------------

interface DecisionRecord {
  action: string;
  symbol: string;
  confidence: number;
  reasoning: string;
  createdAt: Date;
  roundId: string | null;
}

interface TradeOutcome {
  symbol: string;
  side: string;
  pricePerToken: string;
  usdcAmount: string;
  createdAt: Date;
}

async function getRecentDecisions(agentId: string, limit: number): Promise<DecisionRecord[]> {
  try {
    const decisions = await db
      .select({
        action: agentDecisions.action,
        symbol: agentDecisions.symbol,
        confidence: agentDecisions.confidence,
        reasoning: agentDecisions.reasoning,
        createdAt: agentDecisions.createdAt,
        roundId: agentDecisions.roundId,
      })
      .from(agentDecisions)
      .where(eq(agentDecisions.agentId, agentId))
      .orderBy(desc(agentDecisions.createdAt))
      .limit(limit);
    return decisions;
  } catch {
    return [];
  }
}

async function getTradeOutcomes(agentId: string, limit: number): Promise<TradeOutcome[]> {
  try {
    const results = await db
      .select({
        symbol: trades.stockSymbol,
        side: trades.side,
        pricePerToken: trades.pricePerToken,
        usdcAmount: trades.usdcAmount,
        createdAt: trades.createdAt,
      })
      .from(trades)
      .where(eq(trades.agentId, agentId))
      .orderBy(desc(trades.createdAt))
      .limit(limit);
    return results;
  } catch {
    return [];
  }
}

function buildMemorySection(
  decisions: DecisionRecord[],
  tradeOutcomes: TradeOutcome[],
  agentId: string,
): string {
  if (decisions.length === 0 && tradeOutcomes.length === 0) return "";

  const lines: string[] = ["YOUR RECENT TRADING HISTORY:"];

  // Show recent decisions
  if (decisions.length > 0) {
    lines.push("  Recent decisions:");
    for (const d of decisions.slice(0, 5)) {
      const timeAgo = formatTimeAgo(d.createdAt);
      lines.push(
        `    ${timeAgo}: ${d.action.toUpperCase()} ${d.symbol} ` +
        `(confidence: ${d.confidence}%) — ${truncate(d.reasoning, 80)}`,
      );
    }
  }

  // Show trade outcomes
  if (tradeOutcomes.length > 0) {
    lines.push("  Recent executed trades:");
    for (const t of tradeOutcomes.slice(0, 5)) {
      const timeAgo = formatTimeAgo(t.createdAt);
      lines.push(
        `    ${timeAgo}: ${t.side.toUpperCase()} ${t.symbol} @ $${parseFloat(t.pricePerToken).toFixed(2)} ($${parseFloat(t.usdcAmount).toFixed(2)})`,
      );
    }
  }

  // Identify patterns
  const holdCount = decisions.filter((d) => d.action === "hold").length;
  const buyCount = decisions.filter((d) => d.action === "buy").length;
  const sellCount = decisions.filter((d) => d.action === "sell").length;

  if (holdCount >= 3 && decisions.length >= 4) {
    lines.push("  PATTERN: You've been holding frequently. Consider if there are real opportunities you're missing.");
  }
  if (buyCount >= 4 && sellCount === 0 && decisions.length >= 5) {
    lines.push("  PATTERN: Heavy buying bias. Consider taking profits on winning positions.");
  }

  // Check for repeated symbols
  const symbolCounts: Record<string, number> = {};
  for (const d of decisions) {
    if (d.action !== "hold") {
      symbolCounts[d.symbol] = (symbolCounts[d.symbol] ?? 0) + 1;
    }
  }
  const favorites = Object.entries(symbolCounts)
    .filter(([, count]) => count >= 3)
    .map(([sym]) => sym);
  if (favorites.length > 0) {
    lines.push(`  NOTE: You've traded ${favorites.join(", ")} frequently. Ensure this isn't an anchoring bias.`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Peer Actions Section
// ---------------------------------------------------------------------------

async function getPeerDecisions(agentId: string, limit: number): Promise<DecisionRecord[]> {
  try {
    const decisions = await db
      .select({
        action: agentDecisions.action,
        symbol: agentDecisions.symbol,
        confidence: agentDecisions.confidence,
        reasoning: agentDecisions.reasoning,
        createdAt: agentDecisions.createdAt,
        roundId: agentDecisions.roundId,
      })
      .from(agentDecisions)
      .where(ne(agentDecisions.agentId, agentId))
      .orderBy(desc(agentDecisions.createdAt))
      .limit(limit * 2); // Get extra to show variety
    return decisions;
  } catch {
    return [];
  }
}

function buildPeerSection(
  peerDecisions: DecisionRecord[],
  agentId: string,
): string {
  if (peerDecisions.length === 0) return "";

  const lines: string[] = ["COMPETITOR ACTIVITY (other AI agents):"];

  // Group by round to show concurrent decisions
  const byRound = new Map<string, DecisionRecord[]>();
  for (const d of peerDecisions) {
    if (!d.roundId) continue;
    const list = byRound.get(d.roundId) ?? [];
    list.push(d);
    byRound.set(d.roundId, list);
  }

  // Show most recent round's peer decisions
  const roundEntries = Array.from(byRound.entries()).slice(0, 2);
  for (const [, roundDecisions] of roundEntries) {
    for (const d of roundDecisions.slice(0, 3)) {
      const timeAgo = formatTimeAgo(d.createdAt);
      lines.push(
        `  ${timeAgo}: Competitor ${d.action.toUpperCase()} ${d.symbol} (confidence: ${d.confidence}%)`,
      );
    }
  }

  // Detect consensus or disagreement
  const recentPeers = peerDecisions.slice(0, 6);
  const peerBuys = recentPeers.filter((d) => d.action === "buy");
  const peerSells = recentPeers.filter((d) => d.action === "sell");

  if (peerBuys.length >= 4) {
    const topBuySymbols = [...new Set(peerBuys.map((d) => d.symbol))].slice(0, 3);
    lines.push(`  TREND: Competitors are heavily buying (${topBuySymbols.join(", ")}). Consider if this is well-reasoned or herd behavior.`);
  } else if (peerSells.length >= 4) {
    lines.push("  TREND: Competitors are selling aggressively. Market may be shifting.");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Risk Warnings Section
// ---------------------------------------------------------------------------

function buildRiskSection(
  portfolio: PortfolioContext,
  marketData: MarketData[],
): string {
  const warnings: string[] = [];

  // Check concentration risk
  for (const pos of portfolio.positions) {
    const positionValue = pos.currentPrice * pos.quantity;
    const positionPercent = (positionValue / portfolio.totalValue) * 100;

    if (positionPercent > 25) {
      warnings.push(
        `  WARNING: ${pos.symbol} is ${positionPercent.toFixed(1)}% of your portfolio — over-concentrated. Consider reducing.`,
      );
    }
  }

  // Check cash level
  const cashPercent = (portfolio.cashBalance / portfolio.totalValue) * 100;
  if (cashPercent < 10) {
    warnings.push(
      `  WARNING: Only ${cashPercent.toFixed(1)}% cash remaining. Limited buying power for opportunities.`,
    );
  } else if (cashPercent > 80) {
    warnings.push(
      `  NOTE: ${cashPercent.toFixed(1)}% cash — very defensive positioning. Missing potential returns.`,
    );
  }

  // Check for large unrealized losses
  for (const pos of portfolio.positions) {
    if (pos.unrealizedPnlPercent < -10) {
      warnings.push(
        `  WARNING: ${pos.symbol} is down ${Math.abs(pos.unrealizedPnlPercent).toFixed(1)}%. Consider a stop-loss exit.`,
      );
    }
  }

  // Check overall portfolio drawdown
  if (portfolio.totalPnlPercent < -5) {
    warnings.push(
      `  ALERT: Portfolio is down ${Math.abs(portfolio.totalPnlPercent).toFixed(1)}%. Risk management is critical right now.`,
    );
  }

  // Check for correlated positions
  const techPositions = portfolio.positions.filter((p) =>
    ["NVDAx", "AMZNx", "GOOGLx", "METAx", "MSFTx", "AAPLx"].includes(p.symbol),
  );
  if (techPositions.length >= 3) {
    const techValue = techPositions.reduce(
      (sum, p) => sum + p.currentPrice * p.quantity,
      0,
    );
    const techPercent = (techValue / portfolio.totalValue) * 100;
    if (techPercent > 40) {
      warnings.push(
        `  WARNING: ${techPercent.toFixed(1)}% in tech stocks (${techPositions.map((p) => p.symbol).join(", ")}). High sector correlation risk.`,
      );
    }
  }

  if (warnings.length === 0) return "";

  return ["RISK ASSESSMENT:", ...warnings].join("\n");
}

// ---------------------------------------------------------------------------
// Sentiment Section
// ---------------------------------------------------------------------------

function buildSentimentSection(
  breadth: MarketBreadth,
  indicators: TechnicalIndicators[],
): string {
  const lines: string[] = ["MARKET SENTIMENT:"];

  // Compute overall sentiment from breadth
  let sentimentScore: number;
  if (breadth.regime === "bull") {
    sentimentScore = 50 + breadth.regimeConfidence * 0.5;
  } else if (breadth.regime === "bear") {
    sentimentScore = 50 - breadth.regimeConfidence * 0.5;
  } else if (breadth.regime === "volatile") {
    sentimentScore = 50; // Neutral but uncertain
  } else {
    sentimentScore = 50 + breadth.averageChange * 5;
  }
  sentimentScore = Math.max(0, Math.min(100, sentimentScore));

  let moodLabel: string;
  if (sentimentScore >= 80) moodLabel = "EXTREME GREED";
  else if (sentimentScore >= 65) moodLabel = "GREED";
  else if (sentimentScore >= 55) moodLabel = "MILDLY BULLISH";
  else if (sentimentScore >= 45) moodLabel = "NEUTRAL";
  else if (sentimentScore >= 35) moodLabel = "MILDLY BEARISH";
  else if (sentimentScore >= 20) moodLabel = "FEAR";
  else moodLabel = "EXTREME FEAR";

  lines.push(`  Market Mood: ${moodLabel} (score: ${Math.round(sentimentScore)}/100)`);

  // Count overbought/oversold stocks
  const overbought = indicators.filter((i) => i.rsi14 !== null && i.rsi14 > 70);
  const oversold = indicators.filter((i) => i.rsi14 !== null && i.rsi14 < 30);

  if (overbought.length > 0) {
    lines.push(
      `  Overbought (RSI > 70): ${overbought.map((i) => i.symbol).join(", ")} — potential sell signals`,
    );
  }
  if (oversold.length > 0) {
    lines.push(
      `  Oversold (RSI < 30): ${oversold.map((i) => i.symbol).join(", ")} — potential buy signals`,
    );
  }

  // Trend consensus
  const upTrends = indicators.filter((i) => i.trend === "up" && i.signalStrength >= 60);
  const downTrends = indicators.filter((i) => i.trend === "down" && i.signalStrength >= 60);

  if (upTrends.length > downTrends.length * 2) {
    lines.push("  SIGNAL: Strong bullish consensus across multiple stocks.");
  } else if (downTrends.length > upTrends.length * 2) {
    lines.push("  SIGNAL: Strong bearish consensus across multiple stocks.");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimeAgo(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) return `${diffDays}d ago`;
  if (diffHours > 0) return `${diffHours}h ago`;
  if (diffMins > 0) return `${diffMins}m ago`;
  return "just now";
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

/**
 * Get enricher statistics for the dashboard.
 */
export function getEnricherStats(): EnricherStats {
  const avgSize =
    contextSizes.length > 0
      ? Math.round(contextSizes.reduce((a, b) => a + b, 0) / contextSizes.length)
      : 0;

  return {
    totalEnrichments,
    enrichmentsByAgent: { ...enrichmentsByAgent },
    averageContextSize: avgSize,
    lastEnrichmentAt,
    indicatorCoverage: XSTOCKS_CATALOG.length,
    memoryCoverage: Object.keys(enrichmentsByAgent).length,
  };
}

/**
 * Reset enricher stats (admin use).
 */
export function resetEnricherStats(): void {
  totalEnrichments = 0;
  Object.keys(enrichmentsByAgent).forEach((k) => delete enrichmentsByAgent[k]);
  contextSizes = [];
  lastEnrichmentAt = null;
}
