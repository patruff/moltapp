/**
 * Reasoning Volatility Tracker (v14)
 *
 * Measures how much an agent's reasoning CHANGES between trading rounds.
 * A stable, disciplined agent should have consistent reasoning patterns;
 * wild swings in logic suggest the agent is unreliable or reactive.
 *
 * Volatility dimensions:
 * - Sentiment volatility: How much does bullish/bearish tone change?
 * - Confidence volatility: How much does self-reported confidence swing?
 * - Intent drift: How often does the agent switch strategies?
 * - Conviction flip rate: How often does the agent reverse on a stock?
 * - Vocabulary stability: Does the agent use consistent terminology?
 */

import { round3 } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReasoningSnapshot {
  agentId: string;
  roundId: string;
  symbol: string;
  action: "buy" | "sell" | "hold";
  confidence: number;
  intent: string;
  sentimentScore: number; // -1 (bearish) to +1 (bullish)
  wordCount: number;
  coherenceScore: number;
  keyPhrases: string[];
  timestamp: string;
}

export interface VolatilityMetrics {
  agentId: string;
  /** Number of rounds analyzed */
  roundsAnalyzed: number;
  /** Sentiment volatility: std deviation of sentiment scores */
  sentimentVolatility: number;
  /** Confidence volatility: std deviation of confidence values */
  confidenceVolatility: number;
  /** Intent drift rate: fraction of rounds where intent changed vs previous */
  intentDriftRate: number;
  /** Conviction flip rate: how often agent reverses buy↔sell on same stock */
  convictionFlipRate: number;
  /** Average reasoning length coefficient of variation */
  lengthVariability: number;
  /** Composite stability score: 0 (chaos) to 1 (rock-solid) */
  stabilityScore: number;
  /** Grade: A+ (very stable) to F (erratic) */
  grade: string;
  /** Verbal description */
  assessment: string;
  /** Recent trend: stabilizing, volatile, or consistent */
  recentTrend: "stabilizing" | "volatile" | "consistent";
  /** Per-symbol breakdown */
  bySymbol: Record<string, SymbolVolatility>;
}

export interface SymbolVolatility {
  symbol: string;
  tradeCount: number;
  sentimentRange: number; // max - min sentiment
  avgConfidence: number;
  flipCount: number; // buy→sell or sell→buy transitions
  lastAction: string;
}

// ---------------------------------------------------------------------------
// In-Memory Storage
// ---------------------------------------------------------------------------

/** Per-agent reasoning history (circular buffer) */
const agentHistory: Map<string, ReasoningSnapshot[]> = new Map();
const MAX_HISTORY_PER_AGENT = 200;

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

/**
 * Record a reasoning snapshot for volatility tracking.
 */
export function recordReasoningForVolatility(snapshot: ReasoningSnapshot): void {
  const history = agentHistory.get(snapshot.agentId) ?? [];
  history.push(snapshot);

  if (history.length > MAX_HISTORY_PER_AGENT) {
    history.splice(0, history.length - MAX_HISTORY_PER_AGENT);
  }

  agentHistory.set(snapshot.agentId, history);
}

/**
 * Extract a sentiment score from reasoning text using keyword analysis.
 * Returns -1 (very bearish) to +1 (very bullish).
 */
export function computeSentimentScore(reasoning: string): number {
  const bullishTerms = [
    "bullish", "upside", "growth", "opportunity", "undervalued",
    "momentum", "rally", "breakout", "accumulate", "favorable",
    "optimistic", "recovery", "strong", "increase", "gain",
  ];

  const bearishTerms = [
    "bearish", "downside", "risk", "overvalued", "declining",
    "correction", "breakdown", "distribute", "unfavorable",
    "pessimistic", "weakness", "decrease", "loss", "caution",
  ];

  const lower = reasoning.toLowerCase();
  let bullCount = 0;
  let bearCount = 0;

  for (const term of bullishTerms) {
    if (lower.includes(term)) bullCount++;
  }
  for (const term of bearishTerms) {
    if (lower.includes(term)) bearCount++;
  }

  const total = bullCount + bearCount;
  if (total === 0) return 0;

  return (bullCount - bearCount) / total;
}

/**
 * Extract key phrases from reasoning for comparison.
 */
export function extractKeyPhrases(reasoning: string): string[] {
  const phrases: string[] = [];

  // Extract quoted phrases
  const quoted = reasoning.match(/"([^"]+)"/g);
  if (quoted) phrases.push(...quoted.map((q) => q.replace(/"/g, "")));

  // Extract key financial terms
  const financialTerms = reasoning.match(
    /\b(support|resistance|moving average|RSI|MACD|P\/E|earnings|revenue|volume|trend|momentum|mean reversion|value play|hedge|contrarian)\b/gi,
  );
  if (financialTerms) phrases.push(...financialTerms.map((t) => t.toLowerCase()));

  return [...new Set(phrases)].slice(0, 10);
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

/**
 * Analyze reasoning volatility for an agent.
 */
export function analyzeVolatility(agentId: string): VolatilityMetrics {
  const history = agentHistory.get(agentId) ?? [];

  if (history.length < 2) {
    return emptyVolatility(agentId, history.length);
  }

  const n = history.length;

  // 1. Sentiment volatility (standard deviation)
  const sentiments = history.map((h) => h.sentimentScore);
  const sentimentVolatility = standardDeviation(sentiments);

  // 2. Confidence volatility
  const confidences = history.map((h) => h.confidence);
  const confidenceVolatility = standardDeviation(confidences);

  // 3. Intent drift rate
  let intentChanges = 0;
  for (let i = 1; i < n; i++) {
    if (history[i].intent !== history[i - 1].intent) {
      intentChanges++;
    }
  }
  const intentDriftRate = (n - 1) > 0 ? intentChanges / (n - 1) : 0;

  // 4. Conviction flip rate (per stock)
  const symbolActions = new Map<string, string[]>();
  for (const snap of history) {
    const actions = symbolActions.get(snap.symbol) ?? [];
    actions.push(snap.action);
    symbolActions.set(snap.symbol, actions);
  }

  let totalFlips = 0;
  let totalTransitions = 0;
  for (const actions of symbolActions.values()) {
    for (let i = 1; i < actions.length; i++) {
      totalTransitions++;
      if (
        (actions[i] === "buy" && actions[i - 1] === "sell") ||
        (actions[i] === "sell" && actions[i - 1] === "buy")
      ) {
        totalFlips++;
      }
    }
  }
  const convictionFlipRate = totalTransitions > 0 ? totalFlips / totalTransitions : 0;

  // 5. Length variability (coefficient of variation)
  const lengths = history.map((h) => h.wordCount);
  const avgLength = mean(lengths);
  const lengthVariability = avgLength > 0 ? standardDeviation(lengths) / avgLength : 0;

  // 6. Composite stability score
  const stabilityScore = computeStabilityScore(
    sentimentVolatility,
    confidenceVolatility,
    intentDriftRate,
    convictionFlipRate,
    lengthVariability,
  );

  // 7. Recent trend (last 10 vs overall)
  const recentTrend = computeRecentTrend(history);

  // 8. Per-symbol breakdown
  const bySymbol: Record<string, SymbolVolatility> = {};
  for (const [symbol, actions] of symbolActions) {
    const symbolSnaps = history.filter((h) => h.symbol === symbol);
    const symSentiments = symbolSnaps.map((s) => s.sentimentScore);
    const maxSent = Math.max(...symSentiments);
    const minSent = Math.min(...symSentiments);

    let flips = 0;
    for (let i = 1; i < actions.length; i++) {
      if (
        (actions[i] === "buy" && actions[i - 1] === "sell") ||
        (actions[i] === "sell" && actions[i - 1] === "buy")
      ) {
        flips++;
      }
    }

    bySymbol[symbol] = {
      symbol,
      tradeCount: symbolSnaps.length,
      sentimentRange: Math.round((maxSent - minSent) * 100) / 100,
      avgConfidence: round3(mean(symbolSnaps.map((s) => s.confidence))),
      flipCount: flips,
      lastAction: actions[actions.length - 1],
    };
  }

  const grade = gradeStability(stabilityScore);
  const assessment = assessStability(
    sentimentVolatility,
    confidenceVolatility,
    intentDriftRate,
    convictionFlipRate,
    stabilityScore,
  );

  return {
    agentId,
    roundsAnalyzed: n,
    sentimentVolatility: round3(sentimentVolatility),
    confidenceVolatility: round3(confidenceVolatility),
    intentDriftRate: round3(intentDriftRate),
    convictionFlipRate: round3(convictionFlipRate),
    lengthVariability: round3(lengthVariability),
    stabilityScore: round3(stabilityScore),
    grade,
    assessment,
    recentTrend,
    bySymbol,
  };
}

/**
 * Compare volatility across all agents.
 */
export function compareAgentVolatility(): {
  agents: VolatilityMetrics[];
  mostStable: string | null;
  mostVolatile: string | null;
  rankings: { agentId: string; stabilityScore: number; rank: number }[];
} {
  const agentIds = [...agentHistory.keys()];
  const agents = agentIds.map((id) => analyzeVolatility(id));

  const ranked = agents
    .filter((a) => a.roundsAnalyzed >= 3)
    .sort((a, b) => b.stabilityScore - a.stabilityScore);

  return {
    agents,
    mostStable: ranked.length > 0 ? ranked[0].agentId : null,
    mostVolatile: ranked.length > 0 ? ranked[ranked.length - 1].agentId : null,
    rankings: ranked.map((a, i) => ({
      agentId: a.agentId,
      stabilityScore: a.stabilityScore,
      rank: i + 1,
    })),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const squaredDiffs = values.map((v) => Math.pow(v - avg, 2));
  return Math.sqrt(squaredDiffs.reduce((s, v) => s + v, 0) / (values.length - 1));
}

function computeStabilityScore(
  sentVol: number,
  confVol: number,
  intentDrift: number,
  flipRate: number,
  lengthVar: number,
): number {
  // Each dimension contributes to instability; convert to stability
  const sentStability = Math.max(0, 1 - sentVol * 2); // vol=0.5 → 0
  const confStability = Math.max(0, 1 - confVol * 4); // vol=0.25 → 0
  const intentStability = 1 - intentDrift;
  const flipStability = 1 - flipRate;
  const lengthStability = Math.max(0, 1 - lengthVar);

  // Weighted average
  return (
    sentStability * 0.25 +
    confStability * 0.2 +
    intentStability * 0.25 +
    flipStability * 0.2 +
    lengthStability * 0.1
  );
}

function computeRecentTrend(
  history: ReasoningSnapshot[],
): "stabilizing" | "volatile" | "consistent" {
  if (history.length < 10) return "consistent";

  const recentN = Math.min(10, Math.floor(history.length / 2));
  const recent = history.slice(-recentN);
  const older = history.slice(0, -recentN);

  const recentSentVol = standardDeviation(recent.map((h) => h.sentimentScore));
  const olderSentVol = standardDeviation(older.map((h) => h.sentimentScore));

  const recentConfVol = standardDeviation(recent.map((h) => h.confidence));
  const olderConfVol = standardDeviation(older.map((h) => h.confidence));

  const avgRecentVol = (recentSentVol + recentConfVol) / 2;
  const avgOlderVol = (olderSentVol + olderConfVol) / 2;

  if (avgRecentVol < avgOlderVol * 0.7) return "stabilizing";
  if (avgRecentVol > avgOlderVol * 1.3) return "volatile";
  return "consistent";
}

function gradeStability(score: number): string {
  if (score >= 0.9) return "A+";
  if (score >= 0.85) return "A";
  if (score >= 0.8) return "A-";
  if (score >= 0.75) return "B+";
  if (score >= 0.7) return "B";
  if (score >= 0.65) return "B-";
  if (score >= 0.6) return "C+";
  if (score >= 0.5) return "C";
  if (score >= 0.4) return "D";
  return "F";
}

function assessStability(
  sentVol: number,
  confVol: number,
  intentDrift: number,
  flipRate: number,
  stabilityScore: number,
): string {
  const parts: string[] = [];

  if (stabilityScore >= 0.8) {
    parts.push("Highly consistent reasoning patterns across trading rounds.");
  } else if (stabilityScore >= 0.6) {
    parts.push("Moderately stable reasoning with some variation between rounds.");
  } else {
    parts.push("Volatile reasoning patterns — agent changes approach frequently.");
  }

  if (sentVol > 0.3) {
    parts.push("High sentiment swings between rounds.");
  }
  if (confVol > 0.2) {
    parts.push("Confidence levels vary significantly.");
  }
  if (intentDrift > 0.4) {
    parts.push("Frequently switches strategy intent (momentum→value→contrarian).");
  }
  if (flipRate > 0.3) {
    parts.push("Frequently reverses conviction on the same stocks.");
  }

  return parts.join(" ");
}


function emptyVolatility(agentId: string, rounds: number): VolatilityMetrics {
  return {
    agentId,
    roundsAnalyzed: rounds,
    sentimentVolatility: 0,
    confidenceVolatility: 0,
    intentDriftRate: 0,
    convictionFlipRate: 0,
    lengthVariability: 0,
    stabilityScore: 1,
    grade: "N/A",
    assessment: "Insufficient data for volatility analysis (need 2+ rounds).",
    recentTrend: "consistent",
    bySymbol: {},
  };
}
