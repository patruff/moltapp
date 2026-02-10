/**
 * Cross-Session Memory Analyzer (v18)
 *
 * Measures whether AI agents demonstrate genuine learning across trading
 * sessions. This is the "memory" pillar — do agents improve, or do they
 * repeat the same mistakes?
 *
 * Dimensions:
 * 1. MISTAKE REPETITION: Same bad trade pattern recurring
 * 2. LESSON RETENTION: Does post-loss behavior persist?
 * 3. STRATEGY EVOLUTION: Does agent adapt strategy to market conditions?
 * 4. SYMBOL KNOWLEDGE: Does agent build knowledge about specific stocks?
 * 5. CONFIDENCE RECALIBRATION: Does confidence adjust after feedback?
 */

import { normalize, round3 } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Resolution limits for outcome updates.
 * When resolving outcomes for recent trades, cap at this many entries to prevent
 * over-attribution (one market move shouldn't retroactively mark 10 trades correct).
 */
const OUTCOME_RESOLUTION_LIMIT = 3;

/**
 * Mistake pattern detection thresholds.
 * Controls when repeated errors classify as a "pattern" vs random noise.
 */
const MISTAKE_PATTERN_MIN_OCCURRENCES = 2; // Repeated losing trades (same symbol+action)
const INCOHERENCE_PATTERN_MIN_OCCURRENCES = 3; // Low-coherence reasoning on same symbol

/**
 * Coherence quality thresholds.
 * Defines what qualifies as "low coherence" for pattern detection.
 */
const COHERENCE_LOW_THRESHOLD = 0.4; // Below 40% = incoherent reasoning
const COHERENCE_IMPROVEMENT_THRESHOLD = 0.03; // 3% improvement = building knowledge
const COHERENCE_TREND_THRESHOLD = 0.05; // 5% change = improving/declining trend

/**
 * Confidence adjustment thresholds for lesson retention.
 * Determines when confidence changes qualify as "learning from mistakes".
 */
const CONFIDENCE_ADJUSTMENT_THRESHOLD = 0.05; // 5-point confidence drop = agent adapted
const CONFIDENCE_OVERCONFIDENT_THRESHOLD = 0.6; // >60% confidence before miss = overconfident

/**
 * Strategy evolution entropy thresholds.
 * Shannon entropy changes that indicate strategic adaptation.
 */
const ENTROPY_CHANGE_MODERATE = 0.1; // +0.1 entropy = moderate strategy diversity increase
const ENTROPY_CHANGE_STRONG = 0.3; // +0.3 entropy = strong strategy shift
const COHERENCE_IMPROVEMENT_MODERATE = 0.05; // +5% coherence = moderate reasoning improvement
const COHERENCE_IMPROVEMENT_STRONG = 0.1; // +10% coherence = strong reasoning improvement

/**
 * Minimum data requirements for analysis.
 * Prevents spurious conclusions from insufficient data.
 */
const MIN_ENTRIES_FOR_EVOLUTION = 10; // Strategy evolution needs 10+ trades
const MIN_TRADES_FOR_SYMBOL_KNOWLEDGE = 3; // Symbol knowledge tracking needs 3+ trades per symbol

/**
 * Learning curve window parameters.
 * Rolling window size for tracking improvement over time.
 */
const LEARNING_CURVE_WINDOW_SIZE = 10; // 10-entry windows for coherence trend

/**
 * Mistake scoring normalization factor.
 * Divisor for total repeats when calculating mistake score.
 * Lower divisor = more lenient (more mistakes allowed before penalty).
 */
const MISTAKE_SCORING_DIVISOR = 0.3; // Normalize by 30% of total entries

/**
 * Dimension weights for composite memory score.
 * These sum to 1.0 and determine relative importance of each dimension.
 */
const DIMENSION_WEIGHT_MISTAKE_REPETITION = 0.25; // 25% - Avoiding repeated mistakes
const DIMENSION_WEIGHT_LESSON_RETENTION = 0.25; // 25% - Adapting after losses
const DIMENSION_WEIGHT_STRATEGY_EVOLUTION = 0.20; // 20% - Evolving strategy over time
const DIMENSION_WEIGHT_SYMBOL_KNOWLEDGE = 0.15; // 15% - Building stock-specific expertise
const DIMENSION_WEIGHT_CONFIDENCE_RECALIBRATION = 0.15; // 15% - Adjusting confidence after errors

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryEntry {
  agentId: string;
  roundId: string;
  symbol: string;
  action: string;
  confidence: number;
  coherenceScore: number;
  hallucinationCount: number;
  intent: string;
  wasCorrect: boolean | null; // null = not yet resolved
  reasoningFingerprint: string; // Simplified hash for similarity
  timestamp: string;
}

export interface MistakePattern {
  type: string;
  symbol: string;
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  description: string;
}

export interface AgentMemoryProfile {
  agentId: string;
  memoryScore: number;
  totalEntries: number;
  dimensions: {
    mistakeRepetition: number;
    lessonRetention: number;
    strategyEvolution: number;
    symbolKnowledge: number;
    confidenceRecalibration: number;
  };
  repeatedMistakes: MistakePattern[];
  learningCurve: { round: number; score: number }[];
  memoryStrengths: string[];
  memoryWeaknesses: string[];
  trend: "improving" | "stable" | "declining";
  lastUpdated: string;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const agentMemory = new Map<string, MemoryEntry[]>();
const MAX_ENTRIES = 500;

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

/**
 * Record a memory entry for cross-session analysis.
 */
export function recordMemoryEntry(entry: MemoryEntry): void {
  const entries = agentMemory.get(entry.agentId) ?? [];
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  agentMemory.set(entry.agentId, entries);
}

/**
 * Resolve outcome for recent entries matching a symbol.
 */
export function resolveOutcome(
  agentId: string,
  symbol: string,
  wasCorrect: boolean,
): number {
  const entries = agentMemory.get(agentId) ?? [];
  let resolved = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].symbol === symbol && entries[i].wasCorrect === null) {
      entries[i].wasCorrect = wasCorrect;
      resolved++;
      if (resolved >= OUTCOME_RESOLUTION_LIMIT) break; // Resolve at most recent unresolved
    }
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Mistake Repetition Analysis
// ---------------------------------------------------------------------------

/**
 * Detect repeated mistake patterns for an agent.
 */
function analyzeMistakeRepetition(entries: MemoryEntry[]): {
  score: number;
  patterns: MistakePattern[];
} {
  const patterns: MistakePattern[] = [];

  // Group by symbol + action to find repeat losing patterns
  const symbolActionMap = new Map<string, MemoryEntry[]>();
  for (const e of entries) {
    if (e.wasCorrect === false) {
      const key = `${e.symbol}_${e.action}`;
      const list = symbolActionMap.get(key) ?? [];
      list.push(e);
      symbolActionMap.set(key, list);
    }
  }

  for (const [key, losses] of symbolActionMap) {
    if (losses.length >= MISTAKE_PATTERN_MIN_OCCURRENCES) {
      const [symbol, action] = key.split("_");
      patterns.push({
        type: "repeated_losing_trade",
        symbol,
        occurrences: losses.length,
        firstSeen: losses[0].timestamp,
        lastSeen: losses[losses.length - 1].timestamp,
        description: `Agent keeps ${action}ing ${symbol} and losing (${losses.length} times)`,
      });
    }
  }

  // Check for low-coherence repetitions
  const lowCoherenceBySymbol = new Map<string, number>();
  for (const e of entries) {
    if (e.coherenceScore < COHERENCE_LOW_THRESHOLD) {
      lowCoherenceBySymbol.set(e.symbol, (lowCoherenceBySymbol.get(e.symbol) ?? 0) + 1);
    }
  }

  for (const [symbol, count] of lowCoherenceBySymbol) {
    if (count >= INCOHERENCE_PATTERN_MIN_OCCURRENCES) {
      patterns.push({
        type: "persistent_incoherence",
        symbol,
        occurrences: count,
        firstSeen: entries.find((e) => e.symbol === symbol && e.coherenceScore < COHERENCE_LOW_THRESHOLD)?.timestamp ?? "",
        lastSeen: [...entries].reverse().find((e: MemoryEntry) => e.symbol === symbol && e.coherenceScore < COHERENCE_LOW_THRESHOLD)?.timestamp ?? "",
        description: `Agent consistently produces low-coherence reasoning for ${symbol} (${count} times)`,
      });
    }
  }

  // Score: fewer repeats = better memory
  const totalRepeats = patterns.reduce((s, p) => s + p.occurrences, 0);
  const score = entries.length > 0
    ? Math.max(0, 1 - totalRepeats / (entries.length * MISTAKE_SCORING_DIVISOR))
    : 0.5;

  return { score: round3(score), patterns };
}

// ---------------------------------------------------------------------------
// Lesson Retention Analysis
// ---------------------------------------------------------------------------

/**
 * After a loss on a symbol, does the agent change behavior?
 * Lesson = loss on symbol → different action OR lower confidence next time.
 */
function analyzeLessonRetention(entries: MemoryEntry[]): { score: number } {
  let postLossChanges = 0;
  let postLossTotal = 0;

  // Group entries by symbol, in chronological order
  const bySymbol = new Map<string, MemoryEntry[]>();
  for (const e of entries) {
    const list = bySymbol.get(e.symbol) ?? [];
    list.push(e);
    bySymbol.set(e.symbol, list);
  }

  for (const symbolEntries of bySymbol.values()) {
    for (let i = 1; i < symbolEntries.length; i++) {
      const prev = symbolEntries[i - 1];
      const curr = symbolEntries[i];

      if (prev.wasCorrect === false) {
        postLossTotal++;
        // Did agent adapt? Changed action, lowered confidence, or changed intent
        const actionChanged = curr.action !== prev.action;
        const confidenceLowered = curr.confidence < prev.confidence - CONFIDENCE_ADJUSTMENT_THRESHOLD;
        const intentChanged = curr.intent !== prev.intent;

        if (actionChanged || confidenceLowered || intentChanged) {
          postLossChanges++;
        }
      }
    }
  }

  const score = postLossTotal > 0 ? postLossChanges / postLossTotal : 0.5;
  return { score: round3(score) };
}

// ---------------------------------------------------------------------------
// Strategy Evolution Analysis
// ---------------------------------------------------------------------------

/**
 * Does the agent's strategy evolve over time?
 * Measures intent diversity and shift patterns.
 */
function analyzeStrategyEvolution(entries: MemoryEntry[]): { score: number } {
  if (entries.length < MIN_ENTRIES_FOR_EVOLUTION) return { score: 0.5 };

  const mid = Math.floor(entries.length / 2);
  const firstHalf = entries.slice(0, mid);
  const secondHalf = entries.slice(mid);

  // Intent distribution change
  const firstIntents = new Map<string, number>();
  const secondIntents = new Map<string, number>();

  for (const e of firstHalf) {
    firstIntents.set(e.intent, (firstIntents.get(e.intent) ?? 0) + 1);
  }
  for (const e of secondHalf) {
    secondIntents.set(e.intent, (secondIntents.get(e.intent) ?? 0) + 1);
  }

  // Compute intent diversity (Shannon entropy)
  const computeEntropy = (counts: Map<string, number>): number => {
    const total = [...counts.values()].reduce((s, c) => s + c, 0);
    if (total === 0) return 0;
    let entropy = 0;
    for (const c of counts.values()) {
      const p = c / total;
      if (p > 0) entropy -= p * Math.log2(p);
    }
    return entropy;
  };

  const firstEntropy = computeEntropy(firstIntents);
  const secondEntropy = computeEntropy(secondIntents);

  // Higher entropy in second half = more strategic diversity = adapting
  const entropyChange = secondEntropy - firstEntropy;

  // Also check if overall coherence improved
  const firstCoherence = firstHalf.reduce((s, e) => s + e.coherenceScore, 0) / firstHalf.length;
  const secondCoherence = secondHalf.reduce((s, e) => s + e.coherenceScore, 0) / secondHalf.length;
  const coherenceImprovement = secondCoherence - firstCoherence;

  // Score: reward evolution + improvement
  let score = 0.5;
  if (entropyChange > 0.1) score += 0.15; // Strategy diversity increased
  if (entropyChange > 0.3) score += 0.1;
  if (coherenceImprovement > 0.05) score += 0.15; // Reasoning quality improved
  if (coherenceImprovement > 0.1) score += 0.1;

  return { score: round3(Math.min(1, Math.max(0, score))) };
}

// ---------------------------------------------------------------------------
// Symbol Knowledge Analysis
// ---------------------------------------------------------------------------

/**
 * Does the agent build cumulative knowledge about specific stocks?
 * Measured by improving coherence on repeat symbols.
 */
function analyzeSymbolKnowledge(entries: MemoryEntry[]): { score: number } {
  const bySymbol = new Map<string, MemoryEntry[]>();
  for (const e of entries) {
    const list = bySymbol.get(e.symbol) ?? [];
    list.push(e);
    bySymbol.set(e.symbol, list);
  }

  let improvingSymbols = 0;
  let totalTrackedSymbols = 0;

  for (const symbolEntries of bySymbol.values()) {
    if (symbolEntries.length < 3) continue;
    totalTrackedSymbols++;

    const mid = Math.floor(symbolEntries.length / 2);
    const earlyCoherence = symbolEntries.slice(0, mid).reduce((s, e) => s + e.coherenceScore, 0) / mid;
    const lateCoherence = symbolEntries.slice(mid).reduce((s, e) => s + e.coherenceScore, 0) / (symbolEntries.length - mid);

    if (lateCoherence > earlyCoherence + 0.03) {
      improvingSymbols++;
    }
  }

  const score = totalTrackedSymbols > 0 ? improvingSymbols / totalTrackedSymbols : 0.5;
  return { score: round3(normalize(score * 0.8 + 0.2)) };
}

// ---------------------------------------------------------------------------
// Confidence Recalibration
// ---------------------------------------------------------------------------

/**
 * Does agent adjust confidence after incorrect predictions?
 */
function analyzeConfidenceRecalibration(entries: MemoryEntry[]): { score: number } {
  let postMissAdjustments = 0;
  let postMissTotal = 0;

  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1];
    const curr = entries[i];

    if (prev.wasCorrect === false && prev.confidence > 0.6) {
      postMissTotal++;
      // Did agent lower confidence after overconfident miss?
      if (curr.confidence < prev.confidence - 0.05) {
        postMissAdjustments++;
      }
    }
  }

  const score = postMissTotal > 0 ? postMissAdjustments / postMissTotal : 0.5;
  return { score: round3(normalize(score)) };
}

// ---------------------------------------------------------------------------
// Full Memory Profile
// ---------------------------------------------------------------------------

/**
 * Build the complete memory profile for an agent.
 */
export function getAgentMemoryProfile(agentId: string): AgentMemoryProfile {
  const entries = agentMemory.get(agentId) ?? [];

  if (entries.length < 5) {
    return {
      agentId,
      memoryScore: 0.5,
      totalEntries: entries.length,
      dimensions: {
        mistakeRepetition: 0.5,
        lessonRetention: 0.5,
        strategyEvolution: 0.5,
        symbolKnowledge: 0.5,
        confidenceRecalibration: 0.5,
      },
      repeatedMistakes: [],
      learningCurve: [],
      memoryStrengths: [],
      memoryWeaknesses: [],
      trend: "stable",
      lastUpdated: new Date().toISOString(),
    };
  }

  const mistakes = analyzeMistakeRepetition(entries);
  const lessons = analyzeLessonRetention(entries);
  const evolution = analyzeStrategyEvolution(entries);
  const knowledge = analyzeSymbolKnowledge(entries);
  const recalibration = analyzeConfidenceRecalibration(entries);

  const dimensions = {
    mistakeRepetition: mistakes.score,
    lessonRetention: lessons.score,
    strategyEvolution: evolution.score,
    symbolKnowledge: knowledge.score,
    confidenceRecalibration: recalibration.score,
  };

  // Weighted aggregate
  const memoryScore = Math.round(
    (dimensions.mistakeRepetition * 0.25 +
      dimensions.lessonRetention * 0.25 +
      dimensions.strategyEvolution * 0.20 +
      dimensions.symbolKnowledge * 0.15 +
      dimensions.confidenceRecalibration * 0.15) * 1000
  ) / 1000;

  // Learning curve (rolling 10-entry windows)
  const windowSize = 10;
  const learningCurve: { round: number; score: number }[] = [];
  for (let i = windowSize; i <= entries.length; i += windowSize) {
    const window = entries.slice(i - windowSize, i);
    const avgCoherence = window.reduce((s, e) => s + e.coherenceScore, 0) / window.length;
    learningCurve.push({ round: i, score: round3(avgCoherence) });
  }

  // Strengths and weaknesses
  const strengths: string[] = [];
  const weaknesses: string[] = [];

  if (dimensions.mistakeRepetition > 0.7) strengths.push("Avoids repeating mistakes");
  else if (dimensions.mistakeRepetition < 0.4) weaknesses.push("Repeats losing patterns");

  if (dimensions.lessonRetention > 0.7) strengths.push("Learns from losses");
  else if (dimensions.lessonRetention < 0.4) weaknesses.push("Does not adapt after losses");

  if (dimensions.strategyEvolution > 0.7) strengths.push("Evolves strategy over time");
  else if (dimensions.strategyEvolution < 0.4) weaknesses.push("Static strategy regardless of conditions");

  if (dimensions.symbolKnowledge > 0.7) strengths.push("Builds stock-specific expertise");
  else if (dimensions.symbolKnowledge < 0.4) weaknesses.push("No improvement on familiar stocks");

  if (dimensions.confidenceRecalibration > 0.7) strengths.push("Adjusts confidence after misses");
  else if (dimensions.confidenceRecalibration < 0.4) weaknesses.push("Stays overconfident after errors");

  // Trend
  const mid = Math.floor(entries.length / 2);
  const firstHalfScore = entries.slice(0, mid).reduce((s, e) => s + e.coherenceScore, 0) / mid;
  const secondHalfScore = entries.slice(mid).reduce((s, e) => s + e.coherenceScore, 0) / (entries.length - mid);
  const trend: "improving" | "stable" | "declining" =
    secondHalfScore > firstHalfScore + 0.05 ? "improving" :
    secondHalfScore < firstHalfScore - 0.05 ? "declining" : "stable";

  return {
    agentId,
    memoryScore,
    totalEntries: entries.length,
    dimensions,
    repeatedMistakes: mistakes.patterns,
    learningCurve,
    memoryStrengths: strengths,
    memoryWeaknesses: weaknesses,
    trend,
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Get all agent memory profiles.
 */
export function getAllMemoryProfiles(): AgentMemoryProfile[] {
  const agentIds = [...agentMemory.keys()];
  return agentIds.map(getAgentMemoryProfile);
}

/**
 * Get the memory pillar score (0-1) for the benchmark.
 */
export function getMemoryPillarScore(agentId: string): number {
  const profile = getAgentMemoryProfile(agentId);
  return profile.memoryScore;
}
