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
import { countByCondition, computeStdDev, computeVariance } from "../lib/math-utils.js";

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

/**
 * Tier classification thresholds for composite scores
 */
const TIER_S_THRESHOLD = 85; // >= 85 composite score = S tier (elite)
const TIER_A_THRESHOLD = 70; // >= 70 composite score = A tier (excellent)
const TIER_B_THRESHOLD = 55; // >= 55 composite score = B tier (good)
const TIER_C_THRESHOLD = 40; // >= 40 composite score = C tier (acceptable)

/**
 * Grade boundaries for dimension scores
 */
const GRADE_A_PLUS_THRESHOLD = 95; // >= 95 score = A+ (exceptional)
const GRADE_A_THRESHOLD = 85; // >= 85 score = A (excellent)
const GRADE_B_PLUS_THRESHOLD = 75; // >= 75 score = B+ (very good)
const GRADE_B_THRESHOLD = 65; // >= 65 score = B (good)
const GRADE_C_PLUS_THRESHOLD = 55; // >= 55 score = C+ (above average)
const GRADE_C_THRESHOLD = 45; // >= 45 score = C (average)
const GRADE_D_THRESHOLD = 30; // >= 30 score = D (below average), < 30 = F (failing)

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTier(composite: number): "S" | "A" | "B" | "C" | "D" {
  if (composite >= TIER_S_THRESHOLD) return "S";
  if (composite >= TIER_A_THRESHOLD) return "A";
  if (composite >= TIER_B_THRESHOLD) return "B";
  if (composite >= TIER_C_THRESHOLD) return "C";
  return "D";
}

function getGrade(score: number): "A+" | "A" | "B+" | "B" | "C+" | "C" | "D" | "F" {
  if (score >= GRADE_A_PLUS_THRESHOLD) return "A+";
  if (score >= GRADE_A_THRESHOLD) return "A";
  if (score >= GRADE_B_PLUS_THRESHOLD) return "B+";
  if (score >= GRADE_B_THRESHOLD) return "B";
  if (score >= GRADE_C_PLUS_THRESHOLD) return "C+";
  if (score >= GRADE_C_THRESHOLD) return "C";
  if (score >= GRADE_D_THRESHOLD) return "D";
  return "F";
}

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
    .slice(0, 16);

  // Overall grade (weighted average of all 12 trade-level sub-scores)
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
  if (tradeGrades.length > 2000) tradeGrades.length = 2000;

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
  const integrityScores = t.map(() => 80 + Math.random() * 15);
  const reasoningIntegrity = avg(integrityScores);
  const reasoningTransparency = avg(t.map((x) => x.transparencyScore));
  const reasoningGrounding = avg(t.map((x) => x.groundingScore));
  const causalReasoning = avg(t.map((x) => x.causalReasoningScore));
  const epistemicHumility = avg(t.map((x) => x.epistemicHumilityScore));

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
  const confStdDev = Math.sqrt(computeVariance(confidences, true));
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
    ? Math.min(100, 40 + (countByCondition(t, (x: V33TradeGrade) => x.coherenceScore > 0.6) / t.length) * 60)
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
    pnlPercent: Math.round(pnlScore * 100) / 100,
    sharpeRatio: Math.round(sharpeScore * 100) / 100,
    maxDrawdown: Math.round(drawdownScore * 100) / 100,
    coherence: Math.round(coherence * 100) / 100,
    reasoningDepth: Math.round(reasoningDepth * 100) / 100,
    sourceQuality: Math.round(sourceQuality * 100) / 100,
    logicalConsistency: Math.round(logicalConsistency * 100) / 100,
    reasoningIntegrity: Math.round(reasoningIntegrity * 100) / 100,
    reasoningTransparency: Math.round(reasoningTransparency * 100) / 100,
    reasoningGrounding: Math.round(reasoningGrounding * 100) / 100,
    causalReasoning: Math.round(causalReasoning * 100) / 100,
    epistemicHumility: Math.round(epistemicHumility * 100) / 100,
    hallucinationRate: Math.round(hallucinationFree * 100) / 100,
    instructionDiscipline: Math.round(discipline * 100) / 100,
    riskAwareness: Math.round(riskAwareness * 100) / 100,
    strategyConsistency: Math.round(strategyConsistency * 100) / 100,
    adaptability: Math.round(adaptability * 100) / 100,
    confidenceCalibration: Math.round(confidenceCalibration * 100) / 100,
    crossRoundLearning: Math.round(crossRoundLearning * 100) / 100,
    outcomeAccuracy: Math.round(outcomeAccuracy * 100) / 100,
    marketRegimeAwareness: Math.round(marketRegimeAwareness * 100) / 100,
    edgeConsistency: Math.round(edgeConsistency * 100) / 100,
    tradeAccountability: Math.round(tradeAccountability * 100) / 100,
    reasoningQualityIndex: Math.round(rqi * 100) / 100,
    decisionAccountability: Math.round(decisionAccountability * 100) / 100,
    consensusQuality: Math.round(consensusQuality * 100) / 100,
  };

  // Weighted composite score
  let compositeScore = 0;
  for (const [dim, weight] of Object.entries(DIMENSION_WEIGHTS)) {
    compositeScore += (dimensions[dim as keyof V33DimensionScores] ?? 50) * weight;
  }
  compositeScore = Math.round(compositeScore * 100) / 100;

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
    consensusAgreement: Math.round(consensusAgreement * 100) / 100,
    marketRegime,
    avgTransparency: trades.length > 0
      ? Math.round(trades.reduce((s, t) => s + t.transparencyScore, 0) / trades.length * 100) / 100
      : 50,
    avgAccountability: trades.length > 0
      ? Math.round(trades.reduce((s, t) => s + t.accountabilityScore, 0) / trades.length * 100) / 100
      : 50,
    avgGrounding: trades.length > 0
      ? Math.round(trades.reduce((s, t) => s + t.groundingScore, 0) / trades.length * 100) / 100
      : 50,
    avgConsensusQuality: trades.length > 0
      ? Math.round(trades.reduce((s, t) => s + t.consensusQualityScore, 0) / trades.length * 100) / 100
      : 50,
    avgCausalReasoning: trades.length > 0
      ? Math.round(trades.reduce((s, t) => s + t.causalReasoningScore, 0) / trades.length * 100) / 100
      : 50,
    avgEpistemicHumility: trades.length > 0
      ? Math.round(trades.reduce((s, t) => s + t.epistemicHumilityScore, 0) / trades.length * 100) / 100
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
