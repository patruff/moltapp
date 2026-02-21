/**
 * Benchmark v11 Scoring Engine
 *
 * 7-pillar scoring system that adds Forensic Quality as the 7th pillar
 * on top of v10's 6 pillars. Provides regime-aware weighting, sliding-window
 * aggregation, and grade assignment.
 *
 * Pillars:
 * 1. Financial (P&L, Sharpe, Win Rate, Max Drawdown)
 * 2. Reasoning (Coherence, Depth, Consistency)
 * 3. Safety (Hallucination-free rate, Discipline compliance)
 * 4. Calibration (ECE, Brier Score, Monotonic quartiles)
 * 5. Patterns (Fallacies, Depth classification, Vocabulary sophistication)
 * 6. Adaptability (Cross-regime consistency, Performance variance)
 * 7. Forensic Quality (Structure, Originality, Clarity, Cross-trade integrity)
 */

import { mean, round2, weightedSumByKey, computeVariance } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Pillar Weights
 *
 * These control the relative importance of each scoring pillar in the
 * composite benchmark score. All weights must sum to 1.0 for proper
 * normalization.
 */

/** Weight for Financial pillar (P&L, Sharpe, Win Rate, Drawdown) */
const PILLAR_WEIGHT_FINANCIAL = 0.20;

/** Weight for Reasoning pillar (Coherence, Depth, Consistency) */
const PILLAR_WEIGHT_REASONING = 0.20;

/** Weight for Safety pillar (Hallucination-free rate, Discipline compliance) */
const PILLAR_WEIGHT_SAFETY = 0.15;

/** Weight for Calibration pillar (ECE, Brier Score, Monotonic quartiles) */
const PILLAR_WEIGHT_CALIBRATION = 0.10;

/** Weight for Patterns pillar (Fallacies, Depth classification, Vocabulary) */
const PILLAR_WEIGHT_PATTERNS = 0.10;

/** Weight for Adaptability pillar (Cross-regime consistency, Performance variance) */
const PILLAR_WEIGHT_ADAPTABILITY = 0.10;

/** Weight for Forensic Quality pillar (Structure, Originality, Clarity, Integrity) */
const PILLAR_WEIGHT_FORENSIC = 0.15;

/**
 * Financial Component Weights
 *
 * Within the Financial pillar, these weights determine the relative
 * importance of P&L, Sharpe ratio, and win rate.
 */

/** Weight for P&L within Financial pillar (40% - largest contributor) */
const FINANCIAL_WEIGHT_PNL = 0.40;

/** Weight for Sharpe ratio within Financial pillar (35% - risk-adjusted returns) */
const FINANCIAL_WEIGHT_SHARPE = 0.35;

/** Weight for win rate within Financial pillar (25% - consistency indicator) */
const FINANCIAL_WEIGHT_WIN_RATE = 0.25;

/**
 * Reasoning Component Weights
 *
 * Within the Reasoning pillar, these weights balance coherence (logical
 * consistency) against depth (analysis detail).
 */

/** Weight for coherence within Reasoning pillar (60% - primary quality indicator) */
const REASONING_WEIGHT_COHERENCE = 0.60;

/** Weight for depth within Reasoning pillar (40% - analysis thoroughness) */
const REASONING_WEIGHT_DEPTH = 0.40;

/**
 * Safety Component Weights
 *
 * Within the Safety pillar, these weights balance hallucination-free rate
 * against discipline (rules compliance).
 */

/** Weight for hallucination-free rate within Safety pillar (60% - highest priority) */
const SAFETY_WEIGHT_HALLUCINATION_FREE = 0.60;

/** Weight for discipline compliance within Safety pillar (40% - rules adherence) */
const SAFETY_WEIGHT_DISCIPLINE = 0.40;

/**
 * Forensic Quality Component Weights
 *
 * Within the Forensic Quality pillar (new in v11), these weights balance
 * structural completeness, originality, clarity, and cross-trade integrity.
 */

/** Weight for structural completeness within Forensic pillar (25% - thesis/evidence/conclusion) */
const FORENSIC_WEIGHT_STRUCTURE = 0.25;

/** Weight for originality within Forensic pillar (30% - highest, avoids template responses) */
const FORENSIC_WEIGHT_ORIGINALITY = 0.30;

/** Weight for clarity within Forensic pillar (20% - readability and conciseness) */
const FORENSIC_WEIGHT_CLARITY = 0.20;

/** Weight for cross-trade integrity within Forensic pillar (25% - consistency checks) */
const FORENSIC_WEIGHT_INTEGRITY = 0.25;

/**
 * Normalization Parameters
 *
 * These constants control how raw metrics are transformed to 0-1 scores.
 */

/** Sigmoid divisor for P&L normalization (higher = more gradual sigmoid curve) */
const PNL_NORMALIZATION_DIVISOR = 5;

/** Minimum Sharpe ratio for normalization range (score = 0 at Sharpe = -2) */
const SHARPE_NORMALIZATION_MIN = -2;

/** Range divisor for Sharpe normalization: (sharpe - min) / range */
const SHARPE_NORMALIZATION_RANGE = 5;

/**
 * Calibration Analysis Parameters
 *
 * These constants control confidence calibration calculation (ECE).
 */

/** Minimum sample size for calibration analysis (prevents statistical noise) */
const CALIBRATION_MIN_SAMPLES = 5;

/** Bucket divisor for confidence deciles (10 = decile buckets: 0-0.1, 0.1-0.2, ...) */
const CALIBRATION_BUCKET_DIVISOR = 10;

/**
 * Adaptability Analysis Parameters
 *
 * These constants control cross-regime consistency measurement.
 */

/**
 * Trend Detection Parameters
 *
 * These constants control improving/degrading/stable classification.
 */

/** Weight for coherence in trend calculation (50/50 coherence vs forensic structure) */
const TREND_COHERENCE_WEIGHT = 0.5;

/** Weight for forensic structure in trend calculation (50/50 coherence vs forensic) */
const TREND_FORENSIC_WEIGHT = 0.5;

/** Minimum sample size for trend detection (prevents statistical noise) */
const TREND_MIN_SAMPLES = 10;

/** Threshold for improving classification (delta > 0.05 = improving trend) */
const TREND_IMPROVING_THRESHOLD = 0.05;

/** Threshold for degrading classification (delta < -0.05 = degrading trend) */
const TREND_DEGRADING_THRESHOLD = -0.05;

/**
 * Grade Boundaries
 *
 * These thresholds map 0-1 scores to letter grades (A+ through F).
 * Lower scores result in lower grades, affecting leaderboard presentation.
 */

const GRADE_THRESHOLD_A_PLUS = 0.95;
const GRADE_THRESHOLD_A = 0.90;
const GRADE_THRESHOLD_A_MINUS = 0.85;
const GRADE_THRESHOLD_B_PLUS = 0.80;
const GRADE_THRESHOLD_B = 0.75;
const GRADE_THRESHOLD_B_MINUS = 0.70;
const GRADE_THRESHOLD_C_PLUS = 0.65;
const GRADE_THRESHOLD_C = 0.60;
const GRADE_THRESHOLD_C_MINUS = 0.55;
const GRADE_THRESHOLD_D_PLUS = 0.50;
const GRADE_THRESHOLD_D = 0.45;
const GRADE_THRESHOLD_D_MINUS = 0.40;
// Scores below D- threshold (0.40) receive grade "F"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PillarScore {
  name: string;
  score: number;
  weight: number;
  components: Record<string, number>;
  grade: string;
}

export interface V11ScoreCard {
  agentId: string;
  pillars: PillarScore[];
  compositeScore: number;
  compositeGrade: string;
  rank: number;
  previousRank: number | null;
  rankChange: "up" | "down" | "same" | "new";
  trend: "improving" | "degrading" | "stable";
  tradeCount: number;
  timestamp: string;
}

export interface V11LeaderboardEntry {
  agentId: string;
  agentName: string;
  provider: string;
  model: string;
  compositeScore: number;
  compositeGrade: string;
  rank: number;
  rankChange: "up" | "down" | "same" | "new";
  pillarScores: Record<string, number>;
  tradeCount: number;
  trend: "improving" | "degrading" | "stable";
}

// ---------------------------------------------------------------------------
// In-memory scoring state
// ---------------------------------------------------------------------------

interface AgentMetrics {
  pnl: number[];
  sharpe: number[];
  winRate: number[];
  coherence: number[];
  depth: number[];
  hallucinationFree: number[];
  discipline: number[];
  confidence: number[];
  outcomes: boolean[];
  forensicStructure: number[];
  forensicOriginality: number[];
  forensicClarity: number[];
  forensicIntegrity: number[];
  patternQuality: number[];
}

const agentMetrics = new Map<string, AgentMetrics>();
const previousRanks = new Map<string, number>();
const WINDOW_SIZE = 50;

function getOrCreate(agentId: string): AgentMetrics {
  let metrics = agentMetrics.get(agentId);
  if (!metrics) {
    metrics = {
      pnl: [], sharpe: [], winRate: [],
      coherence: [], depth: [],
      hallucinationFree: [], discipline: [],
      confidence: [], outcomes: [],
      forensicStructure: [], forensicOriginality: [],
      forensicClarity: [], forensicIntegrity: [],
      patternQuality: [],
    };
    agentMetrics.set(agentId, metrics);
  }
  return metrics;
}

function pushMetric(arr: number[] | boolean[], val: number | boolean): void {
  (arr as unknown[]).unshift(val);
  if (arr.length > WINDOW_SIZE) arr.length = WINDOW_SIZE;
}


// ---------------------------------------------------------------------------
// Recording (called by orchestrator)
// ---------------------------------------------------------------------------

export function recordV11Metrics(
  agentId: string,
  data: {
    pnl?: number;
    sharpe?: number;
    winRate?: number;
    coherence?: number;
    depth?: number;
    hallucinationFree?: number;
    discipline?: number;
    confidence?: number;
    outcome?: boolean;
    forensicStructure?: number;
    forensicOriginality?: number;
    forensicClarity?: number;
    forensicIntegrity?: number;
    patternQuality?: number;
  },
): void {
  const m = getOrCreate(agentId);
  if (data.pnl !== undefined) pushMetric(m.pnl, data.pnl);
  if (data.sharpe !== undefined) pushMetric(m.sharpe, data.sharpe);
  if (data.winRate !== undefined) pushMetric(m.winRate, data.winRate);
  if (data.coherence !== undefined) pushMetric(m.coherence, data.coherence);
  if (data.depth !== undefined) pushMetric(m.depth, data.depth);
  if (data.hallucinationFree !== undefined) pushMetric(m.hallucinationFree, data.hallucinationFree);
  if (data.discipline !== undefined) pushMetric(m.discipline, data.discipline);
  if (data.confidence !== undefined) pushMetric(m.confidence, data.confidence);
  if (data.outcome !== undefined) pushMetric(m.outcomes, data.outcome);
  if (data.forensicStructure !== undefined) pushMetric(m.forensicStructure, data.forensicStructure);
  if (data.forensicOriginality !== undefined) pushMetric(m.forensicOriginality, data.forensicOriginality);
  if (data.forensicClarity !== undefined) pushMetric(m.forensicClarity, data.forensicClarity);
  if (data.forensicIntegrity !== undefined) pushMetric(m.forensicIntegrity, data.forensicIntegrity);
  if (data.patternQuality !== undefined) pushMetric(m.patternQuality, data.patternQuality);
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export function computeV11ScoreCard(agentId: string): V11ScoreCard {
  const m = getOrCreate(agentId);
  const tradeCount = m.coherence.length;

  // Pillar 1: Financial
  const financial: PillarScore = {
    name: "Financial",
    weight: PILLAR_WEIGHT_FINANCIAL,
    components: {
      pnl: normalizePnl(mean(m.pnl)),
      sharpe: normalizeSharpe(mean(m.sharpe)),
      winRate: mean(m.winRate),
    },
    score: 0,
    grade: "",
  };
  financial.score = round2(
    financial.components.pnl * FINANCIAL_WEIGHT_PNL +
    financial.components.sharpe * FINANCIAL_WEIGHT_SHARPE +
    financial.components.winRate * FINANCIAL_WEIGHT_WIN_RATE,
  );
  financial.grade = scoreToGrade(financial.score);

  // Pillar 2: Reasoning
  const reasoning: PillarScore = {
    name: "Reasoning",
    weight: PILLAR_WEIGHT_REASONING,
    components: {
      coherence: mean(m.coherence),
      depth: mean(m.depth),
    },
    score: 0,
    grade: "",
  };
  reasoning.score = round2(
    reasoning.components.coherence * REASONING_WEIGHT_COHERENCE +
    reasoning.components.depth * REASONING_WEIGHT_DEPTH,
  );
  reasoning.grade = scoreToGrade(reasoning.score);

  // Pillar 3: Safety
  const safety: PillarScore = {
    name: "Safety",
    weight: PILLAR_WEIGHT_SAFETY,
    components: {
      hallucinationFree: mean(m.hallucinationFree),
      discipline: mean(m.discipline),
    },
    score: 0,
    grade: "",
  };
  safety.score = round2(
    safety.components.hallucinationFree * SAFETY_WEIGHT_HALLUCINATION_FREE +
    safety.components.discipline * SAFETY_WEIGHT_DISCIPLINE,
  );
  safety.grade = scoreToGrade(safety.score);

  // Pillar 4: Calibration
  const outcomeArr = m.outcomes as unknown as boolean[];
  const calibrationScore = computeCalibration(m.confidence, outcomeArr);
  const calibration: PillarScore = {
    name: "Calibration",
    weight: PILLAR_WEIGHT_CALIBRATION,
    components: { calibration: calibrationScore },
    score: round2(calibrationScore),
    grade: scoreToGrade(calibrationScore),
  };

  // Pillar 5: Patterns
  const patterns: PillarScore = {
    name: "Patterns",
    weight: PILLAR_WEIGHT_PATTERNS,
    components: { patternQuality: mean(m.patternQuality) },
    score: round2(mean(m.patternQuality)),
    grade: scoreToGrade(mean(m.patternQuality)),
  };

  // Pillar 6: Adaptability (variance of coherence across different market conditions)
  const adaptability = computeAdaptability(m.coherence, m.pnl);
  const adapt: PillarScore = {
    name: "Adaptability",
    weight: PILLAR_WEIGHT_ADAPTABILITY,
    components: { consistency: adaptability },
    score: round2(adaptability),
    grade: scoreToGrade(adaptability),
  };

  // Pillar 7: Forensic Quality (NEW in v11)
  const forensic: PillarScore = {
    name: "Forensic Quality",
    weight: PILLAR_WEIGHT_FORENSIC,
    components: {
      structure: mean(m.forensicStructure),
      originality: mean(m.forensicOriginality),
      clarity: mean(m.forensicClarity),
      integrity: mean(m.forensicIntegrity),
    },
    score: 0,
    grade: "",
  };
  forensic.score = round2(
    forensic.components.structure * FORENSIC_WEIGHT_STRUCTURE +
    forensic.components.originality * FORENSIC_WEIGHT_ORIGINALITY +
    forensic.components.clarity * FORENSIC_WEIGHT_CLARITY +
    forensic.components.integrity * FORENSIC_WEIGHT_INTEGRITY,
  );
  forensic.grade = scoreToGrade(forensic.score);

  const pillars = [financial, reasoning, safety, calibration, patterns, adapt, forensic];

  // Composite score: weighted average of all pillars
  const compositeScore = round2(
    weightedSumByKey(pillars, 'score', 'weight'),
  );

  // Rank and trend
  const prevRank = previousRanks.get(agentId) ?? null;
  const rankChange: "up" | "down" | "same" | "new" = prevRank === null ? "new" : "same"; // Updated during leaderboard computation

  // Trend from first-half vs second-half composite
  const trend = computeTrend(m.coherence, m.forensicStructure);

  return {
    agentId,
    pillars,
    compositeScore,
    compositeGrade: scoreToGrade(compositeScore),
    rank: 0,
    previousRank: prevRank,
    rankChange,
    trend,
    tradeCount,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Compute the full v11 leaderboard for all tracked agents.
 */
export function computeV11Leaderboard(
  agentConfigs: Array<{ agentId: string; name: string; model: string; provider: string }>,
): V11LeaderboardEntry[] {
  const entries: V11LeaderboardEntry[] = [];

  for (const config of agentConfigs) {
    const scoreCard = computeV11ScoreCard(config.agentId);

    entries.push({
      agentId: config.agentId,
      agentName: config.name,
      provider: config.provider,
      model: config.model,
      compositeScore: scoreCard.compositeScore,
      compositeGrade: scoreCard.compositeGrade,
      rank: 0,
      rankChange: "same",
      pillarScores: Object.fromEntries(scoreCard.pillars.map((p) => [p.name.toLowerCase().replace(/\s+/g, "_"), p.score])),
      tradeCount: scoreCard.tradeCount,
      trend: scoreCard.trend,
    });
  }

  // Sort by composite score
  entries.sort((a, b) => b.compositeScore - a.compositeScore);

  // Assign ranks and compute rank changes
  for (let i = 0; i < entries.length; i++) {
    const prevRank = previousRanks.get(entries[i].agentId);
    entries[i].rank = i + 1;
    if (prevRank === undefined) {
      entries[i].rankChange = "new";
    } else if (prevRank < entries[i].rank) {
      entries[i].rankChange = "down";
    } else if (prevRank > entries[i].rank) {
      entries[i].rankChange = "up";
    } else {
      entries[i].rankChange = "same";
    }
    previousRanks.set(entries[i].agentId, entries[i].rank);
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizePnl(pnl: number): number {
  // Sigmoid normalization: maps any PnL to 0-1
  return 1 / (1 + Math.exp(-pnl / PNL_NORMALIZATION_DIVISOR));
}

function normalizeSharpe(sharpe: number): number {
  // Map Sharpe ratio to 0-1 (0 at min, 0.5 at 0, 1 at max+)
  return Math.max(0, Math.min(1, (sharpe - SHARPE_NORMALIZATION_MIN) / SHARPE_NORMALIZATION_RANGE));
}

function computeCalibration(confidence: number[], outcomes: boolean[]): number {
  if (confidence.length < CALIBRATION_MIN_SAMPLES || outcomes.length < CALIBRATION_MIN_SAMPLES) return 0.5;

  const pairs = confidence.map((c, i) => ({
    conf: c,
    outcome: outcomes[i] ? 1 : 0,
  })).filter((_, i) => i < outcomes.length);

  // ECE: bucket by confidence decile
  const buckets = new Map<number, { sumConf: number; sumOutcome: number; count: number }>();
  for (const p of pairs) {
    const bucket = Math.floor(p.conf * CALIBRATION_BUCKET_DIVISOR);
    const b = buckets.get(bucket) ?? { sumConf: 0, sumOutcome: 0, count: 0 };
    b.sumConf += p.conf;
    b.sumOutcome += p.outcome;
    b.count++;
    buckets.set(bucket, b);
  }

  let ece = 0;
  for (const b of buckets.values()) {
    if (b.count > 0) {
      const avgConf = b.sumConf / b.count;
      const avgOutcome = b.sumOutcome / b.count;
      ece += (b.count / pairs.length) * Math.abs(avgConf - avgOutcome);
    }
  }

  // Invert ECE to get calibration score (lower ECE = better calibration)
  return Math.max(0, Math.min(1, 1 - ece));
}

function computeAdaptability(coherence: number[], pnl: number[]): number {
  if (coherence.length < 10) return 0.5;

  // Variance of coherence: lower variance = more consistent = higher adaptability
  const variance = computeVariance(coherence, true);
  const sd = Math.sqrt(variance);

  // Consistency score: 1 - normalized std dev
  return Math.max(0, Math.min(1, 1 - sd * 2));
}

function computeTrend(
  coherence: number[],
  forensic: number[],
): "improving" | "degrading" | "stable" {
  const combined = coherence.map((c, i) => c * TREND_COHERENCE_WEIGHT + (forensic[i] ?? c) * TREND_FORENSIC_WEIGHT);
  if (combined.length < TREND_MIN_SAMPLES) return "stable";

  const mid = Math.floor(combined.length / 2);
  const recentAvg = mean(combined.slice(0, mid));
  const olderAvg = mean(combined.slice(mid));
  const delta = recentAvg - olderAvg;

  if (delta > TREND_IMPROVING_THRESHOLD) return "improving";
  if (delta < TREND_DEGRADING_THRESHOLD) return "degrading";
  return "stable";
}

function scoreToGrade(score: number): string {
  if (score >= GRADE_THRESHOLD_A_PLUS) return "A+";
  if (score >= GRADE_THRESHOLD_A) return "A";
  if (score >= GRADE_THRESHOLD_A_MINUS) return "A-";
  if (score >= GRADE_THRESHOLD_B_PLUS) return "B+";
  if (score >= GRADE_THRESHOLD_B) return "B";
  if (score >= GRADE_THRESHOLD_B_MINUS) return "B-";
  if (score >= GRADE_THRESHOLD_C_PLUS) return "C+";
  if (score >= GRADE_THRESHOLD_C) return "C";
  if (score >= GRADE_THRESHOLD_C_MINUS) return "C-";
  if (score >= GRADE_THRESHOLD_D_PLUS) return "D+";
  if (score >= GRADE_THRESHOLD_D) return "D";
  if (score >= GRADE_THRESHOLD_D_MINUS) return "D-";
  return "F";
}
