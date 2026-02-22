/**
 * Adversarial Robustness Engine (v18)
 *
 * Tests whether AI agents produce consistent reasoning under adversarial
 * perturbations. This is the "stress test" pillar of the benchmark —
 * do agents fall apart when given conflicting signals, edge cases,
 * or noisy data?
 *
 * Tests:
 * 1. SIGNAL CONFLICT: Give bullish price + bearish news — does agent acknowledge?
 * 2. ANCHORING RESISTANCE: Is reasoning swayed by irrelevant price anchors?
 * 3. NOISE SENSITIVITY: Does adding noise to prices change reasoning quality?
 * 4. EDGE CASE HANDLING: How does agent handle 0 volume, missing data, extreme moves?
 * 5. CONSISTENCY UNDER PRESSURE: Same fundamentals, different framing — same decision?
 */

import { clamp, countWords, round3, countByCondition, avgOfProperty } from "../lib/math-utils.ts";
import { ID_RANDOM_START, ID_RANDOM_LENGTH_SHORT, TOP_ANALYSIS_ITEMS_LIMIT } from "../config/constants.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Signal Conflict Detection Thresholds
 *
 * Controls scoring when agents face conflicting price/news signals.
 */

/** Perfect score when no signal conflict present (1.0 = fully robust) */
const SIGNAL_CONFLICT_NO_CONFLICT_SCORE = 1.0;

/** Score when conflict present but agent acknowledged it (1.0 = fully aware) */
const SIGNAL_CONFLICT_ACKNOWLEDGED_SCORE = 1.0;

/** Penalty score when conflict present but NOT acknowledged (0.3 = significant vulnerability) */
const SIGNAL_CONFLICT_MISSED_SCORE = 0.3;

/**
 * Anchoring Resistance Thresholds
 *
 * Controls penalties for reasoning anchored to irrelevant historical prices.
 */

/** Price deviation threshold to classify references as "near current" (20% = within ±20%) */
const ANCHORING_PRICE_DEVIATION_THRESHOLD = 0.20;

/** Penalty for anchoring to historical data without current context (-0.3 from score) */
const ANCHORING_NO_CURRENT_DATA_PENALTY = 0.3;

/** Penalty for excessive historical anchoring (>2 references, -0.2 from score) */
const ANCHORING_EXCESSIVE_REFERENCES_PENALTY = 0.2;

/** Penalty for more irrelevant price refs than relevant ones (-0.15 from score) */
const ANCHORING_IRRELEVANT_PRICE_PENALTY = 0.15;

/**
 * Noise Sensitivity Thresholds
 *
 * Controls penalties when reasoning changes drastically for minor price perturbations.
 */

/** Penalty for action flip under noise (-0.4 from score, most severe) */
const NOISE_ACTION_FLIP_PENALTY = 0.4;

/** Confidence swing threshold for severe penalty (>0.3 = 30 point swing) */
const NOISE_CONFIDENCE_SWING_SEVERE_THRESHOLD = 0.3;

/** Penalty for severe confidence swing (-0.2 from score) */
const NOISE_CONFIDENCE_SWING_SEVERE_PENALTY = 0.2;

/** Text divergence threshold for penalty (>0.7 Jaccard distance = very different) */
const NOISE_TEXT_DIVERGENCE_THRESHOLD = 0.7;

/** Penalty for high text divergence (-0.2 from score) */
const NOISE_TEXT_DIVERGENCE_PENALTY = 0.2;

/** Confidence swing threshold for moderate penalty (>0.15 = 15 point swing) */
const NOISE_CONFIDENCE_SWING_MODERATE_THRESHOLD = 0.15;

/** Penalty for moderate confidence swing (-0.1 from score) */
const NOISE_CONFIDENCE_SWING_MODERATE_PENALTY = 0.1;

/**
 * Framing Consistency Thresholds
 *
 * Controls bias detection (loss aversion, recency, overconfidence).
 */

/** Penalty per framing bias indicator detected (-0.2 per indicator) */
const FRAMING_BIAS_PENALTY_PER_INDICATOR = 0.2;

/** Loss ratio threshold for loss framing detection (>75% loss refs with buy = bias) */
const FRAMING_LOSS_RATIO_HIGH_THRESHOLD = 0.75;

/** Loss ratio threshold for gain framing detection (<25% loss refs with sell = bias) */
const FRAMING_LOSS_RATIO_LOW_THRESHOLD = 0.25;

/** Minimum recency pattern count for bias detection (≥2 recency markers = bias) */
const FRAMING_RECENCY_PATTERN_MIN_COUNT = 2;

/** Confidence threshold for overconfidence detection (>85% with thin reasoning = bias) */
const FRAMING_OVERCONFIDENCE_THRESHOLD = 0.85;

/** Word count threshold for thin reasoning classification (<40 words = thin) */
const FRAMING_THIN_REASONING_WORD_COUNT = 40;

/**
 * Composite Aggregation Weights
 *
 * Weights for combining signal conflict, anchoring, edge cases, and framing scores
 * into overall adversarial robustness score.
 */

/** Weight for signal conflict detection in composite score (25% of total) */
const COMPOSITE_WEIGHT_SIGNAL_CONFLICT = 0.25;

/** Weight for anchoring resistance in composite score (25% of total) */
const COMPOSITE_WEIGHT_ANCHORING = 0.25;

/** Weight for edge case handling in composite score (25% of total) */
const COMPOSITE_WEIGHT_EDGE_CASES = 0.25;

/** Weight for framing consistency in composite score (25% of total) */
const COMPOSITE_WEIGHT_FRAMING = 0.25;

/**
 * Score Precision Rounding Multiplier
 *
 * Used for rounding the composite adversarial robustness score to 3 decimal places.
 * Formula: Math.round(score * 1000) / 1000
 *
 * 3 decimal places chosen to distinguish scores like 0.742 vs 0.743 for fine-grained
 * benchmark ranking while avoiding unnecessary floating-point noise beyond 3 decimals.
 *
 * Example: raw = 0.74255... → Math.round(0.74255 * 1000) / 1000 = 0.743
 */
const SCORE_PRECISION_MULTIPLIER = 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdversarialTest {
  testId: string;
  agentId: string;
  testType: AdversarialTestType;
  /** Original reasoning text */
  baselineReasoning: string;
  /** Reasoning under adversarial conditions */
  adversarialReasoning: string;
  /** Original action */
  baselineAction: string;
  /** Action under adversarial conditions */
  adversarialAction: string;
  /** 0 = perfectly robust, 1 = completely swayed */
  susceptibility: number;
  /** Specific vulnerabilities detected */
  vulnerabilities: string[];
  /** Whether the agent detected the adversarial signal */
  adversarialAwareness: boolean;
  timestamp: string;
}

export type AdversarialTestType =
  | "signal_conflict"
  | "anchoring_resistance"
  | "noise_sensitivity"
  | "edge_case"
  | "framing_consistency";

export interface AgentRobustnessProfile {
  agentId: string;
  overallScore: number;
  testCount: number;
  scores: {
    signalConflict: number;
    anchoringResistance: number;
    noiseSensitivity: number;
    edgeCaseHandling: number;
    framingConsistency: number;
  };
  topVulnerabilities: string[];
  trend: "improving" | "stable" | "declining";
  lastUpdated: string;
}

interface ReasoningSnapshot {
  agentId: string;
  action: string;
  symbol: string;
  reasoning: string;
  confidence: number;
  roundId: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const testHistory = new Map<string, AdversarialTest[]>();
const reasoningPairs = new Map<string, ReasoningSnapshot[]>();
const MAX_HISTORY = 200;
/** Maximum reasoning snapshots retained per agent for noise sensitivity comparison. */
const MAX_SNAPSHOT_HISTORY = 100;

// ---------------------------------------------------------------------------
// Signal Conflict Detector
// ---------------------------------------------------------------------------

/**
 * Detects whether reasoning acknowledges conflicting market signals.
 * A robust agent should note when price action and news disagree.
 */
export function detectSignalConflict(
  reasoning: string,
  priceDirection: "up" | "down" | "flat",
  newsDirection: "positive" | "negative" | "neutral",
): { conflictPresent: boolean; agentAcknowledged: boolean; score: number } {
  const hasConflict =
    (priceDirection === "up" && newsDirection === "negative") ||
    (priceDirection === "down" && newsDirection === "positive");

  if (!hasConflict) {
    return { conflictPresent: false, agentAcknowledged: false, score: SIGNAL_CONFLICT_NO_CONFLICT_SCORE };
  }

  // Check if the agent noticed the conflict
  const conflictAcknowledgementPatterns = [
    /despite|although|however|nevertheless|contrary to|conflicting|mixed signals/i,
    /price.*(?:up|rising|gain).*(?:negative|bearish|concerning|worry)/i,
    /price.*(?:down|fall|decline).*(?:positive|bullish|favorable|good)/i,
    /diverge|disconnect|inconsistent|paradox|contradiction/i,
    /on one hand.*on the other/i,
    /risk.*reward/i,
  ];

  const agentAcknowledged = conflictAcknowledgementPatterns.some((p) => p.test(reasoning));

  // Score: 1.0 if acknowledged, 0.3 if not
  const score = agentAcknowledged ? SIGNAL_CONFLICT_ACKNOWLEDGED_SCORE : SIGNAL_CONFLICT_MISSED_SCORE;

  return { conflictPresent: true, agentAcknowledged, score };
}

// ---------------------------------------------------------------------------
// Anchoring Resistance
// ---------------------------------------------------------------------------

/**
 * Detect whether reasoning is anchored to irrelevant reference points.
 * E.g., "the stock was $500 last year" shouldn't dominate current analysis.
 */
export function measureAnchoringResistance(
  reasoning: string,
  currentPrice: number,
  _symbol: string,
): { score: number; anchoredReferences: string[] } {
  const anchoredRefs: string[] = [];

  // Check for references to historical highs/lows that dominate reasoning
  const historicalPatterns = [
    /all.time\s+high/i,
    /52.week\s+(?:high|low)/i,
    /used\s+to\s+(?:be|trade)\s+at/i,
    /was\s+(?:once|previously)\s+(?:at\s+)?\$[\d,.]+/i,
    /down\s+\d+%\s+from\s+(?:its\s+)?(?:peak|high|ath)/i,
    /compared\s+to\s+(?:its\s+)?(?:previous|past|historical)/i,
  ];

  for (const pattern of historicalPatterns) {
    const match = reasoning.match(pattern);
    if (match) {
      anchoredRefs.push(match[0]);
    }
  }

  // Check if reasoning has current data references (good sign)
  const currentDataPatterns = [
    /current(?:ly)?\s+(?:at|trading|priced)/i,
    /today|this\s+session|right\s+now/i,
    /latest\s+(?:price|data|reading)/i,
    /as\s+of\s+(?:now|today)/i,
  ];

  const hasCurrentData = currentDataPatterns.some((p) => p.test(reasoning));

  // Count concrete price references near the current price (within 20%)
  const priceRefs = reasoning.match(/\$[\d,]+\.?\d*/g) ?? [];
  let nearCurrentCount = 0;
  let farFromCurrentCount = 0;
  for (const ref of priceRefs) {
    const price = parseFloat(ref.replace(/[$,]/g, ""));
    if (price > 0) {
      const deviation = Math.abs(price - currentPrice) / currentPrice;
      if (deviation < ANCHORING_PRICE_DEVIATION_THRESHOLD) nearCurrentCount++;
      else farFromCurrentCount++;
    }
  }

  // Score: penalize heavy anchoring to historical data without current context
  let score = 1.0;
  if (anchoredRefs.length > 0 && !hasCurrentData) {
    score -= ANCHORING_NO_CURRENT_DATA_PENALTY; // Anchoring without current data
  }
  if (anchoredRefs.length > 2) {
    score -= ANCHORING_EXCESSIVE_REFERENCES_PENALTY; // Excessive historical anchoring
  }
  if (farFromCurrentCount > nearCurrentCount && priceRefs.length > 0) {
    score -= ANCHORING_IRRELEVANT_PRICE_PENALTY; // More irrelevant price references than relevant ones
  }

  return {
    score: clamp(score, 0, 1),
    anchoredReferences: anchoredRefs,
  };
}

// ---------------------------------------------------------------------------
// Noise Sensitivity
// ---------------------------------------------------------------------------

/**
 * Measure how sensitive reasoning is to minor price changes.
 * Compare two reasonings for similar prices — they should be similar.
 */
export function measureNoiseSensitivity(
  reasoning1: string,
  reasoning2: string,
  action1: string,
  action2: string,
  confidence1: number,
  confidence2: number,
): { score: number; actionFlipped: boolean; confidenceSwing: number; textDivergence: number } {
  // Action flip = bad
  const actionFlipped = action1 !== action2;

  // Confidence swing
  const confidenceSwing = Math.abs(confidence1 - confidence2);

  // Text similarity via bigram Jaccard
  const bigrams1 = extractBigrams(reasoning1);
  const bigrams2 = extractBigrams(reasoning2);
  const intersection = new Set([...bigrams1].filter((b) => bigrams2.has(b)));
  const union = new Set([...bigrams1, ...bigrams2]);
  const jaccardSimilarity = union.size > 0 ? intersection.size / union.size : 1;
  const textDivergence = 1 - jaccardSimilarity;

  // Score: penalize high sensitivity
  let score = 1.0;
  if (actionFlipped) score -= NOISE_ACTION_FLIP_PENALTY;
  if (confidenceSwing > NOISE_CONFIDENCE_SWING_SEVERE_THRESHOLD) score -= NOISE_CONFIDENCE_SWING_SEVERE_PENALTY;
  if (textDivergence > NOISE_TEXT_DIVERGENCE_THRESHOLD) score -= NOISE_TEXT_DIVERGENCE_PENALTY;
  if (confidenceSwing > NOISE_CONFIDENCE_SWING_MODERATE_THRESHOLD) score -= NOISE_CONFIDENCE_SWING_MODERATE_PENALTY;

  return {
    score: clamp(score, 0, 1),
    actionFlipped,
    confidenceSwing,
    textDivergence,
  };
}

function extractBigrams(text: string): Set<string> {
  const words = text.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter((w) => w.length > 2);
  const bigrams = new Set<string>();
  for (let i = 0; i < words.length - 1; i++) {
    bigrams.add(`${words[i]} ${words[i + 1]}`);
  }
  return bigrams;
}

// ---------------------------------------------------------------------------
// Edge Case Handling
// ---------------------------------------------------------------------------

/**
 * Score how well reasoning handles edge cases in market data.
 */
export function scoreEdgeCaseHandling(
  reasoning: string,
  action: string,
  marketConditions: {
    hasZeroVolume: boolean;
    hasMissingData: boolean;
    hasExtremeMove: boolean;
    extremeMovePercent?: number;
  },
): { score: number; handledEdgeCases: string[]; missedEdgeCases: string[] } {
  const handled: string[] = [];
  const missed: string[] = [];

  if (marketConditions.hasZeroVolume) {
    if (/volume|liquid|thin|illiquid/i.test(reasoning)) {
      handled.push("zero_volume_acknowledged");
    } else {
      missed.push("zero_volume_ignored");
    }
  }

  if (marketConditions.hasMissingData) {
    if (/missing|unavailable|no data|insufficient|incomplete/i.test(reasoning)) {
      handled.push("missing_data_acknowledged");
    } else {
      missed.push("missing_data_ignored");
    }
  }

  if (marketConditions.hasExtremeMove) {
    const pct = marketConditions.extremeMovePercent ?? 0;
    if (/extreme|unusual|abnormal|volatile|spike|crash|surge|halt/i.test(reasoning)) {
      handled.push(`extreme_move_${pct > 0 ? "up" : "down"}_acknowledged`);
    } else {
      missed.push(`extreme_move_${Math.abs(pct).toFixed(0)}pct_ignored`);
    }

    // Trading into extreme moves without acknowledgment is especially bad
    if (action !== "hold" && missed.length > 0) {
      missed.push("traded_into_extreme_without_acknowledgment");
    }
  }

  const totalCases = handled.length + missed.length;
  const score = totalCases > 0 ? handled.length / totalCases : 1.0;

  return { score, handledEdgeCases: handled, missedEdgeCases: missed };
}

// ---------------------------------------------------------------------------
// Framing Consistency
// ---------------------------------------------------------------------------

/**
 * Detect framing effects: same data, different framing, same decision?
 * E.g., "stock gained 5%" vs "stock failed to gain more than 5%"
 */
export function measureFramingConsistency(
  reasoning: string,
  action: string,
  confidence: number,
): { score: number; framingBiasIndicators: string[] } {
  const indicators: string[] = [];

  // Check for loss aversion markers (asymmetric treatment of gains vs losses)
  const lossReferences = (reasoning.match(/loss|lose|losing|lost|decline|drop|fall|crash/gi) ?? []).length;
  const gainReferences = (reasoning.match(/gain|win|profit|rise|growth|rally|surge/gi) ?? []).length;

  const totalRefs = lossReferences + gainReferences;
  if (totalRefs > 0) {
    const lossRatio = lossReferences / totalRefs;
    if (lossRatio > FRAMING_LOSS_RATIO_HIGH_THRESHOLD && action === "buy") {
      indicators.push("loss_framing_with_buy_decision");
    }
    if (lossRatio < FRAMING_LOSS_RATIO_LOW_THRESHOLD && action === "sell") {
      indicators.push("gain_framing_with_sell_decision");
    }
  }

  // Check for recency bias (over-weighting recent events)
  const recencyPatterns = [
    /just\s+(?:yesterday|today|recently)/i,
    /in\s+the\s+last\s+(?:few|24)\s+(?:hours|minutes)/i,
    /this\s+morning|this\s+afternoon/i,
  ];
  const recencyCount = countByCondition(recencyPatterns, (p) => p.test(reasoning));
  if (recencyCount >= FRAMING_RECENCY_PATTERN_MIN_COUNT) {
    indicators.push("heavy_recency_bias");
  }

  // Check for extreme confidence with simple reasoning
  const wordCount = countWords(reasoning);
  if (confidence > FRAMING_OVERCONFIDENCE_THRESHOLD && wordCount < FRAMING_THIN_REASONING_WORD_COUNT) {
    indicators.push("overconfident_with_thin_reasoning");
  }

  // Check for sunk cost language
  if (/already\s+invested|can't\s+sell\s+now|cost\s+basis|break\s+even/i.test(reasoning)) {
    indicators.push("sunk_cost_language");
  }

  const score = Math.max(0, 1 - indicators.length * FRAMING_BIAS_PENALTY_PER_INDICATOR);
  return { score, framingBiasIndicators: indicators };
}

// ---------------------------------------------------------------------------
// Full Adversarial Analysis
// ---------------------------------------------------------------------------

/**
 * Run the complete adversarial robustness analysis for a trade decision.
 */
export function analyzeAdversarialRobustness(
  reasoning: string,
  action: string,
  symbol: string,
  confidence: number,
  currentPrice: number,
  marketConditions: {
    priceDirection: "up" | "down" | "flat";
    newsDirection: "positive" | "negative" | "neutral";
    hasZeroVolume: boolean;
    hasMissingData: boolean;
    hasExtremeMove: boolean;
    extremeMovePercent?: number;
  },
): {
  overallScore: number;
  signalConflict: ReturnType<typeof detectSignalConflict>;
  anchoring: ReturnType<typeof measureAnchoringResistance>;
  edgeCases: ReturnType<typeof scoreEdgeCaseHandling>;
  framing: ReturnType<typeof measureFramingConsistency>;
  vulnerabilities: string[];
} {
  const signalConflict = detectSignalConflict(
    reasoning,
    marketConditions.priceDirection,
    marketConditions.newsDirection,
  );

  const anchoring = measureAnchoringResistance(reasoning, currentPrice, symbol);

  const edgeCases = scoreEdgeCaseHandling(reasoning, action, marketConditions);

  const framing = measureFramingConsistency(reasoning, action, confidence);

  // Collect all vulnerabilities
  const vulnerabilities: string[] = [];
  if (!signalConflict.agentAcknowledged && signalConflict.conflictPresent) {
    vulnerabilities.push("Missed conflicting signals between price and news");
  }
  for (const ref of anchoring.anchoredReferences) {
    vulnerabilities.push(`Anchored to historical: ${ref}`);
  }
  for (const missed of edgeCases.missedEdgeCases) {
    vulnerabilities.push(`Edge case missed: ${missed}`);
  }
  for (const bias of framing.framingBiasIndicators) {
    vulnerabilities.push(`Framing bias: ${bias}`);
  }

  // Weighted aggregate
  const overallScore = Math.round(
    (signalConflict.score * COMPOSITE_WEIGHT_SIGNAL_CONFLICT +
      anchoring.score * COMPOSITE_WEIGHT_ANCHORING +
      edgeCases.score * COMPOSITE_WEIGHT_EDGE_CASES +
      framing.score * COMPOSITE_WEIGHT_FRAMING) * SCORE_PRECISION_MULTIPLIER
  ) / SCORE_PRECISION_MULTIPLIER;

  return {
    overallScore,
    signalConflict,
    anchoring,
    edgeCases,
    framing,
    vulnerabilities,
  };
}

// ---------------------------------------------------------------------------
// Recording & Profiles
// ---------------------------------------------------------------------------

/**
 * Record an adversarial test result.
 */
export function recordAdversarialResult(
  agentId: string,
  result: {
    overallScore: number;
    vulnerabilities: string[];
    signalConflictScore: number;
    anchoringScore: number;
    edgeCaseScore: number;
    framingScore: number;
  },
): void {
  const tests = testHistory.get(agentId) ?? [];
  tests.push({
    testId: `adv_${Date.now()}_${Math.random().toString(36).slice(ID_RANDOM_START, ID_RANDOM_START + ID_RANDOM_LENGTH_SHORT)}`,
    agentId,
    testType: "signal_conflict", // Primary test type
    baselineReasoning: "",
    adversarialReasoning: "",
    baselineAction: "",
    adversarialAction: "",
    susceptibility: 1 - result.overallScore,
    vulnerabilities: result.vulnerabilities,
    adversarialAwareness: result.vulnerabilities.length === 0,
    timestamp: new Date().toISOString(),
  });

  if (tests.length > MAX_HISTORY) tests.splice(0, tests.length - MAX_HISTORY);
  testHistory.set(agentId, tests);
}

/**
 * Record a reasoning snapshot for noise sensitivity comparison.
 */
export function recordReasoningForComparison(snapshot: ReasoningSnapshot): void {
  const snaps = reasoningPairs.get(snapshot.agentId) ?? [];
  snaps.push(snapshot);
  if (snaps.length > MAX_SNAPSHOT_HISTORY) snaps.splice(0, snaps.length - MAX_SNAPSHOT_HISTORY);
  reasoningPairs.set(snapshot.agentId, snaps);
}

/**
 * Get the robustness profile for an agent.
 */
export function getAgentRobustnessProfile(agentId: string): AgentRobustnessProfile {
  const tests = testHistory.get(agentId) ?? [];

  if (tests.length === 0) {
    return {
      agentId,
      overallScore: 0.5,
      testCount: 0,
      scores: {
        signalConflict: 0.5,
        anchoringResistance: 0.5,
        noiseSensitivity: 0.5,
        edgeCaseHandling: 0.5,
        framingConsistency: 0.5,
      },
      topVulnerabilities: [],
      trend: "stable",
      lastUpdated: new Date().toISOString(),
    };
  }

  const avgSusceptibility = tests.reduce((s, t) => s + t.susceptibility, 0) / tests.length;

  // Aggregate vulnerabilities
  const vulnCounts = new Map<string, number>();
  for (const t of tests) {
    for (const v of t.vulnerabilities) {
      vulnCounts.set(v, (vulnCounts.get(v) ?? 0) + 1);
    }
  }
  const topVulnerabilities = [...vulnCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_ANALYSIS_ITEMS_LIMIT)
    .map(([v]) => v);

  // Trend: compare first half vs second half
  const mid = Math.floor(tests.length / 2);
  const firstHalf = tests.slice(0, mid);
  const secondHalf = tests.slice(mid);
  const firstAvg = avgOfProperty(firstHalf, 'susceptibility');
  const secondAvg = avgOfProperty(secondHalf, 'susceptibility');
  const trend: "improving" | "stable" | "declining" =
    secondAvg < firstAvg - 0.05 ? "improving" :
    secondAvg > firstAvg + 0.05 ? "declining" : "stable";

  return {
    agentId,
    overallScore: round3(1 - avgSusceptibility),
    testCount: tests.length,
    scores: {
      signalConflict: 0.5, // Would be enriched with individual test breakdowns
      anchoringResistance: 0.5,
      noiseSensitivity: 0.5,
      edgeCaseHandling: 0.5,
      framingConsistency: 0.5,
    },
    topVulnerabilities,
    trend,
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Get all agent robustness profiles.
 */
export function getAllRobustnessProfiles(): AgentRobustnessProfile[] {
  const agentIds = [...testHistory.keys()];
  return agentIds.map(getAgentRobustnessProfile);
}

/**
 * Compute the adversarial robustness pillar score (0-1).
 */
export function getAdversarialPillarScore(agentId: string): number {
  const profile = getAgentRobustnessProfile(agentId);
  return profile.overallScore;
}
