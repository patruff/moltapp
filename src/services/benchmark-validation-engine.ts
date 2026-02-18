/**
 * Benchmark Validation Engine v12
 *
 * Production-grade validation layer that ensures every trade meets
 * benchmark-quality standards before it enters the scoring pipeline.
 * This is the gatekeeper between raw agent output and the benchmark dataset.
 *
 * Validation dimensions:
 * 1. STRUCTURAL VALIDITY — Does the trade have all required fields?
 * 2. REASONING DEPTH — Is the reasoning substantive enough to score?
 * 3. SOURCE VERIFICATION — Are claimed sources plausible?
 * 4. PRICE GROUNDING — Do price references match real market data?
 * 5. TEMPORAL CONSISTENCY — Does the reasoning reference current conditions?
 * 6. CONFIDENCE CALIBRATION — Is confidence within historical norms for this agent?
 * 7. ACTION-REASONING ALIGNMENT — Quick pre-check before full coherence analysis
 * 8. RISK AWARENESS — Does the reasoning acknowledge relevant risks?
 */

import type { MarketData, TradingDecision } from "../agents/base-agent.ts";
import type { AgentTradeConfig } from "./coherence-analyzer.ts";
import { clamp, round3, splitSentences, weightedSum, weightedSumByKey, countByCondition, computeVariance } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ValidationResult {
  /** Whether the trade passes minimum benchmark quality */
  valid: boolean;
  /** Overall quality score 0-1 */
  qualityScore: number;
  /** Grade letter */
  grade: string;
  /** Individual dimension scores */
  dimensions: ValidationDimension[];
  /** Issues found (warnings + errors) */
  issues: ValidationIssue[];
  /** Suggestions for improvement */
  suggestions: string[];
  /** Timestamp of validation */
  validatedAt: string;
}

export interface ValidationDimension {
  name: string;
  score: number;
  weight: number;
  passed: boolean;
  detail: string;
}

export interface ValidationIssue {
  severity: "error" | "warning" | "info";
  dimension: string;
  message: string;
  /** Specific text that triggered the issue */
  evidence?: string;
}

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Dimension Weights — Control how each validation dimension contributes to overall quality score.
 * Sum must equal 1.0 for proper weighted averaging.
 */
const DIMENSION_WEIGHT_STRUCTURAL = 0.15; // 15% - All required fields present
const DIMENSION_WEIGHT_REASONING_DEPTH = 0.20; // 20% - Substantive multi-factor analysis
const DIMENSION_WEIGHT_SOURCE_VERIFICATION = 0.10; // 10% - Sources are plausible and specific
const DIMENSION_WEIGHT_PRICE_GROUNDING = 0.15; // 15% - Price references match market data
const DIMENSION_WEIGHT_TEMPORAL_CONSISTENCY = 0.10; // 10% - Reasoning references current conditions
const DIMENSION_WEIGHT_CONFIDENCE_CALIBRATION = 0.10; // 10% - Confidence within historical norms
const DIMENSION_WEIGHT_ACTION_ALIGNMENT = 0.15; // 15% - Reasoning supports chosen action
const DIMENSION_WEIGHT_RISK_AWARENESS = 0.05; // 5% - Reasoning acknowledges relevant risks

/**
 * Grade Boundaries — Map composite scores to letter grades.
 * These thresholds match academic grading standards (A+ = exceptional, F = failing).
 */
const GRADE_THRESHOLD_A_PLUS = 0.95; // 95%+ = Nearly perfect benchmark quality
const GRADE_THRESHOLD_A = 0.90; // 90-95% = Excellent, exemplary trade reasoning
const GRADE_THRESHOLD_A_MINUS = 0.85; // 85-90% = Very good, above-average quality
const GRADE_THRESHOLD_B_PLUS = 0.80; // 80-85% = Good, solid benchmark entry
const GRADE_THRESHOLD_B = 0.75; // 75-80% = Above average, meets standards well
const GRADE_THRESHOLD_B_MINUS = 0.70; // 70-75% = Slightly above average
const GRADE_THRESHOLD_C_PLUS = 0.65; // 65-70% = Average benchmark quality
const GRADE_THRESHOLD_C = 0.60; // 60-65% = Below average but acceptable
const GRADE_THRESHOLD_C_MINUS = 0.55; // 55-60% = Poor but not failing
const GRADE_THRESHOLD_D_PLUS = 0.50; // 50-55% = Weak, marginal pass
const GRADE_THRESHOLD_D = 0.45; // 45-50% = Very poor quality
const GRADE_THRESHOLD_D_MINUS = 0.40; // 40-45% = Barely passing threshold

/**
 * Dimension Pass/Fail Thresholds — Minimum scores required for each dimension to pass.
 * Dimensions weighted >= 0.15 can be blocking failures if they fall below these thresholds.
 */
const PASS_THRESHOLD_STRUCTURAL = 0.5; // Must have most required fields
const PASS_THRESHOLD_REASONING_DEPTH = 0.3; // Must show some analytical depth
const PASS_THRESHOLD_SOURCE_VERIFICATION = 0.3; // Must cite some data sources
const PASS_THRESHOLD_PRICE_GROUNDING = 0.4; // Price claims must be reasonably accurate
const PASS_THRESHOLD_TEMPORAL_CONSISTENCY = 0.3; // Must reference current conditions
const PASS_THRESHOLD_CONFIDENCE_CALIBRATION = 0.3; // Confidence must be reasonable
const PASS_THRESHOLD_ACTION_ALIGNMENT = 0.3; // Reasoning must somewhat support action

/**
 * Detail Classification Thresholds — When to show "excellent" vs "adequate" vs "poor" detail strings.
 */
const DETAIL_EXCELLENT_STRUCTURAL = 0.8; // 80%+ structural score = "All required fields present"
const DETAIL_EXCELLENT_DEPTH = 0.7; // 70%+ depth = "Substantive multi-factor reasoning"
const DETAIL_ADEQUATE_DEPTH = 0.4; // 40-70% = "Adequate but shallow reasoning"
const DETAIL_EXCELLENT_SOURCE = 0.7; // 70%+ source score = "Sources are plausible and specific"
const DETAIL_EXCELLENT_PRICE = 0.7; // 70%+ price score = "Price references match market data"
const DETAIL_EXCELLENT_TEMPORAL = 0.7; // 70%+ temporal = "Reasoning references current conditions"
const DETAIL_EXCELLENT_CALIBRATION = 0.7; // 70%+ calibration = "Confidence is within historical norms"
const DETAIL_EXCELLENT_ALIGNMENT = 0.7; // 70%+ alignment = "Reasoning supports the chosen action"
const DETAIL_EXCELLENT_RISK = 0.5; // 50%+ risk awareness = "Reasoning acknowledges relevant risks"

/**
 * Composite Score Threshold — Overall quality score required for validation to pass.
 * Trade must score >= 0.25 AND have no blocking dimension failures to be valid.
 */
const COMPOSITE_PASS_THRESHOLD = 0.25; // 25% minimum overall quality for benchmark inclusion

/**
 * Blocking Failure Threshold — Dimension weight threshold for blocking failures.
 * Dimensions with weight >= 0.15 can cause validation failure if they don't pass.
 */
const BLOCKING_DIMENSION_WEIGHT_THRESHOLD = 0.15; // 15%+ weight dimensions are critical

/**
 * Structural Validation Penalties — Points deducted for missing/invalid structural fields.
 */
const PENALTY_MISSING_ACTION = 0.4; // Critical field — 40% penalty
const PENALTY_MISSING_SYMBOL = 0.3; // Critical field — 30% penalty
const PENALTY_MISSING_REASONING = 0.3; // Critical field — 30% penalty
const PENALTY_INVALID_CONFIDENCE = 0.1; // Warning — 10% penalty
const PENALTY_INVALID_QUANTITY = 0.1; // Warning — 10% penalty
const PENALTY_MISSING_TIMESTAMP = 0.05; // Info — 5% penalty

/**
 * Reasoning Depth Scoring Parameters — Thresholds for word count, sentence count, and analytical dimensions.
 */
const DEPTH_WORD_COUNT_EXCELLENT = 100; // 100+ words = 0.30 score bonus
const DEPTH_WORD_COUNT_GREAT = 50; // 50-100 words = 0.25 score bonus
const DEPTH_WORD_COUNT_GOOD = 20; // 20-50 words = 0.15 score bonus
const DEPTH_WORD_COUNT_BONUS_EXCELLENT = 0.30; // Bonus for 100+ words
const DEPTH_WORD_COUNT_BONUS_GREAT = 0.25; // Bonus for 50-100 words
const DEPTH_WORD_COUNT_BONUS_GOOD = 0.15; // Bonus for 20-50 words

const DEPTH_SENTENCE_COUNT_EXCELLENT = 5; // 5+ sentences = 0.20 bonus
const DEPTH_SENTENCE_COUNT_GREAT = 3; // 3-5 sentences = 0.15 bonus
const DEPTH_SENTENCE_COUNT_GOOD = 2; // 2-3 sentences = 0.10 bonus
const DEPTH_SENTENCE_BONUS_EXCELLENT = 0.20; // Bonus for 5+ sentences
const DEPTH_SENTENCE_BONUS_GREAT = 0.15; // Bonus for 3-5 sentences
const DEPTH_SENTENCE_BONUS_GOOD = 0.10; // Bonus for 2-3 sentences

const DEPTH_DIMENSION_BONUS_PER_ANGLE = 0.06; // 6% bonus per analytical dimension found
const DEPTH_DIMENSION_BONUS_MAX = 0.30; // Cap at 30% (5+ dimensions)
const DEPTH_DIMENSION_MIN_FOR_QUALITY = 2; // Suggest improvement if < 2 dimensions

const DEPTH_QUANT_CLAIMS_EXCELLENT = 3; // 3+ numbers/percentages = 0.15 bonus
const DEPTH_QUANT_CLAIMS_GOOD = 1; // 1-3 claims = 0.08 bonus
const DEPTH_QUANT_BONUS_EXCELLENT = 0.15; // Bonus for 3+ quantitative claims
const DEPTH_QUANT_BONUS_GOOD = 0.08; // Bonus for 1-3 quantitative claims

const DEPTH_CAUSAL_CONNECTORS_THRESHOLD = 2; // 2+ causal connectors = 0.05 bonus
const DEPTH_CAUSAL_BONUS = 0.05; // Bonus for logical causality

/**
 * Source Verification Scoring Parameters — Baseline scores and bonuses for source quality.
 */
const SOURCE_BASE_SCORE = 0.4; // Base score for having ANY sources cited
const SOURCE_MINIMAL_SCORE = 0.2; // Minimal score when no sources cited but reasoning may reference data
const SOURCE_RECOGNITION_BONUS_MAX = 0.3; // Max 30% bonus for recognized source patterns
const SOURCE_MULTIPLE_BONUS_MANY = 0.2; // 20% bonus for 3+ distinct sources
const SOURCE_MULTIPLE_BONUS_SOME = 0.1; // 10% bonus for 2 distinct sources
const SOURCE_MULTIPLE_THRESHOLD_MANY = 3; // 3+ sources = "many"
const SOURCE_MULTIPLE_THRESHOLD_SOME = 2; // 2+ sources = "some"
const SOURCE_FABRICATION_LENGTH_THRESHOLD = 60; // Flag source names > 60 chars as suspicious

/**
 * Price Grounding Scoring Parameters — Accuracy thresholds for price claim validation.
 */
const PRICE_BASE_SCORE = 0.7; // Start with good score, deduct for errors
const PRICE_NO_MARKET_DATA_SCORE = 0.6; // Benefit of doubt when no market data available
const PRICE_NO_CLAIMS_SCORE = 0.6; // Neutral score when no price claims made
const PRICE_DEVIATION_ACCURATE = 0.05; // ±5% deviation = fully accurate
const PRICE_DEVIATION_ACCEPTABLE = 0.20; // ±20% deviation = partially accurate (0.5 credit)
const PRICE_INACCURATE_PENALTY = 0.15; // 15% penalty per inaccurate price claim
const PRICE_ACCURACY_BONUS_THRESHOLD = 0.8; // 80%+ accurate claims = +0.2 bonus
const PRICE_ACCURACY_BONUS = 0.20; // 20% bonus for mostly accurate price claims

/**
 * Temporal Consistency Scoring Parameters — Weights for different temporal reference types.
 */
const TEMPORAL_BASE_SCORE = 0.5; // Neutral starting score
const TEMPORAL_CURRENT_WEIGHT = 0.15; // "currently", "right now", "today"
const TEMPORAL_RECENT_WEIGHT = 0.10; // "recently", "last week", "last month"
const TEMPORAL_24H_WEIGHT = 0.10; // "24h", "24-hour", "intraday"
const TEMPORAL_TRENDING_WEIGHT = 0.05; // "trending", "moving", "shifting"
const TEMPORAL_SINCE_WEIGHT = 0.10; // "since yesterday", "since last"
const TEMPORAL_NO_NUMBERS_PENALTY = 0.10; // 10% penalty if reasoning contains no numbers

/**
 * Confidence Calibration Scoring Parameters — Z-score thresholds and anomaly detection.
 */
const CALIBRATION_BASE_SCORE = 0.7; // Default good score for confidence calibration
const CALIBRATION_MIN_HISTORY = 10; // Need 10+ trades for meaningful calibration analysis
const CALIBRATION_Z_SCORE_EXTREME = 3; // 3+ std devs = extreme anomaly (-0.3 penalty)
const CALIBRATION_Z_SCORE_NOTABLE = 2; // 2+ std devs = notable anomaly (-0.1 penalty)
const CALIBRATION_Z_EXTREME_PENALTY = 0.30; // 30% penalty for extreme z-score
const CALIBRATION_Z_NOTABLE_PENALTY = 0.10; // 10% penalty for notable z-score
const CALIBRATION_HIGH_CONF_HOLD_THRESHOLD = 0.9; // 90%+ confidence on hold = suspicious
const CALIBRATION_HIGH_CONF_HOLD_PENALTY = 0.10; // 10% penalty for very high confidence on hold
const CALIBRATION_LOW_CONF_TRADE_THRESHOLD = 0.2; // <20% confidence on trade = suspicious
const CALIBRATION_LOW_CONF_TRADE_PENALTY = 0.20; // 20% penalty for very low confidence trade

/**
 * Action-Reasoning Alignment Scoring — Sentiment word counts and alignment thresholds.
 */
const ALIGNMENT_BASE_SCORE = 0.5; // Neutral starting score
const ALIGNMENT_STRONG_MATCH_SCORE = 0.85; // Reasoning strongly supports action
const ALIGNMENT_WEAK_MATCH_SCORE = 0.5; // Mixed signals, some support
const ALIGNMENT_CONTRARIAN_SCORE = 0.7; // Valid contrarian reasoning (oversold bounce, etc.)
const ALIGNMENT_MISMATCH_SCORE = 0.25; // Reasoning contradicts action
const ALIGNMENT_PROFIT_TAKING_SCORE = 0.7; // Valid profit-taking reasoning for selling on bullish signals
const ALIGNMENT_RISK_MGMT_SCORE = 0.75; // Valid risk management reasoning for holding on strong signals
const ALIGNMENT_HOLD_NEUTRAL_SCORE = 0.8; // Hold with low directional signals = good alignment
const ALIGNMENT_HOLD_STRONG_SIGNALS_SCORE = 0.45; // Hold with strong directional signals = questionable

/**
 * Risk Awareness Scoring Parameters — Risk mention counts for buy/sell vs hold actions.
 */
const RISK_BASE_SCORE_HOLD = 0.5; // Hold actions don't need much risk discussion
const RISK_MENTION_WEIGHT_HOLD = 0.15; // 15% bonus per risk mention for hold
const RISK_NO_MENTION_SCORE = 0.2; // 20% score if no risk factors mentioned (for buy/sell)
const RISK_EXCELLENT_THRESHOLD = 3; // 3+ risk mentions = 1.0 score
const RISK_GOOD_THRESHOLD = 2; // 2 risk mentions = 0.8 score
const RISK_ADEQUATE_SCORE = 0.5; // 1 risk mention = 0.5 score

/**
 * Memory and Display Limits — Control history retention and suggestion counts.
 */
const MAX_CONFIDENCE_HISTORY = 100; // Max confidence records per agent for calibration
const MIN_CONFIDENCE_HISTORY_FOR_STATS = 5; // Min records before computing stats
const SUGGESTIONS_DISPLAY_LIMIT = 5; // Max suggestions shown in validation result
const COMMON_ISSUES_DISPLAY_LIMIT = 10; // Max common issues in dataset quality report
const STRUCTURAL_MIN_REASONING_LENGTH = 10; // Min characters for reasoning field to be considered non-empty

// ---------------------------------------------------------------------------
// Per-agent calibration history (in-memory sliding window)
// ---------------------------------------------------------------------------

const agentConfidenceHistory = new Map<string, number[]>();

export function recordConfidenceForCalibration(agentId: string, confidence: number): void {
  const history = agentConfidenceHistory.get(agentId) ?? [];
  history.push(confidence);
  if (history.length > MAX_CONFIDENCE_HISTORY) {
    history.shift();
  }
  agentConfidenceHistory.set(agentId, history);
}

function getConfidenceStats(agentId: string): { mean: number; stdDev: number; count: number } {
  const history = agentConfidenceHistory.get(agentId) ?? [];
  if (history.length < MIN_CONFIDENCE_HISTORY_FOR_STATS) {
    return { mean: 0.5, stdDev: 0.2, count: history.length };
  }
  const mean = history.reduce((s, v) => s + v, 0) / history.length;
  const variance = computeVariance(history, true);
  return { mean, stdDev: Math.sqrt(variance), count: history.length };
}

// ---------------------------------------------------------------------------
// Known finance terms for source verification
// ---------------------------------------------------------------------------

const VALID_SOURCE_PATTERNS = [
  "market_price_feed", "jupiter_price_api", "24h_price_change",
  "trading_volume", "portfolio_state", "news_feed",
  "technical_indicators", "fundamentals", "market_sentiment",
  "sector_analysis", "market_data", "earnings_data",
  "analyst_consensus", "options_flow", "insider_trading",
  "macro_indicators", "fed_policy", "correlation_analysis",
];

// ---------------------------------------------------------------------------
// Risk-related vocabulary
// ---------------------------------------------------------------------------

const RISK_VOCABULARY: RegExp[] = [
  /\brisk\b/i,
  /\bdownside\b/i,
  /\bvolatil/i,
  /\bdrawdown\b/i,
  /\bstop[- ]?loss\b/i,
  /\bhedg/i,
  /\bexposure\b/i,
  /\bloss\b/i,
  /\bworst[- ]?case\b/i,
  /\bprotect/i,
  /\buncertain/i,
  /\bcaution/i,
  /\bconcern/i,
  /\bdefensive/i,
];

// ---------------------------------------------------------------------------
// Core Validation Engine
// ---------------------------------------------------------------------------

/**
 * Validate a trade decision against all 8 benchmark quality dimensions.
 * Returns a comprehensive ValidationResult with scores, issues, and suggestions.
 */
export function validateForBenchmark(
  decision: TradingDecision,
  agentId: string,
  marketData: MarketData[],
  agentConfig?: AgentTradeConfig,
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const suggestions: string[] = [];
  const dimensions: ValidationDimension[] = [];

  // Normalize confidence to 0-1
  const confidence01 = decision.confidence > 1 ? decision.confidence / 100 : decision.confidence;

  // --- Dimension 1: Structural Validity ---
  const structuralScore = validateStructure(decision, issues);
  dimensions.push({
    name: "structural_validity",
    score: structuralScore,
    weight: DIMENSION_WEIGHT_STRUCTURAL,
    passed: structuralScore >= PASS_THRESHOLD_STRUCTURAL,
    detail: structuralScore >= DETAIL_EXCELLENT_STRUCTURAL ? "All required fields present" : "Missing or invalid fields detected",
  });

  // --- Dimension 2: Reasoning Depth ---
  const depthScore = validateReasoningDepth(decision.reasoning, issues, suggestions);
  dimensions.push({
    name: "reasoning_depth",
    score: depthScore,
    weight: DIMENSION_WEIGHT_REASONING_DEPTH,
    passed: depthScore >= PASS_THRESHOLD_REASONING_DEPTH,
    detail: depthScore >= DETAIL_EXCELLENT_DEPTH ? "Substantive multi-factor reasoning" : depthScore >= DETAIL_ADEQUATE_DEPTH ? "Adequate but shallow reasoning" : "Insufficient reasoning depth",
  });

  // --- Dimension 3: Source Verification ---
  const sourceScore = validateSources(decision, issues, suggestions);
  dimensions.push({
    name: "source_verification",
    score: sourceScore,
    weight: DIMENSION_WEIGHT_SOURCE_VERIFICATION,
    passed: sourceScore >= PASS_THRESHOLD_SOURCE_VERIFICATION,
    detail: sourceScore >= DETAIL_EXCELLENT_SOURCE ? "Sources are plausible and specific" : "Source claims need improvement",
  });

  // --- Dimension 4: Price Grounding ---
  const priceScore = validatePriceGrounding(decision.reasoning, marketData, issues);
  dimensions.push({
    name: "price_grounding",
    score: priceScore,
    weight: DIMENSION_WEIGHT_PRICE_GROUNDING,
    passed: priceScore >= PASS_THRESHOLD_PRICE_GROUNDING,
    detail: priceScore >= DETAIL_EXCELLENT_PRICE ? "Price references match market data" : "Price claims may be inaccurate",
  });

  // --- Dimension 5: Temporal Consistency ---
  const temporalScore = validateTemporalConsistency(decision.reasoning, issues);
  dimensions.push({
    name: "temporal_consistency",
    score: temporalScore,
    weight: DIMENSION_WEIGHT_TEMPORAL_CONSISTENCY,
    passed: temporalScore >= PASS_THRESHOLD_TEMPORAL_CONSISTENCY,
    detail: temporalScore >= DETAIL_EXCELLENT_TEMPORAL ? "Reasoning references current conditions" : "Temporal context could be stronger",
  });

  // --- Dimension 6: Confidence Calibration ---
  const calibrationScore = validateConfidenceCalibration(agentId, confidence01, decision, issues, suggestions);
  dimensions.push({
    name: "confidence_calibration",
    score: calibrationScore,
    weight: DIMENSION_WEIGHT_CONFIDENCE_CALIBRATION,
    passed: calibrationScore >= PASS_THRESHOLD_CONFIDENCE_CALIBRATION,
    detail: calibrationScore >= DETAIL_EXCELLENT_CALIBRATION ? "Confidence is within historical norms" : "Confidence may be miscalibrated",
  });

  // --- Dimension 7: Action-Reasoning Alignment ---
  const alignmentScore = validateActionAlignment(decision, issues);
  dimensions.push({
    name: "action_reasoning_alignment",
    score: alignmentScore,
    weight: DIMENSION_WEIGHT_ACTION_ALIGNMENT,
    passed: alignmentScore >= PASS_THRESHOLD_ACTION_ALIGNMENT,
    detail: alignmentScore >= DETAIL_EXCELLENT_ALIGNMENT ? "Reasoning supports the chosen action" : "Possible misalignment between reasoning and action",
  });

  // --- Dimension 8: Risk Awareness ---
  const riskScore = validateRiskAwareness(decision.reasoning, decision.action, issues, suggestions);
  dimensions.push({
    name: "risk_awareness",
    score: riskScore,
    weight: DIMENSION_WEIGHT_RISK_AWARENESS,
    passed: true, // Risk awareness is never a blocking failure
    detail: riskScore >= DETAIL_EXCELLENT_RISK ? "Reasoning acknowledges relevant risks" : "Limited risk awareness in reasoning",
  });

  // --- Compute composite score ---
  const qualityScore = weightedSumByKey(dimensions, 'score', 'weight');
  const roundedScore = round3(qualityScore);

  // Grade assignment
  const grade = assignGrade(roundedScore);

  // Valid if no dimension has a critical failure AND composite is above threshold
  const hasBlockingFailure = dimensions.some((d) => !d.passed && d.weight >= BLOCKING_DIMENSION_WEIGHT_THRESHOLD);
  const valid = !hasBlockingFailure && roundedScore >= COMPOSITE_PASS_THRESHOLD;

  // Record confidence for future calibration checks
  recordConfidenceForCalibration(agentId, confidence01);

  return {
    valid,
    qualityScore: roundedScore,
    grade,
    dimensions,
    issues,
    suggestions: suggestions.slice(0, SUGGESTIONS_DISPLAY_LIMIT),
    validatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Dimension Validators
// ---------------------------------------------------------------------------

function validateStructure(decision: TradingDecision, issues: ValidationIssue[]): number {
  let score = 1.0;

  if (!decision.action || !["buy", "sell", "hold"].includes(decision.action)) {
    issues.push({ severity: "error", dimension: "structural_validity", message: "Missing or invalid action field" });
    score -= PENALTY_MISSING_ACTION;
  }

  if (!decision.symbol || decision.symbol.length === 0) {
    issues.push({ severity: "error", dimension: "structural_validity", message: "Missing symbol field" });
    score -= PENALTY_MISSING_SYMBOL;
  }

  if (!decision.reasoning || decision.reasoning.length < STRUCTURAL_MIN_REASONING_LENGTH) {
    issues.push({ severity: "error", dimension: "structural_validity", message: "Missing or too-short reasoning" });
    score -= PENALTY_MISSING_REASONING;
  }

  if (typeof decision.confidence !== "number") {
    issues.push({ severity: "warning", dimension: "structural_validity", message: "Confidence is not a number" });
    score -= PENALTY_INVALID_CONFIDENCE;
  }

  if (decision.action !== "hold" && (typeof decision.quantity !== "number" || decision.quantity <= 0)) {
    issues.push({ severity: "warning", dimension: "structural_validity", message: "Non-hold action with invalid quantity" });
    score -= PENALTY_INVALID_QUANTITY;
  }

  if (!decision.timestamp) {
    issues.push({ severity: "info", dimension: "structural_validity", message: "Missing timestamp" });
    score -= PENALTY_MISSING_TIMESTAMP;
  }

  return Math.max(0, score);
}

function validateReasoningDepth(reasoning: string, issues: ValidationIssue[], suggestions: string[]): number {
  const words = reasoning.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const sentences = splitSentences(reasoning);
  const sentenceCount = sentences.length;

  let score = 0;

  // Word count scoring
  if (wordCount >= DEPTH_WORD_COUNT_EXCELLENT) score += DEPTH_WORD_COUNT_BONUS_EXCELLENT;
  else if (wordCount >= DEPTH_WORD_COUNT_GREAT) score += DEPTH_WORD_COUNT_BONUS_GREAT;
  else if (wordCount >= DEPTH_WORD_COUNT_GOOD) score += DEPTH_WORD_COUNT_BONUS_GOOD;
  else {
    issues.push({ severity: "warning", dimension: "reasoning_depth", message: `Reasoning is only ${wordCount} words — substantive analysis needs ${DEPTH_WORD_COUNT_GREAT}+ words` });
    suggestions.push("Expand reasoning to include multiple analytical angles (price action, fundamentals, portfolio context)");
  }

  // Multi-sentence reasoning
  if (sentenceCount >= DEPTH_SENTENCE_COUNT_EXCELLENT) score += DEPTH_SENTENCE_BONUS_EXCELLENT;
  else if (sentenceCount >= DEPTH_SENTENCE_COUNT_GREAT) score += DEPTH_SENTENCE_BONUS_GREAT;
  else if (sentenceCount >= DEPTH_SENTENCE_COUNT_GOOD) score += DEPTH_SENTENCE_BONUS_GOOD;

  // Check for analytical dimensions
  const dimensions = [
    { pattern: /price|valuation|\$\d|\bP\/E\b/i, name: "price_analysis" },
    { pattern: /volume|liquidity|traded/i, name: "volume_analysis" },
    { pattern: /trend|momentum|moving\s+average|breakout/i, name: "technical_analysis" },
    { pattern: /fundamental|earnings|revenue|growth|margin/i, name: "fundamental_analysis" },
    { pattern: /portfolio|position|allocation|exposure/i, name: "portfolio_context" },
    { pattern: /risk|downside|protect|volatile/i, name: "risk_consideration" },
    { pattern: /sector|industry|market|macro|economy/i, name: "macro_context" },
    { pattern: /news|event|catalyst|announcement/i, name: "catalyst_awareness" },
  ];

  const dimensionsPresent = countByCondition(dimensions, (d) => d.pattern.test(reasoning));
  score += Math.min(DEPTH_DIMENSION_BONUS_MAX, dimensionsPresent * DEPTH_DIMENSION_BONUS_PER_ANGLE);

  if (dimensionsPresent < DEPTH_DIMENSION_MIN_FOR_QUALITY) {
    suggestions.push("Include multiple analytical angles: price analysis, fundamentals, portfolio context, risk assessment");
  }

  // Check for quantitative claims (numbers, percentages)
  const quantClaims = (reasoning.match(/\d+\.?\d*%|\$\d+\.?\d*|\d+\.\d+/g) ?? []).length;
  if (quantClaims >= DEPTH_QUANT_CLAIMS_EXCELLENT) score += DEPTH_QUANT_BONUS_EXCELLENT;
  else if (quantClaims >= DEPTH_QUANT_CLAIMS_GOOD) score += DEPTH_QUANT_BONUS_GOOD;
  else {
    suggestions.push("Include specific numbers and percentages to ground your reasoning in data");
  }

  // Causal connectors (because, therefore, due to, since, as a result)
  const causalConnectors = (reasoning.match(/\bbecause\b|\btherefore\b|\bdue\s+to\b|\bsince\b|\bas\s+a\s+result\b|\bconsequently\b|\bhence\b|\bthus\b/gi) ?? []).length;
  if (causalConnectors >= DEPTH_CAUSAL_CONNECTORS_THRESHOLD) score += DEPTH_CAUSAL_BONUS;

  return Math.min(1, score);
}

function validateSources(decision: TradingDecision, issues: ValidationIssue[], suggestions: string[]): number {
  const sources = decision.sources ?? [];

  if (sources.length === 0) {
    issues.push({ severity: "warning", dimension: "source_verification", message: "No data sources cited" });
    suggestions.push("Cite specific data sources used in analysis (e.g., 'market_price_feed', 'news_feed', 'technical_indicators')");
    return SOURCE_MINIMAL_SCORE;
  }

  let score = SOURCE_BASE_SCORE;

  // Check if sources are recognized
  const recognizedCount = sources.filter((s) =>
    VALID_SOURCE_PATTERNS.some((p) => s.toLowerCase().includes(p.toLowerCase()) || p.toLowerCase().includes(s.toLowerCase()))
  ).length;

  score += Math.min(SOURCE_RECOGNITION_BONUS_MAX, (recognizedCount / Math.max(1, sources.length)) * SOURCE_RECOGNITION_BONUS_MAX);

  // Bonus for multiple distinct sources
  if (sources.length >= SOURCE_MULTIPLE_THRESHOLD_MANY) score += SOURCE_MULTIPLE_BONUS_MANY;
  else if (sources.length >= SOURCE_MULTIPLE_THRESHOLD_SOME) score += SOURCE_MULTIPLE_BONUS_SOME;

  // Check for source fabrication (very long or unusual source names)
  for (const src of sources) {
    if (src.length > SOURCE_FABRICATION_LENGTH_THRESHOLD) {
      issues.push({ severity: "info", dimension: "source_verification", message: `Unusually long source name: ${src.slice(0, 40)}...` });
    }
  }

  return Math.min(1, score);
}

function validatePriceGrounding(reasoning: string, marketData: MarketData[], issues: ValidationIssue[]): number {
  // Build price lookup
  const realPrices = new Map<string, number>();
  for (const d of marketData) {
    realPrices.set(d.symbol.toLowerCase(), d.price);
    realPrices.set(d.symbol.replace(/x$/i, "").toLowerCase(), d.price);
  }

  // If no market data, give benefit of the doubt
  if (marketData.length === 0) return PRICE_NO_MARKET_DATA_SCORE;

  let score = PRICE_BASE_SCORE;

  // Check price claims
  const pricePattern = /(\w+x?)\s+(?:is\s+)?(?:at|priced?\s+at|trading\s+at|currently)\s+\$?([\d,]+\.?\d*)/gi;
  let match;
  let claimCount = 0;
  let accurateCount = 0;

  while ((match = pricePattern.exec(reasoning)) !== null) {
    const symbol = match[1].toLowerCase();
    const claimed = parseFloat(match[2].replace(/,/g, ""));
    const real = realPrices.get(symbol);

    claimCount++;
    if (real !== undefined && claimed > 0) {
      const deviation = Math.abs(claimed - real) / real;
      if (deviation <= PRICE_DEVIATION_ACCURATE) {
        accurateCount++;
      } else if (deviation <= PRICE_DEVIATION_ACCEPTABLE) {
        accurateCount += 0.5;
      } else {
        issues.push({
          severity: "warning",
          dimension: "price_grounding",
          message: `Price claim for ${symbol.toUpperCase()} ($${claimed.toFixed(2)}) deviates ${(deviation * 100).toFixed(0)}% from actual ($${real.toFixed(2)})`,
          evidence: match[0],
        });
        score -= PRICE_INACCURATE_PENALTY;
      }
    }
  }

  // Bonus for making accurate price claims
  if (claimCount > 0 && accurateCount / claimCount >= PRICE_ACCURACY_BONUS_THRESHOLD) {
    score += PRICE_ACCURACY_BONUS;
  }

  // If reasoning mentions specific prices without errors, that's good
  if (claimCount === 0) {
    score = PRICE_NO_CLAIMS_SCORE;
  }

  return clamp(score, 0, 1);
}

function validateTemporalConsistency(reasoning: string, issues: ValidationIssue[]): number {
  let score = TEMPORAL_BASE_SCORE;

  // Check for temporal references
  const temporalPatterns = [
    { pattern: /\bcurrent(ly)?\b|\bright\s+now\b|\btoday\b/i, weight: TEMPORAL_CURRENT_WEIGHT },
    { pattern: /\brecent(ly)?\b|\blast\s+(week|month|day|session)\b/i, weight: TEMPORAL_RECENT_WEIGHT },
    { pattern: /\b24h\b|\b24-?hour\b|\bintraday\b/i, weight: TEMPORAL_24H_WEIGHT },
    { pattern: /\btrending\b|\bmoving\b|\bshifting\b/i, weight: TEMPORAL_TRENDING_WEIGHT },
    { pattern: /\bsince\s+(yesterday|last|the)\b/i, weight: TEMPORAL_SINCE_WEIGHT },
  ];

  for (const { pattern, weight } of temporalPatterns) {
    if (pattern.test(reasoning)) {
      score += weight;
    }
  }

  // Red flag: reasoning that sounds generic / not grounded in current conditions
  if (!/\d/.test(reasoning)) {
    issues.push({ severity: "info", dimension: "temporal_consistency", message: "Reasoning contains no numbers — may not be grounded in current data" });
    score -= TEMPORAL_NO_NUMBERS_PENALTY;
  }

  return clamp(score, 0, 1);
}

function validateConfidenceCalibration(
  agentId: string,
  confidence: number,
  decision: TradingDecision,
  issues: ValidationIssue[],
  suggestions: string[],
): number {
  const stats = getConfidenceStats(agentId);
  let score = CALIBRATION_BASE_SCORE;

  // If we have enough history, check for anomalies
  if (stats.count >= CALIBRATION_MIN_HISTORY) {
    const zScore = Math.abs(confidence - stats.mean) / Math.max(0.01, stats.stdDev);

    if (zScore > CALIBRATION_Z_SCORE_EXTREME) {
      issues.push({
        severity: "warning",
        dimension: "confidence_calibration",
        message: `Confidence ${(confidence * 100).toFixed(0)}% is ${zScore.toFixed(1)} standard deviations from agent's mean of ${(stats.mean * 100).toFixed(0)}%`,
      });
      score -= CALIBRATION_Z_EXTREME_PENALTY;
    } else if (zScore > CALIBRATION_Z_SCORE_NOTABLE) {
      issues.push({
        severity: "info",
        dimension: "confidence_calibration",
        message: `Confidence is notably different from agent's historical average`,
      });
      score -= CALIBRATION_Z_NOTABLE_PENALTY;
    }
  }

  // Very high confidence on hold actions is suspicious
  if (decision.action === "hold" && confidence > CALIBRATION_HIGH_CONF_HOLD_THRESHOLD) {
    issues.push({
      severity: "info",
      dimension: "confidence_calibration",
      message: "Very high confidence (>90%) on a hold action — consider why confidence is so high if no trade is being made",
    });
    score -= CALIBRATION_HIGH_CONF_HOLD_PENALTY;
  }

  // Very low confidence on aggressive actions
  if (decision.action !== "hold" && confidence < CALIBRATION_LOW_CONF_TRADE_THRESHOLD) {
    issues.push({
      severity: "warning",
      dimension: "confidence_calibration",
      message: "Trading with very low confidence (<20%) — consider whether this trade should be a hold instead",
    });
    suggestions.push("Low-confidence trades should include strong reasoning for why the trade is being taken despite uncertainty");
    score -= CALIBRATION_LOW_CONF_TRADE_PENALTY;
  }

  return clamp(score, 0, 1);
}

function validateActionAlignment(decision: TradingDecision, issues: ValidationIssue[]): number {
  const reasoning = decision.reasoning.toLowerCase();
  let score = 0.5; // Neutral start

  // Quick sentiment check
  const bullishWords = (reasoning.match(/\bbullish\b|\bupside\b|\bgrowth\b|\bundervalued\b|\bbreakout\b|\brally\b|\baccumulate\b|\boptimistic\b/g) ?? []).length;
  const bearishWords = (reasoning.match(/\bbearish\b|\bdownside\b|\bovervalued\b|\bbreakdown\b|\bcorrection\b|\bpessimistic\b|\bdeclining\b|\bweakness\b/g) ?? []).length;
  const holdWords = (reasoning.match(/\buncertain\b|\bwait\b|\bcaution\b|\bsideline\b|\bmixed\b|\binsufficient\b|\bpatien/g) ?? []).length;

  if (decision.action === "buy") {
    if (bullishWords > bearishWords) score = 0.85;
    else if (bullishWords === bearishWords && bullishWords > 0) score = 0.5;
    else if (bearishWords > bullishWords + 1) {
      // Check for contrarian/mean_reversion justification
      if (/contrarian|reversion|oversold|bounce|discount/i.test(reasoning)) {
        score = 0.7;
      } else {
        issues.push({ severity: "warning", dimension: "action_reasoning_alignment", message: "Bearish reasoning but choosing to buy" });
        score = 0.25;
      }
    }
  } else if (decision.action === "sell") {
    if (bearishWords > bullishWords) score = 0.85;
    else if (bearishWords === bullishWords && bearishWords > 0) score = 0.5;
    else if (bullishWords > bearishWords + 1) {
      if (/profit|take\s+gains|rebalance|trim|overexposed/i.test(reasoning)) {
        score = 0.7;
      } else {
        issues.push({ severity: "warning", dimension: "action_reasoning_alignment", message: "Bullish reasoning but choosing to sell" });
        score = 0.25;
      }
    }
  } else {
    // Hold
    if (holdWords > 0 || (bullishWords <= 1 && bearishWords <= 1)) score = 0.8;
    else if (bullishWords > 2 || bearishWords > 2) {
      if (/guardrail|limit|buffer|risk\s+management/i.test(reasoning)) {
        score = 0.75;
      } else {
        issues.push({ severity: "info", dimension: "action_reasoning_alignment", message: "Strong directional signals but choosing to hold" });
        score = 0.45;
      }
    }
  }

  return score;
}

function validateRiskAwareness(reasoning: string, action: string, issues: ValidationIssue[], suggestions: string[]): number {
  const riskMentions = countByCondition(RISK_VOCABULARY, (p) => p.test(reasoning));

  if (action === "hold") {
    // Hold decisions don't need as much risk discussion
    return Math.min(1, 0.5 + riskMentions * 0.15);
  }

  if (riskMentions === 0) {
    issues.push({ severity: "info", dimension: "risk_awareness", message: "Reasoning does not mention any risk factors" });
    suggestions.push("Include risk awareness in reasoning — what could go wrong with this trade?");
    return 0.2;
  }

  if (riskMentions >= 3) return 1.0;
  if (riskMentions >= 2) return 0.8;
  return 0.5;
}

// ---------------------------------------------------------------------------
// Grade Assignment
// ---------------------------------------------------------------------------

function assignGrade(score: number): string {
  if (score >= GRADE_THRESHOLD_A_PLUS) return "A+";
  if (score >= GRADE_THRESHOLD_A) return "A";
  if (score >= GRADE_THRESHOLD_A_MINUS) return "A-";
  if (score >= GRADE_THRESHOLD_B_PLUS) return "B+";
  if (score >= GRADE_THRESHOLD_B) return "B";
  if (score >= GRADE_THRESHOLD_B_MINUS) return "B-";
  if (score >= GRADE_THRESHOLD_C_PLUS) return "C+";
  if (score >= GRADE_THRESHOLD_C) return "C";
  if (score >= GRADE_THRESHOLD_C_MINUS) return "C-";
  if (score >= GRADE_THRESHOLD_D_PLUS) return "D+";
  if (score >= GRADE_THRESHOLD_D) return "D";
  if (score >= GRADE_THRESHOLD_D_MINUS) return "D-";
  return "F";
}

// ---------------------------------------------------------------------------
// Batch Validation (for dataset-level quality assessment)
// ---------------------------------------------------------------------------

export interface DatasetQualityReport {
  totalTrades: number;
  validTrades: number;
  validationRate: number;
  avgQualityScore: number;
  gradeDistribution: Record<string, number>;
  commonIssues: { message: string; count: number }[];
  dimensionAverages: Record<string, number>;
  timestamp: string;
}

/**
 * Validate an entire batch of trades and produce a dataset quality report.
 * Used by the HuggingFace sync to ensure export quality.
 */
export function validateDatasetBatch(
  decisions: Array<{ decision: TradingDecision; agentId: string }>,
  marketData: MarketData[],
): DatasetQualityReport {
  const results = decisions.map(({ decision, agentId }) =>
    validateForBenchmark(decision, agentId, marketData),
  );

  const validCount = countByCondition(results, (r) => r.valid);
  const avgScore = results.length > 0
    ? results.reduce((s, r) => s + r.qualityScore, 0) / results.length
    : 0;

  // Grade distribution
  const gradeDistribution: Record<string, number> = {};
  for (const r of results) {
    gradeDistribution[r.grade] = (gradeDistribution[r.grade] ?? 0) + 1;
  }

  // Common issues
  const issueCount = new Map<string, number>();
  for (const r of results) {
    for (const issue of r.issues) {
      const key = issue.message;
      issueCount.set(key, (issueCount.get(key) ?? 0) + 1);
    }
  }
  const commonIssues = Array.from(issueCount.entries())
    .map(([message, count]) => ({ message, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, COMMON_ISSUES_DISPLAY_LIMIT);

  // Dimension averages
  const dimensionSums = new Map<string, { sum: number; count: number }>();
  for (const r of results) {
    for (const d of r.dimensions) {
      const existing = dimensionSums.get(d.name) ?? { sum: 0, count: 0 };
      existing.sum += d.score;
      existing.count += 1;
      dimensionSums.set(d.name, existing);
    }
  }
  const dimensionAverages: Record<string, number> = {};
  for (const [name, { sum, count }] of dimensionSums) {
    dimensionAverages[name] = round3(sum / count);
  }

  return {
    totalTrades: decisions.length,
    validTrades: validCount,
    validationRate: decisions.length > 0 ? round3(validCount / decisions.length) : 0,
    avgQualityScore: round3(avgScore),
    gradeDistribution,
    commonIssues,
    dimensionAverages,
    timestamp: new Date().toISOString(),
  };
}
