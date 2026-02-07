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
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Dimension weights for overall consistency score calculation.
 *
 * These weights determine how much each dimension contributes to the overall
 * consistency score. Stance consistency (25%) and reasoning evolution (20%)
 * have the highest weight, followed by conviction stability and narrative coherence.
 */

/** Weight for stance consistency dimension (25% of overall score) */
const DIMENSION_WEIGHT_STANCE = 0.25;

/** Weight for conviction stability dimension (20% of overall score) */
const DIMENSION_WEIGHT_CONVICTION = 0.20;

/** Weight for narrative coherence dimension (20% of overall score) */
const DIMENSION_WEIGHT_NARRATIVE = 0.20;

/** Weight for strategy alignment dimension (15% of overall score) */
const DIMENSION_WEIGHT_STRATEGY = 0.15;

/** Weight for reasoning evolution dimension (20% of overall score) */
const DIMENSION_WEIGHT_EVOLUTION = 0.20;

/**
 * Flip-flop detection thresholds.
 *
 * These control when stance reversals (buy→sell or sell→buy) are flagged
 * as anomalies. Shorter time windows indicate more erratic behavior.
 */

/** Time window (hours) for detecting flip-flop behavior */
const FLIP_FLOP_DETECTION_WINDOW_HOURS = 24;

/** Time window (hours) for classifying flip-flop as high severity */
const FLIP_FLOP_HIGH_SEVERITY_HOURS = 4;

/**
 * Stance consistency scoring parameters.
 *
 * Controls how reversal rate affects the stance consistency score.
 */

/** Multiplier for reversal rate penalty (higher = more severe penalty) */
const STANCE_REVERSAL_RATE_MULTIPLIER = 2;

/**
 * Conviction stability thresholds.
 *
 * These detect sudden confidence changes that may indicate poor calibration
 * or unstable reasoning. Large spikes suggest the agent doesn't have a
 * stable internal model.
 */

/** Minimum confidence change to flag as spike (40% = 40 percentage points) */
const CONFIDENCE_SPIKE_THRESHOLD = 0.4;

/** Confidence change threshold for high severity classification (60% = 60 percentage points) */
const CONFIDENCE_SPIKE_HIGH_SEVERITY = 0.6;

/** Standard deviation normalization multiplier for conviction stability scoring */
const CONVICTION_STDDEV_MULTIPLIER = 2.5;

/**
 * Narrative coherence thresholds.
 *
 * These control how much vocabulary overlap between consecutive trades on the
 * same symbol is considered healthy vs suspicious. Some overlap shows continuity;
 * too much suggests copypasta; too little suggests disconnected reasoning.
 */

/** Minimum Jaccard overlap for narrative continuity (10%) */
const NARRATIVE_OVERLAP_MIN = 0.1;

/** Maximum Jaccard overlap before flagging as copypasta (70%) */
const NARRATIVE_OVERLAP_MAX = 0.7;

/** Jaccard overlap threshold for "very low" continuity alert (5%) */
const NARRATIVE_OVERLAP_VERY_LOW = 0.05;

/** Partial credit multiplier for high overlap (copypasta gets 50% credit) */
const NARRATIVE_HIGH_OVERLAP_CREDIT = 0.5;

/**
 * Strategy alignment parameters.
 *
 * Controls how dominant intent share is scored for strategy consistency.
 */

/** Base credit added to dominant intent share for strategy alignment score */
const STRATEGY_BASE_CREDIT = 0.2;

/**
 * Reasoning evolution trend detection thresholds.
 *
 * These classify whether an agent's reasoning quality is improving, stable,
 * or degrading by comparing first-half vs second-half performance.
 */

/** Coherence improvement threshold for "improving" classification (5% increase) */
const EVOLUTION_COHERENCE_IMPROVEMENT_THRESHOLD = 0.05;

/** Length decline threshold for "improving" classification (10% decrease allowed) */
const EVOLUTION_LENGTH_DECLINE_TOLERANCE = 0.1;

/** Coherence decline threshold for "degrading" classification (5% decrease) */
const EVOLUTION_COHERENCE_DECLINE_THRESHOLD = 0.05;

/** Length decline threshold for "degrading" classification (20% decrease) */
const EVOLUTION_LENGTH_DECLINE_THRESHOLD = 0.2;

/** Coherence decline threshold for high severity quality regression (10% decrease) */
const EVOLUTION_COHERENCE_HIGH_DECLINE = 0.1;

/** Average coherence threshold for bonus scoring (70%+) */
const EVOLUTION_HIGH_COHERENCE_BONUS_THRESHOLD = 0.7;

/** Bonus added to evolution score for consistently high coherence */
const EVOLUTION_HIGH_COHERENCE_BONUS = 0.1;

/**
 * Reasoning evolution base scores.
 *
 * Default scores assigned based on trend classification.
 */

/** Base score for improving trend */
const EVOLUTION_SCORE_IMPROVING = 0.85;

/** Base score for stable trend */
const EVOLUTION_SCORE_STABLE = 0.6;

/** Base score for degrading trend */
const EVOLUTION_SCORE_DEGRADING = 0.35;

/**
 * Grade assignment thresholds.
 *
 * These map overall consistency scores to letter grades (A+ through F).
 * Lower thresholds = more lenient grading; higher = stricter.
 */

const GRADE_THRESHOLD_A_PLUS = 0.95;
const GRADE_THRESHOLD_A = 0.90;
const GRADE_THRESHOLD_A_MINUS = 0.85;
const GRADE_THRESHOLD_B_PLUS = 0.80;
const GRADE_THRESHOLD_B = 0.75;
const GRADE_THRESHOLD_B_MINUS = 0.70;
const GRADE_THRESHOLD_C_PLUS = 0.65;
const GRADE_THRESHOLD_C = 0.60;
const GRADE_THRESHOLD_C_MINUS = 0.55;
const GRADE_THRESHOLD_D_PLUS = 0.50;
const GRADE_THRESHOLD_D = 0.45;
const GRADE_THRESHOLD_D_MINUS = 0.40;

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
    stanceResult.score * DIMENSION_WEIGHT_STANCE +
    convictionResult.score * DIMENSION_WEIGHT_CONVICTION +
    narrativeResult.score * DIMENSION_WEIGHT_NARRATIVE +
    strategyResult.score * DIMENSION_WEIGHT_STRATEGY +
    evolutionResult.score * DIMENSION_WEIGHT_EVOLUTION
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

        if (hoursDiff < FLIP_FLOP_DETECTION_WINDOW_HOURS) {
          anomalies.push({
            type: "flip_flop",
            symbol,
            description: `Reversed stance on ${symbol}: ${prev.action} → ${curr.action} within ${hoursDiff.toFixed(1)} hours`,
            severity: hoursDiff < FLIP_FLOP_HIGH_SEVERITY_HOURS ? "high" : "medium",
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
  const score = normalize(1 - reversalRate * STANCE_REVERSAL_RATE_MULTIPLIER);

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
    if (diff > CONFIDENCE_SPIKE_THRESHOLD) {
      anomalies.push({
        type: "confidence_spike",
        symbol: history[i].symbol,
        description: `Confidence jumped ${(diff * 100).toFixed(0)}%: ${(history[i - 1].confidence * 100).toFixed(0)}% → ${(history[i].confidence * 100).toFixed(0)}%`,
        severity: diff > CONFIDENCE_SPIKE_HIGH_SEVERITY ? "high" : "medium",
        roundId: history[i].roundId,
        timestamp: history[i].timestamp,
      });
    }
  }

  // Low stddev = stable conviction = good score
  // stdDev of 0.1 = very stable, 0.3+ = unstable
  const score = normalize(1 - stdDev * CONVICTION_STDDEV_MULTIPLIER);

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
      if (overlap >= NARRATIVE_OVERLAP_MIN && overlap <= NARRATIVE_OVERLAP_MAX) {
        coherentPairs++;
      } else if (overlap > NARRATIVE_OVERLAP_MAX) {
        anomalies.push({
          type: "narrative_break",
          symbol,
          description: `Very high reasoning similarity (${(overlap * 100).toFixed(0)}%) between consecutive ${symbol} trades — possible copypasta`,
          severity: "medium",
          roundId: curr.roundId,
          timestamp: curr.timestamp,
        });
        coherentPairs += NARRATIVE_HIGH_OVERLAP_CREDIT; // Partial credit — at least consistent topic
      } else if (overlap < NARRATIVE_OVERLAP_VERY_LOW) {
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
  const score = Math.min(1, dominantIntentShare + STRATEGY_BASE_CREDIT); // Give some base credit

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
  if (coherenceDelta > EVOLUTION_COHERENCE_IMPROVEMENT_THRESHOLD && lengthDelta > -EVOLUTION_LENGTH_DECLINE_TOLERANCE) {
    trend = "improving";
  } else if (coherenceDelta < -EVOLUTION_COHERENCE_DECLINE_THRESHOLD || lengthDelta < -EVOLUTION_LENGTH_DECLINE_THRESHOLD) {
    trend = "degrading";
    anomalies.push({
      type: "quality_regression",
      symbol: "ALL",
      description: `Reasoning quality declining: coherence ${firstAvgCoherence.toFixed(2)} → ${secondAvgCoherence.toFixed(2)}, ` +
        `avg length ${firstAvgLength.toFixed(0)} → ${secondAvgLength.toFixed(0)} words`,
      severity: coherenceDelta < -EVOLUTION_COHERENCE_HIGH_DECLINE ? "high" : "medium",
      roundId: history[history.length - 1].roundId,
      timestamp: history[history.length - 1].timestamp,
    });
  } else {
    trend = "stable";
  }

  // Score: improving gets bonus, stable is good, degrading loses points
  let score = EVOLUTION_SCORE_STABLE; // Base
  if (trend === "improving") score = EVOLUTION_SCORE_IMPROVING;
  else if (trend === "degrading") score = EVOLUTION_SCORE_DEGRADING;

  // Bonus for consistently high coherence
  const allCoherences = history.map((e) => e.coherenceScore);
  const avgCoherence = allCoherences.reduce((s, v) => s + v, 0) / allCoherences.length;
  if (avgCoherence > EVOLUTION_HIGH_COHERENCE_BONUS_THRESHOLD) score = Math.min(1, score + EVOLUTION_HIGH_COHERENCE_BONUS);

  return { score: round2(score), trend };
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function assignGrade(score: number): string {
  if (score >= GRADE_THRESHOLD_A_PLUS) return "A+";
  if (score >= GRADE_THRESHOLD_A) return "A";
  if (score >= GRADE_THRESHOLD_A_MINUS) return "A-";
  if (score >= GRADE_THRESHOLD_B_PLUS) return "B+";
  if (score >= GRADE_THRESHOLD_B) return "B";
  if (score >= GRADE_THRESHOLD_B_MINUS) return "B-";
  if (score >= GRADE_THRESHOLD_C_PLUS) return "C+";
  if (score >= GRADE_THRESHOLD_C) return "C";
  if (score >= GRADE_THRESHOLD_C_MINUS) return "C-";
  if (score >= GRADE_THRESHOLD_D_PLUS) return "D+";
  if (score >= GRADE_THRESHOLD_D) return "D";
  if (score >= GRADE_THRESHOLD_D_MINUS) return "D-";
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
