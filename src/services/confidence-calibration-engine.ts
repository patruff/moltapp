/**
 * Confidence Calibration Engine
 *
 * Advanced analysis of how well AI agents' confidence scores predict
 * actual trade outcomes. A perfectly calibrated agent would have:
 * - 70% of trades at 0.7 confidence result in profit
 * - 30% of trades at 0.3 confidence result in profit
 *
 * This is a key benchmark metric because it measures self-awareness —
 * does the agent actually know what it knows?
 *
 * Metrics computed:
 * - Expected Calibration Error (ECE)
 * - Brier Score
 * - Reliability Diagram data
 * - Overconfidence / Underconfidence detection
 * - Calibration trend over time
 */

import { round4 } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CalibrationResult {
  /** Agent ID */
  agentId: string;
  /** Expected Calibration Error (lower is better, 0 = perfectly calibrated) */
  ece: number;
  /** Brier Score (lower is better, 0-1) */
  brierScore: number;
  /** Maximum Calibration Error (worst bucket) */
  mce: number;
  /** Whether agent tends to be overconfident */
  overconfident: boolean;
  /** Whether agent tends to be underconfident */
  underconfident: boolean;
  /** Average overconfidence amount */
  avgOverconfidence: number;
  /** Reliability diagram data (for visualization) */
  reliabilityDiagram: CalibrationBucket[];
  /** Total data points used */
  totalSamples: number;
  /** Calibration grade */
  grade: string;
}

export interface CalibrationBucket {
  /** Confidence range midpoint */
  confidenceMid: number;
  /** Lower bound of confidence range */
  confidenceLow: number;
  /** Upper bound of confidence range */
  confidenceHigh: number;
  /** Actual win rate in this bucket */
  actualWinRate: number;
  /** Average confidence in this bucket */
  avgConfidence: number;
  /** Number of samples in this bucket */
  count: number;
  /** Calibration gap (avgConfidence - actualWinRate) */
  gap: number;
}

export interface CalibrationTrendPoint {
  /** Period identifier (e.g., round batch, day) */
  period: string;
  /** ECE for this period */
  ece: number;
  /** Brier score for this period */
  brierScore: number;
  /** Number of samples in this period */
  sampleCount: number;
}

export interface OutcomeRecord {
  agentId: string;
  confidence: number; // 0-1
  isProfit: boolean; // true if trade was profitable
  pnlPercent: number; // actual P&L percentage
  timestamp: string;
  roundId?: string;
}

// ---------------------------------------------------------------------------
// In-Memory Storage
// ---------------------------------------------------------------------------

const outcomeStore: Map<string, OutcomeRecord[]> = new Map();
const MAX_OUTCOMES_PER_AGENT = 500;

/**
 * Record a trade outcome for calibration tracking.
 */
export function recordOutcomeForCalibration(record: OutcomeRecord): void {
  const list = outcomeStore.get(record.agentId) ?? [];
  list.push(record);
  if (list.length > MAX_OUTCOMES_PER_AGENT) {
    list.shift();
  }
  outcomeStore.set(record.agentId, list);
}

/**
 * Batch-record outcomes (for bulk import from DB).
 */
export function batchRecordOutcomes(records: OutcomeRecord[]): void {
  for (const record of records) {
    recordOutcomeForCalibration(record);
  }
}

// ---------------------------------------------------------------------------
// Core Calibration Analysis
// ---------------------------------------------------------------------------

/**
 * Compute the full calibration analysis for an agent.
 *
 * @param agentId - Agent to analyze (null for all agents combined)
 * @param numBuckets - Number of confidence buckets (default 10)
 */
export function computeCalibration(
  agentId: string | null = null,
  numBuckets = 10,
): CalibrationResult {
  // Gather outcomes
  let outcomes: OutcomeRecord[];
  if (agentId) {
    outcomes = outcomeStore.get(agentId) ?? [];
  } else {
    outcomes = [];
    for (const records of outcomeStore.values()) {
      outcomes.push(...records);
    }
  }

  const resolvedAgentId = agentId ?? "all_agents";

  if (outcomes.length < 5) {
    return {
      agentId: resolvedAgentId,
      ece: 0,
      brierScore: 0,
      mce: 0,
      overconfident: false,
      underconfident: false,
      avgOverconfidence: 0,
      reliabilityDiagram: [],
      totalSamples: outcomes.length,
      grade: "N/A",
    };
  }

  // Build reliability diagram buckets
  const bucketSize = 1 / numBuckets;
  const buckets: CalibrationBucket[] = [];

  for (let i = 0; i < numBuckets; i++) {
    const low = i * bucketSize;
    const high = (i + 1) * bucketSize;
    const mid = (low + high) / 2;

    const inBucket = outcomes.filter(
      (o) => o.confidence >= low && (i === numBuckets - 1 ? o.confidence <= high : o.confidence < high),
    );

    if (inBucket.length === 0) {
      buckets.push({
        confidenceMid: round4(mid),
        confidenceLow: round4(low),
        confidenceHigh: round4(high),
        actualWinRate: 0,
        avgConfidence: round4(mid),
        count: 0,
        gap: 0,
      });
      continue;
    }

    const winCount = inBucket.filter((o) => o.isProfit).length;
    const actualWinRate = winCount / inBucket.length;
    const avgConfidence = inBucket.reduce((s, o) => s + o.confidence, 0) / inBucket.length;

    buckets.push({
      confidenceMid: round4(mid),
      confidenceLow: round4(low),
      confidenceHigh: round4(high),
      actualWinRate: round4(actualWinRate),
      avgConfidence: round4(avgConfidence),
      count: inBucket.length,
      gap: round4(avgConfidence - actualWinRate),
    });
  }

  // Compute ECE (Expected Calibration Error)
  // ECE = sum(|fraction in bucket| * |avgConfidence - actualWinRate|)
  const n = outcomes.length;
  let ece = 0;
  let mce = 0;
  let overconfidenceSum = 0;
  let overconfidenceBuckets = 0;

  for (const bucket of buckets) {
    if (bucket.count === 0) continue;
    const weight = bucket.count / n;
    const absGap = Math.abs(bucket.gap);
    ece += weight * absGap;
    if (absGap > mce) mce = absGap;

    if (bucket.gap > 0) {
      overconfidenceSum += bucket.gap;
      overconfidenceBuckets++;
    }
  }

  // Compute Brier Score
  // Brier = (1/n) * sum((confidence - isProfit)^2)
  let brierSum = 0;
  for (const o of outcomes) {
    const outcome = o.isProfit ? 1 : 0;
    brierSum += (o.confidence - outcome) ** 2;
  }
  const brierScore = brierSum / n;

  const avgOverconfidence = overconfidenceBuckets > 0 ? overconfidenceSum / overconfidenceBuckets : 0;
  const nonEmptyBuckets = buckets.filter((b) => b.count > 0);
  const overconfidentBuckets = nonEmptyBuckets.filter((b) => b.gap > 0.05).length;
  const underconfidentBuckets = nonEmptyBuckets.filter((b) => b.gap < -0.05).length;

  return {
    agentId: resolvedAgentId,
    ece: round4(ece),
    brierScore: round4(brierScore),
    mce: round4(mce),
    overconfident: overconfidentBuckets > underconfidentBuckets,
    underconfident: underconfidentBuckets > overconfidentBuckets,
    avgOverconfidence: round4(avgOverconfidence),
    reliabilityDiagram: buckets,
    totalSamples: n,
    grade: calibrationGrade(ece),
  };
}

// ---------------------------------------------------------------------------
// Calibration Trend
// ---------------------------------------------------------------------------

/**
 * Compute calibration trend over time for an agent.
 * Groups outcomes into batches and computes ECE for each.
 */
export function computeCalibrationTrend(
  agentId: string,
  batchSize = 20,
): CalibrationTrendPoint[] {
  const outcomes = outcomeStore.get(agentId) ?? [];
  if (outcomes.length < batchSize) return [];

  const trend: CalibrationTrendPoint[] = [];
  const sorted = [...outcomes].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  for (let i = 0; i <= sorted.length - batchSize; i += Math.max(1, Math.floor(batchSize / 2))) {
    const batch = sorted.slice(i, i + batchSize);
    const n = batch.length;

    // Quick ECE computation
    const bucketSize = 0.2; // 5 buckets for trend
    let ece = 0;
    let brierSum = 0;

    for (let b = 0; b < 5; b++) {
      const low = b * bucketSize;
      const high = (b + 1) * bucketSize;
      const inBucket = batch.filter(
        (o) => o.confidence >= low && (b === 4 ? o.confidence <= high : o.confidence < high),
      );
      if (inBucket.length === 0) continue;

      const winRate = inBucket.filter((o) => o.isProfit).length / inBucket.length;
      const avgConf = inBucket.reduce((s, o) => s + o.confidence, 0) / inBucket.length;
      ece += (inBucket.length / n) * Math.abs(avgConf - winRate);
    }

    for (const o of batch) {
      brierSum += (o.confidence - (o.isProfit ? 1 : 0)) ** 2;
    }

    trend.push({
      period: batch[0].timestamp.split("T")[0],
      ece: round4(ece),
      brierScore: round4(brierSum / n),
      sampleCount: n,
    });
  }

  return trend;
}

// ---------------------------------------------------------------------------
// Comparative Calibration
// ---------------------------------------------------------------------------

/**
 * Compare calibration quality across all agents.
 */
export function compareCalibrations(): {
  agents: CalibrationResult[];
  bestCalibrated: string | null;
  worstCalibrated: string | null;
  avgEce: number;
} {
  const agentIds = Array.from(outcomeStore.keys());
  const results = agentIds.map((id) => computeCalibration(id));

  const withData = results.filter((r) => r.totalSamples >= 5);
  const avgEce = withData.length > 0
    ? withData.reduce((s, r) => s + r.ece, 0) / withData.length
    : 0;

  const sorted = [...withData].sort((a, b) => a.ece - b.ece);

  return {
    agents: results,
    bestCalibrated: sorted[0]?.agentId ?? null,
    worstCalibrated: sorted[sorted.length - 1]?.agentId ?? null,
    avgEce: round4(avgEce),
  };
}

/**
 * Get raw outcome data for an agent (for external analysis).
 */
export function getOutcomeData(agentId?: string): OutcomeRecord[] {
  if (agentId) {
    return outcomeStore.get(agentId) ?? [];
  }
  const all: OutcomeRecord[] = [];
  for (const records of outcomeStore.values()) {
    all.push(...records);
  }
  return all;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function calibrationGrade(ece: number): string {
  if (ece <= 0.02) return "A+";
  if (ece <= 0.05) return "A";
  if (ece <= 0.08) return "A-";
  if (ece <= 0.10) return "B+";
  if (ece <= 0.13) return "B";
  if (ece <= 0.16) return "B-";
  if (ece <= 0.20) return "C+";
  if (ece <= 0.25) return "C";
  if (ece <= 0.30) return "C-";
  if (ece <= 0.35) return "D";
  return "F";
}

// round4 imported from ../lib/math-utils.ts
