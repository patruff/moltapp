/**
 * Benchmark Regression Detector (v18)
 *
 * Monitors benchmark quality over time and detects regressions in agent
 * performance, scoring accuracy, and data integrity. This is the
 * "benchmark health" pillar — does the benchmark itself maintain quality?
 *
 * Detections:
 * 1. SCORING DRIFT: Are composite scores shifting without real changes?
 * 2. PILLAR IMBALANCE: Is one pillar dominating the composite disproportionately?
 * 3. AGENT CONVERGENCE: Are all agents converging to similar scores? (bad for benchmark)
 * 4. DATA STALENESS: Are reasoning patterns becoming repetitive over time?
 * 5. CALIBRATION DECAY: Is confidence calibration getting worse over time?
 */

import { round3, sortEntriesDescending, computeStdDev } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RegressionAlert {
  id: string;
  type: RegressionType;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  metric: string;
  expectedRange: [number, number];
  actualValue: number;
  recommendation: string;
  timestamp: string;
}

export type RegressionType =
  | "scoring_drift"
  | "pillar_imbalance"
  | "agent_convergence"
  | "data_staleness"
  | "calibration_decay"
  | "coherence_inflation"
  | "hallucination_spike"
  | "reasoning_length_drift";

export interface BenchmarkHealthSnapshot {
  timestamp: string;
  agentScores: Record<string, number>;
  pillarAverages: Record<string, number>;
  coherenceAvg: number;
  hallucinationRate: number;
  avgReasoningLength: number;
  agentScoreSpread: number; // Std dev of agent composite scores
  calibrationAvg: number;
}

export interface BenchmarkHealthReport {
  overallHealth: number;
  status: "healthy" | "warning" | "degraded" | "critical";
  activeAlerts: RegressionAlert[];
  snapshotCount: number;
  dimensions: {
    scoringStability: number;
    pillarBalance: number;
    agentDiversity: number;
    dataFreshness: number;
    calibrationQuality: number;
  };
  recommendations: string[];
  trend: "improving" | "stable" | "declining";
  lastUpdated: string;
}

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Minimum Snapshot Thresholds
 * Defines minimum data requirements for meaningful regression detection.
 */

/**
 * Minimum snapshots required for regression detection.
 * At least 5 snapshots needed to compute baseline and detect drift.
 */
const MIN_SNAPSHOTS_FOR_DETECTION = 5;

/**
 * Scoring Drift Detection Thresholds
 * Controls sensitivity of composite score drift alerts.
 */

/**
 * Moderate scoring drift threshold (15% change).
 * Composite score shifts >15% trigger medium severity alerts.
 * Example: Scores shifting from 0.70 → 0.82 indicates scoring formula drift.
 */
const SCORING_DRIFT_MODERATE_THRESHOLD = 0.15;

/**
 * High severity scoring drift threshold (25% change).
 * Composite score shifts >25% trigger high severity alerts.
 * Example: Scores shifting from 0.70 → 0.88 indicates major methodology change.
 */
const SCORING_DRIFT_HIGH_THRESHOLD = 0.25;

/**
 * Expected scoring drift range (±10%).
 * Normal variation in composite scores should stay within this band.
 */
const SCORING_DRIFT_EXPECTED_RANGE = 0.1;

/**
 * Agent Convergence Detection Thresholds
 * Controls sensitivity of agent score differentiation alerts.
 */

/**
 * Low agent convergence threshold (3% spread).
 * Agent score spread <3% triggers medium severity alerts.
 * Example: All 3 agents scoring 0.70-0.73 = poor differentiation.
 */
const AGENT_CONVERGENCE_MODERATE_THRESHOLD = 0.03;

/**
 * High severity convergence threshold (1% spread).
 * Agent score spread <1% triggers high severity alerts.
 * Example: All 3 agents scoring 0.70-0.71 = benchmark failure.
 */
const AGENT_CONVERGENCE_HIGH_THRESHOLD = 0.01;

/**
 * Expected agent score spread range (5-30%).
 * Healthy benchmarks differentiate agents by at least 5%.
 */
const AGENT_SPREAD_MIN_EXPECTED = 0.05;
const AGENT_SPREAD_MAX_EXPECTED = 0.30;

/**
 * Coherence Inflation Detection Thresholds
 * Controls sensitivity of coherence gaming detection.
 */

/**
 * Coherence inflation delta threshold (15% increase).
 * Coherence increasing >15% between periods triggers alert.
 * Example: Coherence 0.70 → 0.82 suggests agents gaming the scorer.
 */
const COHERENCE_INFLATION_DELTA_THRESHOLD = 0.15;

/**
 * Coherence inflation absolute threshold (85%).
 * Coherence >85% with significant increase triggers alert.
 * Example: Coherence at 0.88 is suspiciously high for real reasoning.
 */
const COHERENCE_INFLATION_ABSOLUTE_THRESHOLD = 0.85;

/**
 * Expected coherence range (50-80%).
 * Healthy reasoning typically scores 50-80% coherence.
 */
const COHERENCE_EXPECTED_MIN = 0.5;
const COHERENCE_EXPECTED_MAX = 0.8;

/**
 * Hallucination Spike Detection Thresholds
 * Controls sensitivity of hallucination rate increase alerts.
 */

/**
 * Hallucination spike delta threshold (10% increase).
 * Hallucination rate increasing >10% triggers alert.
 * Example: Rate 0.05 → 0.16 suggests data pipeline issues.
 */
const HALLUCINATION_SPIKE_DELTA_THRESHOLD = 0.1;

/**
 * High severity hallucination threshold (30% rate).
 * Hallucination rate >30% triggers high severity alert.
 * Example: 1 in 3 claims fabricated = serious quality issue.
 */
const HALLUCINATION_SPIKE_HIGH_THRESHOLD = 0.3;

/**
 * Expected hallucination rate range (0-15%).
 * Healthy agents hallucinate <15% of claims.
 */
const HALLUCINATION_EXPECTED_MAX = 0.15;

/**
 * Reasoning Length Drift Detection Thresholds
 * Controls sensitivity of reasoning laziness detection.
 */

/**
 * Reasoning length drift threshold (40% reduction).
 * Length dropping to <60% of baseline triggers alert.
 * Example: 120 words → 65 words = agents getting lazy.
 */
const REASONING_LENGTH_DRIFT_THRESHOLD = 0.6;

/**
 * Expected reasoning length range (80-150% of baseline).
 * Normal variation allows ±20% length changes, up to +50% for detailed analysis.
 */
const REASONING_LENGTH_EXPECTED_MIN_RATIO = 0.8;
const REASONING_LENGTH_EXPECTED_MAX_RATIO = 1.5;

/**
 * Calibration Decay Detection Thresholds
 * Controls sensitivity of confidence calibration degradation alerts.
 */

/**
 * Calibration decay delta threshold (10% decrease).
 * Calibration quality dropping >10% triggers alert.
 * Example: Quality 0.65 → 0.52 suggests agents losing calibration.
 */
const CALIBRATION_DECAY_DELTA_THRESHOLD = 0.1;

/**
 * Calibration decay absolute threshold (50%).
 * Calibration <50% with significant decrease triggers alert.
 * Example: Quality at 0.42 = agents making poor confidence estimates.
 */
const CALIBRATION_DECAY_ABSOLUTE_THRESHOLD = 0.5;

/**
 * High severity calibration threshold (30%).
 * Calibration <30% triggers high severity alert.
 * Example: Quality at 0.25 = complete calibration failure.
 */
const CALIBRATION_DECAY_HIGH_THRESHOLD = 0.3;

/**
 * Expected calibration range (50-100%).
 * Healthy agents maintain >50% calibration quality.
 */
const CALIBRATION_EXPECTED_MIN = 0.5;
const CALIBRATION_EXPECTED_MAX = 1.0;

/**
 * Pillar Imbalance Detection Thresholds
 * Controls sensitivity of pillar score variation alerts.
 */

/**
 * Pillar imbalance threshold (25% std dev).
 * Pillar score std dev >25% triggers alert.
 * Example: Pillars at 0.90, 0.70, 0.40 = imbalanced scoring.
 */
const PILLAR_IMBALANCE_THRESHOLD = 0.25;

/**
 * Expected pillar balance range (0-20% std dev).
 * Healthy benchmarks keep pillar scores within 20% std dev.
 */
const PILLAR_BALANCE_EXPECTED_MAX = 0.20;

/**
 * Health Score Dimension Weights
 * Controls contribution of each dimension to overall health score.
 */

/**
 * Scoring stability weight (25%).
 * Low score drift indicates stable methodology.
 */
const HEALTH_WEIGHT_SCORING_STABILITY = 0.25;

/**
 * Pillar balance weight (20%).
 * Balanced pillar scores indicate fair composite calculation.
 */
const HEALTH_WEIGHT_PILLAR_BALANCE = 0.20;

/**
 * Agent diversity weight (25%).
 * High score spread indicates good agent differentiation.
 */
const HEALTH_WEIGHT_AGENT_DIVERSITY = 0.25;

/**
 * Data freshness weight (15%).
 * Longer reasoning indicates thoughtful analysis.
 */
const HEALTH_WEIGHT_DATA_FRESHNESS = 0.15;

/**
 * Calibration quality weight (15%).
 * Good calibration indicates accurate confidence estimates.
 */
const HEALTH_WEIGHT_CALIBRATION_QUALITY = 0.15;

/**
 * Health Score Normalization Parameters
 * Controls how raw metrics map to 0-1 health scores.
 */

/**
 * Scoring stability drift multiplier (5×).
 * Converts avg drift to stability score: 1 - (avgDrift × 5).
 * Example: 0.02 avg drift → 0.90 stability score.
 */
const HEALTH_SCORING_STABILITY_DRIFT_MULTIPLIER = 5;

/**
 * Pillar balance std dev multiplier (3×).
 * Converts pillar std dev to balance score: 1 - (stdDev × 3).
 * Example: 0.10 std dev → 0.70 balance score.
 */
const HEALTH_PILLAR_BALANCE_STDDEV_MULTIPLIER = 3;

/**
 * Agent diversity spread multiplier (10×).
 * Converts agent score spread to diversity score: min(1, spread × 10).
 * Example: 0.08 spread → 0.80 diversity score.
 */
const HEALTH_AGENT_DIVERSITY_SPREAD_MULTIPLIER = 10;

/**
 * Data freshness baseline word count (80 words).
 * Converts avg reasoning length to freshness score: min(1, length / 80).
 * Example: 64 words → 0.80 freshness score, 120 words → 1.00 (capped).
 */
const HEALTH_DATA_FRESHNESS_BASELINE_WORDS = 80;

/**
 * Health Status Recommendation Thresholds
 * Controls when specific recommendations are triggered.
 */

/**
 * Agent diversity low threshold (30%).
 * Diversity <30% triggers differentiation recommendation.
 */
const RECOMMENDATION_AGENT_DIVERSITY_LOW = 0.3;

/**
 * Scoring stability low threshold (50%).
 * Stability <50% triggers methodology review recommendation.
 */
const RECOMMENDATION_SCORING_STABILITY_LOW = 0.5;

/**
 * Data freshness low threshold (50%).
 * Freshness <50% triggers prompt engineering recommendation.
 */
const RECOMMENDATION_DATA_FRESHNESS_LOW = 0.5;

/**
 * Calibration quality low threshold (40%).
 * Calibration <40% triggers feedback recommendation.
 */
const RECOMMENDATION_CALIBRATION_QUALITY_LOW = 0.4;

/**
 * Health Trend Detection Thresholds
 * Controls sensitivity of improving/declining trend classification.
 */

/**
 * Trend detection threshold (±5%).
 * Coherence change >±5% between halves classifies as improving/declining.
 * Example: 0.65 → 0.71 = improving, 0.65 → 0.59 = declining.
 */
const HEALTH_TREND_THRESHOLD = 0.05;

/**
 * Query and Display Limits
 * Controls data retention and output sizes.
 */

/**
 * Recent snapshots window size (10 snapshots).
 * Most regression checks use last 10 snapshots as "recent" period.
 */
const RECENT_SNAPSHOTS_WINDOW = 10;

/**
 * Older snapshots window size (20 snapshots).
 * Regression checks compare recent 10 vs older 20 snapshots.
 * Actual range: snapshots[-30:-10] (20 snapshots total).
 */
const OLDER_SNAPSHOTS_WINDOW_START = 30;
const OLDER_SNAPSHOTS_WINDOW_END = 10;

/**
 * Active alerts display limit (20 alerts).
 * Health report returns last 20 active alerts.
 */
const HEALTH_REPORT_ALERTS_DISPLAY_LIMIT = 20;

/**
 * Alerts query limit (50 alerts).
 * getActiveAlerts() returns last 50 alerts.
 */
const ACTIVE_ALERTS_QUERY_LIMIT = 50;

/**
 * Snapshot history query limit (100 snapshots).
 * getHealthSnapshotHistory() returns last 100 snapshots.
 */
const SNAPSHOT_HISTORY_QUERY_LIMIT = 100;

/**
 * Health status alert count thresholds.
 * Controls status classification based on alert counts.
 */

/**
 * Critical status alert threshold (3+ high/critical alerts).
 * Status = "critical" when 3+ high/critical severity alerts active.
 */
const STATUS_CRITICAL_ALERT_THRESHOLD = 3;

/**
 * Degraded status alert threshold (1+ high/critical alerts).
 * Status = "degraded" when 1+ high/critical severity alerts active.
 */
const STATUS_DEGRADED_ALERT_THRESHOLD = 1;

/**
 * Warning status alert threshold (3+ total alerts).
 * Status = "warning" when >3 alerts of any severity active.
 */
const STATUS_WARNING_ALERT_THRESHOLD = 3;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const healthSnapshots: BenchmarkHealthSnapshot[] = [];
const activeAlerts: RegressionAlert[] = [];
const MAX_SNAPSHOTS = 200;
const MAX_ALERTS = 100;

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

/**
 * Record a benchmark health snapshot after a trading round.
 */
export function recordBenchmarkHealthSnapshot(snapshot: BenchmarkHealthSnapshot): void {
  healthSnapshots.push(snapshot);
  if (healthSnapshots.length > MAX_SNAPSHOTS) {
    healthSnapshots.splice(0, healthSnapshots.length - MAX_SNAPSHOTS);
  }

  // Run detection suite
  const newAlerts = detectRegressions(snapshot);
  for (const alert of newAlerts) {
    activeAlerts.push(alert);
    if (activeAlerts.length > MAX_ALERTS) activeAlerts.splice(0, activeAlerts.length - MAX_ALERTS);
  }
}

// ---------------------------------------------------------------------------
// Regression Detection Suite
// ---------------------------------------------------------------------------

function detectRegressions(snapshot: BenchmarkHealthSnapshot): RegressionAlert[] {
  const alerts: RegressionAlert[] = [];

  if (healthSnapshots.length < MIN_SNAPSHOTS_FOR_DETECTION) return alerts;

  const recent = healthSnapshots.slice(-RECENT_SNAPSHOTS_WINDOW);
  const older = healthSnapshots.slice(-OLDER_SNAPSHOTS_WINDOW_START, -OLDER_SNAPSHOTS_WINDOW_END);

  if (older.length < MIN_SNAPSHOTS_FOR_DETECTION) return alerts;

  // 1. Scoring Drift: detect if average scores are shifting without explanation
  const recentAvgScores = computeAvgMetric(recent, (s) => {
    const vals = Object.values(s.agentScores);
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  });
  const olderAvgScores = computeAvgMetric(older, (s) => {
    const vals = Object.values(s.agentScores);
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  });

  const scoreDrift = Math.abs(recentAvgScores - olderAvgScores);
  if (scoreDrift > SCORING_DRIFT_MODERATE_THRESHOLD) {
    alerts.push({
      id: `reg_${Date.now()}_drift`,
      type: "scoring_drift",
      severity: scoreDrift > SCORING_DRIFT_HIGH_THRESHOLD ? "high" : "medium",
      description: `Composite scores shifted by ${(scoreDrift * 100).toFixed(1)}% — may indicate scoring formula drift or data quality change`,
      metric: "avg_composite_score",
      expectedRange: [olderAvgScores - SCORING_DRIFT_EXPECTED_RANGE, olderAvgScores + SCORING_DRIFT_EXPECTED_RANGE],
      actualValue: recentAvgScores,
      recommendation: "Review recent scoring weight changes or data pipeline for anomalies",
      timestamp: new Date().toISOString(),
    });
  }

  // 2. Agent Convergence: all agents scoring similarly = bad differentiation
  const recentSpread = computeAvgMetric(recent, (s) => s.agentScoreSpread);
  if (recentSpread < AGENT_CONVERGENCE_MODERATE_THRESHOLD) {
    alerts.push({
      id: `reg_${Date.now()}_conv`,
      type: "agent_convergence",
      severity: recentSpread < AGENT_CONVERGENCE_HIGH_THRESHOLD ? "high" : "medium",
      description: `Agent score spread is only ${(recentSpread * 100).toFixed(1)}% — benchmark is not differentiating agents well`,
      metric: "agent_score_spread",
      expectedRange: [AGENT_SPREAD_MIN_EXPECTED, AGENT_SPREAD_MAX_EXPECTED],
      actualValue: recentSpread,
      recommendation: "Increase weight of differentiating pillars (financial, battle, patterns)",
      timestamp: new Date().toISOString(),
    });
  }

  // 3. Coherence Inflation: coherence scores creeping up artificially
  const recentCoherence = computeAvgMetric(recent, (s) => s.coherenceAvg);
  const olderCoherence = computeAvgMetric(older, (s) => s.coherenceAvg);
  if (recentCoherence > olderCoherence + COHERENCE_INFLATION_DELTA_THRESHOLD && recentCoherence > COHERENCE_INFLATION_ABSOLUTE_THRESHOLD) {
    alerts.push({
      id: `reg_${Date.now()}_coh_inf`,
      type: "coherence_inflation",
      severity: "medium",
      description: `Coherence scores inflated from ${(olderCoherence * 100).toFixed(0)}% to ${(recentCoherence * 100).toFixed(0)}% — agents may be gaming the coherence scorer`,
      metric: "avg_coherence",
      expectedRange: [COHERENCE_EXPECTED_MIN, COHERENCE_EXPECTED_MAX],
      actualValue: recentCoherence,
      recommendation: "Review coherence scoring methodology for gaming vectors",
      timestamp: new Date().toISOString(),
    });
  }

  // 4. Hallucination Spike
  const recentHallRate = computeAvgMetric(recent, (s) => s.hallucinationRate);
  const olderHallRate = computeAvgMetric(older, (s) => s.hallucinationRate);
  if (recentHallRate > olderHallRate + HALLUCINATION_SPIKE_DELTA_THRESHOLD) {
    alerts.push({
      id: `reg_${Date.now()}_hall`,
      type: "hallucination_spike",
      severity: recentHallRate > HALLUCINATION_SPIKE_HIGH_THRESHOLD ? "high" : "medium",
      description: `Hallucination rate spiked from ${(olderHallRate * 100).toFixed(0)}% to ${(recentHallRate * 100).toFixed(0)}%`,
      metric: "hallucination_rate",
      expectedRange: [0, HALLUCINATION_EXPECTED_MAX],
      actualValue: recentHallRate,
      recommendation: "Check if market data pipeline has issues causing agents to hallucinate",
      timestamp: new Date().toISOString(),
    });
  }

  // 5. Reasoning Length Drift (getting shorter = lazier reasoning)
  const recentLength = computeAvgMetric(recent, (s) => s.avgReasoningLength);
  const olderLength = computeAvgMetric(older, (s) => s.avgReasoningLength);
  if (recentLength < olderLength * REASONING_LENGTH_DRIFT_THRESHOLD) {
    alerts.push({
      id: `reg_${Date.now()}_len`,
      type: "reasoning_length_drift",
      severity: "medium",
      description: `Avg reasoning length dropped from ${Math.round(olderLength)} to ${Math.round(recentLength)} words`,
      metric: "avg_reasoning_length",
      expectedRange: [olderLength * REASONING_LENGTH_EXPECTED_MIN_RATIO, olderLength * REASONING_LENGTH_EXPECTED_MAX_RATIO],
      actualValue: recentLength,
      recommendation: "Review agent prompts or increase minimum reasoning length requirement",
      timestamp: new Date().toISOString(),
    });
  }

  // 6. Calibration Decay
  const recentCalib = computeAvgMetric(recent, (s) => s.calibrationAvg);
  const olderCalib = computeAvgMetric(older, (s) => s.calibrationAvg);
  if (recentCalib < olderCalib - CALIBRATION_DECAY_DELTA_THRESHOLD && recentCalib < CALIBRATION_DECAY_ABSOLUTE_THRESHOLD) {
    alerts.push({
      id: `reg_${Date.now()}_calib`,
      type: "calibration_decay",
      severity: recentCalib < CALIBRATION_DECAY_HIGH_THRESHOLD ? "high" : "medium",
      description: `Calibration quality dropped from ${(olderCalib * 100).toFixed(0)}% to ${(recentCalib * 100).toFixed(0)}%`,
      metric: "calibration_avg",
      expectedRange: [CALIBRATION_EXPECTED_MIN, CALIBRATION_EXPECTED_MAX],
      actualValue: recentCalib,
      recommendation: "Agents may need confidence recalibration prompting",
      timestamp: new Date().toISOString(),
    });
  }

  // 7. Pillar Imbalance
  const pillarVals = Object.values(snapshot.pillarAverages);
  if (pillarVals.length >= 3) {
    const pillarStdDev = computeStdDev(pillarVals);
    if (pillarStdDev > PILLAR_IMBALANCE_THRESHOLD) {
      const sortedPillars = sortEntriesDescending(snapshot.pillarAverages);
      const highest = sortedPillars[0];
      const lowest = sortedPillars[sortedPillars.length - 1];
      alerts.push({
        id: `reg_${Date.now()}_imb`,
        type: "pillar_imbalance",
        severity: "low",
        description: `Pillar scores vary widely: ${highest[0]}=${(highest[1] * 100).toFixed(0)}% vs ${lowest[0]}=${(lowest[1] * 100).toFixed(0)}%`,
        metric: "pillar_std_dev",
        expectedRange: [0, PILLAR_BALANCE_EXPECTED_MAX],
        actualValue: pillarStdDev,
        recommendation: `Consider rebalancing pillar weights — ${lowest[0]} may need methodology review`,
        timestamp: new Date().toISOString(),
      });
    }
  }

  return alerts;
}

function computeAvgMetric(
  snapshots: BenchmarkHealthSnapshot[],
  extractor: (s: BenchmarkHealthSnapshot) => number,
): number {
  if (snapshots.length === 0) return 0;
  return snapshots.reduce((s, snap) => s + extractor(snap), 0) / snapshots.length;
}

// Removed duplicate computeStdDev() - now using canonical version from math-utils.ts (line 901)

// ---------------------------------------------------------------------------
// Health Report
// ---------------------------------------------------------------------------

/**
 * Generate the full benchmark health report.
 */
export function getBenchmarkHealthReport(): BenchmarkHealthReport {
  if (healthSnapshots.length < 3) {
    return {
      overallHealth: 0.8,
      status: "healthy",
      activeAlerts: [],
      snapshotCount: healthSnapshots.length,
      dimensions: {
        scoringStability: 0.8,
        pillarBalance: 0.8,
        agentDiversity: 0.8,
        dataFreshness: 0.8,
        calibrationQuality: 0.8,
      },
      recommendations: ["Collect more data for meaningful regression detection"],
      trend: "stable",
      lastUpdated: new Date().toISOString(),
    };
  }

  const recent = healthSnapshots.slice(-RECENT_SNAPSHOTS_WINDOW);

  // Scoring stability: low drift = good
  const scoreDrifts: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    const prev = Object.values(recent[i - 1].agentScores);
    const curr = Object.values(recent[i].agentScores);
    if (prev.length > 0 && curr.length > 0) {
      const prevAvg = prev.reduce((a, b) => a + b, 0) / prev.length;
      const currAvg = curr.reduce((a, b) => a + b, 0) / curr.length;
      scoreDrifts.push(Math.abs(currAvg - prevAvg));
    }
  }
  const avgDrift = scoreDrifts.length > 0 ? scoreDrifts.reduce((s, d) => s + d, 0) / scoreDrifts.length : 0;
  const scoringStability = Math.max(0, 1 - avgDrift * HEALTH_SCORING_STABILITY_DRIFT_MULTIPLIER);

  // Pillar balance
  const lastSnapshot = recent[recent.length - 1];
  const pillarVals = Object.values(lastSnapshot.pillarAverages);
  const pillarStdDev = computeStdDev(pillarVals);
  const pillarBalance = Math.max(0, 1 - pillarStdDev * HEALTH_PILLAR_BALANCE_STDDEV_MULTIPLIER);

  // Agent diversity
  const agentDiversity = Math.min(1, lastSnapshot.agentScoreSpread * HEALTH_AGENT_DIVERSITY_SPREAD_MULTIPLIER);

  // Data freshness (based on reasoning length — shorter = staler)
  const avgLength = computeAvgMetric(recent, (s) => s.avgReasoningLength);
  const dataFreshness = Math.min(1, avgLength / HEALTH_DATA_FRESHNESS_BASELINE_WORDS);

  // Calibration quality
  const calibrationQuality = computeAvgMetric(recent, (s) => s.calibrationAvg);

  const dimensions = {
    scoringStability: round3(scoringStability),
    pillarBalance: round3(pillarBalance),
    agentDiversity: round3(agentDiversity),
    dataFreshness: round3(dataFreshness),
    calibrationQuality: round3(calibrationQuality),
  };

  // Overall health: weighted average
  const overallHealth = round3(
    dimensions.scoringStability * HEALTH_WEIGHT_SCORING_STABILITY +
      dimensions.pillarBalance * HEALTH_WEIGHT_PILLAR_BALANCE +
      dimensions.agentDiversity * HEALTH_WEIGHT_AGENT_DIVERSITY +
      dimensions.dataFreshness * HEALTH_WEIGHT_DATA_FRESHNESS +
      dimensions.calibrationQuality * HEALTH_WEIGHT_CALIBRATION_QUALITY
  );

  // Status
  const highAlerts = activeAlerts.filter((a) => a.severity === "high" || a.severity === "critical").length;
  const status: "healthy" | "warning" | "degraded" | "critical" =
    highAlerts >= 3 ? "critical" :
    highAlerts >= 1 ? "degraded" :
    activeAlerts.length > 3 ? "warning" : "healthy";

  // Recommendations
  const recommendations: string[] = [];
  if (dimensions.agentDiversity < 0.3) {
    recommendations.push("Agent scores are too similar — consider adding more differentiating metrics");
  }
  if (dimensions.scoringStability < 0.5) {
    recommendations.push("Scoring is unstable — review recent methodology changes");
  }
  if (dimensions.dataFreshness < 0.5) {
    recommendations.push("Reasoning quality declining — review agent prompt engineering");
  }
  if (dimensions.calibrationQuality < 0.4) {
    recommendations.push("Confidence calibration is poor — agents need calibration feedback");
  }
  if (recommendations.length === 0) {
    recommendations.push("Benchmark is operating within normal parameters");
  }

  // Trend
  const mid = Math.floor(healthSnapshots.length / 2);
  const firstHalf = healthSnapshots.slice(0, mid);
  const secondHalf = healthSnapshots.slice(mid);
  const firstCoherence = computeAvgMetric(firstHalf, (s) => s.coherenceAvg);
  const secondCoherence = computeAvgMetric(secondHalf, (s) => s.coherenceAvg);
  const trend: "improving" | "stable" | "declining" =
    secondCoherence > firstCoherence + 0.05 ? "improving" :
    secondCoherence < firstCoherence - 0.05 ? "declining" : "stable";

  return {
    overallHealth,
    status,
    activeAlerts: activeAlerts.slice(-20),
    snapshotCount: healthSnapshots.length,
    dimensions,
    recommendations,
    trend,
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Get the benchmark regression pillar score (0-1).
 * Used by the v18 scoring engine.
 */
export function getBenchmarkHealthPillarScore(): number {
  const report = getBenchmarkHealthReport();
  return report.overallHealth;
}

/**
 * Get all active regression alerts.
 */
export function getActiveAlerts(): RegressionAlert[] {
  return activeAlerts.slice(-50);
}

/**
 * Get snapshot history for trend analysis.
 */
export function getHealthSnapshotHistory(): BenchmarkHealthSnapshot[] {
  return healthSnapshots.slice(-100);
}
