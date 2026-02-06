/**
 * Cross-Round Consistency Tracker v12
 *
 * Tracks how agent reasoning evolves across multiple trading rounds to detect:
 *
 * 1. STANCE CONSISTENCY — Does the agent maintain or logically evolve its view?
 * 2. CONVICTION STABILITY — Does confidence swing wildly without justification?
 * 3. NARRATIVE COHERENCE — Does the agent's story about a stock make sense over time?
 * 4. STRATEGY DRIFT — Is the agent drifting from its declared strategy?
 * 5. REASONING EVOLUTION — Is the agent improving, degrading, or stagnating?
 *
 * This service provides the "memory" dimension of the benchmark —
 * measuring whether agents reason consistently over time or if each
 * trade exists in a vacuum.
 */

import { normalize, round2, countWords } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConsistencyEntry {
  agentId: string;
  roundId: string;
  symbol: string;
  action: "buy" | "sell" | "hold";
  confidence: number;
  reasoning: string;
  intent: string;
  coherenceScore: number;
  timestamp: string;
}

export interface ConsistencyReport {
  agentId: string;
  /** Number of rounds analyzed */
  roundsAnalyzed: number;
  /** Overall consistency score 0-1 */
  overallScore: number;
  /** Grade */
  grade: string;
  /** Per-dimension scores */
  dimensions: {
    stanceConsistency: number;
    convictionStability: number;
    narrativeCoherence: number;
    strategyAlignment: number;
    reasoningEvolution: number;
  };
  /** Detected anomalies */
  anomalies: ConsistencyAnomaly[];
  /** Per-symbol stance history */
  stanceHistory: StanceRecord[];
  /** Trend in reasoning quality */
  qualityTrend: "improving" | "stable" | "degrading" | "insufficient_data";
}

export interface ConsistencyAnomaly {
  type: "flip_flop" | "confidence_spike" | "strategy_switch" | "quality_regression" | "narrative_break";
  symbol: string;
  description: string;
  severity: "low" | "medium" | "high";
  roundId: string;
  timestamp: string;
}

export interface StanceRecord {
  symbol: string;
  /** How many times agent traded this symbol */
  tradeCount: number;
  /** Sequence of actions on this symbol */
  actionSequence: string[];
  /** Was the stance consistent? */
  consistent: boolean;
  /** Number of stance reversals */
  reversals: number;
}

// ---------------------------------------------------------------------------
// In-Memory History
// ---------------------------------------------------------------------------

const consistencyHistory = new Map<string, ConsistencyEntry[]>();
const MAX_HISTORY_PER_AGENT = 300;

/**
 * Record a trade entry for consistency tracking.
 * Called by the orchestrator after each trade.
 */
export function recordConsistencyEntry(entry: ConsistencyEntry): void {
  const history = consistencyHistory.get(entry.agentId) ?? [];
  history.push(entry);
  if (history.length > MAX_HISTORY_PER_AGENT) {
    history.shift();
  }
  consistencyHistory.set(entry.agentId, history);
}

// ---------------------------------------------------------------------------
// Analysis Functions
// ---------------------------------------------------------------------------

/**
 * Generate a full consistency report for an agent.
 */
export function analyzeConsistency(agentId: string): ConsistencyReport {
  const history = consistencyHistory.get(agentId) ?? [];

  if (history.length < 3) {
    return {
      agentId,
      roundsAnalyzed: history.length,
      overallScore: 0.5,
      grade: "N/A",
      dimensions: {
        stanceConsistency: 0.5,
        convictionStability: 0.5,
        narrativeCoherence: 0.5,
        strategyAlignment: 0.5,
        reasoningEvolution: 0.5,
      },
      anomalies: [],
      stanceHistory: [],
      qualityTrend: "insufficient_data",
    };
  }

  const anomalies: ConsistencyAnomaly[] = [];

  // --- Dimension 1: Stance Consistency ---
  const stanceResult = analyzeStanceConsistency(history, anomalies);

  // --- Dimension 2: Conviction Stability ---
  const convictionResult = analyzeConvictionStability(history, anomalies);

  // --- Dimension 3: Narrative Coherence ---
  const narrativeResult = analyzeNarrativeCoherence(history, anomalies);

  // --- Dimension 4: Strategy Alignment ---
  const strategyResult = analyzeStrategyAlignment(history, anomalies);

  // --- Dimension 5: Reasoning Evolution ---
  const evolutionResult = analyzeReasoningEvolution(history, anomalies);

  // Overall score
  const overallScore = Math.round((
    stanceResult.score * 0.25 +
    convictionResult.score * 0.20 +
    narrativeResult.score * 0.20 +
    strategyResult.score * 0.15 +
    evolutionResult.score * 0.20
  ) * 100) / 100;

  const grade = assignGrade(overallScore);

  return {
    agentId,
    roundsAnalyzed: history.length,
    overallScore,
    grade,
    dimensions: {
      stanceConsistency: stanceResult.score,
      convictionStability: convictionResult.score,
      narrativeCoherence: narrativeResult.score,
      strategyAlignment: strategyResult.score,
      reasoningEvolution: evolutionResult.score,
    },
    anomalies,
    stanceHistory: stanceResult.stanceHistory,
    qualityTrend: evolutionResult.trend,
  };
}

// ---------------------------------------------------------------------------
// Stance Consistency
// ---------------------------------------------------------------------------

function analyzeStanceConsistency(
  history: ConsistencyEntry[],
  anomalies: ConsistencyAnomaly[],
): { score: number; stanceHistory: StanceRecord[] } {
  // Group by symbol
  const bySymbol = new Map<string, ConsistencyEntry[]>();
  for (const entry of history) {
    const list = bySymbol.get(entry.symbol) ?? [];
    list.push(entry);
    bySymbol.set(entry.symbol, list);
  }

  const stanceHistory: StanceRecord[] = [];
  let totalReversals = 0;
  let totalTransitions = 0;

  for (const [symbol, entries] of bySymbol) {
    if (entries.length < 2) {
      stanceHistory.push({
        symbol,
        tradeCount: entries.length,
        actionSequence: entries.map((e) => e.action),
        consistent: true,
        reversals: 0,
      });
      continue;
    }

    let reversals = 0;
    const actionSequence = entries.map((e) => e.action);

    for (let i = 1; i < entries.length; i++) {
      const prev = entries[i - 1];
      const curr = entries[i];
      totalTransitions++;

      // Flip-flop: buy → sell or sell → buy within a short window
      if (
        (prev.action === "buy" && curr.action === "sell") ||
        (prev.action === "sell" && curr.action === "buy")
      ) {
        const timeDiff = new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime();
        const hoursDiff = timeDiff / (1000 * 60 * 60);

        reversals++;

        if (hoursDiff < 24) {
          anomalies.push({
            type: "flip_flop",
            symbol,
            description: `Reversed stance on ${symbol}: ${prev.action} → ${curr.action} within ${hoursDiff.toFixed(1)} hours`,
            severity: hoursDiff < 4 ? "high" : "medium",
            roundId: curr.roundId,
            timestamp: curr.timestamp,
          });
        }
      }
    }

    totalReversals += reversals;
    stanceHistory.push({
      symbol,
      tradeCount: entries.length,
      actionSequence,
      consistent: reversals === 0,
      reversals,
    });
  }

  // Score: fewer reversals = higher score
  const reversalRate = totalTransitions > 0 ? totalReversals / totalTransitions : 0;
  const score = normalize(1 - reversalRate * 2);

  return { score: round2(score), stanceHistory };
}

// ---------------------------------------------------------------------------
// Conviction Stability
// ---------------------------------------------------------------------------

function analyzeConvictionStability(
  history: ConsistencyEntry[],
  anomalies: ConsistencyAnomaly[],
): { score: number } {
  if (history.length < 3) return { score: 0.5 };

  const confidences = history.map((e) => e.confidence);

  // Calculate standard deviation of confidence
  const mean = confidences.reduce((s, v) => s + v, 0) / confidences.length;
  const variance = confidences.reduce((s, v) => s + (v - mean) ** 2, 0) / confidences.length;
  const stdDev = Math.sqrt(variance);

  // Check for sudden confidence spikes
  for (let i = 1; i < history.length; i++) {
    const diff = Math.abs(history[i].confidence - history[i - 1].confidence);
    if (diff > 0.4) {
      anomalies.push({
        type: "confidence_spike",
        symbol: history[i].symbol,
        description: `Confidence jumped ${(diff * 100).toFixed(0)}%: ${(history[i - 1].confidence * 100).toFixed(0)}% → ${(history[i].confidence * 100).toFixed(0)}%`,
        severity: diff > 0.6 ? "high" : "medium",
        roundId: history[i].roundId,
        timestamp: history[i].timestamp,
      });
    }
  }

  // Low stddev = stable conviction = good score
  // stdDev of 0.1 = very stable, 0.3+ = unstable
  const score = normalize(1 - stdDev * 2.5);

  return { score: round2(score) };
}

// ---------------------------------------------------------------------------
// Narrative Coherence
// ---------------------------------------------------------------------------

function analyzeNarrativeCoherence(
  history: ConsistencyEntry[],
  anomalies: ConsistencyAnomaly[],
): { score: number } {
  if (history.length < 3) return { score: 0.5 };

  // Group consecutive trades by symbol and check if narratives flow
  const bySymbol = new Map<string, ConsistencyEntry[]>();
  for (const entry of history) {
    const list = bySymbol.get(entry.symbol) ?? [];
    list.push(entry);
    bySymbol.set(entry.symbol, list);
  }

  let coherentPairs = 0;
  let totalPairs = 0;

  for (const [symbol, entries] of bySymbol) {
    if (entries.length < 2) continue;

    for (let i = 1; i < entries.length; i++) {
      totalPairs++;

      const prev = entries[i - 1];
      const curr = entries[i];

      // Check if current reasoning references or builds on previous thinking
      const prevWords = new Set(prev.reasoning.toLowerCase().split(/\s+/));
      const currWords = new Set(curr.reasoning.toLowerCase().split(/\s+/));

      // Jaccard overlap of reasoning vocabulary
      const intersection = [...prevWords].filter((w) => currWords.has(w) && w.length > 4).length;
      const union = new Set([...prevWords, ...currWords]).size;
      const overlap = union > 0 ? intersection / union : 0;

      // Some overlap is good (narrative continuity), but too much is copypasta
      if (overlap >= 0.1 && overlap <= 0.7) {
        coherentPairs++;
      } else if (overlap > 0.7) {
        anomalies.push({
          type: "narrative_break",
          symbol,
          description: `Very high reasoning similarity (${(overlap * 100).toFixed(0)}%) between consecutive ${symbol} trades — possible copypasta`,
          severity: "medium",
          roundId: curr.roundId,
          timestamp: curr.timestamp,
        });
        coherentPairs += 0.5; // Partial credit — at least consistent topic
      } else if (overlap < 0.05) {
        anomalies.push({
          type: "narrative_break",
          symbol,
          description: `No narrative continuity between consecutive ${symbol} trades — reasoning appears disconnected`,
          severity: "low",
          roundId: curr.roundId,
          timestamp: curr.timestamp,
        });
      }
    }
  }

  const score = totalPairs > 0 ? coherentPairs / totalPairs : 0.5;
  return { score: Math.round(Math.min(1, score) * 100) / 100 };
}

// ---------------------------------------------------------------------------
// Strategy Alignment
// ---------------------------------------------------------------------------

function analyzeStrategyAlignment(
  history: ConsistencyEntry[],
  anomalies: ConsistencyAnomaly[],
): { score: number } {
  if (history.length < 5) return { score: 0.5 };

  // Check if intent classification is stable over time
  const intentCounts = new Map<string, number>();
  for (const entry of history) {
    intentCounts.set(entry.intent, (intentCounts.get(entry.intent) ?? 0) + 1);
  }

  // Dominant intent
  const sortedIntents = [...intentCounts.entries()].sort((a, b) => b[1] - a[1]);
  const dominantIntentShare = (sortedIntents[0]?.[1] ?? 0) / history.length;

  // Check for sudden strategy switches in sequence
  for (let i = 1; i < history.length; i++) {
    if (history[i].intent !== history[i - 1].intent) {
      // Different intent from previous trade — is it a window or flip-flop?
      // Look at window of 3 surrounding trades
      const windowStart = Math.max(0, i - 2);
      const windowEnd = Math.min(history.length, i + 2);
      const windowIntents = history.slice(windowStart, windowEnd).map((e) => e.intent);
      const uniqueInWindow = new Set(windowIntents).size;

      if (uniqueInWindow >= 3) {
        anomalies.push({
          type: "strategy_switch",
          symbol: history[i].symbol,
          description: `Strategy changed from ${history[i - 1].intent} to ${history[i].intent} with ${uniqueInWindow} different intents in 5-trade window`,
          severity: "low",
          roundId: history[i].roundId,
          timestamp: history[i].timestamp,
        });
      }
    }
  }

  // Score: higher dominant share = more consistent
  const score = Math.min(1, dominantIntentShare + 0.2); // Give some base credit

  return { score: round2(score) };
}

// ---------------------------------------------------------------------------
// Reasoning Evolution
// ---------------------------------------------------------------------------

function analyzeReasoningEvolution(
  history: ConsistencyEntry[],
  anomalies: ConsistencyAnomaly[],
): { score: number; trend: "improving" | "stable" | "degrading" | "insufficient_data" } {
  if (history.length < 6) return { score: 0.5, trend: "insufficient_data" };

  const half = Math.floor(history.length / 2);
  const firstHalf = history.slice(0, half);
  const secondHalf = history.slice(half);

  // Compare coherence scores between halves
  const firstAvgCoherence = firstHalf.reduce((s, e) => s + e.coherenceScore, 0) / firstHalf.length;
  const secondAvgCoherence = secondHalf.reduce((s, e) => s + e.coherenceScore, 0) / secondHalf.length;

  const coherenceDelta = secondAvgCoherence - firstAvgCoherence;

  // Compare reasoning length (proxy for depth)
  const firstAvgLength = firstHalf.reduce((s, e) => s + countWords(e.reasoning), 0) / firstHalf.length;
  const secondAvgLength = secondHalf.reduce((s, e) => s + countWords(e.reasoning), 0) / secondHalf.length;

  const lengthDelta = (secondAvgLength - firstAvgLength) / Math.max(1, firstAvgLength);

  // Determine trend
  let trend: "improving" | "stable" | "degrading";
  if (coherenceDelta > 0.05 && lengthDelta > -0.1) {
    trend = "improving";
  } else if (coherenceDelta < -0.05 || lengthDelta < -0.2) {
    trend = "degrading";
    anomalies.push({
      type: "quality_regression",
      symbol: "ALL",
      description: `Reasoning quality declining: coherence ${firstAvgCoherence.toFixed(2)} → ${secondAvgCoherence.toFixed(2)}, ` +
        `avg length ${firstAvgLength.toFixed(0)} → ${secondAvgLength.toFixed(0)} words`,
      severity: coherenceDelta < -0.1 ? "high" : "medium",
      roundId: history[history.length - 1].roundId,
      timestamp: history[history.length - 1].timestamp,
    });
  } else {
    trend = "stable";
  }

  // Score: improving gets bonus, stable is good, degrading loses points
  let score = 0.6; // Base
  if (trend === "improving") score = 0.85;
  else if (trend === "degrading") score = 0.35;

  // Bonus for consistently high coherence
  const allCoherences = history.map((e) => e.coherenceScore);
  const avgCoherence = allCoherences.reduce((s, v) => s + v, 0) / allCoherences.length;
  if (avgCoherence > 0.7) score = Math.min(1, score + 0.1);

  return { score: round2(score), trend };
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function assignGrade(score: number): string {
  if (score >= 0.95) return "A+";
  if (score >= 0.90) return "A";
  if (score >= 0.85) return "A-";
  if (score >= 0.80) return "B+";
  if (score >= 0.75) return "B";
  if (score >= 0.70) return "B-";
  if (score >= 0.65) return "C+";
  if (score >= 0.60) return "C";
  if (score >= 0.55) return "C-";
  if (score >= 0.50) return "D+";
  if (score >= 0.45) return "D";
  if (score >= 0.40) return "D-";
  return "F";
}

/**
 * Get all agent IDs that have consistency data.
 */
export function getTrackedAgents(): string[] {
  return [...consistencyHistory.keys()];
}

/**
 * Get consistency history count for an agent.
 */
export function getConsistencyHistorySize(agentId: string): number {
  return (consistencyHistory.get(agentId) ?? []).length;
}
