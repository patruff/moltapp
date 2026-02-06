/**
 * Reasoning Depth & Source Quality Engine (v24)
 *
 * Two new benchmark dimensions that complete MoltApp's 8-dimension scoring:
 *
 * REASONING DEPTH — measures HOW WELL the agent reasons, not just WHAT it concludes:
 *   - Step count: How many distinct reasoning steps?
 *   - Connective density: Does the agent use logical connectives (therefore, because)?
 *   - Evidence anchoring: Does reasoning reference specific data from the prompt?
 *   - Counter-arguments: Does the agent consider risks and opposing views?
 *   - Conclusion clarity: Is there a clear, actionable conclusion?
 *   - Vocabulary richness: Type-token ratio as a sophistication proxy
 *
 * SOURCE QUALITY — measures how well the agent USES its information:
 *   - Source count: How many distinct sources cited?
 *   - Diversity: Are sources varied (price, volume, news, technicals, portfolio)?
 *   - Specificity: Are data points mentioned with concrete values?
 *   - Cross-referencing: Does the agent synthesize multiple sources?
 *   - Integration: Are source data points used in the logical argument?
 */

import { splitSentences, normalize, round2 } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReasoningDepthResult {
  /** Overall depth score: 0.0 to 1.0 */
  depthScore: number;
  /** Number of distinct reasoning steps */
  stepCount: number;
  /** Logical connective density (per sentence) */
  connectiveDensity: number;
  /** Evidence anchoring score: 0-1 */
  evidenceAnchoringScore: number;
  /** Counter-argument awareness: 0-1 */
  counterArgumentScore: number;
  /** Conclusion clarity: 0-1 */
  conclusionClarity: number;
  /** Word count */
  wordCount: number;
  /** Vocabulary richness (unique words / total words) */
  vocabularyRichness: number;
  /** Detected reasoning pattern */
  reasoningPattern: string;
}

export interface SourceQualityResult {
  /** Overall source quality score: 0-1 */
  qualityScore: number;
  /** Number of distinct sources cited */
  sourceCount: number;
  /** Source diversity score: 0-1 */
  diversityScore: number;
  /** Data specificity score: 0-1 */
  specificityScore: number;
  /** Cross-referencing score: 0-1 */
  crossReferenceScore: number;
  /** Source integration score: 0-1 */
  integrationScore: number;
  /** Detected source categories */
  sourceCategories: string[];
}

export interface V24AnalysisResult {
  depth: ReasoningDepthResult;
  sourceQuality: SourceQualityResult;
  /** Combined v24 score (average of depth + source quality) */
  v24Score: number;
}

// ---------------------------------------------------------------------------
// Reasoning Depth Lexicons
// ---------------------------------------------------------------------------

/** Logical connectives that indicate structured reasoning */
const LOGICAL_CONNECTIVES = [
  /\btherefore\b/i,
  /\bbecause\b/i,
  /\bhowever\b/i,
  /\bconsequently\b/i,
  /\bfurthermore\b/i,
  /\bmoreover\b/i,
  /\bin\s+addition\b/i,
  /\bnevertheless\b/i,
  /\balthough\b/i,
  /\bdespite\b/i,
  /\bgiven\s+that\b/i,
  /\bas\s+a\s+result\b/i,
  /\bsince\b/i,
  /\bthus\b/i,
  /\bhence\b/i,
  /\bwhich\s+means\b/i,
  /\bthis\s+suggests?\b/i,
  /\bthis\s+indicates?\b/i,
  /\bwhile\b/i,
  /\bon\s+the\s+other\s+hand\b/i,
  /\bin\s+contrast\b/i,
  /\bso\b/i,
  /\bbut\b/i,
  /\byet\b/i,
];

/** Patterns that indicate the agent is referencing specific data */
const EVIDENCE_ANCHORS = [
  /\$\d+\.?\d*/,                     // Dollar amounts: $178.50
  /\d+\.?\d*%/,                      // Percentages: 3.2%
  /\d+\.?\d*[xX]\s+(?:average|normal|typical)/i, // Multiples: 2x average
  /\b\d{1,3}(?:,\d{3})*\b/,         // Large numbers: 1,500,000
  /\bRSI\s+(?:at|of|is)\s+\d+/i,    // RSI at 62
  /\bMA\s*\d+/i,                     // MA50, MA200
  /\bP\/E\s+(?:of|at|is)\s+\d+/i,   // P/E of 25
  /\bvolume\s+(?:is|at|of)\s+/i,    // Volume references
  /\b\d+\.?\d*\s*(?:M|B|K)\b/,      // Abbreviated numbers: $2.5M
  /\bcurrently\s+at\s+/i,           // "currently at" + data
  /\bdown\s+\d+/i,                  // "down 3.2%"
  /\bup\s+\d+/i,                    // "up 5.1%"
];

/** Patterns indicating counter-argument or risk awareness */
const COUNTER_ARGUMENT_PATTERNS = [
  /\brisk[s]?\s+(?:include|are|of|is)\b/i,
  /\bdownside\s+(?:risk|scenario|potential)\b/i,
  /\bhowever\b/i,
  /\bon\s+the\s+other\s+hand\b/i,
  /\bcould\s+(?:also|fail|drop|decline)\b/i,
  /\bif\s+.*(?:wrong|fails?|drops?|declines?)\b/i,
  /\bcaution\b/i,
  /\bworst\s+case\b/i,
  /\bconcern\b/i,
  /\bvolatil/i,
  /\buncertain/i,
  /\bpotential\s+(?:loss|downside|negative)\b/i,
  /\bwarning\b/i,
  /\bcontrary\s+(?:to|view|argument)\b/i,
  /\bbears?\s+(?:might|could|would|argue)\b/i,
  /\bskeptic/i,
];

/** Patterns indicating a clear conclusion */
const CONCLUSION_PATTERNS = [
  /\btherefore\s+(?:I|we)\s+(?:recommend|suggest|should|will|choose)\b/i,
  /\bbased\s+on\s+(?:this|these|the\s+above)\b/i,
  /\bin\s+conclusion\b/i,
  /\bmy\s+(?:decision|recommendation|action)\b/i,
  /\bI(?:'m|\s+am)\s+(?:buying|selling|holding)\b/i,
  /\bthis\s+(?:makes|leads\s+me\s+to)\b/i,
  /\boverall\b/i,
  /\bnet\s+(?:result|assessment|conclusion)\b/i,
  /\bconviction\b/i,
  /\btaking\s+(?:a|the)\s+(?:position|trade)\b/i,
  /\bexecuting\s+(?:a|this)\b/i,
];

// ---------------------------------------------------------------------------
// Source Quality Lexicons
// ---------------------------------------------------------------------------

/** Source category definitions */
const SOURCE_CATEGORIES: Record<string, RegExp[]> = {
  price_data: [
    /\bprice\b/i, /\b\$\d+/i, /\btrading\s+at\b/i, /\bcurrent\s+price\b/i,
    /\bquote\b/i,
  ],
  volume_data: [
    /\bvolume\b/i, /\bturnover\b/i, /\bliquidity\b/i,
  ],
  momentum_signals: [
    /\b24h\s+change\b/i, /\bmomentum\b/i, /\btrend\b/i, /\bbreakout\b/i,
    /\brally\b/i,
  ],
  technical_indicators: [
    /\bRSI\b/i, /\bMACD\b/i, /\bmoving\s+average\b/i, /\bMA\d+\b/i,
    /\bBollinger\b/i, /\bsupport\b/i, /\bresistance\b/i, /\boverbought\b/i,
    /\boversold\b/i,
  ],
  fundamental_data: [
    /\bearnings\b/i, /\brevenue\b/i, /\bP\/E\b/i, /\bvaluation\b/i,
    /\bfundamental/i, /\bgrowth\s+rate\b/i, /\bmargin\b/i,
  ],
  portfolio_context: [
    /\bportfolio\b/i, /\bposition\b/i, /\bcash\s+balance\b/i,
    /\bexposure\b/i, /\ballocation\b/i, /\bP&?L\b/i,
  ],
  news_events: [
    /\bnews\b/i, /\bheadline\b/i, /\breport\b/i, /\bannounce/i,
    /\bearnings\s+(?:call|report|release)\b/i, /\bcatalyst\b/i,
  ],
  sentiment: [
    /\bsentiment\b/i, /\bmood\b/i, /\bfear\b/i, /\bgreed\b/i,
    /\bconsensus\b/i,
  ],
  peer_comparison: [
    /\bsector\b/i, /\bpeer\b/i, /\bcompetitor\b/i, /\bcorrelation\b/i,
    /\brelative\s+(?:to|performance)\b/i,
  ],
  risk_metrics: [
    /\bvolatility\b/i, /\bdrawdown\b/i, /\bSharpe\b/i, /\bbeta\b/i,
    /\bVaR\b/i, /\brisk\s+score\b/i,
  ],
};

/** Patterns indicating cross-referencing between sources */
const CROSS_REFERENCE_PATTERNS = [
  /\bcombined\s+with\b/i,
  /\balong\s+with\b/i,
  /\bconfirmed\s+by\b/i,
  /\bcorroborated\b/i,
  /\bconsistent\s+with\b/i,
  /\b(?:both|all)\s+.*(?:and|indicate|suggest|show)\b/i,
  /\bwhile\s+.*also\b/i,
  /\bprice\s+.*volume\b/i,
  /\btechnical\s+.*fundamental\b/i,
  /\bsupports?\s+(?:this|the|my)\b/i,
  /\breinforced?\s+by\b/i,
  /\baligns?\s+with\b/i,
];

/** Patterns indicating source data is integrated into the argument */
const SOURCE_INTEGRATION_PATTERNS = [
  /\b(?:the|this)\s+\d+\.?\d*%\s+(?:change|move|gain|loss|increase|decrease)\s+(?:suggests?|indicates?|shows?|means?)\b/i,
  /\bprice\s+(?:of|at)\s+\$\d+.*(?:suggests?|indicates?|means?|shows?)\b/i,
  /\bvolume\s+.*(?:suggests?|indicates?|confirms?)\b/i,
  /\b(?:RSI|MACD|MA)\s+.*(?:signals?|suggests?|indicates?)\b/i,
  /\bgiven\s+(?:the|that|this)\s+.*\d+/i,
  /\bwith\s+.*at\s+\d+/i,
  /\bbased\s+on\s+.*\d+/i,
  /\bconsidering\s+.*\d+/i,
];

// ---------------------------------------------------------------------------
// Core Analysis Functions
// ---------------------------------------------------------------------------

/**
 * Analyze the depth and structure of an agent's reasoning.
 */
export function analyzeReasoningDepthV24(reasoning: string): ReasoningDepthResult {
  const words = reasoning.split(/\s+/).filter((w) => w.length > 0);
  const wordCount = words.length;
  const sentences = splitSentences(reasoning, 0);
  const sentenceCount = Math.max(1, sentences.length);

  // 1. Step count: distinct reasoning steps (sentences with substance)
  const substantiveSentences = sentences.filter((s) => s.trim().split(/\s+/).length >= 5);
  const stepCount = substantiveSentences.length;

  // 2. Logical connective density
  let connectiveCount = 0;
  for (const pattern of LOGICAL_CONNECTIVES) {
    const matches = reasoning.match(new RegExp(pattern.source, "gi"));
    if (matches) connectiveCount += matches.length;
  }
  const connectiveDensity = round2(connectiveCount / sentenceCount);

  // 3. Evidence anchoring
  let evidenceCount = 0;
  for (const pattern of EVIDENCE_ANCHORS) {
    const matches = reasoning.match(new RegExp(pattern.source, "gi"));
    if (matches) evidenceCount += matches.length;
  }
  // Normalize: 5+ anchors = perfect score
  const evidenceAnchoringScore = Math.min(1, evidenceCount / 5);

  // 4. Counter-argument awareness
  let counterCount = 0;
  for (const pattern of COUNTER_ARGUMENT_PATTERNS) {
    if (pattern.test(reasoning)) counterCount++;
  }
  // 3+ counter-argument signals = max score
  const counterArgumentScore = Math.min(1, counterCount / 3);

  // 5. Conclusion clarity
  let conclusionCount = 0;
  for (const pattern of CONCLUSION_PATTERNS) {
    if (pattern.test(reasoning)) conclusionCount++;
  }
  const conclusionClarity = Math.min(1, conclusionCount / 2);

  // 6. Vocabulary richness (type-token ratio)
  const uniqueWords = new Set(words.map((w) => w.toLowerCase().replace(/[^a-z]/g, "")));
  const vocabularyRichness = wordCount > 0
    ? round2(uniqueWords.size / wordCount)
    : 0;

  // 7. Detect reasoning pattern
  const reasoningPattern = detectReasoningPattern(reasoning);

  // Calculate composite depth score with sub-dimension weights
  const depthScore = round2(
    normalizeStepCount(stepCount) * 0.20 +
    Math.min(1, connectiveDensity / 0.8) * 0.15 +
    evidenceAnchoringScore * 0.25 +
    counterArgumentScore * 0.15 +
    conclusionClarity * 0.15 +
    Math.min(1, vocabularyRichness / 0.6) * 0.10
  );

  return {
    depthScore,
    stepCount,
    connectiveDensity,
    evidenceAnchoringScore: round2(evidenceAnchoringScore),
    counterArgumentScore: round2(counterArgumentScore),
    conclusionClarity: round2(conclusionClarity),
    wordCount,
    vocabularyRichness,
    reasoningPattern,
  };
}

/**
 * Analyze the quality of source usage in an agent's reasoning.
 */
export function analyzeSourceQualityV24(
  reasoning: string,
  declaredSources: string[],
): SourceQualityResult {
  // 1. Detect source categories present in the reasoning text
  const detectedCategories: string[] = [];
  for (const [category, patterns] of Object.entries(SOURCE_CATEGORIES)) {
    for (const pattern of patterns) {
      if (pattern.test(reasoning)) {
        detectedCategories.push(category);
        break;
      }
    }
  }

  // Combine declared sources with detected categories
  const allCategories = [...new Set([...detectedCategories, ...declaredSources])];
  const sourceCount = allCategories.length;

  // 2. Source diversity: how many different category types are covered?
  // 10 possible categories. 4+ = good diversity.
  const diversityScore = Math.min(1, detectedCategories.length / 4);

  // 3. Specificity: does the reasoning cite concrete data values?
  let specificValueCount = 0;
  const specificPatterns = [
    /\$\d+\.?\d*/g,      // Dollar values
    /\d+\.?\d*%/g,       // Percentages
    /\d+\.?\d*[xX]\b/g,  // Multipliers
    /\d{1,3}(?:,\d{3})+/g, // Large numbers
  ];
  for (const pattern of specificPatterns) {
    const matches = reasoning.match(pattern);
    if (matches) specificValueCount += matches.length;
  }
  // 4+ specific values = perfect specificity
  const specificityScore = Math.min(1, specificValueCount / 4);

  // 4. Cross-referencing: does the agent synthesize multiple sources?
  let crossRefCount = 0;
  for (const pattern of CROSS_REFERENCE_PATTERNS) {
    if (pattern.test(reasoning)) crossRefCount++;
  }
  // 2+ cross-references = max score
  const crossReferenceScore = Math.min(1, crossRefCount / 2);

  // 5. Integration: are source data points used in logical argument?
  let integrationCount = 0;
  for (const pattern of SOURCE_INTEGRATION_PATTERNS) {
    if (pattern.test(reasoning)) integrationCount++;
  }
  // 2+ integration patterns = max score
  const integrationScore = Math.min(1, integrationCount / 2);

  // Calculate composite source quality score
  const qualityScore = round2(
    Math.min(1, sourceCount / 3) * 0.15 +
    diversityScore * 0.25 +
    specificityScore * 0.25 +
    crossReferenceScore * 0.15 +
    integrationScore * 0.20
  );

  return {
    qualityScore,
    sourceCount,
    diversityScore: round2(diversityScore),
    specificityScore: round2(specificityScore),
    crossReferenceScore: round2(crossReferenceScore),
    integrationScore: round2(integrationScore),
    sourceCategories: allCategories,
  };
}

/**
 * Run the full v24 analysis suite.
 */
export function runV24Analysis(
  reasoning: string,
  declaredSources: string[],
): V24AnalysisResult {
  const depth = analyzeReasoningDepthV24(reasoning);
  const sourceQuality = analyzeSourceQualityV24(reasoning, declaredSources);

  const v24Score = round2(
    (depth.depthScore + sourceQuality.qualityScore) / 2,
  );

  return { depth, sourceQuality, v24Score };
}

// ---------------------------------------------------------------------------
// v24 Composite Scoring (8 dimensions)
// ---------------------------------------------------------------------------

export interface V24CompositeInput {
  pnlPercent: number;
  coherenceScore: number;
  hallucinationFreeRate: number;
  disciplineRate: number;
  calibrationScore: number;
  predictionAccuracy: number;
  reasoningDepthScore: number;
  sourceQualityScore: number;
}

/**
 * Compute v24 composite score across 8 benchmark dimensions.
 *
 * Weights:
 *   P&L Performance:        25%
 *   Reasoning Coherence:    15%
 *   Hallucination-Free:     12%
 *   Instruction Discipline:  8%
 *   Confidence Calibration: 12%
 *   Prediction Accuracy:     8%
 *   Reasoning Depth (v24):  10%
 *   Source Quality (v24):   10%
 */
export function computeV24CompositeScore(input: V24CompositeInput): {
  composite: number;
  grade: string;
  breakdown: Record<string, { score: number; weight: number; weighted: number }>;
} {
  // Normalize P&L to 0-1 range (cap at ±50%)
  const pnlNormalized = normalize((input.pnlPercent + 50) / 100);

  // Invert calibration (lower ECE = better)
  const calibrationNormalized = Math.max(0, 1 - input.calibrationScore);

  const dimensions = {
    pnl: { score: pnlNormalized, weight: 0.25 },
    coherence: { score: input.coherenceScore, weight: 0.15 },
    hallucination_free: { score: input.hallucinationFreeRate, weight: 0.12 },
    discipline: { score: input.disciplineRate, weight: 0.08 },
    calibration: { score: calibrationNormalized, weight: 0.12 },
    prediction: { score: input.predictionAccuracy, weight: 0.08 },
    reasoning_depth: { score: input.reasoningDepthScore, weight: 0.10 },
    source_quality: { score: input.sourceQualityScore, weight: 0.10 },
  };

  let composite = 0;
  const breakdown: Record<string, { score: number; weight: number; weighted: number }> = {};

  for (const [name, dim] of Object.entries(dimensions)) {
    const weighted = Math.round(dim.score * dim.weight * 10000) / 10000;
    composite += weighted;
    breakdown[name] = {
      score: round2(dim.score),
      weight: dim.weight,
      weighted,
    };
  }

  // Scale to 0-100
  composite = round2(composite * 100);

  // Assign grade
  let grade: string;
  if (composite >= 90) grade = "S";
  else if (composite >= 80) grade = "A";
  else if (composite >= 65) grade = "B";
  else if (composite >= 50) grade = "C";
  else if (composite >= 35) grade = "D";
  else grade = "F";

  return { composite, grade, breakdown };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalize step count to 0-1 (5+ steps = perfect) */
function normalizeStepCount(steps: number): number {
  return Math.min(1, steps / 5);
}

/** Detect the dominant reasoning pattern */
function detectReasoningPattern(reasoning: string): string {
  const lower = reasoning.toLowerCase();

  if (/step\s+\d|first.*then.*finally/i.test(lower)) return "sequential";
  if (/on\s+one\s+hand.*on\s+the\s+other/i.test(lower)) return "comparative";
  if (/risk.*reward|upside.*downside|pros?.*cons?/i.test(lower)) return "risk_reward";
  if (/if.*then.*else|scenario/i.test(lower)) return "conditional";
  if (/data\s+shows|evidence\s+suggests|based\s+on/i.test(lower)) return "evidence_based";
  if (/hypothesis|thesis|theory/i.test(lower)) return "thesis_driven";
  if (/technical.*indicator|chart.*pattern|RSI|MACD/i.test(lower)) return "technical_analysis";
  if (/fundamentals?|valuation|earnings|revenue/i.test(lower)) return "fundamental_analysis";
  if (/contrarian|against\s+the\s+crowd|overreaction/i.test(lower)) return "contrarian";
  if (/momentum|trend|breakout/i.test(lower)) return "momentum";

  return "general";
}
