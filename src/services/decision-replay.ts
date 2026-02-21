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
import { eq, and, desc, gte, lte } from "drizzle-orm";
import { getAgentConfig, getAgentConfigs } from "../agents/orchestrator.ts";
import { getTopKey, round2, groupByKey, sortEntriesDescending, countByCondition } from "../lib/math-utils.ts";

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
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * VERDICT CONFIDENCE THRESHOLDS
 *
 * Control how decision outcomes are classified based on agent confidence level.
 * Higher thresholds = stricter standards for "correct" verdicts.
 */

/**
 * High confidence threshold for verdict classification.
 * Decisions with confidence >= this value are labeled "correct" (conviction-driven).
 */
const VERDICT_CONFIDENCE_CORRECT = 70;

/**
 * Neutral confidence threshold for verdict classification.
 * Decisions with confidence >= this value but < CORRECT are labeled "neutral" (cautious approach).
 */
const VERDICT_CONFIDENCE_NEUTRAL = 40;

/**
 * REASONING STRENGTH ANALYSIS THRESHOLDS
 *
 * Control how reasoning quality is classified based on confidence and word count.
 * Used to detect misalignment between conviction and reasoning depth.
 */

/**
 * High confidence threshold for reasoning alignment analysis.
 * Confidence >= this value expects strong reasoning (word count check applied).
 */
const REASONING_HIGH_CONFIDENCE_THRESHOLD = 70;

/**
 * Minimum word count for "strong reasoning" classification.
 * Reasoning with >= this many words is considered substantive.
 */
const REASONING_MIN_WORDS_STRONG = 30;

/**
 * Low confidence boundary for reasoning alignment.
 * Confidence < this value with strong reasoning = "low_conf_strong_reasoning" (interesting divergence).
 */
const REASONING_LOW_CONFIDENCE_THRESHOLD = 50;

/**
 * QUERY LIMITS
 *
 * Control how many records are fetched from database for context reconstruction.
 */

/**
 * Maximum prior trades to fetch when reconstructing portfolio state at decision time.
 */
const PORTFOLIO_PRIOR_TRADES_LIMIT = 10;

/**
 * Maximum decisions to fetch when building decision timeline (2-hour window around target decision).
 */
const TIMELINE_DECISIONS_LIMIT = 20;

/**
 * DECISION TIMELINE QUERY PARAMETERS
 *
 * Control pagination behavior for the getDecisionTimeline() API endpoint.
 */

/**
 * Default number of decisions returned by getDecisionTimeline() when no limit is specified.
 *
 * 50 decisions covers roughly 2-3 rounds per agent across all 3 agents, giving a meaningful
 * slice of recent activity without bloating API responses.
 *
 * Formula: getDecisionTimeline() → decisions.slice(0, DEFAULT_DECISION_TIMELINE_LIMIT)
 * Example: Agent has 200 decisions stored → API returns most recent 50 by default.
 */
const DEFAULT_DECISION_TIMELINE_LIMIT = 50;

/**
 * Maximum number of decisions that can be requested in a single getDecisionTimeline() call.
 *
 * Hard cap prevents clients from fetching the entire decision history in one request,
 * which could produce very large JSON payloads and slow database scans.
 *
 * Formula: Math.min(requestedLimit ?? DEFAULT_DECISION_TIMELINE_LIMIT, MAX_DECISION_TIMELINE_LIMIT)
 * Example: Client requests limit=500 → capped to 200; limit=30 → returns 30 as-is.
 */
const MAX_DECISION_TIMELINE_LIMIT = 200;

/**
 * DISPLAY LIMITS
 *
 * Control how many characters/records are shown in UI responses.
 */

/**
 * Maximum characters to show in reasoning snippet previews (timeline entries).
 */
const REASONING_SNIPPET_LIMIT = 200;

/**
 * TIME CONVERSION CONSTANTS
 *
 * Standard conversion factors for formatting elapsed time.
 */

/**
 * Minutes per hour for time formatting.
 */
const MINUTES_PER_HOUR = 60;

/**
 * Hours per day for time formatting.
 */
const HOURS_PER_DAY = 24;

/**
 * PORTFOLIO RECONSTRUCTION PARAMETERS
 *
 * Control how portfolio state is estimated when replaying historical decisions.
 */

/**
 * Initial capital allocated to each agent at start of trading.
 * Used to estimate cash balance by subtracting all prior trades.
 */
const INITIAL_CAPITAL = 10000;

/**
 * Maximum recent trades to display in portfolio snapshot.
 * Shows the N most recent trades leading up to the decision.
 */
const PORTFOLIO_RECENT_TRADES_DISPLAY_LIMIT = 5;

/**
 * Maximum key factors to extract from reasoning text.
 * Filters sentences containing important keywords (e.g., "because", "risk", "opportunity")
 * and shows the top N most relevant sentences in decision analysis.
 * Lower value = more focused analysis; higher value = more verbose forensics.
 * Example: Agent reasoning with 12 keyword-matching sentences → show top 5.
 */
const KEY_FACTORS_DISPLAY_LIMIT = 5;

/**
 * MARKET DIRECTION CLASSIFICATION THRESHOLDS
 *
 * Control how market sentiment is classified based on average 24h price change.
 */

/**
 * Bullish market threshold (avg 24h change).
 * avgChange > this value = "bullish" market direction.
 */
const MARKET_DIRECTION_BULLISH_THRESHOLD = 1;

/**
 * Bearish market threshold (avg 24h change).
 * avgChange < negative of this value = "bearish" market direction.
 */
const MARKET_DIRECTION_BEARISH_THRESHOLD = -1;

/**
 * DECISION TIMELINE WINDOW
 *
 * Control how much historical context is shown around a decision.
 */

/**
 * Time window (in milliseconds) before/after the decision to include in timeline.
 * 2 hours = 2 * 60 * 60 * 1000 = 7,200,000 ms.
 */
const TIMELINE_WINDOW_MS = 2 * 60 * 60 * 1000;

/**
 * CONSENSUS DETECTION THRESHOLDS
 *
 * Control how round consensus is classified based on agent agreement.
 */

/**
 * Minimum agents required for majority consensus detection.
 * Need at least this many agents to classify as "majority".
 */
const CONSENSUS_MIN_AGENTS = 3;

/**
 * Minimum agreements required for majority consensus.
 * Need at least this many agents agreeing on same action for "majority" classification.
 */
const CONSENSUS_MIN_AGREEMENTS = 2;

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
  const actionGroups = groupByKey(roundDecisions as DecisionRow[], 'action');
  const actionCounts = Object.fromEntries(
    Object.entries(actionGroups).map(([action, items]) => [action, items.length]),
  );
  const dominantAction = getTopKey(actionCounts) ?? "hold";
  const allSame = Object.keys(actionCounts).length === 1;
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
      reasoning: d.reasoning.slice(0, REASONING_SNIPPET_LIMIT),
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
  const limit = Math.min(params.limit ?? DEFAULT_DECISION_TIMELINE_LIMIT, MAX_DECISION_TIMELINE_LIMIT);

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

  const allDecisions: Array<{
    agentId: string;
    agentName: string;
    action: string;
    symbol: string;
    confidence: number;
    reasoning: string;
  }> = roundDecisions.map((d: DecisionRow) => {
    const config = configs.find((c) => c.agentId === d.agentId);
    return {
      agentId: d.agentId,
      agentName: config?.name ?? d.agentId,
      action: d.action,
      symbol: d.symbol ?? "",
      confidence: d.confidence,
      reasoning: d.reasoning,
    };
  });

  // Determine consensus
  const actions = allDecisions.map((d: { action: string }) => d.action);
  const uniqueActions = new Set(actions);
  const consensus: "unanimous" | "majority" | "split" =
    uniqueActions.size === 1 ? "unanimous" : actions.length >= CONSENSUS_MIN_AGENTS && countByCondition(actions, (a: string) => a === actions[0]) >= CONSENSUS_MIN_AGREEMENTS ? "majority" : "split";

  // Agreement summary
  let agreementSummary: string;
  if (consensus === "unanimous") {
    agreementSummary = `All agents agreed to ${actions[0]}`;
  } else if (consensus === "majority") {
    const actionGroups = groupByKey(allDecisions, 'action');
    const actionCounts = Object.fromEntries(
      Object.entries(actionGroups).map(([action, items]) => [action, items.length]),
    );
    const majorityAction = sortEntriesDescending(actionCounts)[0]?.[0] ?? "hold";
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
    .limit(PORTFOLIO_PRIOR_TRADES_LIMIT);

  // Estimate cash balance
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
    recentPriorTrades: priorTrades.slice(0, PORTFOLIO_RECENT_TRADES_DISPLAY_LIMIT).map((t: TradeRow) => ({
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
    avgChange > MARKET_DIRECTION_BULLISH_THRESHOLD ? "bullish" : avgChange < MARKET_DIRECTION_BEARISH_THRESHOLD ? "bearish" : "mixed";

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
    hindsightVerdict: decision.confidence >= VERDICT_CONFIDENCE_CORRECT ? "correct" : decision.confidence >= VERDICT_CONFIDENCE_NEUTRAL ? "neutral" : "incorrect",
    verdictExplanation: decision.confidence >= VERDICT_CONFIDENCE_CORRECT
      ? `High confidence (${decision.confidence}%) ${decision.action} — agent was conviction-driven`
      : decision.confidence >= VERDICT_CONFIDENCE_NEUTRAL
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
    .slice(0, KEY_FACTORS_DISPLAY_LIMIT);

  // Sentiment detection
  const bullishWords = ["buy", "long", "bullish", "growth", "opportunity", "upside", "strong", "outperform", "rally"];
  const bearishWords = ["sell", "short", "bearish", "decline", "risk", "downside", "weak", "underperform", "correction"];
  const cautionWords = ["hold", "wait", "uncertain", "cautious", "mixed", "volatile"];

  const lowerReasoning = reasoning.toLowerCase();
  const bullishScore = countByCondition(bullishWords, (w) => lowerReasoning.includes(w));
  const bearishScore = countByCondition(bearishWords, (w) => lowerReasoning.includes(w));
  const cautionScore = countByCondition(cautionWords, (w) => lowerReasoning.includes(w));

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
  if (confidence >= REASONING_HIGH_CONFIDENCE_THRESHOLD && wordCount >= REASONING_MIN_WORDS_STRONG) {
    confidenceAlignment = "high_conf_strong_reasoning";
  } else if (confidence >= REASONING_HIGH_CONFIDENCE_THRESHOLD && wordCount < REASONING_MIN_WORDS_STRONG) {
    confidenceAlignment = "high_conf_weak_reasoning";
  } else if (confidence < REASONING_LOW_CONFIDENCE_THRESHOLD && wordCount >= REASONING_MIN_WORDS_STRONG) {
    confidenceAlignment = "low_conf_strong_reasoning";
  } else {
    confidenceAlignment = "low_conf_cautious";
  }

  return {
    keyFactors: keyFactors.length > 0 ? keyFactors : [reasoning.slice(0, REASONING_SNIPPET_LIMIT)],
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
  const startTime = new Date(aroundTime.getTime() - TIMELINE_WINDOW_MS);
  const endTime = new Date(aroundTime.getTime() + TIMELINE_WINDOW_MS);

  // Get all decisions in the time window
  const decisions = await db
    .select()
    .from(agentDecisions)
    .where(and(gte(agentDecisions.createdAt, startTime), lte(agentDecisions.createdAt, endTime)))
    .orderBy(desc(agentDecisions.createdAt))
    .limit(TIMELINE_DECISIONS_LIMIT);

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
  if (minutes < MINUTES_PER_HOUR) return `${minutes}m ago`;
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  if (hours < HOURS_PER_DAY) return `${hours}h ago`;
  const days = Math.floor(hours / HOURS_PER_DAY);
  return `${days}d ago`;
}
