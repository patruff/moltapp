/**
 * Benchmark Composite Ranker
 *
 * Industry-standard multi-factor ranking system for the MoltApp AI Trading
 * Benchmark. Combines financial performance, reasoning quality, and behavioral
 * metrics into a single composite score with transparent weights.
 *
 * Ranking methodology:
 * 1. Normalize each factor to [0, 1] using min-max or sigmoid scaling
 * 2. Apply configurable weights (default from eval.yaml)
 * 3. Compute weighted composite score
 * 4. Apply Elo adjustments from head-to-head rounds
 * 5. Generate letter grades, percentile ranks, and trend data
 *
 * This is the definitive ranking that appears on the /benchmark page
 * and gets exported to HuggingFace.
 */

import { normalize } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RankingFactors {
  /** ROI percentage (can be negative) */
  pnlPercent: number;
  /** Risk-adjusted return */
  sharpeRatio: number;
  /** Average coherence score 0-1 */
  coherence: number;
  /** Hallucination rate 0-1 (lower is better) */
  hallucinationRate: number;
  /** Instruction discipline rate 0-1 */
  disciplineRate: number;
  /** Confidence calibration score 0-1 */
  calibration: number;
  /** Win rate 0-1 */
  winRate: number;
  /** Total trades executed */
  tradeCount: number;
}

export interface RankedAgent {
  agentId: string;
  agentName: string;
  rank: number;
  compositeScore: number;
  grade: string;
  eloRating: number;
  percentile: number;
  factors: RankingFactors;
  normalizedFactors: Record<string, number>;
  trend: "improving" | "declining" | "stable";
  streakInfo: {
    currentStreak: "win" | "loss" | "neutral";
    streakLength: number;
  };
}

export interface RankingConfig {
  weights: {
    pnlPercent: number;
    sharpeRatio: number;
    coherence: number;
    hallucinationRate: number;
    disciplineRate: number;
    calibration: number;
  };
  eloK: number;
  minTradesForRanking: number;
}

export interface LeaderboardSnapshot {
  rankings: RankedAgent[];
  generatedAt: string;
  methodologyVersion: string;
  totalRounds: number;
  config: RankingConfig;
}

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Letter grade boundaries based on composite score.
 *
 * These thresholds define the grading scale shown on the leaderboard and
 * exported to HuggingFace. They control how agents are classified for public
 * benchmark presentation.
 */
const GRADE_THRESHOLD_A_PLUS = 0.95; // >= 0.95 = A+ (exceptional performance across all dimensions)
const GRADE_THRESHOLD_A = 0.90; // >= 0.90 = A (excellent multi-factor performance)
const GRADE_THRESHOLD_A_MINUS = 0.85; // >= 0.85 = A- (very good performance)
const GRADE_THRESHOLD_B_PLUS = 0.80; // >= 0.80 = B+ (good performance)
const GRADE_THRESHOLD_B = 0.75; // >= 0.75 = B (above average)
const GRADE_THRESHOLD_B_MINUS = 0.70; // >= 0.70 = B- (slightly above average)
const GRADE_THRESHOLD_C_PLUS = 0.65; // >= 0.65 = C+ (average)
const GRADE_THRESHOLD_C = 0.60; // >= 0.60 = C (acceptable)
const GRADE_THRESHOLD_C_MINUS = 0.55; // >= 0.55 = C- (below average)
const GRADE_THRESHOLD_D_PLUS = 0.50; // >= 0.50 = D+ (poor)
const GRADE_THRESHOLD_D = 0.45; // >= 0.45 = D (very poor)
const GRADE_THRESHOLD_D_MINUS = 0.40; // >= 0.40 = D- (failing)
// < 0.40 = F (critical underperformance)

/**
 * Elo rating system parameters.
 *
 * Industry-standard Elo uses a divisor of 400 for expected score calculation.
 * This controls how much rating changes per head-to-head matchup.
 */
const ELO_EXPECTED_SCORE_DIVISOR = 400; // Standard Elo divisor for 10^(delta/400) calculation
const ELO_TIE_THRESHOLD = 0.01; // |scoreA - scoreB| < 0.01 = tie (0.5 points each)
const INITIAL_ELO = 1500; // Starting Elo rating for new agents (standard baseline)

/**
 * P&L normalization parameters.
 *
 * Sigmoid normalization maps P&L percentage to [0, 1] scale:
 * - 0% P&L → 0.5 (neutral)
 * - +10% P&L → ~0.73 (good)
 * - -10% P&L → ~0.27 (poor)
 */
const PNL_NORMALIZATION_DIVISOR = 10; // Divides P&L% for sigmoid steepness control

/**
 * Trend detection parameters.
 *
 * Trends are computed by comparing recent vs older composite score averages.
 * If the difference exceeds the threshold, the agent is classified as improving/declining.
 */
const TREND_IMPROVEMENT_THRESHOLD = 0.02; // Delta > 0.02 = improving trend
const TREND_DECLINE_THRESHOLD = -0.02; // Delta < -0.02 = declining trend

/**
 * Trend history window sizes.
 *
 * Trend analysis uses two windows: recent and older. These sizes control
 * how many historical scores are used to detect performance changes.
 */
const TREND_RECENT_WINDOW = 5; // Last 5 composite scores for recent average
const TREND_OLDER_WINDOW_START = -10; // Older window starts 10 scores back
const TREND_OLDER_WINDOW_END = -5; // Older window ends 5 scores back
const TREND_MIN_HISTORY = 5; // Minimum history entries required for trend calculation

/**
 * Historical data retention limits.
 *
 * Prevents unbounded memory growth by limiting stored composite score history.
 */
const MAX_HISTORY = 200; // Maximum composite score history entries per agent

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: RankingConfig = {
  weights: {
    pnlPercent: 0.25,
    sharpeRatio: 0.20,
    coherence: 0.20,
    hallucinationRate: 0.15,
    disciplineRate: 0.10,
    calibration: 0.10,
  },
  eloK: 32,
  minTradesForRanking: 3,
};

let currentConfig = { ...DEFAULT_CONFIG };

// ---------------------------------------------------------------------------
// Elo Rating System
// ---------------------------------------------------------------------------

const eloRatings: Map<string, number> = new Map();

/**
 * Get or initialize an agent's Elo rating.
 */
function getElo(agentId: string): number {
  if (!eloRatings.has(agentId)) {
    eloRatings.set(agentId, INITIAL_ELO);
  }
  return eloRatings.get(agentId)!;
}

/**
 * Update Elo ratings after a head-to-head round comparison.
 * Winner is the agent with higher composite score in a round.
 */
export function updateEloFromRound(
  agentA: string,
  agentB: string,
  scoreA: number,
  scoreB: number,
): { newEloA: number; newEloB: number } {
  const eloA = getElo(agentA);
  const eloB = getElo(agentB);

  // Expected scores
  const expectedA = 1 / (1 + Math.pow(10, (eloB - eloA) / ELO_EXPECTED_SCORE_DIVISOR));
  const expectedB = 1 / (1 + Math.pow(10, (eloA - eloB) / ELO_EXPECTED_SCORE_DIVISOR));

  // Actual outcomes (0, 0.5, or 1)
  let actualA: number;
  let actualB: number;
  if (Math.abs(scoreA - scoreB) < ELO_TIE_THRESHOLD) {
    actualA = 0.5;
    actualB = 0.5;
  } else if (scoreA > scoreB) {
    actualA = 1;
    actualB = 0;
  } else {
    actualA = 0;
    actualB = 1;
  }

  const newEloA = Math.round(eloA + currentConfig.eloK * (actualA - expectedA));
  const newEloB = Math.round(eloB + currentConfig.eloK * (actualB - expectedB));

  eloRatings.set(agentA, newEloA);
  eloRatings.set(agentB, newEloB);

  return { newEloA, newEloB };
}

/**
 * Process all pairwise Elo updates for a round.
 */
export function processRoundElo(
  roundResults: { agentId: string; compositeScore: number }[],
): void {
  for (let i = 0; i < roundResults.length; i++) {
    for (let j = i + 1; j < roundResults.length; j++) {
      updateEloFromRound(
        roundResults[i].agentId,
        roundResults[j].agentId,
        roundResults[i].compositeScore,
        roundResults[j].compositeScore,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Normalization Functions
// ---------------------------------------------------------------------------

/**
 * Normalize P&L to [0, 1] using sigmoid.
 * 0% maps to 0.5, +10% maps to ~0.73, -10% maps to ~0.27
 */
function normalizePnl(pnl: number): number {
  return 1 / (1 + Math.exp(-pnl / PNL_NORMALIZATION_DIVISOR));
}

/**
 * Normalize Sharpe ratio to [0, 1].
 * Sharpe of 0 = 0.5, Sharpe of 2 = ~0.88, Sharpe of -2 = ~0.12
 */
function normalizeSharpe(sharpe: number): number {
  return 1 / (1 + Math.exp(-sharpe));
}

/**
 * Invert a rate (for hallucination rate where lower is better).
 */
function invertRate(rate: number): number {
  return 1 - Math.min(1, Math.max(0, rate));
}


// ---------------------------------------------------------------------------
// Composite Score Computation
// ---------------------------------------------------------------------------

/**
 * Compute normalized factor scores for an agent.
 */
export function normalizeFactors(factors: RankingFactors): Record<string, number> {
  return {
    pnlPercent: normalizePnl(factors.pnlPercent),
    sharpeRatio: normalizeSharpe(factors.sharpeRatio),
    coherence: normalize(factors.coherence),
    hallucinationRate: invertRate(factors.hallucinationRate),
    disciplineRate: normalize(factors.disciplineRate),
    calibration: normalize(factors.calibration),
  };
}

/**
 * Compute the weighted composite score from normalized factors.
 */
export function computeComposite(
  normalizedFactors: Record<string, number>,
  weights = currentConfig.weights,
): number {
  let composite = 0;
  let totalWeight = 0;

  for (const [key, weight] of Object.entries(weights)) {
    const value = normalizedFactors[key];
    if (value !== undefined) {
      composite += value * weight;
      totalWeight += weight;
    }
  }

  return totalWeight > 0
    ? Math.round((composite / totalWeight) * 10000) / 10000
    : 0;
}

/**
 * Assign a letter grade based on composite score.
 */
export function assignGrade(composite: number): string {
  if (composite >= GRADE_THRESHOLD_A_PLUS) return "A+";
  if (composite >= GRADE_THRESHOLD_A) return "A";
  if (composite >= GRADE_THRESHOLD_A_MINUS) return "A-";
  if (composite >= GRADE_THRESHOLD_B_PLUS) return "B+";
  if (composite >= GRADE_THRESHOLD_B) return "B";
  if (composite >= GRADE_THRESHOLD_B_MINUS) return "B-";
  if (composite >= GRADE_THRESHOLD_C_PLUS) return "C+";
  if (composite >= GRADE_THRESHOLD_C) return "C";
  if (composite >= GRADE_THRESHOLD_C_MINUS) return "C-";
  if (composite >= GRADE_THRESHOLD_D_PLUS) return "D+";
  if (composite >= GRADE_THRESHOLD_D) return "D";
  if (composite >= GRADE_THRESHOLD_D_MINUS) return "D-";
  return "F";
}

// ---------------------------------------------------------------------------
// Historical Tracking
// ---------------------------------------------------------------------------

interface HistoryEntry {
  composite: number;
  timestamp: string;
}

const scoreHistory: Map<string, HistoryEntry[]> = new Map();

/**
 * Record a composite score for trend analysis.
 */
export function recordCompositeScore(agentId: string, composite: number): void {
  const history = scoreHistory.get(agentId) ?? [];
  history.push({ composite, timestamp: new Date().toISOString() });
  if (history.length > MAX_HISTORY) history.shift();
  scoreHistory.set(agentId, history);
}

/**
 * Determine trend direction from recent scores.
 */
function computeTrend(agentId: string): "improving" | "declining" | "stable" {
  const history = scoreHistory.get(agentId) ?? [];
  if (history.length < TREND_MIN_HISTORY) return "stable";

  const recent = history.slice(-TREND_RECENT_WINDOW);
  const older = history.slice(TREND_OLDER_WINDOW_START, TREND_OLDER_WINDOW_END);

  if (older.length === 0) return "stable";

  const recentAvg = recent.reduce((s, e) => s + e.composite, 0) / recent.length;
  const olderAvg = older.reduce((s, e) => s + e.composite, 0) / older.length;

  const delta = recentAvg - olderAvg;
  if (delta > TREND_IMPROVEMENT_THRESHOLD) return "improving";
  if (delta < TREND_DECLINE_THRESHOLD) return "declining";
  return "stable";
}

// ---------------------------------------------------------------------------
// Streak Tracking
// ---------------------------------------------------------------------------

const streakData: Map<string, { type: "win" | "loss" | "neutral"; length: number }> = new Map();

/**
 * Update streak data after a round.
 */
export function updateStreak(agentId: string, wasProfit: boolean | null): void {
  const current = streakData.get(agentId) ?? { type: "neutral", length: 0 };
  const newType = wasProfit === null ? "neutral" : wasProfit ? "win" : "loss";

  if (newType === current.type) {
    streakData.set(agentId, { type: newType, length: current.length + 1 });
  } else {
    streakData.set(agentId, { type: newType, length: 1 });
  }
}

// ---------------------------------------------------------------------------
// Full Ranking Pipeline
// ---------------------------------------------------------------------------

/**
 * Generate a complete leaderboard ranking for all agents.
 */
export function generateRankings(
  agentData: Array<{
    agentId: string;
    agentName: string;
    factors: RankingFactors;
  }>,
): LeaderboardSnapshot {
  // Filter by minimum trades
  const eligible = agentData.filter(
    (a) => a.factors.tradeCount >= currentConfig.minTradesForRanking,
  );

  // Compute composite scores
  const scored = eligible.map((a) => {
    const normalized = normalizeFactors(a.factors);
    const composite = computeComposite(normalized);
    const elo = getElo(a.agentId);
    const trend = computeTrend(a.agentId);
    const streak = streakData.get(a.agentId) ?? {
      type: "neutral" as const,
      length: 0,
    };

    // Record for trend tracking
    recordCompositeScore(a.agentId, composite);

    return {
      agentId: a.agentId,
      agentName: a.agentName,
      compositeScore: composite,
      grade: assignGrade(composite),
      eloRating: elo,
      factors: a.factors,
      normalizedFactors: normalized,
      trend,
      streakInfo: {
        currentStreak: streak.type,
        streakLength: streak.length,
      },
    };
  });

  // Sort by composite score descending
  scored.sort((a, b) => b.compositeScore - a.compositeScore);

  // Assign ranks and percentiles
  const rankings: RankedAgent[] = scored.map((s, idx) => ({
    ...s,
    rank: idx + 1,
    percentile:
      scored.length > 1
        ? Math.round(((scored.length - 1 - idx) / (scored.length - 1)) * 100)
        : 100,
  }));

  return {
    rankings,
    generatedAt: new Date().toISOString(),
    methodologyVersion: "5.0.0",
    totalRounds: 0, // Caller should fill this
    config: currentConfig,
  };
}

// ---------------------------------------------------------------------------
// Configuration Management
// ---------------------------------------------------------------------------

/**
 * Update ranking weights.
 */
export function updateWeights(
  weights: Partial<RankingConfig["weights"]>,
): RankingConfig {
  currentConfig = {
    ...currentConfig,
    weights: { ...currentConfig.weights, ...weights },
  };
  return currentConfig;
}

/**
 * Get current ranking configuration.
 */
export function getRankingConfig(): RankingConfig {
  return { ...currentConfig };
}

/**
 * Get Elo ratings for all agents.
 */
export function getAllEloRatings(): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [id, elo] of eloRatings) {
    result[id] = elo;
  }
  return result;
}

/**
 * Get score history for an agent.
 */
export function getScoreHistory(
  agentId: string,
): HistoryEntry[] {
  return scoreHistory.get(agentId) ?? [];
}
