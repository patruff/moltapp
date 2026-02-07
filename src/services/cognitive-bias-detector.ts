/**
 * Cognitive Bias Detector (v22)
 *
 * Detects cognitive biases in AI agent trading reasoning. AI agents,
 * trained on human text, inherit human cognitive biases. Detecting these
 * biases is critical for a trustworthy AI benchmark.
 *
 * Biases detected:
 *
 * 1. ANCHORING BIAS: Over-reliance on a single data point (usually the first
 *    price mentioned). Agent fixates on one number and reasons from it.
 *
 * 2. CONFIRMATION BIAS: Agent only cites evidence that supports its predetermined
 *    conclusion, ignoring contradictory data that was available.
 *
 * 3. RECENCY BIAS: Disproportionate weight on the most recent data point,
 *    ignoring longer-term trends or fundamentals.
 *
 * 4. SUNK COST FALLACY: Holding or adding to a losing position because of
 *    prior investment rather than current merit.
 *
 * 5. OVERCONFIDENCE BIAS: High confidence relative to the strength of evidence.
 *    Agent claims certainty when data is ambiguous.
 *
 * 6. HERDING BIAS: Agent reasoning mirrors what other agents decided rather
 *    than independent analysis. Detected across multi-agent rounds.
 *
 * 7. LOSS AVERSION: Asymmetric treatment of gains vs losses. Agent is
 *    willing to take risks to avoid losses but not for equivalent gains.
 *
 * This is a v22 benchmark pillar: "Cognitive Bias Score" — lower is better.
 * A bias-free agent would score 0.0. Heavy bias scores 1.0.
 */

import type { MarketData } from "../agents/base-agent.ts";
import { countWords, getTopKey, round3 } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Anchoring Bias Detection Thresholds
 */

/** Minimum price reference repetitions to trigger anchoring detection */
const ANCHORING_PRICE_REPETITION_THRESHOLD = 3;

/** Price repetition count that classifies anchoring as high severity */
const ANCHORING_HIGH_SEVERITY_THRESHOLD = 4;

/** Baseline confidence for anchoring detection */
const ANCHORING_BASE_CONFIDENCE = 0.3;

/** Confidence increment per additional price repetition */
const ANCHORING_CONFIDENCE_PER_REPETITION = 0.15;

/** Maximum confidence for anchoring detection */
const ANCHORING_MAX_CONFIDENCE = 0.9;

/** Minimum number of market data symbols for single-symbol anchoring check */
const ANCHORING_MIN_SYMBOLS_FOR_CHECK = 3;

/** Minimum price references when only one symbol is mentioned */
const ANCHORING_MIN_PRICE_REFS_SINGLE_SYMBOL = 2;

/** Confidence for single-symbol anchoring detection */
const ANCHORING_SINGLE_SYMBOL_CONFIDENCE = 0.5;

/**
 * Confirmation Bias Detection Thresholds
 */

/** Minimum positive signals for buy confirmation bias */
const CONFIRMATION_POSITIVE_SIGNALS_THRESHOLD = 3;

/** Zero negative signals required for confirmation bias detection */
const CONFIRMATION_NEGATIVE_SIGNALS_REQUIRED = 0;

/** Market data change threshold for identifying negative stocks (%) */
const CONFIRMATION_NEGATIVE_STOCK_CHANGE_THRESHOLD = -2;

/** Minimum number of negative stocks to trigger confirmation bias */
const CONFIRMATION_MIN_NEGATIVE_STOCKS = 2;

/** Confidence for confirmation bias with ignored negative data */
const CONFIRMATION_IGNORED_DATA_CONFIDENCE = 0.7;

/** Minimum positive signals for strong one-sided confirmation bias */
const CONFIRMATION_STRONG_ONE_SIDED_THRESHOLD = 4;

/** Confidence for strong one-sided confirmation bias */
const CONFIRMATION_ONE_SIDED_CONFIDENCE = 0.6;

/**
 * Recency Bias Detection Thresholds
 */

/** Minimum recency term count to trigger recency bias */
const RECENCY_TERM_COUNT_THRESHOLD = 3;

/** Zero long-term indicators required for recency bias detection */
const RECENCY_LONG_TERM_REQUIRED = 0;

/** Recency term count that classifies bias as high severity */
const RECENCY_HIGH_SEVERITY_THRESHOLD = 4;

/** Base confidence for recency bias detection */
const RECENCY_BASE_CONFIDENCE = 0.4;

/** Confidence increment per additional recency term */
const RECENCY_CONFIDENCE_PER_TERM = 0.15;

/** Maximum confidence for recency bias detection */
const RECENCY_MAX_CONFIDENCE = 0.85;

/**
 * Sunk Cost Fallacy Detection Thresholds
 */

/** Minimum sunk cost pattern matches to trigger detection */
const SUNK_COST_PATTERN_THRESHOLD = 2;

/** Pattern count that classifies sunk cost as high severity */
const SUNK_COST_HIGH_SEVERITY_THRESHOLD = 3;

/** Base confidence for sunk cost detection */
const SUNK_COST_BASE_CONFIDENCE = 0.4;

/** Confidence increment per additional sunk cost pattern */
const SUNK_COST_CONFIDENCE_PER_PATTERN = 0.15;

/** Maximum confidence for sunk cost detection */
const SUNK_COST_MAX_CONFIDENCE = 0.9;

/** Minimum pattern matches for hold/buy on losing position */
const SUNK_COST_LOSING_POSITION_MIN_PATTERNS = 1;

/** Confidence for sunk cost on losing position */
const SUNK_COST_LOSING_POSITION_CONFIDENCE = 0.6;

/**
 * Overconfidence Bias Detection Thresholds
 */

/** Confidence threshold for overconfidence detection */
const OVERCONFIDENCE_CONFIDENCE_THRESHOLD = 0.8;

/** Minimum certainty expression count for overconfidence */
const OVERCONFIDENCE_MIN_CERTAINTY_TERMS = 2;

/** Zero hedging language required for overconfidence detection */
const OVERCONFIDENCE_HEDGING_REQUIRED = 0;

/** Base confidence for overconfidence detection */
const OVERCONFIDENCE_BASE_CONFIDENCE = 0.5;

/** Confidence increment per certainty expression */
const OVERCONFIDENCE_CONFIDENCE_PER_TERM = 0.1;

/** Multiplier for confidence above threshold */
const OVERCONFIDENCE_CONFIDENCE_MULTIPLIER = 2;

/** Maximum confidence for overconfidence detection */
const OVERCONFIDENCE_MAX_CONFIDENCE = 0.9;

/** Very high confidence threshold for severity classification */
const OVERCONFIDENCE_VERY_HIGH_THRESHOLD = 0.9;

/** Very high confidence threshold for short reasoning check */
const OVERCONFIDENCE_SHORT_REASONING_CONFIDENCE = 0.85;

/** Maximum word count for short reasoning overconfidence */
const OVERCONFIDENCE_SHORT_REASONING_WORD_LIMIT = 20;

/** Confidence for short reasoning overconfidence */
const OVERCONFIDENCE_SHORT_REASONING_CONFIDENCE_VALUE = 0.6;

/**
 * Herding Bias Detection Thresholds
 */

/** Minimum explicit herding pattern matches to trigger detection */
const HERDING_EXPLICIT_PATTERN_THRESHOLD = 1;

/** Pattern count that classifies herding as high severity */
const HERDING_HIGH_SEVERITY_THRESHOLD = 2;

/** Base confidence for explicit herding detection */
const HERDING_BASE_CONFIDENCE = 0.5;

/** Confidence increment per additional herding pattern */
const HERDING_CONFIDENCE_PER_PATTERN = 0.15;

/** Maximum confidence for explicit herding detection */
const HERDING_MAX_CONFIDENCE = 0.85;

/** Minimum other agents for implicit herding check */
const HERDING_MIN_AGENTS_FOR_IMPLICIT = 2;

/** Minimum word length for keyword extraction */
const HERDING_MIN_KEYWORD_LENGTH = 4;

/** Keyword overlap threshold for implicit herding (%) */
const HERDING_KEYWORD_OVERLAP_THRESHOLD = 0.6;

/** Confidence for implicit herding detection */
const HERDING_IMPLICIT_CONFIDENCE = 0.5;

/**
 * Loss Aversion Detection Thresholds
 */

/** Minimum loss aversion term count to trigger detection */
const LOSS_AVERSION_TERM_COUNT_THRESHOLD = 3;

/** Maximum gain-seeking term count for loss aversion */
const LOSS_AVERSION_MAX_GAIN_TERMS = 1;

/** Loss term count that classifies as high severity */
const LOSS_AVERSION_HIGH_SEVERITY_THRESHOLD = 4;

/** Base confidence for loss aversion detection */
const LOSS_AVERSION_BASE_CONFIDENCE = 0.4;

/** Confidence increment per loss aversion term */
const LOSS_AVERSION_CONFIDENCE_PER_TERM = 0.12;

/** Maximum confidence for loss aversion detection */
const LOSS_AVERSION_MAX_CONFIDENCE = 0.85;

/** Minimum unrealized P&L % to classify as big loser */
const LOSS_AVERSION_BIG_LOSER_THRESHOLD = -5;

/** Minimum unrealized P&L % to classify as winner */
const LOSS_AVERSION_WINNER_THRESHOLD = 0;

/** Confidence for disposition effect detection */
const LOSS_AVERSION_DISPOSITION_CONFIDENCE = 0.5;

/**
 * Severity Weighting and Normalization
 */

/** Weight multiplier for high severity biases */
const SEVERITY_WEIGHT_HIGH = 1.0;

/** Weight multiplier for medium severity biases */
const SEVERITY_WEIGHT_MEDIUM = 0.6;

/** Weight multiplier for low severity biases */
const SEVERITY_WEIGHT_LOW = 0.3;

/** Expected maximum weighted sum for "very biased" normalization */
const BIAS_SCORE_NORMALIZATION_DIVISOR = 3;

/** Maximum bias score (capped at 1.0) */
const BIAS_SCORE_MAX = 1.0;

/** Bias score threshold for "minor" assessment */
const BIAS_SCORE_MINOR_THRESHOLD = 0.2;

/** Bias score threshold for "moderate" assessment */
const BIAS_SCORE_MODERATE_THRESHOLD = 0.5;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BiasType =
  | "anchoring"
  | "confirmation"
  | "recency"
  | "sunk_cost"
  | "overconfidence"
  | "herding"
  | "loss_aversion";

export interface BiasDetection {
  /** Type of cognitive bias detected */
  type: BiasType;
  /** Confidence in the detection: 0.0 to 1.0 */
  confidence: number;
  /** Evidence for the bias detection */
  evidence: string;
  /** Severity: how much this bias likely affected the decision */
  severity: "low" | "medium" | "high";
  /** Specific text segments that triggered detection */
  triggers: string[];
}

export interface BiasAnalysisResult {
  /** Overall bias score: 0.0 (bias-free) to 1.0 (heavily biased) */
  biasScore: number;
  /** Number of biases detected */
  biasCount: number;
  /** Individual bias detections */
  detections: BiasDetection[];
  /** Summary assessment */
  assessment: string;
  /** Dominant bias (most severe) */
  dominantBias: BiasType | null;
}

export interface RoundAgentContext {
  agentId: string;
  action: string;
  symbol: string;
  reasoning: string;
  confidence: number;
}

// ---------------------------------------------------------------------------
// In-memory stores
// ---------------------------------------------------------------------------

interface BiasRecord {
  tradeId: string;
  agentId: string;
  roundId: string;
  result: BiasAnalysisResult;
  timestamp: string;
}

const biasHistory: BiasRecord[] = [];
const MAX_HISTORY = 500;

const agentBiasStats = new Map<
  string,
  { totalBiases: number; byType: Record<string, number>; checks: number; totalScore: number }
>();

// ---------------------------------------------------------------------------
// Bias Detectors
// ---------------------------------------------------------------------------

/**
 * Detect anchoring bias: over-reliance on a single data point.
 */
function detectAnchoring(reasoning: string, marketData: MarketData[]): BiasDetection | null {
  // Look for patterns where one number dominates the reasoning
  const priceRefs = reasoning.match(/\$[\d,]+\.?\d*/g) ?? [];
  const percentRefs = reasoning.match(/[+-]?\d+\.?\d*%/g) ?? [];

  // Anchoring: same price reference appears 3+ times
  const priceCounts = new Map<string, number>();
  for (const p of priceRefs) {
    priceCounts.set(p, (priceCounts.get(p) || 0) + 1);
  }

  const repeatedPrices = Array.from(priceCounts.entries()).filter(([_, count]) => count >= ANCHORING_PRICE_REPETITION_THRESHOLD);

  if (repeatedPrices.length > 0) {
    const anchor = repeatedPrices[0][0];
    return {
      type: "anchoring",
      confidence: Math.min(ANCHORING_MAX_CONFIDENCE, ANCHORING_BASE_CONFIDENCE + repeatedPrices[0][1] * ANCHORING_CONFIDENCE_PER_REPETITION),
      evidence: `Price ${anchor} mentioned ${repeatedPrices[0][1]} times — reasoning appears anchored to this value`,
      severity: repeatedPrices[0][1] >= ANCHORING_HIGH_SEVERITY_THRESHOLD ? "high" : "medium",
      triggers: repeatedPrices.map(([p]) => p),
    };
  }

  // Anchoring: reasoning references only one stock's data despite having multiple
  if (marketData.length >= ANCHORING_MIN_SYMBOLS_FOR_CHECK) {
    const symbolsInReasoning = new Set<string>();
    for (const d of marketData) {
      const lower = d.symbol.toLowerCase();
      const base = lower.replace(/x$/i, "");
      if (
        reasoning.toLowerCase().includes(lower) ||
        reasoning.toLowerCase().includes(base)
      ) {
        symbolsInReasoning.add(d.symbol);
      }
    }

    if (symbolsInReasoning.size === 1 && priceRefs.length >= ANCHORING_MIN_PRICE_REFS_SINGLE_SYMBOL) {
      return {
        type: "anchoring",
        confidence: ANCHORING_SINGLE_SYMBOL_CONFIDENCE,
        evidence: `Only references one symbol despite ${marketData.length} available — may be anchored to that stock's data`,
        severity: "low",
        triggers: Array.from(symbolsInReasoning),
      };
    }
  }

  return null;
}

/**
 * Detect confirmation bias: only citing evidence that supports the conclusion.
 */
function detectConfirmation(
  reasoning: string,
  action: string,
  marketData: MarketData[],
): BiasDetection | null {
  const lower = reasoning.toLowerCase();

  // For buy actions: check if agent ignores negative signals
  if (action === "buy") {
    const positiveSignals = [
      /bullish/i, /upside/i, /growth/i, /opportunity/i, /strong/i,
      /recovery/i, /undervalued/i, /momentum/i, /breakout/i,
    ].filter((p) => p.test(lower)).length;

    const negativeSignals = [
      /bearish/i, /downside/i, /risk/i, /weakness/i, /overvalued/i,
      /decline/i, /loss/i, /concern/i, /resistance/i,
    ].filter((p) => p.test(lower)).length;

    // Check if negative data exists but is ignored
    const negativeStocks = marketData.filter(
      (d) => d.change24h !== null && d.change24h < CONFIRMATION_NEGATIVE_STOCK_CHANGE_THRESHOLD,
    );

    if (positiveSignals >= CONFIRMATION_POSITIVE_SIGNALS_THRESHOLD && negativeSignals === CONFIRMATION_NEGATIVE_SIGNALS_REQUIRED && negativeStocks.length >= CONFIRMATION_MIN_NEGATIVE_STOCKS) {
      return {
        type: "confirmation",
        confidence: CONFIRMATION_IGNORED_DATA_CONFIDENCE,
        evidence: `Buy reasoning cites ${positiveSignals} positive signals but ignores ${negativeStocks.length} stocks with significant losses (>2% down)`,
        severity: "medium",
        triggers: negativeStocks.map((s) => `${s.symbol}: ${s.change24h?.toFixed(1)}%`),
      };
    }

    if (positiveSignals >= CONFIRMATION_STRONG_ONE_SIDED_THRESHOLD && negativeSignals === CONFIRMATION_NEGATIVE_SIGNALS_REQUIRED) {
      return {
        type: "confirmation",
        confidence: CONFIRMATION_ONE_SIDED_CONFIDENCE,
        evidence: `Reasoning cites ${positiveSignals} positive signals with zero counterarguments — one-sided analysis`,
        severity: "medium",
        triggers: ["all_positive_no_counterarguments"],
      };
    }
  }

  // For sell actions: check if agent ignores positive signals
  if (action === "sell") {
    const positiveSignals = [
      /bullish/i, /upside/i, /growth/i, /recovery/i, /undervalued/i,
    ].filter((p) => p.test(lower)).length;

    const negativeSignals = [
      /bearish/i, /downside/i, /risk/i, /overvalued/i, /decline/i,
      /loss/i, /overexposed/i, /correction/i, /weakness/i,
    ].filter((p) => p.test(lower)).length;

    if (negativeSignals >= CONFIRMATION_POSITIVE_SIGNALS_THRESHOLD && positiveSignals === CONFIRMATION_NEGATIVE_SIGNALS_REQUIRED) {
      return {
        type: "confirmation",
        confidence: CONFIRMATION_ONE_SIDED_CONFIDENCE,
        evidence: `Sell reasoning cites ${negativeSignals} negative signals with zero positive counterpoints — one-sided analysis`,
        severity: "medium",
        triggers: ["all_negative_no_counterarguments"],
      };
    }
  }

  return null;
}

/**
 * Detect recency bias: disproportionate weight on recent data.
 */
function detectRecency(reasoning: string): BiasDetection | null {
  const lower = reasoning.toLowerCase();

  const recencyIndicators = [
    /\bjust\b/i,
    /\brecently\b/i,
    /\btoday\b/i,
    /\bjust\s+happened\b/i,
    /\blatest\b/i,
    /\bmost\s+recent\b/i,
    /\bthis\s+morning\b/i,
    /\bright\s+now\b/i,
    /\bcurrently\s+happening\b/i,
    /\bin\s+the\s+last\s+hour\b/i,
  ];

  const longTermIndicators = [
    /\bhistorically\b/i,
    /\blong[\s-]term\b/i,
    /\bover\s+the\s+past\s+\w+\b/i,
    /\bfundamentals?\b/i,
    /\bseasonal/i,
    /\b\d+[\s-]year/i,
    /\bhistorical/i,
  ];

  const recencyCount = recencyIndicators.filter((p) => p.test(lower)).length;
  const longTermCount = longTermIndicators.filter((p) => p.test(lower)).length;

  if (recencyCount >= RECENCY_TERM_COUNT_THRESHOLD && longTermCount === RECENCY_LONG_TERM_REQUIRED) {
    const triggers = recencyIndicators
      .filter((p) => p.test(lower))
      .map((p) => {
        const match = lower.match(p);
        return match ? match[0] : "";
      })
      .filter(Boolean);

    return {
      type: "recency",
      confidence: Math.min(RECENCY_MAX_CONFIDENCE, RECENCY_BASE_CONFIDENCE + recencyCount * RECENCY_CONFIDENCE_PER_TERM),
      evidence: `Reasoning uses ${recencyCount} recency terms ("just", "recently", "right now") with zero references to historical or long-term data`,
      severity: recencyCount >= RECENCY_HIGH_SEVERITY_THRESHOLD ? "high" : "medium",
      triggers,
    };
  }

  return null;
}

/**
 * Detect sunk cost fallacy: holding/adding based on prior investment.
 */
function detectSunkCost(
  reasoning: string,
  action: string,
  portfolio?: { positions: { symbol: string; unrealizedPnl: number }[] },
): BiasDetection | null {
  const lower = reasoning.toLowerCase();

  // Sunk cost patterns
  const sunkCostPatterns = [
    /already\s+invested/i,
    /averaging\s+down/i,
    /can'?t\s+sell\s+at\s+a\s+loss/i,
    /too\s+much\s+invested/i,
    /wait\s+for\s+(?:it\s+to\s+)?(?:recover|come\s+back)/i,
    /don'?t\s+want\s+to\s+(?:realize|lock\s+in)\s+(?:a\s+)?loss/i,
    /committed\s+to\s+(?:this|the)\s+position/i,
    /initial\s+(?:investment|thesis)\s+still\s+holds/i,
    /doubling\s+down/i,
    /cost\s+basis/i,
  ];

  const matchedPatterns = sunkCostPatterns.filter((p) => p.test(lower));

  if (matchedPatterns.length >= SUNK_COST_PATTERN_THRESHOLD) {
    const triggers = matchedPatterns.map((p) => {
      const m = lower.match(p);
      return m ? m[0] : "";
    }).filter(Boolean);

    return {
      type: "sunk_cost",
      confidence: Math.min(SUNK_COST_MAX_CONFIDENCE, SUNK_COST_BASE_CONFIDENCE + matchedPatterns.length * SUNK_COST_CONFIDENCE_PER_PATTERN),
      evidence: `Reasoning references prior investment ${matchedPatterns.length} times — decision may be influenced by sunk costs rather than current merit`,
      severity: matchedPatterns.length >= SUNK_COST_HIGH_SEVERITY_THRESHOLD ? "high" : "medium",
      triggers,
    };
  }

  // If action is "hold" or "buy" on a losing position with sunk cost language
  if ((action === "hold" || action === "buy") && portfolio) {
    for (const pos of portfolio.positions) {
      if (pos.unrealizedPnl < 0) {
        const symLower = pos.symbol.toLowerCase();
        if (lower.includes(symLower.replace(/x$/i, "")) && matchedPatterns.length >= SUNK_COST_LOSING_POSITION_MIN_PATTERNS) {
          return {
            type: "sunk_cost",
            confidence: SUNK_COST_LOSING_POSITION_CONFIDENCE,
            evidence: `Holding/adding to losing position (${pos.symbol}) with sunk cost language`,
            severity: "medium",
            triggers: matchedPatterns.map((p) => {
              const m = lower.match(p);
              return m ? m[0] : "";
            }).filter(Boolean),
          };
        }
      }
    }
  }

  return null;
}

/**
 * Detect overconfidence bias: high confidence without strong evidence.
 */
function detectOverconfidence(
  reasoning: string,
  confidence: number,
  action: string,
): BiasDetection | null {
  const wordCount = countWords(reasoning);

  // Certainty language
  const certaintyPatterns = [
    /\bdefinitely\b/i,
    /\bcertainly\b/i,
    /\bwithout\s+(?:a\s+)?doubt\b/i,
    /\bguaranteed\b/i,
    /\bobvious(?:ly)?\b/i,
    /\bclear(?:ly)?\b/i,
    /\bno\s+question\b/i,
    /\bsure\s+thing\b/i,
    /\bimpossible\s+(?:to\s+lose|not\s+to)\b/i,
    /\bwill\s+(?:definitely|certainly|absolutely)\b/i,
  ];

  // Hedging language (lack of overconfidence)
  const hedgingPatterns = [
    /\bmight\b/i,
    /\bcould\b/i,
    /\bperhaps\b/i,
    /\buncertain/i,
    /\brisk/i,
    /\bhowever\b/i,
    /\bbut\b/i,
    /\bcaveat\b/i,
    /\bon\s+the\s+other\s+hand\b/i,
    /\bif\b/i,
  ];

  const certaintyCount = certaintyPatterns.filter((p) => p.test(reasoning)).length;
  const hedgingCount = hedgingPatterns.filter((p) => p.test(reasoning)).length;

  // Overconfidence: high confidence + certainty language + no hedging
  if (confidence > OVERCONFIDENCE_CONFIDENCE_THRESHOLD && certaintyCount >= OVERCONFIDENCE_MIN_CERTAINTY_TERMS && hedgingCount === OVERCONFIDENCE_HEDGING_REQUIRED) {
    const triggers = certaintyPatterns
      .filter((p) => p.test(reasoning))
      .map((p) => {
        const m = reasoning.match(p);
        return m ? m[0] : "";
      })
      .filter(Boolean);

    return {
      type: "overconfidence",
      confidence: Math.min(OVERCONFIDENCE_MAX_CONFIDENCE, OVERCONFIDENCE_BASE_CONFIDENCE + certaintyCount * OVERCONFIDENCE_CONFIDENCE_PER_TERM + (confidence - OVERCONFIDENCE_CONFIDENCE_THRESHOLD) * OVERCONFIDENCE_CONFIDENCE_MULTIPLIER),
      evidence: `Confidence ${(confidence * 100).toFixed(0)}% with ${certaintyCount} certainty expressions and zero hedging — overconfidence likely`,
      severity: confidence > OVERCONFIDENCE_VERY_HIGH_THRESHOLD ? "high" : "medium",
      triggers,
    };
  }

  // Overconfidence: very high confidence with very short reasoning
  if (confidence > OVERCONFIDENCE_SHORT_REASONING_CONFIDENCE && wordCount < OVERCONFIDENCE_SHORT_REASONING_WORD_LIMIT && action !== "hold") {
    return {
      type: "overconfidence",
      confidence: OVERCONFIDENCE_SHORT_REASONING_CONFIDENCE_VALUE,
      evidence: `Confidence ${(confidence * 100).toFixed(0)}% with only ${wordCount} words of reasoning — insufficient evidence for high confidence`,
      severity: "medium",
      triggers: [`confidence: ${confidence}`, `words: ${wordCount}`],
    };
  }

  return null;
}

/**
 * Detect herding bias: reasoning that mirrors other agents' decisions.
 */
function detectHerding(
  reasoning: string,
  action: string,
  otherAgents: RoundAgentContext[],
): BiasDetection | null {
  if (otherAgents.length === 0) return null;

  const lower = reasoning.toLowerCase();

  // Check for explicit references to other agents
  const herdingPatterns = [
    /other\s+agents?\s+(?:are\s+)?(?:buy|sell|hold)ing/i,
    /consensus\s+(?:is\s+)?(?:to\s+)?(?:buy|sell|hold)/i,
    /following\s+(?:the\s+)?(?:market|crowd|trend|others?)/i,
    /everyone\s+(?:is\s+|else\s+is\s+)?(?:buy|sell|hold)ing/i,
    /(?:claude|gpt|grok)\s+(?:is\s+|also\s+)?(?:buy|sell|hold)ing/i,
    /aligning?\s+with\s+(?:the\s+)?(?:consensus|majority|other)/i,
  ];

  const matchedPatterns = herdingPatterns.filter((p) => p.test(lower));

  if (matchedPatterns.length >= HERDING_EXPLICIT_PATTERN_THRESHOLD) {
    const triggers = matchedPatterns.map((p) => {
      const m = lower.match(p);
      return m ? m[0] : "";
    }).filter(Boolean);

    return {
      type: "herding",
      confidence: Math.min(HERDING_MAX_CONFIDENCE, HERDING_BASE_CONFIDENCE + matchedPatterns.length * HERDING_CONFIDENCE_PER_PATTERN),
      evidence: `Reasoning explicitly references other agents' decisions — herding behavior`,
      severity: matchedPatterns.length >= HERDING_HIGH_SEVERITY_THRESHOLD ? "high" : "medium",
      triggers,
    };
  }

  // Implicit herding: all agents take same action with very similar reasoning
  const sameAction = otherAgents.filter((a) => a.action === action);
  if (sameAction.length === otherAgents.length && otherAgents.length >= HERDING_MIN_AGENTS_FOR_IMPLICIT) {
    // Check reasoning similarity (keyword overlap)
    const myKeywords = new Set(
      lower
        .split(/\s+/)
        .filter((w) => w.length > HERDING_MIN_KEYWORD_LENGTH)
        .map((w) => w.replace(/[^a-z]/g, "")),
    );

    let maxOverlap = 0;
    for (const other of sameAction) {
      const otherKeywords = new Set(
        other.reasoning.toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length > HERDING_MIN_KEYWORD_LENGTH)
          .map((w) => w.replace(/[^a-z]/g, "")),
      );

      let overlap = 0;
      for (const k of myKeywords) {
        if (otherKeywords.has(k)) overlap++;
      }

      const overlapRate = myKeywords.size > 0 ? overlap / myKeywords.size : 0;
      if (overlapRate > maxOverlap) maxOverlap = overlapRate;
    }

    if (maxOverlap > HERDING_KEYWORD_OVERLAP_THRESHOLD) {
      return {
        type: "herding",
        confidence: HERDING_IMPLICIT_CONFIDENCE,
        evidence: `All agents took the same action (${action}) with ${(maxOverlap * 100).toFixed(0)}% reasoning keyword overlap — potential implicit herding`,
        severity: "low",
        triggers: [`keyword_overlap: ${(maxOverlap * 100).toFixed(0)}%`],
      };
    }
  }

  return null;
}

/**
 * Detect loss aversion: asymmetric treatment of gains vs losses.
 */
function detectLossAversion(
  reasoning: string,
  action: string,
  portfolio?: { positions: { symbol: string; unrealizedPnl: number; unrealizedPnlPercent: number }[] },
): BiasDetection | null {
  const lower = reasoning.toLowerCase();

  // Loss aversion language patterns
  const lossAversionPatterns = [
    /can'?t\s+afford\s+(?:to\s+)?lose/i,
    /protect\s+(?:my\s+|our\s+)?(?:gains|profits?|capital)/i,
    /lock\s+in\s+(?:profits?|gains)/i,
    /afraid\s+(?:of\s+)?(?:losing|losses?)/i,
    /risk\s+(?:of\s+)?(?:losing|loss)/i,
    /cut\s+(?:my\s+|our\s+)?losses/i,
    /stop[\s-]loss/i,
    /downside\s+protection/i,
  ];

  const gainSeekingPatterns = [
    /maximize\s+(?:profit|gain|return)/i,
    /upside\s+potential/i,
    /growth\s+opportunity/i,
    /could\s+gain/i,
    /potential\s+(?:profit|return|upside)/i,
  ];

  const lossCount = lossAversionPatterns.filter((p) => p.test(lower)).length;
  const gainCount = gainSeekingPatterns.filter((p) => p.test(lower)).length;

  // Strong loss aversion: much more loss language than gain language
  if (lossCount >= LOSS_AVERSION_TERM_COUNT_THRESHOLD && gainCount <= LOSS_AVERSION_MAX_GAIN_TERMS) {
    const triggers = lossAversionPatterns
      .filter((p) => p.test(lower))
      .map((p) => {
        const m = lower.match(p);
        return m ? m[0] : "";
      })
      .filter(Boolean);

    return {
      type: "loss_aversion",
      confidence: Math.min(LOSS_AVERSION_MAX_CONFIDENCE, LOSS_AVERSION_BASE_CONFIDENCE + lossCount * LOSS_AVERSION_CONFIDENCE_PER_TERM),
      evidence: `${lossCount} loss-avoidance references vs ${gainCount} gain-seeking — asymmetric risk perception`,
      severity: lossCount >= LOSS_AVERSION_HIGH_SEVERITY_THRESHOLD ? "high" : "medium",
      triggers,
    };
  }

  // Selling small winners too early while holding big losers
  if (action === "sell" && portfolio) {
    const winners = portfolio.positions.filter((p) => p.unrealizedPnlPercent > LOSS_AVERSION_WINNER_THRESHOLD);
    const losers = portfolio.positions.filter((p) => p.unrealizedPnlPercent < LOSS_AVERSION_BIG_LOSER_THRESHOLD);

    if (winners.length > 0 && losers.length > 0) {
      // Check if selling a small winner while holding a big loser
      const sellingWinner = winners.some((w) =>
        lower.includes(w.symbol.toLowerCase().replace(/x$/i, "")),
      );
      if (sellingWinner && losers.length > 0) {
        return {
          type: "loss_aversion",
          confidence: LOSS_AVERSION_DISPOSITION_CONFIDENCE,
          evidence: `Selling winning position while holding ${losers.length} losing position(s) — classic disposition effect (loss aversion)`,
          severity: "low",
          triggers: losers.map((l) => `${l.symbol}: ${l.unrealizedPnlPercent.toFixed(1)}%`),
        };
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main Analysis Function
// ---------------------------------------------------------------------------

/**
 * Run full cognitive bias detection on an agent's reasoning.
 */
export function analyzeBiases(
  reasoning: string,
  action: string,
  confidence: number,
  marketData: MarketData[],
  otherAgents: RoundAgentContext[] = [],
  portfolio?: {
    positions: { symbol: string; quantity: number; unrealizedPnl: number; unrealizedPnlPercent: number }[];
  },
): BiasAnalysisResult {
  const detections: BiasDetection[] = [];

  // Run all detectors
  const anchoring = detectAnchoring(reasoning, marketData);
  if (anchoring) detections.push(anchoring);

  const confirmation = detectConfirmation(reasoning, action, marketData);
  if (confirmation) detections.push(confirmation);

  const recency = detectRecency(reasoning);
  if (recency) detections.push(recency);

  const sunkCost = detectSunkCost(
    reasoning,
    action,
    portfolio ? { positions: portfolio.positions } : undefined,
  );
  if (sunkCost) detections.push(sunkCost);

  const overconfidence = detectOverconfidence(reasoning, confidence, action);
  if (overconfidence) detections.push(overconfidence);

  const herding = detectHerding(reasoning, action, otherAgents);
  if (herding) detections.push(herding);

  const lossAversion = detectLossAversion(
    reasoning,
    action,
    portfolio ? {
      positions: portfolio.positions.map((p) => ({
        symbol: p.symbol,
        unrealizedPnl: p.unrealizedPnl,
        unrealizedPnlPercent: p.unrealizedPnlPercent,
      })),
    } : undefined,
  );
  if (lossAversion) detections.push(lossAversion);

  // Calculate overall bias score
  const severityWeights: Record<string, number> = {
    high: SEVERITY_WEIGHT_HIGH,
    medium: SEVERITY_WEIGHT_MEDIUM,
    low: SEVERITY_WEIGHT_LOW,
  };

  let biasScore = 0;
  if (detections.length > 0) {
    const weightedSum = detections.reduce(
      (sum, d) => sum + d.confidence * severityWeights[d.severity],
      0,
    );
    // Normalize: more biases = higher score, but cap at 1.0
    biasScore = Math.min(BIAS_SCORE_MAX, weightedSum / BIAS_SCORE_NORMALIZATION_DIVISOR);
  }
  biasScore = round3(biasScore);

  // Find dominant bias
  const dominantBias =
    detections.length > 0
      ? detections.sort((a, b) => {
          const aW = a.confidence * severityWeights[a.severity];
          const bW = b.confidence * severityWeights[b.severity];
          return bW - aW;
        })[0].type
      : null;

  // Assessment
  let assessment: string;
  if (detections.length === 0) {
    assessment = "No cognitive biases detected — reasoning appears balanced and evidence-based";
  } else if (biasScore < BIAS_SCORE_MINOR_THRESHOLD) {
    assessment = `Minor bias indicators: ${detections.map((d) => d.type).join(", ")}. Generally balanced reasoning.`;
  } else if (biasScore < BIAS_SCORE_MODERATE_THRESHOLD) {
    assessment = `Moderate cognitive bias detected: ${dominantBias}. Reasoning is partially biased by cognitive shortcuts.`;
  } else {
    assessment = `Significant cognitive bias: ${dominantBias}. Decision may be driven by bias rather than evidence.`;
  }

  return {
    biasScore,
    biasCount: detections.length,
    detections,
    assessment,
    dominantBias,
  };
}

// ---------------------------------------------------------------------------
// Recording and Stats
// ---------------------------------------------------------------------------

/**
 * Record a bias analysis result for benchmark tracking.
 */
export function recordBiasResult(
  tradeId: string,
  agentId: string,
  roundId: string,
  result: BiasAnalysisResult,
): void {
  biasHistory.unshift({
    tradeId,
    agentId,
    roundId,
    result,
    timestamp: new Date().toISOString(),
  });
  if (biasHistory.length > MAX_HISTORY) {
    biasHistory.length = MAX_HISTORY;
  }

  // Update per-agent stats
  const stats = agentBiasStats.get(agentId) ?? {
    totalBiases: 0,
    byType: {} as Record<string, number>,
    checks: 0,
    totalScore: 0,
  };
  stats.totalBiases += result.biasCount;
  stats.checks++;
  stats.totalScore += result.biasScore;
  for (const d of result.detections) {
    stats.byType[d.type] = (stats.byType[d.type] ?? 0) + 1;
  }
  agentBiasStats.set(agentId, stats);
}

/** Get recent bias history */
export function getBiasHistory(limit = 50): BiasRecord[] {
  return biasHistory.slice(0, limit);
}

/** Get per-agent bias stats */
export function getAgentBiasStats(): Record<
  string,
  {
    avgBiasScore: number;
    totalBiases: number;
    dominantBias: string | null;
    biasDistribution: Record<string, number>;
    checks: number;
  }
> {
  const result: Record<string, {
    avgBiasScore: number;
    totalBiases: number;
    dominantBias: string | null;
    biasDistribution: Record<string, number>;
    checks: number;
  }> = {};

  for (const [agentId, stats] of agentBiasStats.entries()) {
    const dominant = getTopKey(stats.byType);

    result[agentId] = {
      avgBiasScore: stats.checks > 0 ? round3(stats.totalScore / stats.checks) : 0,
      totalBiases: stats.totalBiases,
      dominantBias: dominant ? dominant[0] : null,
      biasDistribution: { ...stats.byType },
      checks: stats.checks,
    };
  }

  return result;
}
