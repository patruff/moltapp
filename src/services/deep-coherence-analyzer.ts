/**
 * Deep Coherence Analyzer
 *
 * Advanced analysis engine that goes beyond simple sentiment matching.
 * Performs structural reasoning analysis to evaluate the quality and
 * depth of an agent's trade justification.
 *
 * Analysis dimensions:
 * 1. Logical Structure — Does the reasoning follow a logical chain?
 * 2. Evidence Grounding — Are claims supported by cited data?
 * 3. Risk Awareness — Does the agent acknowledge risks?
 * 4. Temporal Reasoning — Does the agent consider time horizons?
 * 5. Counterfactual Thinking — Does the agent consider what could go wrong?
 * 6. Quantitative Rigor — Are numbers used accurately and meaningfully?
 *
 * This is what separates MoltApp from toy benchmarks — we don't just
 * check if reasoning exists, we measure its QUALITY.
 */

import type { MarketData } from "../agents/base-agent.ts";
import { computeGrade } from "../lib/grade-calculator.ts";
import { mean, round2, round3, splitSentences, weightedSum, weightedSumByKey } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeepCoherenceResult {
  /** Overall deep coherence score (0-1) */
  overallScore: number;
  /** Grade: A+ through F */
  grade: string;
  /** Individual dimension scores */
  dimensions: {
    logicalStructure: DimensionScore;
    evidenceGrounding: DimensionScore;
    riskAwareness: DimensionScore;
    temporalReasoning: DimensionScore;
    counterfactualThinking: DimensionScore;
    quantitativeRigor: DimensionScore;
  };
  /** Notable strengths found in the reasoning */
  strengths: string[];
  /** Notable weaknesses found in the reasoning */
  weaknesses: string[];
  /** Word count and complexity metrics */
  textMetrics: TextMetrics;
}

export interface DimensionScore {
  score: number; // 0-1
  evidence: string[]; // Specific phrases that support this score
  weight: number; // How much this dimension contributes
}

export interface TextMetrics {
  wordCount: number;
  sentenceCount: number;
  avgWordsPerSentence: number;
  uniqueWordRatio: number;
  technicalTermDensity: number;
  quantitativeClaimCount: number;
}

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Dimension Weights
 *
 * Controls how much each analysis dimension contributes to overall coherence score.
 * Sum = 1.0 (100%). Adjust to emphasize different aspects of reasoning quality.
 */

/** Weight for logical structure dimension (0-1) */
const DIMENSION_WEIGHT_LOGICAL_STRUCTURE = 0.25;

/** Weight for evidence grounding dimension (0-1) */
const DIMENSION_WEIGHT_EVIDENCE_GROUNDING = 0.20;

/** Weight for risk awareness dimension (0-1) */
const DIMENSION_WEIGHT_RISK_AWARENESS = 0.20;

/** Weight for temporal reasoning dimension (0-1) */
const DIMENSION_WEIGHT_TEMPORAL_REASONING = 0.15;

/** Weight for counterfactual thinking dimension (0-1) */
const DIMENSION_WEIGHT_COUNTERFACTUAL_THINKING = 0.10;

/** Weight for quantitative rigor dimension (0-1) */
const DIMENSION_WEIGHT_QUANTITATIVE_RIGOR = 0.10;

/**
 * Pattern Weights - Logical Structure
 *
 * Score contribution per pattern match in logical structure analysis.
 * Higher weights = stronger indicator of quality reasoning structure.
 */

/** Causal connectors (because, since, therefore, thus, hence, consequently) */
const PATTERN_WEIGHT_CAUSAL_CONNECTOR = 0.15;

/** Enumeration markers (first, second, third, finally, additionally, moreover) */
const PATTERN_WEIGHT_ENUMERATION = 0.12;

/** Conditional logic (if...then constructs) */
const PATTERN_WEIGHT_CONDITIONAL_LOGIC = 0.15;

/** Counterpoint markers (however, although, despite, nevertheless) */
const PATTERN_WEIGHT_COUNTERPOINT = 0.12;

/** Evidence references (based on, according to, given that, considering) */
const PATTERN_WEIGHT_EVIDENCE_REFERENCE = 0.10;

/** Synthesis markers (in conclusion, overall, weighing, on balance) */
const PATTERN_WEIGHT_SYNTHESIS = 0.10;

/** Comparison markers (compared to, relative to, versus) */
const PATTERN_WEIGHT_COMPARISON = 0.08;

/** Specificity markers (specifically, in particular, namely, for example) */
const PATTERN_WEIGHT_SPECIFICITY = 0.08;

/**
 * Pattern Weights - Risk Awareness
 *
 * Score contribution per pattern match in risk awareness analysis.
 * Higher weights = stronger indicator of risk-aware reasoning.
 */

/** Risk tool mentions (stop-loss, trailing stop, risk management) */
const PATTERN_WEIGHT_RISK_TOOL = 0.15;

/** Scenario analysis (worst case, scenario, if...fails, could go wrong) */
const PATTERN_WEIGHT_SCENARIO_ANALYSIS = 0.15;

/** Risk mentions (risk, downside, danger, threat, exposure) */
const PATTERN_WEIGHT_RISK_MENTION = 0.12;

/** Risk mitigation strategies (diversify, hedge, protect, limit losses) */
const PATTERN_WEIGHT_RISK_MITIGATION = 0.12;

/** Position management (position size, portfolio allocation, cash buffer) */
const PATTERN_WEIGHT_POSITION_MANAGEMENT = 0.12;

/** Quantitative risk metrics (drawdown, max loss, value at risk, VaR) */
const PATTERN_WEIGHT_QUANTITATIVE_RISK = 0.10;

/** Uncertainty awareness (volatile, uncertain, unpredictable) */
const PATTERN_WEIGHT_UNCERTAINTY_AWARENESS = 0.08;

/**
 * Pattern Weights - Temporal Reasoning
 *
 * Score contribution per pattern match in temporal reasoning analysis.
 * Balanced weighting across time horizons.
 */

/** Medium-term horizon mentions (medium-term, coming weeks, next quarter) */
const PATTERN_WEIGHT_MEDIUM_HORIZON = 0.12;

/** Long-term horizon mentions (long-term, months, years, secular trend) */
const PATTERN_WEIGHT_LONG_HORIZON = 0.12;

/** Short-term horizon mentions (short-term, near-term, intraday, this week) */
const PATTERN_WEIGHT_SHORT_HORIZON = 0.10;

/** Timing considerations (timing, entry point, exit strategy, when to) */
const PATTERN_WEIGHT_TIMING_CONSIDERATION = 0.10;

/** Event awareness (catalyst, upcoming, scheduled, earnings date, event) */
const PATTERN_WEIGHT_EVENT_AWARENESS = 0.10;

/** Historical context (historically, in the past, previous, track record) */
const PATTERN_WEIGHT_HISTORICAL_CONTEXT = 0.08;

/**
 * Pattern Weights - Counterfactual Thinking
 *
 * Score contribution per pattern match in counterfactual analysis.
 * Emphasizes scenario framing and alternative thinking.
 */

/** Hypothetical thinking (what if, suppose, assuming, in case) */
const PATTERN_WEIGHT_HYPOTHETICAL = 0.15;

/** Scenario framing (bear case, bull case, best case, worst case) */
const PATTERN_WEIGHT_SCENARIO_FRAMING = 0.15;

/** Alternative views (alternatively, or else, on the other hand, conversely) */
const PATTERN_WEIGHT_ALTERNATIVE_VIEW = 0.12;

/** Tradeoff analysis (risk/reward, upside...downside, pros...cons) */
const PATTERN_WEIGHT_TRADEOFF_ANALYSIS = 0.12;

/** Self-challenge (invalidate, disprove, contradict, evidence against) */
const PATTERN_WEIGHT_SELF_CHALLENGE = 0.12;

/** Alternative outcome consideration (could also, might instead, another possibility) */
const PATTERN_WEIGHT_ALTERNATIVE_OUTCOME = 0.10;

/**
 * Evidence Grounding Score Increments
 *
 * Score additions for each type of evidence reference found.
 * Sum of increments capped at 1.0 (100%).
 */

/** Score bonus for price references ($123, 45.67) */
const EVIDENCE_SCORE_PRICE_REFERENCES = 0.20;

/** Score bonus for percentage references (+5%, -2.3%) */
const EVIDENCE_SCORE_PERCENTAGE_REFERENCES = 0.15;

/** Score bonus for technical indicator references (RSI, MACD, MA, Bollinger, support, resistance) */
const EVIDENCE_SCORE_TECHNICAL_INDICATOR = 0.15;

/** Score bonus for fundamental data references (P/E, earnings, revenue, margin, cash flow, dividend) */
const EVIDENCE_SCORE_FUNDAMENTAL_DATA = 0.15;

/** Score bonus for market data references (volume, market cap, float, shares outstanding) */
const EVIDENCE_SCORE_MARKET_DATA = 0.10;

/** Score increment per stock symbol reference (capped at EVIDENCE_SCORE_SYMBOL_REFERENCES_MAX) */
const EVIDENCE_SCORE_PER_SYMBOL_REFERENCE = 0.05;

/** Maximum score bonus for stock symbol references (caps at 4 symbols) */
const EVIDENCE_SCORE_SYMBOL_REFERENCES_MAX = 0.20;

/**
 * Quantitative Rigor Score Increments
 *
 * Score additions for quantitative analysis elements.
 * Higher values for more sophisticated quantitative reasoning.
 */

/** Score bonus for high numeric claim count (5+ numbers cited) */
const QUANTITATIVE_SCORE_NUMERIC_CLAIMS_HIGH = 0.30;

/** Score bonus for moderate numeric claim count (2-4 numbers cited) */
const QUANTITATIVE_SCORE_NUMERIC_CLAIMS_MODERATE = 0.15;

/** Score bonus for specific price targets or levels */
const QUANTITATIVE_SCORE_PRICE_TARGET = 0.20;

/** Score bonus for percentage-based return projections (% upside/downside/gain/loss/return) */
const QUANTITATIVE_SCORE_RETURN_PROJECTION = 0.20;

/** Score bonus for ratio analysis (ratio, multiple, times, x earnings, valuation) */
const QUANTITATIVE_SCORE_RATIO_ANALYSIS = 0.15;

/** Score penalty for overconfidence without data (confidence > 80% with < 2 numbers) */
const QUANTITATIVE_PENALTY_OVERCONFIDENT = 0.10;

/**
 * Scoring Thresholds
 *
 * Thresholds for classifying dimension scores as strengths or weaknesses.
 * Applied to identify notable patterns in reasoning quality.
 */

/** Threshold for "excellent" dimension score (triggers strength notation) */
const SCORE_THRESHOLD_EXCELLENT = 0.6;

/** Threshold for "good" dimension score (alternative threshold for some dimensions) */
const SCORE_THRESHOLD_GOOD = 0.5;

/** Threshold for "poor" dimension score (triggers weakness notation) */
const SCORE_THRESHOLD_POOR = 0.3;

/** Threshold for "very poor" dimension score (stricter weakness threshold) */
const SCORE_THRESHOLD_VERY_POOR = 0.2;

/** Threshold for "minimal" dimension score (strictest weakness threshold) */
const SCORE_THRESHOLD_MINIMAL = 0.15;

/** Numeric claim count threshold for "high" quantitative rigor (5+ numbers) */
const NUMERIC_CLAIM_COUNT_HIGH = 5;

/** Numeric claim count threshold for "moderate" quantitative rigor (2+ numbers) */
const NUMERIC_CLAIM_COUNT_MODERATE = 2;

/** High confidence threshold for overconfidence detection (80%+) */
const HIGH_CONFIDENCE_THRESHOLD = 0.8;

/**
 * Text Quality Adjustment Factors
 *
 * Multipliers applied to overall coherence score based on text metrics.
 * Penalizes very short text, rewards rich vocabulary and detail.
 */

/** Word count threshold for "very short" penalty (< 20 words) */
const TEXT_MIN_WORD_COUNT = 20;

/** Word count threshold for "detailed" bonus (100+ words) */
const TEXT_DETAILED_WORD_COUNT = 100;

/** Unique word ratio threshold for "rich vocabulary" bonus (> 0.5) */
const TEXT_UNIQUE_WORD_RATIO_THRESHOLD = 0.5;

/** Score multiplier for very short reasoning (< 20 words) */
const TEXT_PENALTY_VERY_SHORT = 0.5;

/** Score multiplier for detailed, rich vocabulary reasoning (100+ words, >0.5 unique ratio) */
const TEXT_BONUS_DETAILED_RICH = 1.05;

/**
 * Scoring Bounds and Normalization
 *
 * Score caps and floors ensure all dimension and overall scores remain in valid [0, 1] range.
 * Used consistently across all scoring functions.
 */

/** Maximum allowed score (upper bound for all dimension scores) */
const SCORE_MAX = 1;

/** Minimum allowed score (lower bound for all dimension scores) */
const SCORE_MIN = 0;

/**
 * Text Processing Parameters
 *
 * Controls text analysis behavior for computing text metrics.
 */

/** Minimum sentence length (in characters) for sentence splitting */
const SENTENCE_MIN_LENGTH = 3;

/** Rounding precision for avgWordsPerSentence (tenths place) */
const AVG_WORDS_ROUNDING_PRECISION = 10;

/**
 * Aggregate Analysis Parameters
 *
 * Controls how strength/weakness frequencies are displayed in aggregate stats.
 */

/** Maximum number of top strengths to display in agent stats */
const TOP_STRENGTHS_DISPLAY_LIMIT = 5;

/** Maximum number of top weaknesses to display in agent stats */
const TOP_WEAKNESSES_DISPLAY_LIMIT = 5;

// ---------------------------------------------------------------------------
// Pattern Libraries
// ---------------------------------------------------------------------------

/** Patterns indicating logical structure in reasoning */
const LOGICAL_STRUCTURE_PATTERNS: [RegExp, number, string][] = [
  [/\b(because|since|therefore|thus|hence|consequently)\b/i, PATTERN_WEIGHT_CAUSAL_CONNECTOR, "causal_connector"],
  [/\b(first|second|third|finally|additionally|moreover)\b/i, PATTERN_WEIGHT_ENUMERATION, "enumeration"],
  [/\b(if\s+.+?\s+then)\b/i, PATTERN_WEIGHT_CONDITIONAL_LOGIC, "conditional_logic"],
  [/\b(however|although|despite|nevertheless|on\s+the\s+other\s+hand)\b/i, PATTERN_WEIGHT_COUNTERPOINT, "counterpoint"],
  [/\b(based\s+on|according\s+to|given\s+that|considering)\b/i, PATTERN_WEIGHT_EVIDENCE_REFERENCE, "evidence_reference"],
  [/\b(in\s+conclusion|overall|weighing|on\s+balance)\b/i, PATTERN_WEIGHT_SYNTHESIS, "synthesis"],
  [/\b(compared\s+to|relative\s+to|versus|vs\.?)\b/i, PATTERN_WEIGHT_COMPARISON, "comparison"],
  [/\b(specifically|in\s+particular|namely|for\s+example)\b/i, PATTERN_WEIGHT_SPECIFICITY, "specificity"],
];

/** Patterns indicating risk awareness */
const RISK_AWARENESS_PATTERNS: [RegExp, number, string][] = [
  [/\b(risk|downside|danger|threat|exposure)\b/i, PATTERN_WEIGHT_RISK_MENTION, "risk_mention"],
  [/\b(stop.?loss|trailing\s+stop|risk\s+management)\b/i, PATTERN_WEIGHT_RISK_TOOL, "risk_tool"],
  [/\b(worst\s+case|scenario|if\s+.+\s+fails?|could\s+go\s+wrong)\b/i, PATTERN_WEIGHT_SCENARIO_ANALYSIS, "scenario_analysis"],
  [/\b(diversif|hedg|protect|limit\s+losses?)\b/i, PATTERN_WEIGHT_RISK_MITIGATION, "risk_mitigation"],
  [/\b(volatil|uncertain|unpredictable)\b/i, PATTERN_WEIGHT_UNCERTAINTY_AWARENESS, "uncertainty_awareness"],
  [/\b(position\s+siz|portfolio\s+allocation|cash\s+buffer)\b/i, PATTERN_WEIGHT_POSITION_MANAGEMENT, "position_management"],
  [/\b(drawdown|max\s+loss|value\s+at\s+risk|VaR)\b/i, PATTERN_WEIGHT_QUANTITATIVE_RISK, "quantitative_risk"],
];

/** Patterns indicating temporal reasoning */
const TEMPORAL_PATTERNS: [RegExp, number, string][] = [
  [/\b(short.?term|near.?term|intraday|this\s+week)\b/i, PATTERN_WEIGHT_SHORT_HORIZON, "short_horizon"],
  [/\b(medium.?term|coming\s+weeks?|next\s+quarter)\b/i, PATTERN_WEIGHT_MEDIUM_HORIZON, "medium_horizon"],
  [/\b(long.?term|months?|years?|secular\s+trend)\b/i, PATTERN_WEIGHT_LONG_HORIZON, "long_horizon"],
  [/\b(timing|entry\s+point|exit\s+strategy|when\s+to)\b/i, PATTERN_WEIGHT_TIMING_CONSIDERATION, "timing_consideration"],
  [/\b(catalyst|upcoming|scheduled|earnings\s+date|event)\b/i, PATTERN_WEIGHT_EVENT_AWARENESS, "event_awareness"],
  [/\b(historically|in\s+the\s+past|previous|track\s+record)\b/i, PATTERN_WEIGHT_HISTORICAL_CONTEXT, "historical_context"],
];

/** Patterns indicating counterfactual thinking */
const COUNTERFACTUAL_PATTERNS: [RegExp, number, string][] = [
  [/\b(what\s+if|suppose|assuming|in\s+case)\b/i, PATTERN_WEIGHT_HYPOTHETICAL, "hypothetical"],
  [/\b(alternatively|or\s+else|on\s+the\s+other\s+hand|conversely)\b/i, PATTERN_WEIGHT_ALTERNATIVE_VIEW, "alternative_view"],
  [/\b(bear\s+case|bull\s+case|best\s+case|worst\s+case)\b/i, PATTERN_WEIGHT_SCENARIO_FRAMING, "scenario_framing"],
  [/\b(could\s+also|might\s+instead|another\s+possibility)\b/i, PATTERN_WEIGHT_ALTERNATIVE_OUTCOME, "alternative_outcome"],
  [/\b(risk.?reward|upside.*downside|pros?.*cons?)\b/i, PATTERN_WEIGHT_TRADEOFF_ANALYSIS, "tradeoff_analysis"],
  [/\b(invalidat|disprove|contradict|evidence\s+against)\b/i, PATTERN_WEIGHT_SELF_CHALLENGE, "self_challenge"],
];

/** Financial and technical terms indicating domain expertise */
const TECHNICAL_TERMS = new Set([
  "p/e", "pe ratio", "eps", "revenue", "earnings", "margin", "ebitda",
  "moving average", "rsi", "macd", "bollinger", "fibonacci", "support",
  "resistance", "volume", "volatility", "beta", "alpha", "sharpe",
  "correlation", "standard deviation", "drawdown", "var", "momentum",
  "mean reversion", "breakout", "consolidation", "divergence", "overbought",
  "oversold", "accumulation", "distribution", "market cap", "valuation",
  "cash flow", "dividend", "yield", "spread", "basis", "premium",
  "discount", "liquidity", "float", "short interest", "institutional",
  "sector rotation", "breadth", "sentiment", "vix", "fear", "greed",
]);

// ---------------------------------------------------------------------------
// Analysis Functions
// ---------------------------------------------------------------------------

/**
 * Analyze the deep coherence of an agent's trading reasoning.
 *
 * Goes far beyond simple sentiment matching to evaluate the
 * structural quality, logical rigor, and depth of analysis.
 */
export function analyzeDeepCoherence(
  reasoning: string,
  action: "buy" | "sell" | "hold",
  symbol: string,
  confidence: number,
  marketData?: MarketData[],
): DeepCoherenceResult {
  const textMetrics = computeTextMetrics(reasoning);
  const strengths: string[] = [];
  const weaknesses: string[] = [];

  // Dimension 1: Logical Structure
  const logicalStructure = scoreDimension(
    reasoning,
    LOGICAL_STRUCTURE_PATTERNS,
    DIMENSION_WEIGHT_LOGICAL_STRUCTURE,
  );
  if (logicalStructure.score >= SCORE_THRESHOLD_EXCELLENT) {
    strengths.push("Well-structured logical reasoning with clear causal connections");
  } else if (logicalStructure.score < SCORE_THRESHOLD_POOR) {
    weaknesses.push("Reasoning lacks logical connectors and structured argumentation");
  }

  // Dimension 2: Evidence Grounding
  const evidenceGrounding = scoreEvidenceGrounding(reasoning, marketData, DIMENSION_WEIGHT_EVIDENCE_GROUNDING);
  if (evidenceGrounding.score >= SCORE_THRESHOLD_EXCELLENT) {
    strengths.push("Claims grounded in specific, verifiable data points");
  } else if (evidenceGrounding.score < SCORE_THRESHOLD_POOR) {
    weaknesses.push("Reasoning makes claims without citing specific evidence");
  }

  // Dimension 3: Risk Awareness
  const riskAwareness = scoreDimension(
    reasoning,
    RISK_AWARENESS_PATTERNS,
    DIMENSION_WEIGHT_RISK_AWARENESS,
  );
  if (riskAwareness.score >= SCORE_THRESHOLD_GOOD) {
    strengths.push("Demonstrates awareness of risks and position management");
  } else if (action !== "hold" && riskAwareness.score < SCORE_THRESHOLD_VERY_POOR) {
    weaknesses.push("No risk awareness for a non-hold trade decision");
  }

  // Dimension 4: Temporal Reasoning
  const temporalReasoning = scoreDimension(
    reasoning,
    TEMPORAL_PATTERNS,
    DIMENSION_WEIGHT_TEMPORAL_REASONING,
  );
  if (temporalReasoning.score >= SCORE_THRESHOLD_GOOD) {
    strengths.push("Considers multiple time horizons in analysis");
  } else if (temporalReasoning.score < SCORE_THRESHOLD_MINIMAL) {
    weaknesses.push("No consideration of time horizon or catalysts");
  }

  // Dimension 5: Counterfactual Thinking
  const counterfactualThinking = scoreDimension(
    reasoning,
    COUNTERFACTUAL_PATTERNS,
    DIMENSION_WEIGHT_COUNTERFACTUAL_THINKING,
  );
  if (counterfactualThinking.score >= SCORE_THRESHOLD_GOOD) {
    strengths.push("Considers alternative scenarios and what could go wrong");
  }

  // Dimension 6: Quantitative Rigor
  const quantitativeRigor = scoreQuantitativeRigor(reasoning, confidence, DIMENSION_WEIGHT_QUANTITATIVE_RIGOR);
  if (quantitativeRigor.score >= SCORE_THRESHOLD_EXCELLENT) {
    strengths.push("Uses specific numbers and quantitative analysis");
  } else if (quantitativeRigor.score < SCORE_THRESHOLD_VERY_POOR && action !== "hold") {
    weaknesses.push("Lacks quantitative data to support trade thesis");
  }

  // Compute overall score
  const dimensions = [
    logicalStructure,
    evidenceGrounding,
    riskAwareness,
    temporalReasoning,
    counterfactualThinking,
    quantitativeRigor,
  ];
  const overallScore = round2(weightedSumByKey(dimensions, "score", "weight"));

  // Text quality bonus/penalty
  let adjustedScore = overallScore;
  if (textMetrics.wordCount < TEXT_MIN_WORD_COUNT) {
    adjustedScore *= TEXT_PENALTY_VERY_SHORT;
    weaknesses.push("Reasoning is very short — insufficient depth for benchmark");
  } else if (textMetrics.wordCount >= TEXT_DETAILED_WORD_COUNT && textMetrics.uniqueWordRatio > TEXT_UNIQUE_WORD_RATIO_THRESHOLD) {
    adjustedScore = Math.min(SCORE_MAX, adjustedScore * TEXT_BONUS_DETAILED_RICH);
    strengths.push("Rich vocabulary and detailed analysis");
  }

  const finalScore = round2(Math.min(SCORE_MAX, Math.max(SCORE_MIN, adjustedScore)));

  return {
    overallScore: finalScore,
    grade: computeGrade(finalScore),
    dimensions: {
      logicalStructure,
      evidenceGrounding,
      riskAwareness,
      temporalReasoning,
      counterfactualThinking,
      quantitativeRigor,
    },
    strengths,
    weaknesses,
    textMetrics,
  };
}

// ---------------------------------------------------------------------------
// Scoring Helpers
// ---------------------------------------------------------------------------

function scoreDimension(
  reasoning: string,
  patterns: [RegExp, number, string][],
  weight: number,
): DimensionScore {
  const evidence: string[] = [];
  let rawScore = 0;

  for (const [pattern, patternWeight, label] of patterns) {
    const match = reasoning.match(pattern);
    if (match) {
      rawScore += patternWeight;
      evidence.push(label);
    }
  }

  return {
    score: Math.min(SCORE_MAX, rawScore),
    evidence,
    weight,
  };
}

function scoreEvidenceGrounding(
  reasoning: string,
  marketData: MarketData[] | undefined,
  weight: number,
): DimensionScore {
  const evidence: string[] = [];
  let score = 0;

  // Check if reasoning references specific prices
  const priceRefs = reasoning.match(/\$\d+[\d,.]*|\d+\.\d{2}/g);
  if (priceRefs && priceRefs.length > 0) {
    score += EVIDENCE_SCORE_PRICE_REFERENCES;
    evidence.push(`price_references(${priceRefs.length})`);
  }

  // Check if reasoning references specific percentage changes
  const pctRefs = reasoning.match(/[+-]?\d+\.?\d*%/g);
  if (pctRefs && pctRefs.length > 0) {
    score += EVIDENCE_SCORE_PERCENTAGE_REFERENCES;
    evidence.push(`percentage_references(${pctRefs.length})`);
  }

  // Check if reasoning references actual stock symbols from market data
  if (marketData) {
    const symbols = marketData.map((d) => d.symbol.toLowerCase());
    let symbolRefs = 0;
    for (const sym of symbols) {
      if (reasoning.toLowerCase().includes(sym.replace(/x$/, ""))) {
        symbolRefs++;
      }
    }
    if (symbolRefs > 0) {
      score += Math.min(EVIDENCE_SCORE_SYMBOL_REFERENCES_MAX, symbolRefs * EVIDENCE_SCORE_PER_SYMBOL_REFERENCE);
      evidence.push(`stock_references(${symbolRefs})`);
    }
  }

  // Check for volume, market cap, or other data references
  if (/\b(volume|market\s+cap|float|shares\s+outstanding)\b/i.test(reasoning)) {
    score += EVIDENCE_SCORE_MARKET_DATA;
    evidence.push("market_data_reference");
  }

  // Check for technical indicator references
  if (/\b(RSI|MACD|moving\s+average|bollinger|support|resistance)\b/i.test(reasoning)) {
    score += EVIDENCE_SCORE_TECHNICAL_INDICATOR;
    evidence.push("technical_indicator");
  }

  // Check for fundamental references
  if (/\b(P\/E|earnings|revenue|margin|cash\s+flow|dividend)\b/i.test(reasoning)) {
    score += EVIDENCE_SCORE_FUNDAMENTAL_DATA;
    evidence.push("fundamental_data");
  }

  return {
    score: Math.min(SCORE_MAX, score),
    evidence,
    weight,
  };
}

function scoreQuantitativeRigor(
  reasoning: string,
  confidence: number,
  weight: number,
): DimensionScore {
  const evidence: string[] = [];
  let score = 0;

  // Count numeric claims
  const numbers = reasoning.match(/\d+\.?\d*/g);
  const numCount = numbers?.length ?? 0;
  if (numCount >= NUMERIC_CLAIM_COUNT_HIGH) {
    score += QUANTITATIVE_SCORE_NUMERIC_CLAIMS_HIGH;
    evidence.push(`numeric_claims(${numCount})`);
  } else if (numCount >= NUMERIC_CLAIM_COUNT_MODERATE) {
    score += QUANTITATIVE_SCORE_NUMERIC_CLAIMS_MODERATE;
    evidence.push(`numeric_claims(${numCount})`);
  }

  // Check for specific price targets or levels
  if (/\b(target|level|support\s+at|resistance\s+at)\s+\$?\d/i.test(reasoning)) {
    score += QUANTITATIVE_SCORE_PRICE_TARGET;
    evidence.push("price_target");
  }

  // Check for percentage-based reasoning
  if (/\b\d+\.?\d*%\s+(upside|downside|gain|loss|return)\b/i.test(reasoning)) {
    score += QUANTITATIVE_SCORE_RETURN_PROJECTION;
    evidence.push("return_projection");
  }

  // Check for ratio analysis
  if (/\b(ratio|multiple|times|x\s+earnings|valuation)\b/i.test(reasoning)) {
    score += QUANTITATIVE_SCORE_RATIO_ANALYSIS;
    evidence.push("ratio_analysis");
  }

  // Confidence calibration check — extreme confidence should have strong quant backing
  if (confidence > HIGH_CONFIDENCE_THRESHOLD && numCount < NUMERIC_CLAIM_COUNT_MODERATE) {
    score = Math.max(0, score - QUANTITATIVE_PENALTY_OVERCONFIDENT);
    evidence.push("overconfident_without_data");
  }

  return {
    score: Math.min(SCORE_MAX, score),
    evidence,
    weight,
  };
}

function computeTextMetrics(reasoning: string): TextMetrics {
  const words = reasoning.split(/\s+/).filter((w) => w.length > 0);
  const sentences = splitSentences(reasoning, SENTENCE_MIN_LENGTH);
  const uniqueWords = new Set(words.map((w) => w.toLowerCase()));

  // Count technical terms
  let technicalCount = 0;
  const lowerReasoning = reasoning.toLowerCase();
  for (const term of TECHNICAL_TERMS) {
    if (lowerReasoning.includes(term)) {
      technicalCount++;
    }
  }

  // Count quantitative claims (numbers in context)
  const quantClaims = reasoning.match(/\$?\d+[\d,.]*%?/g);

  return {
    wordCount: words.length,
    sentenceCount: sentences.length,
    avgWordsPerSentence: sentences.length > 0 ? Math.round((words.length / sentences.length) * AVG_WORDS_ROUNDING_PRECISION) / AVG_WORDS_ROUNDING_PRECISION : 0,
    uniqueWordRatio: words.length > 0 ? round2(uniqueWords.size / words.length) : 0,
    technicalTermDensity: words.length > 0 ? round3(technicalCount / words.length) : 0,
    quantitativeClaimCount: quantClaims?.length ?? 0,
  };
}


// ---------------------------------------------------------------------------
// Aggregate Analysis
// ---------------------------------------------------------------------------

/** In-memory history for aggregate analysis */
const analysisHistory: Map<string, DeepCoherenceResult[]> = new Map();
const MAX_HISTORY_PER_AGENT = 100;

/**
 * Record a deep coherence analysis result for an agent.
 */
export function recordDeepAnalysis(agentId: string, result: DeepCoherenceResult): void {
  const history = analysisHistory.get(agentId) ?? [];
  history.push(result);
  if (history.length > MAX_HISTORY_PER_AGENT) {
    history.shift();
  }
  analysisHistory.set(agentId, history);
}

/**
 * Get aggregate deep coherence stats for an agent.
 */
export function getAgentDeepCoherenceStats(agentId: string) {
  const history = analysisHistory.get(agentId) ?? [];
  if (history.length === 0) {
    return {
      agentId,
      totalAnalyzed: 0,
      avgOverallScore: 0,
      avgGrade: "N/A",
      dimensionAverages: null,
      strengthFrequency: [],
      weaknessFrequency: [],
    };
  }

  const avgScore = history.reduce((s, r) => s + r.overallScore, 0) / history.length;

  // Compute dimension averages
  const dimAvgs = {
    logicalStructure: mean(history.map((r) => r.dimensions.logicalStructure.score)),
    evidenceGrounding: mean(history.map((r) => r.dimensions.evidenceGrounding.score)),
    riskAwareness: mean(history.map((r) => r.dimensions.riskAwareness.score)),
    temporalReasoning: mean(history.map((r) => r.dimensions.temporalReasoning.score)),
    counterfactualThinking: mean(history.map((r) => r.dimensions.counterfactualThinking.score)),
    quantitativeRigor: mean(history.map((r) => r.dimensions.quantitativeRigor.score)),
  };

  // Count strength/weakness frequency
  const strengthCounts = new Map<string, number>();
  const weaknessCounts = new Map<string, number>();
  for (const r of history) {
    for (const s of r.strengths) {
      strengthCounts.set(s, (strengthCounts.get(s) ?? 0) + 1);
    }
    for (const w of r.weaknesses) {
      weaknessCounts.set(w, (weaknessCounts.get(w) ?? 0) + 1);
    }
  }

  return {
    agentId,
    totalAnalyzed: history.length,
    avgOverallScore: round2(avgScore),
    avgGrade: computeGrade(avgScore),
    dimensionAverages: dimAvgs,
    strengthFrequency: Array.from(strengthCounts.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, TOP_STRENGTHS_DISPLAY_LIMIT)
      .map(([text, count]) => ({ text, count })),
    weaknessFrequency: Array.from(weaknessCounts.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, TOP_WEAKNESSES_DISPLAY_LIMIT)
      .map(([text, count]) => ({ text, count })),
  };
}

/**
 * Get comparative deep coherence stats across all agents.
 */
export function getAllAgentsDeepCoherenceStats() {
  const agents = Array.from(analysisHistory.keys());
  return agents.map((agentId) => getAgentDeepCoherenceStats(agentId));
}

