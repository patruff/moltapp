/**
 * Cross-Round Reasoning Drift Detector
 *
 * Tracks how an agent's reasoning quality changes over time — detecting
 * improvement, degradation, and sudden shifts in reasoning behavior.
 *
 * This is a key benchmark metric: we want to know not just how an
 * agent reasons NOW, but whether it maintains quality consistently.
 *
 * Drift categories:
 * - QUALITY DRIFT: Coherence/depth scores trending up or down
 * - VOCABULARY DRIFT: Using different words/phrases over time
 * - CONFIDENCE DRIFT: Systematic over/under-confidence shifts
 * - STRATEGY DRIFT: Changing trading intent distribution
 * - HALLUCINATION DRIFT: Hallucination rate increasing/decreasing
 *
 * Uses sliding window analysis with configurable window sizes.
 */

import { getTopKey, mean, round3 } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DriftSnapshot {
  agentId: string;
  roundId: string;
  /** Quality metrics at this point in time */
  coherenceScore: number;
  hallucinationCount: number;
  confidence: number;
  wordCount: number;
  intent: string;
  action: string;
  /** Unique bigrams in reasoning (for vocabulary tracking) */
  uniqueBigrams: number;
  timestamp: string;
}

export interface DriftAnalysis {
  agentId: string;
  /** Overall drift severity 0 (stable) to 1 (massive drift) */
  overallDrift: number;
  /** Quality drift: positive = improving, negative = degrading */
  qualityDrift: number;
  /** Confidence drift: positive = becoming more confident */
  confidenceDrift: number;
  /** Vocabulary drift: 0 (same words) to 1 (completely different) */
  vocabularyDrift: number;
  /** Strategy drift: 0 (same intents) to 1 (completely different) */
  strategyDrift: number;
  /** Hallucination drift: positive = more hallucinations */
  hallucinationDrift: number;
  /** Whether significant drift was detected */
  significantDrift: boolean;
  /** Which categories show significant drift */
  driftCategories: string[];
  /** Trend classification */
  trend: "improving" | "declining" | "shifting" | "stable";
  /** Number of data points analyzed */
  dataPoints: number;
  /** Analysis window */
  window: { from: string; to: string };
  /** Per-window averages for visualization */
  windowAverages: Array<{
    windowStart: string;
    avgCoherence: number;
    avgConfidence: number;
    avgWordCount: number;
    hallucinationRate: number;
    dominantIntent: string;
  }>;
}

export interface DriftAlert {
  agentId: string;
  category: string;
  severity: "low" | "medium" | "high";
  description: string;
  currentValue: number;
  previousValue: number;
  delta: number;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const snapshots: Map<string, DriftSnapshot[]> = new Map();
const alerts: DriftAlert[] = [];
const MAX_SNAPSHOTS = 500;
const MAX_ALERTS = 200;
const DRIFT_THRESHOLD = 0.15;

// ---------------------------------------------------------------------------
// Data Collection
// ---------------------------------------------------------------------------

/**
 * Record a reasoning snapshot for drift analysis.
 */
export function recordDriftSnapshot(snapshot: DriftSnapshot): void {
  const list = snapshots.get(snapshot.agentId) ?? [];
  list.push(snapshot);
  if (list.length > MAX_SNAPSHOTS) list.shift();
  snapshots.set(snapshot.agentId, list);
}

/**
 * Build a drift snapshot from raw trade data.
 */
export function buildDriftSnapshot(data: {
  agentId: string;
  roundId: string;
  reasoning: string;
  coherenceScore: number;
  hallucinationCount: number;
  confidence: number;
  intent: string;
  action: string;
}): DriftSnapshot {
  const words = data.reasoning.split(/\s+/);
  const bigrams = new Set<string>();
  for (let i = 0; i < words.length - 1; i++) {
    bigrams.add(`${words[i].toLowerCase()}_${words[i + 1].toLowerCase()}`);
  }

  return {
    agentId: data.agentId,
    roundId: data.roundId,
    coherenceScore: data.coherenceScore,
    hallucinationCount: data.hallucinationCount,
    confidence: data.confidence,
    wordCount: words.length,
    intent: data.intent,
    action: data.action,
    uniqueBigrams: bigrams.size,
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

/**
 * Analyze drift for an agent using sliding window comparison.
 */
export function analyzeDrift(
  agentId: string,
  windowSize = 10,
): DriftAnalysis {
  const data = snapshots.get(agentId) ?? [];

  if (data.length < windowSize * 2) {
    return {
      agentId,
      overallDrift: 0,
      qualityDrift: 0,
      confidenceDrift: 0,
      vocabularyDrift: 0,
      strategyDrift: 0,
      hallucinationDrift: 0,
      significantDrift: false,
      driftCategories: [],
      trend: "stable",
      dataPoints: data.length,
      window: {
        from: data[0]?.timestamp ?? "",
        to: data[data.length - 1]?.timestamp ?? "",
      },
      windowAverages: [],
    };
  }

  // Split into windows
  const windows: DriftSnapshot[][] = [];
  for (let i = 0; i <= data.length - windowSize; i += Math.max(1, Math.floor(windowSize / 2))) {
    windows.push(data.slice(i, i + windowSize));
  }

  // Compute per-window averages
  const windowAverages = windows.map((w) => ({
    windowStart: w[0].timestamp,
    avgCoherence: mean(w.map((s) => s.coherenceScore)),
    avgConfidence: mean(w.map((s) => s.confidence)),
    avgWordCount: mean(w.map((s) => s.wordCount)),
    hallucinationRate:
      w.filter((s) => s.hallucinationCount > 0).length / w.length,
    dominantIntent: mode(w.map((s) => s.intent)),
  }));

  // Compare first half of windows to second half
  const midpoint = Math.floor(windowAverages.length / 2);
  const earlyWindows = windowAverages.slice(0, midpoint);
  const recentWindows = windowAverages.slice(midpoint);

  if (earlyWindows.length === 0 || recentWindows.length === 0) {
    return {
      agentId,
      overallDrift: 0,
      qualityDrift: 0,
      confidenceDrift: 0,
      vocabularyDrift: 0,
      strategyDrift: 0,
      hallucinationDrift: 0,
      significantDrift: false,
      driftCategories: [],
      trend: "stable",
      dataPoints: data.length,
      window: {
        from: data[0].timestamp,
        to: data[data.length - 1].timestamp,
      },
      windowAverages,
    };
  }

  const earlyAvgCoherence = mean(earlyWindows.map((w) => w.avgCoherence));
  const recentAvgCoherence = mean(recentWindows.map((w) => w.avgCoherence));
  const qualityDrift = recentAvgCoherence - earlyAvgCoherence;

  const earlyAvgConfidence = mean(earlyWindows.map((w) => w.avgConfidence));
  const recentAvgConfidence = mean(recentWindows.map((w) => w.avgConfidence));
  const confidenceDrift = recentAvgConfidence - earlyAvgConfidence;

  const earlyAvgWordCount = mean(earlyWindows.map((w) => w.avgWordCount));
  const recentAvgWordCount = mean(recentWindows.map((w) => w.avgWordCount));
  const vocabularyDrift = Math.abs(recentAvgWordCount - earlyAvgWordCount) /
    Math.max(earlyAvgWordCount, 1);

  // Strategy drift: Jaccard distance of intent distributions
  const earlyIntents = earlyWindows.map((w) => w.dominantIntent);
  const recentIntents = recentWindows.map((w) => w.dominantIntent);
  const earlySet = new Set(earlyIntents);
  const recentSet = new Set(recentIntents);
  const union = new Set([...earlySet, ...recentSet]);
  const intersection = new Set(
    [...earlySet].filter((x) => recentSet.has(x)),
  );
  const strategyDrift =
    union.size > 0 ? 1 - intersection.size / union.size : 0;

  const earlyHallRate = mean(earlyWindows.map((w) => w.hallucinationRate));
  const recentHallRate = mean(recentWindows.map((w) => w.hallucinationRate));
  const hallucinationDrift = recentHallRate - earlyHallRate;

  // Overall drift magnitude
  const overallDrift =
    (Math.abs(qualityDrift) +
      Math.abs(confidenceDrift) +
      vocabularyDrift +
      strategyDrift +
      Math.abs(hallucinationDrift)) / 5;

  // Identify significant drifts
  const driftCategories: string[] = [];
  if (Math.abs(qualityDrift) > DRIFT_THRESHOLD)
    driftCategories.push("quality");
  if (Math.abs(confidenceDrift) > DRIFT_THRESHOLD)
    driftCategories.push("confidence");
  if (vocabularyDrift > DRIFT_THRESHOLD) driftCategories.push("vocabulary");
  if (strategyDrift > DRIFT_THRESHOLD) driftCategories.push("strategy");
  if (Math.abs(hallucinationDrift) > DRIFT_THRESHOLD)
    driftCategories.push("hallucination");

  // Determine overall trend
  let trend: DriftAnalysis["trend"] = "stable";
  if (qualityDrift > DRIFT_THRESHOLD && hallucinationDrift < 0) {
    trend = "improving";
  } else if (qualityDrift < -DRIFT_THRESHOLD || hallucinationDrift > DRIFT_THRESHOLD) {
    trend = "declining";
  } else if (driftCategories.length > 0) {
    trend = "shifting";
  }

  // Generate alerts for significant drift
  if (driftCategories.length > 0) {
    for (const cat of driftCategories) {
      let currentVal = 0;
      let prevVal = 0;
      switch (cat) {
        case "quality":
          currentVal = recentAvgCoherence;
          prevVal = earlyAvgCoherence;
          break;
        case "confidence":
          currentVal = recentAvgConfidence;
          prevVal = earlyAvgConfidence;
          break;
        case "hallucination":
          currentVal = recentHallRate;
          prevVal = earlyHallRate;
          break;
      }
      const delta = currentVal - prevVal;
      const alert: DriftAlert = {
        agentId,
        category: cat,
        severity:
          Math.abs(delta) > 0.3
            ? "high"
            : Math.abs(delta) > 0.2
              ? "medium"
              : "low",
        description: `${cat} drift detected: ${prevVal.toFixed(3)} → ${currentVal.toFixed(3)}`,
        currentValue: round3(currentVal),
        previousValue: round3(prevVal),
        delta: round3(delta),
        timestamp: new Date().toISOString(),
      };
      alerts.push(alert);
      if (alerts.length > MAX_ALERTS) alerts.shift();
    }
  }

  return {
    agentId,
    overallDrift: round3(overallDrift),
    qualityDrift: round3(qualityDrift),
    confidenceDrift: round3(confidenceDrift),
    vocabularyDrift: round3(vocabularyDrift),
    strategyDrift: round3(strategyDrift),
    hallucinationDrift: round3(hallucinationDrift),
    significantDrift: driftCategories.length > 0,
    driftCategories,
    trend,
    dataPoints: data.length,
    window: {
      from: data[0].timestamp,
      to: data[data.length - 1].timestamp,
    },
    windowAverages,
  };
}

// ---------------------------------------------------------------------------
// Cross-Agent Comparison
// ---------------------------------------------------------------------------

/**
 * Compare drift across all agents to find the most stable and most volatile.
 */
export function compareAgentDrift(): {
  agents: Array<{ agentId: string; overallDrift: number; trend: string }>;
  mostStable: string | null;
  mostVolatile: string | null;
  avgDrift: number;
} {
  const results: Array<{
    agentId: string;
    overallDrift: number;
    trend: string;
  }> = [];

  for (const agentId of snapshots.keys()) {
    const analysis = analyzeDrift(agentId);
    results.push({
      agentId,
      overallDrift: analysis.overallDrift,
      trend: analysis.trend,
    });
  }

  results.sort((a, b) => a.overallDrift - b.overallDrift);

  const avgDrift =
    results.length > 0
      ? results.reduce((s, r) => s + r.overallDrift, 0) / results.length
      : 0;

  return {
    agents: results,
    mostStable: results[0]?.agentId ?? null,
    mostVolatile: results[results.length - 1]?.agentId ?? null,
    avgDrift: round3(avgDrift),
  };
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

/**
 * Get recent drift alerts.
 */
export function getDriftAlerts(
  agentId?: string,
  limit = 20,
): DriftAlert[] {
  let filtered = alerts;
  if (agentId) {
    filtered = filtered.filter((a) => a.agentId === agentId);
  }
  return filtered.slice(-limit).reverse();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mode(arr: string[]): string {
  const counts: Record<string, number> = {};
  for (const v of arr) counts[v] = (counts[v] ?? 0) + 1;
  return (
    getTopKey(counts) ?? "unknown"
  );
}

