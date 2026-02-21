/**
 * Competition Scoring Engine
 *
 * Tracks and ranks AI agent performance across trading rounds using a
 * multi-factor scoring system. Goes beyond simple P&L to reward risk-adjusted
 * returns, consistency, and decision quality.
 *
 * Scoring Formula (per round):
 * - P&L Component (40%): Raw return relative to other agents
 * - Risk-Adjusted Component (25%): Sharpe-like ratio for the round
 * - Consistency Component (20%): Streak bonus, execution rate
 * - Decision Quality Component (15%): Confidence calibration, reasoning
 *
 * Features:
 * - Per-round scoring with detailed breakdowns
 * - Cumulative leaderboard with ELO-style momentum
 * - Season/competition period tracking
 * - Head-to-head win/loss records
 * - Scoring decay for inactive agents
 */

import { db } from "../db/index.ts";
import { competitionScores } from "../db/schema/portfolio-snapshots.ts";
import { eq, desc } from "drizzle-orm";
import type { TradingRoundResult } from "../agents/base-agent.ts";
import { clamp, round2, findMax, findMin } from "../lib/math-utils.ts";
import { errorMessage } from "../lib/errors.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScoreBreakdown {
  pnlScore: number;
  pnlWeight: number;
  riskAdjustedScore: number;
  riskAdjustedWeight: number;
  consistencyScore: number;
  consistencyWeight: number;
  decisionQualityScore: number;
  decisionQualityWeight: number;
  bonuses: Array<{ name: string; value: number; reason: string }>;
  penalties: Array<{ name: string; value: number; reason: string }>;
  rawTotal: number;
  finalScore: number;
}

export interface RoundScore {
  agentId: string;
  roundId: string;
  roundScore: number;
  cumulativeScore: number;
  rank: number;
  breakdown: ScoreBreakdown;
  timestamp: string;
}

export interface LeaderboardEntry {
  rank: number;
  agentId: string;
  cumulativeScore: number;
  roundsPlayed: number;
  averageScore: number;
  bestRoundScore: number;
  worstRoundScore: number;
  winStreak: number;
  currentMomentum: "rising" | "falling" | "stable";
  lastRoundScore: number;
  headToHead: Record<string, { wins: number; losses: number; draws: number }>;
}

export interface SeasonConfig {
  seasonId: string;
  name: string;
  startDate: string;
  endDate: string | null;
  roundsCompleted: number;
  isActive: boolean;
}

export interface HeadToHeadRecord {
  agentA: string;
  agentB: string;
  winsA: number;
  winsB: number;
  draws: number;
  totalRounds: number;
  scoreAdvantageA: number;
}

// ---------------------------------------------------------------------------
// Scoring Weights
// ---------------------------------------------------------------------------

const WEIGHTS = {
  pnl: 0.40,
  riskAdjusted: 0.25,
  consistency: 0.20,
  decisionQuality: 0.15,
} as const;

/** Base score per round (normalized to ~1000 scale) */
const BASE_SCORE = 1000;

/** ELO-style K-factor for score momentum */
const K_FACTOR = 32;

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * P&L Scoring Parameters
 *
 * Control how raw P&L is normalized to 0-100 scores when comparing agents.
 */

/** Single agent positive P&L score (no comparison available) */
const PNL_SINGLE_AGENT_POSITIVE = 75;

/** Single agent negative P&L score (no comparison available) */
const PNL_SINGLE_AGENT_NEGATIVE = 25;

/** Equal P&L fallback score when all agents tie */
const PNL_EQUAL_SCORE = 50;

/**
 * Risk-Adjusted Scoring Parameters
 *
 * Modulate P&L scores based on confidence calibration. High-confidence losses
 * are penalized more heavily than low-confidence losses (overconfidence penalty).
 */

/** Base score for profitable trades (before confidence bonuses) */
const RISK_BASE_PROFIT_SCORE = 50;

/** Bonus for any positive P&L (non-zero profit) */
const RISK_PROFIT_BONUS = 25;

/** High confidence threshold for profitable trades (>70% = excellent calibration) */
const RISK_HIGH_CONFIDENCE_THRESHOLD = 70;

/** Moderate confidence threshold for profitable trades (>40% = acceptable) */
const RISK_MODERATE_CONFIDENCE_THRESHOLD = 40;

/** High confidence profit bonus (70%+) */
const RISK_HIGH_CONFIDENCE_PROFIT_BONUS = 15;

/** Moderate confidence profit bonus (40-70%) */
const RISK_MODERATE_CONFIDENCE_PROFIT_BONUS = 10;

/** Low confidence profit bonus (<40%) */
const RISK_LOW_CONFIDENCE_PROFIT_BONUS = 5;

/** Base score for losing trades (before confidence penalties) */
const RISK_BASE_LOSS_SCORE = 40;

/** Very high confidence loss penalty threshold (>80% = severe overconfidence) */
const RISK_VERY_HIGH_CONFIDENCE_THRESHOLD = 80;

/** High confidence loss penalty threshold (>60% = moderate overconfidence) */
const RISK_HIGH_CONFIDENCE_LOSS_THRESHOLD = 60;

/** Very high confidence loss penalty (80%+) */
const RISK_VERY_HIGH_CONFIDENCE_LOSS_PENALTY = 30;

/** High confidence loss penalty (60-80%) */
const RISK_HIGH_CONFIDENCE_LOSS_PENALTY = 20;

/** Moderate confidence loss penalty (<60%) */
const RISK_MODERATE_CONFIDENCE_LOSS_PENALTY = 10;

/**
 * Consistency Scoring Parameters
 *
 * Reward execution reliability, action variety, and consecutive successful rounds.
 */

/** Base consistency score (neutral baseline) */
const CONSISTENCY_BASE_SCORE = 50;

/** Bonus for successfully executing a trade */
const CONSISTENCY_EXECUTION_BONUS = 20;

/** Penalty for failing to execute (hold when action planned) */
const CONSISTENCY_NO_EXECUTION_PENALTY = 15;

/** Execution streak threshold for bonus (>3 consecutive executions) */
const CONSISTENCY_STREAK_THRESHOLD = 3;

/** Maximum streak bonus cap (prevent unbounded growth) */
const CONSISTENCY_STREAK_BONUS_MAX = 15;

/** Streak bonus multiplier per consecutive execution */
const CONSISTENCY_STREAK_BONUS_MULTIPLIER = 3;

/** Bonus for taking action (non-hold decision) */
const CONSISTENCY_ACTION_VARIETY_BONUS = 10;

/**
 * Decision Quality Scoring Parameters
 *
 * Assess reasoning depth, confidence calibration, and action appropriateness.
 */

/** Base decision quality score */
const QUALITY_BASE_SCORE = 50;

/** Long reasoning threshold (>200 chars = thoughtful analysis) */
const QUALITY_REASONING_LONG_THRESHOLD = 200;

/** Medium reasoning threshold (>100 chars = adequate detail) */
const QUALITY_REASONING_MEDIUM_THRESHOLD = 100;

/** Short reasoning threshold (<20 chars = insufficient) */
const QUALITY_REASONING_SHORT_THRESHOLD = 20;

/** Bonus for long, detailed reasoning */
const QUALITY_REASONING_LONG_BONUS = 10;

/** Bonus for medium-length reasoning */
const QUALITY_REASONING_MEDIUM_BONUS = 5;

/** Penalty for very short reasoning */
const QUALITY_REASONING_SHORT_PENALTY = 10;

/** Bonus for executing non-hold decisions with quantity */
const QUALITY_ACTION_EXECUTION_BONUS = 15;

/** Lower confidence bound for appropriate hold decisions (30-70% = rational uncertainty) */
const QUALITY_HOLD_CONFIDENCE_MIN = 30;

/** Upper confidence bound for appropriate hold decisions */
const QUALITY_HOLD_CONFIDENCE_MAX = 70;

/** Bonus for well-calibrated hold confidence */
const QUALITY_HOLD_CALIBRATED_BONUS = 10;

/** Very high confidence threshold for holds (>90% = should act instead) */
const QUALITY_HOLD_OVERCONFIDENT_THRESHOLD = 90;

/** Penalty for overconfident holds */
const QUALITY_HOLD_OVERCONFIDENT_PENALTY = 5;

/** Critical overconfidence threshold for holds (>85% confidence + hold = contradictory) */
const QUALITY_HOLD_CRITICAL_OVERCONFIDENCE_THRESHOLD = 85;

/** Penalty for critically overconfident holds */
const QUALITY_HOLD_CRITICAL_OVERCONFIDENCE_PENALTY = 10;

/**
 * Win Streak and Bonus Parameters
 *
 * Reward consistency and comeback improvements.
 */

/** Win streak threshold for bonus (3+ consecutive top-half finishes) */
const BONUS_WIN_STREAK_THRESHOLD = 3;

/** Maximum win streak bonus cap */
const BONUS_WIN_STREAK_MAX = 10;

/** Win streak bonus multiplier per consecutive win */
const BONUS_WIN_STREAK_MULTIPLIER = 2;

/** Comeback bonus threshold (>20 point improvement from last round) */
const BONUS_COMEBACK_THRESHOLD = 20;

/** Comeback bonus points */
const BONUS_COMEBACK_VALUE = 5;

/**
 * Inactivity Penalty Parameters
 *
 * Discourage excessive passivity (holding for many consecutive rounds).
 */

/** Recent rounds lookback window for hold detection */
const PENALTY_INACTIVITY_LOOKBACK = 3;

/** Low-score hold threshold (<45 = passive trading) */
const PENALTY_INACTIVITY_SCORE_THRESHOLD = 45;

/** Minimum consecutive low-score holds to trigger penalty */
const PENALTY_INACTIVITY_MIN_HOLDS = 2;

/** Penalty for passive trading */
const PENALTY_INACTIVITY_VALUE = -5;

/**
 * Momentum Detection Parameters
 *
 * Classify agent performance trend (rising/falling/stable).
 */

/** Minimum rounds required for 6-round momentum comparison */
const MOMENTUM_MIN_ROUNDS_LONG = 6;

/** Minimum rounds required for 2-round momentum comparison */
const MOMENTUM_MIN_ROUNDS_SHORT = 2;

/** Rising momentum threshold (recent avg > 1.1× previous avg) */
const MOMENTUM_RISING_MULTIPLIER = 1.1;

/** Falling momentum threshold (recent avg < 0.9× previous avg) */
const MOMENTUM_FALLING_MULTIPLIER = 0.9;

/** Momentum window size for recent period comparison (last N rounds) */
const MOMENTUM_RECENT_WINDOW = 3;

/** Default limit for agent score history queries */
const HISTORY_DEFAULT_LIMIT = 100;

// ---------------------------------------------------------------------------
// In-Memory State
// ---------------------------------------------------------------------------

interface AgentScoreState {
  cumulativeScore: number;
  roundScores: number[];
  winStreak: number;
  lossStreak: number;
  executionStreak: number;
  lastRoundRank: number;
  headToHead: Map<string, { wins: number; losses: number; draws: number }>;
}

const agentStates = new Map<string, AgentScoreState>();

function getOrCreateState(agentId: string): AgentScoreState {
  let state = agentStates.get(agentId);
  if (!state) {
    state = {
      cumulativeScore: 0,
      roundScores: [],
      winStreak: 0,
      lossStreak: 0,
      executionStreak: 0,
      lastRoundRank: 0,
      headToHead: new Map(),
    };
    agentStates.set(agentId, state);
  }
  return state;
}

// ---------------------------------------------------------------------------
// Scoring Functions
// ---------------------------------------------------------------------------

/**
 * Calculate P&L score component.
 * Compares each agent's round P&L relative to other agents.
 * Highest P&L gets 100, lowest gets 0, others are interpolated.
 */
function scorePnL(
  agentPnls: Map<string, number>,
): Map<string, number> {
  const scores = new Map<string, number>();
  const values = [...agentPnls.values()];

  if (values.length === 0) return scores;
  if (values.length === 1) {
    const [agentId] = agentPnls.keys();
    scores.set(agentId, values[0] >= 0 ? PNL_SINGLE_AGENT_POSITIVE : PNL_SINGLE_AGENT_NEGATIVE);
    return scores;
  }

  const pnlValues = values.map((v) => ({ value: v }));
  const maxPnl = findMax(pnlValues, 'value')?.value ?? 0;
  const minPnl = findMin(pnlValues, 'value')?.value ?? 0;
  const range = maxPnl - minPnl;

  for (const [agentId, pnl] of agentPnls) {
    if (range === 0) {
      scores.set(agentId, PNL_EQUAL_SCORE); // All equal
    } else {
      // Linear interpolation 0-100
      const normalized = ((pnl - minPnl) / range) * 100;
      scores.set(agentId, round2(normalized));
    }
  }

  return scores;
}

/**
 * Calculate risk-adjusted score.
 * Rewards agents that achieve returns with lower drawdown/volatility.
 */
function scoreRiskAdjusted(
  agentPnls: Map<string, number>,
  agentConfidences: Map<string, number>,
): Map<string, number> {
  const scores = new Map<string, number>();

  for (const [agentId, pnl] of agentPnls) {
    const confidence = agentConfidences.get(agentId) ?? 50;

    // Risk-adjusted = P&L weighted by confidence accuracy
    // High confidence + profit = best
    // High confidence + loss = worst (penalized for overconfidence)
    // Low confidence + profit = good (humble but effective)
    let score: number;
    if (pnl >= 0) {
      // Profitable: reward proportionally to confidence calibration
      score = RISK_BASE_PROFIT_SCORE +
        (pnl > 0 ? RISK_PROFIT_BONUS : 0) +
        (confidence > RISK_HIGH_CONFIDENCE_THRESHOLD ? RISK_HIGH_CONFIDENCE_PROFIT_BONUS :
         confidence > RISK_MODERATE_CONFIDENCE_THRESHOLD ? RISK_MODERATE_CONFIDENCE_PROFIT_BONUS :
         RISK_LOW_CONFIDENCE_PROFIT_BONUS);
    } else {
      // Loss: penalize high-confidence losses more
      const confidencePenalty = confidence > RISK_VERY_HIGH_CONFIDENCE_THRESHOLD ? RISK_VERY_HIGH_CONFIDENCE_LOSS_PENALTY :
                                confidence > RISK_HIGH_CONFIDENCE_LOSS_THRESHOLD ? RISK_HIGH_CONFIDENCE_LOSS_PENALTY :
                                RISK_MODERATE_CONFIDENCE_LOSS_PENALTY;
      score = Math.max(0, RISK_BASE_LOSS_SCORE - confidencePenalty);
    }

    scores.set(agentId, clamp(score, 0, 100));
  }

  return scores;
}

/**
 * Calculate consistency score.
 * Rewards execution success, action variety, and streaks.
 */
function scoreConsistency(
  roundResults: TradingRoundResult[],
): Map<string, number> {
  const scores = new Map<string, number>();

  for (const result of roundResults) {
    const state = getOrCreateState(result.agentId);
    let score = CONSISTENCY_BASE_SCORE; // Base

    // Execution bonus: successfully executed trades score higher
    if (result.executed) {
      score += CONSISTENCY_EXECUTION_BONUS;
      state.executionStreak++;
    } else {
      state.executionStreak = 0;
      score -= CONSISTENCY_NO_EXECUTION_PENALTY;
    }

    // Streak bonus (consecutive successful rounds)
    if (state.executionStreak > CONSISTENCY_STREAK_THRESHOLD) {
      score += Math.min(CONSISTENCY_STREAK_BONUS_MAX, state.executionStreak * CONSISTENCY_STREAK_BONUS_MULTIPLIER);
    }

    // Action variety bonus (not just holding)
    if (result.decision.action !== "hold") {
      score += CONSISTENCY_ACTION_VARIETY_BONUS;
    }

    scores.set(result.agentId, clamp(score, 0, 100));
  }

  return scores;
}

/**
 * Calculate decision quality score.
 * Measures how well calibrated the agent's confidence is relative to outcomes.
 */
function scoreDecisionQuality(
  roundResults: TradingRoundResult[],
): Map<string, number> {
  const scores = new Map<string, number>();

  for (const result of roundResults) {
    let score = QUALITY_BASE_SCORE; // Base

    // Confidence calibration
    const confidence = result.decision.confidence;

    // Reasoning depth (longer = more thoughtful, up to a point)
    const reasoningLength = result.decision.reasoning.length;
    if (reasoningLength > QUALITY_REASONING_LONG_THRESHOLD) score += QUALITY_REASONING_LONG_BONUS;
    else if (reasoningLength > QUALITY_REASONING_MEDIUM_THRESHOLD) score += QUALITY_REASONING_MEDIUM_BONUS;
    else if (reasoningLength < QUALITY_REASONING_SHORT_THRESHOLD) score -= QUALITY_REASONING_SHORT_PENALTY;

    // Non-trivial decisions rewarded
    if (result.decision.action !== "hold" && result.decision.quantity > 0) {
      score += QUALITY_ACTION_EXECUTION_BONUS;
    }

    // Appropriate confidence for holds (should be moderate)
    if (result.decision.action === "hold") {
      if (confidence >= QUALITY_HOLD_CONFIDENCE_MIN && confidence <= QUALITY_HOLD_CONFIDENCE_MAX) score += QUALITY_HOLD_CALIBRATED_BONUS;
      else if (confidence > QUALITY_HOLD_OVERCONFIDENT_THRESHOLD) score -= QUALITY_HOLD_OVERCONFIDENT_PENALTY; // Overconfident holds are weird
    }

    // Very high confidence should be backed by action
    if (confidence > QUALITY_HOLD_CRITICAL_OVERCONFIDENCE_THRESHOLD && result.decision.action === "hold") {
      score -= QUALITY_HOLD_CRITICAL_OVERCONFIDENCE_PENALTY;
    }

    scores.set(result.agentId, clamp(score, 0, 100));
  }

  return scores;
}

// ---------------------------------------------------------------------------
// Round Scoring (Main Entry Point)
// ---------------------------------------------------------------------------

/**
 * Score all agents for a completed trading round.
 *
 * Called from the orchestrator after each round completes.
 * Computes individual scores, updates cumulative totals, and determines rankings.
 */
export async function scoreRound(
  roundId: string,
  results: TradingRoundResult[],
  portfolioPnls: Map<string, number>,
): Promise<RoundScore[]> {
  if (results.length === 0) return [];

  // 1. Calculate each scoring component
  const agentConfidences = new Map<string, number>();
  for (const r of results) {
    agentConfidences.set(r.agentId, r.decision.confidence);
  }

  const pnlScores = scorePnL(portfolioPnls);
  const riskScores = scoreRiskAdjusted(portfolioPnls, agentConfidences);
  const consistencyScores = scoreConsistency(results);
  const qualityScores = scoreDecisionQuality(results);

  // 2. Compute weighted total for each agent
  const roundScores: RoundScore[] = [];

  for (const result of results) {
    const agentId = result.agentId;
    const state = getOrCreateState(agentId);

    const pnlScore = pnlScores.get(agentId) ?? 50;
    const riskScore = riskScores.get(agentId) ?? 50;
    const consistencyScore = consistencyScores.get(agentId) ?? 50;
    const qualityScore = qualityScores.get(agentId) ?? 50;

    // Weighted sum
    const rawTotal =
      pnlScore * WEIGHTS.pnl +
      riskScore * WEIGHTS.riskAdjusted +
      consistencyScore * WEIGHTS.consistency +
      qualityScore * WEIGHTS.decisionQuality;

    // Apply bonuses and penalties
    const bonuses: ScoreBreakdown["bonuses"] = [];
    const penalties: ScoreBreakdown["penalties"] = [];

    // Win streak bonus
    if (state.winStreak >= BONUS_WIN_STREAK_THRESHOLD) {
      const bonus = Math.min(BONUS_WIN_STREAK_MAX, state.winStreak * BONUS_WIN_STREAK_MULTIPLIER);
      bonuses.push({ name: "win_streak", value: bonus, reason: `${state.winStreak} consecutive top-2 finishes` });
    }

    // Comeback bonus: big improvement from last round
    const lastScore = state.roundScores[state.roundScores.length - 1];
    if (lastScore !== undefined && rawTotal > lastScore + BONUS_COMEBACK_THRESHOLD) {
      bonuses.push({ name: "comeback", value: BONUS_COMEBACK_VALUE, reason: `+${Math.round(rawTotal - lastScore)} point improvement` });
    }

    // Inactivity penalty: holding multiple rounds in a row
    const recentHolds = state.roundScores.slice(-PENALTY_INACTIVITY_LOOKBACK).filter((s) => s < PENALTY_INACTIVITY_SCORE_THRESHOLD).length;
    if (recentHolds >= PENALTY_INACTIVITY_MIN_HOLDS && result.decision.action === "hold") {
      penalties.push({ name: "passive_trading", value: PENALTY_INACTIVITY_VALUE, reason: "Holding for 3+ consecutive rounds" });
    }

    const bonusTotal = bonuses.reduce((sum, b) => sum + b.value, 0);
    const penaltyTotal = penalties.reduce((sum, p) => sum + p.value, 0);
    const finalScore = clamp(rawTotal + bonusTotal + penaltyTotal, 0, 100);

    // Normalize to BASE_SCORE scale
    const scaledScore = Math.round((finalScore / 100) * BASE_SCORE);

    // Update cumulative score with ELO-style momentum
    const expectedScore = state.cumulativeScore / Math.max(1, state.roundScores.length);
    const scoreDelta = scaledScore - (expectedScore || BASE_SCORE / 2);
    state.cumulativeScore += scaledScore + Math.round(scoreDelta * (K_FACTOR / 100));
    state.roundScores.push(scaledScore);

    // Track win/loss streaks (top 2 in round = win)
    // Computed after all scores

    const breakdown: ScoreBreakdown = {
      pnlScore: round2(pnlScore),
      pnlWeight: WEIGHTS.pnl,
      riskAdjustedScore: round2(riskScore),
      riskAdjustedWeight: WEIGHTS.riskAdjusted,
      consistencyScore: round2(consistencyScore),
      consistencyWeight: WEIGHTS.consistency,
      decisionQualityScore: round2(qualityScore),
      decisionQualityWeight: WEIGHTS.decisionQuality,
      bonuses,
      penalties,
      rawTotal: round2(rawTotal),
      finalScore: round2(finalScore),
    };

    roundScores.push({
      agentId,
      roundId,
      roundScore: scaledScore,
      cumulativeScore: state.cumulativeScore,
      rank: 0, // computed below
      breakdown,
      timestamp: new Date().toISOString(),
    });
  }

  // 3. Determine rankings for this round
  roundScores.sort((a, b) => b.roundScore - a.roundScore);
  for (let i = 0; i < roundScores.length; i++) {
    roundScores[i].rank = i + 1;
  }

  // 4. Update win/loss streaks and head-to-head records
  for (const score of roundScores) {
    const state = getOrCreateState(score.agentId);
    state.lastRoundRank = score.rank;

    // Win = top half of rankings (rounded up)
    if (score.rank <= Math.ceil(roundScores.length / 2)) {
      state.winStreak++;
      state.lossStreak = 0;
    } else {
      state.lossStreak++;
      state.winStreak = 0;
    }

    // Head-to-head: compare against each other agent
    for (const otherScore of roundScores) {
      if (otherScore.agentId === score.agentId) continue;

      const h2h = state.headToHead.get(otherScore.agentId) ?? { wins: 0, losses: 0, draws: 0 };
      if (score.roundScore > otherScore.roundScore) {
        h2h.wins++;
      } else if (score.roundScore < otherScore.roundScore) {
        h2h.losses++;
      } else {
        h2h.draws++;
      }
      state.headToHead.set(otherScore.agentId, h2h);
    }
  }

  // 5. Persist to DB
  try {
    for (const score of roundScores) {
      await db.insert(competitionScores).values({
        agentId: score.agentId,
        roundId: score.roundId,
        roundScore: score.roundScore.toFixed(4),
        cumulativeScore: score.cumulativeScore.toFixed(4),
        rank: score.rank,
        breakdown: score.breakdown,
      });
    }
  } catch (err) {
    console.warn(
      `[CompetitionScoring] DB persist failed: ${errorMessage(err)}`,
    );
  }

  console.log(
    `[CompetitionScoring] Round ${roundId} scored: ${roundScores.map((s) => `${s.agentId}=#${s.rank}(${s.roundScore})`).join(", ")}`,
  );

  return roundScores;
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

/**
 * Get the current competition leaderboard.
 */
export function getLeaderboard(): LeaderboardEntry[] {
  const entries: LeaderboardEntry[] = [];

  for (const [agentId, state] of agentStates) {
    const roundsPlayed = state.roundScores.length;
    if (roundsPlayed === 0) continue;

    const averageScore =
      roundsPlayed > 0
        ? Math.round(state.roundScores.reduce((a, b) => a + b, 0) / roundsPlayed)
        : 0;
    const scoreObjects = state.roundScores.map((s) => ({ score: s }));
    const bestRoundScore = findMax(scoreObjects, 'score')?.score ?? 0;
    const worstRoundScore = findMin(scoreObjects, 'score')?.score ?? 0;
    const lastRoundScore = state.roundScores[state.roundScores.length - 1] ?? 0;

    // Momentum: compare last 3 rounds to previous 3
    let currentMomentum: "rising" | "falling" | "stable" = "stable";
    if (state.roundScores.length >= MOMENTUM_MIN_ROUNDS_LONG) {
      const recentWindow = state.roundScores.slice(-MOMENTUM_RECENT_WINDOW).reduce((a, b) => a + b, 0) / MOMENTUM_RECENT_WINDOW;
      const prevWindow = state.roundScores.slice(-MOMENTUM_RECENT_WINDOW * 2, -MOMENTUM_RECENT_WINDOW).reduce((a, b) => a + b, 0) / MOMENTUM_RECENT_WINDOW;
      if (recentWindow > prevWindow * MOMENTUM_RISING_MULTIPLIER) currentMomentum = "rising";
      else if (recentWindow < prevWindow * MOMENTUM_FALLING_MULTIPLIER) currentMomentum = "falling";
    } else if (state.roundScores.length >= MOMENTUM_MIN_ROUNDS_SHORT) {
      const last = state.roundScores[state.roundScores.length - 1];
      const prev = state.roundScores[state.roundScores.length - 2];
      if (last > prev * MOMENTUM_RISING_MULTIPLIER) currentMomentum = "rising";
      else if (last < prev * MOMENTUM_FALLING_MULTIPLIER) currentMomentum = "falling";
    }

    // Convert head-to-head map
    const headToHead: Record<string, { wins: number; losses: number; draws: number }> = {};
    for (const [oppId, record] of state.headToHead) {
      headToHead[oppId] = record;
    }

    entries.push({
      rank: 0, // computed after sort
      agentId,
      cumulativeScore: state.cumulativeScore,
      roundsPlayed,
      averageScore,
      bestRoundScore,
      worstRoundScore,
      winStreak: state.winStreak,
      currentMomentum,
      lastRoundScore,
      headToHead,
    });
  }

  // Sort by cumulative score
  entries.sort((a, b) => b.cumulativeScore - a.cumulativeScore);
  for (let i = 0; i < entries.length; i++) {
    entries[i].rank = i + 1;
  }

  return entries;
}

/**
 * Get head-to-head record between two agents.
 */
export function getHeadToHead(agentA: string, agentB: string): HeadToHeadRecord | null {
  const stateA = agentStates.get(agentA);
  const stateB = agentStates.get(agentB);

  if (!stateA || !stateB) return null;

  const recordA = stateA.headToHead.get(agentB) ?? { wins: 0, losses: 0, draws: 0 };

  return {
    agentA,
    agentB,
    winsA: recordA.wins,
    winsB: recordA.losses,
    draws: recordA.draws,
    totalRounds: recordA.wins + recordA.losses + recordA.draws,
    scoreAdvantageA:
      stateA.cumulativeScore - stateB.cumulativeScore,
  };
}

/**
 * Get historical scores for a specific agent.
 */
export async function getAgentScoreHistory(
  agentId: string,
  limit = HISTORY_DEFAULT_LIMIT,
): Promise<Array<{
  roundId: string;
  roundScore: number;
  cumulativeScore: number;
  rank: number;
  timestamp: string;
}>> {
  try {
    const rows = await db
      .select()
      .from(competitionScores)
      .where(eq(competitionScores.agentId, agentId))
      .orderBy(desc(competitionScores.createdAt))
      .limit(limit);

    return rows.map((r: typeof rows[0]) => ({
      roundId: r.roundId,
      roundScore: parseFloat(r.roundScore),
      cumulativeScore: parseFloat(r.cumulativeScore),
      rank: r.rank,
      timestamp: r.createdAt.toISOString(),
    }));
  } catch {
    // Fall back to in-memory
    const state = agentStates.get(agentId);
    if (!state) return [];

    return state.roundScores.map((score, i) => ({
      roundId: `round_${i}`,
      roundScore: score,
      cumulativeScore: state.roundScores.slice(0, i + 1).reduce((a, b) => a + b, 0),
      rank: 0,
      timestamp: new Date().toISOString(),
    }));
  }
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export function getCompetitionMetrics(): {
  totalRoundsScored: number;
  agentCount: number;
  topAgent: { agentId: string; score: number } | null;
  averageRoundScore: number;
} {
  let totalRounds = 0;
  let totalScoreSum = 0;
  let topAgent: { agentId: string; score: number } | null = null;

  for (const [agentId, state] of agentStates) {
    totalRounds += state.roundScores.length;
    totalScoreSum += state.roundScores.reduce((a, b) => a + b, 0);

    if (!topAgent || state.cumulativeScore > topAgent.score) {
      topAgent = { agentId, score: state.cumulativeScore };
    }
  }

  return {
    totalRoundsScored: totalRounds > 0 ? Math.round(totalRounds / Math.max(1, agentStates.size)) : 0,
    agentCount: agentStates.size,
    topAgent,
    averageRoundScore: totalRounds > 0 ? Math.round(totalScoreSum / totalRounds) : 0,
  };
}
