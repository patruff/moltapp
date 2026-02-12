/**
 * Adaptive Quality Gate
 *
 * Dynamically adjusts quality gate thresholds based on each agent's
 * performance history. Instead of one-size-fits-all fixed thresholds,
 * this gate adapts to each agent's baseline quality level:
 *
 * - High-performing agents are held to HIGHER standards (their own 25th
 *   percentile becomes the floor).
 * - New agents start with generous defaults until enough data accumulates.
 * - Thresholds tighten or loosen automatically as quality trends change.
 *
 * This prevents a scenario where a consistently excellent agent suddenly
 * passes with mediocre reasoning just because it clears a low fixed bar.
 */

import type { TradingDecision, MarketData } from "../agents/base-agent.ts";
import {
  analyzeCoherence,
  detectHallucinations,
} from "./coherence-analyzer.ts";
import { ADAPTIVE_GATE_WEIGHTS } from "../lib/scoring-weights.ts";
import { round2, countByCondition } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdaptiveThresholds {
  agentId: string;
  minCoherence: number;
  maxHallucinationSeverity: number;
  minReasoningLength: number;
  minCompositeScore: number;
  dataPoints: number;
  lastUpdated: string;
}

export interface AdaptiveGateResult {
  passed: boolean;
  agentId: string;
  thresholds: AdaptiveThresholds;
  actual: {
    coherence: number;
    hallucinationSeverity: number;
    disciplinePass: boolean;
    reasoningLength: number;
    compositeScore: number;
  };
  rejectionReasons: string[];
  adaptiveNote: string;
}

export interface AdaptiveGateStats {
  agents: {
    agentId: string;
    currentThresholds: AdaptiveThresholds;
    passRate: number;
    totalEvaluated: number;
    thresholdTrend: "tightening" | "stable" | "loosening";
  }[];
  globalPassRate: number;
  totalEvaluated: number;
}

// ---------------------------------------------------------------------------
// Internal Types
// ---------------------------------------------------------------------------

interface QualityDataPoint {
  coherence: number;
  hallucinationSeverity: number;
  disciplinePass: boolean;
  compositeScore: number;
  timestamp: string;
}

interface EvaluationRecord {
  passed: boolean;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum data points before switching from defaults to adaptive thresholds */
const MIN_DATA_POINTS = 10;

/** Maximum history entries per agent to prevent unbounded growth */
const MAX_HISTORY = 500;

/**
 * Percentile floor for adaptive threshold calculation (0.25 = 25th percentile).
 * Means new thresholds are set at the agent's own bottom 25% quality level.
 * Example: If agent's coherence scores are [0.3, 0.4, 0.5, 0.6], threshold = 0.4.
 */
const ADAPTIVE_PERCENTILE_FLOOR = 0.25;

/**
 * Percentile ceiling for hallucination severity threshold (0.75 = 75th percentile).
 * Higher percentile for severity as we want to allow agent's WORST hallucination cases.
 * Example: If agent's severities are [0.1, 0.2, 0.3, 0.4], threshold = 0.3.
 */
const ADAPTIVE_PERCENTILE_CEILING = 0.75;

/**
 * Drift detection threshold for composite score changes.
 * If composite score changes by more than ±0.02, thresholds are "tightening" or "loosening".
 * Set at 2% to avoid noise from small fluctuations while catching meaningful shifts.
 */
const THRESHOLD_DRIFT_DELTA = 0.02;

/** Default thresholds for agents with insufficient history */
const DEFAULT_THRESHOLDS: Omit<AdaptiveThresholds, "agentId" | "dataPoints" | "lastUpdated"> = {
  minCoherence: 0.2,
  maxHallucinationSeverity: 0.75,
  minReasoningLength: 30,
  minCompositeScore: 0.3,
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Per-agent quality history used to compute adaptive thresholds */
const qualityHistory = new Map<string, QualityDataPoint[]>();

/** Per-agent evaluation outcomes for pass-rate tracking */
const evaluationHistory = new Map<string, EvaluationRecord[]>();

/** Snapshot of the previous adaptive thresholds for trend detection */
const previousThresholds = new Map<string, number>();

// ---------------------------------------------------------------------------
// Core: Compute Adaptive Thresholds
// ---------------------------------------------------------------------------

/**
 * Compute adaptive thresholds for a specific agent based on their
 * quality history distribution.
 *
 * When enough data points exist, the threshold is set at the agent's
 * own 25th percentile -- meaning the gate only fires when reasoning
 * falls below what the agent typically produces. New agents receive
 * generous defaults.
 */
export function computeAdaptiveThresholds(agentId: string): AdaptiveThresholds {
  const history = qualityHistory.get(agentId);

  if (!history || history.length < MIN_DATA_POINTS) {
    return {
      agentId,
      ...DEFAULT_THRESHOLDS,
      dataPoints: history?.length ?? 0,
      lastUpdated: new Date().toISOString(),
    };
  }

  const coherences = history.map((h) => h.coherence).sort((a, b) => a - b);
  const severities = history.map((h) => h.hallucinationSeverity).sort((a, b) => a - b);
  const composites = history.map((h) => h.compositeScore).sort((a, b) => a - b);

  const floorIndex = Math.floor(history.length * ADAPTIVE_PERCENTILE_FLOOR);
  const ceilingIndex = Math.floor(history.length * ADAPTIVE_PERCENTILE_CEILING);
  const adaptiveCoherence = coherences[floorIndex];
  const adaptiveSeverity = severities[ceilingIndex]; // 75th pctl for severity (higher = worse)
  const adaptiveComposite = composites[floorIndex];

  return {
    agentId,
    minCoherence: Math.max(DEFAULT_THRESHOLDS.minCoherence, round2(adaptiveCoherence)),
    maxHallucinationSeverity: Math.min(DEFAULT_THRESHOLDS.maxHallucinationSeverity, round2(adaptiveSeverity)),
    minReasoningLength: DEFAULT_THRESHOLDS.minReasoningLength,
    minCompositeScore: Math.max(DEFAULT_THRESHOLDS.minCompositeScore, round2(adaptiveComposite)),
    dataPoints: history.length,
    lastUpdated: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Core: Evaluate With Adaptive Gate
// ---------------------------------------------------------------------------

/**
 * Evaluate a trade decision against adaptive, per-agent thresholds.
 *
 * Runs the standard coherence + hallucination + discipline checks,
 * then compares against thresholds computed from the agent's own
 * quality history rather than fixed global values.
 */
export function evaluateWithAdaptiveGate(
  agentId: string,
  decision: TradingDecision,
  marketData: MarketData[],
): AdaptiveGateResult {
  const thresholds = computeAdaptiveThresholds(agentId);
  const rejectionReasons: string[] = [];

  // --- Coherence check ---
  const coherence = analyzeCoherence(decision.reasoning, decision.action, marketData);

  // --- Hallucination check ---
  const hallucinations = detectHallucinations(decision.reasoning, marketData);

  // --- Discipline check (lightweight: reasoning length) ---
  const reasoningLength = decision.reasoning.length;
  const disciplinePass = reasoningLength >= thresholds.minReasoningLength;

  // --- Composite score (same weights as reasoning-quality-gate) ---
  const hallucinationFree = 1 - hallucinations.severity;
  const disciplineScore = disciplinePass ? 1.0 : 0.0;
  const compositeScore = round2(
    coherence.score * ADAPTIVE_GATE_WEIGHTS.coherence +
    hallucinationFree * ADAPTIVE_GATE_WEIGHTS.hallucination_free +
    disciplineScore * ADAPTIVE_GATE_WEIGHTS.discipline,
  );

  // --- Threshold comparisons ---
  if (coherence.score < thresholds.minCoherence) {
    rejectionReasons.push(
      `Coherence ${coherence.score.toFixed(2)} below adaptive min ${thresholds.minCoherence.toFixed(2)}`,
    );
  }

  if (hallucinations.severity > thresholds.maxHallucinationSeverity) {
    rejectionReasons.push(
      `Hallucination severity ${hallucinations.severity.toFixed(2)} exceeds adaptive max ${thresholds.maxHallucinationSeverity.toFixed(2)}`,
    );
  }

  if (!disciplinePass) {
    rejectionReasons.push(
      `Reasoning length ${reasoningLength} below min ${thresholds.minReasoningLength}`,
    );
  }

  if (compositeScore < thresholds.minCompositeScore) {
    rejectionReasons.push(
      `Composite score ${compositeScore.toFixed(2)} below adaptive min ${thresholds.minCompositeScore.toFixed(2)}`,
    );
  }

  const passed = rejectionReasons.length === 0;

  // --- Adaptive note ---
  let adaptiveNote: string;
  if (thresholds.dataPoints < MIN_DATA_POINTS) {
    adaptiveNote = `Using default thresholds (${thresholds.dataPoints}/${MIN_DATA_POINTS} data points collected)`;
  } else {
    adaptiveNote = `Adaptive thresholds based on ${thresholds.dataPoints} historical data points`;
  }

  // --- Record the evaluation outcome ---
  const records = evaluationHistory.get(agentId) ?? [];
  records.push({ passed, timestamp: new Date().toISOString() });
  if (records.length > MAX_HISTORY) records.shift();
  evaluationHistory.set(agentId, records);

  // --- Auto-record the quality data point for future threshold adjustment ---
  recordQualityDataPoint(agentId, coherence.score, hallucinations.severity, disciplinePass);

  return {
    passed,
    agentId,
    thresholds,
    actual: {
      coherence: coherence.score,
      hallucinationSeverity: hallucinations.severity,
      disciplinePass,
      reasoningLength,
      compositeScore,
    },
    rejectionReasons,
    adaptiveNote,
  };
}

// ---------------------------------------------------------------------------
// Core: Stats
// ---------------------------------------------------------------------------

/**
 * Return aggregate adaptive gate statistics including per-agent thresholds,
 * pass rates, and threshold evolution trends.
 */
export function getAdaptiveGateStats(): AdaptiveGateStats {
  const agentIds = new Set([...qualityHistory.keys(), ...evaluationHistory.keys()]);
  let globalPassed = 0;
  let globalTotal = 0;

  const agents = [...agentIds].map((agentId) => {
    const currentThresholds = computeAdaptiveThresholds(agentId);
    const records = evaluationHistory.get(agentId) ?? [];
    const totalEvaluated = records.length;
    const passCount = countByCondition(records, (r) => r.passed);
    const passRate = totalEvaluated > 0 ? round2(passCount / totalEvaluated) : 0;

    globalPassed += passCount;
    globalTotal += totalEvaluated;

    // Determine threshold trend by comparing current composite threshold
    // to the previous snapshot.
    const prevComposite = previousThresholds.get(agentId);
    let thresholdTrend: "tightening" | "stable" | "loosening" = "stable";
    if (prevComposite !== undefined) {
      const delta = currentThresholds.minCompositeScore - prevComposite;
      if (delta > THRESHOLD_DRIFT_DELTA) thresholdTrend = "tightening";
      else if (delta < -THRESHOLD_DRIFT_DELTA) thresholdTrend = "loosening";
    }
    previousThresholds.set(agentId, currentThresholds.minCompositeScore);

    return { agentId, currentThresholds, passRate, totalEvaluated, thresholdTrend };
  });

  return {
    agents,
    globalPassRate: globalTotal > 0 ? round2(globalPassed / globalTotal) : 0,
    totalEvaluated: globalTotal,
  };
}

// ---------------------------------------------------------------------------
// Core: Record Quality Data Point
// ---------------------------------------------------------------------------

/**
 * Record a new quality data point used to compute future adaptive thresholds.
 *
 * Called automatically by `evaluateWithAdaptiveGate`, but exposed publicly
 * so external systems (e.g. batch analysis) can feed historical data.
 */
export function recordQualityDataPoint(
  agentId: string,
  coherence: number,
  hallucinationSeverity: number,
  disciplinePass: boolean,
): void {
  const history = qualityHistory.get(agentId) ?? [];

  const hallucinationFree = 1 - hallucinationSeverity;
  const disciplineScore = disciplinePass ? 1.0 : 0.0;
  const compositeScore = round2(
    coherence * ADAPTIVE_GATE_WEIGHTS.coherence +
    hallucinationFree * ADAPTIVE_GATE_WEIGHTS.hallucination_free +
    disciplineScore * ADAPTIVE_GATE_WEIGHTS.discipline,
  );

  history.push({
    coherence,
    hallucinationSeverity,
    disciplinePass,
    compositeScore,
    timestamp: new Date().toISOString(),
  });

  if (history.length > MAX_HISTORY) history.shift();
  qualityHistory.set(agentId, history);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

