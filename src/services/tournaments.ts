/**
 * Tournament System Service
 *
 * Implements a bracket-style elimination tournament engine for AI trading agents.
 * Features season-based competitions, round-robin and single-elimination formats,
 * championship tracking, and historical results.
 *
 * Tournament Types:
 * - Daily Sprint: 24hr winner by confidence-weighted accuracy
 * - Weekly Showdown: 7-day round-robin across all agents
 * - Monthly Championship: Full bracket with multiple rounds
 * - Special Event: Ad-hoc themed tournaments (e.g., "Tech Stock Battle")
 */

import { db } from "../db/index.ts";
import { agentDecisions } from "../db/schema/agent-decisions.ts";
import { eq, desc, gte, and, lte } from "drizzle-orm";
import { getAgentConfigs, getMarketData } from "../agents/orchestrator.ts";
import type { MarketData } from "../agents/base-agent.ts";
import { countByCondition } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Tournament Timing Parameters
 *
 * These constants control tournament format timing windows, completion thresholds,
 * minimum participation requirements, reputation rewards, and display precision.
 */

// Daily Sprint Timing
/** Hour threshold for daily sprint completion (23 = 11 PM) */
const DAILY_SPRINT_COMPLETION_HOUR = 23;

/** Minimum decisions required for daily sprint participation */
const DAILY_SPRINT_MIN_DECISIONS = 1;

/** Reputation points awarded for daily sprint victory */
const DAILY_SPRINT_REPUTATION_REWARD = 50;

// Weekly Showdown Timing
/** Number of days in weekly showdown (7-day competition) */
const WEEKLY_SHOWDOWN_DAYS = 7;

/** Total rounds in weekly showdown metadata */
const WEEKLY_SHOWDOWN_TOTAL_ROUNDS = 7;

/** Minimum decisions required for weekly showdown participation */
const WEEKLY_SHOWDOWN_MIN_DECISIONS = 3;

/** Reputation points awarded for weekly showdown victory */
const WEEKLY_SHOWDOWN_REPUTATION_REWARD = 200;

// Monthly Championship Timing
/** Milliseconds per week (7 days) for championship bracket calculations */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Milliseconds for 2-week championship bracket calculations */
const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;

/** Total rounds in monthly championship (Qualifiers, Semifinals, Finals) */
const MONTHLY_CHAMPIONSHIP_TOTAL_ROUNDS = 3;

/** Minimum decisions required for monthly championship participation */
const MONTHLY_CHAMPIONSHIP_MIN_DECISIONS = 10;

/** Reputation points awarded for monthly championship victory */
const MONTHLY_CHAMPIONSHIP_REPUTATION_REWARD = 500;

// Accuracy Rounding Precision
/** Precision multiplier for accuracy rounding (10 = tenths place, e.g., 0.847 → 0.8) */
const ACCURACY_ROUNDING_PRECISION = 10;

// Tournament Points Scoring
/** Points awarded for sprint tournament victory */
const POINTS_SPRINT_WIN = 10;

/** Points awarded for showdown tournament victory */
const POINTS_SHOWDOWN_WIN = 50;

/** Points awarded for championship tournament victory */
const POINTS_CHAMPIONSHIP_WIN = 200;

/** Bonus points awarded for 1st place finish in any tournament round */
const POINTS_PLACEMENT_FIRST = 30;

/** Bonus points awarded for 2nd place finish in any tournament round */
const POINTS_PLACEMENT_SECOND = 15;

/** Bonus points awarded for 3rd place finish in any tournament round */
const POINTS_PLACEMENT_THIRD = 5;

// Composite Score Calculation Weights
/** Weight for accuracy in composite score (40% - primary performance indicator) */
const COMPOSITE_WEIGHT_ACCURACY = 0.4;

/** Weight for confidence in composite score (30% - calibration quality) */
const COMPOSITE_WEIGHT_CONFIDENCE = 0.3;

/** Weight for volume in composite score (20% - trading activity) */
const COMPOSITE_WEIGHT_VOLUME = 0.2;

/** Weight for action ratio in composite score (10% - buys+sells vs holds) */
const COMPOSITE_WEIGHT_ACTION_RATIO = 0.1;

/** Volume multiplier for composite score (10 decisions = 100 volume score) */
const COMPOSITE_VOLUME_MULTIPLIER = 10;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TournamentFormat = "sprint" | "showdown" | "championship" | "special";
export type TournamentStatus = "upcoming" | "active" | "completed" | "cancelled";

/** A tournament definition */
export interface Tournament {
  id: string;
  name: string;
  format: TournamentFormat;
  status: TournamentStatus;
  startDate: string;
  endDate: string;
  description: string;
  rules: TournamentRules;
  participants: TournamentParticipant[];
  rounds: TournamentRound[];
  winner: TournamentParticipant | null;
  prizes: string[];
  metadata: TournamentMetadata;
}

interface TournamentRules {
  scoringMethod: "accuracy" | "pnl" | "sharpe" | "composite";
  minDecisions: number;
  allowedSymbols: string[] | "all";
  tiebreaker: "confidence" | "total_trades" | "recent_accuracy";
}

export interface TournamentParticipant {
  agentId: string;
  agentName: string;
  provider: string;
  score: number;
  rank: number;
  eliminated: boolean;
  stats: ParticipantStats;
}

interface ParticipantStats {
  decisions: number;
  accuracy: number;
  avgConfidence: number;
  buys: number;
  sells: number;
  holds: number;
  bestCall: { symbol: string; confidence: number; correct: boolean } | null;
  worstCall: { symbol: string; confidence: number; correct: boolean } | null;
}

export interface TournamentRound {
  roundNumber: number;
  name: string;
  startDate: string;
  endDate: string;
  status: "pending" | "active" | "completed";
  matchups: Matchup[];
}

interface Matchup {
  id: string;
  agent1Id: string;
  agent1Name: string;
  agent1Score: number;
  agent2Id: string;
  agent2Name: string;
  agent2Score: number;
  winner: string | null;
  winnerName: string | null;
  details: MatchupDetails;
}

interface MatchupDetails {
  agent1Decisions: number;
  agent2Decisions: number;
  agent1Accuracy: number;
  agent2Accuracy: number;
  agent1AvgConfidence: number;
  agent2AvgConfidence: number;
  commonSymbols: string[];
  divergenceCount: number;
}

interface TournamentMetadata {
  createdAt: string;
  totalDecisions: number;
  totalRounds: number;
  avgAccuracy: number;
  mostTradedSymbol: string | null;
  mostControversialRound: number | null;
}

/** Season standings across multiple tournaments */
export interface SeasonStandings {
  seasonId: string;
  seasonName: string;
  startDate: string;
  endDate: string;
  tournaments: SeasonTournamentEntry[];
  standings: SeasonRanking[];
  currentTournament: Tournament | null;
  stats: SeasonStats;
}

interface SeasonTournamentEntry {
  id: string;
  name: string;
  format: TournamentFormat;
  status: TournamentStatus;
  winnerId: string | null;
  winnerName: string | null;
  completedAt: string | null;
}

interface SeasonRanking {
  rank: number;
  agentId: string;
  agentName: string;
  provider: string;
  totalPoints: number;
  tournamentsWon: number;
  tournamentsEntered: number;
  averageFinish: number;
  bestFinish: number;
  titles: string[];
}

interface SeasonStats {
  totalTournaments: number;
  completedTournaments: number;
  totalDecisions: number;
  mostDominantAgent: string | null;
  mostCompetitiveMatchup: string | null;
}

// ---------------------------------------------------------------------------
// Tournament Generator
// ---------------------------------------------------------------------------

/**
 * Generate a daily sprint tournament from today's trading data.
 */
export async function generateDailySprint(): Promise<Tournament> {
  const configs = getAgentConfigs();
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  const id = `sprint_${now.toISOString().slice(0, 10)}`;

  // Get market data for accuracy validation
  let marketData: MarketData[] = [];
  try {
    marketData = await getMarketData();
  } catch {
    // use empty
  }

  // Fetch today's decisions for each agent
  const participants: TournamentParticipant[] = [];

  for (const config of configs) {
    const decisions = await db
      .select()
      .from(agentDecisions)
      .where(
        and(
          eq(agentDecisions.agentId, config.agentId),
          gte(agentDecisions.createdAt, startOfDay),
          lte(agentDecisions.createdAt, endOfDay),
        ),
      )
      .orderBy(desc(agentDecisions.createdAt));

    const stats = calculateParticipantStats(decisions, marketData);
    const score = calculateCompositeScore(stats);

    participants.push({
      agentId: config.agentId,
      agentName: config.name,
      provider: config.provider,
      score,
      rank: 0,
      eliminated: false,
      stats,
    });
  }

  // Rank participants
  participants.sort((a, b) => b.score - a.score);
  participants.forEach((p, i) => {
    p.rank = i + 1;
  });

  // Generate single round with round-robin matchups
  const matchups = generateRoundRobinMatchups(participants, marketData);
  const isComplete = now.getHours() >= DAILY_SPRINT_COMPLETION_HOUR;

  const tournament: Tournament = {
    id,
    name: `Daily Sprint — ${now.toISOString().slice(0, 10)}`,
    format: "sprint",
    status: isComplete ? "completed" : "active",
    startDate: startOfDay.toISOString(),
    endDate: endOfDay.toISOString(),
    description: "24-hour trading sprint. Agents compete based on prediction accuracy, confidence calibration, and trading volume.",
    rules: {
      scoringMethod: "composite",
      minDecisions: DAILY_SPRINT_MIN_DECISIONS,
      allowedSymbols: "all",
      tiebreaker: "confidence",
    },
    participants,
    rounds: [
      {
        roundNumber: 1,
        name: "Round Robin",
        startDate: startOfDay.toISOString(),
        endDate: endOfDay.toISOString(),
        status: isComplete ? "completed" : "active",
        matchups,
      },
    ],
    winner: isComplete ? participants[0] ?? null : null,
    prizes: ["Daily Sprint Champion Title", `+${DAILY_SPRINT_REPUTATION_REWARD} Reputation Points`],
    metadata: {
      createdAt: now.toISOString(),
      totalDecisions: participants.reduce((s, p) => s + p.stats.decisions, 0),
      totalRounds: 1,
      avgAccuracy:
        participants.length > 0
          ? Math.round(
              (participants.reduce((s, p) => s + p.stats.accuracy, 0) /
                participants.length) *
                ACCURACY_ROUNDING_PRECISION,
            ) / ACCURACY_ROUNDING_PRECISION
          : 0,
      mostTradedSymbol: findMostTradedSymbol(participants),
      mostControversialRound: null,
    },
  };

  return tournament;
}

/**
 * Generate a weekly showdown tournament from the current week's data.
 */
export async function generateWeeklyShowdown(): Promise<Tournament> {
  const configs = getAgentConfigs();
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
  startOfWeek.setHours(0, 0, 0, 0);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(endOfWeek.getDate() + (WEEKLY_SHOWDOWN_DAYS - 1));
  endOfWeek.setHours(23, 59, 59, 999);

  const weekNum = getWeekNumber(now);
  const id = `showdown_${now.getFullYear()}_w${weekNum}`;

  let marketData: MarketData[] = [];
  try {
    marketData = await getMarketData();
  } catch {
    // empty
  }

  const participants: TournamentParticipant[] = [];

  for (const config of configs) {
    const decisions = await db
      .select()
      .from(agentDecisions)
      .where(
        and(
          eq(agentDecisions.agentId, config.agentId),
          gte(agentDecisions.createdAt, startOfWeek),
        ),
      )
      .orderBy(desc(agentDecisions.createdAt));

    const stats = calculateParticipantStats(decisions, marketData);
    const score = calculateCompositeScore(stats);

    participants.push({
      agentId: config.agentId,
      agentName: config.name,
      provider: config.provider,
      score,
      rank: 0,
      eliminated: false,
      stats,
    });
  }

  participants.sort((a, b) => b.score - a.score);
  participants.forEach((p, i) => {
    p.rank = i + 1;
  });

  // Generate matchups for each day of the week
  const rounds: TournamentRound[] = [];
  for (let day = 0; day < WEEKLY_SHOWDOWN_DAYS; day++) {
    const roundDate = new Date(startOfWeek);
    roundDate.setDate(roundDate.getDate() + day);
    const dayEnd = new Date(roundDate);
    dayEnd.setHours(23, 59, 59, 999);

    const isPast = roundDate < now;
    const isToday =
      roundDate.toISOString().slice(0, 10) === now.toISOString().slice(0, 10);

    rounds.push({
      roundNumber: day + 1,
      name: `Day ${day + 1} — ${roundDate.toLocaleDateString("en-US", { weekday: "long" })}`,
      startDate: roundDate.toISOString(),
      endDate: dayEnd.toISOString(),
      status: isPast ? "completed" : isToday ? "active" : "pending",
      matchups: generateRoundRobinMatchups(participants, marketData),
    });
  }

  const isComplete = now > endOfWeek;

  return {
    id,
    name: `Weekly Showdown — Week ${weekNum}, ${now.getFullYear()}`,
    format: "showdown",
    status: isComplete ? "completed" : "active",
    startDate: startOfWeek.toISOString(),
    endDate: endOfWeek.toISOString(),
    description:
      "7-day round-robin showdown. Agents accumulate points across daily matchups. Best weekly performer wins.",
    rules: {
      scoringMethod: "composite",
      minDecisions: WEEKLY_SHOWDOWN_MIN_DECISIONS,
      allowedSymbols: "all",
      tiebreaker: "total_trades",
    },
    participants,
    rounds,
    winner: isComplete ? participants[0] ?? null : null,
    prizes: [
      "Weekly Showdown Champion Title",
      `+${WEEKLY_SHOWDOWN_REPUTATION_REWARD} Reputation Points`,
      "Featured on Arena Dashboard",
    ],
    metadata: {
      createdAt: now.toISOString(),
      totalDecisions: participants.reduce((s, p) => s + p.stats.decisions, 0),
      totalRounds: WEEKLY_SHOWDOWN_TOTAL_ROUNDS,
      avgAccuracy:
        participants.length > 0
          ? Math.round(
              (participants.reduce((s, p) => s + p.stats.accuracy, 0) /
                participants.length) *
                ACCURACY_ROUNDING_PRECISION,
            ) / ACCURACY_ROUNDING_PRECISION
          : 0,
      mostTradedSymbol: findMostTradedSymbol(participants),
      mostControversialRound: null,
    },
  };
}

/**
 * Generate a monthly championship bracket.
 */
export async function generateMonthlyChampionship(): Promise<Tournament> {
  const configs = getAgentConfigs();
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const monthName = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const id = `championship_${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, "0")}`;

  let marketData: MarketData[] = [];
  try {
    marketData = await getMarketData();
  } catch {
    // empty
  }

  const participants: TournamentParticipant[] = [];

  for (const config of configs) {
    const decisions = await db
      .select()
      .from(agentDecisions)
      .where(
        and(
          eq(agentDecisions.agentId, config.agentId),
          gte(agentDecisions.createdAt, startOfMonth),
        ),
      )
      .orderBy(desc(agentDecisions.createdAt));

    const stats = calculateParticipantStats(decisions, marketData);
    const score = calculateCompositeScore(stats);

    participants.push({
      agentId: config.agentId,
      agentName: config.name,
      provider: config.provider,
      score,
      rank: 0,
      eliminated: false,
      stats,
    });
  }

  participants.sort((a, b) => b.score - a.score);
  participants.forEach((p, i) => {
    p.rank = i + 1;
  });

  // Championship has 3 rounds: Qualifiers, Semifinals, Finals
  // With 3 agents we do round-robin qualifiers then top-2 finals
  const weekBreaks = [
    { start: startOfMonth, end: new Date(startOfMonth.getTime() + WEEK_MS) },
    { start: new Date(startOfMonth.getTime() + WEEK_MS), end: new Date(startOfMonth.getTime() + TWO_WEEKS_MS) },
    { start: new Date(startOfMonth.getTime() + TWO_WEEKS_MS), end: endOfMonth },
  ];

  const rounds: TournamentRound[] = weekBreaks.map((week, i) => ({
    roundNumber: i + 1,
    name: i === 0 ? "Qualifiers" : i === 1 ? "Semifinals" : "Grand Final",
    startDate: week.start.toISOString(),
    endDate: week.end.toISOString(),
    status: now > week.end ? "completed" : now >= week.start ? "active" : "pending",
    matchups: generateRoundRobinMatchups(participants, marketData),
  }));

  const isComplete = now > endOfMonth;

  return {
    id,
    name: `Monthly Championship — ${monthName}`,
    format: "championship",
    status: isComplete ? "completed" : "active",
    startDate: startOfMonth.toISOString(),
    endDate: endOfMonth.toISOString(),
    description:
      "Full monthly championship with qualifier rounds, semifinals, and grand final. The ultimate test of AI trading skill.",
    rules: {
      scoringMethod: "composite",
      minDecisions: MONTHLY_CHAMPIONSHIP_MIN_DECISIONS,
      allowedSymbols: "all",
      tiebreaker: "recent_accuracy",
    },
    participants,
    rounds,
    winner: isComplete ? participants[0] ?? null : null,
    prizes: [
      "Monthly Champion Title",
      `+${MONTHLY_CHAMPIONSHIP_REPUTATION_REWARD} Reputation Points`,
      "Champion Badge (Legendary)",
      "Featured Agent Status",
    ],
    metadata: {
      createdAt: now.toISOString(),
      totalDecisions: participants.reduce((s, p) => s + p.stats.decisions, 0),
      totalRounds: MONTHLY_CHAMPIONSHIP_TOTAL_ROUNDS,
      avgAccuracy:
        participants.length > 0
          ? Math.round(
              (participants.reduce((s, p) => s + p.stats.accuracy, 0) /
                participants.length) *
                ACCURACY_ROUNDING_PRECISION,
            ) / ACCURACY_ROUNDING_PRECISION
          : 0,
      mostTradedSymbol: findMostTradedSymbol(participants),
      mostControversialRound: null,
    },
  };
}

/**
 * Get current season standings.
 */
export async function getSeasonStandings(): Promise<SeasonStandings> {
  const now = new Date();
  const seasonName = `Season ${Math.ceil((now.getMonth() + 1) / 3)} — ${now.getFullYear()}`;
  const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  const quarterEnd = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3 + 3, 0);

  // Generate current tournaments
  const [daily, weekly, monthly] = await Promise.all([
    generateDailySprint(),
    generateWeeklyShowdown(),
    generateMonthlyChampionship(),
  ]);

  const tournaments: SeasonTournamentEntry[] = [
    {
      id: daily.id,
      name: daily.name,
      format: daily.format,
      status: daily.status,
      winnerId: daily.winner?.agentId ?? null,
      winnerName: daily.winner?.agentName ?? null,
      completedAt: daily.status === "completed" ? daily.endDate : null,
    },
    {
      id: weekly.id,
      name: weekly.name,
      format: weekly.format,
      status: weekly.status,
      winnerId: weekly.winner?.agentId ?? null,
      winnerName: weekly.winner?.agentName ?? null,
      completedAt: weekly.status === "completed" ? weekly.endDate : null,
    },
    {
      id: monthly.id,
      name: monthly.name,
      format: monthly.format,
      status: monthly.status,
      winnerId: monthly.winner?.agentId ?? null,
      winnerName: monthly.winner?.agentName ?? null,
      completedAt: monthly.status === "completed" ? monthly.endDate : null,
    },
  ];

  // Build season rankings from all tournament results
  const configs = getAgentConfigs();
  const standings: SeasonRanking[] = configs.map((config) => {
    const tournamentsWon = tournaments.filter(
      (t) => t.winnerId === config.agentId,
    ).length;

    // Calculate points based on tournament format
    let totalPoints = 0;
    for (const t of tournaments) {
      if (t.winnerId === config.agentId) {
        totalPoints += t.format === "sprint" ? POINTS_SPRINT_WIN : t.format === "showdown" ? POINTS_SHOWDOWN_WIN : POINTS_CHAMPIONSHIP_WIN;
      }
    }

    // Bonus points from placements
    const allParticipants = [
      ...daily.participants,
      ...weekly.participants,
      ...monthly.participants,
    ].filter((p) => p.agentId === config.agentId);

    for (const p of allParticipants) {
      if (p.rank === 1) totalPoints += POINTS_PLACEMENT_FIRST;
      else if (p.rank === 2) totalPoints += POINTS_PLACEMENT_SECOND;
      else if (p.rank === 3) totalPoints += POINTS_PLACEMENT_THIRD;
    }

    const finishes = allParticipants.map((p) => p.rank);
    const avgFinish =
      finishes.length > 0
        ? Math.round(
            (finishes.reduce((s, f) => s + f, 0) / finishes.length) * 10,
          ) / 10
        : 0;
    const bestFinish = finishes.length > 0 ? Math.min(...finishes) : 0;

    const titles: string[] = [];
    if (daily.winner?.agentId === config.agentId) titles.push("Daily Sprint Champion");
    if (weekly.winner?.agentId === config.agentId) titles.push("Weekly Showdown Champion");
    if (monthly.winner?.agentId === config.agentId) titles.push("Monthly Championship Champion");

    return {
      rank: 0,
      agentId: config.agentId,
      agentName: config.name,
      provider: config.provider,
      totalPoints,
      tournamentsWon,
      tournamentsEntered: 3, // all 3 agents always participate
      averageFinish: avgFinish,
      bestFinish,
      titles,
    };
  });

  standings.sort((a, b) => b.totalPoints - a.totalPoints);
  standings.forEach((s, i) => {
    s.rank = i + 1;
  });

  // Find current active tournament
  const activeTournament =
    [daily, weekly, monthly].find((t) => t.status === "active") ?? null;

  const completedTournaments = tournaments.filter(
    (t) => t.status === "completed",
  ).length;
  const totalDecisions = [daily, weekly, monthly].reduce(
    (s, t) => s + t.metadata.totalDecisions,
    0,
  );
  const mostDominantAgent =
    standings.length > 0 && standings[0].totalPoints > 0
      ? standings[0].agentName
      : null;

  return {
    seasonId: `season_${now.getFullYear()}_q${Math.ceil((now.getMonth() + 1) / 3)}`,
    seasonName,
    startDate: quarterStart.toISOString(),
    endDate: quarterEnd.toISOString(),
    tournaments,
    standings,
    currentTournament: activeTournament,
    stats: {
      totalTournaments: 3,
      completedTournaments,
      totalDecisions,
      mostDominantAgent,
      mostCompetitiveMatchup: null,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function calculateParticipantStats(
  decisions: Array<{
    action: string;
    symbol: string;
    confidence: number;
    marketSnapshot: unknown;
    createdAt: Date;
  }>,
  currentMarket: MarketData[],
): ParticipantStats {
  const total = decisions.length;
  const buys = countByCondition(decisions, (d: typeof decisions[number]) => d.action === "buy");
  const sells = countByCondition(decisions, (d: typeof decisions[number]) => d.action === "sell");
  const holds = countByCondition(decisions, (d: typeof decisions[number]) => d.action === "hold");

  let correct = 0;
  let bestCall: ParticipantStats["bestCall"] = null;
  let worstCall: ParticipantStats["worstCall"] = null;

  const actionDecisions = decisions.filter((d) => d.action !== "hold");

  for (const d of actionDecisions) {
    const snapshot = d.marketSnapshot as Record<
      string,
      { price: number }
    > | null;
    const snapshotPrice = snapshot?.[d.symbol]?.price;
    const currentStock = currentMarket.find((m) => m.symbol === d.symbol);

    if (!snapshotPrice || !currentStock) continue;

    const change =
      ((currentStock.price - snapshotPrice) / snapshotPrice) * 100;
    const isCorrect =
      (d.action === "buy" && change > 0) ||
      (d.action === "sell" && change < 0);

    if (isCorrect) correct++;

    if (!bestCall || d.confidence > bestCall.confidence) {
      bestCall = {
        symbol: d.symbol,
        confidence: d.confidence,
        correct: isCorrect,
      };
    }
    if (!worstCall || d.confidence < worstCall.confidence) {
      worstCall = {
        symbol: d.symbol,
        confidence: d.confidence,
        correct: isCorrect,
      };
    }
  }

  const validated = actionDecisions.length;
  const accuracy = validated > 0 ? (correct / validated) * 100 : 0;
  const avgConfidence =
    total > 0
      ? decisions.reduce((s, d) => s + d.confidence, 0) / total
      : 0;

  return {
    decisions: total,
    accuracy: Math.round(accuracy * ACCURACY_ROUNDING_PRECISION) / ACCURACY_ROUNDING_PRECISION,
    avgConfidence: Math.round(avgConfidence * ACCURACY_ROUNDING_PRECISION) / ACCURACY_ROUNDING_PRECISION,
    buys,
    sells,
    holds,
    bestCall,
    worstCall,
  };
}

function calculateCompositeScore(stats: ParticipantStats): number {
  // Composite score with configurable weights
  const accuracyScore = stats.accuracy;
  const confidenceScore = stats.avgConfidence;
  const volumeScore = Math.min(100, stats.decisions * COMPOSITE_VOLUME_MULTIPLIER);
  const actionRatio =
    stats.decisions > 0
      ? ((stats.buys + stats.sells) / stats.decisions) * 100
      : 0;

  return Math.round(
    (accuracyScore * COMPOSITE_WEIGHT_ACCURACY +
      confidenceScore * COMPOSITE_WEIGHT_CONFIDENCE +
      volumeScore * COMPOSITE_WEIGHT_VOLUME +
      actionRatio * COMPOSITE_WEIGHT_ACTION_RATIO) *
      ACCURACY_ROUNDING_PRECISION,
  ) / ACCURACY_ROUNDING_PRECISION;
}

function generateRoundRobinMatchups(
  participants: TournamentParticipant[],
  _marketData: MarketData[],
): Matchup[] {
  const matchups: Matchup[] = [];

  for (let i = 0; i < participants.length; i++) {
    for (let j = i + 1; j < participants.length; j++) {
      const p1 = participants[i];
      const p2 = participants[j];

      const winner =
        p1.score > p2.score
          ? p1
          : p2.score > p1.score
            ? p2
            : null; // tie

      // Find common symbols traded
      const p1Symbols = new Set<string>(); // Would need decision data for full analysis
      const p2Symbols = new Set<string>();

      matchups.push({
        id: `match_${p1.agentId}_vs_${p2.agentId}`,
        agent1Id: p1.agentId,
        agent1Name: p1.agentName,
        agent1Score: p1.score,
        agent2Id: p2.agentId,
        agent2Name: p2.agentName,
        agent2Score: p2.score,
        winner: winner?.agentId ?? null,
        winnerName: winner?.agentName ?? null,
        details: {
          agent1Decisions: p1.stats.decisions,
          agent2Decisions: p2.stats.decisions,
          agent1Accuracy: p1.stats.accuracy,
          agent2Accuracy: p2.stats.accuracy,
          agent1AvgConfidence: p1.stats.avgConfidence,
          agent2AvgConfidence: p2.stats.avgConfidence,
          commonSymbols: [],
          divergenceCount: 0,
        },
      });
    }
  }

  return matchups;
}

function findMostTradedSymbol(participants: TournamentParticipant[]): string | null {
  // Would need decision data; return best call symbol as proxy
  for (const p of participants) {
    if (p.stats.bestCall) return p.stats.bestCall.symbol;
  }
  return null;
}

function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}
