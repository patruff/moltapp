/**
 * Benchmark Leaderboard Evolution Service
 *
 * Tracks how agent rankings change over time using an ELO-like rating system
 * adapted for multi-factor benchmarks. Makes the benchmark narrative-driven
 * and engaging by surfacing streaks, rank changes, and rating trajectories.
 *
 * Key capabilities:
 * 1. ELO RATINGS: Pairwise ELO updates from composite benchmark scores
 * 2. RANK TRACKING: Position changes across rounds
 * 3. STREAK DETECTION: Win/loss streaks (holding #1 = winning)
 * 4. HISTORY: Full leaderboard snapshots over time
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentRoundResult {
  agentId: string;
  agentName: string;
  compositeScore: number;
  pnl: number;
  coherence: number;
  hallucinationRate: number;
}

export interface AgentRanking {
  agentId: string;
  agentName: string;
  elo: number;
  rank: number;
  previousRank: number;
  rankChange: number;
  compositeScore: number;
  streak: StreakInfo;
  roundsPlayed: number;
}

export interface EloEntry {
  roundId: string;
  elo: number;
  rank: number;
  compositeScore: number;
  timestamp: string;
}

export interface StreakInfo {
  type: "winning" | "losing" | "none";
  length: number;
  longestWin: number;
  longestLoss: number;
}

export interface LeaderboardSnapshot {
  roundId: string;
  timestamp: string;
  rankings: AgentRanking[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Starting ELO for new agents */
const DEFAULT_ELO = 1500;

/** Standard ELO K-factor: how much a single round can swing ratings */
const K_FACTOR = 32;

/**
 * ELO expected score denominator.
 * Standard chess ELO uses 400 as the divisor in the logistic function:
 * E(A) = 1 / (1 + 10^((R_B - R_A) / ELO_SCALE_FACTOR))
 * A difference of 400 points means ~91% win probability for the higher-rated agent.
 */
const ELO_SCALE_FACTOR = 400;

/**
 * ELO draw outcome score (0.5 for both players in a tie).
 * Standard ELO: win=1.0, draw=0.5, loss=0.0
 */
const ELO_DRAW_SCORE = 0.5;

/**
 * ELO display rounding precision multiplier.
 * Math.round(elo * ELO_DISPLAY_PRECISION) / ELO_DISPLAY_PRECISION = 1 decimal place.
 * Example: 1523.67 → 1523.7
 */
const ELO_DISPLAY_PRECISION = 10;

/** Maximum snapshots retained in memory */
const MAX_SNAPSHOTS = 500;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Current ELO rating per agent */
const eloRatings = new Map<string, number>();

/** Agent display names */
const agentNames = new Map<string, string>();

/** ELO history per agent (agentId -> entries) */
const eloHistory = new Map<string, EloEntry[]>();

/** Full leaderboard snapshots over time */
const leaderboardHistory: LeaderboardSnapshot[] = [];

/** Previous rank per agent (for computing rank changes) */
const previousRanks = new Map<string, number>();

/** Rank history per agent for streak computation (1 = was #1 that round) */
const rankResults = new Map<string, number[]>();

// ---------------------------------------------------------------------------
// Public API: Record Round
// ---------------------------------------------------------------------------

/**
 * Record a round's results and update all ELO ratings via pairwise comparison.
 * Each pair of agents plays an ELO "game" where the higher composite score wins.
 */
export function recordRoundResult(
  roundId: string,
  agentResults: AgentRoundResult[],
): void {
  if (agentResults.length < 2) return;

  // Ensure all agents have a starting ELO
  for (const result of agentResults) {
    if (!eloRatings.has(result.agentId)) {
      eloRatings.set(result.agentId, DEFAULT_ELO);
    }
    agentNames.set(result.agentId, result.agentName);
  }

  // Pairwise ELO updates: every agent plays against every other agent
  for (let i = 0; i < agentResults.length; i++) {
    for (let j = i + 1; j < agentResults.length; j++) {
      const a = agentResults[i];
      const b = agentResults[j];

      const ratingA = eloRatings.get(a.agentId)!;
      const ratingB = eloRatings.get(b.agentId)!;

      const { newA, newB } = calculateEloUpdate(
        ratingA,
        ratingB,
        a.compositeScore,
        b.compositeScore,
      );

      eloRatings.set(a.agentId, newA);
      eloRatings.set(b.agentId, newB);
    }
  }

  // Sort agents by updated ELO to determine new ranks
  const sorted = [...eloRatings.entries()].sort((a, b) => b[1] - a[1]);

  const now = new Date().toISOString();
  const rankings: AgentRanking[] = [];

  for (let rank = 0; rank < sorted.length; rank++) {
    const [agentId, elo] = sorted[rank];
    const currentRank = rank + 1;
    const prevRank = previousRanks.get(agentId) ?? currentRank;
    const result = agentResults.find((r) => r.agentId === agentId);

    // Update rank history for streaks
    const history = rankResults.get(agentId) ?? [];
    history.push(currentRank);
    rankResults.set(agentId, history);

    // Record ELO history entry
    const entry: EloEntry = {
      roundId,
      elo: round(elo),
      rank: currentRank,
      compositeScore: result?.compositeScore ?? 0,
      timestamp: now,
    };
    const agentHistory = eloHistory.get(agentId) ?? [];
    agentHistory.push(entry);
    eloHistory.set(agentId, agentHistory);

    rankings.push({
      agentId,
      agentName: agentNames.get(agentId) ?? agentId,
      elo: round(elo),
      rank: currentRank,
      previousRank: prevRank,
      rankChange: prevRank - currentRank,
      compositeScore: result?.compositeScore ?? 0,
      streak: getStreakInfo(agentId),
      roundsPlayed: (eloHistory.get(agentId) ?? []).length,
    });

    // Store current rank as previous for next round
    previousRanks.set(agentId, currentRank);
  }

  // Save leaderboard snapshot
  leaderboardHistory.push({ roundId, timestamp: now, rankings });
  if (leaderboardHistory.length > MAX_SNAPSHOTS) {
    leaderboardHistory.splice(0, leaderboardHistory.length - MAX_SNAPSHOTS);
  }
}

// ---------------------------------------------------------------------------
// Public API: ELO Calculation
// ---------------------------------------------------------------------------

/**
 * Compute new ELO ratings for two agents after a pairwise comparison.
 * Uses the standard ELO formula with K-factor 32.
 *
 * The "game outcome" is derived from composite benchmark scores:
 * - Higher composite score = win (S=1), lower = loss (S=0)
 * - Tied scores = draw (S=0.5)
 */
export function calculateEloUpdate(
  ratingA: number,
  ratingB: number,
  scoreA: number,
  scoreB: number,
): { newA: number; newB: number } {
  // Expected scores (probability of winning)
  const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / ELO_SCALE_FACTOR));
  const expectedB = 1 - expectedA;

  // Actual outcome based on composite scores
  let actualA: number;
  let actualB: number;

  if (scoreA > scoreB) {
    actualA = 1;
    actualB = 0;
  } else if (scoreB > scoreA) {
    actualA = 0;
    actualB = 1;
  } else {
    actualA = ELO_DRAW_SCORE;
    actualB = ELO_DRAW_SCORE;
  }

  // ELO update
  const newA = ratingA + K_FACTOR * (actualA - expectedA);
  const newB = ratingB + K_FACTOR * (actualB - expectedB);

  return { newA: round(newA), newB: round(newB) };
}

// ---------------------------------------------------------------------------
// Public API: Queries
// ---------------------------------------------------------------------------

/**
 * Get historical leaderboard snapshots.
 * Returns the most recent snapshots up to the specified limit.
 */
export function getLeaderboardHistory(limit?: number): LeaderboardSnapshot[] {
  const count = limit ?? leaderboardHistory.length;
  return leaderboardHistory.slice(-count);
}

/**
 * Get an agent's ELO rating history over time.
 * Useful for charting rating trajectories.
 */
export function getAgentEloHistory(agentId: string): EloEntry[] {
  return eloHistory.get(agentId) ?? [];
}

/**
 * Get the current leaderboard rankings with ELO, composite scores,
 * streaks, and rank change information.
 */
export function getCurrentRankings(): AgentRanking[] {
  const sorted = [...eloRatings.entries()].sort((a, b) => b[1] - a[1]);

  return sorted.map(([agentId, elo], index) => {
    const rank = index + 1;
    const prevRank = previousRanks.get(agentId) ?? rank;
    const history = eloHistory.get(agentId) ?? [];
    const lastEntry = history[history.length - 1];

    return {
      agentId,
      agentName: agentNames.get(agentId) ?? agentId,
      elo: round(elo),
      rank,
      previousRank: prevRank,
      rankChange: prevRank - rank,
      compositeScore: lastEntry?.compositeScore ?? 0,
      streak: getStreakInfo(agentId),
      roundsPlayed: history.length,
    };
  });
}

// ---------------------------------------------------------------------------
// Public API: Streaks
// ---------------------------------------------------------------------------

/**
 * Compute win/loss streak information for an agent.
 * Being ranked #1 counts as a "win"; any other rank is a "loss".
 */
export function getStreakInfo(agentId: string): StreakInfo {
  const ranks = rankResults.get(agentId);
  if (!ranks || ranks.length === 0) {
    return { type: "none", length: 0, longestWin: 0, longestLoss: 0 };
  }

  let longestWin = 0;
  let longestLoss = 0;
  let currentWin = 0;
  let currentLoss = 0;

  for (const rank of ranks) {
    if (rank === 1) {
      currentWin++;
      currentLoss = 0;
      longestWin = Math.max(longestWin, currentWin);
    } else {
      currentLoss++;
      currentWin = 0;
      longestLoss = Math.max(longestLoss, currentLoss);
    }
  }

  // Current streak is whatever the tail of the array shows
  let type: StreakInfo["type"] = "none";
  let length = 0;

  if (currentWin > 0) {
    type = "winning";
    length = currentWin;
  } else if (currentLoss > 0) {
    type = "losing";
    length = currentLoss;
  }

  return { type, length, longestWin, longestLoss };
}

// ---------------------------------------------------------------------------
// Internal: Utilities
// ---------------------------------------------------------------------------

/** Round to 1 decimal place for clean display */
function round(v: number): number {
  return Math.round(v * ELO_DISPLAY_PRECISION) / ELO_DISPLAY_PRECISION;
}
