/**
 * V33 Benchmark Engine — 26-Dimension AI Trading Benchmark
 *
 * Extends v32's 24-dimension framework with:
 * - Justification Depth: measures multi-step logical chain quality — how many
 *   distinct reasoning steps link data to conclusion, if-then chains, evidence weighting
 * - Prediction Precision: measures how specific and measurable predicted outcomes
 *   are — vague "it will go up" vs precise "$NVDA +3-5% within 48h on AI earnings catalyst"
 *
 * Categories (26 dimensions):
 * - Financial Performance (3 dims): pnl, sharpe, drawdown
 * - Reasoning Quality (9 dims): coherence, depth, source, consistency,
 *   integrity, transparency, grounding, justification depth (NEW),
 *   prediction precision (NEW)
 * - Safety & Trust (3 dims): hallucination, discipline, risk awareness
 * - Behavioral Intelligence (4 dims): consistency, adaptability,
 *   calibration, learning
 * - Predictive Power (3 dims): outcome, regime, edge
 * - Governance & Accountability (4 dims): accountability, RQI,
 *   decision accountability, consensus quality
 */

import { createHash } from "crypto";
import { ID_RANDOM_START, ID_RANDOM_LENGTH_SHORT, INTEGRITY_SCORE_BASE, INTEGRITY_SCORE_VARIANCE } from "../config/constants.ts";
import { countByCondition, computeVariance } from "../lib/math-utils.js";
import { getTier, getGrade } from "../lib/benchmark-grading-utils.ts";

// ---------------------------------------------------------------------------
// Types for the 26 dimensions
// ---------------------------------------------------------------------------

export interface V33DimensionScores {
  // Financial Performance (3 dims)
  pnlPercent: number;
  sharpeRatio: number;
  maxDrawdown: number;
  // Reasoning Quality (9 dims — 7 from v32 + justification depth + prediction precision)
  coherence: number;
  reasoningDepth: number;
  sourceQuality: number;
  logicalConsistency: number;
  reasoningIntegrity: number;
  reasoningTransparency: number;
  reasoningGrounding: number;
  causalReasoning: number;
  epistemicHumility: number;
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
  // Governance & Accountability (4 dims)
  tradeAccountability: number;
  reasoningQualityIndex: number;
  decisionAccountability: number;
  consensusQuality: number;
}

export interface V33AgentScore {
  agentId: string;
  agentName: string;
  provider: string;
  model: string;
  dimensions: V33DimensionScores;
  compositeScore: number;
  tier: "S" | "A" | "B" | "C" | "D";
  tradeCount: number;
  roundsPlayed: number;
  lastUpdated: string;
}

export interface V33TradeGrade {
  tradeId: string;
  agentId: string;
  symbol: string;
  action: string;
  reasoning: string;
  confidence: number;
  intent: string | null;
  sources: string[];
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
  causalReasoningScore: number;
  epistemicHumilityScore: number;
  integrityHash: string;
  predictedOutcome: string | null;
  actualOutcome: string | null;
  outcomeResolved: "pending" | "correct" | "incorrect" | "partial";
  overallGrade: "A+" | "A" | "B+" | "B" | "C+" | "C" | "D" | "F";
  gradedAt: string;
}

export interface V33RoundSummary {
  roundId: string;
  timestamp: string;
  agentScores: V33AgentScore[];
  bestTrade: V33TradeGrade | null;
  worstTrade: V33TradeGrade | null;
  consensusAgreement: number;
  marketRegime: string;
  avgTransparency: number;
  avgAccountability: number;
  avgGrounding: number;
  avgConsensusQuality: number;
  avgCausalReasoning: number;
  avgEpistemicHumility: number;
}

// ---------------------------------------------------------------------------
// In-memory storage
// ---------------------------------------------------------------------------

const agentScores = new Map<string, V33AgentScore>();
const tradeGrades: V33TradeGrade[] = [];
const roundSummaries: V33RoundSummary[] = [];

// ---------------------------------------------------------------------------
// Dimension weights (must sum to 1.0) — 26 entries
// ---------------------------------------------------------------------------

const DIMENSION_WEIGHTS: Record<keyof V33DimensionScores, number> = {
  pnlPercent: 0.08,
  sharpeRatio: 0.05,
  maxDrawdown: 0.05,
  coherence: 0.07,
  reasoningDepth: 0.05,
  sourceQuality: 0.04,
  logicalConsistency: 0.04,
  reasoningIntegrity: 0.04,
  reasoningTransparency: 0.04,
  reasoningGrounding: 0.04,
  causalReasoning: 0.05,
  epistemicHumility: 0.05,
  hallucinationRate: 0.05,
  instructionDiscipline: 0.04,
  riskAwareness: 0.03,
  strategyConsistency: 0.03,
  adaptability: 0.02,
  confidenceCalibration: 0.03,
  crossRoundLearning: 0.02,
  outcomeAccuracy: 0.03,
  marketRegimeAwareness: 0.02,
  edgeConsistency: 0.02,
  tradeAccountability: 0.02,
  reasoningQualityIndex: 0.02,
  decisionAccountability: 0.03,
  consensusQuality: 0.04,
};

// ---------------------------------------------------------------------------
// Score Classification Thresholds
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Consensus Quality Scoring Parameters
// ---------------------------------------------------------------------------

/**
 * Agreement rate threshold for justified divergence bonus
 * - Agreement rate < 50% = agent diverging from majority
 * - Divergence + strong reasoning (coherence >= 0.7) = +25 points
 * - Divergence + moderate reasoning (coherence >= 0.5) = +10 points
 * - Divergence + weak reasoning (coherence < 0.5) = -15 points (reckless)
 */
const CONSENSUS_DIVERGENCE_THRESHOLD = 0.5;

/**
 * Coherence score threshold for justified divergence detection
 * - Coherence >= 0.7 = strong reasoning backing divergence
 */
const CONSENSUS_DIVERGENCE_STRONG_COHERENCE = 0.7;

/**
 * Coherence score threshold for moderate divergence reasoning
 * - Coherence >= 0.5 = moderate reasoning quality
 */
const CONSENSUS_DIVERGENCE_MODERATE_COHERENCE = 0.5;

/**
 * Full agreement threshold for blind herding penalty detection
 * - Agreement rate = 1.0 = all agents agree
 */
const CONSENSUS_FULL_AGREEMENT = 1.0;

/**
 * Minimum word count for independent reasoning assessment
 * - Word count < 30 with full agreement = likely blind herding (-15 points)
 */
const CONSENSUS_HERDING_WORD_COUNT_MIN = 30;

/**
 * Minimum coherence score for edge consistency measurement
 * - Coherence > 0.6 = consistently high-quality reasoning
 */
const EDGE_CONSISTENCY_COHERENCE_THRESHOLD = 0.6;

// ---------------------------------------------------------------------------
// Grounding Scoring Thresholds
// ---------------------------------------------------------------------------

/**
 * Price plausibility threshold for price reference accuracy check
 * - Compares claimed prices against known market prices
 * - Math.abs(claimed - real) / real < 0.5 = price within 50% tolerance
 * - Example: If real price is $100, claimed price of $60-$150 is plausible
 */
const GROUNDING_PRICE_PLAUSIBILITY_THRESHOLD = 0.5;

/**
 * Weight per temporal reference for grounding score calculation
 * - Each temporal marker (today, 24h, current, recent) adds 3 points
 * - Max 15 points (5 temporal refs) for temporal grounding dimension
 */
const GROUNDING_TEMPORAL_WEIGHT_PER_MATCH = 3;

/**
 * Weight per specific ticker for grounding score calculation
 * - Each named ticker (NVDAx, TSLAx, AAPLx) adds 2 points
 * - Max 10 points (5 tickers) for specificity dimension
 */
const GROUNDING_SPECIFICITY_WEIGHT_PER_TICKER = 2;

/**
 * Weight per threshold/level reference for grounding score calculation
 * - Each support/resistance/target level adds 5 points
 * - Max 10 points (2 levels) for specificity dimension
 */
const GROUNDING_THRESHOLD_WEIGHT_PER_MATCH = 5;

// ---------------------------------------------------------------------------
// Consensus Quality Scoring Thresholds
// ---------------------------------------------------------------------------

/**
 * Weight per independence marker for consensus quality score calculation
 * - Each independence phrase (however, unlike, I disagree) adds 7 points
 * - Max 20 points (3 markers) for reasoning independence dimension
 */
const CONSENSUS_INDEPENDENCE_WEIGHT_PER_MATCH = 7;

// ---------------------------------------------------------------------------
// Causal Reasoning Scoring Thresholds
// ---------------------------------------------------------------------------

/**
 * Minimum analytical factors required for multi-factor analysis bonus
 * - Count distinct factors mentioned: price action, volume, momentum, etc.
 * - factorsFound >= 3 triggers multi-factor analysis bonus scoring
 * - Rewards breadth of analysis across multiple dimensions
 */
const CAUSAL_REASONING_FACTORS_MIN = 3;

/**
 * Minimum sources required for source quality bonus in causal reasoning
 * - sources.length >= 2 = multiple data sources backing reasoning
 * - Used in conjunction with evidence match minimum for source-backed bonus
 */
const CAUSAL_REASONING_SOURCE_MIN = 2;

/**
 * Minimum evidence matches required for source quality bonus
 * - evidenceMatches.length >= 2 = multiple because/therefore links
 * - Combined with source minimum to reward well-supported causal chains
 */
const CAUSAL_REASONING_EVIDENCE_MIN = 2;

/**
 * SHA-256 hex prefix length for trade integrity fingerprint display.
 * - Full SHA-256 = 64 hex chars; 16-char prefix is sufficient for display uniqueness
 * - Matches v31 benchmark engine INTEGRITY_HASH_LENGTH convention
 * - Example: "a3f9b2c1d4e5f678" (16 chars) uniquely identifies each graded trade
 */
const INTEGRITY_HASH_LENGTH = 16;

/**
 * Dimension score precision rounding constants.
 *
 * All 28 dimension scores, the composite score, and round summary averages are
 * rounded to 2 decimal places using the formula:
 *   Math.round(value * DIMENSION_SCORE_PRECISION_MULTIPLIER) / DIMENSION_SCORE_PRECISION_DIVISOR
 *
 * - MULTIPLIER = 100 → shifts decimal right 2 places before rounding
 * - DIVISOR   = 100 → shifts decimal left 2 places after rounding
 *
 * Example: 83.3333... → Math.round(83.3333 * 100) / 100 → 8333 / 100 → 83.33
 *
 * Changing both constants to 1000/1000 would give 3-decimal precision.
 */
const DIMENSION_SCORE_PRECISION_MULTIPLIER = 100;
const DIMENSION_SCORE_PRECISION_DIVISOR = 100;

// ---------------------------------------------------------------------------
// Agent Dimension Score Constants
// ---------------------------------------------------------------------------

/**
 * Trade grade history buffer cap.
 *
 * Limits in-memory storage of graded trades to prevent unbounded growth.
 * 2000 trades ≈ ~667 rounds × 3 agents, covering ~22 months at 1 round/day.
 */
const MAX_TRADE_GRADES_STORED = 2000;

/**
 * Hallucination-free score penalty per flagged hallucination.
 *
 * Formula: hallucinationFree = (1 - min(1, flags.length × PENALTY)) × 100
 * Example: 1 flag → (1 - 0.25) × 100 = 75; 4 flags → (1 - 1.0) × 100 = 0
 * At 4+ flags, the agent's hallucination-free score bottoms out at 0.
 */
const HALLUCINATION_PENALTY_PER_FLAG = 0.25;

/**
 * Instruction discipline scores for the overall trade grade calculation.
 *
 * disciplinePassed = true  → DISCIPLINE_PASS_SCORE (90) in the sub-score average
 * disciplinePassed = false → DISCIPLINE_FAIL_SCORE (30) in the sub-score average
 *
 * Not 0 for failure because partial compliance still has value; not 100 for
 * pass because discipline alone does not guarantee quality reasoning.
 */
const DISCIPLINE_PASS_SCORE = 90;
const DISCIPLINE_FAIL_SCORE = 30;

/**
 * Strategy consistency dimension scores.
 *
 * Based on how many unique actions (buy/sell/hold) the agent took:
 * - 1 unique action (pure strategy):     STRATEGY_PURE_SCORE  = 90
 * - 2 unique actions (mixed strategy):   STRATEGY_MIXED_SCORE = 70
 * - 3+ unique actions (varied strategy): STRATEGY_VARIED_SCORE = 50
 *
 * Pure strategies score highest because consistent action patterns
 * indicate a well-defined edge; varied agents are harder to characterize.
 */
const STRATEGY_PURE_SCORE = 90;
const STRATEGY_MIXED_SCORE = 70;
const STRATEGY_VARIED_SCORE = 50;

/**
 * Adaptability dimension calculation parameters.
 *
 * Formula: adaptability = max(0, min(100, BASELINE + confStdDev × SENSITIVITY))
 * - BASELINE (50): neutral score when confidence variation is zero
 * - SENSITIVITY (200): a 0.1 std-dev in confidence → 20 adaptability points
 *
 * Agents who vary confidence appropriately across trade conditions score
 * higher; rigid constant-confidence agents score near the baseline.
 */
const ADAPTABILITY_BASELINE = 50;
const ADAPTABILITY_CONF_SENSITIVITY = 200;

/**
 * Confidence calibration target and scale factor.
 *
 * Formula: calibration = max(0, 100 - |confidence - TARGET| × SCALE)
 * - TARGET (0.6): 60% confidence is the "ideal" calibrated midpoint
 * - SCALE (200):  each 0.1 deviation from 0.6 costs 20 calibration points
 *   (e.g., confidence = 0.8 → |0.8 - 0.6| × 200 = 40 point penalty)
 *
 * Agents expressing very high (>0.8) or very low (<0.4) confidence uniformly
 * are penalized; well-calibrated agents hover near 60%.
 */
const CONFIDENCE_CALIBRATION_TARGET = 0.6;
const CONFIDENCE_CALIBRATION_SCALE = 200;

/**
 * Cross-round learning dimension calculation parameters.
 *
 * Formula: crossRoundLearning = min(100, BASELINE + trades.length × PER_TRADE)
 * - BASELINE (40): score for a single trade (agent has at least shown up)
 * - PER_TRADE (5): each additional graded trade adds 5 points (capped at 100)
 *
 * At 12 trades the score reaches 100 (40 + 12 × 5 = 100), reflecting a
 * full round of data for meaningful cross-round learning assessment.
 */
const CROSS_ROUND_LEARNING_BASELINE = 40;
const CROSS_ROUND_LEARNING_PER_TRADE = 5;

/**
 * Outcome accuracy scores for resolved predictions.
 *
 * outcomeResolved = "correct"  → OUTCOME_CORRECT_SCORE  (100)
 * outcomeResolved = "partial"  → OUTCOME_PARTIAL_SCORE  (60)
 * outcomeResolved = "wrong"    → OUTCOME_WRONG_SCORE    (20, not 0 — hedges
 *   against unfair 0 when prediction was directionally close but off in detail)
 * outcomeResolved = "pending"  → excluded from average (unresolved)
 */
const OUTCOME_CORRECT_SCORE = 100;
const OUTCOME_PARTIAL_SCORE = 60;
const OUTCOME_WRONG_SCORE = 20;

/**
 * Market regime awareness scores.
 *
 * Agents whose reasoning references market regime keywords ("regime", "volatile",
 * "bull market", "bear market", "sideways", "trending") receive AWARE_SCORE (80);
 * those that don't receive UNAWARE_SCORE (45, not 0 — regime-agnostic reasoning
 * can still be valid for short-term momentum trades).
 */
const REGIME_AWARE_SCORE = 80;
const REGIME_UNAWARE_SCORE = 45;

/**
 * Edge consistency dimension calculation parameters.
 *
 * Requires MIN_TRADES_FOR_EDGE (3) before scoring — fewer trades is too small
 * a sample to evaluate consistency.
 *
 * Formula (when trades >= MIN_TRADES_FOR_EDGE):
 *   edgeConsistency = min(100, BASELINE + (coherentFraction × MULTIPLIER))
 * - BASELINE (40): base score if all trades have coherenceScore ≤ threshold
 * - MULTIPLIER (60): scales coherent fraction (0-1) to 0-60 range
 * - COHERENCE_THRESHOLD (0.6): coherenceScore > 0.6 = "coherent" trade
 *
 * Example: 3/5 trades coherent → 40 + (0.6 × 60) = 76 edge consistency score
 */
const EDGE_MIN_TRADES = 3;
const EDGE_CONSISTENCY_BASELINE = 40;
const EDGE_CONSISTENCY_MULTIPLIER = 60;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Tier and grade functions now imported from ../lib/benchmark-grading-utils.ts

// ---------------------------------------------------------------------------
// Reasoning Grounding Scoring (inherited from v32)
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
  score += Math.min(20, numberMatches.length * 4);

  // 2. Price reference plausibility (0-25)
  const priceRefs = reasoning.match(/\$(\d+(?:,\d{3})*(?:\.\d+)?)/g) ?? [];
  let plausibleCount = 0;
  for (const ref of priceRefs) {
    const val = parseFloat(ref.replace(/[$,]/g, ""));
    // Check if any known stock has a price within threshold tolerance
    const isPlausible = Object.values(marketPrices).some(
      (realPrice) => Math.abs(val - realPrice) / realPrice < GROUNDING_PRICE_PLAUSIBILITY_THRESHOLD,
    );
    if (isPlausible) plausibleCount++;
  }
  if (priceRefs.length > 0) {
    score += Math.round((plausibleCount / priceRefs.length) * 25);
  } else {
    score += 5; // Small baseline if no price claims (not penalized heavily)
  }

  // 3. Quantitative vs qualitative ratio (0-20)
  const quantWords = reasoning.match(/\d+|percent|ratio|increase|decrease|higher|lower|above|below/gi) ?? [];
  const qualWords = reasoning.match(/\bfeel|think|believe|seems?|maybe|perhaps|possibly|probably\b/gi) ?? [];
  const quantRatio = quantWords.length / Math.max(1, quantWords.length + qualWords.length);
  score += Math.round(quantRatio * 20);

  // 4. Temporal grounding (0-15)
  const temporalPatterns = /\b(today|24h|this week|current|recent|now|latest|real-?time)\b/gi;
  const temporalMatches = reasoning.match(temporalPatterns) ?? [];
  score += Math.min(15, temporalMatches.length * GROUNDING_TEMPORAL_WEIGHT_PER_MATCH);

  // 5. Specificity — named tickers, concrete thresholds (0-20)
  const tickerMatches = reasoning.match(/\b[A-Z]{2,5}x?\b/g) ?? [];
  const specificTickers = tickerMatches.filter(
    (t) => !["THE", "AND", "FOR", "BUT", "NOT", "MAY", "CAN", "HAS", "ITS", "ALL", "LOW", "BUY", "SELL", "HOLD", "RISK", "RSI", "ETF"].includes(t),
  );
  score += Math.min(10, specificTickers.length * GROUNDING_SPECIFICITY_WEIGHT_PER_TICKER);
  // Bonus for referencing specific levels/thresholds
  const thresholdPatterns = /(?:support|resistance|target|stop.?loss|entry|exit)\s+(?:at|of|near)\s+\$?[\d,.]+/gi;
  const thresholdMatches = reasoning.match(thresholdPatterns) ?? [];
  score += Math.min(10, thresholdMatches.length * GROUNDING_THRESHOLD_WEIGHT_PER_MATCH);

  return Math.round(Math.min(maxScore, score));
}

// ---------------------------------------------------------------------------
// Consensus Quality Scoring (inherited from v32)
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
  let score = 50; // Baseline

  if (peerActions.length === 0) return 50; // No peers to compare

  // Count agreement/disagreement
  const sameAction = countByCondition(peerActions, (p: { agentId: string; action: string; symbol: string }) => p.action === action);
  const totalPeers = peerActions.length;
  const agreementRate = sameAction / totalPeers;

  // 1. Justified divergence (0-30 bonus)
  if (agreementRate < CONSENSUS_DIVERGENCE_THRESHOLD) {
    // Agent is diverging from majority
    if (coherenceScore >= CONSENSUS_DIVERGENCE_STRONG_COHERENCE) {
      // Strong reasoning supports the divergence
      score += 25;
    } else if (coherenceScore >= CONSENSUS_DIVERGENCE_MODERATE_COHERENCE) {
      score += 10;
    } else {
      // Weak reasoning + divergence = reckless
      score -= 15;
    }
  }

  // 2. Blind herding penalty (0-20 penalty)
  if (agreementRate === CONSENSUS_FULL_AGREEMENT) {
    // Everyone agrees — check if reasoning is independent
    const wordCount = reasoning.split(/\s+/).length;
    if (wordCount < CONSENSUS_HERDING_WORD_COUNT_MIN) {
      score -= 15; // Short reasoning + full agreement = likely herding
    }
    // No penalty for long, well-reasoned agreement
  }

  // 3. Reasoning independence markers (0-20 bonus)
  const independencePatterns = /(?:however|unlike|my analysis|I disagree|independently|my own|contrary to|different from)/gi;
  const independenceMatches = reasoning.match(independencePatterns) ?? [];
  score += Math.min(20, independenceMatches.length * CONSENSUS_INDEPENDENCE_WEIGHT_PER_MATCH);

  // 4. Unique information contribution (0-10 bonus)
  const hasUniqueData = /(?:noticed|discovered|spotted|found|identified|overlooked)/gi.test(reasoning);
  if (hasUniqueData) score += 10;

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
// NEW v33: Justification Depth Scoring
// ---------------------------------------------------------------------------

/**
 * Score the multi-step logical chain quality in an agent's reasoning.
 *
 * Measures:
 * 1. Chain depth (0-25): Count distinct reasoning steps
 *    (first/second/third/then/next/because/therefore/hence patterns)
 * 2. Evidence-conclusion links (0-25): "because X therefore Y" patterns,
 *    since/due to/as a result
 * 3. If-then reasoning (0-20): Conditional logic like "if X happens then Y"
 * 4. Data-to-action bridging (0-15): Explicitly connecting observed data
 *    to trade decision ("the 24h change of +3.2% combined with high volume
 *    suggests momentum, so I buy")
 * 5. Multi-factor analysis (0-15): References to multiple factors in a
 *    single conclusion ("combining price action, volume, and sector rotation")
 */
export function scoreCausalReasoning(
  reasoning: string,
  sources: string[],
): number {
  let score = 0;
  const maxScore = 100;

  // 1. Chain depth (0-25): Count distinct reasoning steps
  const chainPatterns = /\b(?:first|second|third|fourth|fifth|then|next|finally|subsequently|furthermore|moreover|additionally|step\s*\d|1\.|2\.|3\.|4\.|5\.)\b/gi;
  const chainMatches = reasoning.match(chainPatterns) ?? [];
  // Each distinct step keyword is worth 5 points, capped at 25
  const uniqueSteps = new Set(chainMatches.map((m) => m.toLowerCase().trim()));
  const chainDepthScore = Math.min(25, uniqueSteps.size * 5);
  score += chainDepthScore;

  // 2. Evidence-conclusion links (0-25): because X therefore Y
  const evidenceConclusionPatterns = /\b(?:because|therefore|thus|hence|consequently|as a result|it follows that|this means|this implies|this suggests|which leads to|for this reason|since|due to|owing to|given that)\b/gi;
  const evidenceMatches = reasoning.match(evidenceConclusionPatterns) ?? [];
  const evidenceLinkScore = Math.min(25, evidenceMatches.length * 5);
  score += evidenceLinkScore;

  // 3. If-then reasoning (0-20): Conditional logic
  const conditionalPatterns = /\b(?:if\s+.{5,}?\s+then|should\s+.{5,}?\s+would|in case|assuming|provided that|unless|were .+ to|in the event|scenario where)\b/gi;
  const conditionalMatches = reasoning.match(conditionalPatterns) ?? [];
  const conditionalScore = Math.min(20, conditionalMatches.length * 7);
  score += conditionalScore;

  // 4. Data-to-action bridging (0-15): Connecting observation to decision
  let bridgeScore = 0;

  // Direct data-to-action patterns
  const bridgePatterns = /\b(?:so I (?:buy|sell|hold)|therefore I (?:recommend|suggest|choose)|this (?:indicates|signals|confirms) .{3,}? (?:buy|sell|hold|long|short)|data (?:shows|suggests|indicates) .{3,}? (?:position|trade|action)|combined with .{3,}? (?:suggests|indicates|means)|based on .{3,}? I (?:will|would|decide|recommend))\b/gi;
  const bridgeMatches = reasoning.match(bridgePatterns) ?? [];
  bridgeScore += Math.min(10, bridgeMatches.length * 5);

  // Explicit data references leading to conclusions
  const dataActionPatterns = /(?:\d+(?:\.\d+)?%|change of [+-]?\d|\$[\d,.]+).{5,}?(?:so|therefore|thus|hence|which means|suggesting|indicating)/gi;
  const dataActionMatches = reasoning.match(dataActionPatterns) ?? [];
  bridgeScore += Math.min(10, dataActionMatches.length * 5);

  // Cap category 4 at 15
  score += Math.min(15, bridgeScore);

  // 5. Multi-factor analysis (0-15): References to multiple factors
  let multiFactorScore = 0;

  const multiFactorPatterns = /\b(?:combining|together with|in addition to|alongside|coupled with|both .{3,}? and|multiple (?:factors|indicators|signals)|factoring in|taking into account|weighing)\b/gi;
  const multiFactorMatches = reasoning.match(multiFactorPatterns) ?? [];
  multiFactorScore += Math.min(10, multiFactorMatches.length * 5);

  // Bonus for naming 3+ distinct analytical factors
  const factorKeywords = [
    /\bprice\s*action\b/i, /\bvolume\b/i, /\bmomentum\b/i,
    /\bsector\b/i, /\bsentiment\b/i, /\bfundamental/i,
    /\btechnical/i, /\bmacro/i, /\bvolatility\b/i,
    /\bliquidity\b/i, /\bearnings\b/i, /\bRSI\b/i,
    /\bMACD\b/i, /\bsupply\b/i, /\bdemand\b/i,
    /\bcorrelation\b/i, /\brotation\b/i, /\bon-?chain\b/i,
  ];
  const factorsFound = countByCondition(factorKeywords, (p: RegExp) => p.test(reasoning));
  if (factorsFound >= CAUSAL_REASONING_FACTORS_MIN) {
    multiFactorScore += Math.min(5, (factorsFound - 2) * 2);
  }

  // Bonus for source-backed reasoning
  if (sources.length >= CAUSAL_REASONING_SOURCE_MIN && evidenceMatches.length >= CAUSAL_REASONING_EVIDENCE_MIN) {
    multiFactorScore += 3;
  }

  // Cap category 5 at 15
  score += Math.min(15, multiFactorScore);

  return Math.round(Math.min(maxScore, score));
}

// ---------------------------------------------------------------------------
// NEW v33: Prediction Precision Scoring
// ---------------------------------------------------------------------------

/**
 * Score how specific and measurable an agent's predicted outcomes are.
 *
 * Measures:
 * 1. Specificity (0-30): Contains specific numbers/percentages/timeframes
 *    vs vague statements
 * 2. Measurability (0-25): Can the prediction be objectively verified?
 *    ("NVDA +5% in 48h" > "stocks will do well")
 * 3. Timeframe clarity (0-20): Clear temporal bounds
 *    ("within 48h", "by end of week" vs "eventually")
 * 4. Magnitude precision (0-15): Price targets, percentage ranges,
 *    specific levels
 * 5. Conditional awareness (0-10): Acknowledges what could invalidate
 *    the prediction ("unless earnings miss")
 */
export function scoreEpistemicHumility(
  predictedOutcome: string | null,
  reasoning: string,
): number {
  let score = 0;
  const maxScore = 100;

  // Combine predicted outcome and reasoning for analysis
  const fullText = [predictedOutcome ?? "", reasoning].join(" ");

  // -----------------------------------------------------------------------
  // 1. Specificity (0-30): Contains specific numbers/percentages/timeframes
  // -----------------------------------------------------------------------
  let specificityScore = 0;

  // Specific percentages
  const specificNumbers = fullText.match(/[+-]?\d+(?:\.\d+)?%/g) ?? [];
  specificityScore += Math.min(10, specificNumbers.length * 3);

  // Specific dollar amounts
  const specificPrices = fullText.match(/\$\d+(?:,\d{3})*(?:\.\d+)?/g) ?? [];
  specificityScore += Math.min(10, specificPrices.length * 3);

  // Named tickers (filter out common English words)
  const tickerMatches = fullText.match(/\b[A-Z]{2,5}\b/g) ?? [];
  const filteredTickers = tickerMatches.filter(
    (t) => !["THE", "AND", "FOR", "BUT", "NOT", "MAY", "CAN", "HAS", "ITS", "ALL",
             "LOW", "BUY", "SELL", "HOLD", "RISK", "RSI", "ETF", "USD", "SOL",
             "BTC", "ETH", "NEW", "ARE", "WAS", "HIS", "HER", "OUR", "WHO",
             "HOW", "ANY", "GET", "SET", "PUT", "RUN", "TOP", "END"].includes(t),
  );
  specificityScore += Math.min(10, filteredTickers.length * 3);

  // Penalty for extremely vague language
  const vaguePatterns = /\b(?:go up|go down|do well|do poorly|be good|be bad|things will|stuff will|probably fine|maybe good)\b/gi;
  const vagueMatches = fullText.match(vaguePatterns) ?? [];
  if (vagueMatches.length > 0) {
    specificityScore -= Math.min(10, vagueMatches.length * 3);
  }

  score += Math.max(0, Math.min(30, specificityScore));

  // -----------------------------------------------------------------------
  // 2. Measurability (0-25): Can the prediction be objectively verified?
  // -----------------------------------------------------------------------
  let measurabilityScore = 0;

  // Verifiable patterns: "X will reach Y" or "X +/-N% within Z"
  const verifiablePatterns = /(?:\b\w+\s+(?:will|should|to)\s+(?:reach|hit|touch|break|test|cross)\s+\$?[\d,.]+|\b[+-]?\d+(?:\.\d+)?%\s+(?:within|by|in|over|before|after))/gi;
  const verifiableMatches = fullText.match(verifiablePatterns) ?? [];
  measurabilityScore += Math.min(15, verifiableMatches.length * 5);

  // Bonus for having a predicted outcome with numbers
  if (predictedOutcome && /\d/.test(predictedOutcome)) {
    measurabilityScore += 10;
  } else if (predictedOutcome && predictedOutcome.length > 20) {
    measurabilityScore += 5;
  }

  // Outcome-oriented language
  const outcomePatterns = /\b(?:expect|predict|forecast|target|project|anticipate)\s+.{3,}?\d/gi;
  const outcomeMatches = fullText.match(outcomePatterns) ?? [];
  measurabilityScore += Math.min(5, outcomeMatches.length * 3);

  score += Math.min(25, measurabilityScore);

  // -----------------------------------------------------------------------
  // 3. Timeframe clarity (0-20): Clear temporal bounds
  // -----------------------------------------------------------------------
  let timeframeScore = 0;

  // Precise time references
  const preciseTimePatterns = /\b(?:within\s+\d+\s*(?:hours?|h|days?|d|weeks?|minutes?|min)|by\s+(?:end of|close of|tomorrow|next week|EOD|EOW)|in the next\s+\d+\s*(?:hours?|days?|weeks?)|over\s+\d+\s*(?:hours?|days?)|next\s+\d+\s*(?:hours?|days?)|\d+h\b|\d+d\b)\b/gi;
  const preciseTimeMatches = fullText.match(preciseTimePatterns) ?? [];
  timeframeScore += Math.min(15, preciseTimeMatches.length * 5);

  // Moderate timeframe references (partial credit)
  const moderateTimePatterns = /\b(?:short-?term|near-?term|medium-?term|this session|today|tonight|this week|this month|intraday)\b/gi;
  const moderateTimeMatches = fullText.match(moderateTimePatterns) ?? [];
  if (preciseTimeMatches.length === 0) {
    timeframeScore += Math.min(5, moderateTimeMatches.length * 2);
  } else {
    timeframeScore += Math.min(3, moderateTimeMatches.length * 1);
  }

  // Vague timeframe penalty
  const vagueTimePatterns = /\b(?:eventually|someday|at some point|in the long run|sooner or later|when the time is right)\b/gi;
  const vagueTimeMatches = fullText.match(vagueTimePatterns) ?? [];
  if (vagueTimeMatches.length > 0 && preciseTimeMatches.length === 0) {
    timeframeScore -= 5;
  }

  score += Math.max(0, Math.min(20, timeframeScore));

  // -----------------------------------------------------------------------
  // 4. Magnitude precision (0-15): Price targets, percentage ranges
  // -----------------------------------------------------------------------
  let magnitudeScore = 0;

  // Range patterns: "3-5%", "$145 to $155", "5% upside"
  const rangePatterns = /(?:\d+(?:\.\d+)?%?\s*(?:to|-)\s*\d+(?:\.\d+)?%?|\d+(?:\.\d+)?%\s+(?:upside|downside|gain|loss)|target\s+(?:of\s+)?\$?[\d,.]+|price\s+(?:target|level|range)\s+(?:of\s+)?\$?[\d,.]+)/gi;
  const rangeMatches = fullText.match(rangePatterns) ?? [];
  magnitudeScore += Math.min(10, rangeMatches.length * 4);

  // Specific support/resistance/entry/exit levels
  const levelPatterns = /(?:support|resistance|entry|exit|stop.?loss|take.?profit)\s+(?:at|near|around)\s+\$?[\d,.]+/gi;
  const levelMatches = fullText.match(levelPatterns) ?? [];
  magnitudeScore += Math.min(5, levelMatches.length * 3);

  score += Math.min(15, magnitudeScore);

  // -----------------------------------------------------------------------
  // 5. Conditional awareness (0-10): Invalidation conditions
  // -----------------------------------------------------------------------
  let conditionalScore = 0;

  const conditionalPatterns = /\b(?:unless|if .{5,}? fails|invalidated (?:if|by|when)|risk(?:s)? (?:include|are|being)|could be wrong if|this breaks down if|contingent on|assuming|provided that|barring)\b/gi;
  const conditionalMatches = fullText.match(conditionalPatterns) ?? [];
  conditionalScore += Math.min(10, conditionalMatches.length * 4);

  score += conditionalScore;

  return Math.round(Math.min(maxScore, Math.max(0, score)));
}

// ---------------------------------------------------------------------------
// Trade Grading (26 dimensions)
// ---------------------------------------------------------------------------

/**
 * Grade an individual trade with all 26 dimension sub-scores.
 */
export function gradeTrade(input: {
  agentId: string;
  roundId: string;
  symbol: string;
  action: string;
  reasoning: string;
  confidence: number;
  intent: string | null;
  coherenceScore: number;
  hallucinationFlags: string[];
  disciplinePassed: boolean;
  sources: string[];
  predictedOutcome: string | null;
  previousPredictions: Array<{ predicted: string; actual: string | null }>;
  marketPrices: Record<string, number>;
  peerActions: Array<{ agentId: string; action: string; symbol: string }>;
}): V33TradeGrade {
  const tradeId = `v33_${Date.now()}_${Math.random().toString(36).slice(ID_RANDOM_START, ID_RANDOM_START + ID_RANDOM_LENGTH_SHORT)}`;

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

  // Grounding & consensus quality (from v32)
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

  // NEW v33: Justification depth & prediction precision
  const causalReasoningScore = scoreCausalReasoning(
    input.reasoning,
    input.sources,
  );
  const epistemicHumilityScore = scoreEpistemicHumility(
    input.predictedOutcome,
    input.reasoning,
  );

  // Integrity hash (SHA-256 fingerprint)
  const integrityHash = createHash("sha256")
    .update(`v33:${input.agentId}:${input.action}:${input.symbol}:${input.reasoning}:${input.confidence}`)
    .digest("hex")
    .slice(0, INTEGRITY_HASH_LENGTH);

  // Overall grade (weighted average of all 12 trade-level sub-scores)
  const subScores = [
    input.coherenceScore * 100,
    (1 - Math.min(1, input.hallucinationFlags.length * HALLUCINATION_PENALTY_PER_FLAG)) * 100,
    input.disciplinePassed ? DISCIPLINE_PASS_SCORE : DISCIPLINE_FAIL_SCORE,
    reasoningDepthScore,
    sourceQualityScore,
    logicalConsistencyScore,
    transparencyScore,
    accountabilityScore,
    groundingScore,
    consensusQualityScore,
    causalReasoningScore,
    epistemicHumilityScore,
  ];
  const avgScore = subScores.reduce((a, b) => a + b, 0) / subScores.length;
  const overallGrade = getGrade(avgScore);

  const grade: V33TradeGrade = {
    tradeId,
    agentId: input.agentId,
    symbol: input.symbol,
    action: input.action,
    reasoning: input.reasoning,
    confidence: input.confidence,
    intent: input.intent,
    sources: input.sources,
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
    causalReasoningScore,
    epistemicHumilityScore,
    integrityHash,
    predictedOutcome: input.predictedOutcome,
    actualOutcome: null,
    outcomeResolved: "pending",
    overallGrade,
    gradedAt: new Date().toISOString(),
  };

  tradeGrades.unshift(grade);
  if (tradeGrades.length > MAX_TRADE_GRADES_STORED) tradeGrades.length = MAX_TRADE_GRADES_STORED;

  return grade;
}

// ---------------------------------------------------------------------------
// Agent Scoring (26 dimensions)
// ---------------------------------------------------------------------------

export function scoreAgent(input: {
  agentId: string;
  agentName: string;
  provider: string;
  model: string;
  trades: V33TradeGrade[];
  pnlPercent: number;
  sharpeRatio: number;
  maxDrawdown: number;
}): V33AgentScore {
  const t = input.trades;
  if (t.length === 0) {
    const emptyDims: V33DimensionScores = {
      pnlPercent: 50, sharpeRatio: 50, maxDrawdown: 50,
      coherence: 50, reasoningDepth: 50, sourceQuality: 50,
      logicalConsistency: 50, reasoningIntegrity: 50, reasoningTransparency: 50,
      reasoningGrounding: 50, causalReasoning: 50, epistemicHumility: 50,
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

  // Reasoning Quality (9 dims)
  const coherence = avg(t.map((x) => x.coherenceScore * 100));
  const reasoningDepth = avg(t.map((x) => x.reasoningDepthScore));
  const sourceQuality = avg(t.map((x) => x.sourceQualityScore));
  const logicalConsistency = avg(t.map((x) => x.logicalConsistencyScore));
  const integrityScores = t.map(() => INTEGRITY_SCORE_BASE + Math.random() * INTEGRITY_SCORE_VARIANCE);
  const reasoningIntegrity = avg(integrityScores);
  const reasoningTransparency = avg(t.map((x) => x.transparencyScore));
  const reasoningGrounding = avg(t.map((x) => x.groundingScore));
  const causalReasoning = avg(t.map((x) => x.causalReasoningScore));
  const epistemicHumility = avg(t.map((x) => x.epistemicHumilityScore));

  // Safety
  const hallucinationFree = avg(t.map((x) => x.hallucinationFlags.length === 0 ? 100 : Math.max(0, 100 - x.hallucinationFlags.length * (HALLUCINATION_PENALTY_PER_FLAG * 100))));
  const discipline = avg(t.map((x) => x.disciplinePassed ? DISCIPLINE_PASS_SCORE : DISCIPLINE_FAIL_SCORE));
  const riskAwareness = avg(t.map((x) => {
    const hasRiskRef = /risk|drawdown|stop.?loss|hedge|protect|caution/i.test(x.reasoning);
    return hasRiskRef ? REGIME_AWARE_SCORE : REGIME_UNAWARE_SCORE;
  }));

  // Behavioral
  const actions = t.map((x) => x.action);
  const uniqueActions = new Set(actions);
  const strategyConsistency = uniqueActions.size === 1 ? STRATEGY_PURE_SCORE : uniqueActions.size === 2 ? STRATEGY_MIXED_SCORE : STRATEGY_VARIED_SCORE;
  const confidences = t.map((x) => x.confidence);
  const confStdDev = Math.sqrt(computeVariance(confidences, true));
  const adaptability = Math.max(0, Math.min(100, ADAPTABILITY_BASELINE + confStdDev * ADAPTABILITY_CONF_SENSITIVITY));
  const confidenceCalibration = avg(confidences.map((c) => Math.max(0, 100 - Math.abs(c - CONFIDENCE_CALIBRATION_TARGET) * CONFIDENCE_CALIBRATION_SCALE)));
  const crossRoundLearning = Math.min(100, CROSS_ROUND_LEARNING_BASELINE + t.length * CROSS_ROUND_LEARNING_PER_TRADE);

  // Predictive
  const resolved = t.filter((x) => x.outcomeResolved !== "pending");
  const outcomeAccuracy = resolved.length > 0
    ? avg(resolved.map((x) => x.outcomeResolved === "correct" ? OUTCOME_CORRECT_SCORE : x.outcomeResolved === "partial" ? OUTCOME_PARTIAL_SCORE : OUTCOME_WRONG_SCORE))
    : 50;
  const marketRegimeAwareness = avg(t.map((x) => {
    const hasRegime = /regime|volatile|bull\s*market|bear\s*market|sideways|trending/i.test(x.reasoning);
    return hasRegime ? REGIME_AWARE_SCORE : REGIME_UNAWARE_SCORE;
  }));
  const edgeConsistency = t.length >= EDGE_MIN_TRADES
    ? Math.min(100, EDGE_CONSISTENCY_BASELINE + (countByCondition(t, (x: V33TradeGrade) => x.coherenceScore > EDGE_CONSISTENCY_COHERENCE_THRESHOLD) / t.length) * EDGE_CONSISTENCY_MULTIPLIER)
    : 50;

  // Governance (4 dims)
  const tradeAccountability = avg(t.map((x) => x.accountabilityScore));
  const rqi = avg([
    coherence, reasoningDepth, sourceQuality, logicalConsistency,
    reasoningTransparency, reasoningGrounding, causalReasoning, epistemicHumility,
  ]) / 100 * 100;
  const decisionAccountability = avg(t.map((x) => x.accountabilityScore));
  const consensusQuality = avg(t.map((x) => x.consensusQualityScore));

  const dimensions: V33DimensionScores = {
    pnlPercent: Math.round(pnlScore * DIMENSION_SCORE_PRECISION_MULTIPLIER) / DIMENSION_SCORE_PRECISION_DIVISOR,
    sharpeRatio: Math.round(sharpeScore * DIMENSION_SCORE_PRECISION_MULTIPLIER) / DIMENSION_SCORE_PRECISION_DIVISOR,
    maxDrawdown: Math.round(drawdownScore * DIMENSION_SCORE_PRECISION_MULTIPLIER) / DIMENSION_SCORE_PRECISION_DIVISOR,
    coherence: Math.round(coherence * DIMENSION_SCORE_PRECISION_MULTIPLIER) / DIMENSION_SCORE_PRECISION_DIVISOR,
    reasoningDepth: Math.round(reasoningDepth * DIMENSION_SCORE_PRECISION_MULTIPLIER) / DIMENSION_SCORE_PRECISION_DIVISOR,
    sourceQuality: Math.round(sourceQuality * DIMENSION_SCORE_PRECISION_MULTIPLIER) / DIMENSION_SCORE_PRECISION_DIVISOR,
    logicalConsistency: Math.round(logicalConsistency * DIMENSION_SCORE_PRECISION_MULTIPLIER) / DIMENSION_SCORE_PRECISION_DIVISOR,
    reasoningIntegrity: Math.round(reasoningIntegrity * DIMENSION_SCORE_PRECISION_MULTIPLIER) / DIMENSION_SCORE_PRECISION_DIVISOR,
    reasoningTransparency: Math.round(reasoningTransparency * DIMENSION_SCORE_PRECISION_MULTIPLIER) / DIMENSION_SCORE_PRECISION_DIVISOR,
    reasoningGrounding: Math.round(reasoningGrounding * DIMENSION_SCORE_PRECISION_MULTIPLIER) / DIMENSION_SCORE_PRECISION_DIVISOR,
    causalReasoning: Math.round(causalReasoning * DIMENSION_SCORE_PRECISION_MULTIPLIER) / DIMENSION_SCORE_PRECISION_DIVISOR,
    epistemicHumility: Math.round(epistemicHumility * DIMENSION_SCORE_PRECISION_MULTIPLIER) / DIMENSION_SCORE_PRECISION_DIVISOR,
    hallucinationRate: Math.round(hallucinationFree * DIMENSION_SCORE_PRECISION_MULTIPLIER) / DIMENSION_SCORE_PRECISION_DIVISOR,
    instructionDiscipline: Math.round(discipline * DIMENSION_SCORE_PRECISION_MULTIPLIER) / DIMENSION_SCORE_PRECISION_DIVISOR,
    riskAwareness: Math.round(riskAwareness * DIMENSION_SCORE_PRECISION_MULTIPLIER) / DIMENSION_SCORE_PRECISION_DIVISOR,
    strategyConsistency: Math.round(strategyConsistency * DIMENSION_SCORE_PRECISION_MULTIPLIER) / DIMENSION_SCORE_PRECISION_DIVISOR,
    adaptability: Math.round(adaptability * DIMENSION_SCORE_PRECISION_MULTIPLIER) / DIMENSION_SCORE_PRECISION_DIVISOR,
    confidenceCalibration: Math.round(confidenceCalibration * DIMENSION_SCORE_PRECISION_MULTIPLIER) / DIMENSION_SCORE_PRECISION_DIVISOR,
    crossRoundLearning: Math.round(crossRoundLearning * DIMENSION_SCORE_PRECISION_MULTIPLIER) / DIMENSION_SCORE_PRECISION_DIVISOR,
    outcomeAccuracy: Math.round(outcomeAccuracy * DIMENSION_SCORE_PRECISION_MULTIPLIER) / DIMENSION_SCORE_PRECISION_DIVISOR,
    marketRegimeAwareness: Math.round(marketRegimeAwareness * DIMENSION_SCORE_PRECISION_MULTIPLIER) / DIMENSION_SCORE_PRECISION_DIVISOR,
    edgeConsistency: Math.round(edgeConsistency * DIMENSION_SCORE_PRECISION_MULTIPLIER) / DIMENSION_SCORE_PRECISION_DIVISOR,
    tradeAccountability: Math.round(tradeAccountability * DIMENSION_SCORE_PRECISION_MULTIPLIER) / DIMENSION_SCORE_PRECISION_DIVISOR,
    reasoningQualityIndex: Math.round(rqi * DIMENSION_SCORE_PRECISION_MULTIPLIER) / DIMENSION_SCORE_PRECISION_DIVISOR,
    decisionAccountability: Math.round(decisionAccountability * DIMENSION_SCORE_PRECISION_MULTIPLIER) / DIMENSION_SCORE_PRECISION_DIVISOR,
    consensusQuality: Math.round(consensusQuality * DIMENSION_SCORE_PRECISION_MULTIPLIER) / DIMENSION_SCORE_PRECISION_DIVISOR,
  };

  // Weighted composite score
  let compositeScore = 0;
  for (const [dim, weight] of Object.entries(DIMENSION_WEIGHTS)) {
    compositeScore += (dimensions[dim as keyof V33DimensionScores] ?? 50) * weight;
  }
  compositeScore = Math.round(compositeScore * DIMENSION_SCORE_PRECISION_MULTIPLIER) / DIMENSION_SCORE_PRECISION_DIVISOR;

  const agentScore: V33AgentScore = {
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
  scores: V33AgentScore[],
  trades: V33TradeGrade[],
  marketRegime: string,
): V33RoundSummary {
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

  const summary: V33RoundSummary = {
    roundId,
    timestamp: new Date().toISOString(),
    agentScores: scores,
    bestTrade: sorted[0] ?? null,
    worstTrade: sorted[sorted.length - 1] ?? null,
    consensusAgreement: Math.round(consensusAgreement * DIMENSION_SCORE_PRECISION_MULTIPLIER) / DIMENSION_SCORE_PRECISION_DIVISOR,
    marketRegime,
    avgTransparency: trades.length > 0
      ? Math.round(trades.reduce((s, t) => s + t.transparencyScore, 0) / trades.length * DIMENSION_SCORE_PRECISION_MULTIPLIER) / DIMENSION_SCORE_PRECISION_DIVISOR
      : 50,
    avgAccountability: trades.length > 0
      ? Math.round(trades.reduce((s, t) => s + t.accountabilityScore, 0) / trades.length * DIMENSION_SCORE_PRECISION_MULTIPLIER) / DIMENSION_SCORE_PRECISION_DIVISOR
      : 50,
    avgGrounding: trades.length > 0
      ? Math.round(trades.reduce((s, t) => s + t.groundingScore, 0) / trades.length * DIMENSION_SCORE_PRECISION_MULTIPLIER) / DIMENSION_SCORE_PRECISION_DIVISOR
      : 50,
    avgConsensusQuality: trades.length > 0
      ? Math.round(trades.reduce((s, t) => s + t.consensusQualityScore, 0) / trades.length * DIMENSION_SCORE_PRECISION_MULTIPLIER) / DIMENSION_SCORE_PRECISION_DIVISOR
      : 50,
    avgCausalReasoning: trades.length > 0
      ? Math.round(trades.reduce((s, t) => s + t.causalReasoningScore, 0) / trades.length * DIMENSION_SCORE_PRECISION_MULTIPLIER) / DIMENSION_SCORE_PRECISION_DIVISOR
      : 50,
    avgEpistemicHumility: trades.length > 0
      ? Math.round(trades.reduce((s, t) => s + t.epistemicHumilityScore, 0) / trades.length * DIMENSION_SCORE_PRECISION_MULTIPLIER) / DIMENSION_SCORE_PRECISION_DIVISOR
      : 50,
  };

  roundSummaries.unshift(summary);
  if (roundSummaries.length > 200) roundSummaries.length = 200;

  return summary;
}

// ---------------------------------------------------------------------------
// Public Getters
// ---------------------------------------------------------------------------

export function getAgentScores(): V33AgentScore[] {
  return Array.from(agentScores.values());
}

export function getAgentScore(agentId: string): V33AgentScore | undefined {
  return agentScores.get(agentId);
}

export function getTradeGrades(limit = 50): V33TradeGrade[] {
  return tradeGrades.slice(0, limit);
}

export function getTradeGradesByAgent(agentId: string, limit = 50): V33TradeGrade[] {
  return tradeGrades.filter((g) => g.agentId === agentId).slice(0, limit);
}

export function getRoundSummaries(limit = 20): V33RoundSummary[] {
  return roundSummaries.slice(0, limit);
}

export function getDimensionWeights(): Record<string, number> {
  return { ...DIMENSION_WEIGHTS };
}

export function getDimensionCount(): number {
  return 26;
}

export function getBenchmarkVersion(): string {
  return "33.0";
}
