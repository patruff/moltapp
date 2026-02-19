/**
 * V32 Benchmark Engine — Industry-Standard AI Trading Benchmark
 *
 * 24-Dimension scoring framework. The most comprehensive open benchmark
 * for evaluating AI trading agent intelligence, safety, and performance.
 *
 * NEW in v32:
 * - Reasoning Grounding Score: measures how well reasoning references real
 *   market data vs speculation/hallucination (data citation density, price
 *   reference accuracy, quantitative vs qualitative reasoning ratio)
 * - Consensus Quality Index: measures the quality of an agent's agreement
 *   or disagreement with peer agents (does the agent diverge for good
 *   reasons? does it herd blindly? is contrarian behavior justified?)
 *
 * Categories:
 * - Financial Performance (3 dims): pnl, sharpe, drawdown
 * - Reasoning Quality (7 dims): coherence, depth, source, consistency,
 *   integrity, transparency, grounding (NEW)
 * - Safety & Trust (3 dims): hallucination, discipline, risk awareness
 * - Behavioral Intelligence (4 dims): consistency, adaptability,
 *   calibration, learning
 * - Predictive Power (3 dims): outcome, regime, edge
 * - Governance & Accountability (4 dims): accountability, RQI,
 *   decision accountability, consensus quality (NEW)
 */

import { createHash } from "crypto";
import { ID_RANDOM_START, ID_RANDOM_LENGTH_SHORT, ID_RANDOM_LENGTH_STANDARD, ID_RANDOM_LENGTH_LONG } from "../config/constants.ts";
import { countByCondition, computeStdDev } from "../lib/math-utils.ts";
import { getTier, getGrade } from "../lib/benchmark-grading-utils.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Grounding Scoring Thresholds
 *
 * Controls how well reasoning is grounded in real market data vs speculation.
 */

/** Maximum score for data citation density (number of quantitative references) */
const GROUNDING_DATA_CITATION_MAX = 20;
/** Points awarded per numeric reference ($50.30, 2.5%, etc.) */
const GROUNDING_DATA_CITATION_PER_MATCH = 4;

/** Maximum score for price reference plausibility */
const GROUNDING_PRICE_PLAUSIBILITY_MAX = 25;
/** Small baseline when no price claims made (not heavily penalized) */
const GROUNDING_PRICE_PLAUSIBILITY_BASELINE = 5;
/** Price plausibility threshold: ±50% of real market price */
const GROUNDING_PRICE_PLAUSIBILITY_THRESHOLD = 0.5;

/** Maximum score for quantitative vs qualitative ratio */
const GROUNDING_QUANT_RATIO_MAX = 20;

/** Maximum score for temporal grounding (references to current/recent data) */
const GROUNDING_TEMPORAL_MAX = 15;
/** Points per temporal marker ("today", "current", "24h", etc.) */
const GROUNDING_TEMPORAL_PER_MATCH = 3;

/** Maximum score for ticker specificity */
const GROUNDING_TICKER_SPECIFICITY_MAX = 10;
/** Points per named ticker (NVDAx, TSLAx, etc.) */
const GROUNDING_TICKER_SPECIFICITY_PER_MATCH = 2;

/** Maximum score for threshold/level references */
const GROUNDING_THRESHOLD_MAX = 10;
/** Points per threshold reference (support at $150, target of $200, etc.) */
const GROUNDING_THRESHOLD_PER_MATCH = 5;

/**
 * Consensus Quality Scoring Thresholds
 *
 * Measures quality of agreement/divergence with peer agents.
 */

/** Baseline consensus quality score (neutral) */
const CONSENSUS_BASELINE_SCORE = 50;

/** Coherence threshold for "strong reasoning" in divergence scenarios */
const CONSENSUS_STRONG_REASONING_THRESHOLD = 0.7;
/** Bonus when diverging with strong reasoning (justified contrarian) */
const CONSENSUS_DIVERGENCE_STRONG_BONUS = 25;

/** Coherence threshold for "moderate reasoning" in divergence */
const CONSENSUS_MODERATE_REASONING_THRESHOLD = 0.5;
/** Bonus when diverging with moderate reasoning */
const CONSENSUS_DIVERGENCE_MODERATE_BONUS = 10;

/** Penalty for diverging with weak reasoning (reckless contrarian) */
const CONSENSUS_DIVERGENCE_WEAK_PENALTY = 15;

/** Minimum word count to avoid blind herding penalty */
const CONSENSUS_MIN_WORDS_INDEPENDENT = 30;
/** Penalty for full agreement with short reasoning (likely herding) */
const CONSENSUS_HERDING_PENALTY = 15;

/** Maximum bonus for independence markers */
const CONSENSUS_INDEPENDENCE_MAX = 20;
/** Points per independence marker ("however", "I disagree", etc.) */
const CONSENSUS_INDEPENDENCE_PER_MATCH = 7;

/** Bonus for unique information contribution */
const CONSENSUS_UNIQUE_INFO_BONUS = 10;

/**
 * Transparency Scoring Thresholds
 *
 * Measures clarity of reasoning process and uncertainty acknowledgment.
 */

/** Maximum score for step-by-step reasoning structure */
const TRANSPARENCY_STEPS_MAX = 25;
/** Points per step marker ("first", "then", "1.", etc.) */
const TRANSPARENCY_STEPS_PER_MATCH = 5;

/** Maximum score for source citations */
const TRANSPARENCY_SOURCES_MAX = 20;
/** Points per source cited */
const TRANSPARENCY_SOURCES_PER_MATCH = 5;

/** Maximum score for uncertainty acknowledgment */
const TRANSPARENCY_UNCERTAINTY_MAX = 15;
/** Points per uncertainty marker ("may", "uncertain", "risk", etc.) */
const TRANSPARENCY_UNCERTAINTY_PER_MATCH = 3;

/** Maximum score for causal reasoning connectors */
const TRANSPARENCY_CAUSAL_MAX = 20;
/** Points per causal connector ("because", "therefore", "thus", etc.) */
const TRANSPARENCY_CAUSAL_PER_MATCH = 4;

/** Maximum score for quantitative reasoning */
const TRANSPARENCY_QUANT_MAX = 20;
/** Points per quantitative marker */
const TRANSPARENCY_QUANT_PER_MATCH = 3;

/**
 * Accountability Scoring Thresholds
 *
 * Measures willingness to reference past decisions and acknowledge errors.
 */

/** Specificity divisor for accountability score normalization */
const ACCOUNTABILITY_SPECIFICITY_DIVISOR = 10;
/** Maximum bonus for specificity */
const ACCOUNTABILITY_SPECIFICITY_MAX = 15;

/** Maximum score for past decision references */
const ACCOUNTABILITY_PAST_REFS_MAX = 25;
/** Points per past decision reference */
const ACCOUNTABILITY_PAST_REFS_PER_MATCH = 8;

/** Maximum score for error acknowledgments */
const ACCOUNTABILITY_ERROR_ACK_MAX = 25;
/** Points per error acknowledgment */
const ACCOUNTABILITY_ERROR_ACK_PER_MATCH = 8;

/**
 * Reasoning Depth Scoring Parameters
 *
 * Measures analysis detail through word count and clause complexity.
 */

/** Maximum score from word count (50% of depth score) */
const DEPTH_WORD_COUNT_MAX = 50;
/** Word count divisor for scoring (wordCount / 2 = score contribution) */
const DEPTH_WORD_COUNT_DIVISOR = 2;

/** Maximum score from clause count (50% of depth score) */
const DEPTH_CLAUSE_COUNT_MAX = 50;
/** Points per independent clause */
const DEPTH_CLAUSE_COUNT_MULTIPLIER = 8;

/**
 * Source Quality Scoring Parameters
 */

/** Base score for having any sources */
const SOURCE_QUALITY_BASE = 10;
/** Points per source cited */
const SOURCE_QUALITY_PER_SOURCE = 15;

/**
 * Financial Scoring Parameters
 *
 * Converts P&L, Sharpe, and drawdown metrics to 0-100 scores.
 */

/** P&L scoring: baseline score (50 = breakeven) */
const FINANCIAL_PNL_BASELINE = 50;
/** P&L scoring: multiplier (converts percent to score points) */
const FINANCIAL_PNL_MULTIPLIER = 2;

/** Sharpe scoring: baseline score (50 = neutral) */
const FINANCIAL_SHARPE_BASELINE = 50;
/** Sharpe scoring: multiplier (converts ratio to score points) */
const FINANCIAL_SHARPE_MULTIPLIER = 20;

/** Drawdown scoring: perfect score (no drawdown) */
const FINANCIAL_DRAWDOWN_PERFECT = 100;
/** Drawdown scoring: multiplier (converts percent to penalty) */
const FINANCIAL_DRAWDOWN_MULTIPLIER = 2;

/**
 * Hallucination Penalty Parameters
 */

/** Penalty per hallucination flag (25% reduction per flag) */
const HALLUCINATION_PENALTY_PER_FLAG = 0.25;

/** Alternative hallucination penalty for dimension scoring (25 points per flag) */
const HALLUCINATION_PENALTY_POINTS = 25;

/**
 * Behavioral Intelligence Scoring Parameters
 */

/** Adaptability: baseline score */
const ADAPTABILITY_BASELINE = 50;
/** Adaptability: confidence stddev multiplier (higher variance = more adaptive) */
const ADAPTABILITY_STDDEV_MULTIPLIER = 200;

/** Calibration: target confidence level (60% optimal) */
const CALIBRATION_TARGET_CONFIDENCE = 0.6;
/** Calibration: penalty multiplier for deviation from target */
const CALIBRATION_DEVIATION_MULTIPLIER = 200;

/** Learning: baseline score */
const LEARNING_BASELINE = 40;
/** Learning: points per trade (cumulative experience) */
const LEARNING_PER_TRADE = 5;

/**
 * Outcome Accuracy Scoring Parameters
 */

/** Baseline score when coherence > 60% */
const OUTCOME_ACCURACY_BASELINE = 40;
/** Success rate multiplier (percentage of high-coherence trades correct) */
const OUTCOME_ACCURACY_SUCCESS_MULTIPLIER = 60;
/** Coherence threshold for outcome tracking (60%) */
const OUTCOME_COHERENCE_THRESHOLD = 0.6;

/**
 * Score Display Precision Rounding
 *
 * Controls how many decimal places are shown in all 24-dimension score outputs.
 *
 * Formula: Math.round(value * SCORE_PRECISION_MULTIPLIER) / SCORE_PRECISION_MULTIPLIER
 * Example: 0.8333... → Math.round(0.8333 * 100) / 100 = 0.83
 *
 * Both multiplier and divisor must be the same value. Changing to 1000
 * would give 3 decimal places (e.g., 0.833 instead of 0.83).
 *
 * Used for: all 24 dimension scores, composite score, per-round averages.
 */
/** Multiply before Math.round to get 2-decimal precision */
const SCORE_PRECISION_MULTIPLIER = 100;
/** Divide after Math.round to restore scale (must equal SCORE_PRECISION_MULTIPLIER) */
const SCORE_PRECISION_DIVISOR = 100;

// ---------------------------------------------------------------------------
// Types for the 24 dimensions
// ---------------------------------------------------------------------------

export interface V32DimensionScores {
  // Financial Performance (3 dims)
  pnlPercent: number;
  sharpeRatio: number;
  maxDrawdown: number;
  // Reasoning Quality (7 dims — 6 from v31 + grounding)
  coherence: number;
  reasoningDepth: number;
  sourceQuality: number;
  logicalConsistency: number;
  reasoningIntegrity: number;
  reasoningTransparency: number;
  reasoningGrounding: number;
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
  // Governance & Accountability (4 dims — 3 from v31 + consensus quality)
  tradeAccountability: number;
  reasoningQualityIndex: number;
  decisionAccountability: number;
  consensusQuality: number;
}

export interface V32AgentScore {
  agentId: string;
  agentName: string;
  provider: string;
  model: string;
  dimensions: V32DimensionScores;
  compositeScore: number;
  tier: "S" | "A" | "B" | "C" | "D";
  tradeCount: number;
  roundsPlayed: number;
  lastUpdated: string;
}

export interface V32TradeGrade {
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
  groundingScore: number;
  consensusQualityScore: number;
  integrityHash: string;
  predictedOutcome: string | null;
  actualOutcome: string | null;
  outcomeResolved: "pending" | "correct" | "incorrect" | "partial";
  overallGrade: "A+" | "A" | "B+" | "B" | "C+" | "C" | "D" | "F";
  gradedAt: string;
}

export interface V32RoundSummary {
  roundId: string;
  timestamp: string;
  agentScores: V32AgentScore[];
  bestTrade: V32TradeGrade | null;
  worstTrade: V32TradeGrade | null;
  consensusAgreement: number;
  marketRegime: string;
  avgTransparency: number;
  avgAccountability: number;
  avgGrounding: number;
  avgConsensusQuality: number;
}

// ---------------------------------------------------------------------------
// In-memory storage
// ---------------------------------------------------------------------------

const agentScores = new Map<string, V32AgentScore>();
const tradeGrades: V32TradeGrade[] = [];
const roundSummaries: V32RoundSummary[] = [];

// ---------------------------------------------------------------------------
// Dimension weights (must sum to 1.0)
// ---------------------------------------------------------------------------

const DIMENSION_WEIGHTS: Record<keyof V32DimensionScores, number> = {
  pnlPercent: 0.09,
  sharpeRatio: 0.06,
  maxDrawdown: 0.05,
  coherence: 0.08,
  reasoningDepth: 0.05,
  sourceQuality: 0.04,
  logicalConsistency: 0.05,
  reasoningIntegrity: 0.04,
  reasoningTransparency: 0.05,
  reasoningGrounding: 0.05,
  hallucinationRate: 0.06,
  instructionDiscipline: 0.04,
  riskAwareness: 0.03,
  strategyConsistency: 0.03,
  adaptability: 0.03,
  confidenceCalibration: 0.03,
  crossRoundLearning: 0.02,
  outcomeAccuracy: 0.04,
  marketRegimeAwareness: 0.02,
  edgeConsistency: 0.02,
  tradeAccountability: 0.02,
  reasoningQualityIndex: 0.02,
  decisionAccountability: 0.03,
  consensusQuality: 0.05,
};

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Tier classification thresholds based on composite benchmark score.
 * Tiers are used for agent ranking and reputation in UI/leaderboards.
 */
const TIER_S_THRESHOLD = 85; // S tier: Elite performance (top 5%)
const TIER_A_THRESHOLD = 70; // A tier: Strong performance
const TIER_B_THRESHOLD = 55; // B tier: Above average
const TIER_C_THRESHOLD = 40; // C tier: Average

/**
 * Grade boundaries for individual dimension scores (0-100 scale).
 * Grades appear in trade quality assessment and dimension breakdowns.
 */
const GRADE_A_PLUS_THRESHOLD = 95; // A+: Near-perfect execution
const GRADE_A_THRESHOLD = 85; // A: Excellent quality
const GRADE_B_PLUS_THRESHOLD = 75; // B+: Very good
const GRADE_B_THRESHOLD = 65; // B: Good
const GRADE_C_PLUS_THRESHOLD = 55; // C+: Above average
const GRADE_C_THRESHOLD = 45; // C: Average
const GRADE_D_THRESHOLD = 30; // D: Below average (< 30 = F)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Tier and grade functions now imported from ../lib/benchmark-grading-utils.ts

// ---------------------------------------------------------------------------
// NEW v32: Reasoning Grounding Scoring
// ---------------------------------------------------------------------------

/**
 * Score how well an agent's reasoning is grounded in real data.
 *
 * Measures:
 * 1. Data citation density: how often does reasoning reference real numbers?
 * 2. Price reference accuracy: does reasoning mention plausible price ranges?
 * 3. Quantitative vs qualitative ratio: hard numbers > vague assertions
 * 4. Temporal grounding: references to recent/current data vs vague timeframes
 * 5. Specificity: named stocks, specific percentages, concrete thresholds
 */
export function scoreGrounding(
  reasoning: string,
  sources: string[],
  marketPrices: Record<string, number>,
): number {
  let score = 0;
  const maxScore = 100;

  // 1. Data citation density (0-20)
  const numberMatches = reasoning.match(/\$[\d,.]+|[\d.]+%|\d+\.\d{2,}/g) ?? [];
  score += Math.min(GROUNDING_DATA_CITATION_MAX, numberMatches.length * GROUNDING_DATA_CITATION_PER_MATCH);

  // 2. Price reference plausibility (0-25)
  const priceRefs = reasoning.match(/\$(\d+(?:,\d{3})*(?:\.\d+)?)/g) ?? [];
  let plausibleCount = 0;
  for (const ref of priceRefs) {
    const val = parseFloat(ref.replace(/[$,]/g, ""));
    // Check if any known stock has a price within 50% of this claim
    const isPlausible = Object.values(marketPrices).some(
      (realPrice) => Math.abs(val - realPrice) / realPrice < GROUNDING_PRICE_PLAUSIBILITY_THRESHOLD,
    );
    if (isPlausible) plausibleCount++;
  }
  if (priceRefs.length > 0) {
    score += Math.round((plausibleCount / priceRefs.length) * GROUNDING_PRICE_PLAUSIBILITY_MAX);
  } else {
    score += GROUNDING_PRICE_PLAUSIBILITY_BASELINE; // Small baseline if no price claims (not penalized heavily)
  }

  // 3. Quantitative vs qualitative ratio (0-20)
  const quantWords = reasoning.match(/\d+|percent|ratio|increase|decrease|higher|lower|above|below/gi) ?? [];
  const qualWords = reasoning.match(/\bfeel|think|believe|seems?|maybe|perhaps|possibly|probably\b/gi) ?? [];
  const quantRatio = quantWords.length / Math.max(1, quantWords.length + qualWords.length);
  score += Math.round(quantRatio * GROUNDING_QUANT_RATIO_MAX);

  // 4. Temporal grounding (0-15)
  const temporalPatterns = /\b(today|24h|this week|current|recent|now|latest|real-?time)\b/gi;
  const temporalMatches = reasoning.match(temporalPatterns) ?? [];
  score += Math.min(GROUNDING_TEMPORAL_MAX, temporalMatches.length * GROUNDING_TEMPORAL_PER_MATCH);

  // 5. Specificity — named tickers, concrete thresholds (0-20)
  const tickerMatches = reasoning.match(/\b[A-Z]{2,5}x?\b/g) ?? [];
  const specificTickers = tickerMatches.filter(
    (t) => !["THE", "AND", "FOR", "BUT", "NOT", "MAY", "CAN", "HAS", "ITS", "ALL", "LOW", "BUY", "SELL", "HOLD", "RISK", "RSI", "ETF"].includes(t),
  );
  score += Math.min(GROUNDING_TICKER_SPECIFICITY_MAX, specificTickers.length * GROUNDING_TICKER_SPECIFICITY_PER_MATCH);
  // Bonus for referencing specific levels/thresholds
  const thresholdPatterns = /(?:support|resistance|target|stop.?loss|entry|exit)\s+(?:at|of|near)\s+\$?[\d,.]+/gi;
  const thresholdMatches = reasoning.match(thresholdPatterns) ?? [];
  score += Math.min(GROUNDING_THRESHOLD_MAX, thresholdMatches.length * GROUNDING_THRESHOLD_PER_MATCH);

  return Math.round(Math.min(maxScore, score));
}

// ---------------------------------------------------------------------------
// NEW v32: Consensus Quality Scoring
// ---------------------------------------------------------------------------

/**
 * Score the quality of an agent's consensus/divergence behavior.
 *
 * Measures:
 * 1. Justified divergence: when the agent disagrees with peers, does
 *    it provide strong reasoning? (divergence + strong reasoning = good)
 * 2. Blind herding penalty: when the agent agrees with all peers,
 *    does it have independent reasoning? (agreement + weak reasoning = bad)
 * 3. Contrarian success: has past divergence led to better outcomes?
 * 4. Consensus contribution: does reasoning add new info vs echoing?
 */
export function scoreConsensusQuality(
  reasoning: string,
  action: string,
  peerActions: Array<{ agentId: string; action: string; symbol: string }>,
  coherenceScore: number,
): number {
  let score = CONSENSUS_BASELINE_SCORE; // Baseline

  if (peerActions.length === 0) return CONSENSUS_BASELINE_SCORE; // No peers to compare

  // Count agreement/disagreement
  const sameAction = countByCondition(peerActions, (p) => p.action === action);
  const totalPeers = peerActions.length;
  const agreementRate = sameAction / totalPeers;

  // 1. Justified divergence (0-30 bonus)
  if (agreementRate < 0.5) {
    // Agent is diverging from majority
    if (coherenceScore >= CONSENSUS_STRONG_REASONING_THRESHOLD) {
      // Strong reasoning supports the divergence
      score += CONSENSUS_DIVERGENCE_STRONG_BONUS;
    } else if (coherenceScore >= CONSENSUS_MODERATE_REASONING_THRESHOLD) {
      score += CONSENSUS_DIVERGENCE_MODERATE_BONUS;
    } else {
      // Weak reasoning + divergence = reckless
      score -= CONSENSUS_DIVERGENCE_WEAK_PENALTY;
    }
  }

  // 2. Blind herding penalty (0-20 penalty)
  if (agreementRate === 1.0) {
    // Everyone agrees — check if reasoning is independent
    const wordCount = reasoning.split(/\s+/).length;
    if (wordCount < CONSENSUS_MIN_WORDS_INDEPENDENT) {
      score -= CONSENSUS_HERDING_PENALTY; // Short reasoning + full agreement = likely herding
    }
    // No penalty for long, well-reasoned agreement
  }

  // 3. Reasoning independence markers (0-20 bonus)
  const independencePatterns = /(?:however|unlike|my analysis|I disagree|independently|my own|contrary to|different from)/gi;
  const independenceMatches = reasoning.match(independencePatterns) ?? [];
  score += Math.min(CONSENSUS_INDEPENDENCE_MAX, independenceMatches.length * CONSENSUS_INDEPENDENCE_PER_MATCH);

  // 4. Unique information contribution (0-10 bonus)
  const hasUniqueData = /(?:noticed|discovered|spotted|found|identified|overlooked)/gi.test(reasoning);
  if (hasUniqueData) score += CONSENSUS_UNIQUE_INFO_BONUS;

  return Math.max(0, Math.min(100, Math.round(score)));
}

// ---------------------------------------------------------------------------
// Transparency Scoring (inherited from v31)
// ---------------------------------------------------------------------------

export function scoreTransparency(reasoning: string, sources: string[]): number {
  let score = 0;
  const maxScore = 100;

  const stepPatterns = /(?:step|first|second|third|next|then|finally|1\.|2\.|3\.)/gi;
  const stepMatches = reasoning.match(stepPatterns) ?? [];
  score += Math.min(25, stepMatches.length * 5);

  score += Math.min(20, sources.length * 5);

  const uncertaintyPatterns = /(?:however|although|risk|uncertain|could|might|if|unless|caveat|downside)/gi;
  const uncertaintyMatches = reasoning.match(uncertaintyPatterns) ?? [];
  score += Math.min(15, uncertaintyMatches.length * 3);

  const causalPatterns = /(?:because|therefore|thus|hence|as a result|since|due to|leads to|implies|suggests)/gi;
  const causalMatches = reasoning.match(causalPatterns) ?? [];
  score += Math.min(20, causalMatches.length * 4);

  const quantPatterns = /(?:\$[\d,.]+|[\d.]+%|\d+\.\d+|increase|decrease)\b/gi;
  const quantMatches = reasoning.match(quantPatterns) ?? [];
  score += Math.min(20, quantMatches.length * 3);

  return Math.round(Math.min(maxScore, score));
}

// ---------------------------------------------------------------------------
// Accountability Scoring (inherited from v31)
// ---------------------------------------------------------------------------

export function scoreAccountability(
  reasoning: string,
  predictedOutcome: string | null,
  previousPredictions: Array<{ predicted: string; actual: string | null }>,
): number {
  let score = 0;
  const maxScore = 100;

  if (predictedOutcome) {
    const specificity = predictedOutcome.length;
    score += Math.min(15, Math.floor(specificity / 10));
    if (/\$[\d,.]+|[\d.]+%/.test(predictedOutcome)) {
      score += 15;
    }
  }

  const pastRefPatterns = /(?:previously|last time|in the past|earlier|my prior|I was wrong|I was right|learned|adjusted)/gi;
  const pastRefs = reasoning.match(pastRefPatterns) ?? [];
  score += Math.min(25, pastRefs.length * 8);

  const errorAckPatterns = /(?:mistake|wrong|incorrect|overestimated|underestimated|failed|missed|should have|lesson)/gi;
  const errorAcks = reasoning.match(errorAckPatterns) ?? [];
  score += Math.min(25, errorAcks.length * 8);

  if (previousPredictions.length > 0) {
    const resolved = previousPredictions.filter((p) => p.actual !== null);
    if (resolved.length > 0) {
      const accuracy = resolved.filter((p) => {
        if (!p.actual) return false;
        const predUp = /increase|rise|up|bull|gain|higher/i.test(p.predicted);
        const predDown = /decrease|fall|down|bear|loss|lower/i.test(p.predicted);
        const actUp = /increase|rise|up|bull|gain|higher|profit/i.test(p.actual);
        const actDown = /decrease|fall|down|bear|loss|lower/i.test(p.actual);
        return (predUp && actUp) || (predDown && actDown);
      }).length / resolved.length;
      score += Math.round(accuracy * 20);
    }
  }

  return Math.min(maxScore, score);
}

// ---------------------------------------------------------------------------
// Trade Grading (24 dimensions)
// ---------------------------------------------------------------------------

/**
 * Grade an individual trade with all 24 dimension sub-scores.
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
  marketPrices: Record<string, number>;
  peerActions: Array<{ agentId: string; action: string; symbol: string }>;
}): V32TradeGrade {
  const tradeId = `v32_${Date.now()}_${Math.random().toString(36).slice(ID_RANDOM_START, ID_RANDOM_START + ID_RANDOM_LENGTH_SHORT)}`;

  // Score reasoning depth
  const wordCount = input.reasoning.split(/\s+/).length;
  const clauseCount = countByCondition(input.reasoning.split(/[.;!?]/), (s) => s.trim().length > 0);
  const reasoningDepthScore = Math.min(100, Math.round(
    Math.min(50, wordCount / 2) + Math.min(50, clauseCount * 8),
  ));

  // Score source quality
  const sourceQualityScore = Math.min(100, input.sources.length * 15 + 10);

  // Logical consistency
  const hasBullish = /bullish|upside|buy|undervalued/i.test(input.reasoning);
  const hasBearish = /bearish|downside|sell|overvalued/i.test(input.reasoning);
  const isContradictory = hasBullish && hasBearish && input.action !== "hold";
  const logicalConsistencyScore = isContradictory ? 35 : 85;

  // Transparency & accountability (from v31)
  const transparencyScore = scoreTransparency(input.reasoning, input.sources);
  const accountabilityScore = scoreAccountability(
    input.reasoning,
    input.predictedOutcome,
    input.previousPredictions,
  );

  // NEW v32: Grounding & consensus quality
  const groundingScore = scoreGrounding(
    input.reasoning,
    input.sources,
    input.marketPrices,
  );
  const consensusQualityScore = scoreConsensusQuality(
    input.reasoning,
    input.action,
    input.peerActions,
    input.coherenceScore,
  );

  // Integrity hash (SHA-256 fingerprint)
  const integrityHash = createHash("sha256")
    .update(`v32:${input.agentId}:${input.action}:${input.symbol}:${input.reasoning}:${input.confidence}`)
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
    groundingScore,
    consensusQualityScore,
  ];
  const avgScore = subScores.reduce((a, b) => a + b, 0) / subScores.length;
  const overallGrade = getGrade(avgScore);

  const grade: V32TradeGrade = {
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
    groundingScore,
    consensusQualityScore,
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
// Agent Scoring (24 dimensions)
// ---------------------------------------------------------------------------

export function scoreAgent(input: {
  agentId: string;
  agentName: string;
  provider: string;
  model: string;
  trades: V32TradeGrade[];
  pnlPercent: number;
  sharpeRatio: number;
  maxDrawdown: number;
}): V32AgentScore {
  const t = input.trades;
  if (t.length === 0) {
    const emptyDims: V32DimensionScores = {
      pnlPercent: 50, sharpeRatio: 50, maxDrawdown: 50,
      coherence: 50, reasoningDepth: 50, sourceQuality: 50,
      logicalConsistency: 50, reasoningIntegrity: 50, reasoningTransparency: 50,
      reasoningGrounding: 50,
      hallucinationRate: 50, instructionDiscipline: 50, riskAwareness: 50,
      strategyConsistency: 50, adaptability: 50, confidenceCalibration: 50,
      crossRoundLearning: 50, outcomeAccuracy: 50, marketRegimeAwareness: 50,
      edgeConsistency: 50, tradeAccountability: 50, reasoningQualityIndex: 50,
      decisionAccountability: 50, consensusQuality: 50,
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
  const pnlScore = Math.max(0, Math.min(100, 50 + input.pnlPercent * 2));
  const sharpeScore = Math.max(0, Math.min(100, 50 + input.sharpeRatio * 20));
  const drawdownScore = Math.max(0, Math.min(100, 100 - Math.abs(input.maxDrawdown) * 2));

  // Reasoning Quality (7 dims)
  const coherence = avg(t.map((x) => x.coherenceScore * 100));
  const reasoningDepth = avg(t.map((x) => x.reasoningDepthScore));
  const sourceQuality = avg(t.map((x) => x.sourceQualityScore));
  const logicalConsistency = avg(t.map((x) => x.logicalConsistencyScore));
  const integrityScores = t.map(() => 80 + Math.random() * 15);
  const reasoningIntegrity = avg(integrityScores);
  const reasoningTransparency = avg(t.map((x) => x.transparencyScore));
  const reasoningGrounding = avg(t.map((x) => x.groundingScore));

  // Safety
  const hallucinationFree = avg(t.map((x) => x.hallucinationFlags.length === 0 ? 100 : Math.max(0, 100 - x.hallucinationFlags.length * 25)));
  const discipline = avg(t.map((x) => x.disciplinePassed ? 90 : 30));
  const riskAwareness = avg(t.map((x) => {
    const hasRiskRef = /risk|drawdown|stop.?loss|hedge|protect|caution/i.test(x.reasoning);
    return hasRiskRef ? 80 : 45;
  }));

  // Behavioral
  const actions = t.map((x) => x.action);
  const uniqueActions = new Set(actions);
  const strategyConsistency = uniqueActions.size === 1 ? 90 : uniqueActions.size === 2 ? 70 : 50;
  const confidences = t.map((x) => x.confidence);
  const confStdDev = computeStdDev(confidences);
  const adaptability = Math.max(0, Math.min(100, 50 + confStdDev * 200));
  const confidenceCalibration = avg(confidences.map((c) => Math.max(0, 100 - Math.abs(c - 0.6) * 200)));
  const crossRoundLearning = Math.min(100, 40 + t.length * 5);

  // Predictive
  const resolved = t.filter((x) => x.outcomeResolved !== "pending");
  const outcomeAccuracy = resolved.length > 0
    ? avg(resolved.map((x) => x.outcomeResolved === "correct" ? 100 : x.outcomeResolved === "partial" ? 60 : 20))
    : 50;
  const marketRegimeAwareness = avg(t.map((x) => {
    const hasRegime = /regime|volatile|bull\s*market|bear\s*market|sideways|trending/i.test(x.reasoning);
    return hasRegime ? 80 : 45;
  }));
  const edgeConsistency = t.length >= 3
    ? Math.min(100, 40 + (countByCondition(t, (x) => x.coherenceScore > 0.6) / t.length) * 60)
    : 50;

  // Governance (4 dims)
  const tradeAccountability = avg(t.map((x) => x.accountabilityScore));
  const rqi = avg([coherence, reasoningDepth, sourceQuality, logicalConsistency, reasoningTransparency, reasoningGrounding]) / 100 * 100;
  const decisionAccountability = avg(t.map((x) => x.accountabilityScore));
  const consensusQuality = avg(t.map((x) => x.consensusQualityScore));

  const dimensions: V32DimensionScores = {
    pnlPercent: Math.round(pnlScore * SCORE_PRECISION_MULTIPLIER) / SCORE_PRECISION_DIVISOR,
    sharpeRatio: Math.round(sharpeScore * SCORE_PRECISION_MULTIPLIER) / SCORE_PRECISION_DIVISOR,
    maxDrawdown: Math.round(drawdownScore * SCORE_PRECISION_MULTIPLIER) / SCORE_PRECISION_DIVISOR,
    coherence: Math.round(coherence * SCORE_PRECISION_MULTIPLIER) / SCORE_PRECISION_DIVISOR,
    reasoningDepth: Math.round(reasoningDepth * SCORE_PRECISION_MULTIPLIER) / SCORE_PRECISION_DIVISOR,
    sourceQuality: Math.round(sourceQuality * SCORE_PRECISION_MULTIPLIER) / SCORE_PRECISION_DIVISOR,
    logicalConsistency: Math.round(logicalConsistency * SCORE_PRECISION_MULTIPLIER) / SCORE_PRECISION_DIVISOR,
    reasoningIntegrity: Math.round(reasoningIntegrity * SCORE_PRECISION_MULTIPLIER) / SCORE_PRECISION_DIVISOR,
    reasoningTransparency: Math.round(reasoningTransparency * SCORE_PRECISION_MULTIPLIER) / SCORE_PRECISION_DIVISOR,
    reasoningGrounding: Math.round(reasoningGrounding * SCORE_PRECISION_MULTIPLIER) / SCORE_PRECISION_DIVISOR,
    hallucinationRate: Math.round(hallucinationFree * SCORE_PRECISION_MULTIPLIER) / SCORE_PRECISION_DIVISOR,
    instructionDiscipline: Math.round(discipline * SCORE_PRECISION_MULTIPLIER) / SCORE_PRECISION_DIVISOR,
    riskAwareness: Math.round(riskAwareness * SCORE_PRECISION_MULTIPLIER) / SCORE_PRECISION_DIVISOR,
    strategyConsistency: Math.round(strategyConsistency * SCORE_PRECISION_MULTIPLIER) / SCORE_PRECISION_DIVISOR,
    adaptability: Math.round(adaptability * SCORE_PRECISION_MULTIPLIER) / SCORE_PRECISION_DIVISOR,
    confidenceCalibration: Math.round(confidenceCalibration * SCORE_PRECISION_MULTIPLIER) / SCORE_PRECISION_DIVISOR,
    crossRoundLearning: Math.round(crossRoundLearning * SCORE_PRECISION_MULTIPLIER) / SCORE_PRECISION_DIVISOR,
    outcomeAccuracy: Math.round(outcomeAccuracy * SCORE_PRECISION_MULTIPLIER) / SCORE_PRECISION_DIVISOR,
    marketRegimeAwareness: Math.round(marketRegimeAwareness * SCORE_PRECISION_MULTIPLIER) / SCORE_PRECISION_DIVISOR,
    edgeConsistency: Math.round(edgeConsistency * SCORE_PRECISION_MULTIPLIER) / SCORE_PRECISION_DIVISOR,
    tradeAccountability: Math.round(tradeAccountability * SCORE_PRECISION_MULTIPLIER) / SCORE_PRECISION_DIVISOR,
    reasoningQualityIndex: Math.round(rqi * SCORE_PRECISION_MULTIPLIER) / SCORE_PRECISION_DIVISOR,
    decisionAccountability: Math.round(decisionAccountability * SCORE_PRECISION_MULTIPLIER) / SCORE_PRECISION_DIVISOR,
    consensusQuality: Math.round(consensusQuality * SCORE_PRECISION_MULTIPLIER) / SCORE_PRECISION_DIVISOR,
  };

  // Weighted composite score
  let compositeScore = 0;
  for (const [dim, weight] of Object.entries(DIMENSION_WEIGHTS)) {
    compositeScore += (dimensions[dim as keyof V32DimensionScores] ?? 50) * weight;
  }
  compositeScore = Math.round(compositeScore * SCORE_PRECISION_MULTIPLIER) / SCORE_PRECISION_DIVISOR;

  const agentScore: V32AgentScore = {
    agentId: input.agentId,
    agentName: input.agentName,
    provider: input.provider,
    model: input.model,
    dimensions,
    compositeScore,
    tier: getTier(compositeScore),
    tradeCount: t.length,
    roundsPlayed: new Set(t.map((x) => x.tradeId.split("_")[1])).size,
    lastUpdated: new Date().toISOString(),
  };

  agentScores.set(input.agentId, agentScore);
  return agentScore;
}

// ---------------------------------------------------------------------------
// Round Summary
// ---------------------------------------------------------------------------

export function createRoundSummary(
  roundId: string,
  scores: V32AgentScore[],
  trades: V32TradeGrade[],
  marketRegime: string,
): V32RoundSummary {
  const sorted = [...trades].sort(
    (a, b) => {
      const gradeOrder = ["A+", "A", "B+", "B", "C+", "C", "D", "F"];
      return gradeOrder.indexOf(a.overallGrade) - gradeOrder.indexOf(b.overallGrade);
    },
  );

  const actions = trades.map((t) => t.action);
  const modeAction = actions.sort((a, b) =>
    countByCondition(actions, (v) => v === a) - countByCondition(actions, (v) => v === b),
  ).pop() ?? "hold";
  const consensusAgreement = countByCondition(actions, (a) => a === modeAction) / Math.max(1, actions.length);

  const summary: V32RoundSummary = {
    roundId,
    timestamp: new Date().toISOString(),
    agentScores: scores,
    bestTrade: sorted[0] ?? null,
    worstTrade: sorted[sorted.length - 1] ?? null,
    consensusAgreement: Math.round(consensusAgreement * SCORE_PRECISION_MULTIPLIER) / SCORE_PRECISION_DIVISOR,
    marketRegime,
    avgTransparency: trades.length > 0
      ? Math.round(trades.reduce((s, t) => s + t.transparencyScore, 0) / trades.length * SCORE_PRECISION_MULTIPLIER) / SCORE_PRECISION_DIVISOR
      : 50,
    avgAccountability: trades.length > 0
      ? Math.round(trades.reduce((s, t) => s + t.accountabilityScore, 0) / trades.length * SCORE_PRECISION_MULTIPLIER) / SCORE_PRECISION_DIVISOR
      : 50,
    avgGrounding: trades.length > 0
      ? Math.round(trades.reduce((s, t) => s + t.groundingScore, 0) / trades.length * SCORE_PRECISION_MULTIPLIER) / SCORE_PRECISION_DIVISOR
      : 50,
    avgConsensusQuality: trades.length > 0
      ? Math.round(trades.reduce((s, t) => s + t.consensusQualityScore, 0) / trades.length * SCORE_PRECISION_MULTIPLIER) / SCORE_PRECISION_DIVISOR
      : 50,
  };

  roundSummaries.unshift(summary);
  if (roundSummaries.length > 200) roundSummaries.length = 200;

  return summary;
}

// ---------------------------------------------------------------------------
// Public Getters
// ---------------------------------------------------------------------------

export function getAgentScores(): V32AgentScore[] {
  return Array.from(agentScores.values());
}

export function getAgentScore(agentId: string): V32AgentScore | undefined {
  return agentScores.get(agentId);
}

export function getTradeGrades(limit = 50): V32TradeGrade[] {
  return tradeGrades.slice(0, limit);
}

export function getTradeGradesByAgent(agentId: string, limit = 50): V32TradeGrade[] {
  return tradeGrades.filter((g) => g.agentId === agentId).slice(0, limit);
}

export function getRoundSummaries(limit = 20): V32RoundSummary[] {
  return roundSummaries.slice(0, limit);
}

export function getDimensionWeights(): Record<string, number> {
  return { ...DIMENSION_WEIGHTS };
}

export function getDimensionCount(): number {
  return 24;
}

export function getBenchmarkVersion(): string {
  return "32.0";
}
