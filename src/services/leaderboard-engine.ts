/**
 * Real-time Benchmark Leaderboard Engine
 *
 * The definitive ranking system for MoltApp's AI trading benchmark.
 * Combines multiple ranking methodologies to produce a fair, robust leaderboard:
 *
 * 1. COMPOSITE SCORE: Weighted average of all benchmark pillars
 * 2. ELO RATING: Pairwise comparison-based skill rating (chess-style)
 * 3. GLICKO-2: ELO variant with confidence intervals (better for sparse data)
 * 4. PERCENTILE RANKS: Where each agent falls relative to the field
 * 5. TREND ANALYSIS: Is the agent improving or declining?
 *
 * The engine maintains rolling windows for different time horizons:
 * - All-time: Complete history
 * - 7-day: Recent performance
 * - 24-hour: Today's performance
 *
 * Rankings are updated in real-time as trades are scored.
 */

import { round3 } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Complete leaderboard entry for one agent */
export interface LeaderboardEntry {
  /** Agent identifier */
  agentId: string;
  /** Display name */
  agentName: string;
  /** LLM model used */
  model: string;
  /** Provider (anthropic, openai, xai, external) */
  provider: string;
  /** Current rank position (1-indexed) */
  rank: number;
  /** Previous rank (for trend arrows) */
  previousRank: number;
  /** Rank change: positive = moved up */
  rankChange: number;

  /** Composite benchmark score (0-1) */
  compositeScore: number;
  /** Letter grade */
  grade: string;

  /** Individual metric scores */
  metrics: {
    pnlPercent: number;
    sharpeRatio: number;
    coherence: number;
    hallucinationRate: number;
    disciplineRate: number;
    calibrationScore: number;
    winRate: number;
  };

  /** ELO/Glicko ratings */
  ratings: {
    elo: number;
    glickoRating: number;
    glickoDeviation: number;
    glickoVolatility: number;
  };

  /** Activity stats */
  stats: {
    totalTrades: number;
    tradesLast24h: number;
    tradesLast7d: number;
    currentStreak: number;
    bestStreak: number;
  };

  /** Trend indicators */
  trend: {
    direction: "improving" | "stable" | "declining";
    compositeChange7d: number;
    eloChange7d: number;
  };

  /** Whether this is an external (submitted) or internal agent */
  isExternal: boolean;
}

/** Snapshot of the leaderboard at a point in time */
export interface LeaderboardSnapshot {
  timestamp: string;
  entries: LeaderboardEntry[];
  metadata: {
    totalAgents: number;
    totalTrades: number;
    avgComposite: number;
    topAgent: string;
    methodologyVersion: string;
  };
}

// ---------------------------------------------------------------------------
// Internal State
// ---------------------------------------------------------------------------

interface AgentState {
  agentId: string;
  agentName: string;
  model: string;
  provider: string;
  isExternal: boolean;

  // Composite scores
  compositeScores: { score: number; timestamp: number }[];
  currentComposite: number;

  // Individual metrics (rolling averages)
  pnlHistory: number[];
  coherenceHistory: number[];
  hallucinationHistory: number[];  // 0 or 1 per trade
  disciplineHistory: number[];     // 0 or 1 per trade
  calibrationHistory: number[];
  outcomeHistory: number[];        // 1 = win, 0 = loss

  // ELO
  elo: number;

  // Glicko-2
  glickoRating: number;
  glickoDeviation: number;
  glickoVolatility: number;

  // Streaks
  currentStreak: number;
  bestStreak: number;

  // Previous rank
  previousRank: number;
}

const agentStates = new Map<string, AgentState>();
const snapshotHistory: LeaderboardSnapshot[] = [];
const MAX_SNAPSHOTS = 500;
const MAX_HISTORY_PER_METRIC = 500;

// Glicko-2 constants
const GLICKO_INITIAL_RATING = 1500;
const GLICKO_INITIAL_DEVIATION = 350;
const GLICKO_INITIAL_VOLATILITY = 0.06;
const GLICKO_TAU = 0.5;

// ELO constants
const ELO_INITIAL = 1500;
const ELO_K_FACTOR = 32;

// ---------------------------------------------------------------------------
// Agent Registration
// ---------------------------------------------------------------------------

/**
 * Register or update an agent in the leaderboard engine.
 */
export function registerAgent(params: {
  agentId: string;
  agentName: string;
  model: string;
  provider: string;
  isExternal?: boolean;
}): void {
  if (agentStates.has(params.agentId)) return;

  agentStates.set(params.agentId, {
    agentId: params.agentId,
    agentName: params.agentName,
    model: params.model,
    provider: params.provider,
    isExternal: params.isExternal ?? false,
    compositeScores: [],
    currentComposite: 0,
    pnlHistory: [],
    coherenceHistory: [],
    hallucinationHistory: [],
    disciplineHistory: [],
    calibrationHistory: [],
    outcomeHistory: [],
    elo: ELO_INITIAL,
    glickoRating: GLICKO_INITIAL_RATING,
    glickoDeviation: GLICKO_INITIAL_DEVIATION,
    glickoVolatility: GLICKO_INITIAL_VOLATILITY,
    currentStreak: 0,
    bestStreak: 0,
    previousRank: 0,
  });
}

// ---------------------------------------------------------------------------
// Score Recording
// ---------------------------------------------------------------------------

/**
 * Record a new benchmark score for an agent.
 * Updates all ranking systems (composite, ELO, Glicko-2).
 */
export function recordScore(params: {
  agentId: string;
  compositeScore: number;
  coherence: number;
  hallucinationDetected: boolean;
  disciplinePassed: boolean;
  calibration: number;
  pnl: number;
  isWin: boolean;
}): void {
  const state = agentStates.get(params.agentId);
  if (!state) return;

  const now = Date.now();

  // Update composite
  state.compositeScores.push({ score: params.compositeScore, timestamp: now });
  state.currentComposite = params.compositeScore;

  // Update metric histories
  state.coherenceHistory.push(params.coherence);
  state.hallucinationHistory.push(params.hallucinationDetected ? 1 : 0);
  state.disciplineHistory.push(params.disciplinePassed ? 1 : 0);
  state.calibrationHistory.push(params.calibration);
  state.pnlHistory.push(params.pnl);
  state.outcomeHistory.push(params.isWin ? 1 : 0);

  // Trim histories
  for (const arr of [
    state.compositeScores as unknown[],
    state.coherenceHistory,
    state.hallucinationHistory,
    state.disciplineHistory,
    state.calibrationHistory,
    state.pnlHistory,
    state.outcomeHistory,
  ]) {
    if (arr.length > MAX_HISTORY_PER_METRIC) {
      arr.splice(0, arr.length - MAX_HISTORY_PER_METRIC);
    }
  }

  // Update streaks
  if (params.isWin) {
    state.currentStreak++;
    state.bestStreak = Math.max(state.bestStreak, state.currentStreak);
  } else {
    state.currentStreak = 0;
  }

  // Update ELO (pairwise against all other agents)
  for (const [otherId, otherState] of agentStates) {
    if (otherId === params.agentId) continue;
    if (otherState.compositeScores.length === 0) continue;

    // Did this agent score higher than the other?
    const thisScore = params.compositeScore;
    const otherScore = otherState.currentComposite;
    const result = thisScore > otherScore ? 1 : thisScore < otherScore ? 0 : 0.5;

    const [newElo, otherNewElo] = updateElo(state.elo, otherState.elo, result);
    state.elo = newElo;
    otherState.elo = otherNewElo;
  }

  // Update Glicko-2 (simplified)
  updateGlicko2(state, params.compositeScore);
}

// ---------------------------------------------------------------------------
// ELO Calculation
// ---------------------------------------------------------------------------

function updateElo(ratingA: number, ratingB: number, result: number): [number, number] {
  const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  const expectedB = 1 - expectedA;

  const newA = Math.round(ratingA + ELO_K_FACTOR * (result - expectedA));
  const newB = Math.round(ratingB + ELO_K_FACTOR * ((1 - result) - expectedB));

  return [newA, newB];
}

// ---------------------------------------------------------------------------
// Simplified Glicko-2
// ---------------------------------------------------------------------------

function updateGlicko2(state: AgentState, score: number): void {
  // Simplified Glicko-2: decrease deviation over time, adjust rating toward score
  const phi = state.glickoDeviation / 173.7178;
  const sigma = state.glickoVolatility;

  // Scale score to Glicko range
  const scaledScore = 1500 + (score - 0.5) * 600; // 0.5 composite -> 1500

  // Update rating (move toward performance)
  const v = 1 / (1 + 3 * phi * phi / (Math.PI * Math.PI));
  const delta = v * (scaledScore - state.glickoRating);

  // Update volatility (simplified)
  const newSigma = Math.max(0.01, sigma * (1 - 0.1) + 0.1 * Math.abs(delta) / 400);

  // Update deviation (decreases with more games)
  const newPhi = Math.max(30, Math.sqrt(phi * phi + newSigma * newSigma) * 173.7178 * 0.95);

  // Update rating
  state.glickoRating = Math.round(state.glickoRating + ELO_K_FACTOR * delta / 400);
  state.glickoDeviation = Math.round(newPhi);
  state.glickoVolatility = Math.round(newSigma * 10000) / 10000;
}

// ---------------------------------------------------------------------------
// Leaderboard Generation
// ---------------------------------------------------------------------------

/**
 * Generate the current leaderboard with all ranking information.
 */
export function getLeaderboard(options?: {
  timeWindow?: "all" | "7d" | "24h";
  includeExternal?: boolean;
  limit?: number;
}): LeaderboardSnapshot {
  const timeWindow = options?.timeWindow ?? "all";
  const includeExternal = options?.includeExternal ?? true;
  const limit = options?.limit ?? 50;

  const now = Date.now();
  const windowMs = timeWindow === "24h" ? 24 * 60 * 60 * 1000 :
    timeWindow === "7d" ? 7 * 24 * 60 * 60 * 1000 : Infinity;

  const entries: LeaderboardEntry[] = [];

  for (const state of agentStates.values()) {
    if (!includeExternal && state.isExternal) continue;
    if (state.compositeScores.length === 0) continue;

    // Filter scores by time window
    const windowScores = state.compositeScores.filter(
      (s) => now - s.timestamp < windowMs,
    );
    if (windowScores.length === 0 && timeWindow !== "all") continue;

    const relevantScores = windowScores.length > 0 ? windowScores : state.compositeScores;
    const avgComposite = relevantScores.reduce((s, e) => s + e.score, 0) / relevantScores.length;

    // Calculate rolling averages for metrics
    const recentN = Math.min(relevantScores.length, state.coherenceHistory.length);
    const slice = <T>(arr: T[]) => arr.slice(-recentN);

    const avgCoherence = avg(slice(state.coherenceHistory));
    const halRate = avg(slice(state.hallucinationHistory));
    const discRate = avg(slice(state.disciplineHistory));
    const avgCalibration = avg(slice(state.calibrationHistory));
    const winRate = avg(slice(state.outcomeHistory));
    const avgPnl = avg(slice(state.pnlHistory));

    // Sharpe ratio estimate (simplified)
    const pnlSlice = slice(state.pnlHistory);
    const sharpe = pnlSlice.length >= 3 ? sharpeRatio(pnlSlice) : 0;

    // Trend analysis
    const scores7d = state.compositeScores.filter(
      (s) => now - s.timestamp < 7 * 24 * 60 * 60 * 1000,
    );
    const scores7dPrev = state.compositeScores.filter(
      (s) => now - s.timestamp >= 7 * 24 * 60 * 60 * 1000 &&
             now - s.timestamp < 14 * 24 * 60 * 60 * 1000,
    );

    const avg7d = scores7d.length > 0 ? scores7d.reduce((s, e) => s + e.score, 0) / scores7d.length : avgComposite;
    const avg7dPrev = scores7dPrev.length > 0 ? scores7dPrev.reduce((s, e) => s + e.score, 0) / scores7dPrev.length : avgComposite;
    const compositeChange7d = avg7d - avg7dPrev;

    const direction: "improving" | "stable" | "declining" =
      compositeChange7d > 0.03 ? "improving" :
      compositeChange7d < -0.03 ? "declining" : "stable";

    // Grade
    const grade = avgComposite >= 0.95 ? "A+" : avgComposite >= 0.90 ? "A" :
      avgComposite >= 0.85 ? "A-" : avgComposite >= 0.80 ? "B+" :
      avgComposite >= 0.75 ? "B" : avgComposite >= 0.70 ? "B-" :
      avgComposite >= 0.65 ? "C+" : avgComposite >= 0.60 ? "C" :
      avgComposite >= 0.55 ? "C-" : avgComposite >= 0.50 ? "D+" :
      avgComposite >= 0.45 ? "D" : avgComposite >= 0.40 ? "D-" : "F";

    // Trades by time window
    const tradesLast24h = state.compositeScores.filter(
      (s) => now - s.timestamp < 24 * 60 * 60 * 1000,
    ).length;
    const tradesLast7d = state.compositeScores.filter(
      (s) => now - s.timestamp < 7 * 24 * 60 * 60 * 1000,
    ).length;

    entries.push({
      agentId: state.agentId,
      agentName: state.agentName,
      model: state.model,
      provider: state.provider,
      rank: 0, // Will be set after sorting
      previousRank: state.previousRank,
      rankChange: 0,
      compositeScore: round3(avgComposite),
      grade,
      metrics: {
        pnlPercent: Math.round(avgPnl * 100) / 100,
        sharpeRatio: Math.round(sharpe * 100) / 100,
        coherence: Math.round(avgCoherence * 100) / 100,
        hallucinationRate: Math.round(halRate * 100) / 100,
        disciplineRate: Math.round(discRate * 100) / 100,
        calibrationScore: Math.round(avgCalibration * 100) / 100,
        winRate: Math.round(winRate * 100) / 100,
      },
      ratings: {
        elo: state.elo,
        glickoRating: state.glickoRating,
        glickoDeviation: state.glickoDeviation,
        glickoVolatility: state.glickoVolatility,
      },
      stats: {
        totalTrades: state.compositeScores.length,
        tradesLast24h,
        tradesLast7d,
        currentStreak: state.currentStreak,
        bestStreak: state.bestStreak,
      },
      trend: {
        direction,
        compositeChange7d: round3(compositeChange7d),
        eloChange7d: 0, // Would need historical ELO tracking
      },
      isExternal: state.isExternal,
    });
  }

  // Sort by composite score descending
  entries.sort((a, b) => b.compositeScore - a.compositeScore);

  // Assign ranks
  for (let i = 0; i < entries.length; i++) {
    entries[i].rank = i + 1;
    entries[i].rankChange = entries[i].previousRank > 0
      ? entries[i].previousRank - entries[i].rank
      : 0;

    // Update previous rank for next time
    const state = agentStates.get(entries[i].agentId);
    if (state) state.previousRank = entries[i].rank;
  }

  const limited = entries.slice(0, limit);

  // Build snapshot
  const snapshot: LeaderboardSnapshot = {
    timestamp: new Date().toISOString(),
    entries: limited,
    metadata: {
      totalAgents: entries.length,
      totalTrades: entries.reduce((s, e) => s + e.stats.totalTrades, 0),
      avgComposite: entries.length > 0
        ? round3(entries.reduce((s, e) => s + e.compositeScore, 0) / entries.length)
        : 0,
      topAgent: entries[0]?.agentId ?? "none",
      methodologyVersion: "v3.0",
    },
  };

  // Store snapshot
  snapshotHistory.unshift(snapshot);
  if (snapshotHistory.length > MAX_SNAPSHOTS) {
    snapshotHistory.length = MAX_SNAPSHOTS;
  }

  return snapshot;
}

/**
 * Get historical leaderboard snapshots.
 */
export function getLeaderboardHistory(limit = 20): LeaderboardSnapshot[] {
  return snapshotHistory.slice(0, limit);
}

/**
 * Get detailed stats for a specific agent.
 */
export function getAgentLeaderboardDetail(agentId: string): {
  state: AgentState | null;
  recentScores: { score: number; timestamp: number }[];
  percentileRank: number;
} {
  const state = agentStates.get(agentId);
  if (!state) {
    return { state: null, recentScores: [], percentileRank: 0 };
  }

  // Calculate percentile rank
  const allComposites = Array.from(agentStates.values())
    .filter((s) => s.compositeScores.length > 0)
    .map((s) => s.currentComposite);
  const belowCount = allComposites.filter((c) => c < state.currentComposite).length;
  const percentileRank = allComposites.length > 0
    ? Math.round((belowCount / allComposites.length) * 100)
    : 50;

  return {
    state,
    recentScores: state.compositeScores.slice(-50),
    percentileRank,
  };
}

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function sharpeRatio(returns: number[]): number {
  if (returns.length < 3) return 0;
  const mean = avg(returns);
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return 0;
  return mean / stdDev;
}
