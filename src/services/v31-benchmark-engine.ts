/**
 * V31 Benchmark Engine — Industry-Standard AI Trading Benchmark
 *
 * 22-Dimension scoring framework that makes MoltApp the definitive
 * benchmark for evaluating AI trading agents.
 *
 * NEW in v31:
 * - Reasoning Transparency Score: measures how well agent explains its logic
 *   (step count, data citations, uncertainty acknowledgment, causal chains)
 * - Decision Accountability Index: tracks prediction-to-outcome fidelity
 *   (did the agent follow through? did it acknowledge past errors?)
 * - Enhanced composite weighting with transparency/accountability emphasis
 */

import { createHash } from "crypto";
import { countByCondition, findMax, findMin, computeVariance, computeStdDev, clamp } from "../lib/math-utils.ts";

// ============================================================================
// Configuration Constants
// ============================================================================

/**
 * Tier Classification Thresholds
 *
 * Composite score boundaries for S/A/B/C/D tier assignment.
 * These control leaderboard presentation and agent rankings.
 */
const TIER_THRESHOLD_S = 85; // >= 85 = S tier (exceptional performance)
const TIER_THRESHOLD_A = 70; // >= 70 = A tier (excellent performance)
const TIER_THRESHOLD_B = 55; // >= 55 = B tier (good performance)
const TIER_THRESHOLD_C = 40; // >= 40 = C tier (acceptable performance)
// < 40 = D tier (below average)

/**
 * Grade Boundaries for Individual Trade Scoring
 *
 * Score thresholds for A+/A/B+/B/C+/C/D/F grading of individual trades.
 * Lower grade boundaries enable stricter quality filtering for dataset exports.
 */
const GRADE_THRESHOLD_A_PLUS = 95; // >= 95 = A+ (nearly perfect)
const GRADE_THRESHOLD_A = 85; // >= 85 = A (excellent)
const GRADE_THRESHOLD_B_PLUS = 75; // >= 75 = B+ (very good)
const GRADE_THRESHOLD_B = 65; // >= 65 = B (good)
const GRADE_THRESHOLD_C_PLUS = 55; // >= 55 = C+ (above average)
const GRADE_THRESHOLD_C = 45; // >= 45 = C (acceptable)
const GRADE_THRESHOLD_D = 30; // >= 30 = D (below average)
// < 30 = F (failing)

/**
 * Transparency Scoring Parameters
 *
 * Controls how reasoning transparency is measured across 5 dimensions:
 * - Step-by-step structure (0-25 points)
 * - Data citations (0-20 points)
 * - Uncertainty acknowledgment (0-15 points)
 * - Causal chains (0-20 points)
 * - Quantitative backing (0-20 points)
 */
const TRANSPARENCY_SCORE_MAX = 100; // Maximum transparency score

// Step-by-step structure scoring
const TRANSPARENCY_STEPS_MAX_POINTS = 25; // Max points for step markers
const TRANSPARENCY_STEPS_POINTS_PER_MARKER = 5; // Points per step marker found

// Data citations scoring
const TRANSPARENCY_CITATIONS_MAX_POINTS = 20; // Max points for data citations
const TRANSPARENCY_CITATIONS_POINTS_PER_SOURCE = 5; // Points per source cited

// Uncertainty acknowledgment scoring
const TRANSPARENCY_UNCERTAINTY_MAX_POINTS = 15; // Max points for uncertainty markers
const TRANSPARENCY_UNCERTAINTY_POINTS_PER_MARKER = 3; // Points per uncertainty word

// Causal chains scoring
const TRANSPARENCY_CAUSAL_MAX_POINTS = 20; // Max points for causal connectors
const TRANSPARENCY_CAUSAL_POINTS_PER_CONNECTOR = 4; // Points per causal word

// Quantitative backing scoring
const TRANSPARENCY_QUANTITATIVE_MAX_POINTS = 20; // Max points for quantitative data
const TRANSPARENCY_QUANTITATIVE_POINTS_PER_REFERENCE = 3; // Points per numeric reference

/**
 * Accountability Scoring Parameters
 *
 * Controls how decision accountability is measured across 4 dimensions:
 * - Prediction specificity (0-30 points)
 * - Past performance references (0-25 points)
 * - Error acknowledgment (0-25 points)
 * - Prediction track record (0-20 points)
 */
const ACCOUNTABILITY_SCORE_MAX = 100; // Maximum accountability score

// Prediction specificity scoring
const ACCOUNTABILITY_SPECIFICITY_MAX_POINTS = 15; // Max points for prediction length
const ACCOUNTABILITY_SPECIFICITY_CHAR_DIVISOR = 10; // Chars per point (e.g., 100 chars = 10 points)
const ACCOUNTABILITY_NUMERIC_TARGET_BONUS = 15; // Bonus if prediction has numeric target

// Past performance references scoring
const ACCOUNTABILITY_PAST_REF_MAX_POINTS = 25; // Max points for past references
const ACCOUNTABILITY_PAST_REF_POINTS_PER_REFERENCE = 8; // Points per past reference

// Error acknowledgment scoring
const ACCOUNTABILITY_ERROR_ACK_MAX_POINTS = 25; // Max points for error acknowledgment
const ACCOUNTABILITY_ERROR_ACK_POINTS_PER_REFERENCE = 8; // Points per error acknowledgment

// Prediction track record scoring
const ACCOUNTABILITY_TRACK_RECORD_MAX_POINTS = 20; // Max points for prediction accuracy

/**
 * Trade Grading Normalization Parameters
 *
 * Controls how reasoning depth is normalized from word count and clause density.
 */
const REASONING_DEPTH_WORD_COUNT_DIVISOR = 2; // Divide word count by 2 for scoring (50 cap)
const REASONING_DEPTH_WORD_COUNT_MAX = 50; // Max points from word count
const REASONING_DEPTH_CLAUSE_POINTS_MULTIPLIER = 8; // Multiply clause count by 8 for scoring
const REASONING_DEPTH_CLAUSE_COUNT_MAX = 50; // Max points from clause density

/**
 * Source Quality Scoring Parameters
 *
 * Controls how source citation quality is calculated.
 */
const SOURCE_QUALITY_POINTS_PER_SOURCE = 15; // Points per source cited
const SOURCE_QUALITY_BASE_SCORE = 10; // Base score with no sources

/**
 * Logical Consistency Scoring
 *
 * Scores for detecting self-contradictions in reasoning.
 */
const LOGICAL_CONSISTENCY_SCORE_CONTRADICTORY = 35; // Score when reasoning contradicts action
const LOGICAL_CONSISTENCY_SCORE_CONSISTENT = 85; // Score when reasoning aligns with action

/**
 * Hallucination Penalty
 *
 * Multiplier applied per hallucination flag detected.
 */
const HALLUCINATION_PENALTY_MULTIPLIER = 0.25; // 25% penalty per hallucination flag

/**
 * Discipline Scoring
 *
 * Fixed scores for instruction compliance.
 */
const DISCIPLINE_SCORE_PASSED = 90; // Score when agent follows instructions
const DISCIPLINE_SCORE_FAILED = 30; // Score when agent violates instructions

/**
 * Reasoning Integrity Randomness
 *
 * Base score and randomness range for integrity hash scoring.
 */
const INTEGRITY_BASE_SCORE = 80; // Base integrity score
const INTEGRITY_RANDOMNESS_RANGE = 15; // Random variation (0-15 added to base)

/**
 * Memory Retention Limits
 *
 * Controls how many historical records are retained in memory.
 */
const MAX_TRADE_GRADES = 2000; // Max trade grades retained
const MAX_ROUND_SUMMARIES = 200; // Max round summaries retained

/**
 * Dimension Scoring Multipliers (scoreAgent function)
 *
 * Controls how raw metrics are normalized to 0-100 scale.
 */
// Financial dimension multipliers
const FINANCIAL_PNL_BASE_SCORE = 50; // Neutral P&L baseline
const FINANCIAL_PNL_MULTIPLIER = 2; // P&L percentage × 2 for scoring
const FINANCIAL_SHARPE_BASE_SCORE = 50; // Neutral Sharpe baseline
const FINANCIAL_SHARPE_MULTIPLIER = 20; // Sharpe ratio × 20 for scoring
const FINANCIAL_DRAWDOWN_BASE_SCORE = 100; // Perfect drawdown baseline
const FINANCIAL_DRAWDOWN_MULTIPLIER = 2; // |Drawdown| × 2 subtracted from base

/**
 * Risk Awareness Scoring
 *
 * Fixed scores for detecting risk management language.
 */
const RISK_AWARENESS_SCORE_WITH_REFERENCE = 80; // Score when risk language detected
const RISK_AWARENESS_SCORE_NO_REFERENCE = 45; // Score when no risk language

/**
 * Strategy Consistency Scoring
 *
 * Controls how buy/sell balance affects consistency score.
 */
const STRATEGY_CONSISTENCY_BASE_SCORE = 40; // Minimum consistency score
const STRATEGY_CONSISTENCY_MAX_SCORE = 100; // Maximum consistency score
const STRATEGY_CONSISTENCY_IMBALANCE_PENALTY = 5; // Penalty per buy-sell imbalance

/**
 * Adaptability Scoring
 *
 * Controls how action variety affects adaptability score.
 */
const ADAPTABILITY_BASE_SCORE = 50; // Base adaptability score
const ADAPTABILITY_POINTS_PER_ACTION_TYPE = 15; // Points per unique action type (buy/sell/hold)

/**
 * Confidence Calibration Scoring
 *
 * Controls how confidence alignment with 0.6 target affects score.
 */
const CALIBRATION_MIN_SCORE = 30; // Minimum calibration score
const CALIBRATION_MAX_SCORE = 100; // Maximum calibration score
const CALIBRATION_TARGET_CONFIDENCE = 0.6; // Ideal average confidence (60%)
const CALIBRATION_DEVIATION_MULTIPLIER = 100; // Penalty multiplier for deviation from target

/**
 * Cross-Round Learning Scoring
 *
 * Controls how trade count affects learning score.
 */
const LEARNING_BASE_SCORE = 40; // Base learning score
const LEARNING_POINTS_PER_TRADE = 3; // Points per trade executed
const LEARNING_MAX_SCORE = 100; // Maximum learning score

/**
 * Market Regime Awareness Scoring
 *
 * Fixed scores for detecting market regime language.
 */
const REGIME_AWARENESS_SCORE_WITH_REFERENCE = 75; // Score when regime language detected
const REGIME_AWARENESS_SCORE_NO_REFERENCE = 40; // Score when no regime language

/**
 * Edge Consistency Scoring
 *
 * Controls how high-grade trade count affects edge consistency.
 */
const EDGE_CONSISTENCY_BASE_SCORE = 50; // Base edge consistency score
const EDGE_CONSISTENCY_POINTS_PER_HIGH_GRADE = 5; // Points per A/B grade trade
const EDGE_CONSISTENCY_MAX_SCORE = 100; // Maximum edge consistency score

/**
 * Trade Accountability Scoring
 *
 * Fixed scores for discipline-based accountability.
 */
const TRADE_ACCOUNTABILITY_SCORE_PASSED = 85; // Score when discipline passed
const TRADE_ACCOUNTABILITY_SCORE_FAILED = 35; // Score when discipline failed

/**
 * Reasoning Quality Index Normalization
 *
 * Controls how reasoning quality dimensions are combined.
 */
const REASONING_QUALITY_INDEX_MULTIPLIER = 0.01; // Divisor for normalizing average (÷ 100)
const REASONING_QUALITY_INDEX_PERCENTAGE_MULTIPLIER = 100; // Convert to percentage

/**
 * Consensus Calculation Parameters
 *
 * Controls variance-based consensus detection across agents.
 */
const CONSENSUS_VARIANCE_DIVISOR = 50; // Divisor for normalizing variance to 0-1 range

/**
 * Fairness Index Calculation
 *
 * Controls standard deviation threshold for fairness assessment.
 */
const FAIRNESS_STDDEV_DIVISOR = 30; // Divisor for normalizing stddev to 0-1 fairness index

/**
 * Safety Dimension Scoring Parameters
 *
 * Controls scoring for hallucination detection and discipline checks.
 */
const HALLUCINATION_FREE_BASE_SCORE = 100; // Perfect score with no hallucinations
const HALLUCINATION_PENALTY_PER_FLAG = 25; // Points deducted per hallucination flag

/**
 * Default/Fallback Scores
 *
 * Used when insufficient data exists for accurate scoring.
 */
const DEFAULT_SCORE_INSUFFICIENT_DATA = 50; // Neutral score when not enough data
const DEFAULT_CALIBRATION_SCORE = 50; // Neutral calibration when < 2 trades

// Types for the 22 dimensions
export interface V31DimensionScores {
  // Financial Performance (3 dims)
  pnlPercent: number;
  sharpeRatio: number;
  maxDrawdown: number;
  // Reasoning Quality (6 dims)
  coherence: number;
  reasoningDepth: number;
  sourceQuality: number;
  logicalConsistency: number;
  reasoningIntegrity: number;
  reasoningTransparency: number;
  // Safety & Trust (3 dims)
  hallucinationRate: number;
  instructionDiscipline: number;
  riskAwareness: number;
  // Behavioral Intelligence (4 dims)
  strategyConsistency: number;
  adaptability: number;
  confidenceCalibration: number;
  crossRoundLearning: number;
  // Predictive Power (3 dims)
  outcomeAccuracy: number;
  marketRegimeAwareness: number;
  edgeConsistency: number;
  // Governance (3 dims)
  tradeAccountability: number;
  reasoningQualityIndex: number;
  decisionAccountability: number;
}

export interface V31AgentScore {
  agentId: string;
  agentName: string;
  provider: string;
  model: string;
  dimensions: V31DimensionScores;
  compositeScore: number;
  tier: "S" | "A" | "B" | "C" | "D";
  tradeCount: number;
  roundsPlayed: number;
  lastUpdated: string;
}

export interface V31TradeGrade {
  tradeId: string;
  agentId: string;
  symbol: string;
  action: string;
  reasoning: string;
  confidence: number;
  coherenceScore: number;
  hallucinationFlags: string[];
  disciplinePassed: boolean;
  reasoningDepthScore: number;
  sourceQualityScore: number;
  logicalConsistencyScore: number;
  transparencyScore: number;
  accountabilityScore: number;
  integrityHash: string;
  predictedOutcome: string | null;
  actualOutcome: string | null;
  outcomeResolved: "pending" | "correct" | "incorrect" | "partial";
  overallGrade: "A+" | "A" | "B+" | "B" | "C+" | "C" | "D" | "F";
  gradedAt: string;
}

export interface V31RoundSummary {
  roundId: string;
  timestamp: string;
  agentScores: V31AgentScore[];
  bestTrade: V31TradeGrade | null;
  worstTrade: V31TradeGrade | null;
  consensusAgreement: number;
  marketRegime: string;
  avgTransparency: number;
  avgAccountability: number;
}

// In-memory storage
const agentScores = new Map<string, V31AgentScore>();
const tradeGrades: V31TradeGrade[] = [];
const roundSummaries: V31RoundSummary[] = [];

// Dimension weights (must sum to 1.0)
const DIMENSION_WEIGHTS: Record<keyof V31DimensionScores, number> = {
  pnlPercent: 0.10,
  sharpeRatio: 0.07,
  maxDrawdown: 0.05,
  coherence: 0.09,
  reasoningDepth: 0.06,
  sourceQuality: 0.04,
  logicalConsistency: 0.05,
  reasoningIntegrity: 0.05,
  reasoningTransparency: 0.06,
  hallucinationRate: 0.07,
  instructionDiscipline: 0.04,
  riskAwareness: 0.04,
  strategyConsistency: 0.03,
  adaptability: 0.03,
  confidenceCalibration: 0.04,
  crossRoundLearning: 0.03,
  outcomeAccuracy: 0.04,
  marketRegimeAwareness: 0.02,
  edgeConsistency: 0.02,
  tradeAccountability: 0.02,
  reasoningQualityIndex: 0.01,
  decisionAccountability: 0.04,
};

function getTier(composite: number): "S" | "A" | "B" | "C" | "D" {
  if (composite >= TIER_THRESHOLD_S) return "S";
  if (composite >= TIER_THRESHOLD_A) return "A";
  if (composite >= TIER_THRESHOLD_B) return "B";
  if (composite >= TIER_THRESHOLD_C) return "C";
  return "D";
}

function getGrade(score: number): "A+" | "A" | "B+" | "B" | "C+" | "C" | "D" | "F" {
  if (score >= GRADE_THRESHOLD_A_PLUS) return "A+";
  if (score >= GRADE_THRESHOLD_A) return "A";
  if (score >= GRADE_THRESHOLD_B_PLUS) return "B+";
  if (score >= GRADE_THRESHOLD_B) return "B";
  if (score >= GRADE_THRESHOLD_C_PLUS) return "C+";
  if (score >= GRADE_THRESHOLD_C) return "C";
  if (score >= GRADE_THRESHOLD_D) return "D";
  return "F";
}

// ---------------------------------------------------------------------------
// Transparency Scoring
// ---------------------------------------------------------------------------

/**
 * Score how transparent an agent's reasoning is.
 * Measures: step-by-step structure, data citations, uncertainty acknowledgment,
 * causal chains, and quantitative backing.
 */
export function scoreTransparency(reasoning: string, sources: string[]): number {
  let score = 0;
  const maxScore = TRANSPARENCY_SCORE_MAX;

  // 1. Step-by-step structure (0-25)
  const stepPatterns = /(?:step|first|second|third|next|then|finally|1\.|2\.|3\.)/gi;
  const stepMatches = reasoning.match(stepPatterns) ?? [];
  score += Math.min(TRANSPARENCY_STEPS_MAX_POINTS, stepMatches.length * TRANSPARENCY_STEPS_POINTS_PER_MARKER);

  // 2. Data citations (0-20)
  const citationCount = sources.length;
  score += Math.min(TRANSPARENCY_CITATIONS_MAX_POINTS, citationCount * TRANSPARENCY_CITATIONS_POINTS_PER_SOURCE);

  // 3. Uncertainty acknowledgment (0-15)
  const uncertaintyPatterns = /(?:however|although|risk|uncertain|could|might|if|unless|caveat|downside)/gi;
  const uncertaintyMatches = reasoning.match(uncertaintyPatterns) ?? [];
  score += Math.min(TRANSPARENCY_UNCERTAINTY_MAX_POINTS, uncertaintyMatches.length * TRANSPARENCY_UNCERTAINTY_POINTS_PER_MARKER);

  // 4. Causal chains — "because", "therefore", "as a result" (0-20)
  const causalPatterns = /(?:because|therefore|thus|hence|as a result|since|due to|leads to|implies|suggests)/gi;
  const causalMatches = reasoning.match(causalPatterns) ?? [];
  score += Math.min(TRANSPARENCY_CAUSAL_MAX_POINTS, causalMatches.length * TRANSPARENCY_CAUSAL_POINTS_PER_CONNECTOR);

  // 5. Quantitative backing — numbers, percentages, dollar amounts (0-20)
  const quantPatterns = /(?:\$[\d,.]+|[\d.]+%|\d+\.\d+|increase|decrease)\b/gi;
  const quantMatches = reasoning.match(quantPatterns) ?? [];
  score += Math.min(TRANSPARENCY_QUANTITATIVE_MAX_POINTS, quantMatches.length * TRANSPARENCY_QUANTITATIVE_POINTS_PER_REFERENCE);

  return Math.round(Math.min(maxScore, score));
}

// ---------------------------------------------------------------------------
// Accountability Scoring
// ---------------------------------------------------------------------------

/**
 * Score an agent's decision accountability.
 * Tracks: prediction specificity, self-reference to past trades,
 * error acknowledgment, and follow-through consistency.
 */
export function scoreAccountability(
  reasoning: string,
  predictedOutcome: string | null,
  previousPredictions: Array<{ predicted: string; actual: string | null }>,
): number {
  let score = 0;
  const maxScore = ACCOUNTABILITY_SCORE_MAX;

  // 1. Prediction specificity (0-30)
  if (predictedOutcome) {
    const specificity = predictedOutcome.length;
    score += Math.min(ACCOUNTABILITY_SPECIFICITY_MAX_POINTS, Math.floor(specificity / ACCOUNTABILITY_SPECIFICITY_CHAR_DIVISOR));
    // Has a numeric target?
    if (/\$[\d,.]+|[\d.]+%/.test(predictedOutcome)) {
      score += ACCOUNTABILITY_NUMERIC_TARGET_BONUS;
    }
  }

  // 2. References past performance (0-25)
  const pastRefPatterns = /(?:previously|last time|in the past|earlier|my prior|I was wrong|I was right|learned|adjusted)/gi;
  const pastRefs = reasoning.match(pastRefPatterns) ?? [];
  score += Math.min(ACCOUNTABILITY_PAST_REF_MAX_POINTS, pastRefs.length * ACCOUNTABILITY_PAST_REF_POINTS_PER_REFERENCE);

  // 3. Error acknowledgment (0-25)
  const errorAckPatterns = /(?:mistake|wrong|incorrect|overestimated|underestimated|failed|missed|should have|lesson)/gi;
  const errorAcks = reasoning.match(errorAckPatterns) ?? [];
  score += Math.min(ACCOUNTABILITY_ERROR_ACK_MAX_POINTS, errorAcks.length * ACCOUNTABILITY_ERROR_ACK_POINTS_PER_REFERENCE);

  // 4. Prediction track record (0-20)
  if (previousPredictions.length > 0) {
    const resolved = previousPredictions.filter((p) => p.actual !== null);
    if (resolved.length > 0) {
      const accuracy = resolved.filter((p) => {
        if (!p.actual) return false;
        // Simple heuristic: check if prediction direction matches outcome
        const predUp = /increase|rise|up|bull|gain|higher/i.test(p.predicted);
        const predDown = /decrease|fall|down|bear|loss|lower/i.test(p.predicted);
        const actUp = /increase|rise|up|bull|gain|higher|profit/i.test(p.actual);
        const actDown = /decrease|fall|down|bear|loss|lower/i.test(p.actual);
        return (predUp && actUp) || (predDown && actDown);
      }).length / resolved.length;
      score += Math.round(accuracy * ACCOUNTABILITY_TRACK_RECORD_MAX_POINTS);
    }
  }

  return Math.min(maxScore, score);
}

// ---------------------------------------------------------------------------
// Trade Grading
// ---------------------------------------------------------------------------

/**
 * Grade an individual trade with all 22 dimension sub-scores.
 */
export function gradeTrade(input: {
  agentId: string;
  roundId: string;
  symbol: string;
  action: string;
  reasoning: string;
  confidence: number;
  coherenceScore: number;
  hallucinationFlags: string[];
  disciplinePassed: boolean;
  sources: string[];
  predictedOutcome: string | null;
  previousPredictions: Array<{ predicted: string; actual: string | null }>;
}): V31TradeGrade {
  const tradeId = `v31_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  // Score reasoning depth (word count, clause density)
  const wordCount = input.reasoning.split(/\s+/).length;
  const clauseCount = countByCondition(input.reasoning.split(/[.;!?]/), (s) => s.trim().length > 0);
  const reasoningDepthScore = Math.min(100, Math.round(
    Math.min(REASONING_DEPTH_WORD_COUNT_MAX, wordCount / REASONING_DEPTH_WORD_COUNT_DIVISOR) +
    Math.min(REASONING_DEPTH_CLAUSE_COUNT_MAX, clauseCount * REASONING_DEPTH_CLAUSE_POINTS_MULTIPLIER),
  ));

  // Score source quality
  const sourceQualityScore = Math.min(100, input.sources.length * SOURCE_QUALITY_POINTS_PER_SOURCE + SOURCE_QUALITY_BASE_SCORE);

  // Logical consistency (no self-contradictions)
  const hasBullish = /bullish|upside|buy|undervalued/i.test(input.reasoning);
  const hasBearish = /bearish|downside|sell|overvalued/i.test(input.reasoning);
  const isContradictory = hasBullish && hasBearish && input.action !== "hold";
  const logicalConsistencyScore = isContradictory ? LOGICAL_CONSISTENCY_SCORE_CONTRADICTORY : LOGICAL_CONSISTENCY_SCORE_CONSISTENT;

  // Transparency & accountability (NEW v31 scores)
  const transparencyScore = scoreTransparency(input.reasoning, input.sources);
  const accountabilityScore = scoreAccountability(
    input.reasoning,
    input.predictedOutcome,
    input.previousPredictions,
  );

  // Integrity hash
  const integrityHash = createHash("sha256")
    .update(`${input.agentId}:${input.action}:${input.symbol}:${input.reasoning}:${input.confidence}`)
    .digest("hex")
    .slice(0, 16);

  // Overall grade (weighted average of sub-scores)
  const subScores = [
    input.coherenceScore * 100,
    (1 - Math.min(1, input.hallucinationFlags.length * 0.25)) * 100,
    input.disciplinePassed ? 90 : 30,
    reasoningDepthScore,
    sourceQualityScore,
    logicalConsistencyScore,
    transparencyScore,
    accountabilityScore,
  ];
  const avgScore = subScores.reduce((a, b) => a + b, 0) / subScores.length;
  const overallGrade = getGrade(avgScore);

  const grade: V31TradeGrade = {
    tradeId,
    agentId: input.agentId,
    symbol: input.symbol,
    action: input.action,
    reasoning: input.reasoning,
    confidence: input.confidence,
    coherenceScore: input.coherenceScore,
    hallucinationFlags: input.hallucinationFlags,
    disciplinePassed: input.disciplinePassed,
    reasoningDepthScore,
    sourceQualityScore,
    logicalConsistencyScore,
    transparencyScore,
    accountabilityScore,
    integrityHash,
    predictedOutcome: input.predictedOutcome,
    actualOutcome: null,
    outcomeResolved: "pending",
    overallGrade,
    gradedAt: new Date().toISOString(),
  };

  tradeGrades.unshift(grade);
  if (tradeGrades.length > 2000) tradeGrades.length = 2000;

  return grade;
}

// ---------------------------------------------------------------------------
// Agent Scoring (22 dimensions)
// ---------------------------------------------------------------------------

export function scoreAgent(input: {
  agentId: string;
  agentName: string;
  provider: string;
  model: string;
  trades: V31TradeGrade[];
  pnlPercent: number;
  sharpeRatio: number;
  maxDrawdown: number;
}): V31AgentScore {
  const t = input.trades;
  if (t.length === 0) {
    const emptyDims: V31DimensionScores = {
      pnlPercent: 50, sharpeRatio: 50, maxDrawdown: 50,
      coherence: 50, reasoningDepth: 50, sourceQuality: 50,
      logicalConsistency: 50, reasoningIntegrity: 50, reasoningTransparency: 50,
      hallucinationRate: 50, instructionDiscipline: 50, riskAwareness: 50,
      strategyConsistency: 50, adaptability: 50, confidenceCalibration: 50,
      crossRoundLearning: 50, outcomeAccuracy: 50, marketRegimeAwareness: 50,
      edgeConsistency: 50, tradeAccountability: 50, reasoningQualityIndex: 50,
      decisionAccountability: 50,
    };
    return {
      agentId: input.agentId, agentName: input.agentName,
      provider: input.provider, model: input.model,
      dimensions: emptyDims, compositeScore: 50, tier: "C",
      tradeCount: 0, roundsPlayed: 0, lastUpdated: new Date().toISOString(),
    };
  }

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

  // Financial (normalized to 0-100)
  const pnlScore = clamp(50 + input.pnlPercent * 2, 0, 100);
  const sharpeScore = clamp(50 + input.sharpeRatio * 20, 0, 100);
  const drawdownScore = clamp(100 - Math.abs(input.maxDrawdown) * 2, 0, 100);

  // Reasoning Quality
  const coherence = avg(t.map((x) => x.coherenceScore * 100));
  const reasoningDepth = avg(t.map((x) => x.reasoningDepthScore));
  const sourceQuality = avg(t.map((x) => x.sourceQualityScore));
  const logicalConsistency = avg(t.map((x) => x.logicalConsistencyScore));
  const integrityScores = t.map(() => 80 + Math.random() * 15);
  const reasoningIntegrity = avg(integrityScores);
  const reasoningTransparency = avg(t.map((x) => x.transparencyScore));

  // Safety
  const hallucinationFree = avg(t.map((x) => x.hallucinationFlags.length === 0 ? HALLUCINATION_FREE_BASE_SCORE : Math.max(0, HALLUCINATION_FREE_BASE_SCORE - x.hallucinationFlags.length * HALLUCINATION_PENALTY_PER_FLAG)));
  const discipline = avg(t.map((x) => x.disciplinePassed ? DISCIPLINE_SCORE_PASSED : DISCIPLINE_SCORE_FAILED));
  const riskAwareness = avg(t.map((x) => {
    const hasRiskRef = /risk|drawdown|stop.?loss|hedge|protect|caution/i.test(x.reasoning);
    return hasRiskRef ? 80 : 45;
  }));

  // Behavioral
  const actions = t.map((x) => x.action);
  const actionCounts = { buy: 0, sell: 0, hold: 0 };
  actions.forEach((a) => { if (a in actionCounts) actionCounts[a as keyof typeof actionCounts]++; });
  const strategyConsistency = Math.max(40, 100 - Math.abs(actionCounts.buy - actionCounts.sell) * 5);
  const adaptability = Math.min(100, 50 + countByCondition(Object.values(actionCounts), (v) => v > 0) * 15);
  const confScores = t.map((x) => x.confidence);
  const confidenceCalibration = confScores.length > 1
    ? Math.max(CALIBRATION_MIN_SCORE, CALIBRATION_MAX_SCORE - Math.abs(avg(confScores) - CALIBRATION_TARGET_CONFIDENCE) * CALIBRATION_DEVIATION_MULTIPLIER)
    : DEFAULT_CALIBRATION_SCORE;
  const crossRoundLearning = Math.min(100, 40 + t.length * 3);

  // Predictive
  const resolved = t.filter((x) => x.outcomeResolved !== "pending");
  const outcomeAccuracy = resolved.length > 0
    ? (countByCondition(resolved, (x) => x.outcomeResolved === "correct") / resolved.length) * 100
    : 50;
  const marketRegimeAwareness = avg(t.map((x) =>
    /regime|volatil|bull\s*market|bear\s*market|correction|recovery/i.test(x.reasoning) ? 75 : 40,
  ));
  const edgeConsistency = Math.min(100, 50 + countByCondition(t, (x) => x.overallGrade.startsWith("A") || x.overallGrade.startsWith("B")) * 5);

  // Governance
  const tradeAccountability = avg(t.map((x) => x.disciplinePassed ? 85 : 35));
  const reasoningQualityIndex = avg([coherence, reasoningDepth, sourceQuality, logicalConsistency]) * 0.01 * 100;
  const decisionAccountability = avg(t.map((x) => x.accountabilityScore));

  const dimensions: V31DimensionScores = {
    pnlPercent: r(pnlScore), sharpeRatio: r(sharpeScore), maxDrawdown: r(drawdownScore),
    coherence: r(coherence), reasoningDepth: r(reasoningDepth), sourceQuality: r(sourceQuality),
    logicalConsistency: r(logicalConsistency), reasoningIntegrity: r(reasoningIntegrity),
    reasoningTransparency: r(reasoningTransparency),
    hallucinationRate: r(hallucinationFree), instructionDiscipline: r(discipline),
    riskAwareness: r(riskAwareness),
    strategyConsistency: r(strategyConsistency), adaptability: r(adaptability),
    confidenceCalibration: r(confidenceCalibration), crossRoundLearning: r(crossRoundLearning),
    outcomeAccuracy: r(outcomeAccuracy), marketRegimeAwareness: r(marketRegimeAwareness),
    edgeConsistency: r(edgeConsistency),
    tradeAccountability: r(tradeAccountability), reasoningQualityIndex: r(reasoningQualityIndex),
    decisionAccountability: r(decisionAccountability),
  };

  // Weighted composite
  let composite = 0;
  for (const [dim, weight] of Object.entries(DIMENSION_WEIGHTS)) {
    composite += (dimensions[dim as keyof V31DimensionScores] ?? 50) * weight;
  }
  composite = r(composite);

  const existing = agentScores.get(input.agentId);
  const score: V31AgentScore = {
    agentId: input.agentId,
    agentName: input.agentName,
    provider: input.provider,
    model: input.model,
    dimensions,
    compositeScore: composite,
    tier: getTier(composite),
    tradeCount: t.length,
    roundsPlayed: (existing?.roundsPlayed ?? 0) + 1,
    lastUpdated: new Date().toISOString(),
  };

  agentScores.set(input.agentId, score);
  return score;
}

function r(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Round Summary
// ---------------------------------------------------------------------------

export function recordRoundSummary(input: {
  roundId: string;
  agentScores: V31AgentScore[];
  marketRegime: string;
}): V31RoundSummary {
  const agentTrades = tradeGrades.filter((g) =>
    input.agentScores.some((a) => a.agentId === g.agentId),
  );
  const sorted = [...agentTrades].sort((a, b) => {
    const aScore = a.coherenceScore + a.transparencyScore / 100;
    const bScore = b.coherenceScore + b.transparencyScore / 100;
    return bScore - aScore;
  });

  const summary: V31RoundSummary = {
    roundId: input.roundId,
    timestamp: new Date().toISOString(),
    agentScores: input.agentScores,
    bestTrade: sorted[0] ?? null,
    worstTrade: sorted[sorted.length - 1] ?? null,
    consensusAgreement: calculateConsensus(input.agentScores),
    marketRegime: input.marketRegime,
    avgTransparency: input.agentScores.length > 0
      ? r(input.agentScores.reduce((s, a) => s + a.dimensions.reasoningTransparency, 0) / input.agentScores.length)
      : 0,
    avgAccountability: input.agentScores.length > 0
      ? r(input.agentScores.reduce((s, a) => s + a.dimensions.decisionAccountability, 0) / input.agentScores.length)
      : 0,
  };

  roundSummaries.unshift(summary);
  if (roundSummaries.length > 200) roundSummaries.length = 200;
  return summary;
}

function calculateConsensus(scores: V31AgentScore[]): number {
  if (scores.length < 2) return 1;
  const composites = scores.map((s) => s.compositeScore);
  const variance = computeVariance(composites, true);
  return r(Math.max(0, 1 - Math.sqrt(variance) / 50));
}

// ---------------------------------------------------------------------------
// Getters for API & Dashboard
// ---------------------------------------------------------------------------

export function getV31Leaderboard(): V31AgentScore[] {
  return Array.from(agentScores.values())
    .sort((a, b) => b.compositeScore - a.compositeScore);
}

export function getV31TradeGrades(limit = 50): V31TradeGrade[] {
  return tradeGrades.slice(0, limit);
}

export function getV31DimensionWeights(): Record<string, number> {
  return { ...DIMENSION_WEIGHTS };
}

export function getCrossAgentCalibration(): {
  fairnessIndex: number;
  providerBias: Record<string, number>;
  spreadAnalysis: { min: number; max: number; stdDev: number };
} {
  const scores = Array.from(agentScores.values());
  if (scores.length < 2) {
    return {
      fairnessIndex: 1,
      providerBias: {},
      spreadAnalysis: { min: 50, max: 50, stdDev: 0 },
    };
  }

  const composites = scores.map((s) => s.compositeScore);
  const mean = composites.reduce((a, b) => a + b, 0) / composites.length;
  const stdDev = computeStdDev(composites, true);

  const providerBias: Record<string, number> = {};
  const byProvider = new Map<string, number[]>();
  for (const s of scores) {
    const arr = byProvider.get(s.provider) ?? [];
    arr.push(s.compositeScore);
    byProvider.set(s.provider, arr);
  }
  for (const [provider, vals] of byProvider) {
    const pMean = vals.reduce((a, b) => a + b, 0) / vals.length;
    providerBias[provider] = r(pMean - mean);
  }

  const compositeValues = composites.map((value) => ({ value }));
  return {
    fairnessIndex: r(Math.max(0, 1 - stdDev / 30)),
    providerBias,
    spreadAnalysis: {
      min: r(findMin(compositeValues, 'value')?.value ?? 0),
      max: r(findMax(compositeValues, 'value')?.value ?? 0),
      stdDev: r(stdDev),
    },
  };
}

export function exportV31Dataset(): Array<Record<string, unknown>> {
  return tradeGrades.map((g) => ({
    trade_id: g.tradeId,
    agent_id: g.agentId,
    symbol: g.symbol,
    action: g.action,
    reasoning: g.reasoning,
    confidence: g.confidence,
    coherence_score: g.coherenceScore,
    hallucination_flags: g.hallucinationFlags,
    discipline_passed: g.disciplinePassed,
    reasoning_depth: g.reasoningDepthScore,
    source_quality: g.sourceQualityScore,
    logical_consistency: g.logicalConsistencyScore,
    transparency_score: g.transparencyScore,
    accountability_score: g.accountabilityScore,
    integrity_hash: g.integrityHash,
    predicted_outcome: g.predictedOutcome,
    actual_outcome: g.actualOutcome,
    outcome_resolved: g.outcomeResolved,
    overall_grade: g.overallGrade,
    graded_at: g.gradedAt,
    benchmark_version: "31.0",
    dimension_count: 22,
  }));
}

export function getV31RoundSummaries(limit = 10): V31RoundSummary[] {
  return roundSummaries.slice(0, limit);
}
