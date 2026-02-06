/**
 * AI Agent Personality Evolution Tracker
 *
 * Tracks how each AI trading agent's personality EVOLVES over time based
 * on their actual trading performance. Unlike static fingerprints, this
 * service captures the dynamic nature of agent behavior — how they adapt
 * after wins, losses, and shifts in market conditions.
 *
 * Core concepts:
 * 1. PersonalitySnapshot — a 6-dimensional behavioral profile at a point in time
 * 2. Decision recording — every decision is stored with peer context for analysis
 * 3. Timeline tracking — personality snapshots are periodically computed and stored
 * 4. Drift detection — measures how far an agent has strayed from its baseline
 * 5. Cross-agent comparison — side-by-side personality profiles for all agents
 * 6. Evolution narrative — human-readable story of how the agent changed
 *
 * All state is held in-memory using ring buffers with configurable capacity.
 * No database dependency — designed for real-time dashboard consumption.
 */

import { round1 } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single trading decision with peer context for personality computation. */
export interface RecordedDecision {
  agentId: string;
  decision: {
    action: "buy" | "sell" | "hold";
    symbol: string;
    quantity: number;
    reasoning: string;
    confidence: number;
    timestamp: string;
  };
  /** Decisions made by other agents in the same round */
  peerDecisions: Array<{
    agentId: string;
    action: "buy" | "sell" | "hold";
    symbol: string;
    confidence: number;
  }>;
  /** Realized P&L from this decision, filled in after position is closed */
  pnlResult?: number;
  /** Sequence number for ordering */
  seq: number;
}

/** A 6-dimensional behavioral profile captured at a point in time. */
export interface PersonalitySnapshot {
  agentId: string;
  /** ISO timestamp when this snapshot was computed */
  computedAt: string;
  /** How often they trade vs hold (0 = always hold, 100 = never hold) */
  aggressiveness: number;
  /** How often they go against the other agents (0 = follows crowd, 100 = always contrarian) */
  contrarianism: number;
  /** Average confidence in their decisions (0-100) */
  conviction: number;
  /** How spread out their trades are across symbols (0 = one stock, 100 = max diversity) */
  diversification: number;
  /** How much behavior changes after wins (0 = no change, 100 = drastic change) */
  winSensitivity: number;
  /** How much behavior changes after losses (0 = no change, 100 = drastic change) */
  lossSensitivity: number;
  /** Number of decisions used to compute this snapshot */
  sampleSize: number;
}

/** Measures how far an agent's personality has drifted from its initial baseline. */
export interface PersonalityDrift {
  agentId: string;
  /** The baseline snapshot (earliest available) */
  baseline: PersonalitySnapshot;
  /** The current snapshot (most recent) */
  current: PersonalitySnapshot;
  /** Euclidean distance between baseline and current (0 = no drift) */
  overallDrift: number;
  /** Per-dimension drift breakdown */
  dimensionDrift: Array<{
    dimension: string;
    baselineValue: number;
    currentValue: number;
    delta: number;
    direction: "increased" | "decreased" | "stable";
  }>;
  /** Has the personality changed significantly? */
  significant: boolean;
}

/** Side-by-side personality comparison of all agents. */
export interface PersonalityComparison {
  generatedAt: string;
  agents: Array<{
    agentId: string;
    snapshot: PersonalitySnapshot;
  }>;
  /** Which dimensions show the biggest spread across agents */
  mostDivergentDimensions: Array<{
    dimension: string;
    spread: number;
    highAgent: string;
    lowAgent: string;
  }>;
  /** Which agent pair is most similar / most different */
  mostSimilarPair: { agents: [string, string]; distance: number } | null;
  mostDifferentPair: { agents: [string, string]; distance: number } | null;
}

/** A text narrative describing an agent's personality evolution. */
export interface EvolutionStory {
  agentId: string;
  generatedAt: string;
  /** Multi-paragraph narrative text */
  narrative: string;
  /** Key personality milestones */
  milestones: Array<{
    timestamp: string;
    description: string;
  }>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The three competing AI trading agents */
const AGENT_IDS = ["claude-trader", "gpt-momentum", "grok-contrarian"] as const;

/** Human-readable agent names */
const AGENT_NAMES: Record<string, string> = {
  "claude-trader": "Claude Trader",
  "gpt-momentum": "GPT Momentum",
  "grok-contrarian": "Grok Contrarian",
};

/** Maximum decisions to keep per agent in the ring buffer */
const MAX_DECISIONS_PER_AGENT = 500;

/** Maximum personality snapshots to keep per agent */
const MAX_SNAPSHOTS_PER_AGENT = 200;

/** Number of recent decisions used when computing a personality snapshot */
const PERSONALITY_WINDOW = 50;

/** Minimum decisions needed before a snapshot can be computed */
const MIN_DECISIONS_FOR_SNAPSHOT = 5;

/** Drift threshold: above this, personality change is considered significant */
const SIGNIFICANT_DRIFT_THRESHOLD = 15;

/** How many recent decisions to use for win/loss sensitivity calculation */
const SENSITIVITY_LOOKBACK = 30;

// ---------------------------------------------------------------------------
// State (module-level in-memory stores)
// ---------------------------------------------------------------------------

/** Ring buffer of recorded decisions per agent */
const decisionStore = new Map<string, RecordedDecision[]>();

/** Timeline of personality snapshots per agent */
const snapshotTimeline = new Map<string, PersonalitySnapshot[]>();

/** Global sequence counter for ordering decisions */
let globalSeq = 0;

// ---------------------------------------------------------------------------
// Decision Recording
// ---------------------------------------------------------------------------

/**
 * Record a trading decision along with what peer agents decided in the same round.
 * This is called by the orchestrator after each agent makes a decision.
 *
 * @param agentId - The agent that made the decision (e.g. "claude-trader")
 * @param decision - The agent's trading decision
 * @param peerDecisions - Decisions from the other agents in the same round
 */
export function recordDecision(
  agentId: string,
  decision: {
    action: "buy" | "sell" | "hold";
    symbol: string;
    quantity: number;
    reasoning: string;
    confidence: number;
    timestamp: string;
  },
  peerDecisions: Array<{
    agentId: string;
    action: "buy" | "sell" | "hold";
    symbol: string;
    confidence: number;
  }>,
): void {
  const buffer = decisionStore.get(agentId) ?? [];

  buffer.push({
    agentId,
    decision,
    peerDecisions,
    seq: globalSeq++,
  });

  // Ring buffer: trim from front when over capacity
  if (buffer.length > MAX_DECISIONS_PER_AGENT) {
    buffer.splice(0, buffer.length - MAX_DECISIONS_PER_AGENT);
  }

  decisionStore.set(agentId, buffer);

  // Auto-compute a new personality snapshot every 10 decisions
  if (buffer.length >= MIN_DECISIONS_FOR_SNAPSHOT && buffer.length % 10 === 0) {
    const snapshot = computePersonality(agentId);
    if (snapshot) {
      const timeline = snapshotTimeline.get(agentId) ?? [];
      timeline.push(snapshot);
      if (timeline.length > MAX_SNAPSHOTS_PER_AGENT) {
        timeline.splice(0, timeline.length - MAX_SNAPSHOTS_PER_AGENT);
      }
      snapshotTimeline.set(agentId, timeline);
    }
  }
}

/**
 * Update a previously recorded decision with its realized P&L outcome.
 * Called when a position opened by this decision is closed.
 *
 * @param agentId - The agent whose decision to update
 * @param timestamp - The ISO timestamp of the original decision
 * @param pnl - The realized profit/loss in USDC
 */
export function updateDecisionOutcome(
  agentId: string,
  timestamp: string,
  pnl: number,
): void {
  const buffer = decisionStore.get(agentId);
  if (!buffer) return;

  const decision = buffer.find((d) => d.decision.timestamp === timestamp);
  if (decision) {
    decision.pnlResult = pnl;
  }
}

// ---------------------------------------------------------------------------
// Personality Computation
// ---------------------------------------------------------------------------

/**
 * Compute the current personality snapshot for an agent from their recent decisions.
 * Uses a sliding window of the most recent PERSONALITY_WINDOW decisions.
 *
 * @param agentId - The agent to compute personality for
 * @returns PersonalitySnapshot or null if insufficient data
 */
export function computePersonality(agentId: string): PersonalitySnapshot | null {
  const buffer = decisionStore.get(agentId);
  if (!buffer || buffer.length < MIN_DECISIONS_FOR_SNAPSHOT) {
    return null;
  }

  // Take the most recent window of decisions
  const window = buffer.slice(-PERSONALITY_WINDOW);

  const aggressiveness = computeAggressiveness(window);
  const contrarianism = computeContrarianism(window);
  const conviction = computeConviction(window);
  const diversification = computeDiversification(window);
  const winSensitivity = computeWinSensitivity(buffer);
  const lossSensitivity = computeLossSensitivity(buffer);

  return {
    agentId,
    computedAt: new Date().toISOString(),
    aggressiveness: round1(aggressiveness),
    contrarianism: round1(contrarianism),
    conviction: round1(conviction),
    diversification: round1(diversification),
    winSensitivity: round1(winSensitivity),
    lossSensitivity: round1(lossSensitivity),
    sampleSize: window.length,
  };
}

/**
 * Aggressiveness: how often the agent trades vs holds.
 * 0 = always holds, 100 = never holds.
 */
function computeAggressiveness(window: RecordedDecision[]): number {
  if (window.length === 0) return 0;
  const nonHold = window.filter((d) => d.decision.action !== "hold").length;
  return (nonHold / window.length) * 100;
}

/**
 * Contrarianism: how often the agent goes against the majority of peers.
 * A decision is contrarian if the agent's action opposes the majority peer action.
 */
function computeContrarianism(window: RecordedDecision[]): number {
  if (window.length === 0) return 0;

  let contrarianCount = 0;
  let comparableCount = 0;

  for (const record of window) {
    const agentAction = record.decision.action;
    const peerActions = record.peerDecisions.map((p) => p.action);

    if (peerActions.length === 0) continue;

    // Determine majority peer action (buy/sell/hold)
    const actionCounts: Record<string, number> = { buy: 0, sell: 0, hold: 0 };
    for (const action of peerActions) {
      actionCounts[action]++;
    }

    const majorityAction = Object.entries(actionCounts)
      .sort(([, a], [, b]) => b - a)[0][0];

    comparableCount++;

    // Agent is contrarian if it opposes the majority
    const isContrarian =
      (agentAction === "buy" && majorityAction === "sell") ||
      (agentAction === "sell" && majorityAction === "buy") ||
      (agentAction !== "hold" && majorityAction === "hold" && actionCounts.hold > 1) ||
      (agentAction === "hold" && majorityAction !== "hold" && actionCounts[majorityAction] > 1);

    if (isContrarian) {
      contrarianCount++;
    }
  }

  return comparableCount > 0 ? (contrarianCount / comparableCount) * 100 : 0;
}

/**
 * Conviction: average confidence across all decisions in the window.
 */
function computeConviction(window: RecordedDecision[]): number {
  if (window.length === 0) return 0;
  const sum = window.reduce((s, d) => s + d.decision.confidence, 0);
  return sum / window.length;
}

/**
 * Diversification: how spread out trades are across different symbols.
 * Uses a normalized entropy calculation over the symbol distribution.
 * 0 = all trades on one symbol, 100 = perfectly spread.
 */
function computeDiversification(window: RecordedDecision[]): number {
  const trades = window.filter((d) => d.decision.action !== "hold");
  if (trades.length <= 1) return 0;

  // Count trades per symbol
  const symbolCounts = new Map<string, number>();
  for (const t of trades) {
    symbolCounts.set(t.decision.symbol, (symbolCounts.get(t.decision.symbol) ?? 0) + 1);
  }

  const uniqueSymbols = symbolCounts.size;
  if (uniqueSymbols <= 1) return 0;

  // Shannon entropy normalized by log(uniqueSymbols)
  const total = trades.length;
  let entropy = 0;
  for (const count of Array.from(symbolCounts.values())) {
    const p = count / total;
    if (p > 0) {
      entropy -= p * Math.log2(p);
    }
  }

  const maxEntropy = Math.log2(uniqueSymbols);
  const normalizedEntropy = maxEntropy > 0 ? entropy / maxEntropy : 0;

  // Scale to 0-100, also factor in absolute count of unique symbols
  // Trading 2 symbols perfectly evenly is less diversified than 10
  const symbolBreadth = Math.min(1, uniqueSymbols / 10);
  return Math.min(100, normalizedEntropy * symbolBreadth * 100 + symbolBreadth * 30);
}

/**
 * Win sensitivity: how much the agent's behavior changes after wins.
 * Compares confidence and aggressiveness in the 5 decisions after a win
 * vs the 5 decisions before, averaged across all win events.
 */
function computeWinSensitivity(buffer: RecordedDecision[]): number {
  return computeOutcomeSensitivity(buffer, "win");
}

/**
 * Loss sensitivity: how much the agent's behavior changes after losses.
 * Same methodology as win sensitivity but triggered by negative P&L.
 */
function computeLossSensitivity(buffer: RecordedDecision[]): number {
  return computeOutcomeSensitivity(buffer, "loss");
}

/**
 * Shared logic for win/loss sensitivity.
 * Measures how much confidence and trade frequency change after outcome events.
 */
function computeOutcomeSensitivity(
  buffer: RecordedDecision[],
  outcomeType: "win" | "loss",
): number {
  const recent = buffer.slice(-SENSITIVITY_LOOKBACK);
  if (recent.length < 10) return 50; // Default to neutral with insufficient data

  // Find indices of outcome events
  const outcomeIndices: number[] = [];
  for (let i = 0; i < recent.length; i++) {
    const pnl = recent[i].pnlResult;
    if (pnl !== undefined) {
      if (outcomeType === "win" && pnl > 0) outcomeIndices.push(i);
      if (outcomeType === "loss" && pnl < 0) outcomeIndices.push(i);
    }
  }

  if (outcomeIndices.length === 0) return 50; // No data, neutral

  // For each outcome event, compare behavior before and after
  const deltas: number[] = [];
  for (const idx of outcomeIndices) {
    // Get up to 3 decisions before and 3 after
    const beforeStart = Math.max(0, idx - 3);
    const afterEnd = Math.min(recent.length, idx + 4);
    const before = recent.slice(beforeStart, idx);
    const after = recent.slice(idx + 1, afterEnd);

    if (before.length === 0 || after.length === 0) continue;

    // Confidence delta
    const avgConfBefore = before.reduce((s, d) => s + d.decision.confidence, 0) / before.length;
    const avgConfAfter = after.reduce((s, d) => s + d.decision.confidence, 0) / after.length;
    const confDelta = Math.abs(avgConfAfter - avgConfBefore);

    // Aggressiveness delta (trade rate)
    const tradeRateBefore = before.filter((d) => d.decision.action !== "hold").length / before.length;
    const tradeRateAfter = after.filter((d) => d.decision.action !== "hold").length / after.length;
    const aggDelta = Math.abs(tradeRateAfter - tradeRateBefore) * 100;

    // Combined behavioral change
    deltas.push(confDelta + aggDelta);
  }

  if (deltas.length === 0) return 50;

  // Average delta, scaled to 0-100
  const avgDelta = deltas.reduce((s, d) => s + d, 0) / deltas.length;
  return Math.min(100, avgDelta * 2);
}

// ---------------------------------------------------------------------------
// Timeline & Drift
// ---------------------------------------------------------------------------

/**
 * Get the full personality timeline for an agent — all snapshots over time.
 *
 * @param agentId - The agent to query
 * @returns Array of PersonalitySnapshot ordered by time (oldest first)
 */
export function getPersonalityTimeline(agentId: string): PersonalitySnapshot[] {
  return snapshotTimeline.get(agentId) ?? [];
}

/**
 * Compute how much an agent's personality has drifted from its initial baseline.
 * Compares the earliest stored snapshot to the most recent one.
 *
 * @param agentId - The agent to analyze
 * @returns PersonalityDrift or null if fewer than 2 snapshots exist
 */
export function getPersonalityDrift(agentId: string): PersonalityDrift | null {
  const timeline = snapshotTimeline.get(agentId);
  if (!timeline || timeline.length < 2) return null;

  const baseline = timeline[0];
  const current = timeline[timeline.length - 1];

  const dimensions = [
    "aggressiveness",
    "contrarianism",
    "conviction",
    "diversification",
    "winSensitivity",
    "lossSensitivity",
  ] as const;

  const dimensionDrift = dimensions.map((dim) => {
    const baseVal = baseline[dim];
    const curVal = current[dim];
    const delta = curVal - baseVal;
    return {
      dimension: dim,
      baselineValue: baseVal,
      currentValue: curVal,
      delta: round1(delta),
      direction: (Math.abs(delta) < 3 ? "stable" : delta > 0 ? "increased" : "decreased") as
        "increased" | "decreased" | "stable",
    };
  });

  // Euclidean distance in the 6-dimensional personality space
  let sumSquared = 0;
  for (const dd of dimensionDrift) {
    sumSquared += dd.delta * dd.delta;
  }
  const overallDrift = round1(Math.sqrt(sumSquared));

  return {
    agentId,
    baseline,
    current,
    overallDrift,
    dimensionDrift,
    significant: overallDrift > SIGNIFICANT_DRIFT_THRESHOLD,
  };
}

// ---------------------------------------------------------------------------
// Cross-Agent Comparison
// ---------------------------------------------------------------------------

/**
 * Compare the current personalities of all 3 agents side-by-side.
 * Highlights which dimensions diverge most and which agent pair is most/least similar.
 *
 * @returns PersonalityComparison with all agents included (agents with no data get null snapshots)
 */
export function getPersonalityComparison(): PersonalityComparison {
  const agentSnapshots: Array<{ agentId: string; snapshot: PersonalitySnapshot }> = [];

  for (const agentId of AGENT_IDS) {
    const snapshot = computePersonality(agentId);
    if (snapshot) {
      agentSnapshots.push({ agentId, snapshot });
    }
  }

  const dimensions = [
    "aggressiveness",
    "contrarianism",
    "conviction",
    "diversification",
    "winSensitivity",
    "lossSensitivity",
  ] as const;

  // Find most divergent dimensions (biggest spread)
  const mostDivergentDimensions = dimensions
    .map((dim) => {
      const values = agentSnapshots.map((a) => ({
        agentId: a.agentId,
        value: a.snapshot[dim],
      }));
      if (values.length < 2) return null;

      const sorted = [...values].sort((a, b) => a.value - b.value);
      const spread = sorted[sorted.length - 1].value - sorted[0].value;
      return {
        dimension: dim,
        spread: round1(spread),
        highAgent: sorted[sorted.length - 1].agentId,
        lowAgent: sorted[0].agentId,
      };
    })
    .filter((d): d is NonNullable<typeof d> => d !== null)
    .sort((a, b) => b.spread - a.spread);

  // Pairwise distances
  let mostSimilarPair: PersonalityComparison["mostSimilarPair"] = null;
  let mostDifferentPair: PersonalityComparison["mostDifferentPair"] = null;
  let minDist = Infinity;
  let maxDist = -Infinity;

  for (let i = 0; i < agentSnapshots.length; i++) {
    for (let j = i + 1; j < agentSnapshots.length; j++) {
      const dist = personalityDistance(
        agentSnapshots[i].snapshot,
        agentSnapshots[j].snapshot,
      );
      if (dist < minDist) {
        minDist = dist;
        mostSimilarPair = {
          agents: [agentSnapshots[i].agentId, agentSnapshots[j].agentId],
          distance: round1(dist),
        };
      }
      if (dist > maxDist) {
        maxDist = dist;
        mostDifferentPair = {
          agents: [agentSnapshots[i].agentId, agentSnapshots[j].agentId],
          distance: round1(dist),
        };
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    agents: agentSnapshots,
    mostDivergentDimensions,
    mostSimilarPair,
    mostDifferentPair,
  };
}

// ---------------------------------------------------------------------------
// Evolution Story
// ---------------------------------------------------------------------------

/**
 * Generate a human-readable narrative of how an agent's personality has evolved.
 * This is designed for display on the dashboard to give users an intuitive
 * understanding of each agent's behavioral changes.
 *
 * @param agentId - The agent to narrate
 * @returns EvolutionStory with narrative text and key milestones
 */
export function getEvolutionStory(agentId: string): EvolutionStory {
  const agentName = AGENT_NAMES[agentId] ?? agentId;
  const timeline = snapshotTimeline.get(agentId) ?? [];
  const buffer = decisionStore.get(agentId) ?? [];

  if (timeline.length === 0) {
    return {
      agentId,
      generatedAt: new Date().toISOString(),
      narrative: `${agentName} has not yet built up enough trading history for personality analysis. After ${MIN_DECISIONS_FOR_SNAPSHOT} or more decisions, personality snapshots will begin to emerge.`,
      milestones: [],
    };
  }

  const first = timeline[0];
  const latest = timeline[timeline.length - 1];
  const drift = getPersonalityDrift(agentId);
  const milestones: EvolutionStory["milestones"] = [];

  // Build narrative parts
  const parts: string[] = [];

  // Opening: describe initial personality
  parts.push(
    `${agentName} began trading with a ${describeTraitLevel(first.aggressiveness, "aggressive", "passive")} style ` +
    `(aggressiveness: ${first.aggressiveness.toFixed(0)}), ` +
    `${describeTraitLevel(first.conviction, "high-conviction", "uncertain")} decisions ` +
    `(conviction: ${first.conviction.toFixed(0)}), ` +
    `and a ${describeTraitLevel(first.contrarianism, "contrarian", "consensus-following")} tendency ` +
    `(contrarianism: ${first.contrarianism.toFixed(0)}).`,
  );

  milestones.push({
    timestamp: first.computedAt,
    description: `Initial personality baseline established (${first.sampleSize} decisions analyzed)`,
  });

  // Middle: describe evolution trajectory
  if (timeline.length >= 3) {
    const mid = timeline[Math.floor(timeline.length / 2)];

    // Find the biggest change in the first half
    const firstHalfChanges = [
      { dim: "aggressiveness", delta: mid.aggressiveness - first.aggressiveness },
      { dim: "contrarianism", delta: mid.contrarianism - first.contrarianism },
      { dim: "conviction", delta: mid.conviction - first.conviction },
      { dim: "diversification", delta: mid.diversification - first.diversification },
    ].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    const biggestChange = firstHalfChanges[0];
    if (Math.abs(biggestChange.delta) > 5) {
      const direction = biggestChange.delta > 0 ? "increased" : "decreased";
      parts.push(
        `Over its first phase of trading, ${agentName}'s ${biggestChange.dim} ${direction} ` +
        `by ${Math.abs(biggestChange.delta).toFixed(0)} points, suggesting the agent was ` +
        `${direction === "increased" ? "becoming more" : "pulling back on"} ` +
        `${biggestChange.dim === "aggressiveness" ? "active trading" :
          biggestChange.dim === "contrarianism" ? "going against the crowd" :
          biggestChange.dim === "conviction" ? "confident in its calls" :
          "portfolio breadth"}.`,
      );

      milestones.push({
        timestamp: mid.computedAt,
        description: `${biggestChange.dim} ${direction} by ${Math.abs(biggestChange.delta).toFixed(0)} points`,
      });
    }
  }

  // Describe sensitivity to outcomes
  if (latest.winSensitivity > 65) {
    parts.push(
      `${agentName} shows strong reactivity to winning trades — after a profitable exit, ` +
      `it tends to noticeably shift its confidence and trade frequency. ` +
      `Win sensitivity: ${latest.winSensitivity.toFixed(0)}/100.`,
    );
  } else if (latest.winSensitivity < 35) {
    parts.push(
      `${agentName} is remarkably stoic after wins, barely adjusting its behavior ` +
      `regardless of positive outcomes. Win sensitivity: ${latest.winSensitivity.toFixed(0)}/100.`,
    );
  }

  if (latest.lossSensitivity > 65) {
    parts.push(
      `Losses hit ${agentName} hard behaviorally — it tends to significantly alter ` +
      `its trading patterns after a drawdown. Loss sensitivity: ${latest.lossSensitivity.toFixed(0)}/100.`,
    );
  } else if (latest.lossSensitivity < 35) {
    parts.push(
      `${agentName} handles losses with composure, maintaining consistent behavior ` +
      `even after negative outcomes. Loss sensitivity: ${latest.lossSensitivity.toFixed(0)}/100.`,
    );
  }

  // Describe current state
  parts.push(
    `Currently, ${agentName} is trading with ` +
    `${describeTraitLevel(latest.aggressiveness, "high", "low")} aggressiveness (${latest.aggressiveness.toFixed(0)}), ` +
    `${describeTraitLevel(latest.conviction, "strong", "weak")} conviction (${latest.conviction.toFixed(0)}), ` +
    `and ${describeTraitLevel(latest.diversification, "broad", "narrow")} diversification (${latest.diversification.toFixed(0)}).`,
  );

  // Drift summary
  if (drift && drift.significant) {
    const biggestDrift = drift.dimensionDrift
      .filter((d) => d.direction !== "stable")
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    if (biggestDrift.length > 0) {
      const top = biggestDrift[0];
      parts.push(
        `Overall personality drift is significant (${drift.overallDrift.toFixed(1)} points). ` +
        `The biggest shift has been in ${top.dimension}, which ${top.direction} by ` +
        `${Math.abs(top.delta).toFixed(0)} points from ${top.baselineValue.toFixed(0)} to ${top.currentValue.toFixed(0)}.`,
      );

      milestones.push({
        timestamp: latest.computedAt,
        description: `Significant personality drift detected: ${top.dimension} ${top.direction} by ${Math.abs(top.delta).toFixed(0)} points`,
      });
    }
  } else if (drift) {
    parts.push(
      `${agentName}'s personality has remained relatively stable throughout its trading career ` +
      `(drift: ${drift.overallDrift.toFixed(1)} points), suggesting a consistent and disciplined approach.`,
    );
  }

  // Trading volume context
  parts.push(
    `This analysis is based on ${buffer.length} recorded decisions and ${timeline.length} personality snapshots.`,
  );

  return {
    agentId,
    generatedAt: new Date().toISOString(),
    narrative: parts.join(" "),
    milestones,
  };
}

// ---------------------------------------------------------------------------
// Query Helpers
// ---------------------------------------------------------------------------

/**
 * Get the total number of recorded decisions for an agent.
 */
export function getDecisionCount(agentId: string): number {
  return decisionStore.get(agentId)?.length ?? 0;
}

/**
 * Get the most recent N decisions for an agent.
 */
export function getRecentDecisions(agentId: string, count = 10): RecordedDecision[] {
  const buffer = decisionStore.get(agentId) ?? [];
  return buffer.slice(-count);
}

/**
 * Get all agent IDs that have recorded decisions.
 */
export function getTrackedAgents(): string[] {
  return Array.from(decisionStore.keys());
}

/**
 * Reset all stored data (for testing or re-initialization).
 */
export function resetEvolutionData(): void {
  decisionStore.clear();
  snapshotTimeline.clear();
  globalSeq = 0;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute Euclidean distance between two personality snapshots
 * in the 6-dimensional personality space.
 */
function personalityDistance(a: PersonalitySnapshot, b: PersonalitySnapshot): number {
  const dims = [
    a.aggressiveness - b.aggressiveness,
    a.contrarianism - b.contrarianism,
    a.conviction - b.conviction,
    a.diversification - b.diversification,
    a.winSensitivity - b.winSensitivity,
    a.lossSensitivity - b.lossSensitivity,
  ];
  return Math.sqrt(dims.reduce((sum, d) => sum + d * d, 0));
}

/**
 * Describe a trait value in human-readable terms.
 * Returns the highLabel if value > 60, lowLabel if < 40, or "moderate" otherwise.
 */
function describeTraitLevel(value: number, highLabel: string, lowLabel: string): string {
  if (value > 75) return `very ${highLabel}`;
  if (value > 60) return highLabel;
  if (value < 25) return `very ${lowLabel}`;
  if (value < 40) return lowLabel;
  return "moderate";
}

// round1 imported from ../lib/math-utils.ts
