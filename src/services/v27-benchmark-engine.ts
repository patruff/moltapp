/**
 * v27 Benchmark Engine
 *
 * Two new analysis engines that push MoltApp to a 14-dimension benchmark:
 *
 * 1. EXECUTION QUALITY ANALYZER
 *    Measures how well an agent's reasoning addresses execution concerns:
 *    slippage awareness, price realism, timing rationale, execution plan
 *    quality, and market impact awareness. Agents that reason about *how*
 *    they would execute a trade -- not just *what* to trade -- score higher.
 *
 * 2. CROSS-ROUND LEARNING TRACKER
 *    Measures whether agents learn from past trades. Tracks references to
 *    previous rounds, lesson application, mistake repetition avoidance,
 *    strategy adaptation (via 3-gram Jaccard distance), outcome integration,
 *    and reasoning evolution over time.
 *
 * Both engines feed scores into the v27 composite benchmark scoring system,
 * which combines all 14 dimensions with calibrated weights.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecutionQualityResult {
  /** Awareness of slippage, liquidity, and spread concerns (0-1) */
  slippageAwareness: number;
  /** Whether price expectations match market data (0-1) */
  priceRealism: number;
  /** Quality of timing rationale for the trade (0-1) */
  timingRationale: number;
  /** Specificity and quality of execution plan (0-1) */
  executionPlanQuality: number;
  /** Awareness of market impact from trade size (0-1) */
  marketImpactAwareness: number;
  /** Composite execution quality score (0-1) */
  executionQualityScore: number;
}

export interface CrossRoundLearningResult {
  /** Count of references to past trades in reasoning */
  referencedPastTrades: number;
  /** How well lessons from past outcomes are applied (0-1) */
  lessonApplication: number;
  /** Whether the agent avoids repeating past mistakes (0-1, 1 = no repeats) */
  mistakeRepetition: number;
  /** How much the strategy has adapted over time (0-1) */
  strategyAdaptation: number;
  /** Whether reasoning integrates past outcome data (0-1) */
  outcomeIntegration: number;
  /** Evolution of reasoning depth and complexity (0-1) */
  reasoningEvolution: number;
  /** Composite learning score (0-1) */
  learningScore: number;
  /** Round IDs from past decisions that were referenced */
  previousRoundIds: string[];
}

export interface V27CompositeScore {
  /** P&L performance (0-1) */
  pnl: number;
  /** Reasoning coherence (0-1) */
  coherence: number;
  /** Freedom from hallucinated data (0-1) */
  hallucinationFree: number;
  /** Trading discipline adherence (0-1) */
  discipline: number;
  /** Confidence calibration accuracy (0-1) */
  calibration: number;
  /** Prediction accuracy over time (0-1) */
  predictionAccuracy: number;
  /** Depth and rigor of reasoning (0-1) */
  reasoningDepth: number;
  /** Quality and use of data sources (0-1) */
  sourceQuality: number;
  /** Accuracy of outcome predictions (0-1) */
  outcomePrediction: number;
  /** Ability to synthesize consensus views (0-1) */
  consensusIntelligence: number;
  /** Strategy consistency via genome analysis (0-1) */
  strategyGenome: number;
  /** Risk-reward management discipline (0-1) */
  riskRewardDiscipline: number;
  /** Execution quality awareness (0-1) */
  executionQuality: number;
  /** Learning from past rounds (0-1) */
  crossRoundLearning: number;
  /** Weighted composite score (0-100) */
  composite: number;
  /** Letter grade (S, A+, A, B+, B, C, D, F) */
  grade: string;
}

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Count-to-Score Mapping Configuration
 *
 * These constants control how discrete indicator counts (e.g., number of
 * slippage awareness keywords, past trade references, execution plan details)
 * are mapped to continuous quality scores (0-1 scale).
 *
 * Used by countToScore() function throughout execution quality and
 * cross-round learning analysis.
 */

/** Score when 1 indicator detected (minimal presence) */
const SCORE_FROM_ONE_INDICATOR = 0.3;
/** Score when 2 indicators detected (moderate presence) */
const SCORE_FROM_TWO_INDICATORS = 0.6;
/** Score when 3 indicators detected (strong presence) */
const SCORE_FROM_THREE_INDICATORS = 0.8;
/** Score when 4+ indicators detected (excellent presence) */
const SCORE_FROM_FOUR_PLUS_INDICATORS = 1.0;

// ---------------------------------------------------------------------------
// In-memory stores (for quick reads)
// ---------------------------------------------------------------------------

const executionQualityHistory = new Map<string, ExecutionQualityResult[]>();
const crossRoundLearningHistory = new Map<string, CrossRoundLearningResult[]>();
const v27LeaderboardCache = new Map<string, V27CompositeScore>();

// ---------------------------------------------------------------------------
// Execution Quality Analyzer
// ---------------------------------------------------------------------------

/**
 * Score a count of regex matches to a 0-1 score using the thresholds:
 * 0 matches = 0.0, 1 = 0.3, 2 = 0.6, 3 = 0.8, 4+ = 1.0
 */
function countToScore(count: number): number {
  if (count <= 0) return 0.0;
  if (count === 1) return SCORE_FROM_ONE_INDICATOR;
  if (count === 2) return SCORE_FROM_TWO_INDICATORS;
  if (count === 3) return SCORE_FROM_THREE_INDICATORS;
  return SCORE_FROM_FOUR_PLUS_INDICATORS;
}

/**
 * Count all non-overlapping matches of a regex pattern in a string.
 */
function countMatches(text: string, pattern: RegExp): number {
  const globalPattern = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
  const matches = text.match(globalPattern);
  return matches ? matches.length : 0;
}

/**
 * Extract price values from reasoning text.
 * Matches patterns like $1.23, 0.045, price of 123.45, etc.
 */
function extractPricesFromReasoning(reasoning: string): number[] {
  const pricePattern = /\$?\b(\d+(?:\.\d+)?)\b/g;
  const prices: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = pricePattern.exec(reasoning)) !== null) {
    const val = parseFloat(match[1]);
    // Filter out obviously non-price values (percentages, years, counts)
    if (val > 0 && val < 1_000_000) {
      prices.push(val);
    }
  }
  return prices;
}

/**
 * Analyze the execution quality of an agent's reasoning for a single trade.
 *
 * Measures five sub-dimensions:
 * - Slippage awareness: does the agent discuss slippage, liquidity, spread?
 * - Price realism: do mentioned prices align with actual market data?
 * - Timing rationale: does the agent explain *why now*?
 * - Execution plan quality: does the agent specify an execution method?
 * - Market impact awareness: does the agent consider trade size vs. volume?
 */
export function analyzeExecutionQuality(
  reasoning: string,
  action: "buy" | "sell" | "hold",
  tradeQuantity: number,
  marketData: { symbol: string; price: number; volume24h: number | null }[],
  targetSymbol: string,
): ExecutionQualityResult {
  // -----------------------------------------------------------------------
  // 1. Slippage Awareness
  // -----------------------------------------------------------------------
  const slippagePattern = /slippage|slip|market\s+impact|liquidity|spread|order\s+book/gi;
  const slippageCount = countMatches(reasoning, slippagePattern);
  const slippageAwareness = countToScore(slippageCount);

  // -----------------------------------------------------------------------
  // 2. Price Realism
  // -----------------------------------------------------------------------
  let priceRealism: number;
  if (action === "hold") {
    priceRealism = 0.8; // Neutral default for holds
  } else {
    const mentionedPrices = extractPricesFromReasoning(reasoning);
    const targetMarket = marketData.find(
      (m) => m.symbol.toLowerCase() === targetSymbol.toLowerCase(),
    );

    if (mentionedPrices.length === 0 || !targetMarket) {
      // No price mentioned or no market data: neutral score
      priceRealism = 0.5;
    } else {
      const marketPrice = targetMarket.price;
      // Check if any mentioned price is within tolerance of market price
      let bestMatch = Infinity;
      for (const p of mentionedPrices) {
        const deviation = Math.abs(p - marketPrice) / marketPrice;
        if (deviation < bestMatch) {
          bestMatch = deviation;
        }
      }

      if (bestMatch <= 0.05) {
        priceRealism = 1.0; // Within 5% tolerance
      } else if (bestMatch <= 0.20) {
        // Linear interpolation between 5% and 20% deviation
        priceRealism = 1.0 - ((bestMatch - 0.05) / 0.15) * 0.8;
        priceRealism = Math.round(priceRealism * 100) / 100;
      } else {
        priceRealism = 0.2; // Off by more than 20%
      }
    }
  }

  // -----------------------------------------------------------------------
  // 3. Timing Rationale
  // -----------------------------------------------------------------------
  const timingPattern = /now\s+because|timing|window|catalyst|before\s+earnings|after\s+hours|market\s+open|momentum\s+shift|entry\s+point|current\s+level/gi;
  const timingCount = countMatches(reasoning, timingPattern);
  const timingRationale = countToScore(timingCount);

  // -----------------------------------------------------------------------
  // 4. Execution Plan Quality
  // -----------------------------------------------------------------------
  const execPlanPattern = /limit\s+order|market\s+order|TWAP|VWAP|DCA|scale\s+in|partial\s+fill|tranche|gradually|incrementally/gi;
  const execPlanCount = countMatches(reasoning, execPlanPattern);
  const executionPlanQuality = countToScore(execPlanCount);

  // -----------------------------------------------------------------------
  // 5. Market Impact Awareness
  // -----------------------------------------------------------------------
  const impactPattern = /volume|thin\s+market|impact|depth|size\s+relative/gi;
  const impactCount = countMatches(reasoning, impactPattern);
  const marketImpactAwareness = countToScore(impactCount);

  // -----------------------------------------------------------------------
  // Composite
  // -----------------------------------------------------------------------
  const executionQualityScore = Math.round(
    (slippageAwareness * 0.20 +
      priceRealism * 0.25 +
      timingRationale * 0.25 +
      executionPlanQuality * 0.15 +
      marketImpactAwareness * 0.15) *
      100,
  ) / 100;

  return {
    slippageAwareness: Math.round(slippageAwareness * 100) / 100,
    priceRealism: Math.round(priceRealism * 100) / 100,
    timingRationale: Math.round(timingRationale * 100) / 100,
    executionPlanQuality: Math.round(executionPlanQuality * 100) / 100,
    marketImpactAwareness: Math.round(marketImpactAwareness * 100) / 100,
    executionQualityScore,
  };
}

// ---------------------------------------------------------------------------
// Cross-Round Learning Tracker
// ---------------------------------------------------------------------------

/**
 * Generate a set of character 3-grams from a string.
 */
function extractThreeGrams(text: string): Set<string> {
  const grams = new Set<string>();
  const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
  for (let i = 0; i <= normalized.length - 3; i++) {
    grams.add(normalized.substring(i, i + 3));
  }
  return grams;
}

/**
 * Calculate Jaccard distance between two sets: 1 - |intersection| / |union|.
 * Returns a value between 0 (identical) and 1 (completely different).
 */
function jaccardDistance(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;

  let intersectionSize = 0;
  for (const item of a) {
    if (b.has(item)) {
      intersectionSize++;
    }
  }

  const unionSize = a.size + b.size - intersectionSize;
  if (unionSize === 0) return 0;

  return 1 - intersectionSize / unionSize;
}

/**
 * Analyze cross-round learning for an agent.
 *
 * Measures whether agents learn from their trading history by examining:
 * - References to past trades in current reasoning
 * - Application of lessons from past outcomes
 * - Avoidance of repeated mistakes
 * - Strategy vocabulary evolution (3-gram Jaccard distance)
 * - Integration of outcome data from prior rounds
 * - Reasoning depth evolution over time
 */
export function analyzeCrossRoundLearning(
  reasoning: string,
  agentId: string,
  currentRoundId: string,
  pastDecisions: Array<{
    roundId: string;
    action: string;
    symbol: string;
    reasoning: string;
    coherenceScore: number;
    outcome?: string;
  }>,
): CrossRoundLearningResult {
  // -----------------------------------------------------------------------
  // 1. Referenced Past Trades
  // -----------------------------------------------------------------------
  const pastRefPattern = /previous|last\s+time|earlier|learned|past\s+trade|historically|before.*trade|my\s+last|round\s+\d+/gi;
  let referencedPastTrades = countMatches(reasoning, pastRefPattern);

  // Also check if reasoning mentions symbols from past decisions
  const pastSymbols = new Set(pastDecisions.map((d) => d.symbol.toLowerCase()));
  const reasoningLower = reasoning.toLowerCase();
  for (const sym of pastSymbols) {
    if (reasoningLower.includes(sym)) {
      referencedPastTrades++;
    }
  }

  // Identify which round IDs are referenced
  const previousRoundIds: string[] = [];
  for (const decision of pastDecisions) {
    // Check if the round ID appears in reasoning
    if (reasoning.includes(decision.roundId)) {
      previousRoundIds.push(decision.roundId);
    }
    // Also consider a reference if a past symbol is mentioned together with
    // any past-reference keyword
    if (
      pastRefPattern.test(reasoning) &&
      reasoningLower.includes(decision.symbol.toLowerCase())
    ) {
      if (!previousRoundIds.includes(decision.roundId)) {
        previousRoundIds.push(decision.roundId);
      }
    }
  }

  // -----------------------------------------------------------------------
  // 2. Lesson Application
  // -----------------------------------------------------------------------
  let lessonApplication: number;
  if (pastDecisions.length === 0) {
    lessonApplication = 0.5; // Neutral when no history
  } else {
    const badOutcomes = pastDecisions.filter(
      (d) =>
        d.outcome === "loss" ||
        d.outcome === "failure" ||
        d.outcome === "negative" ||
        d.coherenceScore < 0.4,
    );

    if (badOutcomes.length === 0) {
      // No past failures to learn from -- moderate baseline
      lessonApplication = 0.6;
    } else {
      // Check if reasoning mentions adjustment, lesson, or mistake
      const lessonPattern = /adjust|lesson|mistake|corrected|improved|changed\s+approach|learned\s+from|won't\s+repeat|avoid\s+this\s+time|different\s+strategy|refined/gi;
      const lessonMentions = countMatches(reasoning, lessonPattern);

      if (lessonMentions >= 3) {
        lessonApplication = 1.0;
      } else if (lessonMentions === 2) {
        lessonApplication = 0.8;
      } else if (lessonMentions === 1) {
        lessonApplication = 0.6;
      } else {
        // Bad outcomes exist but no lessons mentioned
        lessonApplication = 0.2;
      }
    }
  }

  // -----------------------------------------------------------------------
  // 3. Mistake Repetition
  // -----------------------------------------------------------------------
  let mistakeRepetition: number;
  const failedPastTrades = pastDecisions.filter(
    (d) =>
      d.outcome === "loss" ||
      d.outcome === "failure" ||
      d.outcome === "negative",
  );

  if (failedPastTrades.length === 0) {
    mistakeRepetition = 0.8; // Neutral when no past failures
  } else {
    // Check if current trade repeats a failed pattern:
    // Same symbol + same action direction + similar reasoning
    let repeatsFound = false;
    for (const failed of failedPastTrades) {
      const sameSymbol = reasoningLower.includes(failed.symbol.toLowerCase());
      const sameAction = reasoningLower.includes(failed.action.toLowerCase());

      // Check reasoning similarity using 3-grams
      const currentGrams = extractThreeGrams(reasoning);
      const pastGrams = extractThreeGrams(failed.reasoning);
      const distance = jaccardDistance(currentGrams, pastGrams);
      const similarReasoning = distance < 0.3; // Very similar reasoning

      if (sameSymbol && sameAction && similarReasoning) {
        repeatsFound = true;
        break;
      }
    }

    mistakeRepetition = repeatsFound ? 0.0 : 1.0;
  }

  // -----------------------------------------------------------------------
  // 4. Strategy Adaptation (3-gram Jaccard distance)
  // -----------------------------------------------------------------------
  let strategyAdaptation: number;
  if (pastDecisions.length === 0) {
    strategyAdaptation = 0.5; // Neutral
  } else {
    const currentGrams = extractThreeGrams(reasoning);
    const allPastGrams = new Set<string>();
    for (const d of pastDecisions) {
      for (const gram of extractThreeGrams(d.reasoning)) {
        allPastGrams.add(gram);
      }
    }

    const distance = jaccardDistance(currentGrams, allPastGrams);
    // Higher distance means more vocabulary evolution = higher score.
    // But extreme distance (> 0.9) might mean incoherent shift, so cap at 0.9.
    strategyAdaptation = Math.min(distance, 0.9);
    strategyAdaptation = Math.round(strategyAdaptation * 100) / 100;
  }

  // -----------------------------------------------------------------------
  // 5. Outcome Integration
  // -----------------------------------------------------------------------
  const outcomePattern = /outcome|result|performed|worked|didn't\s+work|failed|succeeded|profit|loss\s+from/gi;
  const outcomeCount = countMatches(reasoning, outcomePattern);
  const outcomeIntegration = countToScore(outcomeCount);

  // -----------------------------------------------------------------------
  // 6. Reasoning Evolution
  // -----------------------------------------------------------------------
  let reasoningEvolution: number;
  if (pastDecisions.length === 0) {
    reasoningEvolution = 0.5; // Neutral
  } else {
    const pastLengths = pastDecisions.map((d) => d.reasoning.length);
    const avgPastLength =
      pastLengths.reduce((sum, l) => sum + l, 0) / pastLengths.length;

    const currentLength = reasoning.length;

    // Longer, more detailed reasoning = evolution
    if (avgPastLength === 0) {
      reasoningEvolution = currentLength > 0 ? 1.0 : 0.5;
    } else {
      const lengthRatio = currentLength / avgPastLength;

      if (lengthRatio >= 1.5) {
        reasoningEvolution = 1.0; // Significantly more detailed
      } else if (lengthRatio >= 1.2) {
        reasoningEvolution = 0.8;
      } else if (lengthRatio >= 0.9) {
        reasoningEvolution = 0.6; // Roughly the same depth
      } else if (lengthRatio >= 0.6) {
        reasoningEvolution = 0.4; // Regression
      } else {
        reasoningEvolution = 0.2; // Major regression in depth
      }
    }

    // Also factor in structural complexity: count of sentences
    const currentSentences = (reasoning.match(/[.!?]+/g) || []).length;
    const pastSentences = pastDecisions.map(
      (d) => (d.reasoning.match(/[.!?]+/g) || []).length,
    );
    const avgPastSentences =
      pastSentences.reduce((sum, s) => sum + s, 0) / pastSentences.length;

    if (avgPastSentences > 0 && currentSentences > avgPastSentences * 1.2) {
      // Bonus for structural improvement
      reasoningEvolution = Math.min(1.0, reasoningEvolution + 0.1);
    }

    reasoningEvolution = Math.round(reasoningEvolution * 100) / 100;
  }

  // -----------------------------------------------------------------------
  // Composite Learning Score
  // -----------------------------------------------------------------------
  const learningScore = Math.round(
    (lessonApplication * 0.25 +
      mistakeRepetition * 0.20 +
      strategyAdaptation * 0.20 +
      outcomeIntegration * 0.20 +
      reasoningEvolution * 0.15) *
      100,
  ) / 100;

  return {
    referencedPastTrades,
    lessonApplication: Math.round(lessonApplication * 100) / 100,
    mistakeRepetition: Math.round(mistakeRepetition * 100) / 100,
    strategyAdaptation,
    outcomeIntegration: Math.round(outcomeIntegration * 100) / 100,
    reasoningEvolution,
    learningScore,
    previousRoundIds,
  };
}

// ---------------------------------------------------------------------------
// v27 Composite Scoring
// ---------------------------------------------------------------------------

/**
 * Dimension weights for the v27 composite score.
 * Total weight = 100; composite = sum(dimension * weight) / sum(weights) * 100.
 */
const V27_WEIGHTS: Record<string, number> = {
  pnl: 12,
  coherence: 10,
  hallucinationFree: 8,
  discipline: 8,
  calibration: 7,
  predictionAccuracy: 7,
  reasoningDepth: 7,
  sourceQuality: 6,
  outcomePrediction: 6,
  consensusIntelligence: 5,
  strategyGenome: 6,
  riskRewardDiscipline: 6,
  executionQuality: 6,
  crossRoundLearning: 6,
};

/**
 * Compute the v27 composite benchmark score across all 14 dimensions.
 *
 * Each dimension is a 0-1 score. The composite is a weighted average
 * scaled to 0-100, with a letter grade assigned.
 */
export function computeV27Composite(dimensions: {
  pnl: number;
  coherence: number;
  hallucinationFree: number;
  discipline: number;
  calibration: number;
  predictionAccuracy: number;
  reasoningDepth: number;
  sourceQuality: number;
  outcomePrediction: number;
  consensusIntelligence: number;
  strategyGenome: number;
  riskRewardDiscipline: number;
  executionQuality: number;
  crossRoundLearning: number;
}): { composite: number; grade: string } {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const [dim, weight] of Object.entries(V27_WEIGHTS)) {
    const score = (dimensions as Record<string, number>)[dim] ?? 0;
    weightedSum += score * weight;
    totalWeight += weight;
  }

  const composite =
    totalWeight > 0
      ? Math.round((weightedSum / totalWeight) * 100 * 100) / 100
      : 0;

  let grade: string;
  if (composite >= 90) {
    grade = "S";
  } else if (composite >= 85) {
    grade = "A+";
  } else if (composite >= 80) {
    grade = "A";
  } else if (composite >= 70) {
    grade = "B+";
  } else if (composite >= 60) {
    grade = "B";
  } else if (composite >= 50) {
    grade = "C";
  } else if (composite >= 35) {
    grade = "D";
  } else {
    grade = "F";
  }

  return { composite, grade };
}

// ---------------------------------------------------------------------------
// History & Leaderboard Accessors
// ---------------------------------------------------------------------------

/**
 * Get the execution quality score history for an agent.
 */
export function getExecutionQualityHistory(
  agentId: string,
): ExecutionQualityResult[] {
  return executionQualityHistory.get(agentId) ?? [];
}

/**
 * Get the cross-round learning score history for an agent.
 */
export function getCrossRoundLearningHistory(
  agentId: string,
): CrossRoundLearningResult[] {
  return crossRoundLearningHistory.get(agentId) ?? [];
}

/**
 * Get the full v27 leaderboard cache.
 */
export function getV27Leaderboard(): Map<string, V27CompositeScore> {
  return v27LeaderboardCache;
}

/**
 * Record execution quality and cross-round learning scores for an agent.
 * Appends to the per-agent history arrays in memory.
 */
export function recordV27Scores(
  agentId: string,
  executionQuality: ExecutionQualityResult,
  crossRoundLearning: CrossRoundLearningResult,
): void {
  // Store execution quality
  const eqHistory = executionQualityHistory.get(agentId) ?? [];
  eqHistory.push(executionQuality);
  executionQualityHistory.set(agentId, eqHistory);

  // Store cross-round learning
  const crlHistory = crossRoundLearningHistory.get(agentId) ?? [];
  crlHistory.push(crossRoundLearning);
  crossRoundLearningHistory.set(agentId, crlHistory);
}

/**
 * Update the v27 leaderboard cache for an agent.
 */
export function updateV27Leaderboard(
  agentId: string,
  scores: V27CompositeScore,
): void {
  v27LeaderboardCache.set(agentId, scores);
}
