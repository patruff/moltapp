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
    return { conflictPresent: false, agentAcknowledged: false, score: 1.0 };
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
  const score = agentAcknowledged ? 1.0 : 0.3;

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
      if (deviation < 0.20) nearCurrentCount++;
      else farFromCurrentCount++;
    }
  }

  // Score: penalize heavy anchoring to historical data without current context
  let score = 1.0;
  if (anchoredRefs.length > 0 && !hasCurrentData) {
    score -= 0.3; // Anchoring without current data
  }
  if (anchoredRefs.length > 2) {
    score -= 0.2; // Excessive historical anchoring
  }
  if (farFromCurrentCount > nearCurrentCount && priceRefs.length > 0) {
    score -= 0.15; // More irrelevant price references than relevant ones
  }

  return {
    score: Math.max(0, Math.min(1, score)),
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
  if (actionFlipped) score -= 0.4;
  if (confidenceSwing > 0.3) score -= 0.2;
  if (textDivergence > 0.7) score -= 0.2;
  if (confidenceSwing > 0.15) score -= 0.1;

  return {
    score: Math.max(0, Math.min(1, score)),
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
    if (lossRatio > 0.75 && action === "buy") {
      indicators.push("loss_framing_with_buy_decision");
    }
    if (lossRatio < 0.25 && action === "sell") {
      indicators.push("gain_framing_with_sell_decision");
    }
  }

  // Check for recency bias (over-weighting recent events)
  const recencyPatterns = [
    /just\s+(?:yesterday|today|recently)/i,
    /in\s+the\s+last\s+(?:few|24)\s+(?:hours|minutes)/i,
    /this\s+morning|this\s+afternoon/i,
  ];
  const recencyCount = recencyPatterns.filter((p) => p.test(reasoning)).length;
  if (recencyCount >= 2) {
    indicators.push("heavy_recency_bias");
  }

  // Check for extreme confidence with simple reasoning
  const wordCount = reasoning.split(/\s+/).length;
  if (confidence > 0.85 && wordCount < 40) {
    indicators.push("overconfident_with_thin_reasoning");
  }

  // Check for sunk cost language
  if (/already\s+invested|can't\s+sell\s+now|cost\s+basis|break\s+even/i.test(reasoning)) {
    indicators.push("sunk_cost_language");
  }

  const score = Math.max(0, 1 - indicators.length * 0.2);
  return { score, framingBiasIndicators: indicators };
}

// ---------------------------------------------------------------------------
// Full Adversarial Analysis
// ---------------------------------------------------------------------------

/**
 * Run the complete adversarial robustness analysis for a trade decision.
 */
export function analyzeAdversarialRobustness(
  agentId: string,
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
    (signalConflict.score * 0.25 +
      anchoring.score * 0.25 +
      edgeCases.score * 0.25 +
      framing.score * 0.25) * 1000
  ) / 1000;

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
  roundId: string,
): void {
  const tests = testHistory.get(agentId) ?? [];
  tests.push({
    testId: `adv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
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
  if (snaps.length > 100) snaps.splice(0, snaps.length - 100);
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
    .slice(0, 5)
    .map(([v]) => v);

  // Trend: compare first half vs second half
  const mid = Math.floor(tests.length / 2);
  const firstHalf = tests.slice(0, mid);
  const secondHalf = tests.slice(mid);
  const firstAvg = firstHalf.length > 0 ? firstHalf.reduce((s, t) => s + t.susceptibility, 0) / firstHalf.length : 0;
  const secondAvg = secondHalf.length > 0 ? secondHalf.reduce((s, t) => s + t.susceptibility, 0) / secondHalf.length : 0;
  const trend: "improving" | "stable" | "declining" =
    secondAvg < firstAvg - 0.05 ? "improving" :
    secondAvg > firstAvg + 0.05 ? "declining" : "stable";

  return {
    agentId,
    overallScore: Math.round((1 - avgSusceptibility) * 1000) / 1000,
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
