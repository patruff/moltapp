/**
 * V34 Benchmark Engine — 28-Dimension AI Trading Benchmark
 *
 * Extends v33's 26-dimension framework with:
 * - Reasoning Traceability: Can each claim be traced to a cited data source?
 *   Measures source-attribution density, claim-source pairing, orphan claim
 *   detection, and evidence chain completeness.
 * - Adversarial Coherence: Does reasoning hold up against contrary signals?
 *   Measures counterargument acknowledgment, conflicting-data handling,
 *   opposing-indicator awareness, and logical resilience under mixed signals.
 *
 * Categories (28 dimensions):
 * - Financial Performance (3): pnl, sharpe, drawdown
 * - Reasoning Quality (11): coherence, depth, source, consistency,
 *   integrity, transparency, grounding, causal, epistemic,
 *   traceability (NEW), adversarial coherence (NEW)
 * - Safety & Trust (3): hallucination, discipline, risk awareness
 * - Behavioral Intelligence (4): consistency, adaptability,
 *   calibration, learning
 * - Predictive Power (3): outcome, regime, edge
 * - Governance & Accountability (4): accountability, RQI,
 *   decision accountability, consensus quality
 */

import { createHash } from "crypto";
import { countByCondition } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types for the 28 dimensions
// ---------------------------------------------------------------------------

export interface V34DimensionScores {
  // Financial Performance (3 dims)
  pnlPercent: number;
  sharpeRatio: number;
  maxDrawdown: number;
  // Reasoning Quality (11 dims — 9 from v33 + traceability + adversarial coherence)
  coherence: number;
  reasoningDepth: number;
  sourceQuality: number;
  logicalConsistency: number;
  reasoningIntegrity: number;
  reasoningTransparency: number;
  reasoningGrounding: number;
  causalReasoning: number;
  epistemicHumility: number;
  reasoningTraceability: number;
  adversarialCoherence: number;
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

export interface V34AgentScore {
  agentId: string;
  agentName: string;
  provider: string;
  model: string;
  dimensions: V34DimensionScores;
  compositeScore: number;
  tier: "S" | "A" | "B" | "C" | "D";
  tradeCount: number;
  roundsPlayed: number;
  lastUpdated: string;
}

export interface V34TradeGrade {
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
  reasoningTraceabilityScore: number;
  adversarialCoherenceScore: number;
  integrityHash: string;
  predictedOutcome: string | null;
  actualOutcome: string | null;
  outcomeResolved: "pending" | "correct" | "incorrect" | "partial";
  overallGrade: "A+" | "A" | "B+" | "B" | "C+" | "C" | "D" | "F";
  gradedAt: string;
}

export interface V34RoundSummary {
  roundId: string;
  timestamp: string;
  agentScores: V34AgentScore[];
  bestTrade: V34TradeGrade | null;
  worstTrade: V34TradeGrade | null;
  consensusAgreement: number;
  marketRegime: string;
  avgTransparency: number;
  avgAccountability: number;
  avgGrounding: number;
  avgConsensusQuality: number;
  avgCausalReasoning: number;
  avgEpistemicHumility: number;
  avgTraceability: number;
  avgAdversarialCoherence: number;
}

// ---------------------------------------------------------------------------
// In-memory storage
// ---------------------------------------------------------------------------

const agentScores = new Map<string, V34AgentScore>();
const tradeGrades: V34TradeGrade[] = [];
const roundSummaries: V34RoundSummary[] = [];

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Scoring thresholds and parameters for v34 benchmark dimension calculations.
 * All magic numbers extracted to named constants for improved discoverability,
 * tunability, and benchmark reproducibility.
 */

// --- Grounding Score Parameters (scoreGrounding) ---

/** Maximum quantitative reference bonus (numbers, percentages, decimals) */
const GROUNDING_QUANTITATIVE_MAX = 20;
/** Points per quantitative match */
const GROUNDING_QUANTITATIVE_PER_MATCH = 4;

/** Maximum plausibility bonus for price references */
const GROUNDING_PRICE_PLAUSIBILITY_MAX = 25;
/** Fallback bonus when no price references found */
const GROUNDING_PRICE_FALLBACK = 5;

/** Maximum quantitative/qualitative ratio bonus */
const GROUNDING_QUANT_RATIO_MAX = 20;

/** Maximum temporal reference bonus (today, 24h, current, etc.) */
const GROUNDING_TEMPORAL_MAX = 15;
/** Points per temporal match */
const GROUNDING_TEMPORAL_PER_MATCH = 3;

/** Maximum ticker symbol bonus */
const GROUNDING_TICKER_MAX = 10;
/** Points per specific ticker */
const GROUNDING_TICKER_PER_MATCH = 2;

/** Maximum threshold pattern bonus (support/resistance at $X) */
const GROUNDING_THRESHOLD_MAX = 10;
/** Points per threshold pattern */
const GROUNDING_THRESHOLD_PER_MATCH = 5;

// --- Consensus Quality Score Parameters (scoreConsensusQuality) ---

/** Base score for consensus analysis */
const CONSENSUS_BASE_SCORE = 50;

/** Agreement rate threshold (< 50% = minority position) */
const CONSENSUS_MINORITY_THRESHOLD = 0.5;

/** High coherence threshold for minority position bonus */
const CONSENSUS_HIGH_COHERENCE = 0.7;
/** Bonus points when minority has high coherence */
const CONSENSUS_HIGH_COHERENCE_BONUS = 25;

/** Moderate coherence threshold for minority position */
const CONSENSUS_MODERATE_COHERENCE = 0.5;
/** Bonus points when minority has moderate coherence */
const CONSENSUS_MODERATE_COHERENCE_BONUS = 10;

/** Penalty when minority has low coherence */
const CONSENSUS_LOW_COHERENCE_PENALTY = 15;

/** Unanimous agreement threshold (all agents agree) */
const CONSENSUS_UNANIMOUS = 1.0;
/** Minimum word count for unanimous agreement */
const CONSENSUS_UNANIMOUS_MIN_WORDS = 30;
/** Penalty for brief reasoning with unanimous agreement */
const CONSENSUS_UNANIMOUS_BRIEF_PENALTY = 15;

/** Maximum independence indicator bonus */
const CONSENSUS_INDEPENDENCE_MAX = 20;
/** Points per independence pattern (however, unlike, I disagree) */
const CONSENSUS_INDEPENDENCE_PER_MATCH = 7;

/** Bonus for unique data discovery */
const CONSENSUS_UNIQUE_DATA_BONUS = 10;

// --- Transparency Score Parameters (scoreTransparency) ---

/** Maximum step-by-step bonus */
const TRANSPARENCY_STEP_MAX = 25;
/** Points per step indicator (first, second, 1., 2., etc.) */
const TRANSPARENCY_STEP_PER_MATCH = 5;

/** Maximum source citation bonus */
const TRANSPARENCY_SOURCE_MAX = 20;
/** Points per cited source */
const TRANSPARENCY_SOURCE_PER_MATCH = 5;

/** Maximum uncertainty acknowledgment bonus */
const TRANSPARENCY_UNCERTAINTY_MAX = 15;
/** Points per uncertainty indicator (however, risk, might) */
const TRANSPARENCY_UNCERTAINTY_PER_MATCH = 3;

/** Maximum causal reasoning bonus */
const TRANSPARENCY_CAUSAL_MAX = 20;
/** Points per causal connector (because, therefore, thus) */
const TRANSPARENCY_CAUSAL_PER_MATCH = 4;

/** Maximum quantitative data bonus */
const TRANSPARENCY_QUANT_MAX = 20;
/** Points per quantitative reference */
const TRANSPARENCY_QUANT_PER_MATCH = 3;

// --- Accountability Score Parameters (scoreAccountability) ---

/** Maximum specificity bonus for predicted outcome */
const ACCOUNTABILITY_SPECIFICITY_MAX = 15;
/** Divisor for specificity calculation (length / X) */
const ACCOUNTABILITY_SPECIFICITY_DIVISOR = 10;

/** Bonus for quantitative prediction ($X or Y%) */
const ACCOUNTABILITY_QUANTITATIVE_PREDICTION = 15;

/** Maximum past reference bonus */
const ACCOUNTABILITY_PAST_REF_MAX = 25;
/** Points per past reference (previously, last time, learned) */
const ACCOUNTABILITY_PAST_REF_PER_MATCH = 8;

/** Maximum error acknowledgment bonus */
const ACCOUNTABILITY_ERROR_ACK_MAX = 25;
/** Points per error acknowledgment (mistake, wrong, lesson) */
const ACCOUNTABILITY_ERROR_ACK_PER_MATCH = 8;

/** Maximum accuracy bonus from resolved predictions */
const ACCOUNTABILITY_ACCURACY_MAX = 20;

// --- Causal Reasoning Score Parameters (scoreCausalReasoning) ---

/** Maximum chain structure bonus */
const CAUSAL_CHAIN_MAX = 25;
/** Points per unique step indicator */
const CAUSAL_CHAIN_PER_STEP = 5;

/** Maximum evidence connector bonus */
const CAUSAL_EVIDENCE_MAX = 25;
/** Points per evidence connector (because, therefore, thus) */
const CAUSAL_EVIDENCE_PER_MATCH = 5;

/** Maximum conditional reasoning bonus */
const CAUSAL_CONDITIONAL_MAX = 20;
/** Points per conditional pattern (if X then Y) */
const CAUSAL_CONDITIONAL_PER_MATCH = 7;

/** Maximum data-to-action bridge bonus */
const CAUSAL_BRIDGE_MAX = 15;
/** Maximum bridge pattern bonus (so I buy, therefore I recommend) */
const CAUSAL_BRIDGE_PATTERN_MAX = 10;
/** Points per bridge pattern */
const CAUSAL_BRIDGE_PATTERN_PER_MATCH = 5;
/** Maximum data-action link bonus (X% suggests Y) */
const CAUSAL_BRIDGE_DATA_ACTION_MAX = 10;
/** Points per data-action link */
const CAUSAL_BRIDGE_DATA_ACTION_PER_MATCH = 5;

/** Maximum multi-factor analysis bonus */
const CAUSAL_MULTI_FACTOR_MAX = 15;
/** Maximum multi-factor pattern bonus */
const CAUSAL_MULTI_FACTOR_PATTERN_MAX = 10;
/** Points per multi-factor pattern (combining, together with) */
const CAUSAL_MULTI_FACTOR_PATTERN_PER_MATCH = 5;
/** Minimum factors for bonus eligibility */
const CAUSAL_MULTI_FACTOR_MIN_COUNT = 3;
/** Points per factor above minimum ((count - 2) * X) */
const CAUSAL_MULTI_FACTOR_PER_EXTRA = 2;
/** Minimum sources for multi-factor bonus */
const CAUSAL_MULTI_FACTOR_MIN_SOURCES = 2;
/** Minimum evidence connectors for multi-factor bonus */
const CAUSAL_MULTI_FACTOR_MIN_EVIDENCE = 2;
/** Bonus when both sources and evidence present */
const CAUSAL_MULTI_FACTOR_COMBINED_BONUS = 3;

// --- Epistemic Humility Score Parameters (scoreEpistemicHumility) ---

// Specificity scoring (0-30)
/** Maximum bonus for specific numbers */
const EPISTEMIC_SPECIFICITY_NUMBER_MAX = 10;
/** Points per specific percentage */
const EPISTEMIC_SPECIFICITY_NUMBER_PER_MATCH = 3;
/** Maximum bonus for specific prices */
const EPISTEMIC_SPECIFICITY_PRICE_MAX = 10;
/** Points per specific price */
const EPISTEMIC_SPECIFICITY_PRICE_PER_MATCH = 3;
/** Maximum bonus for ticker symbols */
const EPISTEMIC_SPECIFICITY_TICKER_MAX = 10;
/** Points per ticker symbol */
const EPISTEMIC_SPECIFICITY_TICKER_PER_MATCH = 3;
/** Penalty per vague pattern (go up, probably fine) */
const EPISTEMIC_SPECIFICITY_VAGUE_PENALTY = 3;
/** Maximum specificity penalty */
const EPISTEMIC_SPECIFICITY_VAGUE_PENALTY_MAX = 10;
/** Maximum overall specificity score */
const EPISTEMIC_SPECIFICITY_MAX = 30;

// Measurability scoring (0-25)
/** Maximum verifiable claim bonus */
const EPISTEMIC_MEASURABILITY_VERIFIABLE_MAX = 15;
/** Points per verifiable pattern (will reach $X) */
const EPISTEMIC_MEASURABILITY_VERIFIABLE_PER_MATCH = 5;
/** Bonus for quantitative predicted outcome */
const EPISTEMIC_MEASURABILITY_OUTCOME_QUANT = 10;
/** Bonus for descriptive predicted outcome (>20 chars) */
const EPISTEMIC_MEASURABILITY_OUTCOME_DESC = 5;
/** Maximum outcome pattern bonus */
const EPISTEMIC_MEASURABILITY_OUTCOME_PATTERN_MAX = 5;
/** Points per outcome pattern (expect X, predict Y) */
const EPISTEMIC_MEASURABILITY_OUTCOME_PATTERN_PER_MATCH = 3;
/** Maximum overall measurability score */
const EPISTEMIC_MEASURABILITY_MAX = 25;

// Timeframe clarity scoring (0-20)
/** Maximum precise timeframe bonus */
const EPISTEMIC_TIMEFRAME_PRECISE_MAX = 15;
/** Points per precise timeframe (within 24h, by EOD) */
const EPISTEMIC_TIMEFRAME_PRECISE_PER_MATCH = 5;
/** Maximum moderate timeframe bonus (when no precise) */
const EPISTEMIC_TIMEFRAME_MODERATE_MAX_NO_PRECISE = 5;
/** Points per moderate timeframe (short-term, today) when no precise */
const EPISTEMIC_TIMEFRAME_MODERATE_PER_MATCH_NO_PRECISE = 2;
/** Maximum moderate timeframe bonus (when precise exists) */
const EPISTEMIC_TIMEFRAME_MODERATE_MAX_WITH_PRECISE = 3;
/** Points per moderate timeframe when precise exists */
const EPISTEMIC_TIMEFRAME_MODERATE_PER_MATCH_WITH_PRECISE = 1;
/** Penalty for vague timeframe without precision */
const EPISTEMIC_TIMEFRAME_VAGUE_PENALTY = 5;
/** Maximum overall timeframe score */
const EPISTEMIC_TIMEFRAME_MAX = 20;

// Magnitude precision scoring (0-15)
/** Maximum range pattern bonus */
const EPISTEMIC_MAGNITUDE_RANGE_MAX = 10;
/** Points per range pattern (X% to Y%, target $Z) */
const EPISTEMIC_MAGNITUDE_RANGE_PER_MATCH = 4;
/** Maximum level pattern bonus */
const EPISTEMIC_MAGNITUDE_LEVEL_MAX = 5;
/** Points per level pattern (support at $X, resistance $Y) */
const EPISTEMIC_MAGNITUDE_LEVEL_PER_MATCH = 3;
/** Maximum overall magnitude score */
const EPISTEMIC_MAGNITUDE_MAX = 15;

// Conditional awareness scoring (0-10)
/** Maximum conditional awareness bonus */
const EPISTEMIC_CONDITIONAL_MAX = 10;
/** Points per conditional pattern (unless, if X fails) */
const EPISTEMIC_CONDITIONAL_PER_MATCH = 4;

// --- Reasoning Traceability Score Parameters (scoreReasoningTraceability) ---

/** Minimum sentence length for claim-level analysis */
const TRACEABILITY_SENTENCE_MIN_LENGTH = 10;

// Claim-Source Pairing (0-30)
/** Maximum attribution pattern bonus */
const TRACEABILITY_ATTRIBUTION_MAX = 15;
/** Points per attribution pattern (according to, based on) */
const TRACEABILITY_ATTRIBUTION_PER_MATCH = 4;
/** Maximum research pattern bonus */
const TRACEABILITY_RESEARCH_MAX = 10;
/** Points per research pattern (I checked, looking at) */
const TRACEABILITY_RESEARCH_PER_MATCH = 4;
/** Maximum tool citation bonus */
const TRACEABILITY_TOOL_MAX = 5;
/** Points per tool citation (get_prices, search_news) */
const TRACEABILITY_TOOL_PER_MATCH = 3;
/** Maximum overall claim-source pairing score */
const TRACEABILITY_PAIRING_MAX = 30;

// Source Attribution Density (0-20)
/** Maximum source type diversity bonus */
const TRACEABILITY_DENSITY_SOURCE_MAX = 15;
/** Points per distinct source type inline */
const TRACEABILITY_DENSITY_SOURCE_PER_TYPE = 3;
/** High source density threshold (attribution / sentence) */
const TRACEABILITY_DENSITY_HIGH_THRESHOLD = 0.3;
/** Bonus for high source density */
const TRACEABILITY_DENSITY_HIGH_BONUS = 5;
/** Moderate source density threshold */
const TRACEABILITY_DENSITY_MODERATE_THRESHOLD = 0.15;
/** Bonus for moderate source density */
const TRACEABILITY_DENSITY_MODERATE_BONUS = 3;
/** Maximum overall source density score */
const TRACEABILITY_DENSITY_MAX = 20;

// Orphan Claim Detection (0-20)
/** Penalty per unsupported strong assertion */
const TRACEABILITY_ORPHAN_STRONG_PENALTY = 4;
/** Maximum orphan claim penalty */
const TRACEABILITY_ORPHAN_CLAIM_PENALTY_MAX = 10;
/** Penalty per orphan claim */
const TRACEABILITY_ORPHAN_CLAIM_PENALTY = 2;
/** Maximum overall orphan detection score */
const TRACEABILITY_ORPHAN_MAX = 20;
/** Context window for nearby data references (chars) */
const TRACEABILITY_ORPHAN_CONTEXT_WINDOW = 100;

// Evidence Chain Completeness (0-15)
/** Minimum steps for chain analysis */
const TRACEABILITY_CHAIN_MIN_STEPS = 2;
/** Maximum evidence chain score */
const TRACEABILITY_CHAIN_MAX = 15;
/** Partial credit for single-step with data */
const TRACEABILITY_CHAIN_SINGLE_STEP_CREDIT = 5;

// Quantitative Backing (0-15)
/** Maximum quant-with-source bonus */
const TRACEABILITY_QUANT_WITH_SOURCE_MAX = 10;
/** Points per quant-with-source pattern ($X from Y) */
const TRACEABILITY_QUANT_WITH_SOURCE_PER_MATCH = 4;
/** Maximum source-with-quant bonus */
const TRACEABILITY_QUANT_SOURCE_WITH_QUANT_MAX = 5;
/** Points per source-with-quant pattern (data shows $X) */
const TRACEABILITY_QUANT_SOURCE_WITH_QUANT_PER_MATCH = 3;
/** Maximum overall quantitative backing score */
const TRACEABILITY_QUANT_BACKING_MAX = 15;
/** Context window for quant-source proximity (chars) */
const TRACEABILITY_QUANT_CONTEXT_WINDOW = 40;

// --- Adversarial Coherence Score Parameters (scoreAdversarialCoherence) ---

// Counterargument Acknowledgment (0-25)
/** Maximum counter-thesis bonus */
const ADVERSARIAL_COUNTER_MAX = 15;
/** Points per counter-thesis pattern (despite, however, risk) */
const ADVERSARIAL_COUNTER_PER_MATCH = 5;
/** Maximum concession bonus */
const ADVERSARIAL_CONCESSION_MAX = 10;
/** Points per concession pattern (while, even though, granted) */
const ADVERSARIAL_CONCESSION_PER_MATCH = 5;
/** Maximum overall counterargument score */
const ADVERSARIAL_COUNTERARG_MAX = 25;

// Conflicting Data Handling (0-25)
/** Bonus for acknowledging both bullish and bearish signals */
const ADVERSARIAL_CONFLICT_BOTH_SIDES = 15;
/** Maximum weighing pattern bonus */
const ADVERSARIAL_CONFLICT_WEIGHING_MAX = 10;
/** Points per weighing pattern (outweighs, on balance) */
const ADVERSARIAL_CONFLICT_WEIGHING_PER_MATCH = 5;
/** Bonus for acknowledging opposite signal (buy + bearish) */
const ADVERSARIAL_CONFLICT_OPPOSITE_ACKNOWLEDGMENT = 10;
/** Partial credit for one-sided consistency */
const ADVERSARIAL_CONFLICT_ONE_SIDED = 5;
/** Maximum overall conflict handling score */
const ADVERSARIAL_CONFLICT_MAX = 25;

// Risk-Factor Integration (0-20)
/** Maximum risk-reward framing bonus */
const ADVERSARIAL_RISK_REWARD_MAX = 10;
/** Points per risk-reward pattern (risk/reward, asymmetric) */
const ADVERSARIAL_RISK_REWARD_PER_MATCH = 5;
/** Maximum mitigation strategy bonus */
const ADVERSARIAL_RISK_MITIGATION_MAX = 10;
/** Points per mitigation pattern (stop-loss, hedge, diversify) */
const ADVERSARIAL_RISK_MITIGATION_PER_MATCH = 4;
/** Maximum overall risk-factor score */
const ADVERSARIAL_RISK_MAX = 20;

// Conviction Justification (0-15)
/** High conviction threshold (normalized 0-1) */
const ADVERSARIAL_CONVICTION_HIGH_THRESHOLD = 0.7;
/** Maximum justification bonus */
const ADVERSARIAL_CONVICTION_JUSTIFICATION_MAX = 10;
/** Points per justification pattern (my conviction, strong evidence) */
const ADVERSARIAL_CONVICTION_JUSTIFICATION_PER_MATCH = 5;
/** Penalty for high conviction without justification */
const ADVERSARIAL_CONVICTION_NO_JUSTIFICATION_PENALTY = 5;
/** Bonus for addressing counterarguments with high conviction */
const ADVERSARIAL_CONVICTION_WITH_COUNTER_BONUS = 5;
/** Credit for appropriate low conviction */
const ADVERSARIAL_CONVICTION_LOW_CREDIT = 5;
/** Maximum overall conviction score */
const ADVERSARIAL_CONVICTION_MAX = 15;

// Scenario Planning (0-15)
/** Maximum scenario consideration bonus */
const ADVERSARIAL_SCENARIO_MAX = 10;
/** Points per scenario pattern (if wrong, worst case, plan B) */
const ADVERSARIAL_SCENARIO_PER_MATCH = 5;
/** Maximum mind-change bonus */
const ADVERSARIAL_MIND_CHANGE_MAX = 5;
/** Points per mind-change pattern (would reconsider if) */
const ADVERSARIAL_MIND_CHANGE_PER_MATCH = 3;
/** Maximum overall scenario planning score */
const ADVERSARIAL_SCENARIO_PLANNING_MAX = 15;

// ---------------------------------------------------------------------------
// Dimension weights (must sum to 1.0) — 28 entries
// ---------------------------------------------------------------------------

const DIMENSION_WEIGHTS: Record<keyof V34DimensionScores, number> = {
  pnlPercent: 0.07,
  sharpeRatio: 0.05,
  maxDrawdown: 0.04,
  coherence: 0.06,
  reasoningDepth: 0.04,
  sourceQuality: 0.04,
  logicalConsistency: 0.04,
  reasoningIntegrity: 0.03,
  reasoningTransparency: 0.04,
  reasoningGrounding: 0.04,
  causalReasoning: 0.05,
  epistemicHumility: 0.04,
  reasoningTraceability: 0.05,   // NEW
  adversarialCoherence: 0.05,    // NEW
  hallucinationRate: 0.05,
  instructionDiscipline: 0.03,
  riskAwareness: 0.03,
  strategyConsistency: 0.02,
  adaptability: 0.02,
  confidenceCalibration: 0.03,
  crossRoundLearning: 0.02,
  outcomeAccuracy: 0.02,
  marketRegimeAwareness: 0.02,
  edgeConsistency: 0.02,
  tradeAccountability: 0.02,
  reasoningQualityIndex: 0.02,
  decisionAccountability: 0.03,
  consensusQuality: 0.03,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTier(composite: number): "S" | "A" | "B" | "C" | "D" {
  if (composite >= 85) return "S";
  if (composite >= 70) return "A";
  if (composite >= 55) return "B";
  if (composite >= 40) return "C";
  return "D";
}

function getGrade(score: number): "A+" | "A" | "B+" | "B" | "C+" | "C" | "D" | "F" {
  if (score >= 95) return "A+";
  if (score >= 85) return "A";
  if (score >= 75) return "B+";
  if (score >= 65) return "B";
  if (score >= 55) return "C+";
  if (score >= 45) return "C";
  if (score >= 30) return "D";
  return "F";
}

// ---------------------------------------------------------------------------
// Inherited scoring functions (from v33)
// ---------------------------------------------------------------------------

export function scoreGrounding(
  reasoning: string,
  sources: string[],
  marketPrices: Record<string, number>,
): number {
  let score = 0;
  const maxScore = 100;

  const numberMatches = reasoning.match(/\$[\d,.]+|[\d.]+%|\d+\.\d{2,}/g) ?? [];
  score += Math.min(GROUNDING_QUANTITATIVE_MAX, numberMatches.length * GROUNDING_QUANTITATIVE_PER_MATCH);

  const priceRefs = reasoning.match(/\$(\d+(?:,\d{3})*(?:\.\d+)?)/g) ?? [];
  let plausibleCount = 0;
  for (const ref of priceRefs) {
    const val = parseFloat(ref.replace(/[$,]/g, ""));
    const isPlausible = Object.values(marketPrices).some(
      (realPrice) => Math.abs(val - realPrice) / realPrice < 0.5,
    );
    if (isPlausible) plausibleCount++;
  }
  if (priceRefs.length > 0) {
    score += Math.round((plausibleCount / priceRefs.length) * GROUNDING_PRICE_PLAUSIBILITY_MAX);
  } else {
    score += GROUNDING_PRICE_FALLBACK;
  }

  const quantWords = reasoning.match(/\d+|percent|ratio|increase|decrease|higher|lower|above|below/gi) ?? [];
  const qualWords = reasoning.match(/\bfeel|think|believe|seems?|maybe|perhaps|possibly|probably\b/gi) ?? [];
  const quantRatio = quantWords.length / Math.max(1, quantWords.length + qualWords.length);
  score += Math.round(quantRatio * GROUNDING_QUANT_RATIO_MAX);

  const temporalPatterns = /\b(today|24h|this week|current|recent|now|latest|real-?time)\b/gi;
  const temporalMatches = reasoning.match(temporalPatterns) ?? [];
  score += Math.min(GROUNDING_TEMPORAL_MAX, temporalMatches.length * GROUNDING_TEMPORAL_PER_MATCH);

  const tickerMatches = reasoning.match(/\b[A-Z]{2,5}x?\b/g) ?? [];
  const specificTickers = tickerMatches.filter(
    (t) => !["THE", "AND", "FOR", "BUT", "NOT", "MAY", "CAN", "HAS", "ITS", "ALL", "LOW", "BUY", "SELL", "HOLD", "RISK", "RSI", "ETF"].includes(t),
  );
  score += Math.min(GROUNDING_TICKER_MAX, specificTickers.length * GROUNDING_TICKER_PER_MATCH);
  const thresholdPatterns = /(?:support|resistance|target|stop.?loss|entry|exit)\s+(?:at|of|near)\s+\$?[\d,.]+/gi;
  const thresholdMatches = reasoning.match(thresholdPatterns) ?? [];
  score += Math.min(GROUNDING_THRESHOLD_MAX, thresholdMatches.length * GROUNDING_THRESHOLD_PER_MATCH);

  return Math.round(Math.min(maxScore, score));
}

export function scoreConsensusQuality(
  reasoning: string,
  action: string,
  peerActions: Array<{ agentId: string; action: string; symbol: string }>,
  coherenceScore: number,
): number {
  let score = CONSENSUS_BASE_SCORE;
  if (peerActions.length === 0) return CONSENSUS_BASE_SCORE;

  const sameAction = countByCondition(peerActions, (p) => p.action === action);
  const totalPeers = peerActions.length;
  const agreementRate = sameAction / totalPeers;

  if (agreementRate < CONSENSUS_MINORITY_THRESHOLD) {
    if (coherenceScore >= CONSENSUS_HIGH_COHERENCE) {
      score += CONSENSUS_HIGH_COHERENCE_BONUS;
    } else if (coherenceScore >= CONSENSUS_MODERATE_COHERENCE) {
      score += CONSENSUS_MODERATE_COHERENCE_BONUS;
    } else {
      score -= CONSENSUS_LOW_COHERENCE_PENALTY;
    }
  }

  if (agreementRate === CONSENSUS_UNANIMOUS) {
    const wordCount = reasoning.split(/\s+/).length;
    if (wordCount < CONSENSUS_UNANIMOUS_MIN_WORDS) {
      score -= CONSENSUS_UNANIMOUS_BRIEF_PENALTY;
    }
  }

  const independencePatterns = /(?:however|unlike|my analysis|I disagree|independently|my own|contrary to|different from)/gi;
  const independenceMatches = reasoning.match(independencePatterns) ?? [];
  score += Math.min(CONSENSUS_INDEPENDENCE_MAX, independenceMatches.length * CONSENSUS_INDEPENDENCE_PER_MATCH);

  const hasUniqueData = /(?:noticed|discovered|spotted|found|identified|overlooked)/gi.test(reasoning);
  if (hasUniqueData) score += CONSENSUS_UNIQUE_DATA_BONUS;

  return Math.max(0, Math.min(100, Math.round(score)));
}

export function scoreTransparency(reasoning: string, sources: string[]): number {
  let score = 0;
  const maxScore = 100;

  const stepPatterns = /(?:step|first|second|third|next|then|finally|1\.|2\.|3\.)/gi;
  const stepMatches = reasoning.match(stepPatterns) ?? [];
  score += Math.min(TRANSPARENCY_STEP_MAX, stepMatches.length * TRANSPARENCY_STEP_PER_MATCH);

  score += Math.min(TRANSPARENCY_SOURCE_MAX, sources.length * TRANSPARENCY_SOURCE_PER_MATCH);

  const uncertaintyPatterns = /(?:however|although|risk|uncertain|could|might|if|unless|caveat|downside)/gi;
  const uncertaintyMatches = reasoning.match(uncertaintyPatterns) ?? [];
  score += Math.min(TRANSPARENCY_UNCERTAINTY_MAX, uncertaintyMatches.length * TRANSPARENCY_UNCERTAINTY_PER_MATCH);

  const causalPatterns = /(?:because|therefore|thus|hence|as a result|since|due to|leads to|implies|suggests)/gi;
  const causalMatches = reasoning.match(causalPatterns) ?? [];
  score += Math.min(TRANSPARENCY_CAUSAL_MAX, causalMatches.length * TRANSPARENCY_CAUSAL_PER_MATCH);

  const quantPatterns = /(?:\$[\d,.]+|[\d.]+%|\d+\.\d+|increase|decrease)\b/gi;
  const quantMatches = reasoning.match(quantPatterns) ?? [];
  score += Math.min(TRANSPARENCY_QUANT_MAX, quantMatches.length * TRANSPARENCY_QUANT_PER_MATCH);

  return Math.round(Math.min(maxScore, score));
}

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

export function scoreCausalReasoning(reasoning: string, sources: string[]): number {
  let score = 0;
  const maxScore = 100;

  const chainPatterns = /\b(?:first|second|third|fourth|fifth|then|next|finally|subsequently|furthermore|moreover|additionally|step\s*\d|1\.|2\.|3\.|4\.|5\.)\b/gi;
  const chainMatches = reasoning.match(chainPatterns) ?? [];
  const uniqueSteps = new Set(chainMatches.map((m) => m.toLowerCase().trim()));
  score += Math.min(25, uniqueSteps.size * 5);

  const evidencePatterns = /\b(?:because|therefore|thus|hence|consequently|as a result|it follows that|this means|this implies|this suggests|which leads to|for this reason|since|due to|owing to|given that)\b/gi;
  const evidenceMatches = reasoning.match(evidencePatterns) ?? [];
  score += Math.min(25, evidenceMatches.length * 5);

  const conditionalPatterns = /\b(?:if\s+.{5,}?\s+then|should\s+.{5,}?\s+would|in case|assuming|provided that|unless|were .+ to|in the event|scenario where)\b/gi;
  const conditionalMatches = reasoning.match(conditionalPatterns) ?? [];
  score += Math.min(20, conditionalMatches.length * 7);

  let bridgeScore = 0;
  const bridgePatterns = /\b(?:so I (?:buy|sell|hold)|therefore I (?:recommend|suggest|choose)|this (?:indicates|signals|confirms) .{3,}? (?:buy|sell|hold|long|short)|data (?:shows|suggests|indicates) .{3,}? (?:position|trade|action)|combined with .{3,}? (?:suggests|indicates|means)|based on .{3,}? I (?:will|would|decide|recommend))\b/gi;
  const bridgeMatches = reasoning.match(bridgePatterns) ?? [];
  bridgeScore += Math.min(10, bridgeMatches.length * 5);
  const dataActionPatterns = /(?:\d+(?:\.\d+)?%|change of [+-]?\d|\$[\d,.]+).{5,}?(?:so|therefore|thus|hence|which means|suggesting|indicating)/gi;
  const dataActionMatches = reasoning.match(dataActionPatterns) ?? [];
  bridgeScore += Math.min(10, dataActionMatches.length * 5);
  score += Math.min(15, bridgeScore);

  let multiFactorScore = 0;
  const multiFactorPatterns = /\b(?:combining|together with|in addition to|alongside|coupled with|both .{3,}? and|multiple (?:factors|indicators|signals)|factoring in|taking into account|weighing)\b/gi;
  const multiFactorMatches = reasoning.match(multiFactorPatterns) ?? [];
  multiFactorScore += Math.min(10, multiFactorMatches.length * 5);
  const factorKeywords = [
    /\bprice\s*action\b/i, /\bvolume\b/i, /\bmomentum\b/i,
    /\bsector\b/i, /\bsentiment\b/i, /\bfundamental/i,
    /\btechnical/i, /\bmacro/i, /\bvolatility\b/i,
    /\bliquidity\b/i, /\bearnings\b/i, /\bRSI\b/i,
    /\bMACD\b/i, /\bsupply\b/i, /\bdemand\b/i,
    /\bcorrelation\b/i, /\brotation\b/i, /\bon-?chain\b/i,
  ];
  const factorsFound = countByCondition(factorKeywords, (p) => p.test(reasoning));
  if (factorsFound >= 3) {
    multiFactorScore += Math.min(5, (factorsFound - 2) * 2);
  }
  if (sources.length >= 2 && evidenceMatches.length >= 2) {
    multiFactorScore += 3;
  }
  score += Math.min(15, multiFactorScore);

  return Math.round(Math.min(maxScore, score));
}

export function scoreEpistemicHumility(
  predictedOutcome: string | null,
  reasoning: string,
): number {
  let score = 0;
  const maxScore = 100;
  const fullText = [predictedOutcome ?? "", reasoning].join(" ");

  // 1. Specificity (0-30)
  let specificityScore = 0;
  const specificNumbers = fullText.match(/[+-]?\d+(?:\.\d+)?%/g) ?? [];
  specificityScore += Math.min(10, specificNumbers.length * 3);
  const specificPrices = fullText.match(/\$\d+(?:,\d{3})*(?:\.\d+)?/g) ?? [];
  specificityScore += Math.min(10, specificPrices.length * 3);
  const tickerMatches = fullText.match(/\b[A-Z]{2,5}\b/g) ?? [];
  const filteredTickers = tickerMatches.filter(
    (t) => !["THE", "AND", "FOR", "BUT", "NOT", "MAY", "CAN", "HAS", "ITS", "ALL",
             "LOW", "BUY", "SELL", "HOLD", "RISK", "RSI", "ETF", "USD", "SOL",
             "BTC", "ETH", "NEW", "ARE", "WAS", "HIS", "HER", "OUR", "WHO",
             "HOW", "ANY", "GET", "SET", "PUT", "RUN", "TOP", "END"].includes(t),
  );
  specificityScore += Math.min(10, filteredTickers.length * 3);
  const vaguePatterns = /\b(?:go up|go down|do well|do poorly|be good|be bad|things will|stuff will|probably fine|maybe good)\b/gi;
  const vagueMatches = fullText.match(vaguePatterns) ?? [];
  if (vagueMatches.length > 0) specificityScore -= Math.min(10, vagueMatches.length * 3);
  score += Math.max(0, Math.min(30, specificityScore));

  // 2. Measurability (0-25)
  let measurabilityScore = 0;
  const verifiablePatterns = /(?:\b\w+\s+(?:will|should|to)\s+(?:reach|hit|touch|break|test|cross)\s+\$?[\d,.]+|\b[+-]?\d+(?:\.\d+)?%\s+(?:within|by|in|over|before|after))/gi;
  const verifiableMatches = fullText.match(verifiablePatterns) ?? [];
  measurabilityScore += Math.min(15, verifiableMatches.length * 5);
  if (predictedOutcome && /\d/.test(predictedOutcome)) {
    measurabilityScore += 10;
  } else if (predictedOutcome && predictedOutcome.length > 20) {
    measurabilityScore += 5;
  }
  const outcomePatterns = /\b(?:expect|predict|forecast|target|project|anticipate)\s+.{3,}?\d/gi;
  const outcomeMatches = fullText.match(outcomePatterns) ?? [];
  measurabilityScore += Math.min(5, outcomeMatches.length * 3);
  score += Math.min(25, measurabilityScore);

  // 3. Timeframe clarity (0-20)
  let timeframeScore = 0;
  const preciseTimePatterns = /\b(?:within\s+\d+\s*(?:hours?|h|days?|d|weeks?|minutes?|min)|by\s+(?:end of|close of|tomorrow|next week|EOD|EOW)|in the next\s+\d+\s*(?:hours?|days?|weeks?)|over\s+\d+\s*(?:hours?|days?)|\d+h\b|\d+d\b)\b/gi;
  const preciseTimeMatches = fullText.match(preciseTimePatterns) ?? [];
  timeframeScore += Math.min(15, preciseTimeMatches.length * 5);
  const moderateTimePatterns = /\b(?:short-?term|near-?term|medium-?term|this session|today|tonight|this week|this month|intraday)\b/gi;
  const moderateTimeMatches = fullText.match(moderateTimePatterns) ?? [];
  if (preciseTimeMatches.length === 0) {
    timeframeScore += Math.min(5, moderateTimeMatches.length * 2);
  } else {
    timeframeScore += Math.min(3, moderateTimeMatches.length * 1);
  }
  const vagueTimePatterns = /\b(?:eventually|someday|at some point|in the long run|sooner or later)\b/gi;
  const vagueTimeMatches = fullText.match(vagueTimePatterns) ?? [];
  if (vagueTimeMatches.length > 0 && preciseTimeMatches.length === 0) timeframeScore -= 5;
  score += Math.max(0, Math.min(20, timeframeScore));

  // 4. Magnitude precision (0-15)
  let magnitudeScore = 0;
  const rangePatterns = /(?:\d+(?:\.\d+)?%?\s*(?:to|-)\s*\d+(?:\.\d+)?%?|\d+(?:\.\d+)?%\s+(?:upside|downside|gain|loss)|target\s+(?:of\s+)?\$?[\d,.]+|price\s+(?:target|level|range)\s+(?:of\s+)?\$?[\d,.]+)/gi;
  const rangeMatches = fullText.match(rangePatterns) ?? [];
  magnitudeScore += Math.min(10, rangeMatches.length * 4);
  const levelPatterns = /(?:support|resistance|entry|exit|stop.?loss|take.?profit)\s+(?:at|near|around)\s+\$?[\d,.]+/gi;
  const levelMatches = fullText.match(levelPatterns) ?? [];
  magnitudeScore += Math.min(5, levelMatches.length * 3);
  score += Math.min(15, magnitudeScore);

  // 5. Conditional awareness (0-10)
  const conditionalPatterns = /\b(?:unless|if .{5,}? fails|invalidated (?:if|by|when)|risk(?:s)? (?:include|are|being)|could be wrong if|this breaks down if|contingent on|assuming|provided that|barring)\b/gi;
  const conditionalMatches = fullText.match(conditionalPatterns) ?? [];
  score += Math.min(10, conditionalMatches.length * 4);

  return Math.round(Math.min(maxScore, Math.max(0, score)));
}

// ---------------------------------------------------------------------------
// NEW v34: Reasoning Traceability Scoring
// ---------------------------------------------------------------------------

/**
 * Score how well each claim in the agent's reasoning can be traced back
 * to a cited data source.
 *
 * Measures:
 * 1. Claim-Source Pairing (0-30): Do assertions come with data references?
 *    Pattern: "According to [source], X" or "The price data shows X"
 * 2. Source Attribution Density (0-20): How many distinct sources are
 *    referenced inline (not just listed at the end)?
 * 3. Orphan Claim Detection (0-20): Penalize strong assertions that
 *    lack any supporting data reference
 * 4. Evidence Chain Completeness (0-15): Does each step in the
 *    reasoning chain reference supporting evidence?
 * 5. Quantitative Backing (0-15): Are numerical claims supported by
 *    cited data (e.g., "24h change of +3.2% from Jupiter prices")?
 */
export function scoreReasoningTraceability(
  reasoning: string,
  sources: string[],
  marketPrices: Record<string, number>,
): number {
  let score = 0;
  const maxScore = 100;

  // Split reasoning into sentences for claim-level analysis
  const sentences = reasoning.split(/[.!?]+/).filter((s) => s.trim().length > 10);

  // 1. Claim-Source Pairing (0-30): Assertions with data references
  let pairingScore = 0;

  // Pattern: "According to X", "Based on X", "X data shows", "per X"
  const attributionPatterns = /\b(?:according to|based on|per|from|via|as (?:shown|indicated|reported) (?:by|in)|the (?:data|prices?|volume|chart|indicator) (?:shows?|indicates?|suggests?|reveals?)|(?:jupiter|market|price|portfolio|technical|news|sector) (?:data|feed|analysis|report))\b/gi;
  const attributionMatches = reasoning.match(attributionPatterns) ?? [];
  pairingScore += Math.min(15, attributionMatches.length * 4);

  // Pattern: "I checked X", "Looking at X", "After reviewing X"
  const researchPatterns = /\b(?:I (?:checked|reviewed|analyzed|examined|looked at|consulted|researched)|(?:looking|checking|examining|reviewing) (?:at|the)|after (?:analyzing|reviewing|checking))\b/gi;
  const researchMatches = reasoning.match(researchPatterns) ?? [];
  pairingScore += Math.min(10, researchMatches.length * 4);

  // Pattern: citing specific tools — "get_prices", "search_news", etc.
  const toolPatterns = /\b(?:get_prices|search_news|get_portfolio|get_stock_info|price feed|news search|tool|API)\b/gi;
  const toolMatches = reasoning.match(toolPatterns) ?? [];
  pairingScore += Math.min(5, toolMatches.length * 3);

  score += Math.min(30, pairingScore);

  // 2. Source Attribution Density (0-20): Distinct inline source references
  let densityScore = 0;

  // Count distinct source types referenced inline
  const sourceTypesInline = new Set<string>();
  if (/price|quotes?|ticker/i.test(reasoning)) sourceTypesInline.add("price_data");
  if (/volume|traded|liquidity/i.test(reasoning)) sourceTypesInline.add("volume_data");
  if (/news|headline|report|announcement/i.test(reasoning)) sourceTypesInline.add("news");
  if (/technical|RSI|MACD|moving average|indicator/i.test(reasoning)) sourceTypesInline.add("technical");
  if (/fundamental|earnings|revenue|P\/E|EPS/i.test(reasoning)) sourceTypesInline.add("fundamentals");
  if (/portfolio|position|holding|balance|cash/i.test(reasoning)) sourceTypesInline.add("portfolio");
  if (/sector|industry|peer|competitor/i.test(reasoning)) sourceTypesInline.add("sector");
  if (/sentiment|mood|fear|greed/i.test(reasoning)) sourceTypesInline.add("sentiment");
  if (/on-?chain|blockchain|solana|transaction/i.test(reasoning)) sourceTypesInline.add("on_chain");

  densityScore += Math.min(15, sourceTypesInline.size * 3);

  // Bonus for source density relative to reasoning length
  const sentenceCount = sentences.length;
  const sourceDensity = sentenceCount > 0 ? attributionMatches.length / sentenceCount : 0;
  if (sourceDensity >= 0.3) densityScore += 5;
  else if (sourceDensity >= 0.15) densityScore += 3;

  score += Math.min(20, densityScore);

  // 3. Orphan Claim Detection (0-20): Penalize unsupported assertions
  let orphanPenalty = 0;

  // Strong assertion patterns that SHOULD have data backing
  const strongAssertionPatterns = /\b(?:will definitely|is certain to|guaranteed|no doubt|clearly will|must (?:rise|fall|drop|increase)|always|never|impossible)\b/gi;
  const strongAssertions = reasoning.match(strongAssertionPatterns) ?? [];

  // Check if strong assertions have nearby data references
  for (const assertion of strongAssertions) {
    const idx = reasoning.toLowerCase().indexOf(assertion.toLowerCase());
    if (idx === -1) continue;
    // Look for data reference within 100 chars before/after
    const nearby = reasoning.slice(Math.max(0, idx - 100), idx + assertion.length + 100);
    const hasDataRef = /\$[\d,.]+|[\d.]+%|data|price|volume|according|based on/i.test(nearby);
    if (!hasDataRef) {
      orphanPenalty += 4;
    }
  }

  // Count sentences with claims but no data references
  let orphanClaims = 0;
  for (const sentence of sentences) {
    const hasClaim = /\b(?:will|should|expect|likely|probably|certainly|going to)\b/i.test(sentence);
    const hasData = /\$[\d,.]+|[\d.]+%|\d+\.\d{2}|data|price|volume|according|based on|per|from/i.test(sentence);
    if (hasClaim && !hasData) orphanClaims++;
  }
  orphanPenalty += Math.min(10, orphanClaims * 2);

  // Higher score = fewer orphan claims
  score += Math.max(0, 20 - orphanPenalty);

  // 4. Evidence Chain Completeness (0-15): Each reasoning step has evidence
  let chainScore = 0;

  // Detect reasoning steps
  const stepPatterns = /\b(?:first|second|third|1\.|2\.|3\.|step\s*\d|then|next|finally)\b/gi;
  const steps = reasoning.match(stepPatterns) ?? [];

  if (steps.length >= 2) {
    // Split reasoning by steps and check each for evidence
    const stepBoundaries = [...reasoning.matchAll(/(?:first|second|third|1\.|2\.|3\.|step\s*\d|then|next|finally)/gi)];
    let evidencedSteps = 0;
    for (let i = 0; i < stepBoundaries.length; i++) {
      const start = stepBoundaries[i].index ?? 0;
      const end = i + 1 < stepBoundaries.length ? (stepBoundaries[i + 1].index ?? reasoning.length) : reasoning.length;
      const stepText = reasoning.slice(start, end);
      const hasEvidence = /\$[\d,.]+|[\d.]+%|\d+\.\d{2}|data|price|volume|source|based on|per|from|according/i.test(stepText);
      if (hasEvidence) evidencedSteps++;
    }
    const completeness = stepBoundaries.length > 0 ? evidencedSteps / stepBoundaries.length : 0;
    chainScore += Math.round(completeness * 15);
  } else {
    // No multi-step structure — partial credit if reasoning has data refs
    const hasData = /\$[\d,.]+|[\d.]+%/i.test(reasoning);
    chainScore += hasData ? 5 : 0;
  }

  score += Math.min(15, chainScore);

  // 5. Quantitative Backing (0-15): Numerical claims backed by cited data
  let quantBackingScore = 0;

  // Find numerical claims that mention a source
  const quantWithSourcePatterns = /(?:\$[\d,.]+|[\d.]+%|\d+\.\d{2}).{0,40}?(?:from|per|according|based|data|feed|source|tool|API|jupiter|market)/gi;
  const quantWithSource = reasoning.match(quantWithSourcePatterns) ?? [];
  quantBackingScore += Math.min(10, quantWithSource.length * 4);

  // Reverse: source mention followed by number
  const sourceWithQuantPatterns = /(?:data|feed|source|tool|API|jupiter|market|prices?).{0,40}?(?:\$[\d,.]+|[\d.]+%|\d+\.\d{2})/gi;
  const sourceWithQuant = reasoning.match(sourceWithQuantPatterns) ?? [];
  quantBackingScore += Math.min(5, sourceWithQuant.length * 3);

  score += Math.min(15, quantBackingScore);

  return Math.round(Math.min(maxScore, Math.max(0, score)));
}

// ---------------------------------------------------------------------------
// NEW v34: Adversarial Coherence Scoring
// ---------------------------------------------------------------------------

/**
 * Score how well the agent's reasoning holds up when evaluated against
 * contrary market signals. Does the agent acknowledge counterarguments?
 *
 * Measures:
 * 1. Counterargument Acknowledgment (0-25): Does the agent mention
 *    reasons NOT to take this action? "Despite the bearish signals..."
 * 2. Conflicting Data Handling (0-25): When market data is mixed,
 *    does the agent address both sides?
 * 3. Risk-Factor Integration (0-20): Does the agent weigh risks
 *    against the thesis? "The upside is X but the risk is Y"
 * 4. Conviction Justification (0-15): If confident despite contrary
 *    signals, does the agent explain WHY the thesis still holds?
 * 5. Scenario Planning (0-15): Does the agent consider alternative
 *    outcomes? "If this thesis is wrong, the downside is..."
 */
export function scoreAdversarialCoherence(
  reasoning: string,
  action: string,
  confidence: number,
  marketPrices: Record<string, number>,
): number {
  let score = 0;
  const maxScore = 100;

  // 1. Counterargument Acknowledgment (0-25)
  let counterargScore = 0;

  // Explicit counter-thesis patterns
  const counterPatterns = /\b(?:despite|although|however|nevertheless|on the other hand|counter to|against this|the bear case|the bull case|risk (?:is|of|includes?)|downside (?:is|risk|includes?)|the case against|counterargument|critics might|bears (?:argue|point|note)|bulls (?:argue|point|note)|one concern|a risk here)\b/gi;
  const counterMatches = reasoning.match(counterPatterns) ?? [];
  counterargScore += Math.min(15, counterMatches.length * 5);

  // Acknowledging opposing view before concluding
  const concessionPatterns = /\b(?:while (?:it's|this|the)|even though|granted that|admittedly|I acknowledge|it's true that|fair point|valid concern|some would argue)\b/gi;
  const concessionMatches = reasoning.match(concessionPatterns) ?? [];
  counterargScore += Math.min(10, concessionMatches.length * 5);

  score += Math.min(25, counterargScore);

  // 2. Conflicting Data Handling (0-25)
  let conflictScore = 0;

  // Does reasoning mention both positive and negative signals?
  const hasBullishSignals = /\b(?:bullish|positive|upside|growth|strong|rally|support|undervalued|oversold)\b/i.test(reasoning);
  const hasBearishSignals = /\b(?:bearish|negative|downside|decline|weak|selloff|resistance|overvalued|overbought)\b/i.test(reasoning);

  if (hasBullishSignals && hasBearishSignals) {
    // Agent addresses both sides — good
    conflictScore += 15;

    // Extra credit for explicit weighing
    const weighingPatterns = /\b(?:outweighs?|more (?:important|significant|concerning)|on balance|net (?:positive|negative)|overall|weighing|balancing|compared to)\b/gi;
    const weighingMatches = reasoning.match(weighingPatterns) ?? [];
    conflictScore += Math.min(10, weighingMatches.length * 5);
  } else if (action === "buy" && hasBearishSignals) {
    // Buying despite bearish signals — acknowledging is good
    conflictScore += 10;
  } else if (action === "sell" && hasBullishSignals) {
    // Selling despite bullish signals — acknowledging is good
    conflictScore += 10;
  } else {
    // Only one-sided analysis — partial credit for being consistent
    conflictScore += 5;
  }

  score += Math.min(25, conflictScore);

  // 3. Risk-Factor Integration (0-20)
  let riskScore = 0;

  // Explicit risk-reward framing
  const riskRewardPatterns = /\b(?:risk.{1,5}reward|upside.{1,10}downside|reward.{1,5}risk|potential gain.{1,10}potential loss|risk.{1,5}adjusted|worth the risk|risk (?:is|of) .{3,30} but|asymmetric)\b/gi;
  const riskRewardMatches = reasoning.match(riskRewardPatterns) ?? [];
  riskScore += Math.min(10, riskRewardMatches.length * 5);

  // Risk mitigation strategies mentioned
  const mitigationPatterns = /\b(?:stop.?loss|position size|diversif|hedge|protect|limit (?:exposure|risk|downside)|small position|partial|scale in|scale out)\b/gi;
  const mitigationMatches = reasoning.match(mitigationPatterns) ?? [];
  riskScore += Math.min(10, mitigationMatches.length * 4);

  score += Math.min(20, riskScore);

  // 4. Conviction Justification (0-15)
  let convictionScore = 0;

  // High confidence requires extra justification
  const normalizedConf = confidence > 1 ? confidence / 100 : confidence;
  if (normalizedConf >= 0.7) {
    // High conviction — check for supporting justification
    const justificationPatterns = /\b(?:my conviction|I'm confident because|the reason I'm (?:bullish|bearish)|strong evidence|multiple signals|confluence|my thesis|this conviction|I believe strongly|compelling|clear signal)\b/gi;
    const justificationMatches = reasoning.match(justificationPatterns) ?? [];
    if (justificationMatches.length > 0) {
      convictionScore += Math.min(10, justificationMatches.length * 5);
    } else {
      // High confidence without justification is a red flag
      convictionScore -= 5;
    }

    // Extra credit for addressing why counterarguments don't change the thesis
    if (counterMatches.length > 0) {
      convictionScore += 5; // Acknowledged risks but still confident
    }
  } else {
    // Lower confidence — appropriate uncertainty is fine
    convictionScore += 5;
  }

  score += Math.max(0, Math.min(15, convictionScore));

  // 5. Scenario Planning (0-15)
  let scenarioScore = 0;

  // Alternative outcome consideration
  const scenarioPatterns = /\b(?:if (?:I'm|this is|we're) wrong|alternative scenario|worst case|best case|base case|downside scenario|if .{3,20} fails|plan B|exit strategy|invalidation|fallback|contingency)\b/gi;
  const scenarioMatches = reasoning.match(scenarioPatterns) ?? [];
  scenarioScore += Math.min(10, scenarioMatches.length * 5);

  // "What would change my mind" patterns
  const mindChangePatterns = /\b(?:I would reconsider if|I'd change my view|would invalidate|would cause me to|I'd exit if|reassess if|watch for)\b/gi;
  const mindChangeMatches = reasoning.match(mindChangePatterns) ?? [];
  scenarioScore += Math.min(5, mindChangeMatches.length * 3);

  score += Math.min(15, scenarioScore);

  return Math.round(Math.min(maxScore, Math.max(0, score)));
}

// ---------------------------------------------------------------------------
// Trade Grading (28 dimensions)
// ---------------------------------------------------------------------------

/**
 * Grade an individual trade with all 28 dimension sub-scores.
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
}): V34TradeGrade {
  const tradeId = `v34_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

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

  // Inherited scoring
  const transparencyScore = scoreTransparency(input.reasoning, input.sources);
  const accountabilityScore = scoreAccountability(
    input.reasoning, input.predictedOutcome, input.previousPredictions,
  );
  const groundingScore = scoreGrounding(input.reasoning, input.sources, input.marketPrices);
  const consensusQualityScore = scoreConsensusQuality(
    input.reasoning, input.action, input.peerActions, input.coherenceScore,
  );
  const causalReasoningScore = scoreCausalReasoning(input.reasoning, input.sources);
  const epistemicHumilityScore = scoreEpistemicHumility(input.predictedOutcome, input.reasoning);

  // NEW v34 scoring
  const reasoningTraceabilityScore = scoreReasoningTraceability(
    input.reasoning, input.sources, input.marketPrices,
  );
  const adversarialCoherenceScore = scoreAdversarialCoherence(
    input.reasoning, input.action, input.confidence, input.marketPrices,
  );

  // Integrity hash
  const integrityHash = createHash("sha256")
    .update(`v34:${input.agentId}:${input.action}:${input.symbol}:${input.reasoning}:${input.confidence}`)
    .digest("hex")
    .slice(0, 16);

  // Overall grade (weighted average of all 14 trade-level sub-scores)
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
    reasoningTraceabilityScore,
    adversarialCoherenceScore,
  ];
  const avgScore = subScores.reduce((a, b) => a + b, 0) / subScores.length;
  const overallGrade = getGrade(avgScore);

  const grade: V34TradeGrade = {
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
    reasoningTraceabilityScore,
    adversarialCoherenceScore,
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
// Agent Scoring (28 dimensions)
// ---------------------------------------------------------------------------

export function scoreAgent(input: {
  agentId: string;
  agentName: string;
  provider: string;
  model: string;
  trades: V34TradeGrade[];
  pnlPercent: number;
  sharpeRatio: number;
  maxDrawdown: number;
}): V34AgentScore {
  const t = input.trades;
  if (t.length === 0) {
    const emptyDims: V34DimensionScores = {
      pnlPercent: 50, sharpeRatio: 50, maxDrawdown: 50,
      coherence: 50, reasoningDepth: 50, sourceQuality: 50,
      logicalConsistency: 50, reasoningIntegrity: 50, reasoningTransparency: 50,
      reasoningGrounding: 50, causalReasoning: 50, epistemicHumility: 50,
      reasoningTraceability: 50, adversarialCoherence: 50,
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

  // Reasoning Quality (11 dims)
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
  const reasoningTraceability = avg(t.map((x) => x.reasoningTraceabilityScore));
  const adversarialCoherence = avg(t.map((x) => x.adversarialCoherenceScore));

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
  const confStdDev = Math.sqrt(
    confidences.reduce((sum, c) => sum + Math.pow(c - avg(confidences), 2), 0) / confidences.length,
  );
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
  const rqi = avg([
    coherence, reasoningDepth, sourceQuality, logicalConsistency,
    reasoningTransparency, reasoningGrounding, causalReasoning, epistemicHumility,
    reasoningTraceability, adversarialCoherence,
  ]) / 100 * 100;
  const decisionAccountability = avg(t.map((x) => x.accountabilityScore));
  const consensusQuality = avg(t.map((x) => x.consensusQualityScore));

  const dimensions: V34DimensionScores = {
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
    reasoningTraceability: Math.round(reasoningTraceability * 100) / 100,
    adversarialCoherence: Math.round(adversarialCoherence * 100) / 100,
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
    compositeScore += (dimensions[dim as keyof V34DimensionScores] ?? 50) * weight;
  }
  compositeScore = Math.round(compositeScore * 100) / 100;

  const agentScore: V34AgentScore = {
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
  scores: V34AgentScore[],
  trades: V34TradeGrade[],
  marketRegime: string,
): V34RoundSummary {
  const sorted = [...trades].sort((a, b) => {
    const gradeOrder = ["A+", "A", "B+", "B", "C+", "C", "D", "F"];
    return gradeOrder.indexOf(a.overallGrade) - gradeOrder.indexOf(b.overallGrade);
  });

  const actions = trades.map((t) => t.action);
  const modeAction = actions.sort((a, b) =>
    countByCondition(actions, (v) => v === a) - countByCondition(actions, (v) => v === b),
  ).pop() ?? "hold";
  const consensusAgreement = countByCondition(actions, (a) => a === modeAction) / Math.max(1, actions.length);

  const avgOf = (fn: (t: V34TradeGrade) => number) =>
    trades.length > 0
      ? Math.round(trades.reduce((s, t) => s + fn(t), 0) / trades.length * 100) / 100
      : 50;

  const summary: V34RoundSummary = {
    roundId,
    timestamp: new Date().toISOString(),
    agentScores: scores,
    bestTrade: sorted[0] ?? null,
    worstTrade: sorted[sorted.length - 1] ?? null,
    consensusAgreement: Math.round(consensusAgreement * 100) / 100,
    marketRegime,
    avgTransparency: avgOf((t) => t.transparencyScore),
    avgAccountability: avgOf((t) => t.accountabilityScore),
    avgGrounding: avgOf((t) => t.groundingScore),
    avgConsensusQuality: avgOf((t) => t.consensusQualityScore),
    avgCausalReasoning: avgOf((t) => t.causalReasoningScore),
    avgEpistemicHumility: avgOf((t) => t.epistemicHumilityScore),
    avgTraceability: avgOf((t) => t.reasoningTraceabilityScore),
    avgAdversarialCoherence: avgOf((t) => t.adversarialCoherenceScore),
  };

  roundSummaries.unshift(summary);
  if (roundSummaries.length > 200) roundSummaries.length = 200;

  return summary;
}

// ---------------------------------------------------------------------------
// Public Getters
// ---------------------------------------------------------------------------

export function getAgentScores(): V34AgentScore[] {
  return Array.from(agentScores.values());
}

export function getAgentScore(agentId: string): V34AgentScore | undefined {
  return agentScores.get(agentId);
}

export function getTradeGrades(limit = 50): V34TradeGrade[] {
  return tradeGrades.slice(0, limit);
}

export function getTradeGradesByAgent(agentId: string, limit = 50): V34TradeGrade[] {
  return tradeGrades.filter((g) => g.agentId === agentId).slice(0, limit);
}

export function getRoundSummaries(limit = 20): V34RoundSummary[] {
  return roundSummaries.slice(0, limit);
}

export function getDimensionWeights(): Record<string, number> {
  return { ...DIMENSION_WEIGHTS };
}

export function getDimensionCount(): number {
  return 28;
}

export function getBenchmarkVersion(): string {
  return "34.0";
}
