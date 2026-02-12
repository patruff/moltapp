/**
 * Cross-Agent Consensus Divergence Scorer (v14)
 *
 * Measures the degree of agreement/disagreement between AI agents
 * within each trading round. When agents disagree, it's interesting:
 * - Who was right?
 * - Does the contrarian agent outperform?
 * - Is consensus a bullish or bearish signal?
 *
 * Key metrics:
 * - Agreement rate per round
 * - Divergence magnitude (how different are the opinions?)
 * - Consensus accuracy (does the majority tend to be right?)
 * - Contrarian alpha (does going against consensus pay?)
 * - Symbol-level disagreement patterns
 */

import { round3, countByCondition } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RoundConsensusSnapshot {
  roundId: string;
  timestamp: string;
  agents: AgentRoundAction[];
  /** "unanimous" | "majority" | "split" | "no_trades" */
  consensusType: string;
  /** 0 (total disagreement) to 1 (total agreement) */
  agreementScore: number;
  /** The consensus action (most common non-hold) */
  consensusAction: "buy" | "sell" | "hold" | "none";
  /** Symbol most agents agreed on */
  consensusSymbol: string | null;
  /** Agents who went against consensus */
  contrarians: string[];
  /** Average confidence of majority vs contrarian */
  majorityAvgConfidence: number;
  contrarianAvgConfidence: number;
}

export interface AgentRoundAction {
  agentId: string;
  action: "buy" | "sell" | "hold";
  symbol: string;
  confidence: number;
  reasoning: string;
  coherenceScore: number;
}

export interface ConsensusDivergenceProfile {
  /** Total rounds analyzed */
  totalRounds: number;
  /** Average agreement score across rounds */
  avgAgreementScore: number;
  /** Rate of unanimous rounds */
  unanimousRate: number;
  /** Rate of split rounds (no majority) */
  splitRate: number;
  /** Does consensus tend to be right? (tracked via subsequent P&L) */
  consensusAccuracy: number;
  /** Do contrarian trades outperform? */
  contrarianAlpha: number;
  /** Per-agent agreement stats */
  byAgent: Record<string, AgentConsensusStats>;
  /** Per-symbol disagreement patterns */
  bySymbol: Record<string, SymbolConsensusStats>;
  /** Most controversial rounds (lowest agreement) */
  mostControversialRounds: RoundConsensusSnapshot[];
  /** Trend: are agents converging or diverging over time? */
  convergenceTrend: "converging" | "diverging" | "stable";
}

export interface AgentConsensusStats {
  agentId: string;
  /** Fraction of rounds this agent agreed with majority */
  agreementRate: number;
  /** Number of times this agent was the lone contrarian */
  loneContrarianCount: number;
  /** Average confidence when agreeing vs disagreeing */
  avgConfidenceWhenAgreeing: number;
  avgConfidenceWhenDisagreeing: number;
  /** This agent's win rate when going against consensus */
  contrarianWinRate: number;
  /** Overall stance: "conformist", "independent", "contrarian" */
  stance: string;
}

export interface SymbolConsensusStats {
  symbol: string;
  roundsDebated: number;
  agreementRate: number;
  avgBullish: number;
  avgBearish: number;
  /** Most common disagreement pattern */
  typicalConflict: string;
}

// ---------------------------------------------------------------------------
// In-Memory Storage
// ---------------------------------------------------------------------------

const roundSnapshots: RoundConsensusSnapshot[] = [];

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * DATA RETENTION LIMITS
 */

/** Maximum consensus snapshots to retain in memory (prevents unbounded growth) */
const MAX_SNAPSHOTS = 500;

/**
 * CONSENSUS CLASSIFICATION THRESHOLDS
 *
 * Control how rounds are classified based on agent agreement patterns.
 */

/**
 * Minimum agent count for "majority" consensus classification.
 *
 * When action count > MAJORITY_MIN_AGENTS, classify as "majority".
 * When action count = 1, classify as "split" (no clear majority).
 *
 * Example: 2 buys, 1 sell → buyCount (2) > MAJORITY_MIN_AGENTS (1) → "majority" buy
 */
const MAJORITY_MIN_AGENTS = 1;

/**
 * Lone contrarian detection threshold.
 *
 * When contrarians.length === LONE_CONTRARIAN_THRESHOLD, flag as lone contrarian.
 * This identifies agents who are the only dissenter in a round.
 *
 * Example: 2 agents buy, 1 agent sells → 1 contrarian → lone contrarian
 */
const LONE_CONTRARIAN_THRESHOLD = 1;

/**
 * AGENT STANCE CLASSIFICATION THRESHOLDS
 *
 * Classify agents based on their agreement rate with consensus.
 */

/**
 * Agreement rate threshold for "conformist" classification.
 *
 * Agents with agreementRate >= 0.8 (80%) are classified as "conformist".
 * They rarely go against the majority.
 */
const STANCE_CONFORMIST_THRESHOLD = 0.8;

/**
 * Agreement rate threshold for "independent" classification.
 *
 * Agents with agreementRate >= 0.5 (50%) but < 0.8 are "independent".
 * Agents with agreementRate < 0.5 are classified as "contrarian".
 */
const STANCE_INDEPENDENT_THRESHOLD = 0.5;

/**
 * DISPLAY AND QUERY LIMITS
 */

/** Maximum controversial rounds to display in profile (top N by lowest agreement score) */
const CONTROVERSIAL_ROUNDS_DISPLAY_LIMIT = 5;

/** Default limit for recent consensus query (getRecentConsensus) */
const RECENT_CONSENSUS_DEFAULT_LIMIT = 20;

/**
 * TREND ANALYSIS PARAMETERS
 */

/**
 * Minimum snapshots required for convergence trend detection.
 *
 * If snapshots.length < 10, return "stable" (insufficient data for trend analysis).
 * Trend detection compares first half to second half agreement scores.
 */
const TREND_MIN_SNAPSHOTS = 10;

/**
 * Convergence trend detection threshold (10% agreement score change).
 *
 * Used in computeConvergenceTrend() to classify whether agents are:
 * - Converging: Agreement score increased by >10% from first half to second half
 * - Diverging: Agreement score decreased by >10% from first half to second half
 * - Stable: Agreement score changed by ≤10%
 *
 * Example: If first half avg = 0.60, second half avg = 0.72 → change = +0.12 → "converging"
 */
const CONVERGENCE_THRESHOLD_DELTA = 0.1;

/**
 * DEFAULT VALUES
 */

/** Default agreement rate when agent has no rounds (perfect agreement assumed) */
const DEFAULT_AGREEMENT_RATE = 1;

// Track outcomes for consensus accuracy
const consensusOutcomes: {
  roundId: string;
  consensusAction: string;
  consensusSymbol: string | null;
  outcome: "correct" | "incorrect" | "pending";
}[] = [];

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

/**
 * Record a round's consensus/divergence data.
 * Called after each trading round with all agent actions.
 */
export function recordRoundConsensus(
  roundId: string,
  agents: AgentRoundAction[],
): RoundConsensusSnapshot {
  const nonHold = agents.filter((a) => a.action !== "hold");

  // Determine consensus
  const actionCounts = new Map<string, number>();
  for (const a of nonHold) {
    actionCounts.set(a.action, (actionCounts.get(a.action) ?? 0) + 1);
  }

  let consensusType: string;
  let consensusAction: "buy" | "sell" | "hold" | "none";
  let contrarians: string[] = [];
  let majorityAgents: AgentRoundAction[] = [];

  if (nonHold.length === 0) {
    consensusType = "no_trades";
    consensusAction = "hold";
    majorityAgents = agents;
  } else {
    const buyCount = actionCounts.get("buy") ?? 0;
    const sellCount = actionCounts.get("sell") ?? 0;

    if (buyCount === nonHold.length) {
      consensusType = "unanimous";
      consensusAction = "buy";
      majorityAgents = nonHold;
    } else if (sellCount === nonHold.length) {
      consensusType = "unanimous";
      consensusAction = "sell";
      majorityAgents = nonHold;
    } else if (buyCount > sellCount) {
      consensusType = buyCount > MAJORITY_MIN_AGENTS ? "majority" : "split";
      consensusAction = "buy";
      majorityAgents = nonHold.filter((a) => a.action === "buy");
      contrarians = nonHold.filter((a) => a.action !== "buy").map((a) => a.agentId);
    } else if (sellCount > buyCount) {
      consensusType = sellCount > MAJORITY_MIN_AGENTS ? "majority" : "split";
      consensusAction = "sell";
      majorityAgents = nonHold.filter((a) => a.action === "sell");
      contrarians = nonHold.filter((a) => a.action !== "sell").map((a) => a.agentId);
    } else {
      consensusType = "split";
      consensusAction = "none";
      majorityAgents = nonHold;
    }
  }

  // Agreement score: fraction of agents in the majority
  const agreementScore = agents.length > 0
    ? majorityAgents.length / agents.length
    : 1;

  // Consensus symbol (most common symbol in majority)
  const symbolCounts = new Map<string, number>();
  for (const a of majorityAgents) {
    symbolCounts.set(a.symbol, (symbolCounts.get(a.symbol) ?? 0) + 1);
  }
  let consensusSymbol: string | null = null;
  let maxSymCount = 0;
  for (const [sym, count] of symbolCounts) {
    if (count > maxSymCount) {
      maxSymCount = count;
      consensusSymbol = sym;
    }
  }

  // Average confidences
  const majorityConfs = majorityAgents.map((a) => a.confidence);
  const contrarianAgents = agents.filter((a) => contrarians.includes(a.agentId));
  const contrarianConfs = contrarianAgents.map((a) => a.confidence);

  const snapshot: RoundConsensusSnapshot = {
    roundId,
    timestamp: new Date().toISOString(),
    agents,
    consensusType,
    agreementScore: round3(agreementScore),
    consensusAction,
    consensusSymbol,
    contrarians,
    majorityAvgConfidence: majorityConfs.length > 0
      ? round3(majorityConfs.reduce((s, v) => s + v, 0) / majorityConfs.length)
      : 0,
    contrarianAvgConfidence: contrarianConfs.length > 0
      ? round3(contrarianConfs.reduce((s, v) => s + v, 0) / contrarianConfs.length)
      : 0,
  };

  roundSnapshots.push(snapshot);
  if (roundSnapshots.length > MAX_SNAPSHOTS) {
    roundSnapshots.splice(0, roundSnapshots.length - MAX_SNAPSHOTS);
  }

  // Track for outcome resolution
  consensusOutcomes.push({
    roundId,
    consensusAction,
    consensusSymbol,
    outcome: "pending",
  });

  return snapshot;
}

/**
 * Update consensus outcome (called when we know if consensus was right).
 */
export function updateConsensusOutcome(
  roundId: string,
  correct: boolean,
): void {
  const entry = consensusOutcomes.find((o) => o.roundId === roundId);
  if (entry) {
    entry.outcome = correct ? "correct" : "incorrect";
  }
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

/**
 * Build the full consensus divergence profile across all rounds.
 */
export function buildDivergenceProfile(): ConsensusDivergenceProfile {
  const n = roundSnapshots.length;

  if (n === 0) {
    return emptyProfile();
  }

  // Basic stats
  const avgAgreementScore = roundSnapshots.reduce((s, r) => s + r.agreementScore, 0) / n;
  const unanimousCount = countByCondition(roundSnapshots, (r) => r.consensusType === "unanimous");
  const splitCount = countByCondition(roundSnapshots, (r) => r.consensusType === "split");

  // Consensus accuracy
  const resolved = consensusOutcomes.filter((o) => o.outcome !== "pending");
  const consensusCorrect = countByCondition(resolved, (o) => o.outcome === "correct");
  const consensusAccuracy = resolved.length > 0 ? consensusCorrect / resolved.length : 0;

  // Contrarian alpha (placeholder — needs actual P&L data)
  const contrarianAlpha = 0;

  // Per-agent stats
  const byAgent: Record<string, AgentConsensusStats> = {};
  const agentIds = new Set<string>();
  for (const snap of roundSnapshots) {
    for (const a of snap.agents) {
      agentIds.add(a.agentId);
    }
  }

  for (const agentId of agentIds) {
    const agentRounds = roundSnapshots.filter((s) =>
      s.agents.some((a) => a.agentId === agentId),
    );

    let agreeCount = 0;
    let loneContrarianCount = 0;
    const confWhenAgreeing: number[] = [];
    const confWhenDisagreeing: number[] = [];

    for (const round of agentRounds) {
      const agentAction = round.agents.find((a) => a.agentId === agentId);
      if (!agentAction) continue;

      const isContrarian = round.contrarians.includes(agentId);

      if (!isContrarian) {
        agreeCount++;
        confWhenAgreeing.push(agentAction.confidence);
      } else {
        confWhenDisagreeing.push(agentAction.confidence);
        if (round.contrarians.length === LONE_CONTRARIAN_THRESHOLD) {
          loneContrarianCount++;
        }
      }
    }

    const agreementRate = agentRounds.length > 0 ? agreeCount / agentRounds.length : DEFAULT_AGREEMENT_RATE;

    byAgent[agentId] = {
      agentId,
      agreementRate: round3(agreementRate),
      loneContrarianCount,
      avgConfidenceWhenAgreeing: confWhenAgreeing.length > 0
        ? round3(confWhenAgreeing.reduce((s, v) => s + v, 0) / confWhenAgreeing.length)
        : 0,
      avgConfidenceWhenDisagreeing: confWhenDisagreeing.length > 0
        ? round3(confWhenDisagreeing.reduce((s, v) => s + v, 0) / confWhenDisagreeing.length)
        : 0,
      contrarianWinRate: 0, // Needs P&L data
      stance: agreementRate >= STANCE_CONFORMIST_THRESHOLD ? "conformist" : agreementRate >= STANCE_INDEPENDENT_THRESHOLD ? "independent" : "contrarian",
    };
  }

  // Per-symbol stats
  const bySymbol: Record<string, SymbolConsensusStats> = {};
  const symbolRounds = new Map<string, RoundConsensusSnapshot[]>();

  for (const snap of roundSnapshots) {
    const symbols = new Set(snap.agents.map((a) => a.symbol));
    for (const sym of symbols) {
      const existing = symbolRounds.get(sym) ?? [];
      existing.push(snap);
      symbolRounds.set(sym, existing);
    }
  }

  for (const [sym, rounds] of symbolRounds) {
    let agreeRounds = 0;
    let totalBullish = 0;
    let totalBearish = 0;
    let roundsWithActions = 0;

    for (const round of rounds) {
      const symAgents = round.agents.filter((a) => a.symbol === sym);
      if (symAgents.length === 0) continue;

      roundsWithActions++;
      const actions = symAgents.map((a) => a.action);
      const allSame = actions.every((a) => a === actions[0]);
      if (allSame) agreeRounds++;

      const buys = countByCondition(actions, (a) => a === "buy");
      const sells = countByCondition(actions, (a) => a === "sell");
      totalBullish += buys;
      totalBearish += sells;
    }

    bySymbol[sym] = {
      symbol: sym,
      roundsDebated: roundsWithActions,
      agreementRate: roundsWithActions > 0
        ? round3(agreeRounds / roundsWithActions)
        : 1,
      avgBullish: roundsWithActions > 0
        ? round3(totalBullish / roundsWithActions)
        : 0,
      avgBearish: roundsWithActions > 0
        ? round3(totalBearish / roundsWithActions)
        : 0,
      typicalConflict: totalBullish > totalBearish
        ? "Mostly bullish with bear dissenters"
        : totalBearish > totalBullish
          ? "Mostly bearish with bull dissenters"
          : "Evenly split",
    };
  }

  // Most controversial rounds
  const mostControversialRounds = [...roundSnapshots]
    .sort((a, b) => a.agreementScore - b.agreementScore)
    .slice(0, CONTROVERSIAL_ROUNDS_DISPLAY_LIMIT);

  // Convergence trend
  const convergenceTrend = computeConvergenceTrend(roundSnapshots);

  return {
    totalRounds: n,
    avgAgreementScore: round3(avgAgreementScore),
    unanimousRate: round3(unanimousCount / n),
    splitRate: round3(splitCount / n),
    consensusAccuracy: round3(consensusAccuracy),
    contrarianAlpha,
    byAgent,
    bySymbol,
    mostControversialRounds,
    convergenceTrend,
  };
}

/**
 * Get recent consensus snapshots.
 */
export function getRecentConsensus(limit = RECENT_CONSENSUS_DEFAULT_LIMIT): RoundConsensusSnapshot[] {
  return roundSnapshots.slice(-limit).reverse();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeConvergenceTrend(
  snapshots: RoundConsensusSnapshot[],
): "converging" | "diverging" | "stable" {
  if (snapshots.length < TREND_MIN_SNAPSHOTS) return "stable";

  const halfPoint = Math.floor(snapshots.length / 2);
  const firstHalf = snapshots.slice(0, halfPoint);
  const secondHalf = snapshots.slice(halfPoint);

  const avgFirst = firstHalf.reduce((s, r) => s + r.agreementScore, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((s, r) => s + r.agreementScore, 0) / secondHalf.length;

  if (avgSecond > avgFirst + CONVERGENCE_THRESHOLD_DELTA) return "converging";
  if (avgSecond < avgFirst - CONVERGENCE_THRESHOLD_DELTA) return "diverging";
  return "stable";
}

function emptyProfile(): ConsensusDivergenceProfile {
  return {
    totalRounds: 0,
    avgAgreementScore: 0,
    unanimousRate: 0,
    splitRate: 0,
    consensusAccuracy: 0,
    contrarianAlpha: 0,
    byAgent: {},
    bySymbol: {},
    mostControversialRounds: [],
    convergenceTrend: "stable",
  };
}
