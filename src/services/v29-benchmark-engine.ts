/**
 * v29 Benchmark Engine
 *
 * Extends MoltApp to an 18-dimension benchmark by adding two new dimensions:
 *
 * 1. MARKET REGIME AWARENESS
 *    Does the agent recognize and adapt to the current market regime
 *    (trending, range-bound, volatile, calm)? Agents that discuss regime
 *    context and adjust strategy accordingly score higher.
 *
 * 2. EDGE CONSISTENCY
 *    Does the agent maintain a repeatable edge across trades? Measures
 *    whether winning trades share a common reasoning pattern and whether
 *    the agent can articulate what its edge actually is.
 *
 * All 18 dimensions feed into a weighted composite score with tier assignment.
 */

import {
  analyzeCoherence,
  detectHallucinations,
  checkInstructionDiscipline,
} from "./coherence-analyzer.ts";
import {
  normalizeConfidence,
  extractSourcesFromReasoning,
  classifyIntent,
} from "../schemas/trade-reasoning.ts";
import { findMax } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface V29TradeGrade {
  coherenceScore: number;
  hallucinationSeverity: number;
  disciplinePassed: boolean;
  reasoningDepth: number;
  sourceDiversity: number;
  riskAwareness: number;
  overallGrade: "A" | "B" | "C" | "D" | "F";
  letterScore: number;
  flags: string[];
}

export interface V29BenchmarkScore {
  agentId: string;
  roundId: string;
  pnlPercent: number;
  sharpeRatio: number;
  reasoningCoherence: number;
  hallucinationRate: number;
  instructionDiscipline: number;
  confidenceCalibration: number;
  reasoningDepth: number;
  sourceDiversity: number;
  strategyConsistency: number;
  adaptability: number;
  riskAwareness: number;
  outcomeAccuracy: number;
  executionQuality: number;
  crossRoundLearning: number;
  tradeAccountability: number;
  reasoningQualityIndex: number;
  marketRegimeAwareness: number;
  edgeConsistency: number;
  compositeScore: number;
  tier: "S" | "A" | "B" | "C" | "D";
  timestamp: string;
}

// ---------------------------------------------------------------------------
// In-memory stores
// ---------------------------------------------------------------------------

const v29RoundData = new Map<string, V29BenchmarkScore[]>();
const v29LeaderboardCache = new Map<string, V29BenchmarkScore>();

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Reasoning Depth Score Thresholds
 *
 * Based on count of causal connectors, logical steps, and conditional statements.
 * Higher thresholds indicate more sophisticated multi-step reasoning.
 */
const DEPTH_THRESHOLD_EXCELLENT = 8;      // ≥8 indicators = 1.0 score (exceptional depth)
const DEPTH_THRESHOLD_VERY_GOOD = 6;      // ≥6 indicators = 0.85 score (strong analysis)
const DEPTH_THRESHOLD_GOOD = 4;           // ≥4 indicators = 0.7 score (solid reasoning)
const DEPTH_THRESHOLD_MODERATE = 2;       // ≥2 indicators = 0.5 score (basic structure)
const DEPTH_THRESHOLD_MINIMAL = 1;        // ≥1 indicator = 0.3 score (minimal effort)
const DEPTH_SCORE_BASELINE = 0.1;         // <1 indicator = 0.1 score (no depth)

/**
 * Market Regime Awareness Score Thresholds
 *
 * Based on count of regime-related keywords (trending, volatile, bull/bear, etc.).
 * Measures whether agent adapts reasoning to market context.
 */
const REGIME_THRESHOLD_EXCELLENT = 4;     // ≥4 regime keywords = 1.0 score (exceptional awareness)
const REGIME_THRESHOLD_STRONG = 3;        // ≥3 regime keywords = 0.8 score (strong adaptation)
const REGIME_THRESHOLD_MODERATE = 2;      // ≥2 regime keywords = 0.6 score (moderate context)
const REGIME_THRESHOLD_MINIMAL = 1;       // ≥1 regime keyword = 0.35 score (basic mention)
const REGIME_SCORE_BASELINE = 0.1;        // <1 keyword = 0.1 score (no regime awareness)

/**
 * Trade Grade Letter Score Thresholds
 *
 * Converts 0-100 composite score to A/B/C/D/F grade for single-trade quality.
 */
const GRADE_THRESHOLD_A = 80;             // ≥80 = "A" (excellent trade reasoning)
const GRADE_THRESHOLD_B = 65;             // ≥65 = "B" (good trade reasoning)
const GRADE_THRESHOLD_C = 50;             // ≥50 = "C" (acceptable trade reasoning)
const GRADE_THRESHOLD_D = 35;             // ≥35 = "D" (poor trade reasoning)
// <35 = "F" (failing trade reasoning)

/**
 * Composite Score Tier Thresholds
 *
 * Converts 0-100 weighted composite score to S/A/B/C/D tier for overall agent performance.
 * Used for leaderboard classification and public agent rankings.
 */
const TIER_THRESHOLD_S = 85;              // ≥85 = "S" tier (exceptional performance)
const TIER_THRESHOLD_A = 70;              // ≥70 = "A" tier (excellent performance)
const TIER_THRESHOLD_B = 55;              // ≥55 = "B" tier (good performance)
const TIER_THRESHOLD_C = 40;              // ≥40 = "C" tier (acceptable performance)
// <40 = "D" tier (poor performance)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp01(v: number): number {
  return Math.round(Math.max(0, Math.min(1, v)) * 100) / 100;
}

function countMatches(text: string, pattern: RegExp): number {
  const g = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
  return (text.match(g) || []).length;
}

// ---------------------------------------------------------------------------
// Dimension Scorers
// ---------------------------------------------------------------------------

/**
 * Analyze reasoning sophistication. Multi-step logic, causal connectors,
 * numbered steps, and conditional statements indicate deeper reasoning.
 */
export function computeReasoningDepthScore(reasoning: string): number {
  const connectors = countMatches(
    reasoning,
    /because|therefore|thus|since|consequently|as\s+a\s+result|this\s+means|which\s+leads/gi,
  );
  const steps = countMatches(reasoning, /\b(?:first|second|third|finally|step\s+\d|1\)|2\)|3\))/gi);
  const conditionals = countMatches(reasoning, /if\s+.{3,}then|unless|provided\s+that|assuming/gi);
  const total = connectors + steps + conditionals;
  if (total >= DEPTH_THRESHOLD_EXCELLENT) return 1.0;
  if (total >= DEPTH_THRESHOLD_VERY_GOOD) return 0.85;
  if (total >= DEPTH_THRESHOLD_GOOD) return 0.7;
  if (total >= DEPTH_THRESHOLD_MODERATE) return 0.5;
  if (total >= DEPTH_THRESHOLD_MINIMAL) return 0.3;
  return DEPTH_SCORE_BASELINE;
}

/**
 * Score source diversity by counting unique source categories cited.
 */
export function computeSourceDiversityScore(sources: string[]): number {
  const categories = new Set([
    "price_feed", "news", "technical", "fundamentals", "portfolio_state",
    "sentiment", "sector_analysis", "volume", "peer_comparison", "macro",
  ]);
  const mapped = new Set<string>();
  const aliasMap: Record<string, string> = {
    market_price_feed: "price_feed", jupiter_price_api: "price_feed",
    "24h_price_change": "price_feed", trading_volume: "volume",
    news_feed: "news", technical_indicators: "technical",
    market_sentiment: "sentiment", market_data: "price_feed",
    portfolio_state: "portfolio_state", sector_analysis: "sector_analysis",
  };
  for (const s of sources) {
    const key = aliasMap[s] ?? s;
    if (categories.has(key)) mapped.add(key);
  }
  return clamp01(mapped.size / 10);
}

/**
 * Measure whether an agent sticks to a dominant strategy or flip-flops.
 * Given the last N classified intents, compute what fraction match the mode.
 */
export function computeStrategyConsistencyScore(recentIntents: string[]): number {
  if (recentIntents.length <= 1) return 0.5;
  const freq: Record<string, number> = {};
  for (const i of recentIntents) freq[i] = (freq[i] || 0) + 1;
  const freqValues = Object.values(freq).map((value) => ({ value }));
  const max = findMax(freqValues, 'value')?.value ?? 0;
  return clamp01(max / recentIntents.length);
}

/**
 * Correlation between self-reported confidence and actual profitability.
 * Perfect calibration: high-confidence trades are profitable, low-confidence
 * trades are losses or small gains.
 */
export function computeConfidenceCalibrationScore(
  trades: Array<{ confidence: number; profitable: boolean }>,
): number {
  if (trades.length < 3) return 0.5;
  let concordant = 0;
  let total = 0;
  for (let i = 0; i < trades.length; i++) {
    for (let j = i + 1; j < trades.length; j++) {
      const confDiff = trades[i].confidence - trades[j].confidence;
      const outDiff = (trades[i].profitable ? 1 : 0) - (trades[j].profitable ? 1 : 0);
      if (confDiff * outDiff > 0) concordant++;
      if (confDiff !== 0 && outDiff !== 0) total++;
    }
  }
  if (total === 0) return 0.5;
  return clamp01(concordant / total);
}

/**
 * Does the agent change behavior after losses? If it keeps repeating the
 * same action on the same symbol after losses, adaptability is low.
 */
export function computeAdaptabilityScore(
  agentTrades: Array<{ action: string; symbol: string; profitable: boolean }>,
): number {
  if (agentTrades.length < 3) return 0.5;
  let adapted = 0;
  let opportunities = 0;
  for (let i = 1; i < agentTrades.length; i++) {
    if (!agentTrades[i - 1].profitable) {
      opportunities++;
      const prev = agentTrades[i - 1];
      const curr = agentTrades[i];
      if (curr.action !== prev.action || curr.symbol !== prev.symbol) adapted++;
    }
  }
  if (opportunities === 0) return 0.7;
  return clamp01(adapted / opportunities);
}

/**
 * Score how much the reasoning discusses risk-related concepts.
 */
export function computeRiskAwarenessScore(
  reasoning: string,
  _portfolio?: { totalValue: number; cashBalance: number },
): number {
  const keywords = [
    /\brisk\b/i, /\bdownside\b/i, /\bstop[\s-]?loss\b/i,
    /\bposition\s+siz/i, /\bexposure\b/i, /\bdiversif/i,
    /\bvolatility\b/i, /\bdrawdown\b/i, /\bhedg/i, /\bcash\s+buffer\b/i,
  ];
  let hits = 0;
  for (const kw of keywords) {
    if (kw.test(reasoning)) hits++;
  }
  return clamp01(hits / 5);
}

/**
 * Market regime awareness: does reasoning reference regime context?
 */
function computeMarketRegimeAwareness(reasoning: string): number {
  const regimeKeywords = countMatches(
    reasoning,
    /trending|range[\s-]?bound|volatile|calm\s+market|bull\s+market|bear\s+market|sideways|regime|macro\s+environment|risk[\s-]?on|risk[\s-]?off|high[\s-]?volatility|low[\s-]?volatility|market\s+condition|current\s+environment/gi,
  );
  if (regimeKeywords >= REGIME_THRESHOLD_EXCELLENT) return 1.0;
  if (regimeKeywords >= REGIME_THRESHOLD_STRONG) return 0.8;
  if (regimeKeywords >= REGIME_THRESHOLD_MODERATE) return 0.6;
  if (regimeKeywords >= REGIME_THRESHOLD_MINIMAL) return 0.35;
  return REGIME_SCORE_BASELINE;
}

/**
 * Edge consistency: do winning trades share a repeatable pattern?
 */
function computeEdgeConsistency(
  agentTrades: Array<{ action: string; intent: string; profitable: boolean }>,
): number {
  const winners = agentTrades.filter((t) => t.profitable);
  if (winners.length < 2) return 0.5;
  const intentFreq: Record<string, number> = {};
  for (const w of winners) intentFreq[w.intent] = (intentFreq[w.intent] || 0) + 1;
  const freqValues = Object.values(intentFreq).map((value) => ({ value }));
  const maxFreq = findMax(freqValues, 'value')?.value ?? 0;
  return clamp01(maxFreq / winners.length);
}

// ---------------------------------------------------------------------------
// Trade Grading
// ---------------------------------------------------------------------------

/**
 * Grade a single trade's reasoning quality across multiple dimensions.
 */
export function gradeTradeReasoning(
  reasoning: string,
  action: "buy" | "sell" | "hold",
  symbol: string,
  marketData: Array<{ symbol: string; price: number; change24h: number }>,
  agentConfig: { maxPositionSize: number; maxPortfolioAllocation: number; riskTolerance: "conservative" | "moderate" | "aggressive" },
  portfolio: { cashBalance: number; totalValue: number; positions: Array<{ symbol: string; quantity: number; currentPrice: number }> },
): V29TradeGrade {
  const coherence = analyzeCoherence(reasoning, action);
  const hallucinations = detectHallucinations(reasoning, marketData.map((m) => ({ ...m, name: m.symbol, mintAddress: "", volume24h: 0 as number | null, change24h: m.change24h as number | null })));
  const discipline = checkInstructionDiscipline(
    { action, symbol, quantity: 0, confidence: normalizeConfidence(0.5) },
    agentConfig,
    portfolio,
  );
  const sources = extractSourcesFromReasoning(reasoning);
  const depth = computeReasoningDepthScore(reasoning);
  const diversity = computeSourceDiversityScore(sources);
  const risk = computeRiskAwarenessScore(reasoning, portfolio);

  const flags: string[] = [...hallucinations.flags, ...discipline.violations];

  const raw = (
    coherence.score * 0.25 +
    (1 - hallucinations.severity) * 0.20 +
    (discipline.passed ? 1 : 0.3) * 0.15 +
    depth * 0.15 +
    diversity * 0.10 +
    risk * 0.15
  ) * 100;

  const letterScore = Math.round(Math.max(0, Math.min(100, raw)));
  let overallGrade: "A" | "B" | "C" | "D" | "F";
  if (letterScore >= GRADE_THRESHOLD_A) overallGrade = "A";
  else if (letterScore >= GRADE_THRESHOLD_B) overallGrade = "B";
  else if (letterScore >= GRADE_THRESHOLD_C) overallGrade = "C";
  else if (letterScore >= GRADE_THRESHOLD_D) overallGrade = "D";
  else overallGrade = "F";

  return {
    coherenceScore: coherence.score,
    hallucinationSeverity: hallucinations.severity,
    disciplinePassed: discipline.passed,
    reasoningDepth: depth,
    sourceDiversity: diversity,
    riskAwareness: risk,
    overallGrade,
    letterScore,
    flags,
  };
}

// ---------------------------------------------------------------------------
// v29 Composite Score
// ---------------------------------------------------------------------------

const V29_WEIGHTS: Record<string, number> = {
  pnlPercent: 0.15,
  sharpeRatio: 0.10,
  reasoningCoherence: 0.12,
  hallucinationRate: 0.10,
  instructionDiscipline: 0.08,
  confidenceCalibration: 0.05,
  reasoningDepth: 0.08,
  sourceDiversity: 0.05,
  strategyConsistency: 0.05,
  adaptability: 0.05,
  riskAwareness: 0.05,
  outcomeAccuracy: 0.04,
  executionQuality: 0.02,
  crossRoundLearning: 0.02,
  tradeAccountability: 0.02,
  reasoningQualityIndex: 0.02,
};

function assignTier(score: number): "S" | "A" | "B" | "C" | "D" {
  if (score >= TIER_THRESHOLD_S) return "S";
  if (score >= TIER_THRESHOLD_A) return "A";
  if (score >= TIER_THRESHOLD_B) return "B";
  if (score >= TIER_THRESHOLD_C) return "C";
  return "D";
}

/**
 * Compute the full 18-dimension v29 benchmark score for an agent in a round.
 */
export function computeV29Score(
  agentId: string,
  roundData: {
    roundId: string;
    pnlPercent: number;
    sharpeRatio: number;
    reasoning: string;
    action: "buy" | "sell" | "hold";
    symbol: string;
    marketData: Array<{ symbol: string; price: number; change24h: number }>;
    agentConfig: { maxPositionSize: number; maxPortfolioAllocation: number; riskTolerance: "conservative" | "moderate" | "aggressive" };
    portfolio: { cashBalance: number; totalValue: number; positions: Array<{ symbol: string; quantity: number; currentPrice: number }> };
    recentIntents: string[];
    pastTrades: Array<{ confidence: number; profitable: boolean; action: string; symbol: string; intent: string }>;
    outcomeAccuracy: number;
    executionQuality: number;
    crossRoundLearning: number;
    tradeAccountability: number;
    reasoningQualityIndex: number;
  },
): V29BenchmarkScore {
  const grade = gradeTradeReasoning(
    roundData.reasoning, roundData.action, roundData.symbol,
    roundData.marketData, roundData.agentConfig, roundData.portfolio,
  );

  const sources = extractSourcesFromReasoning(roundData.reasoning);

  const dims: Record<string, number> = {
    pnlPercent: clamp01((roundData.pnlPercent + 100) / 200),
    sharpeRatio: clamp01((roundData.sharpeRatio + 2) / 4),
    reasoningCoherence: grade.coherenceScore,
    hallucinationRate: clamp01(1 - grade.hallucinationSeverity),
    instructionDiscipline: grade.disciplinePassed ? 1.0 : 0.3,
    confidenceCalibration: computeConfidenceCalibrationScore(roundData.pastTrades),
    reasoningDepth: grade.reasoningDepth,
    sourceDiversity: computeSourceDiversityScore(sources),
    strategyConsistency: computeStrategyConsistencyScore(roundData.recentIntents),
    adaptability: computeAdaptabilityScore(roundData.pastTrades),
    riskAwareness: grade.riskAwareness,
    outcomeAccuracy: clamp01(roundData.outcomeAccuracy),
    executionQuality: clamp01(roundData.executionQuality),
    crossRoundLearning: clamp01(roundData.crossRoundLearning),
    tradeAccountability: clamp01(roundData.tradeAccountability),
    reasoningQualityIndex: clamp01(roundData.reasoningQualityIndex),
    marketRegimeAwareness: computeMarketRegimeAwareness(roundData.reasoning),
    edgeConsistency: computeEdgeConsistency(roundData.pastTrades),
  };

  // Weighted composite (the two new dimensions share the remaining 4%)
  let weighted = 0;
  for (const [dim, weight] of Object.entries(V29_WEIGHTS)) {
    weighted += (dims[dim] ?? 0) * weight;
  }
  weighted += (dims.marketRegimeAwareness ?? 0) * 0.02;
  weighted += (dims.edgeConsistency ?? 0) * 0.02;

  const compositeScore = Math.round(weighted * 100 * 100) / 100;

  const score: V29BenchmarkScore = {
    agentId,
    roundId: roundData.roundId,
    pnlPercent: dims.pnlPercent,
    sharpeRatio: dims.sharpeRatio,
    reasoningCoherence: dims.reasoningCoherence,
    hallucinationRate: dims.hallucinationRate,
    instructionDiscipline: dims.instructionDiscipline,
    confidenceCalibration: dims.confidenceCalibration,
    reasoningDepth: dims.reasoningDepth,
    sourceDiversity: dims.sourceDiversity,
    strategyConsistency: dims.strategyConsistency,
    adaptability: dims.adaptability,
    riskAwareness: dims.riskAwareness,
    outcomeAccuracy: dims.outcomeAccuracy,
    executionQuality: dims.executionQuality,
    crossRoundLearning: dims.crossRoundLearning,
    tradeAccountability: dims.tradeAccountability,
    reasoningQualityIndex: dims.reasoningQualityIndex,
    marketRegimeAwareness: dims.marketRegimeAwareness,
    edgeConsistency: dims.edgeConsistency,
    compositeScore,
    tier: assignTier(compositeScore),
    timestamp: new Date().toISOString(),
  };

  return score;
}

// ---------------------------------------------------------------------------
// Storage & Leaderboard
// ---------------------------------------------------------------------------

/**
 * Store round data for an agent and update the leaderboard cache.
 */
export function recordV29RoundData(
  agentId: string,
  roundId: string,
  score: V29BenchmarkScore,
): void {
  const history = v29RoundData.get(agentId) ?? [];
  history.push(score);
  v29RoundData.set(agentId, history);
  v29LeaderboardCache.set(agentId, score);
}

/**
 * Return the leaderboard sorted by composite score descending.
 */
export function getV29Leaderboard(): Array<V29BenchmarkScore> {
  return Array.from(v29LeaderboardCache.values()).sort(
    (a, b) => b.compositeScore - a.compositeScore,
  );
}

/**
 * Get all round history for an agent.
 */
export function getV29AgentHistory(agentId: string): V29BenchmarkScore[] {
  return v29RoundData.get(agentId) ?? [];
}
