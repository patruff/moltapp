/**
 * Competition Replay Service
 *
 * Replays entire competition sessions between the 3 AI trading agents,
 * reconstructing the full narrative arc of how each round unfolded.
 * Generates decision trees, identifies turning points, and builds
 * auto-generated narratives with market-relevant language.
 *
 * Features:
 * - Ring buffer of up to 2000 competition events
 * - Lead change tracking with margin analysis
 * - Auto-generated competition narratives with chapters
 * - Decision tree construction with counterfactual "what if" branches
 * - Key moment extraction ranked by impact
 * - Per-agent narrative arcs (their journey through the competition)
 * - Chronological timeline replay with optional time-range filtering
 */

import { countByCondition, round2 } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Any recordable event in the competition lifecycle. */
export interface CompetitionEvent {
  type:
    | "round_start"
    | "decision"
    | "trade_executed"
    | "trade_failed"
    | "circuit_breaker"
    | "lead_change"
    | "milestone"
    | "round_end";
  timestamp: string;
  agentId?: string;
  roundId: string;
  /** Arbitrary payload specific to the event type. */
  details: Record<string, unknown>;
}

/** Records when the leading agent changes during the competition. */
export interface LeadChange {
  previousLeader: string;
  newLeader: string;
  /** Absolute difference in P&L % between old and new leader. */
  margin: number;
  roundNumber: number;
  timestamp: string;
}

/** A chapter within the competition narrative. */
export interface NarrativeChapter {
  title: string;
  events: CompetitionEvent[];
  /** Duration of the chapter in human-readable form. */
  duration: string;
  /** How significant this chapter was to the overall competition (0-100). */
  significance: number;
}

/** Per-agent story arc describing their journey through the competition. */
export interface AgentArc {
  agentId: string;
  agentLabel: string;
  totalRounds: number;
  totalTrades: number;
  successfulTrades: number;
  failedTrades: number;
  leadRounds: number;
  bestRound: { roundId: string; pnlDelta: number } | null;
  worstRound: { roundId: string; pnlDelta: number } | null;
  /** Short narrative summary of this agent's competition journey. */
  narrativeSummary: string;
  /** Trait tags inferred from behavior, e.g. "aggressive", "consistent". */
  traits: string[];
  /** Key decisions that defined this agent's arc. */
  definingMoments: CompetitionEvent[];
}

/** Full auto-generated narrative for the competition. */
export interface CompetitionNarrative {
  headline: string;
  chapters: NarrativeChapter[];
  /** The 5 most impactful events across the entire competition. */
  keyMoments: CompetitionEvent[];
  /** Events where the competition outcome materially shifted. */
  turningPoints: CompetitionEvent[];
  currentStandings: Array<{ agentId: string; agentLabel: string; pnlPercent: number; rank: number }>;
  agentArcs: Record<string, AgentArc>;
}

/** A single node in an agent's decision tree. */
export interface DecisionNode {
  roundId: string;
  decision: string;
  outcome: "profit" | "loss" | "neutral" | "failed";
  portfolioValueAfter: number;
  pnlDelta: number;
}

/** A counterfactual "what if" branch. */
export interface CounterfactualBranch {
  roundId: string;
  actualDecision: string;
  alternativeDecision: string;
  estimatedPnlDelta: number;
  /** Explanation of the counterfactual scenario. */
  narrative: string;
}

/** Hierarchical view of an agent's decision history. */
export interface DecisionTree {
  agentId: string;
  agentLabel: string;
  nodes: DecisionNode[];
  /** "What if" counterfactual branches (e.g. what if agent had held). */
  branches: CounterfactualBranch[];
  /** The 3 decisions that most impacted the agent's final P&L. */
  criticalDecisions: DecisionNode[];
}

/** Summary of the overall competition state. */
export interface CompetitionSummary {
  totalEvents: number;
  totalRounds: number;
  totalLeadChanges: number;
  currentLeader: string | null;
  standings: Array<{ agentId: string; agentLabel: string; pnlPercent: number; rank: number }>;
  eventsPerAgent: Record<string, number>;
  startedAt: string | null;
  lastEventAt: string | null;
  competitionDuration: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENT_IDS = ["claude-trader", "gpt-momentum", "grok-contrarian"] as const;

const AGENT_LABELS: Record<string, string> = {
  "claude-trader": "Claude (Value Trader)",
  "gpt-momentum": "GPT (Momentum Trader)",
  "grok-contrarian": "Grok (Contrarian)",
};

/** Maximum events stored before the ring buffer overwrites the oldest. */
const MAX_EVENTS = 2000;

/** Number of key moments returned by default. */
const DEFAULT_KEY_MOMENTS = 5;

/** Number of critical decisions per agent decision tree. */
const CRITICAL_DECISION_COUNT = 3;

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Headline Generation Parameters
 *
 * Control how competition headlines are generated based on standings and volatility.
 */

/** When standings margin < 1.0% between top 2 agents, classify as "close" competition. */
const HEADLINE_CLOSE_STANDINGS_MARGIN = 1.0;

/**
 * Chapter Construction Parameters
 *
 * Determine how event streams are grouped into narrative chapters.
 */

/**
 * Chapter Title Classification Thresholds
 *
 * Determine which narrative title template is selected for each chapter.
 */




/**
 * Defining Moments Selection Parameters
 *
 * Control how many significant events are highlighted in agent narrative arcs.
 */

/** Default number of defining moments shown per agent arc. */
const DEFINING_MOMENTS_DEFAULT_LIMIT = 5;

/** If defining moments < 3, add high-impact trades to fill narrative. */
const DEFINING_MOMENTS_MIN_COUNT = 3;

/** Minimum P&L delta for a trade to qualify as high-impact (>0.5% absolute). */
const DEFINING_MOMENTS_MIN_PNL_DELTA = 0.5;


// ---------------------------------------------------------------------------
// Module-Level State
// ---------------------------------------------------------------------------

/** Ring buffer of competition events. */
const eventBuffer: CompetitionEvent[] = [];

/** Write pointer for the ring buffer. */
let eventWriteIndex = 0;

/** Total events ever recorded (may exceed MAX_EVENTS). */
let totalEventsRecorded = 0;

/** All lead changes in chronological order. */
const leadChanges: LeadChange[] = [];

/** Per-agent running P&L %. Updated via event details. */
const agentPnl = new Map<string, number>();

/** Per-agent portfolio value tracking. */
const agentPortfolioValue = new Map<string, number>();

/** Set of distinct round IDs seen. */
const roundsSeen = new Set<string>();

// ---------------------------------------------------------------------------
// Ring Buffer Helpers
// ---------------------------------------------------------------------------

/**
 * Return all events from the ring buffer in chronological order.
 * When the buffer has wrapped, events before the write pointer are newer.
 */
function getAllEvents(): CompetitionEvent[] {
  if (totalEventsRecorded <= MAX_EVENTS) {
    return eventBuffer.slice(0, totalEventsRecorded);
  }
  // Buffer has wrapped: [writeIndex..end] are older, [0..writeIndex) are newer
  return [
    ...eventBuffer.slice(eventWriteIndex),
    ...eventBuffer.slice(0, eventWriteIndex),
  ];
}

// ---------------------------------------------------------------------------
// Event Recording
// ---------------------------------------------------------------------------

/**
 * Record a competition event into the ring buffer.
 * Automatically updates internal state such as agent P&L, portfolio values,
 * and round tracking.
 *
 * @param event - The competition event to record.
 */
export function recordEvent(event: CompetitionEvent): void {
  // Write into the ring buffer
  if (totalEventsRecorded < MAX_EVENTS) {
    eventBuffer.push(event);
  } else {
    eventBuffer[eventWriteIndex] = event;
  }
  eventWriteIndex = (eventWriteIndex + 1) % MAX_EVENTS;
  totalEventsRecorded++;

  // Track rounds
  roundsSeen.add(event.roundId);

  // Update per-agent state from event details
  if (event.agentId) {
    if (typeof event.details.pnlPercent === "number") {
      agentPnl.set(event.agentId, event.details.pnlPercent as number);
    }
    if (typeof event.details.portfolioValue === "number") {
      agentPortfolioValue.set(event.agentId, event.details.portfolioValue as number);
    }
  }
}

/**
 * Record a lead change between two agents.
 *
 * @param previousLeader - Agent ID of the former leader.
 * @param newLeader - Agent ID of the new leader.
 * @param margin - Absolute P&L % difference between them.
 * @param roundNumber - The round in which the change occurred.
 */
export function recordLeadChange(
  previousLeader: string,
  newLeader: string,
  margin: number,
  roundNumber: number,
): void {
  const timestamp = new Date().toISOString();

  leadChanges.push({ previousLeader, newLeader, margin, roundNumber, timestamp });

  // Also record as a competition event
  recordEvent({
    type: "lead_change",
    timestamp,
    agentId: newLeader,
    roundId: `round_${roundNumber}`,
    details: {
      previousLeader,
      newLeader,
      margin,
      roundNumber,
    },
  });
}

// ---------------------------------------------------------------------------
// Narrative Generation
// ---------------------------------------------------------------------------

/**
 * Auto-generate the full competition narrative.
 * Analyzes all recorded events, identifies chapters (phases of the
 * competition), picks key moments, and builds per-agent arcs.
 *
 * @returns A complete CompetitionNarrative object.
 */
export function generateNarrative(): CompetitionNarrative {
  const allEvents = getAllEvents();
  const standings = buildStandings();
  const chapters = buildChapters(allEvents);
  const keyMoments = getKeyMoments(DEFAULT_KEY_MOMENTS);
  const turningPoints = identifyTurningPoints(allEvents);
  const agentArcs = buildAllAgentArcs(allEvents);

  const headline = generateHeadline(standings, allEvents);

  return {
    headline,
    chapters,
    keyMoments,
    turningPoints,
    currentStandings: standings,
    agentArcs,
  };
}

/**
 * Generate a one-line headline summarizing the competition state.
 */
function generateHeadline(
  standings: CompetitionNarrative["currentStandings"],
  allEvents: CompetitionEvent[],
): string {
  if (standings.length === 0) {
    return "Competition has not yet begun — agents are warming up.";
  }

  const leader = standings[0];
  const totalRounds = roundsSeen.size;
  const totalChanges = leadChanges.length;

  if (totalRounds <= 1) {
    return `${leader.agentLabel} takes an early lead after the opening round with ${leader.pnlPercent.toFixed(2)}% P&L.`;
  }

  if (totalChanges === 0) {
    return `${leader.agentLabel} has dominated from the start, holding the lead for all ${totalRounds} rounds with ${leader.pnlPercent.toFixed(2)}% P&L.`;
  }

  const isClose = standings.length >= 2 && Math.abs(standings[0].pnlPercent - standings[1].pnlPercent) < HEADLINE_CLOSE_STANDINGS_MARGIN;

  if (isClose) {
    return `A razor-thin margin separates the top two agents after ${totalRounds} rounds — ${standings[0].agentLabel} edges out ${standings[1].agentLabel} by just ${Math.abs(standings[0].pnlPercent - standings[1].pnlPercent).toFixed(2)}%.`;
  }

  return `${leader.agentLabel} leads after ${totalRounds} rounds with ${leader.pnlPercent.toFixed(2)}% P&L — ${totalChanges} lead change${totalChanges !== 1 ? "s" : ""} so far in a volatile contest.`;
}

/**
 * Break the event stream into narrative chapters based on round boundaries.
 * Each chapter covers one or more rounds and is scored for significance.
 */
function buildChapters(allEvents: CompetitionEvent[]): NarrativeChapter[] {
  if (allEvents.length === 0) return [];

  // Group events by round
  const roundGroups = new Map<string, CompetitionEvent[]>();
  for (const event of allEvents) {
    const group = roundGroups.get(event.roundId) ?? [];
    group.push(event);
    roundGroups.set(event.roundId, group);
  }

  const chapters: NarrativeChapter[] = [];
  const sortedRoundIds = [...roundGroups.keys()].sort();

  // Batch consecutive rounds into chapters of ~3 rounds each
  const ROUNDS_PER_CHAPTER = 3;
  for (let i = 0; i < sortedRoundIds.length; i += ROUNDS_PER_CHAPTER) {
    const chapterRoundIds = sortedRoundIds.slice(i, i + ROUNDS_PER_CHAPTER);
    const chapterEvents: CompetitionEvent[] = [];
    for (const rid of chapterRoundIds) {
      chapterEvents.push(...(roundGroups.get(rid) ?? []));
    }

    const chapterStart = chapterEvents[0]?.timestamp;
    const chapterEnd = chapterEvents[chapterEvents.length - 1]?.timestamp;
    const durationMs = chapterStart && chapterEnd
      ? new Date(chapterEnd).getTime() - new Date(chapterStart).getTime()
      : 0;

    // Significance: weighted by lead changes, circuit breakers, and event density
    const chapterLeadChanges = countByCondition(chapterEvents, (e) => e.type === "lead_change");
    const circuitBreakers = countByCondition(chapterEvents, (e) => e.type === "circuit_breaker");
    const milestones = countByCondition(chapterEvents, (e) => e.type === "milestone");
    const significance = Math.min(100,
      20 + chapterLeadChanges * 25 + circuitBreakers * 15 + milestones * 10 +
      Math.min(20, chapterEvents.length * 2),
    );

    const chapterNumber = Math.floor(i / ROUNDS_PER_CHAPTER) + 1;
    const title = generateChapterTitle(chapterNumber, chapterEvents, chapterLeadChanges);

    chapters.push({
      title,
      events: chapterEvents,
      duration: formatDuration(durationMs),
      significance,
    });
  }

  return chapters;
}

/**
 * Generate a descriptive title for a narrative chapter.
 */
function generateChapterTitle(
  chapterNumber: number,
  events: CompetitionEvent[],
  leadChangeCount: number,
): string {
  const hasCircuitBreaker = events.some((e) => e.type === "circuit_breaker");
  const failedTrades = countByCondition(events, (e) => e.type === "trade_failed");

  if (chapterNumber === 1) {
    return "Opening Salvos — The Agents Enter the Arena";
  }

  if (leadChangeCount >= 2) {
    return `Chapter ${chapterNumber}: The Pendulum Swings — Multiple Lead Changes`;
  }

  if (hasCircuitBreaker) {
    return `Chapter ${chapterNumber}: Circuit Breakers Fire — Volatility Spikes`;
  }

  if (failedTrades >= 2) {
    return `Chapter ${chapterNumber}: Turbulent Waters — Execution Challenges`;
  }

  if (leadChangeCount === 1) {
    const changeEvent = events.find((e) => e.type === "lead_change");
    const newLeader = changeEvent?.details.newLeader as string | undefined;
    const label = newLeader ? (AGENT_LABELS[newLeader] ?? newLeader) : "A new contender";
    return `Chapter ${chapterNumber}: ${label} Seizes the Lead`;
  }

  return `Chapter ${chapterNumber}: Steady Hands — Position Jockeying`;
}

// ---------------------------------------------------------------------------
// Key Moments & Turning Points
// ---------------------------------------------------------------------------

/**
 * Return the most impactful events in the competition.
 * Impact is scored based on event type, P&L delta, and whether it
 * coincided with a lead change.
 *
 * @param limit - Maximum number of moments to return (default 5).
 */
export function getKeyMoments(limit = DEFAULT_KEY_MOMENTS): CompetitionEvent[] {
  const allEvents = getAllEvents();
  if (allEvents.length === 0) return [];

  // Score each event for impact
  const scored = allEvents.map((event) => {
    let score = 0;

    switch (event.type) {
      case "lead_change":
        score += 50 + Math.min(30, (event.details.margin as number ?? 0) * 10);
        break;
      case "circuit_breaker":
        score += 40;
        break;
      case "milestone":
        score += 35;
        break;
      case "trade_failed":
        score += 20;
        break;
      case "trade_executed":
        score += 10 + Math.min(20, Math.abs(event.details.pnlDelta as number ?? 0) * 5);
        break;
      case "decision":
        score += 5 + Math.min(15, (event.details.confidence as number ?? 0) / 5);
        break;
      case "round_start":
      case "round_end":
        score += 2;
        break;
    }

    // Boost if pnlDelta is large
    const pnlDelta = event.details.pnlDelta as number | undefined;
    if (pnlDelta !== undefined) {
      score += Math.min(25, Math.abs(pnlDelta) * 8);
    }

    return { event, score };
  });

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map((s) => s.event);
}

/**
 * Identify events where the competition outcome materially shifted.
 * Turning points are lead changes with significant margin, circuit breaker
 * activations, and milestone events that altered the standings.
 */
function identifyTurningPoints(allEvents: CompetitionEvent[]): CompetitionEvent[] {
  const turningPoints: CompetitionEvent[] = [];

  for (const event of allEvents) {
    if (event.type === "lead_change") {
      const margin = event.details.margin as number ?? 0;
      // Only count as a turning point if the margin is meaningful
      if (margin >= 0.5) {
        turningPoints.push(event);
      }
    }

    if (event.type === "circuit_breaker") {
      turningPoints.push(event);
    }

    if (event.type === "milestone") {
      turningPoints.push(event);
    }

    // A large single-trade loss or gain can be a turning point
    if (event.type === "trade_executed" || event.type === "trade_failed") {
      const pnlDelta = event.details.pnlDelta as number | undefined;
      if (pnlDelta !== undefined && Math.abs(pnlDelta) >= 2.0) {
        turningPoints.push(event);
      }
    }
  }

  // Sort by timestamp
  turningPoints.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  return turningPoints;
}

// ---------------------------------------------------------------------------
// Decision Tree
// ---------------------------------------------------------------------------

/**
 * Build the decision tree for a specific agent.
 * Shows every decision, its outcome, and generates counterfactual
 * branches showing what would have happened if the agent had held.
 *
 * @param agentId - The agent to build the tree for.
 * @returns The complete DecisionTree, or null if no data exists.
 */
export function getDecisionTree(agentId: string): DecisionTree | null {
  const allEvents = getAllEvents();
  const agentEvents = allEvents.filter((e) => e.agentId === agentId);

  if (agentEvents.length === 0) return null;

  const nodes: DecisionNode[] = [];
  const branches: CounterfactualBranch[] = [];

  // Build nodes from decision and trade events
  const decisionEvents = agentEvents.filter(
    (e) => e.type === "decision" || e.type === "trade_executed" || e.type === "trade_failed",
  );

  let runningPortfolioValue = 10000; // assumed starting capital

  for (const event of decisionEvents) {
    const pnlDelta = (event.details.pnlDelta as number) ?? 0;
    const portfolioValueAfter = (event.details.portfolioValue as number) ?? (runningPortfolioValue + pnlDelta * 100);
    runningPortfolioValue = portfolioValueAfter;

    const decision = (event.details.action as string) ?? (event.details.decision as string) ?? event.type;
    const outcome = determineOutcome(event, pnlDelta);

    nodes.push({
      roundId: event.roundId,
      decision,
      outcome,
      portfolioValueAfter,
      pnlDelta,
    });

    // Generate a counterfactual: "what if the agent had held?"
    if (decision !== "hold" && event.type !== "trade_failed") {
      const estimatedHoldPnl = 0; // Holding preserves current value
      const actualPnl = pnlDelta;
      const difference = estimatedHoldPnl - actualPnl;

      const narrative = actualPnl >= 0
        ? `If ${AGENT_LABELS[agentId] ?? agentId} had held instead of ${decision}ing, they would have missed a ${Math.abs(actualPnl).toFixed(2)}% gain.`
        : `If ${AGENT_LABELS[agentId] ?? agentId} had held instead of ${decision}ing, they would have avoided a ${Math.abs(actualPnl).toFixed(2)}% loss.`;

      branches.push({
        roundId: event.roundId,
        actualDecision: decision,
        alternativeDecision: "hold",
        estimatedPnlDelta: difference,
        narrative,
      });
    }
  }

  // Identify the 3 most impactful decisions by absolute P&L delta
  const sortedByImpact = [...nodes].sort(
    (a, b) => Math.abs(b.pnlDelta) - Math.abs(a.pnlDelta),
  );
  const criticalDecisions = sortedByImpact.slice(0, CRITICAL_DECISION_COUNT);

  return {
    agentId,
    agentLabel: AGENT_LABELS[agentId] ?? agentId,
    nodes,
    branches,
    criticalDecisions,
  };
}

/**
 * Determine the outcome category for a decision event.
 */
function determineOutcome(
  event: CompetitionEvent,
  pnlDelta: number,
): DecisionNode["outcome"] {
  if (event.type === "trade_failed") return "failed";
  if (pnlDelta > 0.1) return "profit";
  if (pnlDelta < -0.1) return "loss";
  return "neutral";
}

// ---------------------------------------------------------------------------
// Timeline Replay
// ---------------------------------------------------------------------------

/**
 * Retrieve a chronological event replay, optionally filtered by time range.
 *
 * @param startTime - ISO timestamp; only events at or after this time.
 * @param endTime - ISO timestamp; only events at or before this time.
 * @returns Array of CompetitionEvents in chronological order.
 */
export function getReplayTimeline(
  startTime?: string,
  endTime?: string,
): CompetitionEvent[] {
  let events = getAllEvents();

  if (startTime) {
    const startMs = new Date(startTime).getTime();
    events = events.filter((e) => new Date(e.timestamp).getTime() >= startMs);
  }

  if (endTime) {
    const endMs = new Date(endTime).getTime();
    events = events.filter((e) => new Date(e.timestamp).getTime() <= endMs);
  }

  // Ensure chronological order
  events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  return events;
}

// ---------------------------------------------------------------------------
// Competition Summary
// ---------------------------------------------------------------------------

/**
 * Get the current competition state as a summary.
 *
 * @returns CompetitionSummary with standings, event counts, and metadata.
 */
export function getCompetitionSummary(): CompetitionSummary {
  const allEvents = getAllEvents();
  const standings = buildStandings();

  // Count events per agent
  const eventsPerAgent: Record<string, number> = {};
  for (const agentId of AGENT_IDS) {
    eventsPerAgent[agentId] = countByCondition(allEvents, (e) => e.agentId === agentId);
  }

  // Determine time boundaries
  let startedAt: string | null = null;
  let lastEventAt: string | null = null;
  if (allEvents.length > 0) {
    const sorted = [...allEvents].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
    startedAt = sorted[0].timestamp;
    lastEventAt = sorted[sorted.length - 1].timestamp;
  }

  const durationMs = startedAt && lastEventAt
    ? new Date(lastEventAt).getTime() - new Date(startedAt).getTime()
    : 0;

  return {
    totalEvents: Math.min(totalEventsRecorded, MAX_EVENTS),
    totalRounds: roundsSeen.size,
    totalLeadChanges: leadChanges.length,
    currentLeader: standings.length > 0 ? standings[0].agentId : null,
    standings,
    eventsPerAgent,
    startedAt,
    lastEventAt,
    competitionDuration: formatDuration(durationMs),
  };
}

// ---------------------------------------------------------------------------
// Agent Arc
// ---------------------------------------------------------------------------

/**
 * Get the narrative arc for a single agent.
 *
 * @param agentId - The agent to build the arc for.
 * @returns The agent's narrative arc, or null if no data.
 */
export function getAgentArc(agentId: string): AgentArc | null {
  const allEvents = getAllEvents();
  return buildAgentArc(agentId, allEvents);
}

/**
 * Build narrative arcs for all agents.
 */
function buildAllAgentArcs(allEvents: CompetitionEvent[]): Record<string, AgentArc> {
  const arcs: Record<string, AgentArc> = {};
  for (const agentId of AGENT_IDS) {
    const arc = buildAgentArc(agentId, allEvents);
    if (arc) {
      arcs[agentId] = arc;
    }
  }
  return arcs;
}

/**
 * Build the narrative arc for a single agent from the event stream.
 */
function buildAgentArc(agentId: string, allEvents: CompetitionEvent[]): AgentArc | null {
  const agentEvents = allEvents.filter((e) => e.agentId === agentId);
  if (agentEvents.length === 0) return null;

  const label = AGENT_LABELS[agentId] ?? agentId;

  const trades = agentEvents.filter(
    (e) => e.type === "trade_executed" || e.type === "trade_failed",
  );
  const successfulTrades = countByCondition(trades, (e) => e.type === "trade_executed");
  const failedTrades = countByCondition(trades, (e) => e.type === "trade_failed");
  const totalTrades = trades.length;

  // Determine rounds this agent participated in
  const agentRoundIds = new Set(agentEvents.map((e) => e.roundId));
  const totalRounds = agentRoundIds.size;

  // Count rounds where this agent was in the lead
  const leadRounds = leadChanges.filter((lc) => lc.newLeader === agentId).length;

  // Find best and worst rounds by pnlDelta
  const roundPnl = new Map<string, number>();
  for (const event of agentEvents) {
    const delta = event.details.pnlDelta as number | undefined;
    if (delta !== undefined) {
      const current = roundPnl.get(event.roundId) ?? 0;
      roundPnl.set(event.roundId, current + delta);
    }
  }

  let bestRound: AgentArc["bestRound"] = null;
  let worstRound: AgentArc["worstRound"] = null;
  for (const [roundId, pnl] of roundPnl) {
    if (!bestRound || pnl > bestRound.pnlDelta) {
      bestRound = { roundId, pnlDelta: pnl };
    }
    if (!worstRound || pnl < worstRound.pnlDelta) {
      worstRound = { roundId, pnlDelta: pnl };
    }
  }

  // Infer behavioral traits
  const traits = inferTraits(agentId, agentEvents, totalTrades, successfulTrades, failedTrades);

  // Defining moments: highest impact events for this agent
  const definingMoments = agentEvents
    .filter((e) => e.type === "lead_change" || e.type === "circuit_breaker" || e.type === "milestone")
    .slice(0, DEFINING_MOMENTS_DEFAULT_LIMIT);

  // If not enough defining moments from special events, add high-delta trades
  if (definingMoments.length < DEFINING_MOMENTS_MIN_COUNT) {
    const highImpactTrades = trades
      .filter((e) => {
        const delta = e.details.pnlDelta as number | undefined;
        return delta !== undefined && Math.abs(delta) > DEFINING_MOMENTS_MIN_PNL_DELTA;
      })
      .sort((a, b) => Math.abs((b.details.pnlDelta as number) ?? 0) - Math.abs((a.details.pnlDelta as number) ?? 0))
      .slice(0, DEFINING_MOMENTS_MIN_COUNT - definingMoments.length);
    definingMoments.push(...highImpactTrades);
  }

  const narrativeSummary = generateAgentNarrativeSummary(
    label, totalRounds, totalTrades, successfulTrades, failedTrades,
    leadRounds, bestRound, worstRound, traits,
  );

  return {
    agentId,
    agentLabel: label,
    totalRounds,
    totalTrades,
    successfulTrades,
    failedTrades,
    leadRounds,
    bestRound,
    worstRound,
    narrativeSummary,
    traits,
    definingMoments,
  };
}

/**
 * Infer behavioral traits from an agent's event history.
 */
function inferTraits(
  agentId: string,
  events: CompetitionEvent[],
  totalTrades: number,
  successfulTrades: number,
  failedTrades: number,
): string[] {
  const traits: string[] = [];

  // Execution reliability
  if (totalTrades > 0) {
    const successRate = successfulTrades / totalTrades;
    if (successRate >= 0.9) traits.push("reliable-executor");
    if (successRate < 0.5) traits.push("error-prone");
  }

  // Trade frequency
  const decisions = events.filter((e) => e.type === "decision");
  const holds = decisions.filter((e) => (e.details.action as string) === "hold");
  if (decisions.length > 0 && holds.length / decisions.length > 0.6) {
    traits.push("cautious");
  } else if (decisions.length > 0 && holds.length / decisions.length < 0.2) {
    traits.push("aggressive");
  }

  // Confidence patterns
  const confidences = decisions
    .map((e) => e.details.confidence as number | undefined)
    .filter((c): c is number => c !== undefined);
  if (confidences.length > 0) {
    const avgConf = confidences.reduce((a, b) => a + b, 0) / confidences.length;
    if (avgConf > 75) traits.push("high-conviction");
    if (avgConf < 40) traits.push("uncertain");
  }

  // Circuit breaker frequency
  const circuitBreakers = events.filter((e) => e.type === "circuit_breaker");
  if (circuitBreakers.length >= 2) traits.push("volatility-trigger");

  // Lead changes involving this agent
  const agentLeadChanges = leadChanges.filter(
    (lc) => lc.newLeader === agentId || lc.previousLeader === agentId,
  );
  if (agentLeadChanges.length >= 3) traits.push("competitive");

  // Consistency: look at P&L variance
  const pnlDeltas = events
    .map((e) => e.details.pnlDelta as number | undefined)
    .filter((d): d is number => d !== undefined);
  if (pnlDeltas.length >= 3) {
    const mean = pnlDeltas.reduce((a, b) => a + b, 0) / pnlDeltas.length;
    const variance = pnlDeltas.reduce((sum, d) => sum + (d - mean) ** 2, 0) / pnlDeltas.length;
    if (Math.sqrt(variance) < 0.5) traits.push("consistent");
    if (Math.sqrt(variance) > 2.0) traits.push("volatile-returns");
  }

  return traits;
}

/**
 * Generate a human-readable narrative summary for an agent.
 */
function generateAgentNarrativeSummary(
  label: string,
  totalRounds: number,
  totalTrades: number,
  successfulTrades: number,
  failedTrades: number,
  leadRounds: number,
  bestRound: AgentArc["bestRound"],
  worstRound: AgentArc["worstRound"],
  traits: string[],
): string {
  const parts: string[] = [];

  parts.push(
    `${label} participated in ${totalRounds} round${totalRounds !== 1 ? "s" : ""}, executing ${totalTrades} trade${totalTrades !== 1 ? "s" : ""}.`,
  );

  if (totalTrades > 0) {
    const successRate = ((successfulTrades / totalTrades) * 100).toFixed(0);
    parts.push(
      `Trade execution rate: ${successRate}% (${successfulTrades} filled, ${failedTrades} failed).`,
    );
  }

  if (leadRounds > 0) {
    parts.push(`Held the lead position ${leadRounds} time${leadRounds !== 1 ? "s" : ""}.`);
  }

  if (bestRound && bestRound.pnlDelta > 0) {
    parts.push(
      `Best performance came in ${bestRound.roundId} with a +${bestRound.pnlDelta.toFixed(2)}% gain.`,
    );
  }

  if (worstRound && worstRound.pnlDelta < 0) {
    parts.push(
      `Toughest moment was ${worstRound.roundId} with a ${worstRound.pnlDelta.toFixed(2)}% drawdown.`,
    );
  }

  if (traits.length > 0) {
    const traitLabels = traits.map((t) => t.replace(/-/g, " ")).join(", ");
    parts.push(`Key traits: ${traitLabels}.`);
  }

  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

/**
 * Build the current standings sorted by P&L.
 */
function buildStandings(): CompetitionNarrative["currentStandings"] {
  const entries: CompetitionNarrative["currentStandings"] = [];

  for (const agentId of AGENT_IDS) {
    const pnl = agentPnl.get(agentId) ?? 0;
    entries.push({
      agentId,
      agentLabel: AGENT_LABELS[agentId] ?? agentId,
      pnlPercent: round2(pnl),
      rank: 0, // computed after sort
    });
  }

  entries.sort((a, b) => b.pnlPercent - a.pnlPercent);
  for (let i = 0; i < entries.length; i++) {
    entries[i].rank = i + 1;
  }

  return entries;
}

/**
 * Format a millisecond duration into a human-readable string.
 */
function formatDuration(ms: number): string {
  if (ms <= 0) return "0s";

  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const remainSec = seconds % 60;
    return remainSec > 0 ? `${minutes}m ${remainSec}s` : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainMin = minutes % 60;
  if (hours < 24) {
    return remainMin > 0 ? `${hours}h ${remainMin}m` : `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  const remainHours = hours % 24;
  return remainHours > 0 ? `${days}d ${remainHours}h` : `${days}d`;
}

// ---------------------------------------------------------------------------
// Reset (for testing)
// ---------------------------------------------------------------------------

/**
 * Reset all module-level state. Intended for use in tests only.
 */
export function _resetForTesting(): void {
  eventBuffer.length = 0;
  eventWriteIndex = 0;
  totalEventsRecorded = 0;
  leadChanges.length = 0;
  agentPnl.clear();
  agentPortfolioValue.clear();
  roundsSeen.clear();
}
