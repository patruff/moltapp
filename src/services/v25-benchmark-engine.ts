/**
 * v25 Benchmark Engine — Outcome Prediction & Consensus Intelligence
 *
 * The analytical core of v25. Adds two new dimensions:
 *
 * D9:  OUTCOME PREDICTION — Does the agent's predicted outcome match reality?
 *      - Parse predicted direction and magnitude from reasoning text
 *      - Compare against actual price movement after N rounds
 *      - Score directional accuracy + magnitude accuracy
 *
 * D10: CONSENSUS INTELLIGENCE — How does the agent think relative to peers?
 *      - Agreement rate: how often does agent agree with majority?
 *      - Contrarian success: when agent disagrees, is it right?
 *      - Reasoning similarity: does agent copy peer reasoning?
 *      - Independent thinking: unique reasoning + independent decisions
 *
 * Combined with v24's 8 dimensions, v25 delivers the complete 10-dimension
 * MoltApp AI Trading Benchmark.
 */

import type { MarketData } from "../agents/base-agent.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Confidence in Prediction Classification Thresholds
 *
 * These thresholds classify how definitive an agent's prediction language is.
 * Used by parsePrediction() to assign confidence based on linguistic markers.
 */

/** High confidence threshold (90%): "will", "definitely", "certain", "strongly expect" */
const CONFIDENCE_PREDICTION_HIGH = 0.9;

/** Moderate confidence threshold (70%): "expect", "should", "likely", "probably" */
const CONFIDENCE_PREDICTION_MODERATE = 0.7;

/** Low confidence threshold (40%): "might", "could", "possibly" */
const CONFIDENCE_PREDICTION_LOW = 0.4;

/** Default confidence (50%): neutral/ambiguous language */
const CONFIDENCE_PREDICTION_DEFAULT = 0.5;

/**
 * Outcome Prediction Scoring Weights
 *
 * These weights determine how directional accuracy, magnitude accuracy,
 * confidence, and timeframe specification contribute to overall prediction quality.
 */

/** Weight for directional accuracy in prediction quality (60%): most important component */
const PREDICTION_WEIGHT_DIRECTIONAL = 0.6;

/** Weight for magnitude accuracy in prediction quality (30%): quantitative precision */
const PREDICTION_WEIGHT_MAGNITUDE = 0.3;

/** Weight for confidence component in prediction quality (10%): reward making predictions */
const PREDICTION_WEIGHT_CONFIDENCE = 0.1;

/** Bonus for specifying timeframe (5%): additional precision for time-bound predictions */
const PREDICTION_TIMEFRAME_BONUS = 0.05;

/** Partial directional accuracy score (30%): when prediction is close but not exact */
const PREDICTION_PARTIAL_ACCURACY = 0.3;

/** Neutral score for unspecified predictions (50%): agent didn't make a prediction */
const PREDICTION_UNSPECIFIED_NEUTRAL = 0.5;

/** Penalty for not making a prediction (30%): encourage agents to make predictions */
const PREDICTION_UNSPECIFIED_PENALTY = 0.3;

/**
 * Consensus Intelligence Scoring Weights
 *
 * These weights determine how reasoning uniqueness and contrarian behavior
 * contribute to the independent thinking score.
 */

/** Weight for reasoning uniqueness in independent thinking (70%): primary component */
const CONSENSUS_WEIGHT_UNIQUENESS = 0.7;

/** Weight for contrarian behavior in independent thinking (30%): bonus for disagreement */
const CONSENSUS_WEIGHT_CONTRARIAN = 0.3;

/** Contrarian bonus multiplier (30%): additional credit when agent disagrees with majority */
const CONSENSUS_CONTRARIAN_BONUS = 0.3;

/**
 * v25 Composite Score Grade Boundaries
 *
 * These thresholds classify agent performance into letter grades.
 * Used by computeV25CompositeScore() to assign S/A/B/C/D/F grades.
 */

/** S-tier threshold (85+): exceptional performance across all 10 dimensions */
const GRADE_THRESHOLD_S = 85;

/** A-tier threshold (75-84): excellent performance */
const GRADE_THRESHOLD_A = 75;

/** B-tier threshold (60-74): good performance */
const GRADE_THRESHOLD_B = 60;

/** C-tier threshold (45-59): average performance */
const GRADE_THRESHOLD_C = 45;

/** D-tier threshold (30-44): below average, F-tier < 30 */
const GRADE_THRESHOLD_D = 30;

/**
 * v25 Composite Score Dimension Weights
 *
 * These weights determine how each of the 10 dimensions contributes to the
 * overall composite score. Total must equal 100%.
 */

/** Weight for P&L dimension (15%): financial performance */
const COMPOSITE_WEIGHT_PNL = 15;

/** Weight for coherence dimension (12%): reasoning quality */
const COMPOSITE_WEIGHT_COHERENCE = 12;

/** Weight for hallucination-free dimension (12%): data accuracy */
const COMPOSITE_WEIGHT_HALLUCINATION_FREE = 12;

/** Weight for discipline dimension (10%): rules compliance */
const COMPOSITE_WEIGHT_DISCIPLINE = 10;

/** Weight for calibration dimension (8%): confidence accuracy */
const COMPOSITE_WEIGHT_CALIBRATION = 8;

/** Weight for prediction dimension (8%): forward-looking analysis */
const COMPOSITE_WEIGHT_PREDICTION = 8;

/** Weight for reasoning depth dimension (10%): analysis thoroughness */
const COMPOSITE_WEIGHT_REASONING_DEPTH = 10;

/** Weight for source quality dimension (8%): evidence quality */
const COMPOSITE_WEIGHT_SOURCE_QUALITY = 8;

/** Weight for outcome prediction dimension (9%): D9 prediction accuracy */
const COMPOSITE_WEIGHT_OUTCOME_PREDICTION = 9;

/** Weight for consensus intelligence dimension (8%): D10 independent thinking */
const COMPOSITE_WEIGHT_CONSENSUS_INTELLIGENCE = 8;

/**
 * P&L Normalization Parameters
 *
 * These values control how P&L percentages are normalized to 0-1 scale.
 * Formula: pnlNorm = max(0, min(1, (pnl + 50) / 150))
 */

/** P&L normalization floor (-50%): worst-case P&L for normalization */
const PNL_NORMALIZATION_FLOOR = -50;

/** P&L normalization ceiling (+100%): best-case P&L for normalization */
const PNL_NORMALIZATION_CEILING = 100;

/** P&L normalization range (150%): total range from floor to ceiling */
const PNL_NORMALIZATION_RANGE = 150;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PredictionAnalysis {
  predictedDirection: "up" | "down" | "flat" | "unspecified";
  predictedMagnitude: number | null;
  timeframeSpecified: string | null;
  confidenceInPrediction: number;
}

export interface OutcomePredictionResult {
  directionalAccuracy: number;
  magnitudeAccuracy: number;
  predictionQuality: number;
}

export interface ConsensusAnalysis {
  agreedWithMajority: number;
  wasContrarian: number;
  reasoningSimilarity: number;
  independentThinkingScore: number;
  confidenceDelta: number;
}

export interface V25RoundAgentData {
  agentId: string;
  action: string;
  symbol: string;
  reasoning: string;
  confidence: number;
  predictedOutcome?: string | null;
}

export interface V25CompositeScore {
  composite: number;
  grade: string;
  dimensions: {
    pnl: number;
    coherence: number;
    hallucinationFree: number;
    discipline: number;
    calibration: number;
    prediction: number;
    reasoningDepth: number;
    sourceQuality: number;
    outcomePrediction: number;
    consensusIntelligence: number;
  };
}

// ---------------------------------------------------------------------------
// D9: Outcome Prediction Analysis
// ---------------------------------------------------------------------------

/**
 * Parse a predicted outcome from agent reasoning or explicit prediction field.
 *
 * Looks for patterns like:
 * - "I expect the price to rise by 3-5%"
 * - "Target: +5% in 48h"
 * - "Expecting continued downside to $150"
 * - "Price should consolidate around current levels"
 */
export function parsePrediction(
  reasoning: string,
  predictedOutcome?: string | null,
): PredictionAnalysis {
  const text = predictedOutcome
    ? `${predictedOutcome} ${reasoning}`
    : reasoning;

  const lower = text.toLowerCase();

  // Direction detection
  let predictedDirection: PredictionAnalysis["predictedDirection"] = "unspecified";

  const upPatterns = /\b(expect(?:ing)?\s+(?:continued\s+)?(?:up|rise|gain|increase|appreciation|growth|bullish|higher|upside))|(?:target.*\+\d)|(?:price\s+(?:will|should|to)\s+(?:rise|increase|go\s+up|climb|rally))/i;
  const downPatterns = /\b(expect(?:ing)?\s+(?:continued\s+)?(?:down|fall|decline|decrease|depreciation|bearish|lower|downside))|(?:target.*-\d)|(?:price\s+(?:will|should|to)\s+(?:fall|decrease|go\s+down|drop|decline))/i;
  const flatPatterns = /\b(consolidat|sideways|range-?bound|stable|flat|neutral|no\s+significant\s+move)/i;

  if (upPatterns.test(text)) {
    predictedDirection = "up";
  } else if (downPatterns.test(text)) {
    predictedDirection = "down";
  } else if (flatPatterns.test(text)) {
    predictedDirection = "flat";
  }

  // Magnitude detection (look for percentage predictions)
  let predictedMagnitude: number | null = null;
  const magnitudeMatch = text.match(/[+-]?\s*(\d+(?:\.\d+)?)\s*%/);
  if (magnitudeMatch) {
    const value = parseFloat(magnitudeMatch[1]);
    if (predictedDirection === "down") {
      predictedMagnitude = -value;
    } else if (predictedDirection === "up") {
      predictedMagnitude = value;
    } else {
      // Use sign if present
      const fullMatch = magnitudeMatch[0];
      predictedMagnitude = fullMatch.includes("-") ? -value : value;
    }
  }

  // Timeframe detection
  let timeframeSpecified: string | null = null;
  const timePatterns: [RegExp, string][] = [
    [/\b(\d+)\s*h(?:our)?s?\b/i, "hours"],
    [/\b(\d+)\s*d(?:ay)?s?\b/i, "days"],
    [/\b(\d+)\s*w(?:eek)?s?\b/i, "weeks"],
    [/\bnext\s+(?:trading\s+)?session\b/i, "1_session"],
    [/\bshort[\s-]?term\b/i, "short_term"],
    [/\bmedium[\s-]?term\b/i, "medium_term"],
    [/\blong[\s-]?term\b/i, "long_term"],
    [/\bovernight\b/i, "overnight"],
    [/\bintraday\b/i, "intraday"],
  ];

  for (const [pattern, label] of timePatterns) {
    if (pattern.test(lower)) {
      timeframeSpecified = label;
      break;
    }
  }

  // Confidence in prediction (how definitive are the words?)
  let confidenceInPrediction = CONFIDENCE_PREDICTION_DEFAULT;
  if (/\bwill\b|\bdefinitely\b|\bcertain\b|\bstrongly\s+expect/i.test(text)) {
    confidenceInPrediction = CONFIDENCE_PREDICTION_HIGH;
  } else if (/\bexpect\b|\bshould\b|\blikely\b|\bprobab/i.test(text)) {
    confidenceInPrediction = CONFIDENCE_PREDICTION_MODERATE;
  } else if (/\bmight\b|\bcould\b|\bpossib/i.test(text)) {
    confidenceInPrediction = CONFIDENCE_PREDICTION_LOW;
  }

  if (predictedDirection === "unspecified") {
    confidenceInPrediction = 0;
  }

  return {
    predictedDirection,
    predictedMagnitude,
    timeframeSpecified,
    confidenceInPrediction,
  };
}

/**
 * Score an outcome prediction after resolution.
 * Called when we know what actually happened to the price.
 */
export function scoreOutcomePrediction(
  prediction: PredictionAnalysis,
  actualDirection: "up" | "down" | "flat",
  actualMagnitude: number,
): OutcomePredictionResult {
  // If agent didn't make a prediction, score is neutral
  if (prediction.predictedDirection === "unspecified") {
    return {
      directionalAccuracy: PREDICTION_UNSPECIFIED_NEUTRAL,
      magnitudeAccuracy: PREDICTION_UNSPECIFIED_NEUTRAL,
      predictionQuality: PREDICTION_UNSPECIFIED_PENALTY, // Penalty for not making a prediction
    };
  }

  // Directional accuracy
  let directionalAccuracy = 0;
  if (prediction.predictedDirection === actualDirection) {
    directionalAccuracy = 1.0;
  } else if (
    (prediction.predictedDirection === "up" && actualDirection === "flat") ||
    (prediction.predictedDirection === "down" && actualDirection === "flat") ||
    (prediction.predictedDirection === "flat" && actualDirection !== "flat")
  ) {
    directionalAccuracy = PREDICTION_PARTIAL_ACCURACY; // Partially right
  }

  // Magnitude accuracy (only if both predicted and actual magnitudes exist)
  let magnitudeAccuracy = PREDICTION_UNSPECIFIED_NEUTRAL;
  if (prediction.predictedMagnitude !== null && actualMagnitude !== 0) {
    const diff = Math.abs(prediction.predictedMagnitude - actualMagnitude);
    const scale = Math.max(Math.abs(actualMagnitude), 1); // Avoid div by 0
    magnitudeAccuracy = Math.max(0, 1 - diff / (scale * 2));
  }

  // Timeframe bonus: agents that specify timeframes get a small boost
  const timeframeBonus = prediction.timeframeSpecified ? 0.05 : 0;

  // Composite prediction quality
  const predictionQuality = Math.min(
    1,
    directionalAccuracy * 0.6 +
    magnitudeAccuracy * 0.3 +
    (prediction.confidenceInPrediction > 0 ? 0.1 : 0) +
    timeframeBonus,
  );

  return {
    directionalAccuracy: Math.round(directionalAccuracy * 100) / 100,
    magnitudeAccuracy: Math.round(magnitudeAccuracy * 100) / 100,
    predictionQuality: Math.round(predictionQuality * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// D10: Consensus Intelligence Analysis
// ---------------------------------------------------------------------------

/**
 * Analyze an agent's behavior relative to the group in a given round.
 *
 * @param agent - The agent being analyzed
 * @param allAgents - All agents in this round (including the analyzed agent)
 */
export function analyzeConsensusIntelligence(
  agent: V25RoundAgentData,
  allAgents: V25RoundAgentData[],
): ConsensusAnalysis {
  const otherAgents = allAgents.filter((a) => a.agentId !== agent.agentId);
  if (otherAgents.length === 0) {
    return {
      agreedWithMajority: 1,
      wasContrarian: 0,
      reasoningSimilarity: 0,
      independentThinkingScore: 1,
      confidenceDelta: 0,
    };
  }

  // Count actions to find majority
  const actionCounts: Record<string, number> = {};
  for (const a of allAgents) {
    actionCounts[a.action] = (actionCounts[a.action] ?? 0) + 1;
  }
  const majorityAction = Object.entries(actionCounts).sort(
    (a, b) => b[1] - a[1],
  )[0][0];

  const agreedWithMajority = agent.action === majorityAction ? 1 : 0;
  const wasContrarian = 1 - agreedWithMajority;

  // Confidence delta: how different is this agent's confidence from the group?
  const avgConfidence =
    allAgents.reduce((s, a) => s + a.confidence, 0) / allAgents.length;
  const confidenceDelta = agent.confidence - avgConfidence;

  // Reasoning similarity: jaccard similarity of word sets
  const agentWords = new Set(
    agent.reasoning
      .toLowerCase()
      .replace(/[^\w\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 3),
  );

  let maxSimilarity = 0;
  let totalSimilarity = 0;

  for (const other of otherAgents) {
    const otherWords = new Set(
      other.reasoning
        .toLowerCase()
        .replace(/[^\w\s]/g, "")
        .split(/\s+/)
        .filter((w) => w.length > 3),
    );

    // Jaccard similarity
    const intersection = new Set([...agentWords].filter((w) => otherWords.has(w)));
    const union = new Set([...agentWords, ...otherWords]);
    const similarity = union.size > 0 ? intersection.size / union.size : 0;

    totalSimilarity += similarity;
    maxSimilarity = Math.max(maxSimilarity, similarity);
  }

  const reasoningSimilarity =
    Math.round((totalSimilarity / otherAgents.length) * 100) / 100;

  // Independent thinking score:
  // High: unique reasoning + independent action (contrarian with different reasoning)
  // Low: similar reasoning + same action as majority (herd behavior)
  const uniquenessBonus = 1 - reasoningSimilarity;
  const contrarianBonus = wasContrarian * 0.3;
  const independentThinkingScore = Math.min(
    1,
    Math.round((uniquenessBonus * 0.7 + contrarianBonus) * 100) / 100,
  );

  return {
    agreedWithMajority,
    wasContrarian,
    reasoningSimilarity,
    independentThinkingScore,
    confidenceDelta: Math.round(confidenceDelta * 100) / 100,
  };
}

/**
 * Determine the majority action and symbol from a round's agents.
 */
export function computeMajorityAction(
  agents: V25RoundAgentData[],
): { majorityAction: string; majoritySymbol: string; actionBreakdown: Record<string, number>; symbolBreakdown: Record<string, number>; avgConfidence: number; agreementRate: number } {
  const actions: Record<string, number> = {};
  const symbols: Record<string, number> = {};
  let totalConfidence = 0;

  for (const a of agents) {
    actions[a.action] = (actions[a.action] ?? 0) + 1;
    symbols[a.symbol] = (symbols[a.symbol] ?? 0) + 1;
    totalConfidence += a.confidence;
  }

  const majorityAction = Object.entries(actions).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "hold";
  const majoritySymbol = Object.entries(symbols).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "SPYx";
  const avgConfidence = agents.length > 0 ? totalConfidence / agents.length : 0;

  // Agreement rate: fraction of agents that took the majority action
  const majorityCount = actions[majorityAction] ?? 0;
  const agreementRate = agents.length > 0 ? majorityCount / agents.length : 1;

  return {
    majorityAction,
    majoritySymbol,
    actionBreakdown: actions,
    symbolBreakdown: symbols,
    avgConfidence: Math.round(avgConfidence * 100) / 100,
    agreementRate: Math.round(agreementRate * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// v25 Composite Scoring — 10 Dimensions
// ---------------------------------------------------------------------------

/**
 * Compute the v25 10-dimension composite score.
 *
 * Weights:
 *   D1  P&L:               15%
 *   D2  Coherence:          12%
 *   D3  Hallucination-free: 12%
 *   D4  Discipline:         10%
 *   D5  Calibration:         8%
 *   D6  Prediction:          8%
 *   D7  Reasoning Depth:    10%
 *   D8  Source Quality:       8%
 *   D9  Outcome Prediction:   9%
 *   D10 Consensus Intel:      8%
 *   Total:                  100%
 */
export function computeV25CompositeScore(dimensions: {
  pnl: number;
  coherence: number;
  hallucinationFree: number;
  discipline: number;
  calibration: number;
  prediction: number;
  reasoningDepth: number;
  sourceQuality: number;
  outcomePrediction: number;
  consensusIntelligence: number;
}): V25CompositeScore {
  // Normalize P&L: clamp to [-50, +100] range, then map to 0-1
  const pnlNorm = Math.max(0, Math.min(1, (dimensions.pnl + 50) / 150));

  const weighted =
    pnlNorm * 15 +
    dimensions.coherence * 12 +
    dimensions.hallucinationFree * 12 +
    dimensions.discipline * 10 +
    dimensions.calibration * 8 +
    dimensions.prediction * 8 +
    dimensions.reasoningDepth * 10 +
    dimensions.sourceQuality * 8 +
    dimensions.outcomePrediction * 9 +
    dimensions.consensusIntelligence * 8;

  const composite = Math.round(weighted * 100) / 100;

  // Grade assignment
  let grade: string;
  if (composite >= 85) grade = "S";
  else if (composite >= 75) grade = "A";
  else if (composite >= 60) grade = "B";
  else if (composite >= 45) grade = "C";
  else if (composite >= 30) grade = "D";
  else grade = "F";

  return {
    composite,
    grade,
    dimensions,
  };
}

/**
 * Grade letter for display.
 */
export function gradeColor(grade: string): string {
  switch (grade) {
    case "S": return "#FFD700";
    case "A": return "#4CAF50";
    case "B": return "#2196F3";
    case "C": return "#FF9800";
    case "D": return "#F44336";
    default: return "#9E9E9E";
  }
}
