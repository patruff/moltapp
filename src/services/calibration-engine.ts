/**
 * Confidence Calibration Engine
 *
 * Measures whether AI agents' self-reported confidence actually predicts
 * trade outcomes. A perfectly calibrated agent has 70% win rate when
 * reporting 70% confidence.
 *
 * Implements:
 * - Expected Calibration Error (ECE)
 * - Brier Score
 * - Reliability diagrams (bucketed calibration curves)
 * - Overconfidence / underconfidence detection
 * - Temporal calibration drift
 *
 * This is a core benchmark pillar — agents that "know what they know"
 * are fundamentally more useful than agents that are randomly confident.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

import { round2 } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Maximum number of calibration samples stored per agent.
 * Sliding window prevents unbounded memory growth while maintaining
 * statistical significance (~500 trades = 6-12 months of data).
 */
const MAX_SAMPLES = 500;

/**
 * Number of confidence buckets for reliability diagram.
 * 10 buckets = 10% increments (0-10%, 10-20%, ..., 90-100%).
 * Standard in calibration literature for granular analysis.
 */
const NUM_BUCKETS = 10;

/**
 * Monotonicity tolerance threshold.
 * Allows 5% tolerance for noise when checking if higher confidence
 * buckets have higher win rates. Prevents flagging normal variance.
 */
const MONOTONICITY_TOLERANCE = 0.05;

/**
 * Minimum samples required for temporal trend detection.
 * Requires at least 20 samples to compare first half vs second half
 * and detect improving/degrading calibration trends.
 */
const MIN_SAMPLES_FOR_TREND = 20;

/**
 * Trend detection threshold - improvement (ECE decreased).
 * If ECE drops by more than 3%, classify as "improving" calibration.
 * Lower ECE = better calibration, so negative diff = improvement.
 */
const TREND_IMPROVEMENT_THRESHOLD = -0.03;

/**
 * Trend detection threshold - degradation (ECE increased).
 * If ECE rises by more than 3%, classify as "degrading" calibration.
 * Higher ECE = worse calibration, so positive diff = degradation.
 */
const TREND_DEGRADING_THRESHOLD = 0.03;

/**
 * ECE threshold for "well_calibrated" diagnosis.
 * ECE < 8% = agent's confidence predictions are reasonably accurate.
 * Standard calibration quality cutoff in ML literature.
 */
const ECE_WELL_CALIBRATED_THRESHOLD = 0.08;

/**
 * High overconfidence rate threshold for "overconfident" diagnosis.
 * If >60% of buckets show confidence > win rate, agent systematically
 * overestimates trade success probability.
 */
const OVERCONFIDENCE_HIGH_THRESHOLD = 0.6;

/**
 * High underconfidence rate threshold for "underconfident" diagnosis.
 * If >60% of buckets show confidence < win rate, agent systematically
 * underestimates trade success probability.
 */
const UNDERCONFIDENCE_HIGH_THRESHOLD = 0.6;

/**
 * Default calibration score for agents with zero samples.
 * 0.5 = neutral, no evidence of good or bad calibration yet.
 */
const EMPTY_ANALYSIS_DEFAULT_SCORE = 0.5;

/**
 * Calibration metric rounding precision multiplier.
 * Rounds ECE and Brier Score to 4 decimal places (0.0001 precision).
 * Formula: Math.round(value * 10000) / 10000
 *
 * Examples:
 * - ECE 0.123456 → 0.1235 (well-calibrated, 12.35% error)
 * - Brier Score 0.089123 → 0.0891 (low prediction error)
 *
 * @constant 10000 = 4 decimal places (0.0001 precision)
 */
const CALIBRATION_METRIC_ROUNDING_PRECISION = 10000;

/**
 * Confidence gap threshold for overconfidence classification.
 * Bucket considered overconfident if avgConfidence > actualWinRate + 5%.
 */
const CONFIDENCE_GAP_THRESHOLD_OVERCONFIDENT = 0.05;

/**
 * Confidence gap threshold for underconfidence classification.
 * Bucket considered underconfident if avgConfidence < actualWinRate - 5%.
 */
const CONFIDENCE_GAP_THRESHOLD_UNDERCONFIDENT = 0.05;

/**
 * ECE score multiplier for aggregate calibration score.
 * Converts ECE (0-0.2) to score component (1.0 to 0.0).
 * 0.2 ECE maps to 0.0 score (terrible calibration).
 */
const ECE_SCORE_MULTIPLIER = 5;

/**
 * Brier score multiplier for aggregate calibration score.
 * Converts Brier (0-0.25) to score component (1.0 to 0.0).
 * 0.25 Brier maps to 0.0 score (random guessing).
 */
const BRIER_SCORE_MULTIPLIER = 4;

/**
 * Monotonic bonus for aggregate calibration score.
 * Adds 0.1 to score if win rates increase with confidence.
 * Rewards agents with logically consistent confidence predictions.
 */
const MONOTONIC_BONUS = 0.1;

/**
 * ECE component weight in aggregate calibration score.
 * 50% weight = ECE is primary calibration quality indicator.
 */
const ECE_SCORE_WEIGHT = 0.5;

/**
 * Brier score component weight in aggregate calibration score.
 * 40% weight = Brier score is secondary quality indicator.
 */
const BRIER_SCORE_WEIGHT = 0.4;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CalibrationSample {
  agentId: string;
  confidence: number;   // 0-1: agent's self-reported confidence
  outcome: boolean;     // true = trade was profitable
  pnlPercent: number;   // actual P&L percentage
  timestamp: number;    // Unix ms
}

export interface CalibrationBucket {
  /** Lower bound of confidence range (inclusive) */
  lower: number;
  /** Upper bound of confidence range (exclusive) */
  upper: number;
  /** Average confidence in this bucket */
  avgConfidence: number;
  /** Actual win rate in this bucket */
  actualWinRate: number;
  /** Number of samples */
  count: number;
  /** Gap: |avgConfidence - actualWinRate| */
  gap: number;
}

export interface CalibrationReport {
  agentId: string;
  /** Expected Calibration Error: weighted average of bucket gaps */
  ece: number;
  /** Brier Score: mean squared error of probabilistic forecasts */
  brierScore: number;
  /** Reliability diagram buckets */
  buckets: CalibrationBucket[];
  /** Overall diagnosis */
  diagnosis: "well_calibrated" | "overconfident" | "underconfident" | "erratic";
  /** Fraction of trades where confidence > win rate */
  overconfidenceRate: number;
  /** Fraction of trades where confidence < win rate */
  underconfidenceRate: number;
  /** Total samples analyzed */
  sampleCount: number;
  /** Monotonicity: do higher confidence buckets have higher win rates? */
  isMonotonic: boolean;
  /** Temporal trend: is calibration improving or degrading? */
  trend: "improving" | "degrading" | "stable";
  /** Aggregate calibration score 0-1 (1 = perfectly calibrated) */
  score: number;
}

// ---------------------------------------------------------------------------
// In-memory storage (per-agent sliding windows)
// ---------------------------------------------------------------------------

const agentSamples = new Map<string, CalibrationSample[]>();

/**
 * Record a calibration sample after a trade outcome is known.
 */
export function recordCalibrationSample(sample: CalibrationSample): void {
  const existing = agentSamples.get(sample.agentId) ?? [];
  existing.push(sample);
  if (existing.length > MAX_SAMPLES) {
    existing.splice(0, existing.length - MAX_SAMPLES);
  }
  agentSamples.set(sample.agentId, existing);
}

/**
 * Get raw samples for an agent (for debugging / export).
 */
export function getCalibrationSamples(agentId: string): CalibrationSample[] {
  return agentSamples.get(agentId) ?? [];
}

// ---------------------------------------------------------------------------
// Core Calibration Computation
// ---------------------------------------------------------------------------

/**
 * Build calibration buckets from samples.
 * Divides confidence range [0, 1] into NUM_BUCKETS equal bins.
 */
function buildBuckets(samples: CalibrationSample[]): CalibrationBucket[] {
  const buckets: CalibrationBucket[] = [];
  const step = 1 / NUM_BUCKETS;

  for (let i = 0; i < NUM_BUCKETS; i++) {
    const lower = i * step;
    const upper = (i + 1) * step;

    const inBucket = samples.filter(
      (s) => s.confidence >= lower && (i === NUM_BUCKETS - 1 ? s.confidence <= upper : s.confidence < upper),
    );

    if (inBucket.length === 0) {
      buckets.push({ lower, upper, avgConfidence: (lower + upper) / 2, actualWinRate: 0, count: 0, gap: 0 });
      continue;
    }

    const avgConfidence = inBucket.reduce((s, x) => s + x.confidence, 0) / inBucket.length;
    const wins = inBucket.filter((s) => s.outcome).length;
    const actualWinRate = wins / inBucket.length;
    const gap = Math.abs(avgConfidence - actualWinRate);

    buckets.push({ lower, upper, avgConfidence, actualWinRate, count: inBucket.length, gap });
  }

  return buckets;
}

/**
 * Compute Expected Calibration Error.
 * ECE = sum(|bucket_count / total| * |avg_confidence - actual_win_rate|)
 */
function computeECE(buckets: CalibrationBucket[], totalSamples: number): number {
  if (totalSamples === 0) return 0;

  let ece = 0;
  for (const bucket of buckets) {
    if (bucket.count === 0) continue;
    const weight = bucket.count / totalSamples;
    ece += weight * bucket.gap;
  }

  return Math.round(ece * CALIBRATION_METRIC_ROUNDING_PRECISION) / CALIBRATION_METRIC_ROUNDING_PRECISION;
}

/**
 * Compute Brier Score.
 * BS = (1/n) * sum((confidence - outcome)^2)
 * where outcome is 1 for win, 0 for loss.
 */
function computeBrierScore(samples: CalibrationSample[]): number {
  if (samples.length === 0) return 0;

  let sum = 0;
  for (const s of samples) {
    const outcome = s.outcome ? 1 : 0;
    sum += (s.confidence - outcome) ** 2;
  }

  return Math.round((sum / samples.length) * CALIBRATION_METRIC_ROUNDING_PRECISION) / CALIBRATION_METRIC_ROUNDING_PRECISION;
}

/**
 * Check if win rates are monotonically increasing across confidence buckets.
 * A well-calibrated agent should have higher win rates at higher confidence.
 */
function checkMonotonicity(buckets: CalibrationBucket[]): boolean {
  const nonEmpty = buckets.filter((b) => b.count > 0);
  if (nonEmpty.length < 2) return true;

  for (let i = 1; i < nonEmpty.length; i++) {
    if (nonEmpty[i].actualWinRate < nonEmpty[i - 1].actualWinRate - MONOTONICITY_TOLERANCE) {
      return false;
    }
  }
  return true;
}

/**
 * Detect calibration trend by comparing first half vs second half of samples.
 */
function detectTrend(samples: CalibrationSample[]): "improving" | "degrading" | "stable" {
  if (samples.length < MIN_SAMPLES_FOR_TREND) return "stable";

  const sorted = [...samples].sort((a, b) => a.timestamp - b.timestamp);
  const mid = Math.floor(sorted.length / 2);
  const firstHalf = sorted.slice(0, mid);
  const secondHalf = sorted.slice(mid);

  const eceFirst = computeECE(buildBuckets(firstHalf), firstHalf.length);
  const eceSecond = computeECE(buildBuckets(secondHalf), secondHalf.length);

  const diff = eceSecond - eceFirst;
  if (diff < TREND_IMPROVEMENT_THRESHOLD) return "improving";
  if (diff > TREND_DEGRADING_THRESHOLD) return "degrading";
  return "stable";
}

/**
 * Diagnose overall calibration pattern.
 */
function diagnose(
  buckets: CalibrationBucket[],
  overconfidenceRate: number,
  underconfidenceRate: number,
  ece: number,
): CalibrationReport["diagnosis"] {
  if (ece < ECE_WELL_CALIBRATED_THRESHOLD) return "well_calibrated";
  if (overconfidenceRate > OVERCONFIDENCE_HIGH_THRESHOLD) return "overconfident";
  if (underconfidenceRate > UNDERCONFIDENCE_HIGH_THRESHOLD) return "underconfident";
  return "erratic";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a full calibration report for an agent.
 */
export function generateCalibrationReport(agentId: string): CalibrationReport {
  const samples = agentSamples.get(agentId) ?? [];

  if (samples.length === 0) {
    return {
      agentId,
      ece: 0,
      brierScore: 0,
      buckets: buildBuckets([]),
      diagnosis: "stable" as CalibrationReport["diagnosis"],
      overconfidenceRate: 0,
      underconfidenceRate: 0,
      sampleCount: 0,
      isMonotonic: true,
      trend: "stable",
      score: EMPTY_ANALYSIS_DEFAULT_SCORE,
    };
  }

  const buckets = buildBuckets(samples);
  const ece = computeECE(buckets, samples.length);
  const brierScore = computeBrierScore(samples);
  const isMonotonic = checkMonotonicity(buckets);
  const trend = detectTrend(samples);

  // Compute over/under confidence rates
  const nonEmptyBuckets = buckets.filter((b) => b.count > 0);
  const overconfident = nonEmptyBuckets.filter((b) => b.avgConfidence > b.actualWinRate + CONFIDENCE_GAP_THRESHOLD_OVERCONFIDENT);
  const underconfident = nonEmptyBuckets.filter((b) => b.avgConfidence < b.actualWinRate - CONFIDENCE_GAP_THRESHOLD_UNDERCONFIDENT);
  const overconfidenceRate = nonEmptyBuckets.length > 0 ? overconfident.length / nonEmptyBuckets.length : 0;
  const underconfidenceRate = nonEmptyBuckets.length > 0 ? underconfident.length / nonEmptyBuckets.length : 0;

  const diagnosis = diagnose(buckets, overconfidenceRate, underconfidenceRate, ece);

  // Compute aggregate score: 1.0 = perfect, 0.0 = terrible
  // Factors: low ECE, low Brier, monotonic, not erratic
  const eceScore = Math.max(0, 1 - ece * ECE_SCORE_MULTIPLIER);
  const brierPenalty = Math.max(0, 1 - brierScore * BRIER_SCORE_MULTIPLIER);
  const monotonicBonus = isMonotonic ? MONOTONIC_BONUS : 0;
  const score = round2(Math.min(1, eceScore * ECE_SCORE_WEIGHT + brierPenalty * BRIER_SCORE_WEIGHT + monotonicBonus));

  return {
    agentId,
    ece,
    brierScore,
    buckets,
    diagnosis,
    overconfidenceRate: round2(overconfidenceRate),
    underconfidenceRate: round2(underconfidenceRate),
    sampleCount: samples.length,
    isMonotonic,
    trend,
    score,
  };
}

/**
 * Generate calibration reports for all tracked agents.
 */
export function getAllCalibrationReports(): CalibrationReport[] {
  const reports: CalibrationReport[] = [];
  for (const agentId of agentSamples.keys()) {
    reports.push(generateCalibrationReport(agentId));
  }
  return reports;
}

/**
 * Get a summary of calibration across all agents.
 */
export function getCalibrationSummary(): {
  agentCount: number;
  totalSamples: number;
  avgECE: number;
  avgBrierScore: number;
  bestCalibrated: string | null;
  worstCalibrated: string | null;
} {
  const reports = getAllCalibrationReports();
  if (reports.length === 0) {
    return { agentCount: 0, totalSamples: 0, avgECE: 0, avgBrierScore: 0, bestCalibrated: null, worstCalibrated: null };
  }

  const totalSamples = reports.reduce((s, r) => s + r.sampleCount, 0);
  const avgECE = reports.reduce((s, r) => s + r.ece, 0) / reports.length;
  const avgBrierScore = reports.reduce((s, r) => s + r.brierScore, 0) / reports.length;

  const sorted = [...reports].sort((a, b) => a.ece - b.ece);
  const bestCalibrated = sorted[0]?.agentId ?? null;
  const worstCalibrated = sorted[sorted.length - 1]?.agentId ?? null;

  return {
    agentCount: reports.length,
    totalSamples,
    avgECE: Math.round(avgECE * CALIBRATION_METRIC_ROUNDING_PRECISION) / CALIBRATION_METRIC_ROUNDING_PRECISION,
    avgBrierScore: Math.round(avgBrierScore * CALIBRATION_METRIC_ROUNDING_PRECISION) / CALIBRATION_METRIC_ROUNDING_PRECISION,
    bestCalibrated,
    worstCalibrated,
  };
}
