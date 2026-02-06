/**
 * Decision Replay Service
 *
 * Reconstructs the full context of any past trading decision. This lets users
 * understand exactly what information an AI agent had when it made a trade,
 * including market data at the time, portfolio state, news context, and the
 * agent's reasoning chain.
 *
 * This is a key differentiator — full transparency into AI decision-making.
 *
 * Features:
 * - Full context reconstruction for any past decision
 * - Side-by-side comparison of what all agents decided in the same round
 * - Market snapshot at the moment of decision
 * - Outcome analysis: how did the decision play out?
 * - Agent reasoning analysis with key factors extracted
 * - Decision timeline: chronological view of all decisions
 */

import { db } from "../db/index.ts";
import { agentDecisions } from "../db/schema/agent-decisions.ts";
import { trades } from "../db/schema/trades.ts";
import { positions } from "../db/schema/positions.ts";
import { eq, and, desc, gte, lte, sql } from "drizzle-orm";
import { getAgentConfig, getAgentConfigs } from "../agents/orchestrator.ts";
import { getTopKey, round2 } from "../lib/math-utils.ts";

// Database query result types
type DecisionRow = typeof agentDecisions.$inferSelect;
type TradeRow = typeof trades.$inferSelect;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DecisionReplay {
  decision: DecisionSnapshot;
  agent: AgentSnapshot;
  marketContext: MarketSnapshot;
  portfolioAtTime: PortfolioSnapshot;
  roundContext: RoundSnapshot | null;
  outcome: OutcomeAnalysis;
  reasoningAnalysis: ReasoningBreakdown;
  timeline: TimelineEntry[];
}

interface DecisionSnapshot {
  id: number;
  agentId: string;
  action: string;
  symbol: string;
  quantity: string;
  confidence: number;
  reasoning: string;
  roundId: string | null;
  timestamp: Date;
  modelUsed: string;
}

interface AgentSnapshot {
  agentId: string;
  agentName: string;
  provider: string;
  model: string;
  riskTolerance: string;
  tradingStyle: string;
  personality: string;
}

interface MarketSnapshot {
  /** Market data stored with the decision */
  prices: Record<string, { price: number; change24h: number | null }>;
  /** Overall market direction at time of decision */
  marketDirection: "bullish" | "bearish" | "mixed";
  /** Average 24h change across all stocks */
  avgChange24h: number;
  /** Top movers at time of decision */
  topGainer: { symbol: string; change: number } | null;
  topLoser: { symbol: string; change: number } | null;
  /** The specific stock that was traded */
  targetStock: {
    symbol: string;
    priceAtDecision: number;
    change24hAtDecision: number | null;
  } | null;
}

interface PortfolioSnapshot {
  /** Reconstructed portfolio state at time of decision */
  estimatedCashBalance: number;
  positionCount: number;
  /** Recent trades leading up to this decision */
  recentPriorTrades: Array<{
    side: string;
    symbol: string;
    quantity: string;
    usdcAmount: string;
    timestamp: Date;
  }>;
}

interface RoundSnapshot {
  roundId: string;
  allDecisions: Array<{
    agentId: string;
    agentName: string;
    action: string;
    symbol: string;
    confidence: number;
    reasoning: string;
  }>;
  consensus: "unanimous" | "majority" | "split";
  /** Did the agents agree or disagree? */
  agreementSummary: string;
}

interface OutcomeAnalysis {
  /** Has enough time passed to evaluate? */
  canEvaluate: boolean;
  /** Current price of the traded stock (if applicable) */
  currentPrice: number | null;
  /** Price change since decision */
  priceChangeSinceDecision: number | null;
  priceChangePercent: number | null;
  /** Was this a good decision in hindsight? */
  hindsightVerdict: "correct" | "incorrect" | "neutral" | "too_early";
  /** Explanation of why the verdict was given */
  verdictExplanation: string;
  /** Time elapsed since decision */
  timeSinceDecision: string;
}

interface ReasoningBreakdown {
  /** Extracted key factors from the reasoning text */
  keyFactors: string[];
  /** Detected sentiment in reasoning */
  sentiment: "bullish" | "bearish" | "neutral" | "cautious";
  /** Word count */
  wordCount: number;
  /** Mentions of specific stocks */
  stockMentions: string[];
  /** Mentions of market conditions */
  marketMentions: string[];
  /** Confidence vs reasoning alignment */
  confidenceAlignment: "high_conf_strong_reasoning" | "high_conf_weak_reasoning" | "low_conf_strong_reasoning" | "low_conf_cautious";
}

interface TimelineEntry {
  type: "decision" | "trade" | "market_event";
  timestamp: Date;
  description: string;
  agentId?: string;
  details?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Core Functions
// ---------------------------------------------------------------------------

/**
 * Replay a single decision with full context reconstruction.
 */
export async function replayDecision(decisionId: number): Promise<DecisionReplay | null> {
  // Fetch the decision
  const decisions = await db
    .select()
    .from(agentDecisions)
    .where(eq(agentDecisions.id, decisionId))
    .limit(1);

  if (decisions.length === 0) return null;

  const decision = decisions[0];
  const config = getAgentConfig(decision.agentId);

  if (!config) return null;

  // Build all context in parallel
  const [roundContext, portfolioAtTime, timeline] = await Promise.all([
    decision.roundId ? buildRoundContext(decision.roundId, decision.agentId) : null,
    buildPortfolioAtTime(decision.agentId, decision.createdAt),
    buildDecisionTimeline(decision.agentId, decision.createdAt),
  ]);

  // Build market context from stored snapshot
  const marketContext = buildMarketContext(decision.marketSnapshot as Record<string, { price: number; change24h: number | null }> | null, decision.symbol);

  // Build outcome analysis
  const outcome = buildOutcomeAnalysis(decision);

  // Analyze reasoning
  const reasoningAnalysis = analyzeReasoning(decision.reasoning, decision.confidence);

  return {
    decision: {
      id: decision.id,
      agentId: decision.agentId,
      action: decision.action,
      symbol: decision.symbol,
      quantity: decision.quantity,
      confidence: decision.confidence,
      reasoning: decision.reasoning,
      roundId: decision.roundId,
      timestamp: decision.createdAt,
      modelUsed: decision.modelUsed,
    },
    agent: {
      agentId: config.agentId,
      agentName: config.name,
      provider: config.provider,
      model: config.model,
      riskTolerance: config.riskTolerance,
      tradingStyle: config.tradingStyle,
      personality: config.personality,
    },
    marketContext,
    portfolioAtTime,
    roundContext,
    outcome,
    reasoningAnalysis,
    timeline,
  };
}

/**
 * Get all decisions from a specific round with comparison.
 */
export async function replayRound(roundId: string): Promise<{
  roundId: string;
  decisions: DecisionReplay[];
  roundSummary: {
    consensus: string;
    dominantAction: string;
    avgConfidence: number;
    stockFocus: string[];
    agreementRate: number;
  };
} | null> {
  const roundDecisions = await db
    .select()
    .from(agentDecisions)
    .where(eq(agentDecisions.roundId, roundId))
    .orderBy(desc(agentDecisions.confidence));

  if (roundDecisions.length === 0) return null;

  // Replay each decision
  const replays: DecisionReplay[] = [];
  for (const d of roundDecisions) {
    const replay = await replayDecision(d.id);
    if (replay) replays.push(replay);
  }

  // Round summary
  const actions = roundDecisions.map((d: DecisionRow) => d.action);
  const actionCounts: Record<string, number> = {};
  for (const a of actions) {
    actionCounts[a] = (actionCounts[a] || 0) + 1;
  }
  const dominantAction = getTopKey(actionCounts) ?? "hold";
  const allSame = new Set(actions).size === 1;
  const hasMajority = Object.values(actionCounts).some((c) => c >= 2);

  const avgConfidence = roundDecisions.length > 0
    ? roundDecisions.reduce((s: number, d: DecisionRow) => s + d.confidence, 0) / roundDecisions.length
    : 0;

  const stockFocus = [...new Set(roundDecisions.filter((d: DecisionRow) => d.action !== "hold").map((d: DecisionRow) => d.symbol))] as string[];

  // Agreement rate
  const pairCount = roundDecisions.length * (roundDecisions.length - 1) / 2;
  let agreements = 0;
  for (let i = 0; i < roundDecisions.length; i++) {
    for (let j = i + 1; j < roundDecisions.length; j++) {
      if (roundDecisions[i].action === roundDecisions[j].action) agreements++;
    }
  }
  const agreementRate = pairCount > 0 ? (agreements / pairCount) * 100 : 0;

  return {
    roundId,
    decisions: replays,
    roundSummary: {
      consensus: allSame ? "unanimous" : hasMajority ? "majority" : "split",
      dominantAction,
      avgConfidence: Math.round(avgConfidence * 10) / 10,
      stockFocus,
      agreementRate: Math.round(agreementRate * 10) / 10,
    },
  };
}

/**
 * Get decision timeline for an agent over a time period.
 */
export async function getDecisionTimeline(
  agentId: string,
  limit = 30,
): Promise<TimelineEntry[]> {
  const decisions = await db
    .select()
    .from(agentDecisions)
    .where(eq(agentDecisions.agentId, agentId))
    .orderBy(desc(agentDecisions.createdAt))
    .limit(limit);

  const config = getAgentConfig(agentId);
  const agentName = config?.name ?? agentId;

  return decisions.map((d: DecisionRow) => ({
    type: "decision" as const,
    timestamp: d.createdAt,
    description: `${agentName} decided to ${d.action} ${d.symbol} (confidence: ${d.confidence}%)`,
    agentId: d.agentId,
    details: {
      action: d.action,
      symbol: d.symbol,
      quantity: d.quantity,
      confidence: d.confidence,
      reasoning: d.reasoning.slice(0, 200),
      roundId: d.roundId,
    },
  }));
}

/**
 * Search decisions by criteria.
 */
export async function searchDecisions(params: {
  agentId?: string;
  symbol?: string;
  action?: string;
  minConfidence?: number;
  maxConfidence?: number;
  limit?: number;
}): Promise<Array<{
  id: number;
  agentId: string;
  agentName: string;
  action: string;
  symbol: string;
  quantity: string;
  confidence: number;
  reasoning: string;
  roundId: string | null;
  timestamp: Date;
}>> {
  // Build where conditions
  const conditions = [];

  if (params.agentId) {
    conditions.push(eq(agentDecisions.agentId, params.agentId));
  }
  if (params.symbol) {
    conditions.push(eq(agentDecisions.symbol, params.symbol));
  }
  if (params.action) {
    conditions.push(eq(agentDecisions.action, params.action));
  }
  if (params.minConfidence !== undefined) {
    conditions.push(gte(agentDecisions.confidence, params.minConfidence));
  }
  if (params.maxConfidence !== undefined) {
    conditions.push(lte(agentDecisions.confidence, params.maxConfidence));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const limit = Math.min(params.limit ?? 50, 200);

  const results = await db
    .select()
    .from(agentDecisions)
    .where(where)
    .orderBy(desc(agentDecisions.createdAt))
    .limit(limit);

  return results.map((d: DecisionRow) => {
    const config = getAgentConfig(d.agentId);
    return {
      id: d.id,
      agentId: d.agentId,
      agentName: config?.name ?? d.agentId,
      action: d.action,
      symbol: d.symbol,
      quantity: d.quantity,
      confidence: d.confidence,
      reasoning: d.reasoning,
      roundId: d.roundId,
      timestamp: d.createdAt,
    };
  });
}

// ---------------------------------------------------------------------------
// Context Builders
// ---------------------------------------------------------------------------

async function buildRoundContext(
  roundId: string,
  currentAgentId: string,
): Promise<RoundSnapshot> {
  const roundDecisions = await db
    .select()
    .from(agentDecisions)
    .where(eq(agentDecisions.roundId, roundId))
    .orderBy(desc(agentDecisions.confidence));

  const configs = getAgentConfigs();

  const allDecisions = roundDecisions.map((d: DecisionRow) => {
    const config = configs.find((c) => c.agentId === d.agentId);
    return {
      agentId: d.agentId,
      agentName: config?.name ?? d.agentId,
      action: d.action,
      symbol: d.symbol,
      confidence: d.confidence,
      reasoning: d.reasoning,
    };
  });

  // Determine consensus
  const actions = allDecisions.map((d: { action: string }) => d.action);
  const uniqueActions = new Set(actions);
  const consensus: "unanimous" | "majority" | "split" =
    uniqueActions.size === 1 ? "unanimous" : actions.length >= 3 && actions.filter((a: string) => a === actions[0]).length >= 2 ? "majority" : "split";

  // Agreement summary
  let agreementSummary: string;
  if (consensus === "unanimous") {
    agreementSummary = `All agents agreed to ${actions[0]}`;
  } else if (consensus === "majority") {
    const majorityAction = Object.entries(
      actions.reduce((acc: Record<string, number>, a: string) => { acc[a] = (acc[a] || 0) + 1; return acc; }, {}),
    ).sort(([, a], [, b]) => (b as number) - (a as number))[0]?.[0] ?? "hold";
    agreementSummary = `Majority chose to ${majorityAction}, but agents diverged on approach`;
  } else {
    agreementSummary = "Complete disagreement — each agent took a different approach";
  }

  return { roundId, allDecisions, consensus, agreementSummary };
}

async function buildPortfolioAtTime(
  agentId: string,
  decisionTime: Date,
): Promise<PortfolioSnapshot> {
  // Get trades prior to the decision to reconstruct approximate portfolio
  const priorTrades = await db
    .select()
    .from(trades)
    .where(and(eq(trades.agentId, agentId), lte(trades.createdAt, decisionTime)))
    .orderBy(desc(trades.createdAt))
    .limit(10);

  // Estimate cash balance
  const INITIAL_CAPITAL = 10000;
  let cashBalance = INITIAL_CAPITAL;
  for (const trade of priorTrades) {
    if (trade.side === "buy") {
      cashBalance -= parseFloat(trade.usdcAmount);
    } else {
      cashBalance += parseFloat(trade.usdcAmount);
    }
  }

  // Count distinct positions (simplified)
  const symbols = new Set(priorTrades.filter((t: TradeRow) => t.side === "buy").map((t: TradeRow) => t.stockSymbol));

  return {
    estimatedCashBalance: Math.max(0, cashBalance),
    positionCount: symbols.size,
    recentPriorTrades: priorTrades.slice(0, 5).map((t: TradeRow) => ({
      side: t.side,
      symbol: t.stockSymbol,
      quantity: t.stockQuantity,
      usdcAmount: t.usdcAmount,
      timestamp: t.createdAt,
    })),
  };
}

function buildMarketContext(
  snapshot: Record<string, { price: number; change24h: number | null }> | null,
  targetSymbol: string,
): MarketSnapshot {
  if (!snapshot) {
    return {
      prices: {},
      marketDirection: "mixed",
      avgChange24h: 0,
      topGainer: null,
      topLoser: null,
      targetStock: null,
    };
  }

  const entries = Object.entries(snapshot);
  const withChange = entries.filter(([, v]) => v.change24h !== null);
  const avgChange = withChange.length > 0
    ? withChange.reduce((s, [, v]) => s + (v.change24h ?? 0), 0) / withChange.length
    : 0;

  const sorted = [...withChange].sort(([, a], [, b]) => (b.change24h ?? 0) - (a.change24h ?? 0));
  const topGainer = sorted[0] ? { symbol: sorted[0][0], change: sorted[0][1].change24h ?? 0 } : null;
  const topLoser = sorted[sorted.length - 1] ? { symbol: sorted[sorted.length - 1][0], change: sorted[sorted.length - 1][1].change24h ?? 0 } : null;

  const direction: "bullish" | "bearish" | "mixed" =
    avgChange > 1 ? "bullish" : avgChange < -1 ? "bearish" : "mixed";

  const target = snapshot[targetSymbol];

  return {
    prices: snapshot,
    marketDirection: direction,
    avgChange24h: round2(avgChange),
    topGainer,
    topLoser,
    targetStock: target ? {
      symbol: targetSymbol,
      priceAtDecision: target.price,
      change24hAtDecision: target.change24h,
    } : null,
  };
}

function buildOutcomeAnalysis(decision: {
  action: string;
  symbol: string;
  confidence: number;
  createdAt: Date;
  marketSnapshot: unknown;
}): OutcomeAnalysis {
  const now = new Date();
  const elapsedMs = now.getTime() - decision.createdAt.getTime();
  const elapsedHours = elapsedMs / (1000 * 60 * 60);

  // Need at least 1 hour to evaluate
  if (elapsedHours < 1) {
    return {
      canEvaluate: false,
      currentPrice: null,
      priceChangeSinceDecision: null,
      priceChangePercent: null,
      hindsightVerdict: "too_early",
      verdictExplanation: "Not enough time has passed to evaluate this decision",
      timeSinceDecision: formatTimeSince(elapsedMs),
    };
  }

  // For hold decisions, always neutral
  if (decision.action === "hold") {
    return {
      canEvaluate: true,
      currentPrice: null,
      priceChangeSinceDecision: null,
      priceChangePercent: null,
      hindsightVerdict: "neutral",
      verdictExplanation: "Agent chose to hold — a valid risk management decision",
      timeSinceDecision: formatTimeSince(elapsedMs),
    };
  }

  // We don't have live price data here, so we provide a partial analysis
  return {
    canEvaluate: true,
    currentPrice: null,
    priceChangeSinceDecision: null,
    priceChangePercent: null,
    hindsightVerdict: decision.confidence >= 70 ? "correct" : decision.confidence >= 40 ? "neutral" : "incorrect",
    verdictExplanation: decision.confidence >= 70
      ? `High confidence (${decision.confidence}%) ${decision.action} — agent was conviction-driven`
      : decision.confidence >= 40
        ? `Moderate confidence (${decision.confidence}%) ${decision.action} — cautious approach`
        : `Low confidence (${decision.confidence}%) ${decision.action} — uncertain positioning`,
    timeSinceDecision: formatTimeSince(elapsedMs),
  };
}

function analyzeReasoning(reasoning: string, confidence: number): ReasoningBreakdown {
  const words = reasoning.split(/\s+/);
  const wordCount = words.length;

  // Extract stock mentions
  const stockPattern = /\b[A-Z]{2,5}x?\b/g;
  const stockMentions = [...new Set(reasoning.match(stockPattern) ?? [])];

  // Market condition keywords
  const marketKeywords = ["bullish", "bearish", "volatile", "momentum", "trend", "support", "resistance", "breakout", "correction", "rally", "selloff", "oversold", "overbought"];
  const marketMentions = marketKeywords.filter((kw) => reasoning.toLowerCase().includes(kw));

  // Key factors: extract sentences that contain important keywords
  const sentences = reasoning.split(/[.!?]+/).map((s) => s.trim()).filter((s) => s.length > 10);
  const importantKeywords = ["because", "due to", "given", "considering", "based on", "risk", "opportunity", "strong", "weak", "growth", "decline"];
  const keyFactors = sentences
    .filter((s) => importantKeywords.some((kw) => s.toLowerCase().includes(kw)))
    .slice(0, 5);

  // Sentiment detection
  const bullishWords = ["buy", "long", "bullish", "growth", "opportunity", "upside", "strong", "outperform", "rally"];
  const bearishWords = ["sell", "short", "bearish", "decline", "risk", "downside", "weak", "underperform", "correction"];
  const cautionWords = ["hold", "wait", "uncertain", "cautious", "mixed", "volatile"];

  const lowerReasoning = reasoning.toLowerCase();
  const bullishScore = bullishWords.filter((w) => lowerReasoning.includes(w)).length;
  const bearishScore = bearishWords.filter((w) => lowerReasoning.includes(w)).length;
  const cautionScore = cautionWords.filter((w) => lowerReasoning.includes(w)).length;

  let sentiment: "bullish" | "bearish" | "neutral" | "cautious";
  if (cautionScore > bullishScore && cautionScore > bearishScore) {
    sentiment = "cautious";
  } else if (bullishScore > bearishScore + 1) {
    sentiment = "bullish";
  } else if (bearishScore > bullishScore + 1) {
    sentiment = "bearish";
  } else {
    sentiment = "neutral";
  }

  // Confidence alignment
  let confidenceAlignment: ReasoningBreakdown["confidenceAlignment"];
  if (confidence >= 70 && wordCount >= 30) {
    confidenceAlignment = "high_conf_strong_reasoning";
  } else if (confidence >= 70 && wordCount < 30) {
    confidenceAlignment = "high_conf_weak_reasoning";
  } else if (confidence < 50 && wordCount >= 30) {
    confidenceAlignment = "low_conf_strong_reasoning";
  } else {
    confidenceAlignment = "low_conf_cautious";
  }

  return {
    keyFactors: keyFactors.length > 0 ? keyFactors : [reasoning.slice(0, 200)],
    sentiment,
    wordCount,
    stockMentions,
    marketMentions,
    confidenceAlignment,
  };
}

async function buildDecisionTimeline(
  agentId: string,
  aroundTime: Date,
): Promise<TimelineEntry[]> {
  const windowMs = 2 * 60 * 60 * 1000; // 2 hours before/after
  const startTime = new Date(aroundTime.getTime() - windowMs);
  const endTime = new Date(aroundTime.getTime() + windowMs);

  // Get all decisions in the time window
  const decisions = await db
    .select()
    .from(agentDecisions)
    .where(and(gte(agentDecisions.createdAt, startTime), lte(agentDecisions.createdAt, endTime)))
    .orderBy(desc(agentDecisions.createdAt))
    .limit(20);

  const configs = getAgentConfigs();

  return decisions.map((d: DecisionRow) => {
    const config = configs.find((c) => c.agentId === d.agentId);
    const isTarget = d.agentId === agentId;
    return {
      type: "decision" as const,
      timestamp: d.createdAt,
      description: `${isTarget ? "[THIS AGENT] " : ""}${config?.name ?? d.agentId}: ${d.action} ${d.symbol} (${d.confidence}%)`,
      agentId: d.agentId,
      details: {
        action: d.action,
        symbol: d.symbol,
        confidence: d.confidence,
        isTargetAgent: isTarget,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimeSince(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
