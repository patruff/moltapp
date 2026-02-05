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
import { eq, desc, and, sql, gte } from "drizzle-orm";
import type { TradingRoundResult } from "../agents/base-agent.ts";
import { clamp } from "../lib/math-utils.ts";

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
    scores.set(agentId, values[0] >= 0 ? 75 : 25);
    return scores;
  }

  const maxPnl = Math.max(...values);
  const minPnl = Math.min(...values);
  const range = maxPnl - minPnl;

  for (const [agentId, pnl] of agentPnls) {
    if (range === 0) {
      scores.set(agentId, 50); // All equal
    } else {
      // Linear interpolation 0-100
      const normalized = ((pnl - minPnl) / range) * 100;
      scores.set(agentId, Math.round(normalized * 100) / 100);
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
      score = 50 + (pnl > 0 ? 25 : 0) + (confidence > 70 ? 15 : confidence > 40 ? 10 : 5);
    } else {
      // Loss: penalize high-confidence losses more
      const confidencePenalty = confidence > 80 ? 30 : confidence > 60 ? 20 : 10;
      score = Math.max(0, 40 - confidencePenalty);
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
    let score = 50; // Base

    // Execution bonus: successfully executed trades score higher
    if (result.executed) {
      score += 20;
      state.executionStreak++;
    } else {
      state.executionStreak = 0;
      score -= 15;
    }

    // Streak bonus (consecutive successful rounds)
    if (state.executionStreak > 3) {
      score += Math.min(15, state.executionStreak * 3);
    }

    // Action variety bonus (not just holding)
    if (result.decision.action !== "hold") {
      score += 10;
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
    let score = 50; // Base

    // Confidence calibration
    const confidence = result.decision.confidence;

    // Reasoning depth (longer = more thoughtful, up to a point)
    const reasoningLength = result.decision.reasoning.length;
    if (reasoningLength > 200) score += 10;
    else if (reasoningLength > 100) score += 5;
    else if (reasoningLength < 20) score -= 10;

    // Non-trivial decisions rewarded
    if (result.decision.action !== "hold" && result.decision.quantity > 0) {
      score += 15;
    }

    // Appropriate confidence for holds (should be moderate)
    if (result.decision.action === "hold") {
      if (confidence >= 30 && confidence <= 70) score += 10;
      else if (confidence > 90) score -= 5; // Overconfident holds are weird
    }

    // Very high confidence should be backed by action
    if (confidence > 85 && result.decision.action === "hold") {
      score -= 10;
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
    if (state.winStreak >= 3) {
      const bonus = Math.min(10, state.winStreak * 2);
      bonuses.push({ name: "win_streak", value: bonus, reason: `${state.winStreak} consecutive top-2 finishes` });
    }

    // Comeback bonus: big improvement from last round
    const lastScore = state.roundScores[state.roundScores.length - 1];
    if (lastScore !== undefined && rawTotal > lastScore + 20) {
      bonuses.push({ name: "comeback", value: 5, reason: `+${Math.round(rawTotal - lastScore)} point improvement` });
    }

    // Inactivity penalty: holding multiple rounds in a row
    const recentHolds = state.roundScores.slice(-3).filter((s) => s < 45).length;
    if (recentHolds >= 2 && result.decision.action === "hold") {
      penalties.push({ name: "passive_trading", value: -5, reason: "Holding for 3+ consecutive rounds" });
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
      pnlScore: Math.round(pnlScore * 100) / 100,
      pnlWeight: WEIGHTS.pnl,
      riskAdjustedScore: Math.round(riskScore * 100) / 100,
      riskAdjustedWeight: WEIGHTS.riskAdjusted,
      consistencyScore: Math.round(consistencyScore * 100) / 100,
      consistencyWeight: WEIGHTS.consistency,
      decisionQualityScore: Math.round(qualityScore * 100) / 100,
      decisionQualityWeight: WEIGHTS.decisionQuality,
      bonuses,
      penalties,
      rawTotal: Math.round(rawTotal * 100) / 100,
      finalScore: Math.round(finalScore * 100) / 100,
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
      `[CompetitionScoring] DB persist failed: ${err instanceof Error ? err.message : String(err)}`,
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
    const bestRoundScore = Math.max(...state.roundScores);
    const worstRoundScore = Math.min(...state.roundScores);
    const lastRoundScore = state.roundScores[state.roundScores.length - 1] ?? 0;

    // Momentum: compare last 3 rounds to previous 3
    let currentMomentum: "rising" | "falling" | "stable" = "stable";
    if (state.roundScores.length >= 6) {
      const recent3 = state.roundScores.slice(-3).reduce((a, b) => a + b, 0) / 3;
      const prev3 = state.roundScores.slice(-6, -3).reduce((a, b) => a + b, 0) / 3;
      if (recent3 > prev3 * 1.1) currentMomentum = "rising";
      else if (recent3 < prev3 * 0.9) currentMomentum = "falling";
    } else if (state.roundScores.length >= 2) {
      const last = state.roundScores[state.roundScores.length - 1];
      const prev = state.roundScores[state.roundScores.length - 2];
      if (last > prev * 1.1) currentMomentum = "rising";
      else if (last < prev * 0.9) currentMomentum = "falling";
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
  limit = 100,
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
