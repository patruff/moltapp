/**
 * Cross-Model Reasoning Comparator (v15)
 *
 * Deep analysis of how different LLM providers reason about the same market data.
 * This is the "model fingerprinting" dimension — do Claude/GPT/Grok have
 * systematically different reasoning patterns, biases, or blind spots?
 *
 * Features:
 * 1. Reasoning similarity: Jaccard/cosine similarity between agent reasoning
 * 2. Divergence analysis: Where do models disagree most?
 * 3. Bias fingerprinting: Systematic biases per LLM provider
 * 4. Vocabulary DNA: Unique vocabulary fingerprint per model
 * 5. Confidence calibration comparison: Which model knows what it knows?
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ComparisonEntry {
  agentId: string;
  action: "buy" | "sell" | "hold";
  symbol: string;
  reasoning: string;
  confidence: number;
  roundId: string;
  timestamp: string;
}

export interface SimilarityScore {
  agentA: string;
  agentB: string;
  jaccardBigram: number;
  actionAgreement: boolean;
  confidenceDelta: number;
}

export interface DivergencePoint {
  roundId: string;
  symbol: string;
  agents: { agentId: string; action: string; confidence: number }[];
  divergenceType: "action_split" | "confidence_spread" | "reasoning_gap";
  severity: number; // 0-1
}

export interface BiasIndicator {
  agentId: string;
  bullishRate: number;
  bearishRate: number;
  neutralRate: number;
  avgConfidence: number;
  overconfidenceRatio: number;
}

export interface RoundComparisonResult {
  roundId: string;
  timestamp: string;
  similarities: SimilarityScore[];
  divergencePoints: DivergencePoint[];
  biasIndicators: BiasIndicator[];
  herdingScore: number; // 0 = total divergence, 1 = total agreement
  participantCount: number;
}

export interface VocabularyDNA {
  topBigrams: [string, number][];
  uniqueWords: string[];
  avgWordCount: number;
  vocabularySize: number;
}

export interface ModelFingerprint {
  agentId: string;
  vocabularyDNA: VocabularyDNA;
  sentimentTendency: { bullishRate: number; bearishRate: number; neutralRate: number };
  confidencePattern: { mean: number; stdDev: number; overconfidenceRatio: number };
  reasoningStyle: { avgLength: number; avgBigramCount: number; uniquenessScore: number };
  sampleSize: number;
}

export interface SystematicDisagreement {
  agentPair: [string, string];
  disagreementRate: number;
  avgConfidenceWhenDisagreeing: number;
  mostDisagreedSymbols: string[];
}

export interface BiasAsymmetry {
  agentId: string;
  direction: "bullish" | "bearish";
  magnitude: number;
  comparedToAvg: number;
}

export interface ModelDivergenceReport {
  systematicDisagreements: SystematicDisagreement[];
  biasAsymmetries: BiasAsymmetry[];
  herdingTrend: number[];
  totalRoundsAnalyzed: number;
}

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Data Retention Limits
 */

/**
 * Maximum comparison entries stored per agent for sliding window analysis.
 * 500 entries = ~500 rounds of trading history per agent for fingerprinting.
 */
const MAX_ENTRIES_PER_AGENT = 500;

/**
 * Divergence Detection Thresholds
 */

/**
 * Confidence spread threshold for flagging divergence points.
 * When max confidence - min confidence > 0.3 across agents in a round,
 * flag as "confidence_spread" divergence type.
 * Example: Agent A conf 90%, Agent B conf 50% = 40% spread > threshold.
 */
const DIVERGENCE_CONFIDENCE_SPREAD_THRESHOLD = 0.3;

/**
 * High confidence threshold for overconfidence ratio calculation.
 * Confidence > 0.8 (80%) is considered "high confidence" for fingerprinting.
 * Used to compute overconfidenceRatio = (entries with conf > threshold) / total.
 */
const CONFIDENCE_HIGH_THRESHOLD = 0.8;

/**
 * Vocabulary DNA Parameters
 */

/**
 * Top N bigrams to include in model vocabulary fingerprint.
 * 20 most frequent bigrams provide signature reasoning patterns per model.
 * Example: Claude might favor "however given", GPT might favor "based on".
 */
const VOCABULARY_TOP_BIGRAMS_LIMIT = 20;

/**
 * Unique words to include in model vocabulary fingerprint.
 * 30 words unique to this agent (not used by other agents) show distinctive vocabulary.
 * Example: Grok might uniquely use "obviously" or "clearly".
 */
const VOCABULARY_UNIQUE_WORDS_LIMIT = 30;

/**
 * Herding Trend Analysis
 */

/**
 * Recent rounds window for herding trend calculation.
 * Last 50 rounds of round comparisons used to compute herding trend over time.
 * Shows whether agents are converging (herding) or diverging over recent history.
 */
const HERDING_TREND_WINDOW = 50;

/**
 * Systematic Disagreement Analysis
 */

/**
 * Top N symbols to display for agent pairs that systematically disagree.
 * Shows the 5 most frequently disagreed-upon stocks per agent pair.
 * Example: Claude-GPT pair might systematically disagree on TSLAx.
 */
const SYSTEMATIC_DISAGREEMENT_TOP_SYMBOLS = 5;

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

const entriesByAgent: Map<string, ComparisonEntry[]> = new Map();
const roundComparisons: RoundComparisonResult[] = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { mean, stdDev, countByCondition } from "../lib/math-utils.ts";

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);
}

function bigrams(tokens: string[]): Set<string> {
  const bg = new Set<string>();
  for (let i = 0; i < tokens.length - 1; i++) {
    bg.add(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return bg;
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Records a single round entry for an agent into the sliding window. */
export function recordRoundForComparison(entry: ComparisonEntry): void {
  if (!entriesByAgent.has(entry.agentId)) {
    entriesByAgent.set(entry.agentId, []);
  }
  const list = entriesByAgent.get(entry.agentId)!;
  list.push(entry);
  // Enforce sliding window
  while (list.length > MAX_ENTRIES_PER_AGENT) {
    list.shift();
  }
}

/** Compares all agents' reasoning for a single round. */
export function compareRoundReasoning(
  roundDecisions: ComparisonEntry[],
): RoundComparisonResult {
  const roundId = roundDecisions[0]?.roundId ?? "unknown";
  const timestamp = roundDecisions[0]?.timestamp ?? new Date().toISOString();

  // --- Pairwise similarity ---
  const similarities: SimilarityScore[] = [];
  for (let i = 0; i < roundDecisions.length; i++) {
    for (let j = i + 1; j < roundDecisions.length; j++) {
      const a = roundDecisions[i];
      const b = roundDecisions[j];
      const tokensA = tokenize(a.reasoning);
      const tokensB = tokenize(b.reasoning);
      const bgA = bigrams(tokensA);
      const bgB = bigrams(tokensB);
      similarities.push({
        agentA: a.agentId,
        agentB: b.agentId,
        jaccardBigram: jaccardSimilarity(bgA, bgB),
        actionAgreement: a.action === b.action,
        confidenceDelta: Math.abs(a.confidence - b.confidence),
      });
    }
  }

  // --- Divergence points ---
  const divergencePoints: DivergencePoint[] = [];
  const actions = roundDecisions.map((d) => d.action);
  const uniqueActions = new Set(actions);
  const confidences = roundDecisions.map((d) => d.confidence);
  const confSpread = Math.max(...confidences) - Math.min(...confidences);

  if (uniqueActions.size > 1) {
    divergencePoints.push({
      roundId,
      symbol: roundDecisions[0]?.symbol ?? "",
      agents: roundDecisions.map((d) => ({
        agentId: d.agentId,
        action: d.action,
        confidence: d.confidence,
      })),
      divergenceType: "action_split",
      severity: (uniqueActions.size - 1) / Math.max(roundDecisions.length - 1, 1),
    });
  }

  if (confSpread > DIVERGENCE_CONFIDENCE_SPREAD_THRESHOLD) {
    divergencePoints.push({
      roundId,
      symbol: roundDecisions[0]?.symbol ?? "",
      agents: roundDecisions.map((d) => ({
        agentId: d.agentId,
        action: d.action,
        confidence: d.confidence,
      })),
      divergenceType: "confidence_spread",
      severity: Math.min(confSpread, 1),
    });
  }

  // --- Bias indicators ---
  const biasIndicators: BiasIndicator[] = roundDecisions.map((d) => {
    const agentEntries = entriesByAgent.get(d.agentId) ?? [d];
    const total = agentEntries.length;
    const buys = countByCondition(agentEntries, (e) => e.action === "buy");
    const sells = countByCondition(agentEntries, (e) => e.action === "sell");
    const holds = countByCondition(agentEntries, (e) => e.action === "hold");
    const confs = agentEntries.map((e) => e.confidence);
    const avgConf = mean(confs);
    // Overconfidence: confidence > threshold while historically wrong is hard to
    // measure without outcomes, so we proxy as % of entries with conf > threshold
    const highConf = countByCondition(agentEntries, (e) => e.confidence > CONFIDENCE_HIGH_THRESHOLD);
    return {
      agentId: d.agentId,
      bullishRate: buys / total,
      bearishRate: sells / total,
      neutralRate: holds / total,
      avgConfidence: avgConf,
      overconfidenceRatio: highConf / total,
    };
  });

  // --- Herding score ---
  const agreementPairs = countByCondition(similarities, (s) => s.actionAgreement);
  const herdingScore =
    similarities.length === 0 ? 0 : agreementPairs / similarities.length;

  const result: RoundComparisonResult = {
    roundId,
    timestamp,
    similarities,
    divergencePoints,
    biasIndicators,
    herdingScore,
    participantCount: roundDecisions.length,
  };

  roundComparisons.push(result);
  return result;
}

/** Computes a reasoning fingerprint for an agent based on stored entries. */
export function computeModelFingerprint(agentId: string): ModelFingerprint | null {
  const entries = entriesByAgent.get(agentId);
  if (!entries || entries.length === 0) return null;

  // --- Vocabulary DNA ---
  const allTokens: string[] = [];
  const bigramCounts: Map<string, number> = new Map();
  const wordSet = new Set<string>();

  for (const entry of entries) {
    const tokens = tokenize(entry.reasoning);
    allTokens.push(...tokens);
    tokens.forEach((t) => wordSet.add(t));
    const bgs = bigrams(tokens);
    for (const bg of bgs) {
      bigramCounts.set(bg, (bigramCounts.get(bg) ?? 0) + 1);
    }
  }

  const sortedBigrams = [...bigramCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, VOCABULARY_TOP_BIGRAMS_LIMIT);

  // Words unique to this agent vs. all other agents
  const otherWords = new Set<string>();
  for (const [otherId, otherEntries] of entriesByAgent) {
    if (otherId === agentId) continue;
    for (const e of otherEntries) {
      tokenize(e.reasoning).forEach((t) => otherWords.add(t));
    }
  }
  const uniqueWords = [...wordSet].filter((w) => !otherWords.has(w)).slice(0, VOCABULARY_UNIQUE_WORDS_LIMIT);

  const avgWordCount =
    entries.reduce((s, e) => s + tokenize(e.reasoning).length, 0) / entries.length;

  const vocabularyDNA: VocabularyDNA = {
    topBigrams: sortedBigrams,
    uniqueWords,
    avgWordCount,
    vocabularySize: wordSet.size,
  };

  // --- Sentiment tendency ---
  const total = entries.length;
  const buys = countByCondition(entries, (e) => e.action === "buy");
  const sells = countByCondition(entries, (e) => e.action === "sell");
  const holds = countByCondition(entries, (e) => e.action === "hold");

  // --- Confidence pattern ---
  const confs = entries.map((e) => e.confidence);
  const highConf = countByCondition(entries, (e) => e.confidence > CONFIDENCE_HIGH_THRESHOLD);

  // --- Reasoning style ---
  const lengths = entries.map((e) => tokenize(e.reasoning).length);
  const bigramCountsPerEntry = entries.map(
    (e) => bigrams(tokenize(e.reasoning)).size,
  );

  // Uniqueness: ratio of unique words to total vocabulary across all agents
  const totalVocabAll = new Set<string>();
  for (const [, list] of entriesByAgent) {
    for (const e of list) {
      tokenize(e.reasoning).forEach((t) => totalVocabAll.add(t));
    }
  }
  const uniquenessScore =
    totalVocabAll.size === 0 ? 0 : uniqueWords.length / totalVocabAll.size;

  return {
    agentId,
    vocabularyDNA,
    sentimentTendency: {
      bullishRate: buys / total,
      bearishRate: sells / total,
      neutralRate: holds / total,
    },
    confidencePattern: {
      mean: mean(confs),
      stdDev: stdDev(confs),
      overconfidenceRatio: highConf / total,
    },
    reasoningStyle: {
      avgLength: mean(lengths),
      avgBigramCount: mean(bigramCountsPerEntry),
      uniquenessScore,
    },
    sampleSize: total,
  };
}

/** Returns where models systematically disagree across all recorded rounds. */
export function getModelDivergenceReport(): ModelDivergenceReport {
  const agentIds = [...entriesByAgent.keys()];

  // --- Systematic disagreements per pair ---
  const pairStats: Map<
    string,
    { total: number; disagree: number; confSum: number; symbolMap: Map<string, number> }
  > = new Map();

  for (const comp of roundComparisons) {
    for (const sim of comp.similarities) {
      const key = [sim.agentA, sim.agentB].sort().join("|");
      if (!pairStats.has(key)) {
        pairStats.set(key, { total: 0, disagree: 0, confSum: 0, symbolMap: new Map() });
      }
      const ps = pairStats.get(key)!;
      ps.total++;
      if (!sim.actionAgreement) {
        ps.disagree++;
        ps.confSum += sim.confidenceDelta;
        const sym = comp.divergencePoints[0]?.symbol ?? "unknown";
        ps.symbolMap.set(sym, (ps.symbolMap.get(sym) ?? 0) + 1);
      }
    }
  }

  const systematicDisagreements: SystematicDisagreement[] = [...pairStats.entries()].map(
    ([key, ps]) => {
      const [a, b] = key.split("|");
      const topSymbols = [...ps.symbolMap.entries()]
        .sort((x, y) => y[1] - x[1])
        .slice(0, SYSTEMATIC_DISAGREEMENT_TOP_SYMBOLS)
        .map(([s]) => s);
      return {
        agentPair: [a, b] as [string, string],
        disagreementRate: ps.total === 0 ? 0 : ps.disagree / ps.total,
        avgConfidenceWhenDisagreeing:
          ps.disagree === 0 ? 0 : ps.confSum / ps.disagree,
        mostDisagreedSymbols: topSymbols,
      };
    },
  );

  // --- Bias asymmetries ---
  const bullishRates: number[] = [];
  const bearishRates: number[] = [];
  const agentBias: { agentId: string; bullish: number; bearish: number }[] = [];

  for (const id of agentIds) {
    const entries = entriesByAgent.get(id) ?? [];
    const total = entries.length || 1;
    const b = countByCondition(entries, (e) => e.action === "buy") / total;
    const s = countByCondition(entries, (e) => e.action === "sell") / total;
    bullishRates.push(b);
    bearishRates.push(s);
    agentBias.push({ agentId: id, bullish: b, bearish: s });
  }

  const avgBull = mean(bullishRates);
  const avgBear = mean(bearishRates);

  const biasAsymmetries: BiasAsymmetry[] = agentBias.map((ab) => {
    const bullDiff = ab.bullish - avgBull;
    const bearDiff = ab.bearish - avgBear;
    const isBullish = bullDiff > bearDiff;
    return {
      agentId: ab.agentId,
      direction: isBullish ? "bullish" : "bearish",
      magnitude: Math.abs(isBullish ? bullDiff : bearDiff),
      comparedToAvg: isBullish ? bullDiff : bearDiff,
    };
  });

  // --- Herding trend ---
  const herdingTrend = roundComparisons.slice(-HERDING_TREND_WINDOW).map((c) => c.herdingScore);

  return {
    systematicDisagreements,
    biasAsymmetries,
    herdingTrend,
    totalRoundsAnalyzed: roundComparisons.length,
  };
}

/** Returns aggregate cross-model comparison statistics. */
export function getCrossModelStats(): {
  totalEntriesRecorded: number;
  agentCount: number;
  roundsCompared: number;
  avgHerdingScore: number;
  avgJaccardSimilarity: number;
  avgConfidenceDelta: number;
  actionAgreementRate: number;
} {
  let totalEntries = 0;
  for (const [, list] of entriesByAgent) {
    totalEntries += list.length;
  }

  const allSimilarities = roundComparisons.flatMap((c) => c.similarities);
  const jaccards = allSimilarities.map((s) => s.jaccardBigram);
  const confDeltas = allSimilarities.map((s) => s.confidenceDelta);
  const agreements = countByCondition(allSimilarities, (s) => s.actionAgreement);

  return {
    totalEntriesRecorded: totalEntries,
    agentCount: entriesByAgent.size,
    roundsCompared: roundComparisons.length,
    avgHerdingScore: mean(roundComparisons.map((c) => c.herdingScore)),
    avgJaccardSimilarity: mean(jaccards),
    avgConfidenceDelta: mean(confDeltas),
    actionAgreementRate:
      allSimilarities.length === 0 ? 0 : agreements / allSimilarities.length,
  };
}
