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
  const totalUsdc = decisions.reduce((s, d) => s + (d.usdcAmount ?? 0), 0);
  const avgConf =
    decisions.length > 0
      ? decisions.reduce((s, d) => s + d.confidence, 0) / decisions.length
      : 0;
  const avgQty =
    activeDecisions.length > 0
      ? activeDecisions.reduce((s, d) => s + d.quantity, 0) /
        activeDecisions.length
      : 0;
  const uniqueStocks = new Set(
    activeDecisions.map((d) => d.symbol),
  ).size;
  const buys = activeDecisions.filter((d) => d.action === "buy").length;
  const sells = activeDecisions.filter((d) => d.action === "sell").length;

  const analytics: RoundAnalytics = {
    roundId,
    timestamp,
    analyzedAt,
    participation,
    consensus,
    quality,
    marketContext,
    metrics: {
      totalUsdcTraded: Math.round(totalUsdc * 100) / 100,
      avgConfidence: Math.round(avgConf * 10) / 10,
      avgQuantity: Math.round(avgQty * 100) / 100,
      uniqueStocksTraded: uniqueStocks,
      buyToSellRatio: sells > 0 ? Math.round((buys / sells) * 100) / 100 : buys > 0 ? Infinity : 0,
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
export function getRecentRoundAnalytics(limit = 20): RoundAnalytics[] {
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
  const spread = Math.max(...confidences) - Math.min(...confidences);
  const majAvgConf =
    majorityGroup.length > 0
      ? majorityGroup.reduce((s, d) => s + d.confidence, 0) / majorityGroup.length
      : 0;

  return {
    type,
    majorityAction: majAction ?? null,
    majoritySymbol: majSymbol ?? null,
    majorityConfidence: Math.round(majAvgConf * 10) / 10,
    dissenterCount,
    confidenceSpread: Math.round(spread * 10) / 10,
  };
}

// ---------------------------------------------------------------------------
// Decision Quality Scoring
// ---------------------------------------------------------------------------

function scoreDecisionQuality(
  decisions: RoundDecision[],
): RoundAnalytics["quality"] {
  const agentScores = decisions.map((d) => {
    // Execution success: 100 if executed or hold, 0 if failed
    const executionSuccess =
      d.action === "hold" ? 80 : d.executed ? 100 : 0;

    // Confidence calibration: penalize extreme confidence on failed trades
    let confidenceCalibration = 70; // baseline
    if (!d.executed && d.action !== "hold") {
      // Failed trade with high confidence = poor calibration
      confidenceCalibration = Math.max(0, 100 - d.confidence);
    } else if (d.executed && d.confidence > 70) {
      confidenceCalibration = 90; // good: high confidence on executed trade
    }

    // Position sizing: penalize very large trades (over $100) and very tiny ones
    let positionSizing = 70;
    if (d.action !== "hold") {
      const amount = d.usdcAmount ?? d.quantity;
      if (amount > 0 && amount <= 50) positionSizing = 90; // reasonable
      else if (amount > 50 && amount <= 200) positionSizing = 75;
      else if (amount > 200) positionSizing = 50; // too aggressive
      else if (amount === 0) positionSizing = 60; // zero quantity?
    }

    // Timing score: based on reasoning quality (length > 50 chars = thoughtful)
    const timingScore = d.reasoning.length > 100 ? 85 : d.reasoning.length > 50 ? 70 : 50;

    const qualityScore =
      (executionSuccess * 0.35 +
        confidenceCalibration * 0.25 +
        positionSizing * 0.20 +
        timingScore * 0.20);

    return {
      agentId: d.agentId,
      qualityScore: Math.round(qualityScore * 10) / 10,
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
    roundQualityScore: Math.round(roundQuality * 10) / 10,
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
    marketBreadth: Math.round(marketBreadth * 1000) / 1000,
    avgVolatility: Math.round(avgVolatility * 100) / 100,
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

  // Also get names from decisions
  for (const analytics of roundHistory) {
    // We don't store names in analytics, so use agentId as name fallback
  }

  const trends: AgentPerformanceTrend[] = [];

  for (const agentId of agentIds) {
    const agentRounds = roundHistory
      .filter((r) =>
        r.quality.agentScores.some((s) => s.agentId === agentId),
      )
      .slice(-windowSize);

    if (agentRounds.length < 3) continue;

    const recentRoundsData = agentRounds.map((r) => {
      const score = r.quality.agentScores.find(
        (s) => s.agentId === agentId,
      )!;
      return {
        roundId: r.roundId,
        action: "unknown", // would need full decision data
        confidence: r.consensus.majorityConfidence,
        executed: score.factors.executionSuccess === 100,
        qualityScore: score.qualityScore,
      };
    });

    // Compute trend using linear regression of quality scores
    const scores = recentRoundsData.map((r) => r.qualityScore);
    const trendScore = computeLinearTrend(scores);

    let trend: AgentPerformanceTrend["trend"];
    if (trendScore > 0.1) trend = "improving";
    else if (trendScore < -0.1) trend = "declining";
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

    const execSuccesses = recentRoundsData.filter((r) => r.executed).length;

    trends.push({
      agentId,
      agentName: agentNames.get(agentId) ?? agentId,
      recentRounds: recentRoundsData,
      trend,
      trendScore: Math.round(trendScore * 1000) / 1000,
      movingAvgConfidence: Math.round(movingAvgConfidence * 10) / 10,
      movingAvgQuality: Math.round(movingAvgQuality * 10) / 10,
      currentExecutionStreak: execStreak,
      executionSuccessRate:
        recentRoundsData.length > 0
          ? Math.round(
              (execSuccesses / recentRoundsData.length) * 1000,
            ) / 1000
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
  const cutoff = Date.now() - periodDays * 24 * 60 * 60 * 1000;
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

  if (avgParticipation < 0.5) {
    patterns.push({
      type: "low_participation",
      description: `Low participation rate (${(avgParticipation * 100).toFixed(0)}%) — agents are mostly holding`,
      significance: "medium",
    });
  }

  if (avgExecution < 0.8 && avgParticipation > 0.3) {
    patterns.push({
      type: "execution_failures",
      description: `Execution success rate ${(avgExecution * 100).toFixed(0)}% — investigate trade failures`,
      significance: "high",
    });
  }

  if (unanimousCount / periodRounds.length > 0.5) {
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
      avgParticipationRate: Math.round(avgParticipation * 1000) / 1000,
      avgExecutionRate: Math.round(avgExecution * 1000) / 1000,
      avgRoundQuality: Math.round(avgQuality * 10) / 10,
      totalUsdcTraded: Math.round(totalUsdc * 100) / 100,
      unanimousRoundRate:
        Math.round((unanimousCount / periodRounds.length) * 1000) / 1000,
      splitRoundRate:
        Math.round((splitCount / periodRounds.length) * 1000) / 1000,
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
              10,
          ) / 10
        : 0,
    averageParticipation:
      participations.length > 0
        ? Math.round(
            (participations.reduce((s, v) => s + v, 0) /
              participations.length) *
              1000,
          ) / 1000
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
