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

  if (healthSnapshots.length < 5) return alerts;

  const recent = healthSnapshots.slice(-10);
  const older = healthSnapshots.slice(-30, -10);

  if (older.length < 5) return alerts;

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
  if (scoreDrift > 0.15) {
    alerts.push({
      id: `reg_${Date.now()}_drift`,
      type: "scoring_drift",
      severity: scoreDrift > 0.25 ? "high" : "medium",
      description: `Composite scores shifted by ${(scoreDrift * 100).toFixed(1)}% — may indicate scoring formula drift or data quality change`,
      metric: "avg_composite_score",
      expectedRange: [olderAvgScores - 0.1, olderAvgScores + 0.1],
      actualValue: recentAvgScores,
      recommendation: "Review recent scoring weight changes or data pipeline for anomalies",
      timestamp: new Date().toISOString(),
    });
  }

  // 2. Agent Convergence: all agents scoring similarly = bad differentiation
  const recentSpread = computeAvgMetric(recent, (s) => s.agentScoreSpread);
  if (recentSpread < 0.03) {
    alerts.push({
      id: `reg_${Date.now()}_conv`,
      type: "agent_convergence",
      severity: recentSpread < 0.01 ? "high" : "medium",
      description: `Agent score spread is only ${(recentSpread * 100).toFixed(1)}% — benchmark is not differentiating agents well`,
      metric: "agent_score_spread",
      expectedRange: [0.05, 0.30],
      actualValue: recentSpread,
      recommendation: "Increase weight of differentiating pillars (financial, battle, patterns)",
      timestamp: new Date().toISOString(),
    });
  }

  // 3. Coherence Inflation: coherence scores creeping up artificially
  const recentCoherence = computeAvgMetric(recent, (s) => s.coherenceAvg);
  const olderCoherence = computeAvgMetric(older, (s) => s.coherenceAvg);
  if (recentCoherence > olderCoherence + 0.15 && recentCoherence > 0.85) {
    alerts.push({
      id: `reg_${Date.now()}_coh_inf`,
      type: "coherence_inflation",
      severity: "medium",
      description: `Coherence scores inflated from ${(olderCoherence * 100).toFixed(0)}% to ${(recentCoherence * 100).toFixed(0)}% — agents may be gaming the coherence scorer`,
      metric: "avg_coherence",
      expectedRange: [0.5, 0.8],
      actualValue: recentCoherence,
      recommendation: "Review coherence scoring methodology for gaming vectors",
      timestamp: new Date().toISOString(),
    });
  }

  // 4. Hallucination Spike
  const recentHallRate = computeAvgMetric(recent, (s) => s.hallucinationRate);
  const olderHallRate = computeAvgMetric(older, (s) => s.hallucinationRate);
  if (recentHallRate > olderHallRate + 0.1) {
    alerts.push({
      id: `reg_${Date.now()}_hall`,
      type: "hallucination_spike",
      severity: recentHallRate > 0.3 ? "high" : "medium",
      description: `Hallucination rate spiked from ${(olderHallRate * 100).toFixed(0)}% to ${(recentHallRate * 100).toFixed(0)}%`,
      metric: "hallucination_rate",
      expectedRange: [0, 0.15],
      actualValue: recentHallRate,
      recommendation: "Check if market data pipeline has issues causing agents to hallucinate",
      timestamp: new Date().toISOString(),
    });
  }

  // 5. Reasoning Length Drift (getting shorter = lazier reasoning)
  const recentLength = computeAvgMetric(recent, (s) => s.avgReasoningLength);
  const olderLength = computeAvgMetric(older, (s) => s.avgReasoningLength);
  if (recentLength < olderLength * 0.6) {
    alerts.push({
      id: `reg_${Date.now()}_len`,
      type: "reasoning_length_drift",
      severity: "medium",
      description: `Avg reasoning length dropped from ${Math.round(olderLength)} to ${Math.round(recentLength)} words`,
      metric: "avg_reasoning_length",
      expectedRange: [olderLength * 0.8, olderLength * 1.5],
      actualValue: recentLength,
      recommendation: "Review agent prompts or increase minimum reasoning length requirement",
      timestamp: new Date().toISOString(),
    });
  }

  // 6. Calibration Decay
  const recentCalib = computeAvgMetric(recent, (s) => s.calibrationAvg);
  const olderCalib = computeAvgMetric(older, (s) => s.calibrationAvg);
  if (recentCalib < olderCalib - 0.1 && recentCalib < 0.5) {
    alerts.push({
      id: `reg_${Date.now()}_calib`,
      type: "calibration_decay",
      severity: recentCalib < 0.3 ? "high" : "medium",
      description: `Calibration quality dropped from ${(olderCalib * 100).toFixed(0)}% to ${(recentCalib * 100).toFixed(0)}%`,
      metric: "calibration_avg",
      expectedRange: [0.5, 1.0],
      actualValue: recentCalib,
      recommendation: "Agents may need confidence recalibration prompting",
      timestamp: new Date().toISOString(),
    });
  }

  // 7. Pillar Imbalance
  const pillarVals = Object.values(snapshot.pillarAverages);
  if (pillarVals.length >= 3) {
    const pillarStdDev = computeStdDev(pillarVals);
    if (pillarStdDev > 0.25) {
      const highest = Object.entries(snapshot.pillarAverages).sort((a, b) => b[1] - a[1])[0];
      const lowest = Object.entries(snapshot.pillarAverages).sort((a, b) => a[1] - b[1])[0];
      alerts.push({
        id: `reg_${Date.now()}_imb`,
        type: "pillar_imbalance",
        severity: "low",
        description: `Pillar scores vary widely: ${highest[0]}=${(highest[1] * 100).toFixed(0)}% vs ${lowest[0]}=${(lowest[1] * 100).toFixed(0)}%`,
        metric: "pillar_std_dev",
        expectedRange: [0, 0.20],
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

function computeStdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

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

  const recent = healthSnapshots.slice(-10);

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
  const scoringStability = Math.max(0, 1 - avgDrift * 5);

  // Pillar balance
  const lastSnapshot = recent[recent.length - 1];
  const pillarVals = Object.values(lastSnapshot.pillarAverages);
  const pillarStdDev = computeStdDev(pillarVals);
  const pillarBalance = Math.max(0, 1 - pillarStdDev * 3);

  // Agent diversity
  const agentDiversity = Math.min(1, lastSnapshot.agentScoreSpread * 10);

  // Data freshness (based on reasoning length — shorter = staler)
  const avgLength = computeAvgMetric(recent, (s) => s.avgReasoningLength);
  const dataFreshness = Math.min(1, avgLength / 80);

  // Calibration quality
  const calibrationQuality = computeAvgMetric(recent, (s) => s.calibrationAvg);

  const dimensions = {
    scoringStability: Math.round(scoringStability * 1000) / 1000,
    pillarBalance: Math.round(pillarBalance * 1000) / 1000,
    agentDiversity: Math.round(agentDiversity * 1000) / 1000,
    dataFreshness: Math.round(dataFreshness * 1000) / 1000,
    calibrationQuality: Math.round(calibrationQuality * 1000) / 1000,
  };

  // Overall health: weighted average
  const overallHealth = Math.round(
    (dimensions.scoringStability * 0.25 +
      dimensions.pillarBalance * 0.20 +
      dimensions.agentDiversity * 0.25 +
      dimensions.dataFreshness * 0.15 +
      dimensions.calibrationQuality * 0.15) * 1000
  ) / 1000;

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
