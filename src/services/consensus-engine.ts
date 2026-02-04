/**
 * Multi-Agent Consensus Engine
 *
 * Analyzes decisions from all 3 AI trading agents (Claude, GPT, Grok) and
 * detects consensus — when 2 or more agents independently agree on a trade.
 *
 * Consensus signals are powerful: if multiple AIs with different architectures,
 * training data, and personalities arrive at the same conclusion, the signal
 * is stronger than any individual agent.
 *
 * Features:
 * - Real-time consensus detection across trading rounds
 * - Weighted consensus scoring (higher confidence = more weight)
 * - Historical consensus accuracy tracking
 * - Divergence detection (when agents strongly disagree)
 * - Consensus streaks and patterns
 * - Sector-level consensus aggregation
 * - Consensus-boosted confidence for the execution engine
 */

import { db } from "../db/index.ts";
import { agentDecisions } from "../db/schema/agent-decisions.ts";
import { trades } from "../db/schema/trades.ts";
import { eq, desc, sql, and, gte, inArray } from "drizzle-orm";
import type { TradingDecision, TradingRoundResult } from "../agents/base-agent.ts";
import { XSTOCKS_CATALOG } from "../config/constants.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConsensusSignal {
  /** Unique round ID */
  roundId: string;
  /** Stock symbol the consensus is about */
  symbol: string;
  /** Consensus action: buy/sell/hold */
  action: "buy" | "sell" | "hold";
  /** Number of agents that agree (2 or 3) */
  agentCount: number;
  /** Which agents agree */
  agreeingAgents: string[];
  /** Which agents dissent */
  dissentingAgents: string[];
  /** Weighted consensus confidence (0-100) */
  confidence: number;
  /** Individual confidence scores from each agreeing agent */
  individualConfidences: Record<string, number>;
  /** Average quantity (USDC for buys, shares for sells) */
  averageQuantity: number;
  /** Consensus strength: "unanimous" (3/3), "majority" (2/3) */
  strength: "unanimous" | "majority";
  /** Combined reasoning from all agreeing agents */
  combinedReasoning: string;
  /** Timestamp */
  timestamp: string;
}

export interface ConsensusDivergence {
  /** Round ID */
  roundId: string;
  /** Symbol where agents disagree */
  symbol: string;
  /** Each agent's decision */
  decisions: Array<{
    agentId: string;
    action: "buy" | "sell" | "hold";
    confidence: number;
    reasoning: string;
  }>;
  /** Divergence score: higher = more disagreement (0-100) */
  divergenceScore: number;
  /** Whether there's a bull/bear split (one buys, another sells) */
  isBullBearSplit: boolean;
  /** Timestamp */
  timestamp: string;
}

export interface ConsensusAccuracy {
  /** Total consensus signals generated */
  totalSignals: number;
  /** Signals that led to profitable outcomes */
  profitableCount: number;
  /** Overall accuracy rate (0-100%) */
  accuracyRate: number;
  /** Accuracy by strength */
  byStrength: {
    unanimous: { count: number; profitable: number; accuracy: number };
    majority: { count: number; profitable: number; accuracy: number };
  };
  /** Accuracy by action */
  byAction: {
    buy: { count: number; profitable: number; accuracy: number };
    sell: { count: number; profitable: number; accuracy: number };
  };
  /** Accuracy by symbol */
  bySymbol: Record<
    string,
    { count: number; profitable: number; accuracy: number }
  >;
  /** Average consensus confidence vs average outcome */
  avgConfidence: number;
  /** Average return when following consensus (%) */
  avgReturnPercent: number;
}

export interface ConsensusHistory {
  /** Recent consensus signals */
  signals: ConsensusSignal[];
  /** Recent divergences */
  divergences: ConsensusDivergence[];
  /** Current consensus streak (consecutive profitable consensus signals) */
  currentStreak: number;
  /** Longest streak ever */
  longestStreak: number;
  /** Sector-level consensus summary */
  sectorConsensus: Record<
    string,
    {
      sentiment: "bullish" | "bearish" | "neutral";
      agentsBullish: number;
      agentsBearish: number;
      latestSignal: ConsensusSignal | null;
    }
  >;
}

export interface RoundConsensusResult {
  /** Consensus signals detected in this round */
  signals: ConsensusSignal[];
  /** Divergence events in this round */
  divergences: ConsensusDivergence[];
  /** Summary stats */
  summary: {
    totalDecisions: number;
    consensusCount: number;
    divergenceCount: number;
    strongestSignal: ConsensusSignal | null;
    strongestDivergence: ConsensusDivergence | null;
  };
}

// ---------------------------------------------------------------------------
// In-memory consensus state (flushed to DB periodically)
// ---------------------------------------------------------------------------

interface ConsensusState {
  /** All consensus signals by round ID */
  signalsByRound: Map<string, ConsensusSignal[]>;
  /** All divergences by round ID */
  divergencesByRound: Map<string, ConsensusDivergence[]>;
  /** Consensus outcome tracking for accuracy */
  outcomes: Array<{
    signal: ConsensusSignal;
    outcome: "profitable" | "unprofitable" | "pending";
    returnPercent: number;
  }>;
  /** Current profitable consensus streak */
  currentStreak: number;
  /** Longest profitable consensus streak */
  longestStreak: number;
}

const state: ConsensusState = {
  signalsByRound: new Map(),
  divergencesByRound: new Map(),
  outcomes: [],
  currentStreak: 0,
  longestStreak: 0,
};

// ---------------------------------------------------------------------------
// Stock sector mapping
// ---------------------------------------------------------------------------

const STOCK_SECTORS: Record<string, string> = {
  AAPLx: "tech",
  AMZNx: "tech",
  GOOGLx: "tech",
  METAx: "tech",
  MSFTx: "tech",
  NVDAx: "tech",
  TSLAx: "auto",
  SPYx: "index",
  QQQx: "index",
  COINx: "crypto",
  CRCLx: "crypto",
  MSTRx: "crypto",
  AVGOx: "tech",
  JPMx: "finance",
  HOODx: "finance",
  LLYx: "healthcare",
  CRMx: "tech",
  NFLXx: "media",
  PLTRx: "tech",
  GMEx: "retail",
};

// ---------------------------------------------------------------------------
// Core Consensus Detection
// ---------------------------------------------------------------------------

/**
 * Analyze a set of trading round results and detect consensus/divergence.
 * Call this after each trading round completes.
 */
export function analyzeRoundConsensus(
  roundId: string,
  results: TradingRoundResult[],
): RoundConsensusResult {
  const signals: ConsensusSignal[] = [];
  const divergences: ConsensusDivergence[] = [];
  const now = new Date().toISOString();

  // Group decisions by symbol
  const bySymbol = new Map<string, TradingRoundResult[]>();
  for (const result of results) {
    const sym = result.decision.symbol;
    if (!bySymbol.has(sym)) {
      bySymbol.set(sym, []);
    }
    bySymbol.get(sym)!.push(result);
  }

  // Also group all actions (including holds on different symbols) for cross-symbol consensus
  const actionCounts = {
    buy: results.filter((r) => r.decision.action === "buy"),
    sell: results.filter((r) => r.decision.action === "sell"),
    hold: results.filter((r) => r.decision.action === "hold"),
  };

  // Detect per-symbol consensus (same symbol + same action)
  for (const [symbol, symbolResults] of bySymbol.entries()) {
    if (symbolResults.length < 2) continue;

    // Group by action within this symbol
    const actionGroups = new Map<string, TradingRoundResult[]>();
    for (const r of symbolResults) {
      const action = r.decision.action;
      if (!actionGroups.has(action)) {
        actionGroups.set(action, []);
      }
      actionGroups.get(action)!.push(r);
    }

    for (const [action, group] of actionGroups.entries()) {
      if (group.length >= 2) {
        const agreeingAgents = group.map((r) => r.agentId);
        const dissentingAgents = symbolResults
          .filter((r) => r.decision.action !== action)
          .map((r) => r.agentId);

        // Weighted confidence: higher individual confidence = more weight
        const individualConfidences: Record<string, number> = {};
        for (const r of group) {
          individualConfidences[r.agentId] = r.decision.confidence;
        }
        const totalWeight = group.reduce(
          (sum, r) => sum + r.decision.confidence,
          0,
        );
        const weightedConfidence =
          group.length > 0 ? totalWeight / group.length : 0;

        // Boost confidence for unanimous consensus
        const strengthMultiplier = group.length === 3 ? 1.2 : 1.0;
        const boostedConfidence = Math.min(
          100,
          Math.round(weightedConfidence * strengthMultiplier),
        );

        const avgQuantity =
          group.reduce((sum, r) => sum + r.decision.quantity, 0) / group.length;

        const signal: ConsensusSignal = {
          roundId,
          symbol,
          action: action as "buy" | "sell" | "hold",
          agentCount: group.length,
          agreeingAgents,
          dissentingAgents,
          confidence: boostedConfidence,
          individualConfidences,
          averageQuantity: Math.round(avgQuantity * 100) / 100,
          strength: group.length === results.length ? "unanimous" : "majority",
          combinedReasoning: group
            .map((r) => `[${r.agentName}] ${r.decision.reasoning}`)
            .join(" | "),
          timestamp: now,
        };

        signals.push(signal);
      }
    }

    // Detect bull/bear divergence on same symbol
    const hasBuyers = symbolResults.some(
      (r) => r.decision.action === "buy",
    );
    const hasSellers = symbolResults.some(
      (r) => r.decision.action === "sell",
    );

    if (hasBuyers && hasSellers) {
      const decisions = symbolResults.map((r) => ({
        agentId: r.agentId,
        action: r.decision.action as "buy" | "sell" | "hold",
        confidence: r.decision.confidence,
        reasoning: r.decision.reasoning,
      }));

      // Divergence score: average confidence of opposing sides
      const buyConf =
        decisions.filter((d) => d.action === "buy").reduce((s, d) => s + d.confidence, 0) /
        Math.max(1, decisions.filter((d) => d.action === "buy").length);
      const sellConf =
        decisions.filter((d) => d.action === "sell").reduce((s, d) => s + d.confidence, 0) /
        Math.max(1, decisions.filter((d) => d.action === "sell").length);
      const divergenceScore = Math.round((buyConf + sellConf) / 2);

      divergences.push({
        roundId,
        symbol,
        decisions,
        divergenceScore,
        isBullBearSplit: true,
        timestamp: now,
      });
    }
  }

  // Detect cross-symbol action consensus (e.g., all agents buying different stocks = bullish)
  for (const [action, group] of Object.entries(actionCounts)) {
    if (group.length >= 2 && action !== "hold") {
      // Check if they're buying/selling DIFFERENT stocks (market-level sentiment)
      const uniqueSymbols = new Set(group.map((r) => r.decision.symbol));
      if (uniqueSymbols.size > 1) {
        // This is a sentiment consensus, not a symbol consensus
        // Record it as a special "MARKET" signal
        const agreeingAgents = group.map((r) => r.agentId);
        const individualConfidences: Record<string, number> = {};
        for (const r of group) {
          individualConfidences[r.agentId] = r.decision.confidence;
        }
        const avgConfidence =
          group.reduce((sum, r) => sum + r.decision.confidence, 0) /
          group.length;

        signals.push({
          roundId,
          symbol: "MARKET",
          action: action as "buy" | "sell" | "hold",
          agentCount: group.length,
          agreeingAgents,
          dissentingAgents: results
            .filter((r) => r.decision.action !== action)
            .map((r) => r.agentId),
          confidence: Math.round(avgConfidence),
          individualConfidences,
          averageQuantity: 0,
          strength: group.length === results.length ? "unanimous" : "majority",
          combinedReasoning: group
            .map(
              (r) =>
                `[${r.agentName}] ${r.decision.action} ${r.decision.symbol}: ${r.decision.reasoning}`,
            )
            .join(" | "),
          timestamp: now,
        });
      }
    }
  }

  // Store results
  state.signalsByRound.set(roundId, signals);
  state.divergencesByRound.set(roundId, divergences);

  // Track outcomes as pending
  for (const signal of signals) {
    if (signal.action !== "hold" && signal.symbol !== "MARKET") {
      state.outcomes.push({
        signal,
        outcome: "pending",
        returnPercent: 0,
      });
    }
  }

  const strongestSignal =
    signals.length > 0
      ? signals.reduce((best, s) =>
          s.confidence > best.confidence ? s : best,
        )
      : null;

  const strongestDivergence =
    divergences.length > 0
      ? divergences.reduce((best, d) =>
          d.divergenceScore > best.divergenceScore ? d : best,
        )
      : null;

  return {
    signals,
    divergences,
    summary: {
      totalDecisions: results.length,
      consensusCount: signals.length,
      divergenceCount: divergences.length,
      strongestSignal,
      strongestDivergence,
    },
  };
}

// ---------------------------------------------------------------------------
// Consensus-Boosted Confidence
// ---------------------------------------------------------------------------

/**
 * Given an agent's decision and the full round results, return a
 * confidence-boosted score if other agents agree.
 *
 * Used by the execution engine to prioritize consensus trades.
 */
export function getConsensusBoostedConfidence(
  agentDecision: TradingDecision,
  allResults: TradingRoundResult[],
): {
  originalConfidence: number;
  boostedConfidence: number;
  consensusBoost: number;
  isConsensus: boolean;
  agreementLevel: "unanimous" | "majority" | "none";
} {
  const matching = allResults.filter(
    (r) =>
      r.decision.symbol === agentDecision.symbol &&
      r.decision.action === agentDecision.action,
  );

  if (matching.length <= 1) {
    return {
      originalConfidence: agentDecision.confidence,
      boostedConfidence: agentDecision.confidence,
      consensusBoost: 0,
      isConsensus: false,
      agreementLevel: "none",
    };
  }

  // Calculate consensus boost: +15% for majority, +25% for unanimous
  const isUnanimous = matching.length === allResults.length;
  const boostPercent = isUnanimous ? 25 : 15;

  // Also factor in the average confidence of the agreeing agents
  const othersAvgConfidence =
    matching
      .filter(
        (r) => r.decision.timestamp !== agentDecision.timestamp,
      )
      .reduce((sum, r) => sum + r.decision.confidence, 0) /
    Math.max(1, matching.length - 1);

  // If others are also very confident, boost more
  const confidenceMultiplier = othersAvgConfidence > 70 ? 1.1 : 1.0;

  const boost = Math.round(boostPercent * confidenceMultiplier);
  const boosted = Math.min(100, agentDecision.confidence + boost);

  return {
    originalConfidence: agentDecision.confidence,
    boostedConfidence: boosted,
    consensusBoost: boost,
    isConsensus: true,
    agreementLevel: isUnanimous ? "unanimous" : "majority",
  };
}

// ---------------------------------------------------------------------------
// Historical Consensus Accuracy
// ---------------------------------------------------------------------------

/**
 * Get historical consensus accuracy metrics.
 * Analyzes past consensus signals against actual trade outcomes.
 */
export async function getConsensusAccuracy(): Promise<ConsensusAccuracy> {
  const completedOutcomes = state.outcomes.filter(
    (o) => o.outcome !== "pending",
  );

  const profitableCount = completedOutcomes.filter(
    (o) => o.outcome === "profitable",
  ).length;
  const totalSignals = completedOutcomes.length;

  // By strength
  const unanimousOutcomes = completedOutcomes.filter(
    (o) => o.signal.strength === "unanimous",
  );
  const majorityOutcomes = completedOutcomes.filter(
    (o) => o.signal.strength === "majority",
  );

  // By action
  const buyOutcomes = completedOutcomes.filter(
    (o) => o.signal.action === "buy",
  );
  const sellOutcomes = completedOutcomes.filter(
    (o) => o.signal.action === "sell",
  );

  // By symbol
  const bySymbol: ConsensusAccuracy["bySymbol"] = {};
  for (const outcome of completedOutcomes) {
    const sym = outcome.signal.symbol;
    if (!bySymbol[sym]) {
      bySymbol[sym] = { count: 0, profitable: 0, accuracy: 0 };
    }
    bySymbol[sym].count++;
    if (outcome.outcome === "profitable") {
      bySymbol[sym].profitable++;
    }
    bySymbol[sym].accuracy =
      (bySymbol[sym].profitable / bySymbol[sym].count) * 100;
  }

  const calcAccuracy = (
    items: typeof completedOutcomes,
  ): { count: number; profitable: number; accuracy: number } => {
    const profitable = items.filter(
      (o) => o.outcome === "profitable",
    ).length;
    return {
      count: items.length,
      profitable,
      accuracy: items.length > 0 ? (profitable / items.length) * 100 : 0,
    };
  };

  return {
    totalSignals,
    profitableCount,
    accuracyRate: totalSignals > 0 ? (profitableCount / totalSignals) * 100 : 0,
    byStrength: {
      unanimous: calcAccuracy(unanimousOutcomes),
      majority: calcAccuracy(majorityOutcomes),
    },
    byAction: {
      buy: calcAccuracy(buyOutcomes),
      sell: calcAccuracy(sellOutcomes),
    },
    bySymbol,
    avgConfidence:
      completedOutcomes.length > 0
        ? completedOutcomes.reduce((s, o) => s + o.signal.confidence, 0) /
          completedOutcomes.length
        : 0,
    avgReturnPercent:
      completedOutcomes.length > 0
        ? completedOutcomes.reduce((s, o) => s + o.returnPercent, 0) /
          completedOutcomes.length
        : 0,
  };
}

/**
 * Update a consensus outcome when we know the trade result.
 * Call this when a consensus-driven trade closes or after a time window.
 */
export function recordConsensusOutcome(
  roundId: string,
  symbol: string,
  returnPercent: number,
): void {
  for (const outcome of state.outcomes) {
    if (
      outcome.signal.roundId === roundId &&
      outcome.signal.symbol === symbol &&
      outcome.outcome === "pending"
    ) {
      outcome.returnPercent = returnPercent;
      outcome.outcome = returnPercent > 0 ? "profitable" : "unprofitable";

      // Update streak
      if (outcome.outcome === "profitable") {
        state.currentStreak++;
        if (state.currentStreak > state.longestStreak) {
          state.longestStreak = state.currentStreak;
        }
      } else {
        state.currentStreak = 0;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Consensus History & Patterns
// ---------------------------------------------------------------------------

/**
 * Get recent consensus history with patterns and sector analysis.
 */
export function getConsensusHistory(limit: number = 20): ConsensusHistory {
  // Flatten all signals, newest first
  const allSignals: ConsensusSignal[] = [];
  for (const signals of state.signalsByRound.values()) {
    allSignals.push(...signals);
  }
  allSignals.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  const allDivergences: ConsensusDivergence[] = [];
  for (const divs of state.divergencesByRound.values()) {
    allDivergences.push(...divs);
  }
  allDivergences.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  // Sector consensus
  const sectorConsensus: ConsensusHistory["sectorConsensus"] = {};
  const sectorSignals = new Map<string, ConsensusSignal[]>();

  for (const signal of allSignals) {
    if (signal.symbol === "MARKET") continue;
    const sector = STOCK_SECTORS[signal.symbol] || "other";
    if (!sectorSignals.has(sector)) {
      sectorSignals.set(sector, []);
    }
    sectorSignals.get(sector)!.push(signal);
  }

  for (const [sector, signals] of sectorSignals.entries()) {
    const recentSignals = signals.slice(0, 5);
    const bullish = recentSignals.filter((s) => s.action === "buy").length;
    const bearish = recentSignals.filter((s) => s.action === "sell").length;

    sectorConsensus[sector] = {
      sentiment:
        bullish > bearish ? "bullish" : bearish > bullish ? "bearish" : "neutral",
      agentsBullish: bullish,
      agentsBearish: bearish,
      latestSignal: recentSignals[0] || null,
    };
  }

  return {
    signals: allSignals.slice(0, limit),
    divergences: allDivergences.slice(0, limit),
    currentStreak: state.currentStreak,
    longestStreak: state.longestStreak,
    sectorConsensus,
  };
}

// ---------------------------------------------------------------------------
// Analyze consensus from DB (for historical queries)
// ---------------------------------------------------------------------------

/**
 * Analyze consensus from the last N rounds stored in the database.
 * Useful for building historical consensus data on startup.
 */
export async function analyzeHistoricalConsensus(
  roundCount: number = 50,
): Promise<{
  roundsAnalyzed: number;
  totalSignals: number;
  totalDivergences: number;
  topConsensusSymbols: Array<{ symbol: string; count: number }>;
  topDivergenceSymbols: Array<{ symbol: string; count: number }>;
}> {
  // Get distinct round IDs, most recent first
  const rounds = await db
    .selectDistinct({ roundId: agentDecisions.roundId })
    .from(agentDecisions)
    .where(sql`${agentDecisions.roundId} IS NOT NULL`)
    .orderBy(desc(agentDecisions.createdAt))
    .limit(roundCount * 3);

  const uniqueRoundIds = [
    ...new Set(
      rounds
        .map((r: { roundId: string | null }) => r.roundId)
        .filter((id: string | null): id is string => Boolean(id))
    ),
  ].slice(0, roundCount) as string[];

  let totalSignals = 0;
  let totalDivergences = 0;
  const symbolSignalCounts = new Map<string, number>();
  const symbolDivergenceCounts = new Map<string, number>();

  for (const roundId of uniqueRoundIds) {
    if (!roundId) continue;

    // Get all decisions for this round
    const decisions = await db
      .select()
      .from(agentDecisions)
      .where(eq(agentDecisions.roundId, roundId as string));

    // Convert to TradingRoundResult format
    const results: TradingRoundResult[] = decisions.map((d: any) => ({
      agentId: d.agentId,
      agentName: d.agentId,
      decision: {
        action: d.action as "buy" | "sell" | "hold",
        symbol: d.symbol,
        quantity: Number(d.quantity),
        reasoning: d.reasoning,
        confidence: d.confidence,
        timestamp: d.createdAt.toISOString(),
      },
      executed: d.executed === "executed",
    }));

    if (results.length < 2) continue;

    const roundResult = analyzeRoundConsensus(roundId as string, results);
    totalSignals += roundResult.signals.length;
    totalDivergences += roundResult.divergences.length;

    for (const signal of roundResult.signals) {
      symbolSignalCounts.set(
        signal.symbol,
        (symbolSignalCounts.get(signal.symbol) || 0) + 1,
      );
    }
    for (const div of roundResult.divergences) {
      symbolDivergenceCounts.set(
        div.symbol,
        (symbolDivergenceCounts.get(div.symbol) || 0) + 1,
      );
    }
  }

  const topConsensusSymbols = [...symbolSignalCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([symbol, count]) => ({ symbol, count }));

  const topDivergenceSymbols = [...symbolDivergenceCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([symbol, count]) => ({ symbol, count }));

  return {
    roundsAnalyzed: uniqueRoundIds.length,
    totalSignals,
    totalDivergences,
    topConsensusSymbols,
    topDivergenceSymbols,
  };
}

// ---------------------------------------------------------------------------
// Agent Agreement Matrix
// ---------------------------------------------------------------------------

/**
 * Build a pairwise agreement matrix showing how often each pair of agents
 * agrees on trades. Useful for understanding agent correlations.
 */
export function getAgentAgreementMatrix(): {
  matrix: Record<string, Record<string, number>>;
  totalRounds: number;
  topPair: { agents: [string, string]; agreementRate: number } | null;
  mostIndependent: string | null;
} {
  const pairAgreements = new Map<string, number>();
  const pairTotal = new Map<string, number>();
  const agentIds = new Set<string>();
  let totalRounds = 0;

  for (const signals of state.signalsByRound.values()) {
    totalRounds++;
    for (const signal of signals) {
      for (let i = 0; i < signal.agreeingAgents.length; i++) {
        for (let j = i + 1; j < signal.agreeingAgents.length; j++) {
          const pair = [signal.agreeingAgents[i], signal.agreeingAgents[j]]
            .sort()
            .join("|");
          pairAgreements.set(pair, (pairAgreements.get(pair) || 0) + 1);
          agentIds.add(signal.agreeingAgents[i]);
          agentIds.add(signal.agreeingAgents[j]);
        }
      }
    }
  }

  // Build pairTotal from total rounds
  const allAgents = [...agentIds];
  for (let i = 0; i < allAgents.length; i++) {
    for (let j = i + 1; j < allAgents.length; j++) {
      const pair = [allAgents[i], allAgents[j]].sort().join("|");
      pairTotal.set(pair, totalRounds);
    }
  }

  // Build matrix
  const matrix: Record<string, Record<string, number>> = {};
  for (const agent of allAgents) {
    matrix[agent] = {};
    for (const other of allAgents) {
      if (agent === other) {
        matrix[agent][other] = 100;
        continue;
      }
      const pair = [agent, other].sort().join("|");
      const agreements = pairAgreements.get(pair) || 0;
      const total = pairTotal.get(pair) || 1;
      matrix[agent][other] = Math.round((agreements / total) * 100);
    }
  }

  // Find top pair and most independent agent
  let topPair: {
    agents: [string, string];
    agreementRate: number;
  } | null = null;

  for (const [pair, agreements] of pairAgreements.entries()) {
    const total = pairTotal.get(pair) || 1;
    const rate = (agreements / total) * 100;
    if (!topPair || rate > topPair.agreementRate) {
      topPair = {
        agents: pair.split("|") as [string, string],
        agreementRate: Math.round(rate),
      };
    }
  }

  // Most independent = lowest average agreement rate
  let mostIndependent: string | null = null;
  let lowestAvgAgreement = Infinity;
  for (const agent of allAgents) {
    const rates = allAgents
      .filter((a) => a !== agent)
      .map((other) => matrix[agent][other]);
    const avg = rates.length > 0 ? rates.reduce((s, r) => s + r, 0) / rates.length : 0;
    if (avg < lowestAvgAgreement) {
      lowestAvgAgreement = avg;
      mostIndependent = agent;
    }
  }

  return { matrix, totalRounds, topPair, mostIndependent };
}

// ---------------------------------------------------------------------------
// Consensus Stats Summary
// ---------------------------------------------------------------------------

/**
 * Get a comprehensive consensus engine status and metrics summary.
 */
export async function getConsensusStatus(): Promise<{
  engine: {
    roundsTracked: number;
    totalSignals: number;
    totalDivergences: number;
    pendingOutcomes: number;
    completedOutcomes: number;
  };
  accuracy: ConsensusAccuracy;
  history: ConsensusHistory;
  agreementMatrix: ReturnType<typeof getAgentAgreementMatrix>;
}> {
  let totalSignals = 0;
  let totalDivergences = 0;

  for (const signals of state.signalsByRound.values()) {
    totalSignals += signals.length;
  }
  for (const divs of state.divergencesByRound.values()) {
    totalDivergences += divs.length;
  }

  const pendingOutcomes = state.outcomes.filter(
    (o) => o.outcome === "pending",
  ).length;
  const completedOutcomes = state.outcomes.filter(
    (o) => o.outcome !== "pending",
  ).length;

  return {
    engine: {
      roundsTracked: state.signalsByRound.size,
      totalSignals,
      totalDivergences,
      pendingOutcomes,
      completedOutcomes,
    },
    accuracy: await getConsensusAccuracy(),
    history: getConsensusHistory(),
    agreementMatrix: getAgentAgreementMatrix(),
  };
}
