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
import { splitSentences } from "../lib/math-utils.ts";

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
// Pattern Libraries
// ---------------------------------------------------------------------------

/** Patterns indicating logical structure in reasoning */
const LOGICAL_STRUCTURE_PATTERNS: [RegExp, number, string][] = [
  [/\b(because|since|therefore|thus|hence|consequently)\b/i, 0.15, "causal_connector"],
  [/\b(first|second|third|finally|additionally|moreover)\b/i, 0.12, "enumeration"],
  [/\b(if\s+.+?\s+then)\b/i, 0.15, "conditional_logic"],
  [/\b(however|although|despite|nevertheless|on\s+the\s+other\s+hand)\b/i, 0.12, "counterpoint"],
  [/\b(based\s+on|according\s+to|given\s+that|considering)\b/i, 0.10, "evidence_reference"],
  [/\b(in\s+conclusion|overall|weighing|on\s+balance)\b/i, 0.10, "synthesis"],
  [/\b(compared\s+to|relative\s+to|versus|vs\.?)\b/i, 0.08, "comparison"],
  [/\b(specifically|in\s+particular|namely|for\s+example)\b/i, 0.08, "specificity"],
];

/** Patterns indicating risk awareness */
const RISK_AWARENESS_PATTERNS: [RegExp, number, string][] = [
  [/\b(risk|downside|danger|threat|exposure)\b/i, 0.12, "risk_mention"],
  [/\b(stop.?loss|trailing\s+stop|risk\s+management)\b/i, 0.15, "risk_tool"],
  [/\b(worst\s+case|scenario|if\s+.+\s+fails?|could\s+go\s+wrong)\b/i, 0.15, "scenario_analysis"],
  [/\b(diversif|hedg|protect|limit\s+losses?)\b/i, 0.12, "risk_mitigation"],
  [/\b(volatil|uncertain|unpredictable)\b/i, 0.08, "uncertainty_awareness"],
  [/\b(position\s+siz|portfolio\s+allocation|cash\s+buffer)\b/i, 0.12, "position_management"],
  [/\b(drawdown|max\s+loss|value\s+at\s+risk|VaR)\b/i, 0.10, "quantitative_risk"],
];

/** Patterns indicating temporal reasoning */
const TEMPORAL_PATTERNS: [RegExp, number, string][] = [
  [/\b(short.?term|near.?term|intraday|this\s+week)\b/i, 0.10, "short_horizon"],
  [/\b(medium.?term|coming\s+weeks?|next\s+quarter)\b/i, 0.12, "medium_horizon"],
  [/\b(long.?term|months?|years?|secular\s+trend)\b/i, 0.12, "long_horizon"],
  [/\b(timing|entry\s+point|exit\s+strategy|when\s+to)\b/i, 0.10, "timing_consideration"],
  [/\b(catalyst|upcoming|scheduled|earnings\s+date|event)\b/i, 0.10, "event_awareness"],
  [/\b(historically|in\s+the\s+past|previous|track\s+record)\b/i, 0.08, "historical_context"],
];

/** Patterns indicating counterfactual thinking */
const COUNTERFACTUAL_PATTERNS: [RegExp, number, string][] = [
  [/\b(what\s+if|suppose|assuming|in\s+case)\b/i, 0.15, "hypothetical"],
  [/\b(alternatively|or\s+else|on\s+the\s+other\s+hand|conversely)\b/i, 0.12, "alternative_view"],
  [/\b(bear\s+case|bull\s+case|best\s+case|worst\s+case)\b/i, 0.15, "scenario_framing"],
  [/\b(could\s+also|might\s+instead|another\s+possibility)\b/i, 0.10, "alternative_outcome"],
  [/\b(risk.?reward|upside.*downside|pros?.*cons?)\b/i, 0.12, "tradeoff_analysis"],
  [/\b(invalidat|disprove|contradict|evidence\s+against)\b/i, 0.12, "self_challenge"],
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

  // Dimension 1: Logical Structure (weight: 0.25)
  const logicalStructure = scoreDimension(
    reasoning,
    LOGICAL_STRUCTURE_PATTERNS,
    0.25,
  );
  if (logicalStructure.score >= 0.6) {
    strengths.push("Well-structured logical reasoning with clear causal connections");
  } else if (logicalStructure.score < 0.3) {
    weaknesses.push("Reasoning lacks logical connectors and structured argumentation");
  }

  // Dimension 2: Evidence Grounding (weight: 0.20)
  const evidenceGrounding = scoreEvidenceGrounding(reasoning, marketData, 0.20);
  if (evidenceGrounding.score >= 0.6) {
    strengths.push("Claims grounded in specific, verifiable data points");
  } else if (evidenceGrounding.score < 0.3) {
    weaknesses.push("Reasoning makes claims without citing specific evidence");
  }

  // Dimension 3: Risk Awareness (weight: 0.20)
  const riskAwareness = scoreDimension(
    reasoning,
    RISK_AWARENESS_PATTERNS,
    0.20,
  );
  if (riskAwareness.score >= 0.5) {
    strengths.push("Demonstrates awareness of risks and position management");
  } else if (action !== "hold" && riskAwareness.score < 0.2) {
    weaknesses.push("No risk awareness for a non-hold trade decision");
  }

  // Dimension 4: Temporal Reasoning (weight: 0.15)
  const temporalReasoning = scoreDimension(
    reasoning,
    TEMPORAL_PATTERNS,
    0.15,
  );
  if (temporalReasoning.score >= 0.5) {
    strengths.push("Considers multiple time horizons in analysis");
  } else if (temporalReasoning.score < 0.15) {
    weaknesses.push("No consideration of time horizon or catalysts");
  }

  // Dimension 5: Counterfactual Thinking (weight: 0.10)
  const counterfactualThinking = scoreDimension(
    reasoning,
    COUNTERFACTUAL_PATTERNS,
    0.10,
  );
  if (counterfactualThinking.score >= 0.5) {
    strengths.push("Considers alternative scenarios and what could go wrong");
  }

  // Dimension 6: Quantitative Rigor (weight: 0.10)
  const quantitativeRigor = scoreQuantitativeRigor(reasoning, confidence, 0.10);
  if (quantitativeRigor.score >= 0.6) {
    strengths.push("Uses specific numbers and quantitative analysis");
  } else if (quantitativeRigor.score < 0.2 && action !== "hold") {
    weaknesses.push("Lacks quantitative data to support trade thesis");
  }

  // Compute overall score
  const overallScore = Math.round(
    (logicalStructure.score * logicalStructure.weight +
      evidenceGrounding.score * evidenceGrounding.weight +
      riskAwareness.score * riskAwareness.weight +
      temporalReasoning.score * temporalReasoning.weight +
      counterfactualThinking.score * counterfactualThinking.weight +
      quantitativeRigor.score * quantitativeRigor.weight) *
      100,
  ) / 100;

  // Text quality bonus/penalty
  let adjustedScore = overallScore;
  if (textMetrics.wordCount < 20) {
    adjustedScore *= 0.5;
    weaknesses.push("Reasoning is very short — insufficient depth for benchmark");
  } else if (textMetrics.wordCount >= 100 && textMetrics.uniqueWordRatio > 0.5) {
    adjustedScore = Math.min(1, adjustedScore * 1.05);
    strengths.push("Rich vocabulary and detailed analysis");
  }

  const finalScore = Math.round(Math.min(1, Math.max(0, adjustedScore)) * 100) / 100;

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
    score: Math.min(1, rawScore),
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
    score += 0.2;
    evidence.push(`price_references(${priceRefs.length})`);
  }

  // Check if reasoning references specific percentage changes
  const pctRefs = reasoning.match(/[+-]?\d+\.?\d*%/g);
  if (pctRefs && pctRefs.length > 0) {
    score += 0.15;
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
      score += Math.min(0.2, symbolRefs * 0.05);
      evidence.push(`stock_references(${symbolRefs})`);
    }
  }

  // Check for volume, market cap, or other data references
  if (/\b(volume|market\s+cap|float|shares\s+outstanding)\b/i.test(reasoning)) {
    score += 0.1;
    evidence.push("market_data_reference");
  }

  // Check for technical indicator references
  if (/\b(RSI|MACD|moving\s+average|bollinger|support|resistance)\b/i.test(reasoning)) {
    score += 0.15;
    evidence.push("technical_indicator");
  }

  // Check for fundamental references
  if (/\b(P\/E|earnings|revenue|margin|cash\s+flow|dividend)\b/i.test(reasoning)) {
    score += 0.15;
    evidence.push("fundamental_data");
  }

  return {
    score: Math.min(1, score),
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
  if (numCount >= 5) {
    score += 0.3;
    evidence.push(`numeric_claims(${numCount})`);
  } else if (numCount >= 2) {
    score += 0.15;
    evidence.push(`numeric_claims(${numCount})`);
  }

  // Check for specific price targets or levels
  if (/\b(target|level|support\s+at|resistance\s+at)\s+\$?\d/i.test(reasoning)) {
    score += 0.2;
    evidence.push("price_target");
  }

  // Check for percentage-based reasoning
  if (/\b\d+\.?\d*%\s+(upside|downside|gain|loss|return)\b/i.test(reasoning)) {
    score += 0.2;
    evidence.push("return_projection");
  }

  // Check for ratio analysis
  if (/\b(ratio|multiple|times|x\s+earnings|valuation)\b/i.test(reasoning)) {
    score += 0.15;
    evidence.push("ratio_analysis");
  }

  // Confidence calibration check — extreme confidence should have strong quant backing
  if (confidence > 0.8 && numCount < 2) {
    score = Math.max(0, score - 0.1);
    evidence.push("overconfident_without_data");
  }

  return {
    score: Math.min(1, score),
    evidence,
    weight,
  };
}

function computeTextMetrics(reasoning: string): TextMetrics {
  const words = reasoning.split(/\s+/).filter((w) => w.length > 0);
  const sentences = splitSentences(reasoning, 3);
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
    avgWordsPerSentence: sentences.length > 0 ? Math.round((words.length / sentences.length) * 10) / 10 : 0,
    uniqueWordRatio: words.length > 0 ? Math.round((uniqueWords.size / words.length) * 100) / 100 : 0,
    technicalTermDensity: words.length > 0 ? Math.round((technicalCount / words.length) * 1000) / 1000 : 0,
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
    logicalStructure: avg(history.map((r) => r.dimensions.logicalStructure.score)),
    evidenceGrounding: avg(history.map((r) => r.dimensions.evidenceGrounding.score)),
    riskAwareness: avg(history.map((r) => r.dimensions.riskAwareness.score)),
    temporalReasoning: avg(history.map((r) => r.dimensions.temporalReasoning.score)),
    counterfactualThinking: avg(history.map((r) => r.dimensions.counterfactualThinking.score)),
    quantitativeRigor: avg(history.map((r) => r.dimensions.quantitativeRigor.score)),
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
    avgOverallScore: Math.round(avgScore * 100) / 100,
    avgGrade: computeGrade(avgScore),
    dimensionAverages: dimAvgs,
    strengthFrequency: Array.from(strengthCounts.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([text, count]) => ({ text, count })),
    weaknessFrequency: Array.from(weaknessCounts.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
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

function avg(nums: number[]): number {
  return nums.length > 0 ? Math.round((nums.reduce((s, v) => s + v, 0) / nums.length) * 100) / 100 : 0;
}
