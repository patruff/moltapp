/**
 * Reasoning Timeline Analyzer
 *
 * Tracks how each agent's reasoning EVOLVES over time. This is a unique
 * benchmark capability: we don't just measure a snapshot, we measure
 * whether agents learn, adapt, or degrade.
 *
 * Key analyses:
 * 1. VOCABULARY DRIFT: Is the agent using different words over time?
 * 2. CONFIDENCE TRAJECTORY: Is confidence increasing or decreasing?
 * 3. STRATEGY SHIFT: Is the agent changing its preferred intent?
 * 4. COHERENCE TRAJECTORY: Is reasoning quality improving?
 * 5. CONSISTENCY: How much does reasoning vary for similar market conditions?
 * 6. ADAPTATION: Does the agent learn from bad outcomes?
 */

import { round3, computeVariance } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReasoningSnapshot {
  agentId: string;
  roundId: string;
  action: string;
  symbol: string;
  reasoning: string;
  confidence: number;
  intent: string;
  coherenceScore: number;
  hallucinationCount: number;
  wordCount: number;
  sentimentScore: number; // -1 to +1
  timestamp: string;
}

export interface AgentTimeline {
  agentId: string;

  /** Total reasoning entries analyzed */
  totalEntries: number;

  /** Confidence trajectory: trend over time */
  confidenceTrajectory: TrajectoryPoint[];

  /** Coherence trajectory */
  coherenceTrajectory: TrajectoryPoint[];

  /** Strategy (intent) distribution over windows */
  strategyEvolution: StrategyWindow[];

  /** Vocabulary metrics over time */
  vocabularyMetrics: VocabularyMetrics;

  /** Adaptation score: does the agent learn from losses? */
  adaptationScore: number;

  /** Consistency score: similar inputs -> similar outputs? */
  consistencyScore: number;

  /** Key inflection points (major changes in behavior) */
  inflectionPoints: InflectionPoint[];

  /** Summary text */
  summary: string;
}

export interface TrajectoryPoint {
  windowStart: string;
  windowEnd: string;
  value: number;
  sampleSize: number;
}

export interface StrategyWindow {
  windowStart: string;
  windowEnd: string;
  distribution: Record<string, number>;
  dominantIntent: string;
}

export interface VocabularyMetrics {
  /** Unique words used across all reasoning */
  totalUniqueWords: number;
  /** Average reasoning length in words */
  avgWordCount: number;
  /** Top 10 most frequently used analysis terms */
  topTerms: Array<{ term: string; frequency: number }>;
  /** Vocabulary richness: unique / total */
  richness: number;
  /** Whether vocabulary is expanding or contracting over time */
  trend: "expanding" | "contracting" | "stable";
}

export interface InflectionPoint {
  timestamp: string;
  roundId: string;
  type: "confidence_shift" | "strategy_change" | "coherence_jump" | "vocabulary_shift";
  description: string;
  magnitude: number; // 0-1 severity
}

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Window Sizing Parameters
 *
 * Controls how reasoning snapshots are grouped into windows for trend analysis.
 */

/**
 * Window count divisor for trajectory analysis.
 *
 * Total entries are divided by this value to determine window count.
 * Example: 100 entries / 10 = 10 windows for trend detection.
 *
 * HIGHER values = MORE windows = FINER granularity (but may be noisier)
 * LOWER values = FEWER windows = SMOOTHER trends (but may miss short-term changes)
 *
 * Current: 10 windows provides good balance between trend detection and noise reduction.
 */
const WINDOW_COUNT_DIVISOR = 10;

/**
 * Minimum window size (entries per window).
 *
 * Prevents windows from becoming too small when total entries is low.
 * Example: 15 total entries / 10 = 1.5 → rounds up to MIN_WINDOW_SIZE (3).
 *
 * Current: 3 ensures each window has at least 3 data points for statistical reliability.
 */
const MIN_WINDOW_SIZE = 3;

/**
 * Trend Detection Thresholds
 *
 * Controls when trajectory changes are classified as "increasing"/"decreasing" vs "stable".
 */

/**
 * Minimum change to classify trend as "increasing" or "improving".
 *
 * Applied to confidence and coherence trajectory comparisons.
 * Example: confidence 0.60 → 0.66 = +0.06 change → "increasing" (> 0.05)
 * Example: confidence 0.60 → 0.63 = +0.03 change → "stable" (<= 0.05)
 *
 * Current: 0.05 (5 percentage points) filters out normal variation noise.
 */
const TREND_IMPROVEMENT_THRESHOLD = 0.05;

/**
 * Minimum change to classify trend as "decreasing" or "declining".
 *
 * Applied to confidence and coherence trajectory comparisons.
 * Example: coherence 0.70 → 0.64 = -0.06 change → "declining" (< -0.05)
 * Example: coherence 0.70 → 0.68 = -0.02 change → "stable" (>= -0.05)
 *
 * Current: -0.05 (negative 5 percentage points) detects significant degradation.
 */
const TREND_DECLINE_THRESHOLD = -0.05;

/**
 * Display Limit Constants
 *
 * Controls how many items are returned in analysis result arrays.
 */

/**
 * Maximum number of top analysis terms shown in vocabulary metrics.
 *
 * Controls how many of the most frequently used analysis terms are included
 * in the topTerms array of VocabularyMetrics (e.g., "bullish", "momentum").
 *
 * Example: Agent uses 80 distinct analysis terms → show top 10 most frequent.
 *
 * HIGHER values = MORE terms shown = more comprehensive vocabulary analysis
 * LOWER values = FEWER terms shown = more focused on dominant vocabulary
 *
 * Current: 10 provides focused vocabulary snapshot without overwhelming API responses.
 */
const TOP_TERMS_DISPLAY_LIMIT = 10;

/**
 * Maximum number of inflection points returned per agent timeline.
 *
 * Controls how many behavior change events (confidence shifts, strategy changes,
 * coherence jumps, vocabulary shifts) are included in the inflectionPoints array.
 * Results are sorted by magnitude (highest severity first).
 *
 * Example: Agent has 25 detected inflection points → return top 10 by magnitude.
 *
 * HIGHER values = MORE inflection points = more detailed behavior change history
 * LOWER values = FEWER inflection points = focused on most significant changes only
 *
 * Current: 10 highlights the most significant behavioral shifts for timeline analysis.
 */
const TOP_INFLECTION_POINTS_DISPLAY_LIMIT = 10;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const snapshots: ReasoningSnapshot[] = [];

/**
 * Maximum reasoning snapshots retained in memory per agent.
 *
 * Prevents unbounded memory growth from long-running benchmarks.
 * When exceeded, oldest snapshots are removed (circular buffer).
 *
 * Current: 5000 snapshots = ~500 trading rounds of history (assuming 10 agents × 1 snapshot/agent/round).
 */
const MAX_SNAPSHOTS = 5000;

// ---------------------------------------------------------------------------
// Record
// ---------------------------------------------------------------------------

/**
 * Record a reasoning snapshot for timeline analysis.
 * Called after each trade decision is analyzed.
 */
export function recordTimelineSnapshot(snapshot: ReasoningSnapshot): void {
  snapshots.push(snapshot);
  if (snapshots.length > MAX_SNAPSHOTS) {
    snapshots.splice(0, snapshots.length - MAX_SNAPSHOTS);
  }
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

/**
 * Build the full timeline analysis for an agent.
 */
export function buildAgentTimeline(agentId: string): AgentTimeline {
  const agentSnapshots = snapshots
    .filter((s) => s.agentId === agentId)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const totalEntries = agentSnapshots.length;

  if (totalEntries === 0) {
    return {
      agentId,
      totalEntries: 0,
      confidenceTrajectory: [],
      coherenceTrajectory: [],
      strategyEvolution: [],
      vocabularyMetrics: emptyVocabularyMetrics(),
      adaptationScore: 0.5,
      consistencyScore: 0.5,
      inflectionPoints: [],
      summary: `No reasoning data available for ${agentId}.`,
    };
  }

  // Window size: every 5 entries or by time
  const windowSize = Math.max(MIN_WINDOW_SIZE, Math.floor(totalEntries / WINDOW_COUNT_DIVISOR));

  const confidenceTrajectory = buildTrajectory(agentSnapshots, windowSize, (s) => s.confidence);
  const coherenceTrajectory = buildTrajectory(agentSnapshots, windowSize, (s) => s.coherenceScore);
  const strategyEvolution = buildStrategyEvolution(agentSnapshots, windowSize);
  const vocabularyMetrics = analyzeVocabulary(agentSnapshots);
  const adaptationScore = computeAdaptationScore(agentSnapshots);
  const consistencyScore = computeConsistencyScore(agentSnapshots);
  const inflectionPoints = detectInflectionPoints(agentSnapshots);

  // Build summary
  const avgConf = agentSnapshots.reduce((s, e) => s + e.confidence, 0) / totalEntries;
  const avgCoherence = agentSnapshots.reduce((s, e) => s + e.coherenceScore, 0) / totalEntries;
  const confTrend = confidenceTrajectory.length >= 2
    ? confidenceTrajectory[confidenceTrajectory.length - 1].value - confidenceTrajectory[0].value
    : 0;
  const cohTrend = coherenceTrajectory.length >= 2
    ? coherenceTrajectory[coherenceTrajectory.length - 1].value - coherenceTrajectory[0].value
    : 0;

  const summary = [
    `${agentId}: ${totalEntries} decisions analyzed.`,
    `Avg confidence: ${(avgConf * 100).toFixed(0)}% (${confTrend > TREND_IMPROVEMENT_THRESHOLD ? "increasing" : confTrend < TREND_DECLINE_THRESHOLD ? "decreasing" : "stable"}).`,
    `Avg coherence: ${avgCoherence.toFixed(2)} (${cohTrend > TREND_IMPROVEMENT_THRESHOLD ? "improving" : cohTrend < TREND_DECLINE_THRESHOLD ? "declining" : "stable"}).`,
    `Adaptation: ${(adaptationScore * 100).toFixed(0)}%. Consistency: ${(consistencyScore * 100).toFixed(0)}%.`,
    `${inflectionPoints.length} behavioral inflection point(s) detected.`,
  ].join(" ");

  return {
    agentId,
    totalEntries,
    confidenceTrajectory,
    coherenceTrajectory,
    strategyEvolution,
    vocabularyMetrics,
    adaptationScore,
    consistencyScore,
    inflectionPoints,
    summary,
  };
}

/**
 * Get all agent timelines.
 */
export function getAllTimelines(): AgentTimeline[] {
  const agentIds = [...new Set(snapshots.map((s) => s.agentId))];
  return agentIds.map(buildAgentTimeline);
}

// ---------------------------------------------------------------------------
// Internal: Trajectory Builders
// ---------------------------------------------------------------------------

function buildTrajectory(
  entries: ReasoningSnapshot[],
  windowSize: number,
  extractor: (s: ReasoningSnapshot) => number,
): TrajectoryPoint[] {
  const points: TrajectoryPoint[] = [];
  for (let i = 0; i < entries.length; i += windowSize) {
    const window = entries.slice(i, i + windowSize);
    if (window.length === 0) continue;

    const avg = window.reduce((s, e) => s + extractor(e), 0) / window.length;
    points.push({
      windowStart: window[0].timestamp,
      windowEnd: window[window.length - 1].timestamp,
      value: round3(avg),
      sampleSize: window.length,
    });
  }
  return points;
}

function buildStrategyEvolution(
  entries: ReasoningSnapshot[],
  windowSize: number,
): StrategyWindow[] {
  const windows: StrategyWindow[] = [];
  for (let i = 0; i < entries.length; i += windowSize) {
    const window = entries.slice(i, i + windowSize);
    if (window.length === 0) continue;

    const counts: Record<string, number> = {};
    for (const e of window) {
      counts[e.intent] = (counts[e.intent] ?? 0) + 1;
    }

    // Normalize to fractions
    const distribution: Record<string, number> = {};
    for (const [k, v] of Object.entries(counts)) {
      distribution[k] = Math.round((v / window.length) * 100) / 100;
    }

    const dominantIntent = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown";

    windows.push({
      windowStart: window[0].timestamp,
      windowEnd: window[window.length - 1].timestamp,
      distribution,
      dominantIntent,
    });
  }
  return windows;
}

// ---------------------------------------------------------------------------
// Internal: Vocabulary Analysis
// ---------------------------------------------------------------------------

const ANALYSIS_TERMS = new Set([
  "bullish", "bearish", "undervalued", "overvalued", "momentum", "trend",
  "breakout", "support", "resistance", "volume", "volatility", "risk",
  "hedge", "rebalance", "accumulate", "distribute", "contrarian",
  "fundamental", "technical", "sentiment", "growth", "value", "recovery",
  "correction", "rally", "sell-off", "consolidation", "divergence",
  "overbought", "oversold", "earnings", "revenue", "margin",
]);

function analyzeVocabulary(entries: ReasoningSnapshot[]): VocabularyMetrics {
  if (entries.length === 0) return emptyVocabularyMetrics();

  const allWords = new Set<string>();
  let totalWordCount = 0;
  const termFrequency = new Map<string, number>();

  for (const entry of entries) {
    const words = entry.reasoning.toLowerCase().split(/\s+/);
    totalWordCount += words.length;

    for (const word of words) {
      const clean = word.replace(/[^a-z-]/g, "");
      if (clean.length >= 3) {
        allWords.add(clean);
        if (ANALYSIS_TERMS.has(clean)) {
          termFrequency.set(clean, (termFrequency.get(clean) ?? 0) + 1);
        }
      }
    }
  }

  const topTerms = [...termFrequency.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_TERMS_DISPLAY_LIMIT)
    .map(([term, frequency]) => ({ term, frequency }));

  const avgWordCount = Math.round(totalWordCount / entries.length);
  const richness = totalWordCount > 0
    ? round3(allWords.size / totalWordCount)
    : 0;

  // Vocabulary trend: compare first half vs second half unique words
  const half = Math.floor(entries.length / 2);
  const firstHalfWords = new Set<string>();
  const secondHalfWords = new Set<string>();

  for (let i = 0; i < entries.length; i++) {
    const words = entries[i].reasoning.toLowerCase().split(/\s+/);
    const targetSet = i < half ? firstHalfWords : secondHalfWords;
    for (const w of words) {
      const clean = w.replace(/[^a-z-]/g, "");
      if (clean.length >= 3) targetSet.add(clean);
    }
  }

  let trend: VocabularyMetrics["trend"] = "stable";
  if (secondHalfWords.size > firstHalfWords.size * 1.1) trend = "expanding";
  else if (secondHalfWords.size < firstHalfWords.size * 0.9) trend = "contracting";

  return {
    totalUniqueWords: allWords.size,
    avgWordCount,
    topTerms,
    richness,
    trend,
  };
}

function emptyVocabularyMetrics(): VocabularyMetrics {
  return {
    totalUniqueWords: 0,
    avgWordCount: 0,
    topTerms: [],
    richness: 0,
    trend: "stable",
  };
}

// ---------------------------------------------------------------------------
// Internal: Adaptation & Consistency Scores
// ---------------------------------------------------------------------------

/**
 * Adaptation: Does the agent change behavior after losses?
 * High adaptation = agent adjusts confidence/strategy after bad outcomes.
 */
function computeAdaptationScore(entries: ReasoningSnapshot[]): number {
  if (entries.length < 4) return 0.5;

  // Look at pairs: after a low-coherence trade, does the agent improve?
  let adaptations = 0;
  let opportunities = 0;

  for (let i = 1; i < entries.length; i++) {
    if (entries[i - 1].coherenceScore < 0.4) {
      opportunities++;
      if (entries[i].coherenceScore > entries[i - 1].coherenceScore) {
        adaptations++;
      }
    }
  }

  return opportunities > 0
    ? Math.round((adaptations / opportunities) * 100) / 100
    : 0.5;
}

/**
 * Consistency: Does the agent give similar reasoning for similar conditions?
 * High consistency = low variance in reasoning quality.
 */
function computeConsistencyScore(entries: ReasoningSnapshot[]): number {
  if (entries.length < 3) return 0.5;

  // Group by symbol and compute coherence variance per symbol
  const bySymbol = new Map<string, number[]>();
  for (const e of entries) {
    const list = bySymbol.get(e.symbol) ?? [];
    list.push(e.coherenceScore);
    bySymbol.set(e.symbol, list);
  }

  const variances: number[] = [];
  for (const [, scores] of bySymbol) {
    if (scores.length < 2) continue;
    const variance = computeVariance(scores, true); // population variance for symbol-specific coherence
    variances.push(variance);
  }

  if (variances.length === 0) return 0.5;

  // Lower variance = higher consistency
  const avgVariance = variances.reduce((s, v) => s + v, 0) / variances.length;
  return Math.round(Math.max(0, 1 - avgVariance * 4) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Internal: Inflection Point Detection
// ---------------------------------------------------------------------------

function detectInflectionPoints(entries: ReasoningSnapshot[]): InflectionPoint[] {
  if (entries.length < 5) return [];

  const points: InflectionPoint[] = [];

  for (let i = 2; i < entries.length - 2; i++) {
    const prevAvgConf = (entries[i - 2].confidence + entries[i - 1].confidence) / 2;
    const nextAvgConf = (entries[i + 1].confidence + entries[i + 2].confidence) / 2;
    const confDelta = Math.abs(nextAvgConf - prevAvgConf);

    if (confDelta > 0.2) {
      points.push({
        timestamp: entries[i].timestamp,
        roundId: entries[i].roundId,
        type: "confidence_shift",
        description: `Confidence shifted from ~${(prevAvgConf * 100).toFixed(0)}% to ~${(nextAvgConf * 100).toFixed(0)}%`,
        magnitude: Math.min(1, confDelta),
      });
    }

    // Coherence jump
    const prevAvgCoh = (entries[i - 2].coherenceScore + entries[i - 1].coherenceScore) / 2;
    const nextAvgCoh = (entries[i + 1].coherenceScore + entries[i + 2].coherenceScore) / 2;
    const cohDelta = Math.abs(nextAvgCoh - prevAvgCoh);

    if (cohDelta > 0.25) {
      points.push({
        timestamp: entries[i].timestamp,
        roundId: entries[i].roundId,
        type: "coherence_jump",
        description: `Coherence ${nextAvgCoh > prevAvgCoh ? "improved" : "declined"} from ${prevAvgCoh.toFixed(2)} to ${nextAvgCoh.toFixed(2)}`,
        magnitude: Math.min(1, cohDelta),
      });
    }

    // Strategy change
    if (i >= 3 && entries[i - 1].intent !== entries[i].intent && entries[i].intent === entries[i + 1]?.intent) {
      points.push({
        timestamp: entries[i].timestamp,
        roundId: entries[i].roundId,
        type: "strategy_change",
        description: `Strategy shifted from ${entries[i - 1].intent} to ${entries[i].intent}`,
        magnitude: 0.6,
      });
    }
  }

  // Deduplicate close inflection points (within 5 entries)
  const deduped: InflectionPoint[] = [];
  for (const p of points) {
    const tooClose = deduped.some(
      (d) => d.type === p.type &&
        Math.abs(new Date(d.timestamp).getTime() - new Date(p.timestamp).getTime()) < 5 * 60 * 1000,
    );
    if (!tooClose) deduped.push(p);
  }

  return deduped.sort((a, b) => b.magnitude - a.magnitude).slice(0, TOP_INFLECTION_POINTS_DISPLAY_LIMIT);
}
