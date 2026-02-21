/**
 * Agent Reasoning Profile Service
 *
 * Builds a comprehensive statistical profile of each agent's reasoning patterns.
 * This goes beyond simple metrics — it creates a "fingerprint" of HOW each agent
 * thinks, which is the core value of an AI trading benchmark.
 *
 * Profile dimensions:
 * 1. VOCABULARY: What words/phrases does the agent use most?
 * 2. REASONING STRUCTURE: Does the agent use step-by-step logic, bullet points, etc.?
 * 3. DATA CITATION: How thoroughly does the agent reference market data?
 * 4. EMOTIONAL TONE: Is the agent confident, cautious, uncertain?
 * 5. DECISION SPEED: How quickly does the agent converge on a decision?
 * 6. CONSISTENCY: Does the agent reason similarly across similar situations?
 */

import { splitSentences, round3, countByCondition, findMax, computeVariance } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReasoningEntry {
  agentId: string;
  reasoning: string;
  action: "buy" | "sell" | "hold";
  symbol: string;
  confidence: number;
  intent: string;
  coherenceScore: number;
  timestamp: string;
}

export interface VocabularyProfile {
  /** Most frequent significant words (excluding stop words) */
  topWords: Array<{ word: string; count: number; frequency: number }>;
  /** Average reasoning length (chars) */
  avgLength: number;
  /** Median reasoning length */
  medianLength: number;
  /** Vocabulary richness: unique words / total words */
  lexicalDiversity: number;
  /** Average sentence count per reasoning */
  avgSentences: number;
}

export interface ToneProfile {
  /** Fraction of reasoning expressing certainty (0-1) */
  certaintyLevel: number;
  /** Fraction expressing hedging/uncertainty (0-1) */
  hedgingLevel: number;
  /** Fraction with quantitative claims (numbers, percentages) */
  quantitativeLevel: number;
  /** Fraction referencing risk/caution */
  riskAwareness: number;
  /** Common tone phrases */
  signaturePhrases: string[];
}

export interface ConsistencyProfile {
  /** Do similar market conditions produce similar decisions? (0-1) */
  decisionConsistency: number;
  /** Does the agent use similar reasoning structure each time? (0-1) */
  structuralConsistency: number;
  /** How stable is confidence across decisions? (lower = more consistent) */
  confidenceVariance: number;
  /** Does the agent stick to its declared intent? (0-1) */
  intentStability: number;
}

export interface AgentReasoningProfile {
  agentId: string;
  /** Total reasoning entries analyzed */
  totalEntries: number;
  /** Vocabulary and language analysis */
  vocabulary: VocabularyProfile;
  /** Emotional tone and confidence expression */
  tone: ToneProfile;
  /** Decision consistency patterns */
  consistency: ConsistencyProfile;
  /** Action distribution */
  actionDistribution: { buy: number; sell: number; hold: number };
  /** Intent distribution */
  intentDistribution: Record<string, number>;
  /** Average coherence */
  avgCoherence: number;
  /** Average confidence */
  avgConfidence: number;
  /** Most analyzed symbols */
  topSymbols: Array<{ symbol: string; count: number }>;
  /** Reasoning quality trend (recent vs older) */
  qualityTrend: "improving" | "declining" | "stable";
  /** Generated timestamp */
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const reasoningEntries: ReasoningEntry[] = [];
const MAX_ENTRIES = 3000;

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Quality Trend Detection Parameters
 *
 * These control how we classify agent reasoning quality trends over time.
 */

/**
 * Trend lookback window divisor.
 *
 * We compare the first 1/5 of entries (recent) vs last 1/5 (older).
 * Example: 100 entries → compare first 20 vs last 20.
 *
 * Lower divisor = larger comparison windows (more stable, less sensitive).
 * Higher divisor = smaller windows (more sensitive to recent changes).
 */
const TREND_LOOKBACK_DIVISOR = 5;

/**
 * Minimum entries required for meaningful trend detection.
 *
 * Below this threshold, we classify as "stable" because sample size is too small
 * for statistical significance.
 */
const TREND_MIN_ENTRIES = 10;

/**
 * Coherence improvement threshold for "improving" trend.
 *
 * If recent coherence > older coherence + 0.05, classify as "improving".
 * Represents 5% coherence increase = meaningful quality improvement.
 */
const TREND_IMPROVING_THRESHOLD = 0.05;

/**
 * Coherence decline threshold for "declining" trend.
 *
 * If recent coherence < older coherence - 0.05, classify as "declining".
 * Represents 5% coherence decrease = meaningful quality degradation.
 */
const TREND_DECLINING_THRESHOLD = 0.05;

/**
 * Consistency Fallback Defaults
 *
 * These are used when we have < 5 reasoning entries (insufficient data for analysis).
 */

/**
 * Default decision consistency score (neutral).
 *
 * Used when < 5 entries prevent calculating actual consistency.
 * 0.5 = neutral (agent is neither consistent nor inconsistent).
 */
const CONSISTENCY_FALLBACK_DECISION = 0.5;

/**
 * Default structural consistency score (neutral).
 *
 * Used when < 5 entries prevent variance analysis of reasoning lengths.
 * 0.5 = neutral assumption.
 */
const CONSISTENCY_FALLBACK_STRUCTURAL = 0.5;

/**
 * Default confidence variance (zero).
 *
 * Used when < 5 entries prevent calculating actual variance.
 * 0 = assume stable confidence until proven otherwise.
 */
const CONSISTENCY_FALLBACK_VARIANCE = 0;

/**
 * Default intent stability score (neutral).
 *
 * Used when < 5 entries prevent calculating dominant intent.
 * 0.5 = neutral assumption.
 */
const CONSISTENCY_FALLBACK_INTENT = 0.5;

/**
 * Display Limit Constants
 *
 * These control how many top items are returned in profile analysis results.
 */

/**
 * Maximum number of top symbols to display in agent profile.
 *
 * Shows the most frequently analyzed symbols across all reasoning entries.
 * Example: Agent analyzes 50 symbols → show top 10 most analyzed.
 *
 * Lower value = more focused symbol profile (e.g., 5 for core holdings only).
 * Higher value = broader coverage (e.g., 15 for full watchlist).
 */
const TOP_SYMBOLS_DISPLAY_LIMIT = 10;

/**
 * Maximum number of top vocabulary words to display.
 *
 * Shows the most frequently used words (excluding stop words) in agent reasoning.
 * Example: Agent uses 500 unique words → show top 20 most frequent.
 *
 * Lower value = highlight core vocabulary only (e.g., 10 words).
 * Higher value = more comprehensive vocabulary analysis (e.g., 30 words).
 */
const TOP_WORDS_DISPLAY_LIMIT = 20;

/**
 * Maximum number of signature phrases to display in tone profile.
 *
 * Shows the most frequently used trading/strategy phrases from a predefined list.
 * Example: Agent uses 8 signature phrases → show top 5 most common.
 *
 * Lower value = highlight dominant phrases only (e.g., 3 phrases).
 * Higher value = broader phrase analysis (e.g., 7 phrases).
 */
const SIGNATURE_PHRASES_DISPLAY_LIMIT = 5;

// Stop words for vocabulary analysis
const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "shall",
  "should", "may", "might", "must", "can", "could", "to", "of", "in",
  "for", "on", "with", "at", "by", "from", "as", "into", "through",
  "during", "before", "after", "above", "below", "between", "out", "off",
  "over", "under", "again", "further", "then", "once", "here", "there",
  "when", "where", "why", "how", "all", "each", "every", "both", "few",
  "more", "most", "other", "some", "such", "no", "not", "only", "own",
  "same", "so", "than", "too", "very", "just", "because", "if", "or",
  "and", "but", "nor", "yet", "this", "that", "these", "those", "i",
  "we", "you", "he", "she", "it", "they", "me", "him", "her", "us",
  "them", "my", "our", "your", "his", "its", "their", "what", "which",
  "who", "whom", "whose", "while", "also", "about", "up", "down",
]);

// ---------------------------------------------------------------------------
// Record
// ---------------------------------------------------------------------------

/**
 * Record a reasoning entry for profile building.
 */
export function recordReasoningEntry(entry: ReasoningEntry): void {
  reasoningEntries.unshift(entry);
  if (reasoningEntries.length > MAX_ENTRIES) {
    reasoningEntries.length = MAX_ENTRIES;
  }
}

// ---------------------------------------------------------------------------
// Profile Building
// ---------------------------------------------------------------------------

/**
 * Build a comprehensive reasoning profile for an agent.
 */
export function buildReasoningProfile(agentId: string): AgentReasoningProfile {
  const entries = reasoningEntries.filter((e) => e.agentId === agentId);

  if (entries.length === 0) {
    return emptyProfile(agentId);
  }

  const vocabulary = analyzeVocabulary(entries);
  const tone = analyzeTone(entries);
  const consistency = analyzeConsistency(entries);

  // Action distribution
  const buyCount = countByCondition(entries, (e) => e.action === "buy");
  const sellCount = countByCondition(entries, (e) => e.action === "sell");
  const holdCount = countByCondition(entries, (e) => e.action === "hold");

  // Intent distribution
  const intentDist: Record<string, number> = {};
  for (const e of entries) {
    intentDist[e.intent] = (intentDist[e.intent] ?? 0) + 1;
  }
  for (const key of Object.keys(intentDist)) {
    intentDist[key] = Math.round((intentDist[key] / entries.length) * 100) / 100;
  }

  // Top symbols
  const symbolCounts = new Map<string, number>();
  for (const e of entries) {
    symbolCounts.set(e.symbol, (symbolCounts.get(e.symbol) ?? 0) + 1);
  }
  const topSymbols = [...symbolCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_SYMBOLS_DISPLAY_LIMIT)
    .map(([symbol, count]) => ({ symbol, count }));

  // Averages
  const avgCoherence = Math.round(
    (entries.reduce((s, e) => s + e.coherenceScore, 0) / entries.length) * 100,
  ) / 100;
  const avgConfidence = Math.round(
    (entries.reduce((s, e) => s + e.confidence, 0) / entries.length) * 100,
  ) / 100;

  // Quality trend: compare last 20% vs first 20%
  const fifthSize = Math.max(3, Math.floor(entries.length / TREND_LOOKBACK_DIVISOR));
  const recentEntries = entries.slice(0, fifthSize);
  const olderEntries = entries.slice(-fifthSize);

  const recentCoherence = recentEntries.reduce((s, e) => s + e.coherenceScore, 0) / recentEntries.length;
  const olderCoherence = olderEntries.reduce((s, e) => s + e.coherenceScore, 0) / olderEntries.length;

  let qualityTrend: "improving" | "declining" | "stable" = "stable";
  if (entries.length >= TREND_MIN_ENTRIES) {
    if (recentCoherence > olderCoherence + TREND_IMPROVING_THRESHOLD) qualityTrend = "improving";
    else if (recentCoherence < olderCoherence - TREND_DECLINING_THRESHOLD) qualityTrend = "declining";
  }

  return {
    agentId,
    totalEntries: entries.length,
    vocabulary,
    tone,
    consistency,
    actionDistribution: {
      buy: Math.round((buyCount / entries.length) * 100) / 100,
      sell: Math.round((sellCount / entries.length) * 100) / 100,
      hold: Math.round((holdCount / entries.length) * 100) / 100,
    },
    intentDistribution: intentDist,
    avgCoherence,
    avgConfidence,
    topSymbols,
    qualityTrend,
    generatedAt: new Date().toISOString(),
  };
}

function analyzeVocabulary(entries: ReasoningEntry[]): VocabularyProfile {
  const wordCounts = new Map<string, number>();
  const lengths: number[] = [];
  let totalWords = 0;
  let totalSentences = 0;
  const uniqueWords = new Set<string>();

  for (const entry of entries) {
    lengths.push(entry.reasoning.length);

    // Count sentences
    const sentences = splitSentences(entry.reasoning, 0);
    totalSentences += sentences.length;

    // Count words
    const words = entry.reasoning.toLowerCase().match(/\b[a-z]{3,}\b/g) ?? [];
    totalWords += words.length;

    for (const word of words) {
      uniqueWords.add(word);
      if (!STOP_WORDS.has(word)) {
        wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1);
      }
    }
  }

  const sortedWords = [...wordCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_WORDS_DISPLAY_LIMIT)
    .map(([word, count]) => ({
      word,
      count,
      frequency: Math.round((count / totalWords) * 10000) / 10000,
    }));

  lengths.sort((a, b) => a - b);
  const medianLength = lengths.length > 0
    ? lengths[Math.floor(lengths.length / 2)]
    : 0;

  return {
    topWords: sortedWords,
    avgLength: Math.round(
      lengths.reduce((a, b) => a + b, 0) / Math.max(1, lengths.length),
    ),
    medianLength,
    lexicalDiversity: totalWords > 0
      ? round3(uniqueWords.size / totalWords)
      : 0,
    avgSentences: entries.length > 0
      ? Math.round((totalSentences / entries.length) * 10) / 10
      : 0,
  };
}

function analyzeTone(entries: ReasoningEntry[]): ToneProfile {
  let certaintyCount = 0;
  let hedgingCount = 0;
  let quantitativeCount = 0;
  let riskCount = 0;
  const phraseCounts = new Map<string, number>();

  const certaintyPatterns = [
    /\bconfident\b/i, /\bclearly\b/i, /\bdefinitely\b/i, /\bstrongly\b/i,
    /\bconvicted\b/i, /\bno doubt\b/i, /\bcertain\b/i, /\bmust\b/i,
  ];
  const hedgingPatterns = [
    /\bmight\b/i, /\bperhaps\b/i, /\buncertain\b/i, /\bcould\b/i,
    /\bpossibly\b/i, /\bsomewhat\b/i, /\bcautious\b/i, /\bunclear\b/i,
  ];
  const quantPatterns = [/\$\d+/, /\d+\.?\d*%/, /\bprice\b/i, /\bvolume\b/i];
  const riskPatterns = [
    /\brisk\b/i, /\bdownside\b/i, /\bstop.?loss\b/i, /\bhedge\b/i,
    /\bprotect\b/i, /\bcaution\b/i, /\bvolatil/i,
  ];

  const signaturePatterns = [
    "margin of safety", "buying opportunity", "overvalued",
    "undervalued", "breakout", "momentum", "mean reversion",
    "take profits", "cut losses", "bullish", "bearish",
    "support level", "resistance", "risk-reward", "conviction play",
  ];

  for (const entry of entries) {
    const r = entry.reasoning;
    if (certaintyPatterns.some((p) => p.test(r))) certaintyCount++;
    if (hedgingPatterns.some((p) => p.test(r))) hedgingCount++;
    if (quantPatterns.some((p) => p.test(r))) quantitativeCount++;
    if (riskPatterns.some((p) => p.test(r))) riskCount++;

    for (const phrase of signaturePatterns) {
      if (r.toLowerCase().includes(phrase)) {
        phraseCounts.set(phrase, (phraseCounts.get(phrase) ?? 0) + 1);
      }
    }
  }

  const n = Math.max(1, entries.length);
  const signaturePhrases = [...phraseCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, SIGNATURE_PHRASES_DISPLAY_LIMIT)
    .map(([phrase]) => phrase);

  return {
    certaintyLevel: Math.round((certaintyCount / n) * 100) / 100,
    hedgingLevel: Math.round((hedgingCount / n) * 100) / 100,
    quantitativeLevel: Math.round((quantitativeCount / n) * 100) / 100,
    riskAwareness: Math.round((riskCount / n) * 100) / 100,
    signaturePhrases,
  };
}

function analyzeConsistency(entries: ReasoningEntry[]): ConsistencyProfile {
  if (entries.length < 5) {
    return {
      decisionConsistency: CONSISTENCY_FALLBACK_DECISION,
      structuralConsistency: CONSISTENCY_FALLBACK_STRUCTURAL,
      confidenceVariance: CONSISTENCY_FALLBACK_VARIANCE,
      intentStability: CONSISTENCY_FALLBACK_INTENT,
    };
  }

  // Decision consistency: for the same symbol, does agent make similar decisions?
  const symbolDecisions = new Map<string, string[]>();
  for (const e of entries) {
    const existing = symbolDecisions.get(e.symbol) ?? [];
    existing.push(e.action);
    symbolDecisions.set(e.symbol, existing);
  }

  let consistentPairs = 0;
  let totalPairs = 0;
  for (const [, decisions] of symbolDecisions) {
    if (decisions.length < 2) continue;
    for (let i = 0; i < decisions.length - 1; i++) {
      totalPairs++;
      if (decisions[i] === decisions[i + 1]) consistentPairs++;
    }
  }
  const decisionConsistency = totalPairs > 0
    ? Math.round((consistentPairs / totalPairs) * 100) / 100
    : 0.5;

  // Structural consistency: how similar are reasoning lengths?
  const lengths = entries.map((e) => e.reasoning.length);
  const meanLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const lengthVariance = computeVariance(lengths, true); // population variance
  const coeffOfVariation = meanLength > 0 ? Math.sqrt(lengthVariance) / meanLength : 0;
  const structuralConsistency = Math.round(Math.max(0, 1 - coeffOfVariation) * 100) / 100;

  // Confidence variance
  const confidences = entries.map((e) => e.confidence > 1 ? e.confidence / 100 : e.confidence);
  const confVariance = computeVariance(confidences, true); // population variance

  // Intent stability: fraction of times the most common intent is used
  const intentCounts = new Map<string, number>();
  for (const e of entries) {
    intentCounts.set(e.intent, (intentCounts.get(e.intent) ?? 0) + 1);
  }
  const intentCountValues = Array.from(intentCounts.values()).map(count => ({ count }));
  const maxIntentCount = findMax(intentCountValues, 'count')?.count ?? 0;
  const intentStability = Math.round((maxIntentCount / entries.length) * 100) / 100;

  return {
    decisionConsistency,
    structuralConsistency,
    confidenceVariance: Math.round(confVariance * 10000) / 10000,
    intentStability,
  };
}

function emptyProfile(agentId: string): AgentReasoningProfile {
  return {
    agentId,
    totalEntries: 0,
    vocabulary: {
      topWords: [],
      avgLength: 0,
      medianLength: 0,
      lexicalDiversity: 0,
      avgSentences: 0,
    },
    tone: {
      certaintyLevel: 0,
      hedgingLevel: 0,
      quantitativeLevel: 0,
      riskAwareness: 0,
      signaturePhrases: [],
    },
    consistency: {
      decisionConsistency: CONSISTENCY_FALLBACK_DECISION,
      structuralConsistency: CONSISTENCY_FALLBACK_STRUCTURAL,
      confidenceVariance: CONSISTENCY_FALLBACK_VARIANCE,
      intentStability: CONSISTENCY_FALLBACK_INTENT,
    },
    actionDistribution: { buy: 0, sell: 0, hold: 0 },
    intentDistribution: {},
    avgCoherence: 0,
    avgConfidence: 0,
    topSymbols: [],
    qualityTrend: "stable",
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Query API
// ---------------------------------------------------------------------------

/**
 * Get profiles for all agents.
 */
export function getAllReasoningProfiles(): AgentReasoningProfile[] {
  const agentIds = [...new Set(reasoningEntries.map((e) => e.agentId))];
  return agentIds.map((id) => buildReasoningProfile(id));
}

/**
 * Compare two agent profiles side by side.
 */
export function compareProfiles(
  agentA: string,
  agentB: string,
): {
  profileA: AgentReasoningProfile;
  profileB: AgentReasoningProfile;
  comparison: {
    deeperReasoningAgent: string;
    moreConsistentAgent: string;
    higherCoherenceAgent: string;
    moreDiverseStrategyAgent: string;
    moreRiskAwareAgent: string;
    summary: string;
  };
} {
  const profileA = buildReasoningProfile(agentA);
  const profileB = buildReasoningProfile(agentB);

  const deeperReasoningAgent = profileA.vocabulary.avgLength >= profileB.vocabulary.avgLength
    ? agentA : agentB;
  const moreConsistentAgent = profileA.consistency.decisionConsistency >= profileB.consistency.decisionConsistency
    ? agentA : agentB;
  const higherCoherenceAgent = profileA.avgCoherence >= profileB.avgCoherence
    ? agentA : agentB;

  const diversityA = Object.keys(profileA.intentDistribution).length;
  const diversityB = Object.keys(profileB.intentDistribution).length;
  const moreDiverseStrategyAgent = diversityA >= diversityB ? agentA : agentB;

  const moreRiskAwareAgent = profileA.tone.riskAwareness >= profileB.tone.riskAwareness
    ? agentA : agentB;

  const summaryParts: string[] = [];
  summaryParts.push(
    `${deeperReasoningAgent} writes longer reasoning (${deeperReasoningAgent === agentA ? profileA.vocabulary.avgLength : profileB.vocabulary.avgLength} vs ${deeperReasoningAgent === agentA ? profileB.vocabulary.avgLength : profileA.vocabulary.avgLength} chars avg)`,
  );
  summaryParts.push(
    `${higherCoherenceAgent} has higher reasoning coherence (${higherCoherenceAgent === agentA ? profileA.avgCoherence : profileB.avgCoherence})`,
  );
  summaryParts.push(
    `${moreRiskAwareAgent} mentions risk more often`,
  );

  return {
    profileA,
    profileB,
    comparison: {
      deeperReasoningAgent,
      moreConsistentAgent,
      higherCoherenceAgent,
      moreDiverseStrategyAgent,
      moreRiskAwareAgent,
      summary: summaryParts.join(". ") + ".",
    },
  };
}
