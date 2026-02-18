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

import { mean, round2, round3, computeVariance } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Grade Boundary Thresholds
 *
 * Letter grades assigned based on composite score (0-1 scale).
 * Higher thresholds = stricter grading standards.
 */

/** Composite score >= 0.95 = A+ (exceptional performance, top 5%) */
const GRADE_THRESHOLD_A_PLUS = 0.95;

/** Composite score >= 0.90 = A (excellent performance, top 10%) */
const GRADE_THRESHOLD_A = 0.90;

/** Composite score >= 0.85 = A- (very good performance) */
const GRADE_THRESHOLD_A_MINUS = 0.85;

/** Composite score >= 0.80 = B+ (good performance, above average) */
const GRADE_THRESHOLD_B_PLUS = 0.80;

/** Composite score >= 0.75 = B (solid performance) */
const GRADE_THRESHOLD_B = 0.75;

/** Composite score >= 0.70 = B- (slightly above average) */
const GRADE_THRESHOLD_B_MINUS = 0.70;

/** Composite score >= 0.65 = C+ (average performance) */
const GRADE_THRESHOLD_C_PLUS = 0.65;

/** Composite score >= 0.60 = C (acceptable performance) */
const GRADE_THRESHOLD_C = 0.60;

/** Composite score >= 0.55 = C- (below average) */
const GRADE_THRESHOLD_C_MINUS = 0.55;

/** Composite score >= 0.50 = D+ (poor performance) */
const GRADE_THRESHOLD_D_PLUS = 0.50;

/** Composite score >= 0.45 = D (very poor performance) */
const GRADE_THRESHOLD_D = 0.45;

/** Composite score >= 0.40 = D- (critically poor performance) */
const GRADE_THRESHOLD_D_MINUS = 0.40;

/** Composite score < 0.40 = F (failing) */

/**
 * ELO Rating Parameters
 *
 * Chess-style pairwise comparison rating system.
 * ELO updates based on head-to-head composite score comparisons.
 */

/** Initial ELO rating for new agents (1500 = average chess player baseline) */
const ELO_INITIAL = 1500;

/**
 * ELO K-factor: controls rating volatility (how much ratings change per game)
 * Higher K = faster adjustments, more volatile ratings
 * Lower K = slower convergence, more stable ratings
 * 32 is standard for active players in chess
 */
const ELO_K_FACTOR = 32;

/**
 * ELO divisor for expected score calculation
 * Formula: expectedA = 1 / (1 + 10^((ratingB - ratingA) / 400))
 * 400 points difference = 10:1 win probability
 */
const ELO_DIVISOR = 400;

/**
 * Glicko-2 Rating Parameters
 *
 * Enhanced ELO variant with confidence intervals (rating deviation).
 * Better for sparse data and handles rating uncertainty.
 */

/** Initial Glicko-2 rating (same scale as ELO: 1500 = average) */
const GLICKO_INITIAL_RATING = 1500;

/**
 * Initial Glicko-2 deviation (uncertainty in rating)
 * 350 = high uncertainty for new agents
 * Decreases as more games are played (converges to ~30-50)
 */
const GLICKO_INITIAL_DEVIATION = 350;

/**
 * Initial Glicko-2 volatility (expected rating fluctuation)
 * 0.06 = moderate volatility baseline
 */
const GLICKO_INITIAL_VOLATILITY = 0.06;

/**
 * Glicko-2 tau parameter (system constant)
 * Controls how much volatility can change
 * 0.5 is standard recommendation from Glickman's paper
 */
const GLICKO_TAU = 0.5;

/**
 * Glicko-2 phi scaling divisor
 * Converts deviation to phi scale: phi = deviation / 173.7178
 */
const GLICKO_PHI_SCALING_DIVISOR = 173.7178;

/**
 * Glicko-2 score scaling parameters
 * Map composite score (0-1) to Glicko range (~900-2100)
 * Formula: scaledScore = BASE + (score - 0.5) * RANGE
 * Example: 0.5 composite -> 1500 Glicko, 1.0 composite -> 1800 Glicko
 */
const GLICKO_SCORE_BASE = 1500;
const GLICKO_SCORE_RANGE = 600;

/**
 * Glicko-2 variance calculation parameters
 * v = 1 / (1 + VARIANCE_FACTOR * phi^2 / PI^2)
 */
const GLICKO_VARIANCE_FACTOR = 3;

/**
 * Glicko-2 volatility decay factor
 * newSigma = sigma * (1 - DECAY) + DECAY * abs(delta) / DIVISOR
 * 0.1 = moderate decay toward stable volatility
 */
const GLICKO_VOLATILITY_DECAY = 0.1;

/**
 * Glicko-2 deviation reduction multiplier
 * Deviation decreases over time: newPhi = sqrt(phi^2 + sigma^2) * REDUCTION
 * 0.95 = gradual reduction with each game played
 */
const GLICKO_DEVIATION_REDUCTION = 0.95;

/**
 * Glicko-2 minimum deviation floor
 * Prevents deviation from dropping too low (maintains some uncertainty)
 * 30 = experienced player with ~95% confidence interval ±60 rating points
 */
const GLICKO_MIN_DEVIATION = 30;

/**
 * Glicko-2 minimum volatility floor
 * Prevents volatility from becoming too stable (allows adaptation to performance changes)
 * 0.01 = very stable but not frozen
 */
const GLICKO_MIN_VOLATILITY = 0.01;

/**
 * Time Window Parameters
 *
 * Rolling windows for trend analysis and recent performance filtering.
 */

/** 24-hour window in milliseconds (1 day = 86,400,000 ms) */
const TIME_WINDOW_24H_MS = 24 * 60 * 60 * 1000;

/** 7-day window in milliseconds (1 week = 604,800,000 ms) */
const TIME_WINDOW_7D_MS = 7 * 24 * 60 * 60 * 1000;

/** 14-day window in milliseconds (2 weeks = 1,209,600,000 ms) */
const TIME_WINDOW_14D_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Trend Detection Thresholds
 *
 * Classify agent performance trajectory based on 7-day composite score change.
 */

/**
 * Composite score change > 0.03 (3 percentage points) = "improving" trend
 * Example: 0.75 -> 0.78 composite score over 7 days
 */
const TREND_IMPROVING_THRESHOLD = 0.03;

/**
 * Composite score change < -0.03 (-3 percentage points) = "declining" trend
 * Example: 0.80 -> 0.77 composite score over 7 days
 */
const TREND_DECLINING_THRESHOLD = -0.03;

/** Within ±3pp = "stable" trend (normal variation) */

/**
 * Display and History Limits
 */

/** Default leaderboard display limit (top N agents shown) */
const LEADERBOARD_DEFAULT_LIMIT = 50;

/** Maximum leaderboard snapshots retained in memory */
const MAX_SNAPSHOTS = 500;

/** Maximum history samples per metric (prevents unbounded memory growth) */
const MAX_HISTORY_PER_METRIC = 500;

/** Snapshot history query limit (getLeaderboardHistory default) */
const SNAPSHOT_HISTORY_DEFAULT_LIMIT = 20;

/** Recent scores shown in agent detail view */
const AGENT_DETAIL_RECENT_SCORES_LIMIT = 50;

/**
 * Glicko-2 Volatility Storage Precision
 *
 * Precision multiplier for rounding Glicko-2 volatility (sigma) to 4 decimal places.
 * Formula: Math.round(sigma × GLICKO_VOLATILITY_PRECISION) / GLICKO_VOLATILITY_PRECISION
 * Example: sigma = 0.123456 → stored as 0.1235 (4 decimal places)
 *
 * 4 decimal places (10000) is sufficient precision for sigma values which typically
 * range 0.01–0.10. Finer precision (100000) would add noise without benefit.
 */
const GLICKO_VOLATILITY_PRECISION = 10000;

/**
 * Percentile Rank Multiplier
 *
 * Converts a fraction (0–1) to an integer percentile (0–100).
 * Formula: Math.round(fraction × PERCENTILE_MULTIPLIER) = integer percentile
 * Example: 0.73 × 100 → 73rd percentile
 *
 * Standard 0–100 scale used in all percentile displays.
 */
const PERCENTILE_MULTIPLIER = 100;

/**
 * Sharpe Ratio Calculation
 */

/**
 * Minimum trades required for Sharpe ratio calculation
 * 3 trades = minimum sample size for meaningful variance estimate
 */
const SHARPE_MIN_TRADES = 3;

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
  const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / ELO_DIVISOR));
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
  const phi = state.glickoDeviation / GLICKO_PHI_SCALING_DIVISOR;
  const sigma = state.glickoVolatility;

  // Scale score to Glicko range
  const scaledScore = GLICKO_SCORE_BASE + (score - 0.5) * GLICKO_SCORE_RANGE;

  // Update rating (move toward performance)
  const v = 1 / (1 + GLICKO_VARIANCE_FACTOR * phi * phi / (Math.PI * Math.PI));
  const delta = v * (scaledScore - state.glickoRating);

  // Update volatility (simplified)
  const newSigma = Math.max(GLICKO_MIN_VOLATILITY, sigma * (1 - GLICKO_VOLATILITY_DECAY) + GLICKO_VOLATILITY_DECAY * Math.abs(delta) / ELO_DIVISOR);

  // Update deviation (decreases with more games)
  const newPhi = Math.max(GLICKO_MIN_DEVIATION, Math.sqrt(phi * phi + newSigma * newSigma) * GLICKO_PHI_SCALING_DIVISOR * GLICKO_DEVIATION_REDUCTION);

  // Update rating
  state.glickoRating = Math.round(state.glickoRating + ELO_K_FACTOR * delta / ELO_DIVISOR);
  state.glickoDeviation = Math.round(newPhi);
  state.glickoVolatility = Math.round(newSigma * GLICKO_VOLATILITY_PRECISION) / GLICKO_VOLATILITY_PRECISION;
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
  const limit = options?.limit ?? LEADERBOARD_DEFAULT_LIMIT;

  const now = Date.now();
  const windowMs = timeWindow === "24h" ? TIME_WINDOW_24H_MS :
    timeWindow === "7d" ? TIME_WINDOW_7D_MS : Infinity;

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

    const avgCoherence = mean(slice(state.coherenceHistory));
    const halRate = mean(slice(state.hallucinationHistory));
    const discRate = mean(slice(state.disciplineHistory));
    const avgCalibration = mean(slice(state.calibrationHistory));
    const winRate = mean(slice(state.outcomeHistory));
    const avgPnl = mean(slice(state.pnlHistory));

    // Sharpe ratio estimate (simplified)
    const pnlSlice = slice(state.pnlHistory);
    const sharpe = pnlSlice.length >= SHARPE_MIN_TRADES ? sharpeRatio(pnlSlice) : 0;

    // Trend analysis
    const scores7d = state.compositeScores.filter(
      (s) => now - s.timestamp < TIME_WINDOW_7D_MS,
    );
    const scores7dPrev = state.compositeScores.filter(
      (s) => now - s.timestamp >= TIME_WINDOW_7D_MS &&
             now - s.timestamp < TIME_WINDOW_14D_MS,
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
      (s) => now - s.timestamp < TIME_WINDOW_24H_MS,
    ).length;
    const tradesLast7d = state.compositeScores.filter(
      (s) => now - s.timestamp < TIME_WINDOW_7D_MS,
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
        pnlPercent: round2(avgPnl),
        sharpeRatio: round2(sharpe),
        coherence: round2(avgCoherence),
        hallucinationRate: round2(halRate),
        disciplineRate: round2(discRate),
        calibrationScore: round2(avgCalibration),
        winRate: round2(winRate),
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
    ? Math.round((belowCount / allComposites.length) * PERCENTILE_MULTIPLIER)
    : 50;

  return {
    state,
    recentScores: state.compositeScores.slice(-AGENT_DETAIL_RECENT_SCORES_LIMIT),
    percentileRank,
  };
}

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

function sharpeRatio(returns: number[]): number {
  if (returns.length < 3) return 0;
  const m = mean(returns);
  const variance = computeVariance(returns, true); // true = population variance
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return 0;
  return m / stdDev;
}
