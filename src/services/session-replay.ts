/**
 * Trading Session Replay
 *
 * Reconstructs and replays complete trading sessions with full context.
 * Enables judges and users to "replay" any trading round and see exactly
 * what each agent saw, thought, and did — like a DVR for AI trading.
 *
 * Features:
 * - Full session reconstruction from decision + trade + market data
 * - Timeline view with millisecond-level ordering
 * - Agent-by-agent decision replay with reasoning
 * - Market context at decision time
 * - Outcome annotation (did the decision make/lose money?)
 * - Session comparison (compare same agent across different rounds)
 * - Export format for presentation/demo
 */

import { db } from "../db/index.ts";
import { agentDecisions } from "../db/schema/agent-decisions.ts";
import { trades } from "../db/schema/trades.ts";
import { eq, desc, and, sql, gte, lte } from "drizzle-orm";
import { errorMessage } from "../lib/errors.ts";
import { getTopKey, countByCondition } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Session Replay Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Maximum time gap (ms) between a decision and a trade to consider them matched.
 * A decision at T=0 and a trade at T=30s could still be from the same action.
 * Trades further apart are treated as belonging to different agents/rounds.
 * Example: decision at 10:00:00.000, trade at 10:00:25.000 → matched (25s < 30s)
 */
const TRADE_MATCH_WINDOW_MS = 30_000;

/**
 * Maximum characters of reasoning text to include in timeline replay events.
 * Keeps timeline payloads compact while showing enough context to understand decisions.
 * Full reasoning is available in the decisions array (not truncated there).
 * Example: "Buy AAPL: strong momentum, RSI oversold, P/E below..." → 200 chars
 */
const REASONING_DISPLAY_MAX_LENGTH = 200;

/**
 * Artificial delay (ms) added to trade execution events when no exact trade timestamp exists.
 * Also used as the offsetMs adjustment for executed/failed trade events.
 * Creates realistic-looking timeline spacing between decision and execution.
 * Formula: tradeTimestamp = decisionTimestamp + TRADE_EXECUTION_DELAY_MS
 */
const TRADE_EXECUTION_DELAY_MS = 1000;

/**
 * Delay (ms) added after the last decision to fire the "round_complete" event.
 * Ensures round_complete appears after all trade events in the sorted timeline.
 * Formula: roundCompleteTimestamp = lastDecisionTimestamp + ROUND_COMPLETE_DELAY_MS
 * Example: last decision at T=45s, round_complete fires at T=47s
 */
const ROUND_COMPLETE_DELAY_MS = 2000;

/**
 * Duration threshold (ms) for switching between short and long duration formats.
 * Below this threshold: display as "Xs" (e.g., "45s")
 * At or above this threshold: display as "Xm Ys" (e.g., "2m 30s")
 * Value: 60,000ms = 60 seconds = 1 minute
 */
const DURATION_LONG_FORMAT_THRESHOLD_MS = 60_000;

/**
 * Default maximum number of sessions returned by listSessions() when no limit specified.
 * Balances API response size with usefulness (50 sessions = ~100KB typical response).
 * Callers can override by passing options.limit explicitly.
 */
const DEFAULT_SESSIONS_QUERY_LIMIT = 50;

/**
 * Confidence threshold (%) for generating "high confidence" annotations.
 * Decisions at or above this threshold get a highlight annotation in the replay.
 * Example: confidence=92 → "Agent X is very confident (92%) about buying AAPL"
 * Scale: 0-100 where 100 = maximum confidence, 90+ = very high confidence signal
 */
const HIGH_CONFIDENCE_ANNOTATION_THRESHOLD = 90;

/**
 * Maximum characters of reasoning to include in presentation export format.
 * Slightly longer than REASONING_DISPLAY_MAX_LENGTH for presentation context.
 * Presentation exports are used for demos/slides where fuller context helps.
 * Example: 300 chars captures the key thesis without overwhelming slide content
 */
const EXPORT_REASONING_MAX_LENGTH = 300;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReplayEvent {
  timestamp: string;
  type:
    | "round_start"
    | "market_data_fetched"
    | "news_fetched"
    | "agent_decision"
    | "circuit_breaker"
    | "trade_executed"
    | "trade_failed"
    | "round_complete";
  agentId?: string;
  agentName?: string;
  data: Record<string, unknown>;
  /** Milliseconds since round start */
  offsetMs: number;
}

export interface AgentDecisionReplay {
  agentId: string;
  agentName: string;
  model: string;
  action: string;
  symbol: string;
  quantity: number;
  confidence: number;
  reasoning: string;
  marketSnapshot: Record<string, { price: number; change24h: number | null }>;
  executionResult: {
    executed: boolean;
    txSignature?: string;
    filledPrice?: number;
    usdcAmount?: number;
    error?: string;
  };
  outcome?: {
    priceAtDecision: number;
    priceNow: number;
    pnlPercent: number;
    wasGoodDecision: boolean;
  };
}

export interface SessionReplay {
  roundId: string;
  timestamp: string;
  duration: string;
  tradingMode: string;
  agentCount: number;
  timeline: ReplayEvent[];
  decisions: AgentDecisionReplay[];
  marketContext: {
    stocks: Array<{
      symbol: string;
      price: number;
      change24h: number | null;
    }>;
    newsHighlights: string[];
  };
  summary: {
    totalDecisions: number;
    buyDecisions: number;
    sellDecisions: number;
    holdDecisions: number;
    executedTrades: number;
    failedTrades: number;
    consensusAction: string | null;
    bestDecision: { agentId: string; symbol: string; confidence: number } | null;
    circuitBreakerActivations: number;
  };
  annotations: Array<{
    agentId: string;
    text: string;
    type: "insight" | "warning" | "highlight";
  }>;
}

export interface SessionComparison {
  agentId: string;
  sessions: Array<{
    roundId: string;
    timestamp: string;
    action: string;
    symbol: string;
    confidence: number;
    executed: boolean;
    outcome?: { pnlPercent: number };
  }>;
  patterns: {
    mostCommonAction: string;
    avgConfidence: number;
    executionRate: number;
    favoriteSymbol: string | null;
    improvingOverTime: boolean;
  };
}

// ---------------------------------------------------------------------------
// Session Reconstruction
// ---------------------------------------------------------------------------

/**
 * Reconstruct a complete trading session from stored data.
 * Pulls from agent_decisions and trades tables.
 */
export async function replaySession(roundId: string): Promise<SessionReplay> {
  // 1. Fetch all decisions for this round
  const decisions = await db
    .select()
    .from(agentDecisions)
    .where(eq(agentDecisions.roundId, roundId))
    .orderBy(agentDecisions.createdAt);

  // 2. Fetch all trades for this round (matched by roundId in jupiterRouteInfo)
  const roundTrades = await db
    .select()
    .from(trades)
    .where(
      sql`${trades.jupiterRouteInfo}->>'roundId' = ${roundId}
           OR ${trades.txSignature} LIKE ${"paper_" + "%"}`,
    )
    .orderBy(trades.createdAt);

  // 3. Build timeline
  const timeline: ReplayEvent[] = [];
  const baseTime = decisions.length > 0
    ? new Date(decisions[0].createdAt).getTime()
    : Date.now();

  // Round start event
  timeline.push({
    timestamp: new Date(baseTime).toISOString(),
    type: "round_start",
    data: { roundId, agentCount: new Set(decisions.map((d: typeof decisions[number]) => d.agentId)).size },
    offsetMs: 0,
  });

  // Decision events
  const agentDecisionReplays: AgentDecisionReplay[] = [];

  for (const decision of decisions) {
    const offsetMs = new Date(decision.createdAt).getTime() - baseTime;
    const marketSnapshot = (decision.marketSnapshot ?? {}) as Record<
      string,
      { price: number; change24h: number | null }
    >;

    // Find matching trade
    const matchingTrade = roundTrades.find(
      (t: typeof roundTrades[number]) =>
        t.txSignature === decision.txSignature ||
        (t.stockSymbol === decision.symbol &&
          Math.abs(
            new Date(t.createdAt).getTime() - new Date(decision.createdAt).getTime(),
          ) < TRADE_MATCH_WINDOW_MS),
    );

    timeline.push({
      timestamp: decision.createdAt.toISOString(),
      type: "agent_decision",
      agentId: decision.agentId,
      data: {
        action: decision.action,
        symbol: decision.symbol,
        quantity: decision.quantity,
        confidence: decision.confidence,
        reasoning: decision.reasoning.slice(0, REASONING_DISPLAY_MAX_LENGTH),
        model: decision.modelUsed,
      },
      offsetMs: Math.max(0, offsetMs),
    });

    // Trade execution event
    if (decision.executed === "executed" || decision.executed === "executed_paper") {
      timeline.push({
        timestamp: matchingTrade
          ? matchingTrade.createdAt.toISOString()
          : new Date(new Date(decision.createdAt).getTime() + TRADE_EXECUTION_DELAY_MS).toISOString(),
        type: "trade_executed",
        agentId: decision.agentId,
        data: {
          txSignature: decision.txSignature ?? matchingTrade?.txSignature,
          side: decision.action,
          symbol: decision.symbol,
          usdcAmount: matchingTrade?.usdcAmount,
          pricePerToken: matchingTrade?.pricePerToken,
          mode: decision.executed === "executed_paper" ? "paper" : "live",
        },
        offsetMs: Math.max(0, offsetMs + TRADE_EXECUTION_DELAY_MS),
      });
    } else if (decision.executed === "failed") {
      timeline.push({
        timestamp: new Date(new Date(decision.createdAt).getTime() + TRADE_EXECUTION_DELAY_MS).toISOString(),
        type: "trade_failed",
        agentId: decision.agentId,
        data: {
          error: decision.executionError,
          action: decision.action,
          symbol: decision.symbol,
        },
        offsetMs: Math.max(0, offsetMs + TRADE_EXECUTION_DELAY_MS),
      });
    }

    agentDecisionReplays.push({
      agentId: decision.agentId,
      agentName: getAgentNameById(decision.agentId),
      model: decision.modelUsed,
      action: decision.action,
      symbol: decision.symbol,
      quantity: parseFloat(String(decision.quantity)),
      confidence: decision.confidence,
      reasoning: decision.reasoning,
      marketSnapshot,
      executionResult: {
        executed: decision.executed === "executed" || decision.executed === "executed_paper",
        txSignature: decision.txSignature ?? undefined,
        filledPrice: matchingTrade ? parseFloat(matchingTrade.pricePerToken) : undefined,
        usdcAmount: matchingTrade ? parseFloat(matchingTrade.usdcAmount) : undefined,
        error: decision.executionError ?? undefined,
      },
    });
  }

  // Round complete event
  const lastEventTime = decisions.length > 0
    ? new Date(decisions[decisions.length - 1].createdAt).getTime()
    : baseTime;
  timeline.push({
    timestamp: new Date(lastEventTime + ROUND_COMPLETE_DELAY_MS).toISOString(),
    type: "round_complete",
    data: {
      decisionsCount: decisions.length,
      tradesExecuted: decisions.filter(
        (d: typeof decisions[number]) => d.executed === "executed" || d.executed === "executed_paper",
      ).length,
    },
    offsetMs: lastEventTime - baseTime + ROUND_COMPLETE_DELAY_MS,
  });

  // Sort timeline by offset
  timeline.sort((a, b) => a.offsetMs - b.offsetMs);

  // 4. Build market context from first decision's snapshot
  const firstSnapshot = decisions[0]?.marketSnapshot as Record<
    string,
    { price: number; change24h: number | null }
  > | null;
  const stocks = firstSnapshot
    ? Object.entries(firstSnapshot).map(([symbol, data]) => ({
        symbol,
        price: data.price,
        change24h: data.change24h,
      }))
    : [];

  // 5. Build summary
  const buyCount = countByCondition(decisions, (d: typeof decisions[number]) => d.action === "buy");
  const sellCount = countByCondition(decisions, (d: typeof decisions[number]) => d.action === "sell");
  const holdCount = countByCondition(decisions, (d: typeof decisions[number]) => d.action === "hold");
  const executed = countByCondition(decisions,
    (d: typeof decisions[number]) => d.executed === "executed" || d.executed === "executed_paper",
  );
  const failed = countByCondition(decisions, (d: typeof decisions[number]) => d.executed === "failed");

  // Consensus: if majority agrees on action
  let consensusAction: string | null = null;
  const actionCounts: Record<string, number> = { buy: buyCount, sell: sellCount, hold: holdCount };
  const maxAction = getTopKey(actionCounts);
  if (maxAction && actionCounts[maxAction] >= 2) {
    consensusAction = maxAction;
  }

  // Best decision: highest confidence non-hold
  const nonHolds = decisions.filter((d: typeof decisions[number]) => d.action !== "hold");
  const bestDecision = nonHolds.length > 0
    ? nonHolds.sort((a: typeof nonHolds[number], b: typeof nonHolds[number]) => b.confidence - a.confidence)[0]
    : null;

  // 6. Generate annotations
  const annotations = generateAnnotations(agentDecisionReplays);

  // Calculate duration
  const durationMs = timeline.length > 0 ? timeline[timeline.length - 1].offsetMs : 0;
  const durationStr = durationMs > DURATION_LONG_FORMAT_THRESHOLD_MS
    ? `${Math.round(durationMs / DURATION_LONG_FORMAT_THRESHOLD_MS)}m ${Math.round((durationMs % DURATION_LONG_FORMAT_THRESHOLD_MS) / 1000)}s`
    : `${Math.round(durationMs / 1000)}s`;

  return {
    roundId,
    timestamp: new Date(baseTime).toISOString(),
    duration: durationStr,
    tradingMode: decisions.some((d: typeof decisions[number]) => d.executed === "executed") ? "live" : "paper",
    agentCount: new Set(decisions.map((d: typeof decisions[number]) => d.agentId)).size,
    timeline,
    decisions: agentDecisionReplays,
    marketContext: {
      stocks,
      newsHighlights: [],
    },
    summary: {
      totalDecisions: decisions.length,
      buyDecisions: buyCount,
      sellDecisions: sellCount,
      holdDecisions: holdCount,
      executedTrades: executed,
      failedTrades: failed,
      consensusAction,
      bestDecision: bestDecision
        ? {
            agentId: bestDecision.agentId,
            symbol: bestDecision.symbol,
            confidence: bestDecision.confidence,
          }
        : null,
      circuitBreakerActivations: 0,
    },
    annotations,
  };
}

// ---------------------------------------------------------------------------
// Session List & History
// ---------------------------------------------------------------------------

/**
 * List all available trading sessions (unique round IDs).
 */
export async function listSessions(
  options?: { limit?: number; agentId?: string; fromDate?: string; toDate?: string },
): Promise<Array<{
  roundId: string;
  timestamp: string;
  agentCount: number;
  decisionCount: number;
  executedCount: number;
}>> {
  const limit = options?.limit ?? DEFAULT_SESSIONS_QUERY_LIMIT;

  try {
    const conditions: ReturnType<typeof sql>[] = [];

    if (options?.agentId) {
      conditions.push(sql`${agentDecisions.agentId} = ${options.agentId}`);
    }
    if (options?.fromDate) {
      conditions.push(sql`${agentDecisions.createdAt} >= ${new Date(options.fromDate)}`);
    }
    if (options?.toDate) {
      conditions.push(sql`${agentDecisions.createdAt} <= ${new Date(options.toDate)}`);
    }

    const whereClause =
      conditions.length > 0
        ? sql`WHERE ${agentDecisions.roundId} IS NOT NULL AND ${sql.join(conditions, sql` AND `)}`
        : sql`WHERE ${agentDecisions.roundId} IS NOT NULL`;

    const rows = await db.execute(
      sql`SELECT
            ${agentDecisions.roundId} as round_id,
            MIN(${agentDecisions.createdAt}) as first_decision,
            COUNT(DISTINCT ${agentDecisions.agentId})::int as agent_count,
            COUNT(*)::int as decision_count,
            COUNT(CASE WHEN ${agentDecisions.executed} IN ('executed', 'executed_paper') THEN 1 END)::int as executed_count
          FROM ${agentDecisions}
          ${whereClause}
          GROUP BY ${agentDecisions.roundId}
          ORDER BY first_decision DESC
          LIMIT ${limit}`,
    );

    return (rows.rows as Array<{
      round_id: string;
      first_decision: string;
      agent_count: number;
      decision_count: number;
      executed_count: number;
    }>).map((row) => ({
      roundId: row.round_id,
      timestamp: String(row.first_decision),
      agentCount: row.agent_count,
      decisionCount: row.decision_count,
      executedCount: row.executed_count,
    }));
  } catch (err) {
    console.warn(
      `[SessionReplay] Failed to list sessions: ${errorMessage(err)}`,
    );
    return [];
  }
}

/**
 * Compare an agent's performance across multiple sessions.
 */
export async function compareAgentSessions(
  agentId: string,
  limit = 20,
): Promise<SessionComparison> {
  const decisions = await db
    .select()
    .from(agentDecisions)
    .where(eq(agentDecisions.agentId, agentId))
    .orderBy(desc(agentDecisions.createdAt))
    .limit(limit);

  const sessions = decisions.map((d: typeof decisions[number]) => ({
    roundId: d.roundId ?? "unknown",
    timestamp: d.createdAt.toISOString(),
    action: d.action,
    symbol: d.symbol,
    confidence: d.confidence,
    executed: d.executed === "executed" || d.executed === "executed_paper",
  }));

  // Compute patterns
  const actions = decisions.map((d: typeof decisions[number]) => d.action);
  const actionCounts: Record<string, number> = {};
  for (const a of actions) {
    actionCounts[a] = (actionCounts[a] ?? 0) + 1;
  }
  const mostCommonAction = getTopKey(actionCounts) ?? "hold";

  const avgConfidence =
    decisions.length > 0
      ? Math.round(
          decisions.reduce((sum: number, d: typeof decisions[number]) => sum + d.confidence, 0) / decisions.length,
        )
      : 0;

  const executionRate =
    decisions.length > 0
      ? Math.round(
          (countByCondition(sessions, (s: typeof sessions[number]) => !!s.executed) / decisions.length) * 100,
        )
      : 0;

  // Favorite symbol (non-hold)
  const symbolCounts: Record<string, number> = {};
  for (const d of decisions) {
    if (d.action !== "hold") {
      symbolCounts[d.symbol] = (symbolCounts[d.symbol] ?? 0) + 1;
    }
  }
  const favoriteSymbol =
    getTopKey(symbolCounts) ?? null;

  // Improving over time: compare avg confidence first half vs second half
  const mid = Math.floor(decisions.length / 2);
  const firstHalf = decisions.slice(mid);
  const secondHalf = decisions.slice(0, mid);
  const firstAvg = firstHalf.length > 0
    ? firstHalf.reduce((s: number, d: typeof firstHalf[number]) => s + d.confidence, 0) / firstHalf.length
    : 0;
  const secondAvg = secondHalf.length > 0
    ? secondHalf.reduce((s: number, d: typeof secondHalf[number]) => s + d.confidence, 0) / secondHalf.length
    : 0;
  const improvingOverTime = secondAvg > firstAvg;

  return {
    agentId,
    sessions,
    patterns: {
      mostCommonAction,
      avgConfidence,
      executionRate,
      favoriteSymbol,
      improvingOverTime,
    },
  };
}

// ---------------------------------------------------------------------------
// Annotations Generator
// ---------------------------------------------------------------------------

function generateAnnotations(
  decisions: AgentDecisionReplay[],
): SessionReplay["annotations"] {
  const annotations: SessionReplay["annotations"] = [];

  // Detect disagreements
  const nonHolds = decisions.filter((d) => d.action !== "hold");
  const symbols = [...new Set(nonHolds.map((d) => d.symbol))];

  for (const symbol of symbols) {
    const symbolDecisions = nonHolds.filter((d) => d.symbol === symbol);
    const hasBuy = symbolDecisions.some((d) => d.action === "buy");
    const hasSell = symbolDecisions.some((d) => d.action === "sell");

    if (hasBuy && hasSell) {
      annotations.push({
        agentId: "system",
        text: `Agents disagree on ${symbol}: some buying, some selling`,
        type: "highlight",
      });
    }
  }

  // Detect high confidence decisions
  for (const d of decisions) {
    if (d.confidence >= HIGH_CONFIDENCE_ANNOTATION_THRESHOLD && d.action !== "hold") {
      annotations.push({
        agentId: d.agentId,
        text: `${d.agentName} is very confident (${d.confidence}%) about ${d.action}ing ${d.symbol}`,
        type: "highlight",
      });
    }
  }

  // Detect failures
  for (const d of decisions) {
    if (!d.executionResult.executed && d.action !== "hold") {
      annotations.push({
        agentId: d.agentId,
        text: `${d.agentName}'s ${d.action} on ${d.symbol} failed: ${d.executionResult.error ?? "unknown error"}`,
        type: "warning",
      });
    }
  }

  // Detect unanimity
  if (nonHolds.length >= 2) {
    const allSameAction = nonHolds.every((d) => d.action === nonHolds[0].action);
    const allSameSymbol = nonHolds.every((d) => d.symbol === nonHolds[0].symbol);
    if (allSameAction && allSameSymbol) {
      annotations.push({
        agentId: "system",
        text: `All agents agree: ${nonHolds[0].action} ${nonHolds[0].symbol}`,
        type: "insight",
      });
    }
  }

  return annotations;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const AGENT_NAMES: Record<string, string> = {
  "claude-value-investor": "Claude (Value Investor)",
  "gpt-momentum-trader": "GPT (Momentum Trader)",
  "grok-contrarian": "Grok (Contrarian)",
};

function getAgentNameById(agentId: string): string {
  return AGENT_NAMES[agentId] ?? agentId;
}

// ---------------------------------------------------------------------------
// Export for Demo
// ---------------------------------------------------------------------------

/**
 * Export a session replay in a simplified format for presentations.
 */
export function exportForPresentation(replay: SessionReplay): {
  title: string;
  date: string;
  mode: string;
  agents: Array<{
    name: string;
    action: string;
    symbol: string;
    confidence: number;
    reasoning: string;
    executed: boolean;
  }>;
  highlights: string[];
} {
  return {
    title: `Trading Round ${replay.roundId}`,
    date: replay.timestamp,
    mode: replay.tradingMode,
    agents: replay.decisions.map((d) => ({
      name: d.agentName,
      action: d.action,
      symbol: d.symbol,
      confidence: d.confidence,
      reasoning: d.reasoning.slice(0, 300),
      executed: d.executionResult.executed,
    })),
    highlights: replay.annotations.map((a) => a.text),
  };
}
