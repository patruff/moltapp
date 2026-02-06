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

import { normalize, round3 } from "../lib/math-utils.ts";

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
  const lowerWords = words.map((w) => w.toLowerCase().replace(/[^a-z]/g, "")).filter((w) => w.length > 2);

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
  if (angleCount >= 5 && hasCounterArgument && hasRiskDiscussion) {
    classification = "exceptional";
  } else if (angleCount >= 3 && (hasCounterArgument || hasRiskDiscussion)) {
    classification = "deep";
  } else if (angleCount >= 2) {
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

  const sophisticationScore = Math.min(1, (typeTokenRatio * 0.3 + Math.min(financeTerms / 10, 1) * 0.4 + Math.min(wordCount / 200, 1) * 0.3));

  const vocabulary: VocabularyMetrics = {
    uniqueWords,
    typeTokenRatio: round3(typeTokenRatio),
    financeTerms,
    sophisticationScore: Math.round(sophisticationScore * 100) / 100,
  };

  // 4. Template probability (high similarity if very low type-token ratio)
  const templateProbability = typeTokenRatio < 0.4 ? Math.min(1, (0.4 - typeTokenRatio) * 5) : 0;

  // 5. Hedge word ratio
  const hedgeMatches = reasoning.match(HEDGE_WORDS) ?? [];
  const hedgeRatio = wordCount > 0 ? round3(hedgeMatches.length / wordCount) : 0;

  // 6. Quantitative ratio
  const quantMatches = reasoning.match(QUANT_PATTERNS) ?? [];
  const quantitativeRatio = wordCount > 0 ? Math.round((quantMatches.length / Math.max(1, wordCount / 20)) * 100) / 100 : 0;

  // 7. Aggregate quality score
  const depthScore = classification === "exceptional" ? 1.0
    : classification === "deep" ? 0.75
    : classification === "moderate" ? 0.5
    : 0.25;

  const fallacyPenalty = Math.min(0.4, fallacies.reduce((s, f) => {
    return s + (f.severity === "high" ? 0.15 : f.severity === "medium" ? 0.08 : 0.03);
  }, 0));

  const templatePenalty = templateProbability * 0.3;
  const hedgePenalty = Math.min(0.15, hedgeRatio * 3);

  const qualityScore = Math.round(
    normalize(
      depthScore * 0.35 +
      sophisticationScore * 0.25 +
      Math.min(1, quantitativeRatio) * 0.15 +
      (1 - fallacyPenalty) * 0.15 +
      (1 - templatePenalty - hedgePenalty) * 0.10
    ) * 100,
  ) / 100;

  return {
    agentId,
    fallacies,
    depth,
    vocabulary,
    templateProbability: Math.round(templateProbability * 100) / 100,
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
const MAX_HISTORY = 100;

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
  if (history.length < 10) {
    return { trend: "stable", recentAvg: 0, historicalAvg: 0, sampleCount: history.length };
  }

  const mid = Math.floor(history.length / 2);
  const firstHalf = history.slice(0, mid);
  const secondHalf = history.slice(mid);

  const historicalAvg = firstHalf.reduce((s, h) => s + h.qualityScore, 0) / firstHalf.length;
  const recentAvg = secondHalf.reduce((s, h) => s + h.qualityScore, 0) / secondHalf.length;

  const diff = recentAvg - historicalAvg;
  const trend = diff > 0.05 ? "improving" : diff < -0.05 ? "degrading" : "stable";

  return {
    trend,
    recentAvg: Math.round(recentAvg * 100) / 100,
    historicalAvg: Math.round(historicalAvg * 100) / 100,
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
  if (history.length < 5) {
    return { avgSimilarity: 0, isTemplated: false, pairCount: 0 };
  }

  const recent = history.slice(-10);
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
    isTemplated: avgSimilarity > 0.7,
    pairCount: pairs,
  };
}
