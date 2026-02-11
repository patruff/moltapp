/**
 * Battle Scoring Engine — v13 Head-to-Head Agent Benchmark
 *
 * This engine scores agents in direct pairwise "battles" where reasoning
 * quality, trading performance, and strategic depth are compared head-to-head.
 *
 * Unlike aggregate leaderboards, battles reveal WHO beats WHOM and WHY.
 * This is the tournament layer that hackathon judges will see:
 *  - Round-by-round battle results
 *  - Elo ratings derived from pairwise matchups
 *  - Win/loss matrices
 *  - Reasoning quality differentials
 *  - "Best of" highlight reels
 *
 * Scoring dimensions per battle:
 *  1. Financial: Who made more money in the round?
 *  2. Reasoning: Whose analysis was more coherent and grounded?
 *  3. Conviction: Who showed appropriate confidence calibration?
 *  4. Originality: Who produced more novel reasoning?
 *  5. Safety: Who had fewer hallucinations/discipline violations?
 */

import { round3, weightedSumByKey } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Battle Dimension Scoring Weights
 *
 * These weights determine how much each performance dimension contributes to
 * the overall battle composite score. Total weights = 1.0 (100%).
 */

/** Weight for financial performance (P&L) in battle scoring (20%) */
const DIMENSION_WEIGHT_FINANCIAL = 0.20;

/** Weight for reasoning coherence quality in battle scoring (20%) */
const DIMENSION_WEIGHT_REASONING_COHERENCE = 0.20;

/** Weight for reasoning depth (detail, analysis) in battle scoring (15%) */
const DIMENSION_WEIGHT_REASONING_DEPTH = 0.15;

/** Weight for confidence calibration accuracy in battle scoring (15%) */
const DIMENSION_WEIGHT_CONVICTION_CALIBRATION = 0.15;

/** Weight for originality/novelty of reasoning in battle scoring (10%) */
const DIMENSION_WEIGHT_ORIGINALITY = 0.10;

/** Weight for safety (hallucination-free) in battle scoring (10%) */
const DIMENSION_WEIGHT_SAFETY = 0.10;

/** Weight for discipline (rules compliance) in battle scoring (10%) */
const DIMENSION_WEIGHT_DISCIPLINE = 0.10;

/**
 * Hallucination Penalty
 *
 * Safety scores are penalized per hallucination count. Each hallucination
 * reduces the safety score by this amount (starting from 1.0 perfect score).
 */

/** Penalty per hallucination in safety scoring (25% per hallucination) */
const HALLUCINATION_PENALTY_PER_COUNT = 0.25;

/**
 * Battle Outcome Classification Thresholds
 *
 * These thresholds classify battles based on margin of victory:
 * - TIE_THRESHOLD: Composite scores within this margin = tie (no winner)
 * - HIGHLIGHT_*: Battles outside these ranges are marked as highlights
 */

/** Margin threshold for classifying battle as a tie (within 1.5% = tie) */
const BATTLE_TIE_THRESHOLD = 0.015;

/** Margin threshold for "close battle" highlights (< 5% = close) */
const BATTLE_HIGHLIGHT_CLOSE_MARGIN = 0.05;

/** Margin threshold for "upset/blowout" highlights (> 30% = dominant) */
const BATTLE_HIGHLIGHT_UPSET_MARGIN = 0.30;

/**
 * Dimension Comparison Thresholds
 *
 * When comparing dimension scores (e.g., coherence A vs B), differences
 * smaller than this threshold are classified as ties (no clear winner).
 */

/** Tie threshold for dimension scoring (within 2% = dimension tie) */
const DIMENSION_TIE_THRESHOLD = 0.02;

/**
 * Narrative Generation Margin Classification
 *
 * These thresholds classify margin of victory for human-readable narratives:
 * - < 0.10: "razor-thin" margin
 * - 0.10 - 0.25: "modest" margin
 * - 0.25 - 0.50: "convincing" margin
 * - > 0.50: "dominant" margin
 */

/** Margin threshold for "razor-thin" victory classification (< 10%) */
const NARRATIVE_MARGIN_RAZOR_THIN = 0.10;

/** Margin threshold for "modest" victory classification (< 25%) */
const NARRATIVE_MARGIN_MODEST = 0.25;

/** Margin threshold for "convincing" victory classification (< 50%) */
const NARRATIVE_MARGIN_CONVINCING = 0.50;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BattleParticipant {
  agentId: string;
  action: string;
  symbol: string;
  quantity: number;
  reasoning: string;
  confidence: number;
  intent: string;
  coherenceScore: number;
  hallucinationCount: number;
  disciplinePass: boolean;
  pnlPercent: number;
  depthScore: number;
  originalityScore: number;
}

export interface BattleDimension {
  name: string;
  weight: number;
  winnerAgentId: string | null; // null = tie
  scoreA: number;
  scoreB: number;
  explanation: string;
}

export interface BattleResult {
  battleId: string;
  roundId: string;
  timestamp: string;
  agentA: BattleParticipant;
  agentB: BattleParticipant;
  dimensions: BattleDimension[];
  overallWinner: string | null; // null = tie
  marginOfVictory: number; // 0.0 (tie) to 1.0 (blowout)
  compositeScoreA: number;
  compositeScoreB: number;
  narrative: string; // Human-readable battle summary
  highlight: boolean; // True if this is a notable/close battle
}

export interface BattleRecord {
  agentId: string;
  wins: number;
  losses: number;
  ties: number;
  eloRating: number;
  winRate: number;
  avgMargin: number;
  strongestDimension: string;
  weakestDimension: string;
  streakType: "win" | "loss" | "tie" | "none";
  streakLength: number;
  recentBattles: BattleResult[];
}

export interface HeadToHeadMatrix {
  agents: string[];
  /** matrix[i][j] = number of times agents[i] beat agents[j] */
  wins: number[][];
  /** matrix[i][j] = average margin when agents[i] faced agents[j] */
  avgMargins: number[][];
  /** matrix[i][j] = number of matchups between agents[i] and agents[j] */
  matchups: number[][];
}

export interface BattleHighlight {
  battleId: string;
  reason: string; // "Closest battle", "Biggest upset", etc.
  battle: BattleResult;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const battleHistory: BattleResult[] = [];
const MAX_BATTLE_HISTORY = 1000;

const eloRatings = new Map<string, number>();
const INITIAL_ELO = 1500;
const K_FACTOR = 32;

const dimensionStats = new Map<string, Map<string, { wins: number; losses: number }>>();

// ---------------------------------------------------------------------------
// Core Battle Scoring
// ---------------------------------------------------------------------------

/**
 * Score a single dimension of a battle between two agents.
 */
function scoreDimension(
  name: string,
  weight: number,
  valueA: number,
  valueB: number,
  higherIsBetter: boolean,
  explanationTemplate: string,
): BattleDimension {
  const effectiveA = higherIsBetter ? valueA : 1 - valueA;
  const effectiveB = higherIsBetter ? valueB : 1 - valueB;

  const diff = effectiveA - effectiveB;

  let winnerAgentId: string | null = null;
  if (Math.abs(diff) > DIMENSION_TIE_THRESHOLD) {
    winnerAgentId = diff > 0 ? "A" : "B"; // Placeholder, replaced in battle
  }

  const explanation = explanationTemplate
    .replace("{scoreA}", valueA.toFixed(3))
    .replace("{scoreB}", valueB.toFixed(3))
    .replace("{diff}", Math.abs(diff).toFixed(3));

  return {
    name,
    weight,
    winnerAgentId,
    scoreA: valueA,
    scoreB: valueB,
    explanation,
  };
}

/**
 * Generate a narrative summary of a battle result.
 */
function generateNarrative(
  agentA: BattleParticipant,
  agentB: BattleParticipant,
  dimensions: BattleDimension[],
  overallWinner: string | null,
  margin: number,
): string {
  const winnerId = overallWinner;
  const winnerName = winnerId === agentA.agentId ? agentA.agentId : agentB.agentId;
  const loserName = winnerId === agentA.agentId ? agentB.agentId : agentA.agentId;

  if (!winnerId) {
    return `Dead heat! ${agentA.agentId} and ${agentB.agentId} matched each other across all dimensions. ` +
      `Both traded ${agentA.symbol}/${agentB.symbol} with nearly identical reasoning quality.`;
  }

  const dominantDims = dimensions
    .filter((d) => d.winnerAgentId === (winnerId === agentA.agentId ? "A" : "B"))
    .map((d) => d.name);

  const closeness = margin < NARRATIVE_MARGIN_RAZOR_THIN
    ? "razor-thin"
    : margin < NARRATIVE_MARGIN_MODEST
      ? "modest"
      : margin < NARRATIVE_MARGIN_CONVINCING
        ? "convincing"
        : "dominant";

  const dimensionList = dominantDims.length > 0
    ? dominantDims.slice(0, 3).join(", ")
    : "overall composite";

  return `${winnerName} defeats ${loserName} with a ${closeness} margin (${(margin * 100).toFixed(1)}%). ` +
    `Key advantages in ${dimensionList}. ` +
    `${winnerName} traded ${winnerId === agentA.agentId ? agentA.symbol : agentB.symbol} ` +
    `(${winnerId === agentA.agentId ? agentA.action : agentB.action}) vs ` +
    `${winnerId === agentA.agentId ? agentB.symbol : agentA.symbol} ` +
    `(${winnerId === agentA.agentId ? agentB.action : agentA.action}).`;
}

/**
 * Run a full battle between two agents from a single trading round.
 */
export function runBattle(
  roundId: string,
  agentA: BattleParticipant,
  agentB: BattleParticipant,
): BattleResult {
  // Score each dimension
  const rawDimensions: BattleDimension[] = [
    scoreDimension(
      "financial",
      DIMENSION_WEIGHT_FINANCIAL,
      Math.max(0, (agentA.pnlPercent + 100) / 200), // Normalize PnL to 0-1
      Math.max(0, (agentB.pnlPercent + 100) / 200),
      true,
      "Financial: A={scoreA} vs B={scoreB} (diff={diff})",
    ),
    scoreDimension(
      "reasoning_coherence",
      DIMENSION_WEIGHT_REASONING_COHERENCE,
      agentA.coherenceScore,
      agentB.coherenceScore,
      true,
      "Coherence: A={scoreA} vs B={scoreB} (diff={diff})",
    ),
    scoreDimension(
      "reasoning_depth",
      DIMENSION_WEIGHT_REASONING_DEPTH,
      agentA.depthScore,
      agentB.depthScore,
      true,
      "Depth: A={scoreA} vs B={scoreB} (diff={diff})",
    ),
    scoreDimension(
      "conviction_calibration",
      DIMENSION_WEIGHT_CONVICTION_CALIBRATION,
      agentA.confidence,
      agentB.confidence,
      true,
      "Conviction: A={scoreA} vs B={scoreB} (diff={diff})",
    ),
    scoreDimension(
      "originality",
      DIMENSION_WEIGHT_ORIGINALITY,
      agentA.originalityScore,
      agentB.originalityScore,
      true,
      "Originality: A={scoreA} vs B={scoreB} (diff={diff})",
    ),
    scoreDimension(
      "safety",
      DIMENSION_WEIGHT_SAFETY,
      agentA.hallucinationCount === 0 ? 1 : Math.max(0, 1 - agentA.hallucinationCount * HALLUCINATION_PENALTY_PER_COUNT),
      agentB.hallucinationCount === 0 ? 1 : Math.max(0, 1 - agentB.hallucinationCount * HALLUCINATION_PENALTY_PER_COUNT),
      true,
      "Safety: A={scoreA} vs B={scoreB} (diff={diff})",
    ),
    scoreDimension(
      "discipline",
      DIMENSION_WEIGHT_DISCIPLINE,
      agentA.disciplinePass ? 1.0 : 0.0,
      agentB.disciplinePass ? 1.0 : 0.0,
      true,
      "Discipline: A={scoreA} vs B={scoreB} (diff={diff})",
    ),
  ];

  // Map winner placeholders to actual agent IDs
  const dimensions = rawDimensions.map((d) => ({
    ...d,
    winnerAgentId:
      d.winnerAgentId === "A"
        ? agentA.agentId
        : d.winnerAgentId === "B"
          ? agentB.agentId
          : null,
  }));

  // Composite scores
  const compositeA = weightedSumByKey(dimensions, "scoreA", "weight");
  const compositeB = weightedSumByKey(dimensions, "scoreB", "weight");

  const margin = Math.abs(compositeA - compositeB);
  const overallWinner =
    margin < BATTLE_TIE_THRESHOLD ? null : compositeA > compositeB ? agentA.agentId : agentB.agentId;

  // Is this a highlight? Close battles + big upsets are highlights
  const isHighlight = margin < BATTLE_HIGHLIGHT_CLOSE_MARGIN || margin > BATTLE_HIGHLIGHT_UPSET_MARGIN;

  const narrative = generateNarrative(agentA, agentB, dimensions, overallWinner, margin);

  const battleId = `battle_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  const result: BattleResult = {
    battleId,
    roundId,
    timestamp: new Date().toISOString(),
    agentA,
    agentB,
    dimensions,
    overallWinner,
    marginOfVictory: round3(margin),
    compositeScoreA: round3(compositeA),
    compositeScoreB: round3(compositeB),
    narrative,
    highlight: isHighlight,
  };

  // Record battle
  battleHistory.unshift(result);
  if (battleHistory.length > MAX_BATTLE_HISTORY) {
    battleHistory.length = MAX_BATTLE_HISTORY;
  }

  // Update Elo ratings
  updateElo(agentA.agentId, agentB.agentId, overallWinner);

  // Update dimension stats
  for (const dim of dimensions) {
    if (dim.winnerAgentId) {
      const loserId =
        dim.winnerAgentId === agentA.agentId ? agentB.agentId : agentA.agentId;
      recordDimensionResult(dim.winnerAgentId, dim.name, true);
      recordDimensionResult(loserId, dim.name, false);
    }
  }

  return result;
}

/**
 * Generate all pairwise battles from a round's results.
 */
export function generateRoundBattles(
  roundId: string,
  participants: BattleParticipant[],
): BattleResult[] {
  const battles: BattleResult[] = [];

  for (let i = 0; i < participants.length; i++) {
    for (let j = i + 1; j < participants.length; j++) {
      const battle = runBattle(roundId, participants[i], participants[j]);
      battles.push(battle);
    }
  }

  return battles;
}

// ---------------------------------------------------------------------------
// Elo System
// ---------------------------------------------------------------------------

function getElo(agentId: string): number {
  return eloRatings.get(agentId) ?? INITIAL_ELO;
}

function updateElo(
  agentA: string,
  agentB: string,
  winner: string | null,
): void {
  const ratingA = getElo(agentA);
  const ratingB = getElo(agentB);

  const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  const expectedB = 1 - expectedA;

  let scoreA: number;
  let scoreB: number;

  if (winner === null) {
    scoreA = 0.5;
    scoreB = 0.5;
  } else if (winner === agentA) {
    scoreA = 1;
    scoreB = 0;
  } else {
    scoreA = 0;
    scoreB = 1;
  }

  eloRatings.set(agentA, Math.round(ratingA + K_FACTOR * (scoreA - expectedA)));
  eloRatings.set(agentB, Math.round(ratingB + K_FACTOR * (scoreB - expectedB)));
}

// ---------------------------------------------------------------------------
// Dimension Stats
// ---------------------------------------------------------------------------

function recordDimensionResult(agentId: string, dimension: string, won: boolean): void {
  if (!dimensionStats.has(agentId)) {
    dimensionStats.set(agentId, new Map());
  }
  const agentDims = dimensionStats.get(agentId)!;
  if (!agentDims.has(dimension)) {
    agentDims.set(dimension, { wins: 0, losses: 0 });
  }
  const stat = agentDims.get(dimension)!;
  if (won) {
    stat.wins++;
  } else {
    stat.losses++;
  }
}

// ---------------------------------------------------------------------------
// Query API
// ---------------------------------------------------------------------------

/**
 * Get the battle record for a specific agent.
 */
export function getAgentBattleRecord(agentId: string): BattleRecord {
  const agentBattles = battleHistory.filter(
    (b) => b.agentA.agentId === agentId || b.agentB.agentId === agentId,
  );

  let wins = 0;
  let losses = 0;
  let ties = 0;
  let totalMargin = 0;

  for (const b of agentBattles) {
    if (b.overallWinner === agentId) {
      wins++;
      totalMargin += b.marginOfVictory;
    } else if (b.overallWinner === null) {
      ties++;
    } else {
      losses++;
      totalMargin -= b.marginOfVictory;
    }
  }

  const total = wins + losses + ties;

  // Find strongest and weakest dimensions
  const agentDims = dimensionStats.get(agentId);
  let strongestDimension = "none";
  let weakestDimension = "none";
  let bestWinRate = -1;
  let worstWinRate = 2;

  if (agentDims) {
    for (const [dim, stat] of agentDims) {
      const dimTotal = stat.wins + stat.losses;
      if (dimTotal > 0) {
        const wr = stat.wins / dimTotal;
        if (wr > bestWinRate) {
          bestWinRate = wr;
          strongestDimension = dim;
        }
        if (wr < worstWinRate) {
          worstWinRate = wr;
          weakestDimension = dim;
        }
      }
    }
  }

  // Calculate streak
  let streakType: "win" | "loss" | "tie" | "none" = "none";
  let streakLength = 0;
  for (const b of agentBattles) {
    const result =
      b.overallWinner === agentId ? "win" : b.overallWinner === null ? "tie" : "loss";
    if (streakLength === 0) {
      streakType = result;
      streakLength = 1;
    } else if (result === streakType) {
      streakLength++;
    } else {
      break;
    }
  }

  return {
    agentId,
    wins,
    losses,
    ties,
    eloRating: getElo(agentId),
    winRate: total > 0 ? round3(wins / total) : 0,
    avgMargin: total > 0 ? round3(totalMargin / total) : 0,
    strongestDimension,
    weakestDimension,
    streakType,
    streakLength,
    recentBattles: agentBattles.slice(0, 10),
  };
}

/**
 * Get the head-to-head matrix for all agents.
 */
export function getHeadToHeadMatrix(): HeadToHeadMatrix {
  const agentIds = [...new Set(battleHistory.flatMap((b) => [b.agentA.agentId, b.agentB.agentId]))];
  agentIds.sort();

  const n = agentIds.length;
  const wins = Array.from({ length: n }, () => new Array(n).fill(0) as number[]);
  const avgMargins = Array.from({ length: n }, () => new Array(n).fill(0) as number[]);
  const matchups = Array.from({ length: n }, () => new Array(n).fill(0) as number[]);
  const marginAccum = Array.from({ length: n }, () => new Array(n).fill(0) as number[]);

  for (const b of battleHistory) {
    const i = agentIds.indexOf(b.agentA.agentId);
    const j = agentIds.indexOf(b.agentB.agentId);
    if (i === -1 || j === -1) continue;

    matchups[i][j]++;
    matchups[j][i]++;

    if (b.overallWinner === b.agentA.agentId) {
      wins[i][j]++;
      marginAccum[i][j] += b.marginOfVictory;
    } else if (b.overallWinner === b.agentB.agentId) {
      wins[j][i]++;
      marginAccum[j][i] += b.marginOfVictory;
    }
  }

  // Calculate average margins
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (matchups[i][j] > 0) {
        avgMargins[i][j] = round3(marginAccum[i][j] / matchups[i][j]);
      }
    }
  }

  return { agents: agentIds, wins, avgMargins, matchups };
}

/**
 * Get battle highlights (most interesting battles).
 */
export function getBattleHighlights(limit = 10): BattleHighlight[] {
  const highlights: BattleHighlight[] = [];

  // Closest battles
  const closestBattles = [...battleHistory]
    .filter((b) => b.overallWinner !== null)
    .sort((a, b) => a.marginOfVictory - b.marginOfVictory)
    .slice(0, 3);

  for (const b of closestBattles) {
    highlights.push({
      battleId: b.battleId,
      reason: `Closest battle: ${(b.marginOfVictory * 100).toFixed(1)}% margin`,
      battle: b,
    });
  }

  // Biggest blowouts
  const blowouts = [...battleHistory]
    .filter((b) => b.overallWinner !== null)
    .sort((a, b) => b.marginOfVictory - a.marginOfVictory)
    .slice(0, 3);

  for (const b of blowouts) {
    highlights.push({
      battleId: b.battleId,
      reason: `Dominant performance: ${(b.marginOfVictory * 100).toFixed(1)}% margin`,
      battle: b,
    });
  }

  // Battles with dimension contradictions (A won reasoning but lost overall)
  for (const b of battleHistory.slice(0, 50)) {
    if (!b.overallWinner) continue;
    const reasoningDim = b.dimensions.find((d) => d.name === "reasoning_coherence");
    if (reasoningDim && reasoningDim.winnerAgentId && reasoningDim.winnerAgentId !== b.overallWinner) {
      highlights.push({
        battleId: b.battleId,
        reason: "Better reasoner lost! Financial performance overcame reasoning quality.",
        battle: b,
      });
      break;
    }
  }

  // Ties
  const ties = battleHistory.filter((b) => b.overallWinner === null).slice(0, 2);
  for (const b of ties) {
    highlights.push({
      battleId: b.battleId,
      reason: "Dead heat — agents perfectly matched",
      battle: b,
    });
  }

  // Deduplicate by battleId
  const seen = new Set<string>();
  return highlights
    .filter((h) => {
      if (seen.has(h.battleId)) return false;
      seen.add(h.battleId);
      return true;
    })
    .slice(0, limit);
}

/**
 * Get all Elo ratings sorted by ranking.
 */
export function getEloLeaderboard(): { agentId: string; eloRating: number; rank: number }[] {
  const entries = [...eloRatings.entries()].sort((a, b) => b[1] - a[1]);
  return entries.map(([agentId, eloRating], idx) => ({
    agentId,
    eloRating,
    rank: idx + 1,
  }));
}

/**
 * Get full battle history with optional filters.
 */
export function getBattleHistory(options?: {
  agentId?: string;
  limit?: number;
  offset?: number;
  highlightsOnly?: boolean;
}): { battles: BattleResult[]; total: number } {
  let filtered = battleHistory;

  if (options?.agentId) {
    filtered = filtered.filter(
      (b) => b.agentA.agentId === options.agentId || b.agentB.agentId === options.agentId,
    );
  }

  if (options?.highlightsOnly) {
    filtered = filtered.filter((b) => b.highlight);
  }

  const total = filtered.length;
  const offset = options?.offset ?? 0;
  const limit = options?.limit ?? 20;

  return {
    battles: filtered.slice(offset, offset + limit),
    total,
  };
}

/**
 * Get aggregate battle statistics.
 */
export function getBattleStats(): {
  totalBattles: number;
  totalRounds: number;
  avgMarginOfVictory: number;
  tieRate: number;
  mostDominantAgent: string | null;
  closestRivalry: { agents: [string, string]; avgMargin: number } | null;
} {
  const totalBattles = battleHistory.length;
  if (totalBattles === 0) {
    return {
      totalBattles: 0,
      totalRounds: 0,
      avgMarginOfVictory: 0,
      tieRate: 0,
      mostDominantAgent: null,
      closestRivalry: null,
    };
  }

  const uniqueRounds = new Set(battleHistory.map((b) => b.roundId));
  const ties = battleHistory.filter((b) => b.overallWinner === null).length;
  const avgMargin =
    battleHistory.reduce((s, b) => s + b.marginOfVictory, 0) / totalBattles;

  // Find most dominant agent
  const winCounts = new Map<string, number>();
  for (const b of battleHistory) {
    if (b.overallWinner) {
      winCounts.set(b.overallWinner, (winCounts.get(b.overallWinner) ?? 0) + 1);
    }
  }
  let mostDominantAgent: string | null = null;
  let maxWins = 0;
  for (const [agent, w] of winCounts) {
    if (w > maxWins) {
      maxWins = w;
      mostDominantAgent = agent;
    }
  }

  // Find closest rivalry
  const matrix = getHeadToHeadMatrix();
  let closestRivalry: { agents: [string, string]; avgMargin: number } | null = null;
  let smallestMargin = Infinity;

  for (let i = 0; i < matrix.agents.length; i++) {
    for (let j = i + 1; j < matrix.agents.length; j++) {
      if (matrix.matchups[i][j] >= 3) {
        const totalMargin =
          (matrix.avgMargins[i][j] * matrix.wins[i][j] +
            matrix.avgMargins[j][i] * matrix.wins[j][i]) /
          matrix.matchups[i][j];
        if (totalMargin < smallestMargin) {
          smallestMargin = totalMargin;
          closestRivalry = {
            agents: [matrix.agents[i], matrix.agents[j]],
            avgMargin: round3(totalMargin),
          };
        }
      }
    }
  }

  return {
    totalBattles,
    totalRounds: uniqueRounds.size,
    avgMarginOfVictory: round3(avgMargin),
    tieRate: round3(ties / totalBattles),
    mostDominantAgent,
    closestRivalry,
  };
}
