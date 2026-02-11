/**
 * Reasoning Pattern Detector
 *
 * Advanced NLP analysis of agent reasoning text to detect:
 * - Logical fallacies (anchoring bias, recency bias, survivorship bias)
 * - Reasoning depth (shallow vs deep analysis)
 * - Vocabulary sophistication and diversity
 * - Sentiment consistency within a single reasoning block
 * - Cross-trade reasoning evolution (are agents getting better/worse?)
 * - Template detection (is the agent using canned responses?)
 * - Hedge word analysis (excessive hedging reduces conviction signal)
 *
 * This feeds into the benchmark's qualitative scoring pillar.
 */

import { normalize, round2, round3, clamp } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Depth Classification Thresholds
 * Controls how reasoning quality is classified based on analytical angles
 */

/** Minimum analytical angles required for EXCEPTIONAL classification */
const DEPTH_EXCEPTIONAL_MIN_ANGLES = 5;

/** Minimum analytical angles required for DEEP classification */
const DEPTH_DEEP_MIN_ANGLES = 3;

/** Minimum analytical angles required for MODERATE classification */
const DEPTH_MODERATE_MIN_ANGLES = 2;

/**
 * Sophistication Scoring Weights
 * Controls vocabulary sophistication score calculation (0-1 scale)
 */

/** Weight for type-token ratio (unique/total words) in sophistication score */
const SOPHISTICATION_WEIGHT_TYPE_TOKEN = 0.3;

/** Weight for finance term count in sophistication score */
const SOPHISTICATION_WEIGHT_FINANCE_TERMS = 0.4;

/** Weight for word count in sophistication score */
const SOPHISTICATION_WEIGHT_WORD_COUNT = 0.3;

/** Divisor for finance term normalization (financeTerms / divisor, max 1.0) */
const SOPHISTICATION_FINANCE_TERM_DIVISOR = 10;

/** Divisor for word count normalization (wordCount / divisor, max 1.0) */
const SOPHISTICATION_WORD_COUNT_DIVISOR = 200;

/**
 * Template Detection Thresholds
 * Controls template/canned response probability calculation
 */

/** Type-token ratio threshold below which reasoning is considered templated */
const TEMPLATE_TYPE_TOKEN_THRESHOLD = 0.4;

/** Multiplier for template probability when below threshold */
const TEMPLATE_PROBABILITY_MULTIPLIER = 5;

/** Jaccard similarity threshold for template usage detection (0-1 scale) */
const TEMPLATE_SIMILARITY_THRESHOLD = 0.7;

/**
 * Quality Score Fallacy Penalties
 * Controls how logical fallacies reduce aggregate quality score
 */

/** Maximum total fallacy penalty cap (prevents excessive penalization) */
const QUALITY_FALLACY_PENALTY_MAX = 0.4;

/** Penalty for high-severity fallacy (e.g., sunk cost) */
const QUALITY_FALLACY_PENALTY_HIGH = 0.15;

/** Penalty for medium-severity fallacy (e.g., gambler's fallacy) */
const QUALITY_FALLACY_PENALTY_MEDIUM = 0.08;

/** Penalty for low-severity fallacy (e.g., anchoring bias) */
const QUALITY_FALLACY_PENALTY_LOW = 0.03;

/**
 * Quality Score Hedge Penalties
 * Controls how hedge words reduce quality score
 */

/** Maximum hedge penalty cap */
const QUALITY_HEDGE_PENALTY_MAX = 0.15;

/** Multiplier for hedge ratio penalty (hedgeRatio × multiplier) */
const QUALITY_HEDGE_PENALTY_MULTIPLIER = 3;

/**
 * Quality Score Component Weights
 * Controls aggregate quality score calculation (sum to 1.0)
 */

/** Weight for reasoning depth score (highest priority) */
const QUALITY_WEIGHT_DEPTH = 0.35;

/** Weight for vocabulary sophistication */
const QUALITY_WEIGHT_SOPHISTICATION = 0.25;

/** Weight for quantitative reasoning presence */
const QUALITY_WEIGHT_QUANTITATIVE = 0.15;

/** Weight for hallucination-free analysis (inverse of fallacy penalty) */
const QUALITY_WEIGHT_HALLUCINATION_FREE = 0.15;

/** Weight for template/hedge penalty component */
const QUALITY_WEIGHT_TEMPLATE_HEDGE = 0.10;

/** Template penalty multiplier within aggregate quality score */
const QUALITY_TEMPLATE_PENALTY_MULTIPLIER = 0.3;

/**
 * Depth Score Classification Values
 * Maps depth classification to numeric score (0-1 scale)
 */

/** Score for EXCEPTIONAL depth (5+ angles + counter-argument + risk) */
const DEPTH_SCORE_EXCEPTIONAL = 1.0;

/** Score for DEEP depth (3+ angles + counter/risk) */
const DEPTH_SCORE_DEEP = 0.75;

/** Score for MODERATE depth (2+ angles) */
const DEPTH_SCORE_MODERATE = 0.5;

/** Score for SHALLOW depth (0-1 angles) */
const DEPTH_SCORE_SHALLOW = 0.25;

/**
 * Trend Detection Thresholds
 * Controls quality trend classification (improving/degrading/stable)
 */

/** Minimum history entries required for trend detection */
const TREND_MIN_HISTORY = 10;

/** Quality score delta threshold for IMPROVING trend (+0.05 or more) */
const TREND_IMPROVING_THRESHOLD = 0.05;

/** Quality score delta threshold for DEGRADING trend (-0.05 or less) */
const TREND_DEGRADING_THRESHOLD = -0.05;

/**
 * Template Usage Detection Parameters
 * Controls template detection via Jaccard similarity analysis
 */

/** Minimum history entries required for template detection */
const TEMPLATE_MIN_HISTORY = 5;

/** Number of recent reasoning entries to compare for template detection */
const TEMPLATE_RECENT_WINDOW = 10;

/**
 * Quantitative Reasoning Normalization
 * Controls quantitative pattern ratio calculation
 */

/** Divisor for word count normalization (quantMatches / (wordCount / divisor)) */
const QUANTITATIVE_WORD_COUNT_DIVISOR = 20;

/**
 * History Management Parameters
 * Controls reasoning history buffer size for cross-trade analysis
 */

/** Maximum reasoning entries stored per agent (prevents unbounded memory growth) */
const MAX_HISTORY = 100;

/**
 * Text Processing Parameters
 * Controls word filtering and tokenization
 */

/** Minimum word length for vocabulary analysis (filters short words like "is", "a") */
const MIN_WORD_LENGTH = 2;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PatternAnalysis {
  /** Agent that produced the reasoning */
  agentId: string;
  /** Logical fallacies detected */
  fallacies: DetectedFallacy[];
  /** Depth metrics */
  depth: DepthMetrics;
  /** Vocabulary analysis */
  vocabulary: VocabularyMetrics;
  /** Template/canned response probability */
  templateProbability: number;
  /** Hedge word ratio */
  hedgeRatio: number;
  /** Quantitative reasoning presence */
  quantitativeRatio: number;
  /** Aggregate quality score 0-1 */
  qualityScore: number;
}

export interface DetectedFallacy {
  type: string;
  description: string;
  severity: "low" | "medium" | "high";
  evidence: string;
}

export interface DepthMetrics {
  /** Total word count */
  wordCount: number;
  /** Number of distinct analytical angles considered */
  analyticalAngles: number;
  /** Whether the reasoning considers counter-arguments */
  hasCounterArgument: boolean;
  /** Whether risk is explicitly discussed */
  hasRiskDiscussion: boolean;
  /** Whether specific data points are cited */
  citesSpecificData: boolean;
  /** Whether temporal reasoning is present (past/present/future) */
  hasTemporalReasoning: boolean;
  /** Classification */
  classification: "shallow" | "moderate" | "deep" | "exceptional";
}

export interface VocabularyMetrics {
  /** Unique word count */
  uniqueWords: number;
  /** Type-token ratio (unique/total) */
  typeTokenRatio: number;
  /** Finance-specific term count */
  financeTerms: number;
  /** Sophistication score 0-1 */
  sophisticationScore: number;
}

// ---------------------------------------------------------------------------
// Fallacy Detection Patterns
// ---------------------------------------------------------------------------

const FALLACY_PATTERNS: {
  type: string;
  patterns: RegExp[];
  description: string;
  severity: "low" | "medium" | "high";
}[] = [
  {
    type: "anchoring_bias",
    patterns: [
      /previous(?:ly)?\s+(?:priced|traded|was)\s+(?:at\s+)?\$[\d,.]+/i,
      /used\s+to\s+(?:trade|be)\s+(?:at\s+)?\$[\d,.]+/i,
      /(?:52|all)[- ](?:week|time)\s+(?:high|low)/i,
    ],
    description: "Anchoring to a historical price rather than assessing current value",
    severity: "low",
  },
  {
    type: "recency_bias",
    patterns: [
      /just\s+(?:yesterday|today|recently|this\s+week)/i,
      /in\s+the\s+(?:past|last)\s+(?:few\s+)?(?:hours?|days?)/i,
      /very\s+recently/i,
    ],
    description: "Over-weighting recent events relative to broader context",
    severity: "low",
  },
  {
    type: "gambler_fallacy",
    patterns: [
      /(?:due|overdue)\s+for\s+(?:a\s+)?(?:rebound|recovery|correction|bounce)/i,
      /can'?t?\s+(?:keep\s+)?(?:going|dropping|falling)\s+(?:down|forever)/i,
      /has\s+to\s+(?:bounce|recover|correct)\s+(?:eventually|at\s+some\s+point)/i,
    ],
    description: "Assuming past patterns must reverse (gambler's fallacy)",
    severity: "medium",
  },
  {
    type: "confirmation_bias",
    patterns: [
      /(?:as\s+)?(?:I|we)\s+(?:expected|predicted|thought)/i,
      /(?:confirms?|validates?)\s+(?:my|our)\s+(?:thesis|view|analysis)/i,
      /(?:aligns?\s+with|supports?)\s+(?:my|our)\s+(?:earlier|previous)\s+(?:analysis|view)/i,
    ],
    description: "Seeking only information that confirms existing beliefs",
    severity: "medium",
  },
  {
    type: "authority_fallacy",
    patterns: [
      /(?:analysts?|experts?|Wall\s+Street)\s+(?:say|believe|predict|recommend)/i,
      /(?:institutional|smart\s+money)\s+(?:investors?|buyers?)\s+(?:are|have\s+been)/i,
    ],
    description: "Appealing to authority rather than fundamental analysis",
    severity: "low",
  },
  {
    type: "sunk_cost",
    patterns: [
      /already\s+(?:invested|bought|held|have\s+a\s+position)/i,
      /(?:avg|average)\s+(?:down|cost\s+basis)/i,
      /double\s+down/i,
    ],
    description: "Letting past investment influence current decision (sunk cost)",
    severity: "high",
  },
  {
    type: "herd_mentality",
    patterns: [
      /everyone\s+(?:is|seems?\s+to\s+be)\s+(?:buying|selling|bullish|bearish)/i,
      /(?:popular|trending|hot)\s+(?:stock|pick|trade)/i,
      /(?:FOMO|fear\s+of\s+missing\s+out)/i,
    ],
    description: "Following crowd behavior rather than independent analysis",
    severity: "medium",
  },
];

// ---------------------------------------------------------------------------
// Analytical Angle Detection
// ---------------------------------------------------------------------------

const ANALYTICAL_ANGLES: [RegExp, string][] = [
  [/(?:price|valuation|P\/E|P\/B|market\s+cap)/i, "valuation"],
  [/(?:revenue|earnings|EPS|profit|margin|growth\s+rate)/i, "fundamentals"],
  [/(?:RSI|MACD|moving\s+average|bollinger|support|resistance|volume)/i, "technical"],
  [/(?:macro|interest\s+rate|inflation|GDP|Fed|monetary)/i, "macro"],
  [/(?:sentiment|mood|fear|greed|VIX)/i, "sentiment"],
  [/(?:sector|industry|peer|competitor|market\s+share)/i, "sector"],
  [/(?:risk|volatility|drawdown|beta|correlation)/i, "risk"],
  [/(?:news|event|earnings\s+report|announcement|catalyst)/i, "catalyst"],
  [/(?:position\s+size|portfolio|allocation|diversif)/i, "portfolio_management"],
  [/(?:liquidity|bid.ask|spread|slippage|volume)/i, "market_microstructure"],
];

// ---------------------------------------------------------------------------
// Hedge Words
// ---------------------------------------------------------------------------

const HEDGE_WORDS = /\b(?:maybe|perhaps|possibly|might|could|potentially|somewhat|relatively|fairly|arguably|likely|probable|uncertain|debatable)\b/gi;

// ---------------------------------------------------------------------------
// Quantitative Terms
// ---------------------------------------------------------------------------

const QUANT_PATTERNS = /(?:\d+\.?\d*%|\$\d+[\d,.]*|\d+x|\d+\s*(?:bps|basis\s+points)|\d+:\d+\s+ratio)/gi;

// ---------------------------------------------------------------------------
// Finance Vocabulary
// ---------------------------------------------------------------------------

const FINANCE_TERMS = new Set([
  "alpha", "beta", "gamma", "delta", "theta", "vega", "rho",
  "sharpe", "sortino", "treynor", "calmar", "drawdown", "volatility",
  "correlation", "covariance", "regression", "momentum", "reversion",
  "arbitrage", "hedge", "leverage", "margin", "liquidity", "slippage",
  "valuation", "fundamental", "technical", "quantitative", "systematic",
  "diversification", "allocation", "rebalance", "optimization",
  "earnings", "revenue", "ebitda", "cashflow", "dividend",
  "bullish", "bearish", "neutral", "consolidation", "breakout",
  "support", "resistance", "fibonacci", "macd", "rsi", "ema", "sma",
  "vwap", "volume", "spread", "premium", "discount",
]);

// ---------------------------------------------------------------------------
// Core Analysis
// ---------------------------------------------------------------------------

/**
 * Run full pattern analysis on a piece of reasoning text.
 */
export function analyzeReasoningPatterns(
  agentId: string,
  reasoning: string,
): PatternAnalysis {
  const words = reasoning.split(/\s+/).filter((w) => w.length > 0);
  const wordCount = words.length;
  const lowerWords = words.map((w) => w.toLowerCase().replace(/[^a-z]/g, "")).filter((w) => w.length > MIN_WORD_LENGTH);

  // 1. Fallacy detection
  const fallacies: DetectedFallacy[] = [];
  for (const fp of FALLACY_PATTERNS) {
    for (const pattern of fp.patterns) {
      const match = reasoning.match(pattern);
      if (match) {
        fallacies.push({
          type: fp.type,
          description: fp.description,
          severity: fp.severity,
          evidence: match[0],
        });
        break; // Only flag each fallacy type once
      }
    }
  }

  // 2. Analytical depth
  const detectedAngles = new Set<string>();
  for (const [pattern, angle] of ANALYTICAL_ANGLES) {
    if (pattern.test(reasoning)) {
      detectedAngles.add(angle);
    }
  }

  const hasCounterArgument = /(?:however|on\s+the\s+other\s+hand|conversely|alternatively|risk\s+is|downside|counter.?argument)/i.test(reasoning);
  const hasRiskDiscussion = /(?:risk|volatility|downside|stop.?loss|max\s+loss|position\s+limit|cash\s+buffer)/i.test(reasoning);
  const citesSpecificData = /\$\d+[\d,.]*|[+-]?\d+\.?\d*%|\d+\s*(?:shares?|units?)/i.test(reasoning);
  const hasTemporalReasoning = /(?:previously|historically|currently|near.?term|long.?term|short.?term|going\s+forward|outlook)/i.test(reasoning);

  let classification: DepthMetrics["classification"];
  const angleCount = detectedAngles.size;
  if (angleCount >= DEPTH_EXCEPTIONAL_MIN_ANGLES && hasCounterArgument && hasRiskDiscussion) {
    classification = "exceptional";
  } else if (angleCount >= DEPTH_DEEP_MIN_ANGLES && (hasCounterArgument || hasRiskDiscussion)) {
    classification = "deep";
  } else if (angleCount >= DEPTH_MODERATE_MIN_ANGLES) {
    classification = "moderate";
  } else {
    classification = "shallow";
  }

  const depth: DepthMetrics = {
    wordCount,
    analyticalAngles: angleCount,
    hasCounterArgument,
    hasRiskDiscussion,
    citesSpecificData,
    hasTemporalReasoning,
    classification,
  };

  // 3. Vocabulary analysis
  const uniqueWordSet = new Set(lowerWords);
  const uniqueWords = uniqueWordSet.size;
  const typeTokenRatio = lowerWords.length > 0 ? uniqueWords / lowerWords.length : 0;

  let financeTerms = 0;
  for (const word of uniqueWordSet) {
    if (FINANCE_TERMS.has(word)) financeTerms++;
  }

  const sophisticationScore = Math.min(1, (typeTokenRatio * SOPHISTICATION_WEIGHT_TYPE_TOKEN + Math.min(financeTerms / SOPHISTICATION_FINANCE_TERM_DIVISOR, 1) * SOPHISTICATION_WEIGHT_FINANCE_TERMS + Math.min(wordCount / SOPHISTICATION_WORD_COUNT_DIVISOR, 1) * SOPHISTICATION_WEIGHT_WORD_COUNT));

  const vocabulary: VocabularyMetrics = {
    uniqueWords,
    typeTokenRatio: round3(typeTokenRatio),
    financeTerms,
    sophisticationScore: round2(sophisticationScore),
  };

  // 4. Template probability (high similarity if very low type-token ratio)
  const templateProbability = typeTokenRatio < TEMPLATE_TYPE_TOKEN_THRESHOLD ? Math.min(1, (TEMPLATE_TYPE_TOKEN_THRESHOLD - typeTokenRatio) * TEMPLATE_PROBABILITY_MULTIPLIER) : 0;

  // 5. Hedge word ratio
  const hedgeMatches = reasoning.match(HEDGE_WORDS) ?? [];
  const hedgeRatio = wordCount > 0 ? round3(hedgeMatches.length / wordCount) : 0;

  // 6. Quantitative ratio
  const quantMatches = reasoning.match(QUANT_PATTERNS) ?? [];
  const quantitativeRatio = wordCount > 0 ? Math.round((quantMatches.length / Math.max(1, wordCount / QUANTITATIVE_WORD_COUNT_DIVISOR)) * 100) / 100 : 0;

  // 7. Aggregate quality score
  const depthScore = classification === "exceptional" ? DEPTH_SCORE_EXCEPTIONAL
    : classification === "deep" ? DEPTH_SCORE_DEEP
    : classification === "moderate" ? DEPTH_SCORE_MODERATE
    : DEPTH_SCORE_SHALLOW;

  const fallacyPenalty = Math.min(QUALITY_FALLACY_PENALTY_MAX, fallacies.reduce((s, f) => {
    return s + (f.severity === "high" ? QUALITY_FALLACY_PENALTY_HIGH : f.severity === "medium" ? QUALITY_FALLACY_PENALTY_MEDIUM : QUALITY_FALLACY_PENALTY_LOW);
  }, 0));

  const templatePenalty = templateProbability * QUALITY_TEMPLATE_PENALTY_MULTIPLIER;
  const hedgePenalty = Math.min(QUALITY_HEDGE_PENALTY_MAX, hedgeRatio * QUALITY_HEDGE_PENALTY_MULTIPLIER);

  const qualityScore = Math.round(
    clamp(
      depthScore * QUALITY_WEIGHT_DEPTH +
      sophisticationScore * QUALITY_WEIGHT_SOPHISTICATION +
      Math.min(1, quantitativeRatio) * QUALITY_WEIGHT_QUANTITATIVE +
      (1 - fallacyPenalty) * QUALITY_WEIGHT_HALLUCINATION_FREE +
      (1 - templatePenalty - hedgePenalty) * QUALITY_WEIGHT_TEMPLATE_HEDGE,
      0,
      1
    ) * 100,
  ) / 100;

  return {
    agentId,
    fallacies,
    depth,
    vocabulary,
    templateProbability: round2(templateProbability),
    hedgeRatio,
    quantitativeRatio: Math.min(1, quantitativeRatio),
    qualityScore,
  };
}

// ---------------------------------------------------------------------------
// Cross-Trade Pattern Tracking
// ---------------------------------------------------------------------------

interface ReasoningHistory {
  reasoning: string;
  qualityScore: number;
  timestamp: number;
}

const agentHistory = new Map<string, ReasoningHistory[]>();

/**
 * Record a reasoning entry for cross-trade analysis.
 */
export function recordReasoningForPatternAnalysis(
  agentId: string,
  reasoning: string,
  qualityScore: number,
): void {
  const history = agentHistory.get(agentId) ?? [];
  history.push({ reasoning, qualityScore, timestamp: Date.now() });
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }
  agentHistory.set(agentId, history);
}

/**
 * Detect if an agent's reasoning quality is trending up or down.
 */
export function detectQualityTrend(agentId: string): {
  trend: "improving" | "degrading" | "stable";
  recentAvg: number;
  historicalAvg: number;
  sampleCount: number;
} {
  const history = agentHistory.get(agentId) ?? [];
  if (history.length < TREND_MIN_HISTORY) {
    return { trend: "stable", recentAvg: 0, historicalAvg: 0, sampleCount: history.length };
  }

  const mid = Math.floor(history.length / 2);
  const firstHalf = history.slice(0, mid);
  const secondHalf = history.slice(mid);

  const historicalAvg = firstHalf.reduce((s, h) => s + h.qualityScore, 0) / firstHalf.length;
  const recentAvg = secondHalf.reduce((s, h) => s + h.qualityScore, 0) / secondHalf.length;

  const diff = recentAvg - historicalAvg;
  const trend = diff > TREND_IMPROVING_THRESHOLD ? "improving" : diff < TREND_DEGRADING_THRESHOLD ? "degrading" : "stable";

  return {
    trend,
    recentAvg: round2(recentAvg),
    historicalAvg: round2(historicalAvg),
    sampleCount: history.length,
  };
}

/**
 * Detect template/repetitive reasoning by comparing Jaccard similarity
 * of recent reasoning texts.
 */
export function detectTemplateUsage(agentId: string): {
  avgSimilarity: number;
  isTemplated: boolean;
  pairCount: number;
} {
  const history = agentHistory.get(agentId) ?? [];
  if (history.length < TEMPLATE_MIN_HISTORY) {
    return { avgSimilarity: 0, isTemplated: false, pairCount: 0 };
  }

  const recent = history.slice(-TEMPLATE_RECENT_WINDOW);
  let totalSim = 0;
  let pairs = 0;

  for (let i = 0; i < recent.length; i++) {
    for (let j = i + 1; j < recent.length; j++) {
      const setA = new Set(recent[i].reasoning.toLowerCase().split(/\s+/));
      const setB = new Set(recent[j].reasoning.toLowerCase().split(/\s+/));
      const intersection = new Set([...setA].filter((w) => setB.has(w)));
      const union = new Set([...setA, ...setB]);
      const jaccard = union.size > 0 ? intersection.size / union.size : 0;
      totalSim += jaccard;
      pairs++;
    }
  }

  const avgSimilarity = pairs > 0 ? Math.round((totalSim / pairs) * 100) / 100 : 0;

  return {
    avgSimilarity,
    isTemplated: avgSimilarity > TEMPLATE_SIMILARITY_THRESHOLD,
    pairCount: pairs,
  };
}
