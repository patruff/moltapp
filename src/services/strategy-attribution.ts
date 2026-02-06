/**
 * Strategy Attribution Service
 *
 * Analyzes which trading INTENTS (momentum, value, contrarian, etc.)
 * produce the best returns across all agents. This is a key benchmark
 * insight: it's not just about WHICH agent wins, but WHICH STRATEGIES win.
 *
 * Attribution dimensions:
 * 1. INTENT P&L: Which strategy intents produce the best returns?
 * 2. AGENT-INTENT MATRIX: Which agents are best at which strategies?
 * 3. MARKET REGIME ALIGNMENT: Which strategies work in which conditions?
 * 4. CONFIDENCE-INTENT CORRELATION: Do agents have justified confidence per strategy?
 * 5. COHERENCE BY INTENT: Which strategies produce the most coherent reasoning?
 */

import type { TradingIntent } from "../schemas/trade-reasoning.ts";
import { getTopKey, round2, averageByKey } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TradeRecord {
  agentId: string;
  action: "buy" | "sell" | "hold";
  symbol: string;
  intent: string;
  confidence: number;
  coherenceScore: number;
  hallucinationCount: number;
  pnlPercent: number | null;
  outcome: "profit" | "loss" | "breakeven" | "pending";
  timestamp: string;
}

export interface IntentAttribution {
  /** Strategy intent being measured */
  intent: string;
  /** Number of trades using this intent */
  tradeCount: number;
  /** Average P&L across trades with known outcomes */
  avgPnlPercent: number;
  /** Win rate (% profitable) */
  winRate: number;
  /** Average confidence when using this intent */
  avgConfidence: number;
  /** Average coherence score */
  avgCoherence: number;
  /** Average hallucination count */
  avgHallucinations: number;
  /** Best single trade P&L */
  bestTradePnl: number;
  /** Worst single trade P&L */
  worstTradePnl: number;
  /** Most common action (buy/sell/hold) */
  dominantAction: string;
  /** Most traded symbols */
  topSymbols: Array<{ symbol: string; count: number }>;
}

export interface AgentIntentMatrix {
  /** Agent ID */
  agentId: string;
  /** Per-intent performance breakdown */
  intents: Array<{
    intent: string;
    tradeCount: number;
    avgPnl: number;
    winRate: number;
    avgConfidence: number;
    avgCoherence: number;
  }>;
  /** Agent's best-performing intent */
  bestIntent: string | null;
  /** Agent's worst-performing intent */
  worstIntent: string | null;
  /** Diversity score: how many different intents agent uses (0-1) */
  strategyDiversity: number;
}

export interface StrategyAttributionReport {
  /** Overall intent rankings by P&L */
  intentRankings: IntentAttribution[];
  /** Per-agent intent performance */
  agentMatrix: AgentIntentMatrix[];
  /** Best agent-intent combinations */
  bestCombinations: Array<{
    agentId: string;
    intent: string;
    avgPnl: number;
    tradeCount: number;
  }>;
  /** Aggregate statistics */
  stats: {
    totalTrades: number;
    totalWithOutcomes: number;
    uniqueIntents: number;
    overallWinRate: number;
    overallAvgPnl: number;
  };
  /** Timestamp */
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const tradeRecords: TradeRecord[] = [];
const MAX_RECORDS = 5000;

// ---------------------------------------------------------------------------
// Record Trades
// ---------------------------------------------------------------------------

/**
 * Record a trade for strategy attribution analysis.
 * Called after a trade's outcome is determined.
 */
export function recordTradeForAttribution(record: TradeRecord): void {
  tradeRecords.unshift(record);
  if (tradeRecords.length > MAX_RECORDS) {
    tradeRecords.length = MAX_RECORDS;
  }
}

/**
 * Batch-record trades (e.g., from DB query).
 */
export function batchRecordTrades(records: TradeRecord[]): void {
  for (const r of records) {
    recordTradeForAttribution(r);
  }
}

// ---------------------------------------------------------------------------
// Core Analysis
// ---------------------------------------------------------------------------

/**
 * Generate the full strategy attribution report.
 */
export function generateAttributionReport(): StrategyAttributionReport {
  const withOutcomes = tradeRecords.filter(
    (t) => t.pnlPercent !== null && t.outcome !== "pending",
  );

  // 1. Intent rankings
  const intentRankings = computeIntentRankings(tradeRecords, withOutcomes);

  // 2. Agent-intent matrix
  const agentMatrix = computeAgentIntentMatrix(tradeRecords, withOutcomes);

  // 3. Best combinations
  const bestCombinations = findBestCombinations(withOutcomes);

  // 4. Stats
  const overallWinRate = withOutcomes.length > 0
    ? withOutcomes.filter((t) => t.outcome === "profit").length / withOutcomes.length
    : 0;
  const overallAvgPnl = withOutcomes.length > 0
    ? withOutcomes.reduce((s, t) => s + (t.pnlPercent ?? 0), 0) / withOutcomes.length
    : 0;

  const uniqueIntents = new Set(tradeRecords.map((t) => t.intent)).size;

  return {
    intentRankings,
    agentMatrix,
    bestCombinations,
    stats: {
      totalTrades: tradeRecords.length,
      totalWithOutcomes: withOutcomes.length,
      uniqueIntents,
      overallWinRate: round2(overallWinRate),
      overallAvgPnl: round2(overallAvgPnl),
    },
    generatedAt: new Date().toISOString(),
  };
}

function computeIntentRankings(
  allTrades: TradeRecord[],
  withOutcomes: TradeRecord[],
): IntentAttribution[] {
  const intents = new Set(allTrades.map((t) => t.intent));
  const rankings: IntentAttribution[] = [];

  for (const intent of intents) {
    const intentTrades = allTrades.filter((t) => t.intent === intent);
    const intentWithOutcomes = withOutcomes.filter((t) => t.intent === intent);

    const wins = intentWithOutcomes.filter((t) => t.outcome === "profit").length;
    const winRate = intentWithOutcomes.length > 0 ? wins / intentWithOutcomes.length : 0;

    const avgPnl = intentWithOutcomes.length > 0
      ? intentWithOutcomes.reduce((s, t) => s + (t.pnlPercent ?? 0), 0) / intentWithOutcomes.length
      : 0;

    const pnls = intentWithOutcomes
      .map((t) => t.pnlPercent ?? 0)
      .sort((a, b) => b - a);

    // Count actions
    const actionCounts: Record<string, number> = {};
    for (const t of intentTrades) {
      actionCounts[t.action] = (actionCounts[t.action] ?? 0) + 1;
    }
    const dominantAction = getTopKey(actionCounts) ?? "hold";

    // Count symbols
    const symbolCounts = new Map<string, number>();
    for (const t of intentTrades) {
      symbolCounts.set(t.symbol, (symbolCounts.get(t.symbol) ?? 0) + 1);
    }
    const topSymbols = [...symbolCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([symbol, count]) => ({ symbol, count }));

    rankings.push({
      intent,
      tradeCount: intentTrades.length,
      avgPnlPercent: round2(avgPnl),
      winRate: round2(winRate),
      avgConfidence: round2(averageByKey(intentTrades, 'confidence')),
      avgCoherence: round2(averageByKey(intentTrades, 'coherenceScore')),
      avgHallucinations: round2(averageByKey(intentTrades, 'hallucinationCount')),
      bestTradePnl: pnls.length > 0 ? round2(pnls[0]) : 0,
      worstTradePnl: pnls.length > 0 ? round2(pnls[pnls.length - 1]) : 0,
      dominantAction,
      topSymbols,
    });
  }

  // Sort by average P&L descending
  rankings.sort((a, b) => b.avgPnlPercent - a.avgPnlPercent);
  return rankings;
}

function computeAgentIntentMatrix(
  allTrades: TradeRecord[],
  withOutcomes: TradeRecord[],
): AgentIntentMatrix[] {
  const agentIds = [...new Set(allTrades.map((t) => t.agentId))];
  const allIntents = [...new Set(allTrades.map((t) => t.intent))];
  const matrix: AgentIntentMatrix[] = [];

  for (const agentId of agentIds) {
    const agentTrades = allTrades.filter((t) => t.agentId === agentId);
    const agentWithOutcomes = withOutcomes.filter((t) => t.agentId === agentId);
    const agentIntents = new Set(agentTrades.map((t) => t.intent));

    const intents: AgentIntentMatrix["intents"] = [];
    let bestIntent: string | null = null;
    let bestPnl = -Infinity;
    let worstIntent: string | null = null;
    let worstPnl = Infinity;

    for (const intent of agentIntents) {
      const trades = agentTrades.filter((t) => t.intent === intent);
      const outcomes = agentWithOutcomes.filter((t) => t.intent === intent);

      const avgPnl = outcomes.length > 0
        ? outcomes.reduce((s, t) => s + (t.pnlPercent ?? 0), 0) / outcomes.length
        : 0;
      const wins = outcomes.filter((t) => t.outcome === "profit").length;
      const winRate = outcomes.length > 0 ? wins / outcomes.length : 0;

      if (outcomes.length >= 2 && avgPnl > bestPnl) {
        bestPnl = avgPnl;
        bestIntent = intent;
      }
      if (outcomes.length >= 2 && avgPnl < worstPnl) {
        worstPnl = avgPnl;
        worstIntent = intent;
      }

      intents.push({
        intent,
        tradeCount: trades.length,
        avgPnl: round2(avgPnl),
        winRate: round2(winRate),
        avgConfidence: round2(averageByKey(trades, 'confidence')),
        avgCoherence: round2(averageByKey(trades, 'coherenceScore')),
      });
    }

    // Strategy diversity: what fraction of all possible intents does this agent use?
    const strategyDiversity = allIntents.length > 0
      ? round2(agentIntents.size / allIntents.length)
      : 0;

    matrix.push({
      agentId,
      intents,
      bestIntent,
      worstIntent,
      strategyDiversity,
    });
  }

  return matrix;
}

function findBestCombinations(
  withOutcomes: TradeRecord[],
): StrategyAttributionReport["bestCombinations"] {
  const combos = new Map<string, { pnls: number[]; count: number }>();

  for (const t of withOutcomes) {
    const key = `${t.agentId}:${t.intent}`;
    const existing = combos.get(key) ?? { pnls: [], count: 0 };
    existing.pnls.push(t.pnlPercent ?? 0);
    existing.count++;
    combos.set(key, existing);
  }

  return [...combos.entries()]
    .filter(([, data]) => data.count >= 2) // Need at least 2 trades
    .map(([key, data]) => {
      const [agentId, intent] = key.split(":");
      const avgPnl = data.pnls.reduce((a, b) => a + b, 0) / data.pnls.length;
      return {
        agentId,
        intent,
        avgPnl: round2(avgPnl),
        tradeCount: data.count,
      };
    })
    .sort((a, b) => b.avgPnl - a.avgPnl)
    .slice(0, 10);
}

// ---------------------------------------------------------------------------
// Query API
// ---------------------------------------------------------------------------

/**
 * Get intent rankings only (lighter query).
 */
export function getIntentRankings(): IntentAttribution[] {
  const withOutcomes = tradeRecords.filter(
    (t) => t.pnlPercent !== null && t.outcome !== "pending",
  );
  return computeIntentRankings(tradeRecords, withOutcomes);
}

/**
 * Get a specific agent's intent performance.
 */
export function getAgentIntentProfile(agentId: string): AgentIntentMatrix | null {
  const allTrades = tradeRecords.filter((t) => t.agentId === agentId);
  if (allTrades.length === 0) return null;

  const withOutcomes = allTrades.filter(
    (t) => t.pnlPercent !== null && t.outcome !== "pending",
  );
  const allIntents = [...new Set(tradeRecords.map((t) => t.intent))];

  const agentIntents = new Set(allTrades.map((t) => t.intent));
  const intents: AgentIntentMatrix["intents"] = [];
  let bestIntent: string | null = null;
  let bestPnl = -Infinity;
  let worstIntent: string | null = null;
  let worstPnl = Infinity;

  for (const intent of agentIntents) {
    const trades = allTrades.filter((t) => t.intent === intent);
    const outcomes = withOutcomes.filter((t) => t.intent === intent);
    const avgPnl = outcomes.length > 0
      ? outcomes.reduce((s, t) => s + (t.pnlPercent ?? 0), 0) / outcomes.length
      : 0;
    const wins = outcomes.filter((t) => t.outcome === "profit").length;
    const winRate = outcomes.length > 0 ? wins / outcomes.length : 0;

    if (outcomes.length >= 2 && avgPnl > bestPnl) {
      bestPnl = avgPnl;
      bestIntent = intent;
    }
    if (outcomes.length >= 2 && avgPnl < worstPnl) {
      worstPnl = avgPnl;
      worstIntent = intent;
    }

    intents.push({
      intent,
      tradeCount: trades.length,
      avgPnl: round2(avgPnl),
      winRate: round2(winRate),
      avgConfidence: round2(averageByKey(trades, 'confidence')),
      avgCoherence: round2(averageByKey(trades, 'coherenceScore')),
    });
  }

  return {
    agentId,
    intents,
    bestIntent,
    worstIntent,
    strategyDiversity: allIntents.length > 0
      ? round2(agentIntents.size / allIntents.length)
      : 0,
  };
}
