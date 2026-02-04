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

const MAX_SAMPLES = 500;
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

const NUM_BUCKETS = 10;

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

  return Math.round(ece * 10000) / 10000;
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

  return Math.round((sum / samples.length) * 10000) / 10000;
}

/**
 * Check if win rates are monotonically increasing across confidence buckets.
 * A well-calibrated agent should have higher win rates at higher confidence.
 */
function checkMonotonicity(buckets: CalibrationBucket[]): boolean {
  const nonEmpty = buckets.filter((b) => b.count > 0);
  if (nonEmpty.length < 2) return true;

  for (let i = 1; i < nonEmpty.length; i++) {
    if (nonEmpty[i].actualWinRate < nonEmpty[i - 1].actualWinRate - 0.05) {
      // Allow 5% tolerance for noise
      return false;
    }
  }
  return true;
}

/**
 * Detect calibration trend by comparing first half vs second half of samples.
 */
function detectTrend(samples: CalibrationSample[]): "improving" | "degrading" | "stable" {
  if (samples.length < 20) return "stable";

  const sorted = [...samples].sort((a, b) => a.timestamp - b.timestamp);
  const mid = Math.floor(sorted.length / 2);
  const firstHalf = sorted.slice(0, mid);
  const secondHalf = sorted.slice(mid);

  const eceFirst = computeECE(buildBuckets(firstHalf), firstHalf.length);
  const eceSecond = computeECE(buildBuckets(secondHalf), secondHalf.length);

  const diff = eceSecond - eceFirst;
  if (diff < -0.03) return "improving";  // ECE decreased = better calibration
  if (diff > 0.03) return "degrading";   // ECE increased = worse calibration
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
  if (ece < 0.08) return "well_calibrated";
  if (overconfidenceRate > 0.6) return "overconfident";
  if (underconfidenceRate > 0.6) return "underconfident";
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
      score: 0.5,
    };
  }

  const buckets = buildBuckets(samples);
  const ece = computeECE(buckets, samples.length);
  const brierScore = computeBrierScore(samples);
  const isMonotonic = checkMonotonicity(buckets);
  const trend = detectTrend(samples);

  // Compute over/under confidence rates
  const nonEmptyBuckets = buckets.filter((b) => b.count > 0);
  const overconfident = nonEmptyBuckets.filter((b) => b.avgConfidence > b.actualWinRate + 0.05);
  const underconfident = nonEmptyBuckets.filter((b) => b.avgConfidence < b.actualWinRate - 0.05);
  const overconfidenceRate = nonEmptyBuckets.length > 0 ? overconfident.length / nonEmptyBuckets.length : 0;
  const underconfidenceRate = nonEmptyBuckets.length > 0 ? underconfident.length / nonEmptyBuckets.length : 0;

  const diagnosis = diagnose(buckets, overconfidenceRate, underconfidenceRate, ece);

  // Compute aggregate score: 1.0 = perfect, 0.0 = terrible
  // Factors: low ECE, low Brier, monotonic, not erratic
  const eceScore = Math.max(0, 1 - ece * 5);      // 0.2 ECE = 0.0 score
  const brierPenalty = Math.max(0, 1 - brierScore * 4);
  const monotonicBonus = isMonotonic ? 0.1 : 0;
  const score = Math.round(Math.min(1, (eceScore * 0.5 + brierPenalty * 0.4 + monotonicBonus)) * 100) / 100;

  return {
    agentId,
    ece,
    brierScore,
    buckets,
    diagnosis,
    overconfidenceRate: Math.round(overconfidenceRate * 100) / 100,
    underconfidenceRate: Math.round(underconfidenceRate * 100) / 100,
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
    avgECE: Math.round(avgECE * 10000) / 10000,
    avgBrierScore: Math.round(avgBrierScore * 10000) / 10000,
    bestCalibrated,
    worstCalibrated,
  };
}
