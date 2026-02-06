/**
 * Reasoning Forensic Engine (v11)
 *
 * Deep structural analysis of agent reasoning text.
 * Goes beyond sentiment-based coherence to measure:
 *
 * 1. CLARITY — Is the reasoning well-structured and readable?
 * 2. DEPTH — How many analytical angles does it cover?
 * 3. ORIGINALITY — Is it templated/repetitive or genuinely novel?
 * 4. CROSS-TRADE INTEGRITY — Does it contradict previous reasoning?
 *
 * This is the engine that powers the v11 benchmark dashboard
 * and HuggingFace forensic exports.
 */

import { clamp, countWords, getFilteredWords, round3, splitSentences } from "../lib/math-utils.ts";
import { computeGrade } from "../lib/grade-calculator.ts";
import { FORENSIC_COMPONENT_WEIGHTS, ORIGINALITY_ANALYSIS_WEIGHTS } from "../lib/scoring-weights.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ForensicReport {
  agentId: string;
  roundId: string;
  tradeAction: string;
  symbol: string;

  structural: StructuralAnalysis;
  depth: DepthAnalysis;
  originality: OriginalityAnalysis;
  clarity: ClarityAnalysis;
  crossTrade: CrossTradeAnalysis;

  compositeScore: number;
  grade: string;
}

export interface StructuralAnalysis {
  sentenceCount: number;
  avgSentenceLength: number;
  quantitativeClaimCount: number;
  hedgeWordCount: number;
  causalConnectorCount: number;
  hasThesis: boolean;
  hasEvidence: boolean;
  hasConclusion: boolean;
  structureScore: number;
}

export interface DepthAnalysis {
  dimensions: Record<string, boolean>;
  dimensionCount: number;
  maxDimensions: number;
  depthScore: number;
  classification: "shallow" | "moderate" | "deep" | "exceptional";
}

export interface OriginalityAnalysis {
  jaccardSimilarityToPrevious: number;
  uniqueNGramRatio: number;
  templateProbability: number;
  originalityScore: number;
}

export interface ClarityAnalysis {
  readabilityScore: number;
  avgWordLength: number;
  jargonRatio: number;
  clarityScore: number;
}

export interface CrossTradeAnalysis {
  contradictsPrevious: boolean;
  similarToPrevious: boolean;
  stanceShift: boolean;
  previousTradeAction?: string;
  previousSymbol?: string;
  confidenceDelta: number;
  flags: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HEDGE_WORDS = /\b(maybe|perhaps|possibly|might|could|uncertain|unclear|somewhat|relatively|arguably|potentially)\b/gi;

const CAUSAL_CONNECTORS = /\b(because|therefore|thus|consequently|since|due to|as a result|given that|leading to|which means|so that|in order to|hence)\b/gi;

const QUANTITATIVE_PATTERNS = /(\$[\d,.]+|\d+\.?\d*%|\d+x|\d+\.\d+ (?:ratio|multiple|beta|alpha)|\d+ (?:basis points|bps)|\d+\.?\d* (?:billion|million|trillion))/gi;

const THESIS_PATTERNS = /\b(my thesis|i believe|the thesis|conviction|primary reason|main driver|key insight|core argument)\b/i;

const EVIDENCE_PATTERNS = /\b(data shows|evidence suggests|based on|according to|analysis reveals|numbers indicate|metrics show|historically)\b/i;

const CONCLUSION_PATTERNS = /\b(therefore|in conclusion|overall|ultimately|net assessment|bottom line|final verdict|action:|decision:)\b/i;

const DIMENSION_PATTERNS: Record<string, RegExp> = {
  valuation: /\b(P\/E|price.to.earnings|valuation|undervalued|overvalued|fair value|intrinsic|market cap|EV\/EBITDA|price.to.book|forward P\/E)\b/i,
  technical: /\b(RSI|MACD|moving average|support|resistance|breakout|trend|momentum|volume spike|relative strength|bollinger|fibonacci)\b/i,
  fundamental: /\b(earnings|revenue|margin|growth rate|EPS|cash flow|balance sheet|debt|ROIC|ROE|free cash flow|operating margin)\b/i,
  macro: /\b(interest rate|inflation|GDP|federal reserve|monetary policy|fiscal|recession|employment|CPI|economic cycle|yield curve)\b/i,
  sentiment: /\b(sentiment|fear|greed|crowd|consensus|contrarian|market mood|VIX|put\/call|retail|institutional|flow)\b/i,
  risk: /\b(risk|downside|stop.loss|position size|exposure|volatility|drawdown|hedge|diversif|max loss|risk.reward)\b/i,
  catalyst: /\b(catalyst|earnings report|product launch|FDA|acquisition|partnership|regulatory|guidance|conference|patent|split)\b/i,
  portfolioContext: /\b(portfolio|allocation|cash|position|rebalance|diversif|concentration|correlation|weight|exposure)\b/i,
  sector: /\b(sector|industry|peer|competitor|market share|cyclical|defensive|rotation|secular|thematic)\b/i,
  timing: /\b(timing|window|entry point|short.term|medium.term|long.term|horizon|quarter|seasonalit|calendar)\b/i,
};

const FINANCE_JARGON = /\b(alpha|beta|sharpe|sortino|drawdown|volatility|correlation|momentum|reversion|arbitrage|spread|yield|duration|convexity|delta|gamma|theta|vega|skew|kurtosis|VaR|CVaR|CAPM|efficient frontier|information ratio|tracking error)\b/gi;

// ---------------------------------------------------------------------------
// In-memory history for cross-trade analysis
// ---------------------------------------------------------------------------

interface PreviousEntry {
  agentId: string;
  reasoning: string;
  action: string;
  symbol: string;
  confidence: number;
  timestamp: number;
}

const agentHistory = new Map<string, PreviousEntry[]>();
const MAX_HISTORY_PER_AGENT = 50;

// ---------------------------------------------------------------------------
// Core Analysis Functions
// ---------------------------------------------------------------------------

/**
 * Run full forensic analysis on a piece of agent reasoning.
 */
export function analyzeForensics(
  agentId: string,
  roundId: string,
  reasoning: string,
  action: string,
  symbol: string,
  confidence: number,
): ForensicReport {
  const structural = analyzeStructure(reasoning);
  const depth = analyzeDepth(reasoning);
  const originality = analyzeOriginality(agentId, reasoning);
  const clarity = analyzeClarity(reasoning);
  const crossTrade = analyzeCrossTrade(agentId, reasoning, action, symbol, confidence);

  // Record in history for future cross-trade analysis
  const history = agentHistory.get(agentId) ?? [];
  history.unshift({ agentId, reasoning, action, symbol, confidence, timestamp: Date.now() });
  if (history.length > MAX_HISTORY_PER_AGENT) history.length = MAX_HISTORY_PER_AGENT;
  agentHistory.set(agentId, history);

  // Composite: weighted average of 5 forensic dimensions (see FORENSIC_COMPONENT_WEIGHTS)
  const compositeScore = Math.round(
    (structural.structureScore * FORENSIC_COMPONENT_WEIGHTS.structure +
      depth.depthScore * FORENSIC_COMPONENT_WEIGHTS.depth +
      originality.originalityScore * FORENSIC_COMPONENT_WEIGHTS.originality +
      clarity.clarityScore * FORENSIC_COMPONENT_WEIGHTS.clarity +
      (1 - (crossTrade.flags.length * 0.15)) * FORENSIC_COMPONENT_WEIGHTS.cross_trade) * 100,
  ) / 100;

  const clampedScore = clamp(compositeScore, 0, 1);

  return {
    agentId,
    roundId,
    tradeAction: action,
    symbol,
    structural,
    depth,
    originality,
    clarity,
    crossTrade,
    compositeScore: clampedScore,
    grade: computeGrade(clampedScore),
  };
}

function analyzeStructure(reasoning: string): StructuralAnalysis {
  const sentences = splitSentences(reasoning, 5);
  const sentenceCount = sentences.length;
  const avgSentenceLength = sentenceCount > 0
    ? sentences.reduce((sum, s) => sum + countWords(s), 0) / sentenceCount
    : 0;

  const quantitativeClaimCount = (reasoning.match(QUANTITATIVE_PATTERNS) ?? []).length;
  const hedgeWordCount = (reasoning.match(HEDGE_WORDS) ?? []).length;
  const causalConnectorCount = (reasoning.match(CAUSAL_CONNECTORS) ?? []).length;

  const hasThesis = THESIS_PATTERNS.test(reasoning);
  const hasEvidence = EVIDENCE_PATTERNS.test(reasoning);
  const hasConclusion = CONCLUSION_PATTERNS.test(reasoning);

  // Structure score: reward logical flow, quantitative claims, penalize excessive hedging
  let structureScore = 0;

  // Sentence count: 3-8 is ideal for trade reasoning
  if (sentenceCount >= 3 && sentenceCount <= 12) structureScore += 0.2;
  else if (sentenceCount >= 1) structureScore += 0.1;

  // Avg sentence length: 8-25 words is clear
  if (avgSentenceLength >= 8 && avgSentenceLength <= 25) structureScore += 0.15;
  else if (avgSentenceLength >= 5) structureScore += 0.08;

  // Quantitative claims add rigor
  structureScore += Math.min(0.25, quantitativeClaimCount * 0.05);

  // Causal connectors show logical reasoning
  structureScore += Math.min(0.2, causalConnectorCount * 0.05);

  // Thesis + evidence + conclusion = well-structured argument
  if (hasThesis) structureScore += 0.08;
  if (hasEvidence) structureScore += 0.08;
  if (hasConclusion) structureScore += 0.04;

  // Hedge words: some hedging is good (epistemic humility), too much is bad
  const words = countWords(reasoning);
  const hedgeRatio = words > 0 ? hedgeWordCount / words : 0;
  if (hedgeRatio > 0.05) {
    structureScore -= (hedgeRatio - 0.05) * 2; // Penalize excessive hedging
  }

  return {
    sentenceCount,
    avgSentenceLength: Math.round(avgSentenceLength * 10) / 10,
    quantitativeClaimCount,
    hedgeWordCount,
    causalConnectorCount,
    hasThesis,
    hasEvidence,
    hasConclusion,
    structureScore: clamp(structureScore, 0, 1),
  };
}

function analyzeDepth(reasoning: string): DepthAnalysis {
  const dimensions: Record<string, boolean> = {};
  let dimensionCount = 0;

  for (const [name, pattern] of Object.entries(DIMENSION_PATTERNS)) {
    const found = pattern.test(reasoning);
    dimensions[name] = found;
    if (found) dimensionCount++;
  }

  const maxDimensions = Object.keys(DIMENSION_PATTERNS).length;
  const depthScore = Math.min(1, dimensionCount / 5); // 5+ dimensions = max score

  let classification: "shallow" | "moderate" | "deep" | "exceptional";
  if (dimensionCount >= 7) classification = "exceptional";
  else if (dimensionCount >= 4) classification = "deep";
  else if (dimensionCount >= 2) classification = "moderate";
  else classification = "shallow";

  return { dimensions, dimensionCount, maxDimensions, depthScore, classification };
}

function analyzeOriginality(agentId: string, reasoning: string): OriginalityAnalysis {
  const history = agentHistory.get(agentId) ?? [];
  const words = new Set(getFilteredWords(reasoning, 3));

  // Jaccard similarity to most recent previous reasoning
  let jaccardSimilarityToPrevious = 0;
  if (history.length > 0) {
    const prevWords = new Set(getFilteredWords(history[0].reasoning, 3));
    const intersection = new Set([...words].filter((w) => prevWords.has(w)));
    const union = new Set([...words, ...prevWords]);
    jaccardSimilarityToPrevious = union.size > 0 ? intersection.size / union.size : 0;
  }

  // N-gram uniqueness: compare 3-grams across recent history
  const currentNGrams = extractNGrams(reasoning, 3);
  let totalHistoryNGrams = new Set<string>();
  for (const prev of history.slice(0, 5)) {
    const prevNGrams = extractNGrams(prev.reasoning, 3);
    totalHistoryNGrams = new Set([...totalHistoryNGrams, ...prevNGrams]);
  }

  const uniqueNGramRatio = currentNGrams.size > 0 && totalHistoryNGrams.size > 0
    ? [...currentNGrams].filter((ng) => !totalHistoryNGrams.has(ng)).length / currentNGrams.size
    : 1;

  // Template probability (high similarity = likely templated)
  const templateProbability = jaccardSimilarityToPrevious > 0.7 ? jaccardSimilarityToPrevious : 0;

  // Originality score: reward uniqueness, penalize templates
  const originalityScore = clamp(
    (1 - jaccardSimilarityToPrevious) * ORIGINALITY_ANALYSIS_WEIGHTS.jaccard_inverse +
    uniqueNGramRatio * ORIGINALITY_ANALYSIS_WEIGHTS.unique_ngrams +
    (1 - templateProbability) * ORIGINALITY_ANALYSIS_WEIGHTS.template_inverse,
    0,
    1,
  );

  return {
    jaccardSimilarityToPrevious: round3(jaccardSimilarityToPrevious),
    uniqueNGramRatio: round3(uniqueNGramRatio),
    templateProbability: round3(templateProbability),
    originalityScore: round3(originalityScore),
  };
}

function analyzeClarity(reasoning: string): ClarityAnalysis {
  const words = reasoning.split(/\s+/).filter((w) => w.length > 0);
  const wordCount = words.length;
  const avgWordLength = wordCount > 0
    ? words.reduce((sum, w) => sum + w.replace(/[^a-zA-Z]/g, "").length, 0) / wordCount
    : 0;

  const jargonMatches = reasoning.match(FINANCE_JARGON) ?? [];
  const jargonRatio = wordCount > 0 ? jargonMatches.length / wordCount : 0;

  // Readability heuristic: penalize very long or very short, reward moderate length
  let readabilityScore = 0;
  if (wordCount >= 30 && wordCount <= 200) readabilityScore = 0.8;
  else if (wordCount >= 15 && wordCount <= 300) readabilityScore = 0.6;
  else if (wordCount >= 5) readabilityScore = 0.3;

  // Average word length: 4-7 chars is readable
  if (avgWordLength >= 4 && avgWordLength <= 7) readabilityScore += 0.1;

  // Some jargon is good (expertise), too much hurts clarity
  if (jargonRatio > 0 && jargonRatio <= 0.08) readabilityScore += 0.1;
  else if (jargonRatio > 0.15) readabilityScore -= 0.1;

  const clarityScore = clamp(readabilityScore, 0, 1);

  return {
    readabilityScore: Math.round(readabilityScore * 100) / 100,
    avgWordLength: Math.round(avgWordLength * 10) / 10,
    jargonRatio: round3(jargonRatio),
    clarityScore: Math.round(clarityScore * 100) / 100,
  };
}

function analyzeCrossTrade(
  agentId: string,
  reasoning: string,
  action: string,
  symbol: string,
  confidence: number,
): CrossTradeAnalysis {
  const history = agentHistory.get(agentId) ?? [];
  const flags: string[] = [];
  let contradictsPrevious = false;
  let similarToPrevious = false;
  let stanceShift = false;
  let confidenceDelta = 0;
  let previousTradeAction: string | undefined;
  let previousSymbol: string | undefined;

  if (history.length > 0) {
    const prev = history[0];
    previousTradeAction = prev.action;
    previousSymbol = prev.symbol;
    confidenceDelta = confidence - prev.confidence;

    // Flip-flop detection: opposite action on same symbol within 24 hours
    const sameSymbolRecent = history.filter(
      (h) => h.symbol.toLowerCase() === symbol.toLowerCase() && Date.now() - h.timestamp < 24 * 60 * 60 * 1000,
    );

    for (const h of sameSymbolRecent) {
      if ((action === "buy" && h.action === "sell") || (action === "sell" && h.action === "buy")) {
        contradictsPrevious = true;
        stanceShift = true;
        flags.push(`Flip-flop: ${action} ${symbol} after ${h.action} within 24h`);
      }
    }

    // Copypasta detection: very similar reasoning to previous trade
    const prevWords = new Set(getFilteredWords(prev.reasoning, 3));
    const currWords = new Set(getFilteredWords(reasoning, 3));
    const intersection = [...currWords].filter((w) => prevWords.has(w)).length;
    const union = new Set([...prevWords, ...currWords]).size;
    const jaccard = union > 0 ? intersection / union : 0;

    if (jaccard > 0.8) {
      similarToPrevious = true;
      flags.push(`Copypasta: ${(jaccard * 100).toFixed(0)}% similarity to previous reasoning`);
    }

    // Confidence drift: confidence jumps > 0.4 between consecutive trades
    if (Math.abs(confidenceDelta) > 0.4) {
      flags.push(`Confidence swing: ${confidenceDelta > 0 ? "+" : ""}${(confidenceDelta * 100).toFixed(0)}% between consecutive trades`);
    }
  }

  return {
    contradictsPrevious,
    similarToPrevious,
    stanceShift,
    previousTradeAction,
    previousSymbol,
    confidenceDelta: round3(confidenceDelta),
    flags,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractNGrams(text: string, n: number): Set<string> {
  const words = getFilteredWords(text, 2);
  const ngrams = new Set<string>();
  for (let i = 0; i <= words.length - n; i++) {
    ngrams.add(words.slice(i, i + n).join(" "));
  }
  return ngrams;
}


// ---------------------------------------------------------------------------
// Aggregate & Query Functions
// ---------------------------------------------------------------------------

/**
 * Get the forensic health summary for an agent.
 * Returns rolling averages from in-memory history.
 */
export function getAgentForensicHealth(agentId: string): {
  tradeCount: number;
  avgDepth: number;
  avgOriginality: number;
  avgClarity: number;
  integrityViolations: number;
  trend: "improving" | "degrading" | "stable";
} {
  const history = agentHistory.get(agentId) ?? [];
  if (history.length === 0) {
    return { tradeCount: 0, avgDepth: 0, avgOriginality: 0, avgClarity: 0, integrityViolations: 0, trend: "stable" };
  }

  // Re-analyze the stored reasoning entries for aggregate
  const reports = history.map((h) => analyzeForensics(
    h.agentId, "aggregate", h.reasoning, h.action, h.symbol, h.confidence,
  ));

  const avgDepth = reports.reduce((s, r) => s + r.depth.depthScore, 0) / reports.length;
  const avgOriginality = reports.reduce((s, r) => s + r.originality.originalityScore, 0) / reports.length;
  const avgClarity = reports.reduce((s, r) => s + r.clarity.clarityScore, 0) / reports.length;
  const totalViolations = reports.reduce((s, r) => s + r.crossTrade.flags.length, 0);

  // Trend: compare first half vs second half
  const mid = Math.floor(reports.length / 2);
  if (mid >= 2) {
    const firstHalf = reports.slice(mid).reduce((s, r) => s + r.compositeScore, 0) / (reports.length - mid);
    const secondHalf = reports.slice(0, mid).reduce((s, r) => s + r.compositeScore, 0) / mid;
    const delta = secondHalf - firstHalf;
    const trend = delta > 0.05 ? "improving" : delta < -0.05 ? "degrading" : "stable";
    return {
      tradeCount: history.length,
      avgDepth: Math.round(avgDepth * 100) / 100,
      avgOriginality: Math.round(avgOriginality * 100) / 100,
      avgClarity: Math.round(avgClarity * 100) / 100,
      integrityViolations: totalViolations,
      trend,
    };
  }

  return {
    tradeCount: history.length,
    avgDepth: Math.round(avgDepth * 100) / 100,
    avgOriginality: Math.round(avgOriginality * 100) / 100,
    avgClarity: Math.round(avgClarity * 100) / 100,
    integrityViolations: totalViolations,
    trend: "stable",
  };
}

/**
 * Get all forensic reports for an agent (from in-memory cache).
 */
export function getAgentForensicReports(agentId: string, limit = 20): ForensicReport[] {
  const history = agentHistory.get(agentId) ?? [];
  return history.slice(0, limit).map((h) => analyzeForensics(
    h.agentId, "query", h.reasoning, h.action, h.symbol, h.confidence,
  ));
}

/**
 * Seed the forensic engine with a reasoning entry (called by orchestrator).
 */
export function seedForensicHistory(
  agentId: string,
  reasoning: string,
  action: string,
  symbol: string,
  confidence: number,
): void {
  const history = agentHistory.get(agentId) ?? [];
  history.unshift({ agentId, reasoning, action, symbol, confidence, timestamp: Date.now() });
  if (history.length > MAX_HISTORY_PER_AGENT) history.length = MAX_HISTORY_PER_AGENT;
  agentHistory.set(agentId, history);
}
