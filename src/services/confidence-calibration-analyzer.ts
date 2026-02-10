/**
 * Confidence Calibration Analyzer (v14)
 *
 * Measures whether an agent's self-reported confidence is actually
 * predictive of outcome quality. A well-calibrated agent that says
 * "80% confident" should be right ~80% of the time.
 *
 * Key metrics:
 * - Expected Calibration Error (ECE): lower is better
 * - Brier Score: probabilistic accuracy
 * - Monotonic calibration: does higher confidence → better outcomes?
 * - Overconfidence ratio: how often is the agent too confident?
 * - Reliability diagram data for visualization
 */

import { round3 } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Outcome Inference from Coherence
 * When actual P&L isn't available yet, infer outcome quality from reasoning metrics.
 */

/** Weight for coherence score in composite quality calculation (50% - primary indicator) */
const INFERENCE_WEIGHT_COHERENCE = 0.5;
/** Weight for hallucination-free score in composite quality (30% - critical safety factor) */
const INFERENCE_WEIGHT_HALLUCINATION = 0.3;
/** Weight for discipline pass in composite quality (20% - rules compliance) */
const INFERENCE_WEIGHT_DISCIPLINE = 0.2;
/** Hallucination penalty per violation (25% reduction per hallucination) */
const HALLUCINATION_PENALTY_PER_COUNT = 0.25;
/** Quality threshold for "correct enough" classification (60% - minimum acceptable quality) */
const QUALITY_THRESHOLD_FOR_CORRECT = 0.6;

/**
 * Reliability Diagram Parameters
 */

/** Number of bins for reliability diagram (10 = deciles for confidence analysis) */
const RELIABILITY_DIAGRAM_BIN_COUNT = 10;
/** Upper bound offset for last bin inclusion (1.01 includes confidence = 1.0) */
const CONFIDENCE_UPPER_BOUND_OFFSET = 1.01;

/**
 * Over/Under-Confidence Classification
 */

/** Gap threshold for over/under-confidence detection (±5% tolerance for classification) */
const CONFIDENCE_GAP_THRESHOLD = 0.05;

/**
 * Monotonic Calibration Tolerance
 */

/** Tolerance for monotonic calibration violations (10% accuracy decrease allowed between bins) */
const MONOTONIC_TOLERANCE = 0.1;

/**
 * Grade Composite Weights
 * Controls how ECE, Brier score, and monotonic penalty contribute to final grade.
 */

/** Weight for ECE in grade composite (60% - primary calibration metric) */
const GRADE_WEIGHT_ECE = 0.6;
/** Weight for Brier score in grade composite (30% - probabilistic accuracy) */
const GRADE_WEIGHT_BRIER = 0.3;
/** Penalty for non-monotonic calibration (10% grade reduction) */
const GRADE_PENALTY_NON_MONOTONIC = 0.1;

/**
 * Grade Boundaries
 * Composite score thresholds for letter grades (higher score = better calibration).
 */

const GRADE_THRESHOLD_A_PLUS = 0.95;  // >= 95% composite score
const GRADE_THRESHOLD_A = 0.9;        // >= 90% composite score
const GRADE_THRESHOLD_A_MINUS = 0.85; // >= 85% composite score
const GRADE_THRESHOLD_B_PLUS = 0.8;   // >= 80% composite score
const GRADE_THRESHOLD_B = 0.75;       // >= 75% composite score
const GRADE_THRESHOLD_B_MINUS = 0.7;  // >= 70% composite score
const GRADE_THRESHOLD_C_PLUS = 0.65;  // >= 65% composite score
const GRADE_THRESHOLD_C = 0.6;        // >= 60% composite score
const GRADE_THRESHOLD_D = 0.5;        // >= 50% composite score (< 50% = F)

/**
 * Assessment ECE Thresholds
 * Human-readable calibration quality categories based on ECE.
 */

const ECE_EXCELLENT_THRESHOLD = 0.05; // ECE < 5% = excellent calibration
const ECE_GOOD_THRESHOLD = 0.1;       // ECE < 10% = good calibration
const ECE_MODERATE_THRESHOLD = 0.2;   // ECE < 20% = moderate calibration

/**
 * Over/Under-Confidence Assessment Thresholds
 */

/** Overconfidence ratio threshold for assessment warning (>60% overconfident predictions) */
const OVERCONFIDENCE_RATIO_HIGH = 0.6;
/** Underconfidence ratio threshold for assessment note (>40% underconfident predictions) */
const UNDERCONFIDENCE_RATIO_HIGH = 0.4;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CalibrationDataPoint {
  agentId: string;
  confidence: number;
  outcome: number; // 0 = wrong, 1 = correct
  coherenceScore: number;
  action: string;
  symbol: string;
  roundId: string;
  timestamp: string;
}

export interface ReliabilityDiagramPoint {
  binCenter: number;
  avgConfidence: number;
  avgOutcome: number;
  count: number;
  gap: number; // avgConfidence - avgOutcome (positive = overconfident)
}

export interface CalibrationAnalysis {
  agentId: string;
  totalDataPoints: number;
  /** Expected Calibration Error (0 = perfect, 1 = worst) */
  ece: number;
  /** Maximum Calibration Error */
  mce: number;
  /** Brier score (0 = perfect probabilistic prediction) */
  brierScore: number;
  /** Is higher confidence → higher accuracy? */
  monotonicCalibration: boolean;
  /** Fraction of predictions where agent was overconfident */
  overconfidenceRatio: number;
  /** Fraction of predictions where agent was underconfident */
  underconfidenceRatio: number;
  /** Reliability diagram points for visualization */
  reliabilityDiagram: ReliabilityDiagramPoint[];
  /** Grade: A+ (ECE < 0.05) to F (ECE > 0.3) */
  grade: string;
  /** Verbal assessment */
  assessment: string;
  /** Optimal confidence adjustment: multiply agent's confidence by this */
  suggestedCalibrationFactor: number;
}

// ---------------------------------------------------------------------------
// In-Memory Storage
// ---------------------------------------------------------------------------

const calibrationData: CalibrationDataPoint[] = [];
const MAX_DATA_POINTS = 5000;

// ---------------------------------------------------------------------------
// Data Recording
// ---------------------------------------------------------------------------

/**
 * Record a calibration data point.
 * outcome should be 1 (correct/profitable) or 0 (incorrect/loss).
 */
export function recordCalibrationPoint(point: CalibrationDataPoint): void {
  calibrationData.push(point);
  if (calibrationData.length > MAX_DATA_POINTS) {
    calibrationData.splice(0, calibrationData.length - MAX_DATA_POINTS);
  }
}

/**
 * Infer outcome from coherence + action result for calibration tracking.
 * Uses coherence score as a proxy when actual P&L isn't available yet.
 */
export function inferOutcomeFromCoherence(
  coherenceScore: number,
  hallucinationCount: number,
  disciplinePass: boolean,
): number {
  // Composite quality: weighted combination
  const quality =
    coherenceScore * INFERENCE_WEIGHT_COHERENCE +
    (hallucinationCount === 0 ? 1 : Math.max(0, 1 - hallucinationCount * HALLUCINATION_PENALTY_PER_COUNT)) * INFERENCE_WEIGHT_HALLUCINATION +
    (disciplinePass ? 1 : 0) * INFERENCE_WEIGHT_DISCIPLINE;

  // Threshold: quality > threshold = "correct enough" for calibration
  return quality >= QUALITY_THRESHOLD_FOR_CORRECT ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Calibration Analysis
// ---------------------------------------------------------------------------

/**
 * Perform full calibration analysis for an agent.
 */
export function analyzeCalibration(agentId: string): CalibrationAnalysis {
  const agentData = calibrationData.filter((d) => d.agentId === agentId);
  const n = agentData.length;

  if (n === 0) {
    return emptyAnalysis(agentId);
  }

  // Build reliability diagram with configurable bin count
  const bins = RELIABILITY_DIAGRAM_BIN_COUNT;
  const reliabilityDiagram: ReliabilityDiagramPoint[] = [];

  for (let i = 0; i < bins; i++) {
    const lower = i / bins;
    const upper = (i + 1) / bins;
    const binData = agentData.filter(
      (d) => d.confidence >= lower && d.confidence < (i === bins - 1 ? CONFIDENCE_UPPER_BOUND_OFFSET : upper),
    );

    if (binData.length === 0) {
      reliabilityDiagram.push({
        binCenter: (lower + upper) / 2,
        avgConfidence: (lower + upper) / 2,
        avgOutcome: 0,
        count: 0,
        gap: 0,
      });
      continue;
    }

    const avgConf = binData.reduce((s, d) => s + d.confidence, 0) / binData.length;
    const avgOut = binData.reduce((s, d) => s + d.outcome, 0) / binData.length;

    reliabilityDiagram.push({
      binCenter: Math.round(((lower + upper) / 2) * 100) / 100,
      avgConfidence: round3(avgConf),
      avgOutcome: round3(avgOut),
      count: binData.length,
      gap: round3(avgConf - avgOut),
    });
  }

  // ECE: weighted average of |accuracy - confidence| per bin
  const nonEmptyBins = reliabilityDiagram.filter((b) => b.count > 0);
  const ece = nonEmptyBins.reduce(
    (sum, b) => sum + (b.count / n) * Math.abs(b.avgOutcome - b.avgConfidence),
    0,
  );

  // MCE: max calibration error across bins
  const mce = nonEmptyBins.reduce(
    (max, b) => Math.max(max, Math.abs(b.avgOutcome - b.avgConfidence)),
    0,
  );

  // Brier score
  const brierScore = agentData.reduce(
    (sum, d) => sum + Math.pow(d.confidence - d.outcome, 2),
    0,
  ) / n;

  // Check monotonic calibration
  const monotonicCalibration = checkMonotonic(nonEmptyBins);

  // Over/under-confidence ratios
  let overconfidentCount = 0;
  let underconfidentCount = 0;
  for (const bin of nonEmptyBins) {
    if (bin.avgConfidence > bin.avgOutcome + CONFIDENCE_GAP_THRESHOLD) {
      overconfidentCount += bin.count;
    } else if (bin.avgOutcome > bin.avgConfidence + CONFIDENCE_GAP_THRESHOLD) {
      underconfidentCount += bin.count;
    }
  }

  const overconfidenceRatio = n > 0 ? overconfidentCount / n : 0;
  const underconfidenceRatio = n > 0 ? underconfidentCount / n : 0;

  // Suggested calibration factor
  const avgConfidence = agentData.reduce((s, d) => s + d.confidence, 0) / n;
  const avgOutcome = agentData.reduce((s, d) => s + d.outcome, 0) / n;
  const suggestedCalibrationFactor = avgConfidence > 0
    ? Math.round((avgOutcome / avgConfidence) * 100) / 100
    : 1;

  // Grade
  const grade = gradeCalibration(ece, brierScore, monotonicCalibration);
  const assessment = assessCalibration(ece, overconfidenceRatio, underconfidenceRatio, monotonicCalibration);

  return {
    agentId,
    totalDataPoints: n,
    ece: round3(ece),
    mce: round3(mce),
    brierScore: round3(brierScore),
    monotonicCalibration,
    overconfidenceRatio: round3(overconfidenceRatio),
    underconfidenceRatio: round3(underconfidenceRatio),
    reliabilityDiagram,
    grade,
    assessment,
    suggestedCalibrationFactor,
  };
}

/**
 * Compare calibration quality across all agents.
 */
export function compareAgentCalibration(): {
  agents: CalibrationAnalysis[];
  bestCalibrated: string | null;
  worstCalibrated: string | null;
  rankings: { agentId: string; ece: number; rank: number }[];
} {
  const agentIds = [...new Set(calibrationData.map((d) => d.agentId))];
  const agents = agentIds.map((id) => analyzeCalibration(id));

  // Rank by ECE (lower is better)
  const ranked = agents
    .filter((a) => a.totalDataPoints >= 5)
    .sort((a, b) => a.ece - b.ece);

  const rankings = ranked.map((a, i) => ({
    agentId: a.agentId,
    ece: a.ece,
    rank: i + 1,
  }));

  return {
    agents,
    bestCalibrated: ranked.length > 0 ? ranked[0].agentId : null,
    worstCalibrated: ranked.length > 0 ? ranked[ranked.length - 1].agentId : null,
    rankings,
  };
}

/**
 * Get the raw calibration data for an agent (for exports).
 */
export function getCalibrationData(agentId?: string): CalibrationDataPoint[] {
  if (agentId) return calibrationData.filter((d) => d.agentId === agentId);
  return [...calibrationData];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function checkMonotonic(bins: ReliabilityDiagramPoint[]): boolean {
  if (bins.length < 2) return true;

  // Allow small violations (configurable tolerance)
  let prevAccuracy = bins[0].avgOutcome;
  for (let i = 1; i < bins.length; i++) {
    if (bins[i].avgOutcome < prevAccuracy - MONOTONIC_TOLERANCE) {
      return false;
    }
    prevAccuracy = bins[i].avgOutcome;
  }
  return true;
}

function gradeCalibration(
  ece: number,
  brierScore: number,
  monotonic: boolean,
): string {
  const compositeScore = 1 - ece * GRADE_WEIGHT_ECE - brierScore * GRADE_WEIGHT_BRIER - (monotonic ? 0 : GRADE_PENALTY_NON_MONOTONIC);

  if (compositeScore >= GRADE_THRESHOLD_A_PLUS) return "A+";
  if (compositeScore >= GRADE_THRESHOLD_A) return "A";
  if (compositeScore >= GRADE_THRESHOLD_A_MINUS) return "A-";
  if (compositeScore >= GRADE_THRESHOLD_B_PLUS) return "B+";
  if (compositeScore >= GRADE_THRESHOLD_B) return "B";
  if (compositeScore >= GRADE_THRESHOLD_B_MINUS) return "B-";
  if (compositeScore >= GRADE_THRESHOLD_C_PLUS) return "C+";
  if (compositeScore >= GRADE_THRESHOLD_C) return "C";
  if (compositeScore >= GRADE_THRESHOLD_D) return "D";
  return "F";
}

function assessCalibration(
  ece: number,
  overconfidenceRatio: number,
  underconfidenceRatio: number,
  monotonic: boolean,
): string {
  const parts: string[] = [];

  if (ece < ECE_EXCELLENT_THRESHOLD) {
    parts.push("Excellent calibration — confidence closely matches actual accuracy.");
  } else if (ece < ECE_GOOD_THRESHOLD) {
    parts.push("Good calibration — minor gaps between confidence and accuracy.");
  } else if (ece < ECE_MODERATE_THRESHOLD) {
    parts.push("Moderate calibration — noticeable gap between stated and actual confidence.");
  } else {
    parts.push("Poor calibration — confidence does not predict accuracy well.");
  }

  if (overconfidenceRatio > OVERCONFIDENCE_RATIO_HIGH) {
    parts.push("Frequently overconfident — accuracy is lower than stated confidence suggests.");
  } else if (underconfidenceRatio > UNDERCONFIDENCE_RATIO_HIGH) {
    parts.push("Somewhat underconfident — performs better than its confidence suggests.");
  }

  if (!monotonic) {
    parts.push("Non-monotonic: higher confidence does not consistently predict better outcomes.");
  }

  return parts.join(" ");
}

function emptyAnalysis(agentId: string): CalibrationAnalysis {
  return {
    agentId,
    totalDataPoints: 0,
    ece: 0,
    mce: 0,
    brierScore: 0,
    monotonicCalibration: true,
    overconfidenceRatio: 0,
    underconfidenceRatio: 0,
    reliabilityDiagram: [],
    grade: "N/A",
    assessment: "No calibration data available yet.",
    suggestedCalibrationFactor: 1,
  };
}
