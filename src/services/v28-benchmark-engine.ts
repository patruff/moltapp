/**
 * v28 Benchmark Engine
 *
 * Two new analysis engines that push MoltApp to a 16-dimension benchmark:
 *
 * 1. TRADE ACCOUNTABILITY ANALYZER
 *    Measures whether agents demonstrate intellectual honesty about their
 *    past outcomes. Sub-dimensions:
 *    - Loss acknowledgment: does the agent mention past losses?
 *    - Blame avoidance: does it avoid blaming external factors?
 *    - Error specificity: does it explain WHAT it got wrong?
 *    - Corrective action: does it propose fixes for past errors?
 *    - Self-report accuracy: does it honestly report its record?
 *    - Intellectual humility: does it express appropriate uncertainty?
 *
 * 2. REASONING QUALITY INDEX (RQI) ANALYZER
 *    Structural meta-analysis of reasoning quality:
 *    - Logical chain length: how many explicit reasoning steps?
 *    - Evidence density: how many evidence citations per claim?
 *    - Counter-argument quality: does it consider opposing views?
 *    - Conclusion clarity: is the final recommendation clear?
 *    - Quantitative rigor: does it use specific numbers?
 *    - Conditional reasoning: does it use if/then logic?
 *
 * Both engines feed scores into the v28 composite benchmark scoring system,
 * which combines all 16 dimensions with calibrated weights.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TradeAccountabilityResult {
  /** Does the agent acknowledge past losses/mistakes? (0-1) */
  lossAcknowledgment: number;
  /** Does the agent avoid blaming external factors? (0-1, 1 = no blame-shifting) */
  blameAvoidance: number;
  /** Does the agent specify what it got wrong? (0-1) */
  errorSpecificity: number;
  /** Does the agent propose corrective action? (0-1) */
  correctiveAction: number;
  /** Does the agent honestly report its own record? (0-1) */
  selfReportAccuracy: number;
  /** Does the agent show intellectual humility? (0-1) */
  intellectualHumility: number;
  /** Composite accountability score (0-1) */
  accountabilityScore: number;
}

export interface ReasoningQualityIndexResult {
  /** How many logical steps are chained together? (0-1) */
  logicalChainLength: number;
  /** Evidence citations per claim (0-1) */
  evidenceDensity: number;
  /** Quality of counterargument consideration (0-1) */
  counterArgumentQuality: number;
  /** Clarity of the final conclusion/recommendation (0-1) */
  conclusionClarity: number;
  /** Use of specific numbers and quantification (0-1) */
  quantitativeRigor: number;
  /** Use of conditional/if-then reasoning (0-1) */
  conditionalReasoning: number;
  /** Composite RQI score (0-1) */
  rqiScore: number;
  /** Detailed structure breakdown */
  structureBreakdown: {
    claimsFound: number;
    evidenceCitations: number;
    counterArguments: number;
    conditionals: number;
    quantifiedClaims: number;
    logicalConnectors: number;
  };
}

export interface V28CompositeScore {
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
  tradeAccountability: number;
  reasoningQualityIndex: number;
  composite: number;
  grade: string;
}

// ---------------------------------------------------------------------------
// In-memory stores
// ---------------------------------------------------------------------------

const accountabilityHistory = new Map<string, TradeAccountabilityResult[]>();
const rqiHistory = new Map<string, ReasoningQualityIndexResult[]>();
const v28LeaderboardCache = new Map<string, V28CompositeScore>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countMatches(text: string, pattern: RegExp): number {
  const globalPattern = new RegExp(
    pattern.source,
    pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g",
  );
  const matches = text.match(globalPattern);
  return matches ? matches.length : 0;
}

function countToScore(count: number): number {
  if (count <= 0) return 0.0;
  if (count === 1) return 0.3;
  if (count === 2) return 0.6;
  if (count === 3) return 0.8;
  return 1.0;
}

function clamp01(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Trade Accountability Analyzer
// ---------------------------------------------------------------------------

/**
 * Analyze whether an agent demonstrates intellectual honesty about its
 * past trading outcomes.
 *
 * Agents that acknowledge mistakes, avoid blame-shifting, propose corrections,
 * and show humility score higher. This dimension rewards honest self-assessment
 * over confident but delusional reasoning.
 */
export function analyzeTradeAccountability(
  reasoning: string,
  pastDecisions: Array<{
    action: string;
    symbol: string;
    reasoning: string;
    outcome?: string;
    coherenceScore: number;
  }>,
): TradeAccountabilityResult {
  const lower = reasoning.toLowerCase();

  // -----------------------------------------------------------------------
  // 1. Loss Acknowledgment — does the agent mention past losses/errors?
  // -----------------------------------------------------------------------
  let lossAcknowledgment: number;
  const pastLosses = pastDecisions.filter(
    (d) =>
      d.outcome === "loss" ||
      d.outcome === "failure" ||
      d.outcome === "negative" ||
      d.coherenceScore < 0.3,
  );

  if (pastLosses.length === 0) {
    // No losses to acknowledge — neutral baseline
    lossAcknowledgment = 0.7;
  } else {
    const lossPattern =
      /loss|lost|mistake|wrong|error|misjudged|poor\s+call|bad\s+trade|underperform|regret|should\s+not\s+have/gi;
    const lossCount = countMatches(reasoning, lossPattern);

    if (lossCount >= 3) {
      lossAcknowledgment = 1.0;
    } else if (lossCount === 2) {
      lossAcknowledgment = 0.8;
    } else if (lossCount === 1) {
      lossAcknowledgment = 0.5;
    } else {
      // Has past losses but doesn't acknowledge them
      lossAcknowledgment = 0.1;
    }
  }

  // -----------------------------------------------------------------------
  // 2. Blame Avoidance — penalize blame-shifting to external factors
  // -----------------------------------------------------------------------
  const blamePattern =
    /market\s+was\s+irrational|unexpected\s+event|couldn't\s+have\s+predicted|no\s+one\s+could|black\s+swan|unforeseen|manipulation|rigged/gi;
  const blameCount = countMatches(reasoning, blamePattern);

  // More blame-shifting = lower score
  let blameAvoidance: number;
  if (blameCount === 0) {
    blameAvoidance = 1.0;
  } else if (blameCount === 1) {
    blameAvoidance = 0.7;
  } else if (blameCount === 2) {
    blameAvoidance = 0.4;
  } else {
    blameAvoidance = 0.1;
  }

  // -----------------------------------------------------------------------
  // 3. Error Specificity — does the agent explain WHAT it got wrong?
  // -----------------------------------------------------------------------
  const errorSpecPattern =
    /i\s+was\s+wrong\s+about|my\s+mistake\s+was|incorrect\s+assumption|misjudged\s+the|overestimated|underestimated|failed\s+to\s+consider|overlooked|my\s+analysis\s+missed/gi;
  const errorSpecCount = countMatches(reasoning, errorSpecPattern);
  const errorSpecificity = pastLosses.length === 0
    ? 0.6 // Neutral when no errors to specify
    : countToScore(errorSpecCount);

  // -----------------------------------------------------------------------
  // 4. Corrective Action — does the agent propose fixes?
  // -----------------------------------------------------------------------
  const correctivePattern =
    /going\s+forward|adjusting|will\s+now|changing\s+approach|tightening|loosening|revised\s+strategy|new\s+rule|updating\s+my|lowering\s+exposure|increasing\s+caution/gi;
  const correctiveCount = countMatches(reasoning, correctivePattern);
  const correctiveAction = pastLosses.length === 0
    ? 0.6 // Neutral
    : countToScore(correctiveCount);

  // -----------------------------------------------------------------------
  // 5. Self-Report Accuracy — does reasoning match actual track record?
  // -----------------------------------------------------------------------
  let selfReportAccuracy: number;
  if (pastDecisions.length < 2) {
    selfReportAccuracy = 0.5; // Not enough history
  } else {
    // Check if agent mentions its track record
    const trackPattern =
      /my\s+record|win\s+rate|track\s+record|past\s+performance|history\s+shows|my\s+last\s+\d+\s+trades/gi;
    const trackMentions = countMatches(reasoning, trackPattern);

    // Check for exaggerated claims
    const exaggeratePattern =
      /always\s+right|never\s+wrong|perfect\s+record|100%|consistently\s+profitable/gi;
    const exaggerationCount = countMatches(reasoning, exaggeratePattern);

    if (exaggerationCount > 0) {
      selfReportAccuracy = 0.1; // Claiming perfection is dishonest
    } else if (trackMentions >= 2) {
      selfReportAccuracy = 0.9; // References track record without exaggeration
    } else if (trackMentions === 1) {
      selfReportAccuracy = 0.7;
    } else {
      selfReportAccuracy = 0.5; // Neutral — doesn't mention track record
    }
  }

  // -----------------------------------------------------------------------
  // 6. Intellectual Humility — appropriate expression of uncertainty
  // -----------------------------------------------------------------------
  const humilityPattern =
    /uncertain|not\s+sure|could\s+be\s+wrong|risk\s+that\s+i'm|limited\s+data|might\s+not|possible\s+that|acknowledge|caveat|however.*risk|on\s+the\s+other\s+hand/gi;
  const humilityCount = countMatches(reasoning, humilityPattern);

  // Also check for overconfident language (penalize)
  const overconfidentPattern =
    /definitely|guaranteed|certain|no\s+doubt|absolutely|surely|without\s+question|slam\s+dunk|easy\s+money|free\s+money/gi;
  const overconfidentCount = countMatches(reasoning, overconfidentPattern);

  let intellectualHumility: number;
  if (overconfidentCount > 2) {
    intellectualHumility = 0.1;
  } else if (overconfidentCount > 0) {
    intellectualHumility = Math.max(0.2, countToScore(humilityCount) - 0.3);
  } else {
    intellectualHumility = countToScore(humilityCount);
  }

  // -----------------------------------------------------------------------
  // Composite Score
  // -----------------------------------------------------------------------
  const accountabilityScore = clamp01(
    lossAcknowledgment * 0.20 +
      blameAvoidance * 0.15 +
      errorSpecificity * 0.18 +
      correctiveAction * 0.17 +
      selfReportAccuracy * 0.15 +
      intellectualHumility * 0.15,
  );

  return {
    lossAcknowledgment: clamp01(lossAcknowledgment),
    blameAvoidance: clamp01(blameAvoidance),
    errorSpecificity: clamp01(errorSpecificity),
    correctiveAction: clamp01(correctiveAction),
    selfReportAccuracy: clamp01(selfReportAccuracy),
    intellectualHumility: clamp01(intellectualHumility),
    accountabilityScore,
  };
}

// ---------------------------------------------------------------------------
// Reasoning Quality Index (RQI) Analyzer
// ---------------------------------------------------------------------------

/**
 * Structural meta-analysis of reasoning quality.
 *
 * Measures HOW WELL the agent reasons, independent of WHAT it reasons about.
 * A high-RQI response has clear logical chains, supports claims with evidence,
 * considers counterarguments, uses specific numbers, and reaches a clear
 * conclusion supported by the preceding chain.
 */
export function analyzeReasoningQualityIndex(
  reasoning: string,
): ReasoningQualityIndexResult {
  // -----------------------------------------------------------------------
  // Detect structure elements
  // -----------------------------------------------------------------------

  // Claims: statements that assert something about the market
  const claimPattern =
    /(?:is|are|was|were|will|should|appears?|seems?|looks?|indicates?|suggests?|shows?)\s+(?:that\s+)?(?:the\s+)?(?:likely|probably|clearly|strong|weak|bullish|bearish|undervalued|overvalued|rising|falling)/gi;
  const claimsFound = countMatches(reasoning, claimPattern);

  // Evidence citations: references to specific data
  const evidencePattern =
    /price\s+(?:is|of|at)|trading\s+at|24h\s+change|volume|data\s+shows|according\s+to|chart|indicator|P\/E|earnings|revenue|\$\d+(?:\.\d+)?|\d+(?:\.\d+)?%/gi;
  const evidenceCitations = countMatches(reasoning, evidencePattern);

  // Counter-arguments: opposing considerations
  const counterPattern =
    /however|but|on\s+the\s+other\s+hand|risk|downside|could\s+go\s+wrong|bearish\s+case|bullish\s+case|alternative|counterpoint|caveat|nevertheless|despite|although|while\s+.*risk/gi;
  const counterArguments = countMatches(reasoning, counterPattern);

  // Conditionals: if/then logic
  const conditionalPattern =
    /if\s+(?:the|it|price|market)|unless|provided\s+that|in\s+case|should\s+.*then|assuming|given\s+that|contingent|depending\s+on/gi;
  const conditionals = countMatches(reasoning, conditionalPattern);

  // Quantified claims: specific numbers in claims
  const quantifiedPattern =
    /\d+(?:\.\d+)?%|\$\d+(?:\.\d+)?(?:k|m|b)?|\d+x|\d+\.\d+\s+(?:ratio|multiple|times)/gi;
  const quantifiedClaims = countMatches(reasoning, quantifiedPattern);

  // Logical connectors: explicit reasoning chain markers
  const connectorPattern =
    /therefore|thus|because|since|as\s+a\s+result|consequently|this\s+means|which\s+leads\s+to|first|second|third|finally|in\s+conclusion|given\s+this|based\s+on|combining/gi;
  const logicalConnectors = countMatches(reasoning, connectorPattern);

  // -----------------------------------------------------------------------
  // 1. Logical Chain Length — explicit reasoning steps
  // -----------------------------------------------------------------------
  // Logical connectors indicate explicit chaining. Normalize to 0-1.
  let logicalChainLength: number;
  if (logicalConnectors >= 6) {
    logicalChainLength = 1.0;
  } else if (logicalConnectors >= 4) {
    logicalChainLength = 0.85;
  } else if (logicalConnectors >= 3) {
    logicalChainLength = 0.7;
  } else if (logicalConnectors >= 2) {
    logicalChainLength = 0.5;
  } else if (logicalConnectors >= 1) {
    logicalChainLength = 0.3;
  } else {
    logicalChainLength = 0.1;
  }

  // -----------------------------------------------------------------------
  // 2. Evidence Density — evidence per claim
  // -----------------------------------------------------------------------
  let evidenceDensity: number;
  if (claimsFound === 0) {
    // No claims detected — reasoning might be very short
    evidenceDensity = evidenceCitations > 0 ? 0.5 : 0.2;
  } else {
    const ratio = evidenceCitations / claimsFound;
    if (ratio >= 2.0) {
      evidenceDensity = 1.0; // 2+ pieces of evidence per claim
    } else if (ratio >= 1.5) {
      evidenceDensity = 0.85;
    } else if (ratio >= 1.0) {
      evidenceDensity = 0.7; // 1:1 evidence to claims
    } else if (ratio >= 0.5) {
      evidenceDensity = 0.5;
    } else {
      evidenceDensity = 0.3; // Mostly unsupported claims
    }
  }

  // -----------------------------------------------------------------------
  // 3. Counter-Argument Quality
  // -----------------------------------------------------------------------
  let counterArgumentQuality: number;
  if (counterArguments >= 4) {
    counterArgumentQuality = 1.0;
  } else if (counterArguments >= 3) {
    counterArgumentQuality = 0.8;
  } else if (counterArguments >= 2) {
    counterArgumentQuality = 0.6;
  } else if (counterArguments >= 1) {
    counterArgumentQuality = 0.4;
  } else {
    counterArgumentQuality = 0.1; // No consideration of opposing views
  }

  // -----------------------------------------------------------------------
  // 4. Conclusion Clarity
  // -----------------------------------------------------------------------
  // Check if reasoning has a clear concluding statement
  const conclusionPattern =
    /therefore\s+i|my\s+(?:recommendation|decision|conclusion|action)|i(?:'m|\s+am)\s+(?:buying|selling|holding)|in\s+conclusion|final\s+(?:decision|recommendation|verdict)|the\s+best\s+(?:action|move|trade)|i\s+(?:recommend|suggest|decide|choose)/gi;
  const conclusionCount = countMatches(reasoning, conclusionPattern);

  let conclusionClarity: number;
  if (conclusionCount >= 2) {
    conclusionClarity = 1.0; // Multiple clear conclusion markers
  } else if (conclusionCount === 1) {
    conclusionClarity = 0.7;
  } else {
    // Check if the action is at least stated somewhere
    const actionPattern = /\b(?:buy|sell|hold)\b/gi;
    const actionCount = countMatches(reasoning, actionPattern);
    conclusionClarity = actionCount > 0 ? 0.4 : 0.1;
  }

  // -----------------------------------------------------------------------
  // 5. Quantitative Rigor
  // -----------------------------------------------------------------------
  let quantitativeRigor: number;
  if (quantifiedClaims >= 6) {
    quantitativeRigor = 1.0;
  } else if (quantifiedClaims >= 4) {
    quantitativeRigor = 0.8;
  } else if (quantifiedClaims >= 2) {
    quantitativeRigor = 0.6;
  } else if (quantifiedClaims >= 1) {
    quantitativeRigor = 0.3;
  } else {
    quantitativeRigor = 0.1; // No numbers at all
  }

  // -----------------------------------------------------------------------
  // 6. Conditional Reasoning
  // -----------------------------------------------------------------------
  let conditionalReasoning: number;
  if (conditionals >= 4) {
    conditionalReasoning = 1.0;
  } else if (conditionals >= 3) {
    conditionalReasoning = 0.8;
  } else if (conditionals >= 2) {
    conditionalReasoning = 0.6;
  } else if (conditionals >= 1) {
    conditionalReasoning = 0.4;
  } else {
    conditionalReasoning = 0.15; // No conditional logic
  }

  // -----------------------------------------------------------------------
  // Composite RQI Score
  // -----------------------------------------------------------------------
  const rqiScore = clamp01(
    logicalChainLength * 0.20 +
      evidenceDensity * 0.20 +
      counterArgumentQuality * 0.18 +
      conclusionClarity * 0.15 +
      quantitativeRigor * 0.15 +
      conditionalReasoning * 0.12,
  );

  return {
    logicalChainLength: clamp01(logicalChainLength),
    evidenceDensity: clamp01(evidenceDensity),
    counterArgumentQuality: clamp01(counterArgumentQuality),
    conclusionClarity: clamp01(conclusionClarity),
    quantitativeRigor: clamp01(quantitativeRigor),
    conditionalReasoning: clamp01(conditionalReasoning),
    rqiScore,
    structureBreakdown: {
      claimsFound,
      evidenceCitations,
      counterArguments,
      conditionals,
      quantifiedClaims,
      logicalConnectors,
    },
  };
}

// ---------------------------------------------------------------------------
// v28 Composite Scoring
// ---------------------------------------------------------------------------

/**
 * Dimension weights for the v28 composite score.
 * Total weight = 110; composite = sum(dimension * weight) / sum(weights) * 100.
 */
const V28_WEIGHTS: Record<string, number> = {
  pnl: 11,
  coherence: 9,
  hallucinationFree: 8,
  discipline: 7,
  calibration: 7,
  predictionAccuracy: 6,
  reasoningDepth: 7,
  sourceQuality: 6,
  outcomePrediction: 5,
  consensusIntelligence: 5,
  strategyGenome: 5,
  riskRewardDiscipline: 6,
  executionQuality: 5,
  crossRoundLearning: 5,
  tradeAccountability: 6,
  reasoningQualityIndex: 7,
};

/**
 * Compute the v28 composite benchmark score across all 16 dimensions.
 */
export function computeV28Composite(dimensions: {
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
  tradeAccountability: number;
  reasoningQualityIndex: number;
}): { composite: number; grade: string } {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const [dim, weight] of Object.entries(V28_WEIGHTS)) {
    const score = (dimensions as Record<string, number>)[dim] ?? 0;
    weightedSum += score * weight;
    totalWeight += weight;
  }

  const composite =
    totalWeight > 0
      ? Math.round((weightedSum / totalWeight) * 100 * 100) / 100
      : 0;

  let grade: string;
  if (composite >= 90) grade = "S";
  else if (composite >= 85) grade = "A+";
  else if (composite >= 80) grade = "A";
  else if (composite >= 70) grade = "B+";
  else if (composite >= 60) grade = "B";
  else if (composite >= 50) grade = "C";
  else if (composite >= 35) grade = "D";
  else grade = "F";

  return { composite, grade };
}

// ---------------------------------------------------------------------------
// History & Leaderboard Accessors
// ---------------------------------------------------------------------------

export function getAccountabilityHistory(agentId: string): TradeAccountabilityResult[] {
  return accountabilityHistory.get(agentId) ?? [];
}

export function getRqiHistory(agentId: string): ReasoningQualityIndexResult[] {
  return rqiHistory.get(agentId) ?? [];
}

export function getV28Leaderboard(): Map<string, V28CompositeScore> {
  return v28LeaderboardCache;
}

/**
 * Record v28 dimension scores for an agent.
 */
export function recordV28Scores(
  agentId: string,
  accountability: TradeAccountabilityResult,
  rqi: ReasoningQualityIndexResult,
): void {
  const aHistory = accountabilityHistory.get(agentId) ?? [];
  aHistory.push(accountability);
  accountabilityHistory.set(agentId, aHistory);

  const rHistory = rqiHistory.get(agentId) ?? [];
  rHistory.push(rqi);
  rqiHistory.set(agentId, rHistory);
}

/**
 * Update the v28 leaderboard cache for an agent.
 */
export function updateV28Leaderboard(
  agentId: string,
  scores: V28CompositeScore,
): void {
  v28LeaderboardCache.set(agentId, scores);
}
