/**
 * Trading Round Analytics Engine
 *
 * Deep post-round analysis that computes metrics the orchestrator doesn't
 * have time to calculate in real-time. This runs asynchronously after each
 * round completes and builds a comprehensive analytics picture.
 *
 * Metrics:
 * 1. Round-level statistics (participation, execution rate, consensus)
 * 2. Market impact analysis (did agent trades move prices?)
 * 3. Decision quality scoring (confidence vs. actual outcome)
 * 4. Timing analysis (which agents decided faster, did speed help?)
 * 5. Portfolio efficiency (how close to optimal allocation?)
 * 6. Risk-adjusted round scoring (best decision considering risk)
 * 7. Historical trend detection (improving or degrading performance?)
 */

import { averageByKey, countByCondition, findMax, findMin, round2, round3, sumByKey } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RoundDecision {
  agentId: string;
  agentName: string;
  action: "buy" | "sell" | "hold";
  symbol: string;
  quantity: number;
  confidence: number;
  reasoning: string;
  executed: boolean;
  executionError?: string;
  txSignature?: string;
  filledPrice?: number;
  usdcAmount?: number;
  durationMs?: number;
}

export interface RoundAnalytics {
  roundId: string;
  timestamp: string;
  analyzedAt: string;

  /** Participation metrics */
  participation: {
    totalAgents: number;
    activeAgents: number; // non-hold
    holdAgents: number;
    participationRate: number; // active/total
    executionRate: number; // executed/active
  };

  /** Consensus analysis */
  consensus: {
    type: "unanimous" | "majority" | "split" | "all_hold";
    majorityAction: string | null;
    majoritySymbol: string | null;
    majorityConfidence: number;
    dissenterCount: number;
    confidenceSpread: number; // max - min confidence
  };

  /** Decision quality (retroactive, filled in later) */
  quality: {
    /** Each agent's decision quality score (0-100) */
    agentScores: {
      agentId: string;
      qualityScore: number;
      factors: {
        confidenceCalibration: number; // how well confidence predicted outcome
        executionSuccess: number; // did the trade execute cleanly?
        positionSizing: number; // appropriate size for the opportunity?
        timingScore: number; // was the entry/exit well-timed?
      };
    }[];
    bestDecision: { agentId: string; reason: string } | null;
    worstDecision: { agentId: string; reason: string } | null;
    roundQualityScore: number; // aggregate round quality
  };

  /** Market context at time of round */
  marketContext: {
    topMover: { symbol: string; change: number } | null;
    worstPerformer: { symbol: string; change: number } | null;
    marketBreadth: number; // % of stocks positive
    avgVolatility: number;
    sector: string; // dominant sector traded
  };

  /** Aggregate metrics */
  metrics: {
    totalUsdcTraded: number;
    avgConfidence: number;
    avgQuantity: number;
    uniqueStocksTraded: number;
    buyToSellRatio: number;
    roundDurationMs: number;
  };
}

export interface AgentPerformanceTrend {
  agentId: string;
  agentName: string;
  /** Last N rounds performance trajectory */
  recentRounds: {
    roundId: string;
    action: string;
    confidence: number;
    executed: boolean;
    qualityScore: number;
  }[];
  /** Trend direction */
  trend: "improving" | "stable" | "declining";
  trendScore: number; // -1 to 1
  /** Moving averages */
  movingAvgConfidence: number;
  movingAvgQuality: number;
  /** Streaks */
  currentExecutionStreak: number; // consecutive successful executions
  executionSuccessRate: number;
}

export interface AnalyticsSummary {
  generatedAt: string;
  totalRoundsAnalyzed: number;
  periodStartDate: string;
  periodEndDate: string;

  /** Overall system metrics */
  system: {
    avgParticipationRate: number;
    avgExecutionRate: number;
    avgRoundQuality: number;
    totalUsdcTraded: number;
    unanimousRoundRate: number;
    splitRoundRate: number;
  };

  /** Per-agent metrics */
  agentTrends: AgentPerformanceTrend[];

  /** Notable patterns */
  patterns: {
    type: string;
    description: string;
    significance: "low" | "medium" | "high";
  }[];

  /** Best and worst rounds */
  bestRound: { roundId: string; score: number; reason: string } | null;
  worstRound: { roundId: string; score: number; reason: string } | null;
}

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Decision Quality Scoring Parameters
 *
 * These constants control how individual agent decisions are scored for quality.
 * Quality scoring is used to rank agent performance and identify best/worst decisions.
 */

/** Execution success score when trade executed successfully (0-100 scale). */
const QUALITY_SCORE_EXECUTION_SUCCESS = 100;

/** Execution success score when agent chooses to hold (0-100 scale). */
const QUALITY_SCORE_HOLD = 80;

/** Execution success score when trade failed to execute (0-100 scale). */
const QUALITY_SCORE_EXECUTION_FAILED = 0;

/** Baseline confidence calibration score when trade executed (0-100 scale). */
const QUALITY_SCORE_CONFIDENCE_BASELINE = 70;

/** Confidence calibration score for high confidence (>70%) executed trades. */
const QUALITY_SCORE_CONFIDENCE_HIGH_EXECUTED = 90;

/** Confidence threshold for "high confidence" classification (0-1 scale). */
const QUALITY_CONFIDENCE_HIGH_THRESHOLD = 0.7;

/** Baseline position sizing score when trade amount is appropriate (0-100 scale). */
const QUALITY_SCORE_POSITION_BASELINE = 70;

/**
 * Position sizing score tiers based on USDC amount.
 * - $0-50: Reasonable position size = 90
 * - $50-200: Moderate position size = 75
 * - $200+: Aggressive position size = 50
 * - $0: Zero quantity (unusual) = 60
 */
const QUALITY_SCORE_POSITION_SMALL = 90; // amount <= $50
const QUALITY_POSITION_SMALL_THRESHOLD = 50;
const QUALITY_SCORE_POSITION_MODERATE = 75; // $50 < amount <= $200
const QUALITY_POSITION_MODERATE_THRESHOLD = 200;
const QUALITY_SCORE_POSITION_LARGE = 50; // amount > $200
const QUALITY_SCORE_POSITION_ZERO = 60; // amount = 0

/**
 * Timing score based on reasoning length.
 * - >100 chars: Thoughtful analysis = 85
 * - >50 chars: Adequate reasoning = 70
 * - <=50 chars: Rushed decision = 50
 */
const QUALITY_SCORE_TIMING_THOUGHTFUL = 85;
const QUALITY_TIMING_THOUGHTFUL_THRESHOLD = 100;
const QUALITY_SCORE_TIMING_ADEQUATE = 70;
const QUALITY_TIMING_ADEQUATE_THRESHOLD = 50;
const QUALITY_SCORE_TIMING_RUSHED = 50;

/**
 * Quality score component weights (must sum to 1.0).
 * - Execution success: 35% (most important — did the trade work?)
 * - Confidence calibration: 25% (was confidence accurate?)
 * - Position sizing: 20% (was the position size appropriate?)
 * - Timing score: 20% (was the decision well-reasoned?)
 */
const QUALITY_WEIGHT_EXECUTION = 0.35;
const QUALITY_WEIGHT_CONFIDENCE = 0.25;
const QUALITY_WEIGHT_POSITION = 0.20;
const QUALITY_WEIGHT_TIMING = 0.20;

/**
 * Trend Detection Thresholds
 *
 * Used to classify agent performance trends over time.
 */

/** Trend score > 0.1 = agent performance improving over time. */
const TREND_IMPROVING_THRESHOLD = 0.1;

/** Trend score < -0.1 = agent performance declining over time. */
const TREND_DECLINING_THRESHOLD = -0.1;

/**
 * Memory and Query Limits
 */

/** Default window size for recent rounds returned by getRecentRoundAnalytics(). */
const RECENT_ROUNDS_DEFAULT_LIMIT = 20;

/** Minimum trend trades required for reliable trend detection. */
const TREND_MIN_TRADES = 3;

/**
 * Display Precision Rounding Constants
 *
 * Controls the decimal precision for confidence and quality score display in API responses.
 * Formula: Math.round(value * MULTIPLIER) / DIVISOR = 1-decimal precision
 * Example: 73.666... → Math.round(73.666 * 10) / 10 = 73.7
 *
 * Used for: avgConfidence, majorityConfidence, confidenceSpread, qualityScore,
 * movingAvgConfidence, movingAvgQuality, roundQualityScore, avgRoundQuality
 */

/** Multiply before rounding to achieve 1-decimal place precision. */
const SCORE_DISPLAY_PRECISION_MULTIPLIER = 10;

/** Divide after rounding for 1-decimal place display (e.g., 73.7 not 737). */
const SCORE_DISPLAY_PRECISION_DIVISOR = 10;

/**
 * Execution Success Rate Precision Constants
 *
 * Controls the decimal precision for execution success rate display (3-decimal places).
 * Formula: Math.round(rate * MULTIPLIER) / DIVISOR = 3-decimal precision
 * Example: 0.66666... → Math.round(0.66666 * 1000) / 1000 = 0.667
 *
 * Used for: executionSuccessRate, averageParticipation in analytics status
 */

/** Multiply before rounding to achieve 3-decimal place precision. */
const RATE_DISPLAY_PRECISION_MULTIPLIER = 1000;

/** Divide after rounding for 3-decimal place display (e.g., 0.667 not 667). */
const RATE_DISPLAY_PRECISION_DIVISOR = 1000;

/**
 * Pattern Detection Thresholds
 *
 * Controls when patterns are flagged in the analytics summary.
 * These thresholds determine what constitutes "unusual" behavior worthy of reporting.
 */

/** Participation rate below this triggers a "low_participation" pattern alert. */
const PATTERN_LOW_PARTICIPATION_THRESHOLD = 0.5;

/** Execution rate below this triggers an "execution_failures" pattern alert. */
const PATTERN_EXECUTION_FAILURE_THRESHOLD = 0.8;

/** Minimum participation rate to bother checking for execution failures (avoids noise). */
const PATTERN_MIN_PARTICIPATION_FOR_EXEC_CHECK = 0.3;

/** Unanimous round rate above this triggers a "high_agreement" herding risk alert. */
const PATTERN_HIGH_AGREEMENT_THRESHOLD = 0.5;

/**
 * Time Conversion Constants
 *
 * Used for converting days to milliseconds in analytics period calculations.
 * Formula: periodDays * MS_PER_DAY = millisecond cutoff timestamp
 * Example: 7 days * 86,400,000 = 604,800,000ms (1 week)
 */

/** Milliseconds per day (24 hours × 60 minutes × 60 seconds × 1000ms). */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Completed round analytics */
const roundAnalytics = new Map<string, RoundAnalytics>();
const MAX_ROUNDS = 1000;

/** Round analytics in chronological order for trend analysis */
const roundHistory: RoundAnalytics[] = [];

// ---------------------------------------------------------------------------
// Core Analytics Engine
// ---------------------------------------------------------------------------

/**
 * Analyze a completed trading round and produce comprehensive metrics.
 * Called asynchronously after the orchestrator finishes a round.
 */
export function analyzeRound(
  roundId: string,
  timestamp: string,
  decisions: RoundDecision[],
  marketData: { symbol: string; price: number; change24h: number | null }[],
  roundDurationMs: number,
): RoundAnalytics {
  const analyzedAt = new Date().toISOString();

  // Participation
  const activeDecisions = decisions.filter((d) => d.action !== "hold");
  const executedDecisions = activeDecisions.filter((d) => d.executed);
  const holdDecisions = decisions.filter((d) => d.action === "hold");

  const participation = {
    totalAgents: decisions.length,
    activeAgents: activeDecisions.length,
    holdAgents: holdDecisions.length,
    participationRate:
      decisions.length > 0 ? activeDecisions.length / decisions.length : 0,
    executionRate:
      activeDecisions.length > 0
        ? executedDecisions.length / activeDecisions.length
        : 1,
  };

  // Consensus
  const consensus = analyzeConsensus(decisions);

  // Quality scoring
  const quality = scoreDecisionQuality(decisions);

  // Market context
  const marketContext = analyzeMarketContext(decisions, marketData);

  // Aggregate metrics
  const totalUsdc = sumByKey(decisions, 'usdcAmount');
  const avgConf = averageByKey(decisions, 'confidence');
  const avgQty = averageByKey(activeDecisions, 'quantity');
  const uniqueStocks = new Set(
    activeDecisions.map((d) => d.symbol),
  ).size;
  const buys = countByCondition(activeDecisions, (d) => d.action === "buy");
  const sells = countByCondition(activeDecisions, (d) => d.action === "sell");

  const analytics: RoundAnalytics = {
    roundId,
    timestamp,
    analyzedAt,
    participation,
    consensus,
    quality,
    marketContext,
    metrics: {
      totalUsdcTraded: round2(totalUsdc),
      avgConfidence: Math.round(avgConf * SCORE_DISPLAY_PRECISION_MULTIPLIER) / SCORE_DISPLAY_PRECISION_DIVISOR,
      avgQuantity: round2(avgQty),
      uniqueStocksTraded: uniqueStocks,
      buyToSellRatio: sells > 0 ? round2(buys / sells) : buys > 0 ? Infinity : 0,
      roundDurationMs,
    },
  };

  // Store
  roundAnalytics.set(roundId, analytics);
  roundHistory.push(analytics);

  // Trim if too many
  if (roundHistory.length > MAX_ROUNDS) {
    const removed = roundHistory.shift();
    if (removed) roundAnalytics.delete(removed.roundId);
  }

  console.log(
    `[RoundAnalytics] Round ${roundId}: ${participation.activeAgents}/${participation.totalAgents} active, ` +
      `consensus=${consensus.type}, quality=${quality.roundQualityScore.toFixed(0)}, ` +
      `$${totalUsdc.toFixed(2)} traded`,
  );

  return analytics;
}

/**
 * Get analytics for a specific round.
 */
export function getRoundAnalytics(roundId: string): RoundAnalytics | null {
  return roundAnalytics.get(roundId) ?? null;
}

/**
 * Get analytics for the N most recent rounds.
 */
export function getRecentRoundAnalytics(limit = RECENT_ROUNDS_DEFAULT_LIMIT): RoundAnalytics[] {
  return roundHistory.slice(-limit);
}

// ---------------------------------------------------------------------------
// Consensus Analysis
// ---------------------------------------------------------------------------

function analyzeConsensus(decisions: RoundDecision[]): RoundAnalytics["consensus"] {
  const active = decisions.filter((d) => d.action !== "hold");

  if (active.length === 0) {
    return {
      type: "all_hold",
      majorityAction: null,
      majoritySymbol: null,
      majorityConfidence: 0,
      dissenterCount: 0,
      confidenceSpread: 0,
    };
  }

  // Group by action+symbol
  const groups = new Map<string, RoundDecision[]>();
  for (const d of active) {
    const key = `${d.action}:${d.symbol}`;
    const list = groups.get(key) ?? [];
    list.push(d);
    groups.set(key, list);
  }

  // Find majority
  let majorityKey = "";
  let majorityGroup: RoundDecision[] = [];
  for (const [key, group] of groups) {
    if (group.length > majorityGroup.length) {
      majorityKey = key;
      majorityGroup = group;
    }
  }

  const [majAction, majSymbol] = majorityKey.split(":");
  const dissenterCount = active.length - majorityGroup.length;

  let type: RoundAnalytics["consensus"]["type"];
  if (majorityGroup.length === active.length && active.length >= 2) {
    type = "unanimous";
  } else if (majorityGroup.length > 1) {
    type = "majority";
  } else {
    type = "split";
  }

  const confidences = decisions.map((d) => d.confidence);
  const confObjs = confidences.map(c => ({ value: c }));
  const spread = (findMax(confObjs, 'value')?.value ?? 0) - (findMin(confObjs, 'value')?.value ?? 0);
  const majAvgConf = averageByKey(majorityGroup, 'confidence');

  return {
    type,
    majorityAction: majAction ?? null,
    majoritySymbol: majSymbol ?? null,
    majorityConfidence: Math.round(majAvgConf * SCORE_DISPLAY_PRECISION_MULTIPLIER) / SCORE_DISPLAY_PRECISION_DIVISOR,
    dissenterCount,
    confidenceSpread: Math.round(spread * SCORE_DISPLAY_PRECISION_MULTIPLIER) / SCORE_DISPLAY_PRECISION_DIVISOR,
  };
}

// ---------------------------------------------------------------------------
// Decision Quality Scoring
// ---------------------------------------------------------------------------

function scoreDecisionQuality(
  decisions: RoundDecision[],
): RoundAnalytics["quality"] {
  const agentScores = decisions.map((d) => {
    // Execution success: 100 if executed, 80 for hold, 0 if failed
    const executionSuccess =
      d.action === "hold" ? QUALITY_SCORE_HOLD : d.executed ? QUALITY_SCORE_EXECUTION_SUCCESS : QUALITY_SCORE_EXECUTION_FAILED;

    // Confidence calibration: penalize extreme confidence on failed trades
    let confidenceCalibration = QUALITY_SCORE_CONFIDENCE_BASELINE;
    if (!d.executed && d.action !== "hold") {
      // Failed trade with high confidence = poor calibration
      confidenceCalibration = Math.max(0, 100 - d.confidence);
    } else if (d.executed && d.confidence > QUALITY_CONFIDENCE_HIGH_THRESHOLD) {
      confidenceCalibration = QUALITY_SCORE_CONFIDENCE_HIGH_EXECUTED; // good: high confidence on executed trade
    }

    // Position sizing: penalize very large trades (over $200) and very tiny ones
    let positionSizing = QUALITY_SCORE_POSITION_BASELINE;
    if (d.action !== "hold") {
      const amount = d.usdcAmount ?? d.quantity;
      if (amount > 0 && amount <= QUALITY_POSITION_SMALL_THRESHOLD) positionSizing = QUALITY_SCORE_POSITION_SMALL; // reasonable
      else if (amount > QUALITY_POSITION_SMALL_THRESHOLD && amount <= QUALITY_POSITION_MODERATE_THRESHOLD) positionSizing = QUALITY_SCORE_POSITION_MODERATE;
      else if (amount > QUALITY_POSITION_MODERATE_THRESHOLD) positionSizing = QUALITY_SCORE_POSITION_LARGE; // too aggressive
      else if (amount === 0) positionSizing = QUALITY_SCORE_POSITION_ZERO; // zero quantity?
    }

    // Timing score: based on reasoning quality (length threshold = thoughtful)
    const timingScore = d.reasoning.length > QUALITY_TIMING_THOUGHTFUL_THRESHOLD ? QUALITY_SCORE_TIMING_THOUGHTFUL : d.reasoning.length > QUALITY_TIMING_ADEQUATE_THRESHOLD ? QUALITY_SCORE_TIMING_ADEQUATE : QUALITY_SCORE_TIMING_RUSHED;

    const qualityScore =
      (executionSuccess * QUALITY_WEIGHT_EXECUTION +
        confidenceCalibration * QUALITY_WEIGHT_CONFIDENCE +
        positionSizing * QUALITY_WEIGHT_POSITION +
        timingScore * QUALITY_WEIGHT_TIMING);

    return {
      agentId: d.agentId,
      qualityScore: Math.round(qualityScore * SCORE_DISPLAY_PRECISION_MULTIPLIER) / SCORE_DISPLAY_PRECISION_DIVISOR,
      factors: {
        confidenceCalibration: Math.round(confidenceCalibration),
        executionSuccess: Math.round(executionSuccess),
        positionSizing: Math.round(positionSizing),
        timingScore: Math.round(timingScore),
      },
    };
  });

  // Find best/worst
  const sorted = [...agentScores].sort(
    (a, b) => b.qualityScore - a.qualityScore,
  );
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];

  const roundQuality =
    agentScores.length > 0
      ? agentScores.reduce((s, a) => s + a.qualityScore, 0) / agentScores.length
      : 0;

  return {
    agentScores,
    bestDecision: best
      ? {
          agentId: best.agentId,
          reason: `Highest quality score: ${best.qualityScore.toFixed(0)}`,
        }
      : null,
    worstDecision: worst && worst !== best
      ? {
          agentId: worst.agentId,
          reason: `Lowest quality score: ${worst.qualityScore.toFixed(0)}`,
        }
      : null,
    roundQualityScore: Math.round(roundQuality * SCORE_DISPLAY_PRECISION_MULTIPLIER) / SCORE_DISPLAY_PRECISION_DIVISOR,
  };
}

// ---------------------------------------------------------------------------
// Market Context Analysis
// ---------------------------------------------------------------------------

function analyzeMarketContext(
  decisions: RoundDecision[],
  marketData: { symbol: string; price: number; change24h: number | null }[],
): RoundAnalytics["marketContext"] {
  const withChange = marketData.filter((m) => m.change24h !== null);

  let topMover: { symbol: string; change: number } | null = null;
  let worstPerformer: { symbol: string; change: number } | null = null;

  if (withChange.length > 0) {
    const sorted = [...withChange].sort(
      (a, b) => (b.change24h ?? 0) - (a.change24h ?? 0),
    );
    topMover = {
      symbol: sorted[0].symbol,
      change: sorted[0].change24h!,
    };
    worstPerformer = {
      symbol: sorted[sorted.length - 1].symbol,
      change: sorted[sorted.length - 1].change24h!,
    };
  }

  const positiveCount = withChange.filter(
    (m) => (m.change24h ?? 0) > 0,
  ).length;
  const marketBreadth =
    withChange.length > 0 ? positiveCount / withChange.length : 0.5;

  const avgVolatility =
    withChange.length > 0
      ? withChange.reduce((s, m) => s + Math.abs(m.change24h ?? 0), 0) /
        withChange.length
      : 0;

  // Dominant sector based on what agents traded
  const activeDecisions = decisions.filter((d) => d.action !== "hold");
  const tradedSymbols = activeDecisions.map((d) => d.symbol);
  const sector =
    tradedSymbols.length > 0
      ? categorizeSymbol(tradedSymbols[0])
      : "mixed";

  return {
    topMover,
    worstPerformer,
    marketBreadth: round3(marketBreadth),
    avgVolatility: round2(avgVolatility),
    sector,
  };
}

function categorizeSymbol(symbol: string): string {
  const tech = ["AAPLx", "AMZNx", "GOOGLx", "METAx", "MSFTx", "NVDAx", "NFLXx", "CRMx", "PLTRx"];
  const crypto = ["COINx", "MSTRx", "HOODx", "CRCLx"];
  const etf = ["SPYx", "QQQx"];
  const pharma = ["LLYx"];
  const meme = ["GMEx"];
  const semi = ["AVGOx"];
  const finance = ["JPMx"];

  if (tech.includes(symbol)) return "technology";
  if (crypto.includes(symbol)) return "crypto-adjacent";
  if (etf.includes(symbol)) return "index-etf";
  if (pharma.includes(symbol)) return "pharma";
  if (meme.includes(symbol)) return "meme";
  if (semi.includes(symbol)) return "semiconductors";
  if (finance.includes(symbol)) return "finance";
  return "other";
}

// ---------------------------------------------------------------------------
// Trend Analysis
// ---------------------------------------------------------------------------

/**
 * Compute performance trends for all agents over recent rounds.
 */
export function computeAgentTrends(windowSize = 20): AgentPerformanceTrend[] {
  const agentIds = new Set<string>();
  const agentNames = new Map<string, string>();

  for (const analytics of roundHistory) {
    for (const score of analytics.quality.agentScores) {
      agentIds.add(score.agentId);
    }
  }

  const trends: AgentPerformanceTrend[] = [];

  for (const agentId of agentIds) {
    const agentRounds = roundHistory
      .filter((r) =>
        r.quality.agentScores.some((s) => s.agentId === agentId),
      )
      .slice(-windowSize);

    if (agentRounds.length < TREND_MIN_TRADES) continue;

    const recentRoundsData = agentRounds.map((r) => {
      const score = r.quality.agentScores.find(
        (s) => s.agentId === agentId,
      )!;
      return {
        roundId: r.roundId,
        action: "unknown", // would need full decision data
        confidence: r.consensus.majorityConfidence,
        executed: score.factors.executionSuccess === QUALITY_SCORE_EXECUTION_SUCCESS,
        qualityScore: score.qualityScore,
      };
    });

    // Compute trend using linear regression of quality scores
    const scores = recentRoundsData.map((r) => r.qualityScore);
    const trendScore = computeLinearTrend(scores);

    let trend: AgentPerformanceTrend["trend"];
    if (trendScore > TREND_IMPROVING_THRESHOLD) trend = "improving";
    else if (trendScore < TREND_DECLINING_THRESHOLD) trend = "declining";
    else trend = "stable";

    const movingAvgQuality =
      scores.reduce((s, v) => s + v, 0) / scores.length;
    const confidences = recentRoundsData.map((r) => r.confidence);
    const movingAvgConfidence =
      confidences.reduce((s, v) => s + v, 0) / confidences.length;

    // Execution streak
    let execStreak = 0;
    for (let i = recentRoundsData.length - 1; i >= 0; i--) {
      if (recentRoundsData[i].executed) execStreak++;
      else break;
    }

    const execSuccesses = countByCondition(recentRoundsData, (r) => r.executed);

    trends.push({
      agentId,
      agentName: agentNames.get(agentId) ?? agentId,
      recentRounds: recentRoundsData,
      trend,
      trendScore: round3(trendScore),
      movingAvgConfidence: Math.round(movingAvgConfidence * SCORE_DISPLAY_PRECISION_MULTIPLIER) / SCORE_DISPLAY_PRECISION_DIVISOR,
      movingAvgQuality: Math.round(movingAvgQuality * SCORE_DISPLAY_PRECISION_MULTIPLIER) / SCORE_DISPLAY_PRECISION_DIVISOR,
      currentExecutionStreak: execStreak,
      executionSuccessRate:
        recentRoundsData.length > 0
          ? Math.round(
              (execSuccesses / recentRoundsData.length) * RATE_DISPLAY_PRECISION_MULTIPLIER,
            ) / RATE_DISPLAY_PRECISION_DIVISOR
          : 0,
    });
  }

  return trends;
}

/**
 * Generate a comprehensive analytics summary for a period.
 */
export function generateAnalyticsSummary(
  periodDays = 7,
): AnalyticsSummary {
  const cutoff = Date.now() - periodDays * MS_PER_DAY;
  const cutoffStr = new Date(cutoff).toISOString();

  const periodRounds = roundHistory.filter(
    (r) => r.timestamp >= cutoffStr,
  );

  if (periodRounds.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      totalRoundsAnalyzed: 0,
      periodStartDate: cutoffStr,
      periodEndDate: new Date().toISOString(),
      system: {
        avgParticipationRate: 0,
        avgExecutionRate: 0,
        avgRoundQuality: 0,
        totalUsdcTraded: 0,
        unanimousRoundRate: 0,
        splitRoundRate: 0,
      },
      agentTrends: [],
      patterns: [],
      bestRound: null,
      worstRound: null,
    };
  }

  const avgParticipation =
    periodRounds.reduce((s, r) => s + r.participation.participationRate, 0) /
    periodRounds.length;
  const avgExecution =
    periodRounds.reduce((s, r) => s + r.participation.executionRate, 0) /
    periodRounds.length;
  const avgQuality =
    periodRounds.reduce((s, r) => s + r.quality.roundQualityScore, 0) /
    periodRounds.length;
  const totalUsdc = periodRounds.reduce(
    (s, r) => s + r.metrics.totalUsdcTraded,
    0,
  );
  const unanimousCount = periodRounds.filter(
    (r) => r.consensus.type === "unanimous",
  ).length;
  const splitCount = periodRounds.filter(
    (r) => r.consensus.type === "split",
  ).length;

  const agentTrends = computeAgentTrends();

  // Detect patterns
  const patterns: AnalyticsSummary["patterns"] = [];

  if (avgParticipation < PATTERN_LOW_PARTICIPATION_THRESHOLD) {
    patterns.push({
      type: "low_participation",
      description: `Low participation rate (${(avgParticipation * 100).toFixed(0)}%) — agents are mostly holding`,
      significance: "medium",
    });
  }

  if (avgExecution < PATTERN_EXECUTION_FAILURE_THRESHOLD && avgParticipation > PATTERN_MIN_PARTICIPATION_FOR_EXEC_CHECK) {
    patterns.push({
      type: "execution_failures",
      description: `Execution success rate ${(avgExecution * 100).toFixed(0)}% — investigate trade failures`,
      significance: "high",
    });
  }

  if (unanimousCount / periodRounds.length > PATTERN_HIGH_AGREEMENT_THRESHOLD) {
    patterns.push({
      type: "high_agreement",
      description: `${((unanimousCount / periodRounds.length) * 100).toFixed(0)}% of rounds are unanimous — possible herding risk`,
      significance: "medium",
    });
  }

  const decliningAgents = agentTrends.filter(
    (t) => t.trend === "declining",
  );
  if (decliningAgents.length > 0) {
    patterns.push({
      type: "declining_agents",
      description: `${decliningAgents.map((a) => a.agentName).join(", ")} showing declining performance`,
      significance: decliningAgents.length >= 2 ? "high" : "low",
    });
  }

  // Best/worst rounds
  const sortedByQuality = [...periodRounds].sort(
    (a, b) => b.quality.roundQualityScore - a.quality.roundQualityScore,
  );
  const bestRound = sortedByQuality[0];
  const worstRound = sortedByQuality[sortedByQuality.length - 1];

  return {
    generatedAt: new Date().toISOString(),
    totalRoundsAnalyzed: periodRounds.length,
    periodStartDate: cutoffStr,
    periodEndDate: new Date().toISOString(),
    system: {
      avgParticipationRate: round3(avgParticipation),
      avgExecutionRate: round3(avgExecution),
      avgRoundQuality: Math.round(avgQuality * SCORE_DISPLAY_PRECISION_MULTIPLIER) / SCORE_DISPLAY_PRECISION_DIVISOR,
      totalUsdcTraded: round2(totalUsdc),
      unanimousRoundRate: round3(unanimousCount / periodRounds.length),
      splitRoundRate: round3(splitCount / periodRounds.length),
    },
    agentTrends,
    patterns,
    bestRound: bestRound
      ? {
          roundId: bestRound.roundId,
          score: bestRound.quality.roundQualityScore,
          reason: `Quality ${bestRound.quality.roundQualityScore.toFixed(0)}, ${bestRound.participation.activeAgents}/${bestRound.participation.totalAgents} active, $${bestRound.metrics.totalUsdcTraded.toFixed(2)} traded`,
        }
      : null,
    worstRound: worstRound && worstRound !== bestRound
      ? {
          roundId: worstRound.roundId,
          score: worstRound.quality.roundQualityScore,
          reason: `Quality ${worstRound.quality.roundQualityScore.toFixed(0)}, ${worstRound.participation.activeAgents}/${worstRound.participation.totalAgents} active`,
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Status & Export
// ---------------------------------------------------------------------------

/**
 * Get current analytics engine status.
 */
export function getAnalyticsStatus(): {
  totalRoundsAnalyzed: number;
  oldestRound: string | null;
  newestRound: string | null;
  averageRoundQuality: number;
  averageParticipation: number;
} {
  const qualities = roundHistory.map(
    (r) => r.quality.roundQualityScore,
  );
  const participations = roundHistory.map(
    (r) => r.participation.participationRate,
  );

  return {
    totalRoundsAnalyzed: roundHistory.length,
    oldestRound: roundHistory[0]?.roundId ?? null,
    newestRound: roundHistory[roundHistory.length - 1]?.roundId ?? null,
    averageRoundQuality:
      qualities.length > 0
        ? Math.round(
            (qualities.reduce((s, v) => s + v, 0) / qualities.length) *
              SCORE_DISPLAY_PRECISION_MULTIPLIER,
          ) / SCORE_DISPLAY_PRECISION_DIVISOR
        : 0,
    averageParticipation:
      participations.length > 0
        ? Math.round(
            (participations.reduce((s, v) => s + v, 0) /
              participations.length) *
              RATE_DISPLAY_PRECISION_MULTIPLIER,
          ) / RATE_DISPLAY_PRECISION_DIVISOR
        : 0,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute linear trend score from a series of values.
 * Returns slope normalized by mean (positive = improving).
 */
function computeLinearTrend(values: number[]): number {
  const n = values.length;
  if (n < 3) return 0;

  const mean = values.reduce((s, v) => s + v, 0) / n;
  if (mean === 0) return 0;

  let sumXY = 0;
  let sumXX = 0;
  const xMean = (n - 1) / 2;

  for (let i = 0; i < n; i++) {
    const dx = i - xMean;
    const dy = values[i] - mean;
    sumXY += dx * dy;
    sumXX += dx * dx;
  }

  if (sumXX === 0) return 0;
  const slope = sumXY / sumXX;

  // Normalize by mean to get relative trend
  return slope / mean;
}
