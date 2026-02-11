/**
 * Agent Reasoning Forensics
 *
 * Deep analysis of AI agent reasoning patterns to identify failure modes,
 * strategy drift, and behavioral anomalies. This is a key differentiator
 * for MoltApp as an AI trading benchmark — we don't just score agents,
 * we diagnose WHY they succeed or fail.
 *
 * Four forensic dimensions:
 *
 * 1. PATTERN ANALYSIS: Detects template reasoning, vocabulary fingerprints,
 *    and reasoning length trends. Agents that repeat the same boilerplate
 *    are penalized — real intelligence produces varied reasoning.
 *
 * 2. STRATEGY DRIFT: Compares recent intent distribution against historical
 *    baselines. If an agent trained on "value" starts acting "momentum",
 *    that drift is quantified and flagged.
 *
 * 3. FAILURE MODE IDENTIFICATION: Classifies failures into actionable
 *    categories (reasoning gaps, hallucinations, overconfidence, etc.)
 *    so benchmark consumers know exactly where each agent breaks down.
 *
 * 4. FULL FORENSIC REPORT: Synthesizes all three dimensions into an
 *    intelligence quotient score (0-100), strengths/weaknesses, and
 *    concrete recommendations for agent improvement.
 */

import { round3 } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Maximum forensic entries retained in memory.
 * Prevents unbounded growth — 5,000 entries = ~5,000 rounds of trading history.
 */
const MAX_FORENSIC_ENTRIES = 5000;

/**
 * Size of the "recent" window for drift detection.
 * We compare the last RECENT_WINDOW entries against the full history
 * to detect strategy shifts. 50 trades = ~2-3 days of trading at 3 rounds/hour.
 */
const RECENT_WINDOW = 50;

/**
 * Drift magnitude above this threshold is considered significant.
 * 0.20 = 20% shift in strategy distribution (e.g., value→momentum transition).
 */
const DRIFT_SIGNIFICANCE_THRESHOLD = 0.20;

/**
 * Coherence score below this marks a trade as a "failure".
 * 0.45 = reasoning contradicts action or lacks logical structure.
 */
const FAILURE_COHERENCE_THRESHOLD = 0.45;

/**
 * Template detection threshold: if >60% of entries share the same
 * opening phrase structure, flag as template reasoning (boilerplate).
 */
const TEMPLATE_DETECTION_THRESHOLD = 0.60;

/**
 * Minimum entry count required to reliably detect template patterns.
 * 5 trades minimum to avoid false positives on small samples.
 */
const TEMPLATE_MIN_ENTRIES = 5;

/**
 * Opening phrase normalization: use first N words to detect structural similarity.
 * 5 words captures sentence structure without being overly specific.
 */
const TEMPLATE_OPENING_WORDS = 5;

/**
 * Minimum phrase count to include in top recurring phrases analysis.
 * 3 occurrences = phrase appears in 3+ separate trade decisions.
 */
const PHRASE_MIN_COUNT = 3;

/**
 * Maximum number of top recurring phrases to include in pattern report.
 * 10 phrases = sufficient to identify common reasoning patterns.
 */
const PHRASE_DISPLAY_LIMIT = 10;

/**
 * Reasoning length trend threshold: >15% change classifies as increasing/decreasing.
 * <15% = stable trend (normal variation).
 */
const LENGTH_TREND_THRESHOLD = 0.15;

/**
 * Reasoning length threshold for "reasoning gap" failure classification.
 * <100 chars + low coherence = agent didn't explain itself.
 */
const REASONING_GAP_LENGTH_THRESHOLD = 100;

/**
 * Maximum examples to collect per failure mode category.
 * 3 examples = enough to demonstrate pattern without overwhelming report.
 */
const FAILURE_MODE_EXAMPLES_LIMIT = 3;

/**
 * Overconfidence detection: confidence above this with low coherence = overconfident.
 * 0.75 = 75% confidence threshold for overconfidence flagging.
 */
const OVERCONFIDENCE_THRESHOLD = 0.75;

/**
 * Maximum hallucination types to include in failure report.
 * 5 types = sufficient to identify dominant hallucination patterns.
 */
const HALLUCINATION_TYPES_LIMIT = 5;

/**
 * Intelligence score component weight: vocabulary richness and reasoning variety.
 * 25% of total score — rewards rich, varied vocabulary.
 */
const INTELLIGENCE_WEIGHT_PATTERN = 25;

/**
 * Vocabulary score scaling multiplier.
 * vocabularyRichness * 50 maps 0.5 richness → 25 points (max).
 */
const VOCAB_SCORE_MULTIPLIER = 50;

/**
 * Template penalty deducted from pattern score.
 * 10 points penalty for detected template reasoning.
 */
const TEMPLATE_PENALTY = 10;

/**
 * Intelligence score component weight: strategy stability.
 * 25% of total score — penalizes significant drift.
 */
const INTELLIGENCE_WEIGHT_STABILITY = 25;

/**
 * Drift penalty multiplier: significant drift reduces stability score.
 * driftMagnitude * 40 maps 0.5 drift → 20 point penalty.
 */
const DRIFT_PENALTY_MULTIPLIER = 40;

/**
 * Intelligence score component weight: failure rate.
 * 30% of total score — highest weight, failures are critical.
 */
const INTELLIGENCE_WEIGHT_FAILURE = 30;

/**
 * Failure score calculation multiplier.
 * 50% failure rate → 0 points (failureRate * 2 in formula).
 */
const FAILURE_RATE_MULTIPLIER = 2;

/**
 * Intelligence score component weight: confidence calibration.
 * 20% of total score — rewards well-calibrated agents.
 */
const INTELLIGENCE_WEIGHT_CALIBRATION = 20;

/**
 * Calibration error penalty multiplier.
 * calibrationError * 2 maps 0.5 error → 0 calibration points.
 */
const CALIBRATION_ERROR_MULTIPLIER = 2;

/**
 * Vocabulary richness threshold for "rich vocabulary" strength.
 * >0.4 = 40% unique words across all reasoning = rich vocabulary.
 */
const VOCAB_RICHNESS_STRENGTH_THRESHOLD = 0.4;

/**
 * Failure rate threshold for "very low failure rate" strength.
 * <0.10 = <10% failure rate = exceptional quality.
 */
const FAILURE_RATE_STRENGTH_THRESHOLD = 0.10;

/**
 * Calibration error threshold for "well-calibrated" strength.
 * <0.15 = coherence and confidence within 15% = well-calibrated.
 */
const CALIBRATION_STRENGTH_THRESHOLD = 0.15;

/**
 * Vocabulary richness threshold for "low vocabulary" weakness.
 * <0.2 = <20% unique words = shallow reasoning vocabulary.
 */
const VOCAB_RICHNESS_WEAKNESS_THRESHOLD = 0.2;

/**
 * Failure rate threshold for "high failure rate" weakness.
 * >0.30 = >30% failure rate = significant quality issues.
 */
const FAILURE_RATE_WEAKNESS_THRESHOLD = 0.30;

/**
 * Calibration error threshold for "poor calibration" weakness.
 * >0.25 = coherence and confidence diverge >25% = poor calibration.
 */
const CALIBRATION_WEAKNESS_THRESHOLD = 0.25;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Entry recorded by the orchestrator after each trade decision */
export interface ForensicEntry {
  agentId: string;
  reasoning: string;
  action: "buy" | "sell" | "hold";
  intent: string;
  confidence: number;
  coherenceScore: number;
  hallucinationFlags: string[];
  disciplineViolations: string[];
  timestamp: string;
}

/** Vocabulary and structural pattern analysis */
export interface ReasoningPatternReport {
  agentId: string;
  /** Number of reasoning entries analyzed */
  totalAnalyzed: number;
  /** Unique words / total words across all entries (0-1) */
  vocabularyRichness: number;
  /** True if agent reuses the same structural template repeatedly */
  templateDetected: boolean;
  /** Most frequently recurring multi-word phrases */
  topPhrases: { phrase: string; count: number }[];
  /** Mean character length of reasoning texts */
  avgReasoningLength: number;
  /** Whether reasoning is getting longer, shorter, or staying flat */
  reasoningLengthTrend: "increasing" | "stable" | "decreasing";
}

/** Drift in the agent's strategic intent distribution over time */
export interface StrategyDriftReport {
  agentId: string;
  /** Intent distribution from the most recent window */
  currentStrategy: { intent: string; percentage: number }[];
  /** Intent distribution from the full history */
  historicalStrategy: { intent: string; percentage: number }[];
  /** Magnitude of drift between distributions (0-1) */
  driftMagnitude: number;
  /** Human-readable drift direction, e.g. "value -> momentum" */
  driftDirection: string;
  /** True if drift exceeds significance threshold */
  isSignificant: boolean;
}

/** Classification of failure patterns */
export interface FailureModeReport {
  agentId: string;
  /** Count of entries classified as failures */
  totalFailures: number;
  /** Failure breakdown by category with examples */
  failureModes: { mode: string; count: number; examples: string[] }[];
  /** Most common hallucination flag strings */
  commonHallucinationTypes: string[];
  /** Average coherence score among failing entries */
  avgCoherenceOnFailure: number;
  /** Average confidence among failing entries */
  avgConfidenceOnFailure: number;
}

/** Comprehensive forensic synthesis combining all dimensions */
export interface FullForensicReport {
  agentId: string;
  /** ISO timestamp of report generation */
  generatedAt: string;
  patterns: ReasoningPatternReport;
  drift: StrategyDriftReport;
  failures: FailureModeReport;
  /** Composite intelligence quotient (0-100) */
  intelligenceScore: number;
  /** Top strengths identified from the analysis */
  strengths: string[];
  /** Key weaknesses identified from the analysis */
  weaknesses: string[];
  /** Actionable recommendations for agent improvement */
  recommendations: string[];
}

// ---------------------------------------------------------------------------
// State (in-memory cache)
// ---------------------------------------------------------------------------

const forensicEntries: ForensicEntry[] = [];

// ---------------------------------------------------------------------------
// Record
// ---------------------------------------------------------------------------

/**
 * Record a forensic entry after each trade decision.
 * Called by the orchestrator so the forensics engine has data to analyze.
 */
export function recordForensicEntry(entry: ForensicEntry): void {
  forensicEntries.unshift(entry);
  if (forensicEntries.length > MAX_FORENSIC_ENTRIES) {
    forensicEntries.length = MAX_FORENSIC_ENTRIES;
  }
}

/**
 * Return the current entry count for a given agent (useful for dashboards).
 */
export function getForensicEntryCount(agentId: string): number {
  return forensicEntries.filter((e) => e.agentId === agentId).length;
}

// ---------------------------------------------------------------------------
// 1. Reasoning Pattern Analysis
// ---------------------------------------------------------------------------

/**
 * Analyze recurring patterns, vocabulary richness, and structural templates
 * in an agent's reasoning history. Agents that produce varied, substantive
 * reasoning score higher; those that repeat boilerplate are flagged.
 */
export function analyzeReasoningPatterns(agentId: string): ReasoningPatternReport {
  const entries = forensicEntries.filter((e) => e.agentId === agentId);

  if (entries.length === 0) {
    return emptyPatternReport(agentId);
  }

  // --- Vocabulary richness ---
  const allWords: string[] = [];
  const uniqueWords = new Set<string>();
  for (const e of entries) {
    const words = tokenize(e.reasoning);
    for (const w of words) {
      allWords.push(w);
      uniqueWords.add(w);
    }
  }
  const vocabularyRichness = allWords.length > 0
    ? round3(uniqueWords.size / allWords.length)
    : 0;

  // --- Top recurring phrases (bigrams and trigrams) ---
  const phraseCounts = new Map<string, number>();
  for (const e of entries) {
    const words = tokenize(e.reasoning);
    // Bigrams
    for (let i = 0; i < words.length - 1; i++) {
      const bigram = `${words[i]} ${words[i + 1]}`;
      phraseCounts.set(bigram, (phraseCounts.get(bigram) ?? 0) + 1);
    }
    // Trigrams
    for (let i = 0; i < words.length - 2; i++) {
      const trigram = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
      phraseCounts.set(trigram, (phraseCounts.get(trigram) ?? 0) + 1);
    }
  }

  const topPhrases = [...phraseCounts.entries()]
    .filter(([, count]) => count >= PHRASE_MIN_COUNT)
    .sort((a, b) => b[1] - a[1])
    .slice(0, PHRASE_DISPLAY_LIMIT)
    .map(([phrase, count]) => ({ phrase, count }));

  // --- Template detection ---
  // If >60% of entries share a dominant structural pattern (same sentence
  // count AND similar opening phrase), flag as template reasoning.
  const openings = entries.map((e) => {
    const firstSentence = e.reasoning.split(/[.!?]/)[0]?.trim().toLowerCase() ?? "";
    // Normalize to first N words to detect structural similarity
    return firstSentence.split(/\s+/).slice(0, TEMPLATE_OPENING_WORDS).join(" ");
  });
  const openingCounts = new Map<string, number>();
  for (const o of openings) {
    if (o.length > 0) {
      openingCounts.set(o, (openingCounts.get(o) ?? 0) + 1);
    }
  }
  const maxOpeningCount = Math.max(...openingCounts.values(), 0);
  const templateDetected = entries.length >= TEMPLATE_MIN_ENTRIES && maxOpeningCount / entries.length > TEMPLATE_DETECTION_THRESHOLD;

  // --- Reasoning length stats ---
  const lengths = entries.map((e) => e.reasoning.length);
  const avgReasoningLength = Math.round(
    lengths.reduce((sum, l) => sum + l, 0) / lengths.length,
  );

  // Trend: compare average of first half vs second half
  const midpoint = Math.floor(lengths.length / 2);
  const olderAvg = lengths.length > 1
    ? lengths.slice(midpoint).reduce((s, l) => s + l, 0) / (lengths.length - midpoint)
    : avgReasoningLength;
  const recentAvg = lengths.length > 1
    ? lengths.slice(0, midpoint || 1).reduce((s, l) => s + l, 0) / (midpoint || 1)
    : avgReasoningLength;
  const lengthDelta = recentAvg - olderAvg;
  const reasoningLengthTrend: "increasing" | "stable" | "decreasing" =
    lengthDelta > avgReasoningLength * LENGTH_TREND_THRESHOLD ? "increasing" :
    lengthDelta < -avgReasoningLength * LENGTH_TREND_THRESHOLD ? "decreasing" :
    "stable";

  return {
    agentId,
    totalAnalyzed: entries.length,
    vocabularyRichness,
    templateDetected,
    topPhrases,
    avgReasoningLength,
    reasoningLengthTrend,
  };
}

// ---------------------------------------------------------------------------
// 2. Strategy Drift Detection
// ---------------------------------------------------------------------------

/**
 * Detect whether an agent's strategic intent has shifted over time.
 * Compares the most recent window of trades against the full history
 * using a simplified Jensen-Shannon-style divergence metric.
 */
export function detectStrategyDrift(agentId: string): StrategyDriftReport {
  const entries = forensicEntries.filter((e) => e.agentId === agentId);

  if (entries.length < RECENT_WINDOW) {
    return emptyDriftReport(agentId);
  }

  const recentEntries = entries.slice(0, RECENT_WINDOW);
  const historicalEntries = entries.slice(RECENT_WINDOW);

  // Build intent distributions
  const currentStrategy = buildIntentDistribution(recentEntries);
  const historicalStrategy = buildIntentDistribution(historicalEntries);

  // Calculate drift magnitude as mean absolute difference across all intents
  const allIntents = new Set([
    ...currentStrategy.map((s) => s.intent),
    ...historicalStrategy.map((s) => s.intent),
  ]);

  let totalAbsDiff = 0;
  for (const intent of allIntents) {
    const currentPct = currentStrategy.find((s) => s.intent === intent)?.percentage ?? 0;
    const historicalPct = historicalStrategy.find((s) => s.intent === intent)?.percentage ?? 0;
    totalAbsDiff += Math.abs(currentPct - historicalPct);
  }
  // Normalize: max possible diff is 2.0 (100% in one category shifting to another)
  const driftMagnitude = round3(totalAbsDiff / 2);

  // Determine drift direction: which intent grew most vs shrank most
  let maxGrowth = { intent: "none", delta: 0 };
  let maxShrink = { intent: "none", delta: 0 };
  for (const intent of allIntents) {
    const currentPct = currentStrategy.find((s) => s.intent === intent)?.percentage ?? 0;
    const historicalPct = historicalStrategy.find((s) => s.intent === intent)?.percentage ?? 0;
    const delta = currentPct - historicalPct;
    if (delta > maxGrowth.delta) maxGrowth = { intent, delta };
    if (delta < maxShrink.delta) maxShrink = { intent, delta };
  }

  const driftDirection = maxGrowth.delta > 0 && maxShrink.delta < 0
    ? `${maxShrink.intent} -> ${maxGrowth.intent}`
    : "stable";

  const isSignificant = driftMagnitude >= DRIFT_SIGNIFICANCE_THRESHOLD;

  return {
    agentId,
    currentStrategy,
    historicalStrategy,
    driftMagnitude,
    driftDirection,
    isSignificant,
  };
}

// ---------------------------------------------------------------------------
// 3. Failure Mode Identification
// ---------------------------------------------------------------------------

/** All recognized failure mode categories */
const FAILURE_MODES = [
  "reasoning_gap",
  "data_hallucination",
  "overconfidence",
  "strategy_mismatch",
  "rule_violation",
] as const;

/**
 * Identify and classify failure patterns in an agent's trading history.
 * A "failure" is any entry with coherence below the threshold, hallucination
 * flags present, or discipline violations recorded.
 */
export function identifyFailureModes(agentId: string): FailureModeReport {
  const entries = forensicEntries.filter((e) => e.agentId === agentId);

  // Identify failing entries
  const failures = entries.filter(
    (e) =>
      e.coherenceScore < FAILURE_COHERENCE_THRESHOLD ||
      e.hallucinationFlags.length > 0 ||
      e.disciplineViolations.length > 0,
  );

  if (failures.length === 0) {
    return emptyFailureReport(agentId);
  }

  // Classify each failure into modes
  const modeBuckets = new Map<string, { count: number; examples: string[] }>();
  for (const mode of FAILURE_MODES) {
    modeBuckets.set(mode, { count: 0, examples: [] });
  }

  for (const f of failures) {
    // Reasoning gap: low coherence + short reasoning (agent didn't explain itself)
    if (f.coherenceScore < FAILURE_COHERENCE_THRESHOLD && f.reasoning.length < 100) {
      const bucket = modeBuckets.get("reasoning_gap")!;
      bucket.count++;
      if (bucket.examples.length < 3) {
        bucket.examples.push(truncate(f.reasoning, 80));
      }
    }

    // Data hallucination: hallucination flags present
    if (f.hallucinationFlags.length > 0) {
      const bucket = modeBuckets.get("data_hallucination")!;
      bucket.count++;
      if (bucket.examples.length < 3) {
        bucket.examples.push(f.hallucinationFlags[0]);
      }
    }

    // Overconfidence: high confidence on a low-coherence trade
    if (f.confidence > 0.75 && f.coherenceScore < FAILURE_COHERENCE_THRESHOLD) {
      const bucket = modeBuckets.get("overconfidence")!;
      bucket.count++;
      if (bucket.examples.length < 3) {
        bucket.examples.push(
          `Confidence ${(f.confidence * 100).toFixed(0)}% but coherence ${(f.coherenceScore * 100).toFixed(0)}%`,
        );
      }
    }

    // Strategy mismatch: declared intent doesn't match action pattern
    if (isIntentActionMismatch(f.intent, f.action)) {
      const bucket = modeBuckets.get("strategy_mismatch")!;
      bucket.count++;
      if (bucket.examples.length < 3) {
        bucket.examples.push(`Intent "${f.intent}" but action "${f.action}"`);
      }
    }

    // Rule violation: discipline violations present
    if (f.disciplineViolations.length > 0) {
      const bucket = modeBuckets.get("rule_violation")!;
      bucket.count++;
      if (bucket.examples.length < 3) {
        bucket.examples.push(f.disciplineViolations[0]);
      }
    }
  }

  // Build failure modes array (only include non-zero)
  const failureModes = [...modeBuckets.entries()]
    .filter(([, v]) => v.count > 0)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([mode, v]) => ({ mode, count: v.count, examples: v.examples }));

  // Common hallucination types across all failures
  const hallucinationTypeCounts = new Map<string, number>();
  for (const f of failures) {
    for (const flag of f.hallucinationFlags) {
      // Extract the category prefix (e.g. "Price hallucination", "Unknown ticker")
      const category = flag.split(":")[0]?.trim() ?? flag;
      hallucinationTypeCounts.set(category, (hallucinationTypeCounts.get(category) ?? 0) + 1);
    }
  }
  const commonHallucinationTypes = [...hallucinationTypeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([type]) => type);

  // Averages on failing trades
  const avgCoherenceOnFailure = Math.round(
    (failures.reduce((s, f) => s + f.coherenceScore, 0) / failures.length) * 100,
  ) / 100;
  const avgConfidenceOnFailure = Math.round(
    (failures.reduce((s, f) => s + f.confidence, 0) / failures.length) * 100,
  ) / 100;

  return {
    agentId,
    totalFailures: failures.length,
    failureModes,
    commonHallucinationTypes,
    avgCoherenceOnFailure,
    avgConfidenceOnFailure,
  };
}

// ---------------------------------------------------------------------------
// 4. Full Forensic Report
// ---------------------------------------------------------------------------

/**
 * Generate a comprehensive forensic report that synthesizes pattern analysis,
 * strategy drift, and failure modes into an overall intelligence assessment.
 *
 * The intelligence score (0-100) weights:
 * - Vocabulary richness and reasoning variety (25%)
 * - Strategy consistency / intentional drift only (25%)
 * - Failure rate and severity (30%)
 * - Confidence calibration (20%)
 */
export function generateForensicReport(agentId: string): FullForensicReport {
  const patterns = analyzeReasoningPatterns(agentId);
  const drift = detectStrategyDrift(agentId);
  const failures = identifyFailureModes(agentId);
  const entries = forensicEntries.filter((e) => e.agentId === agentId);

  // --- Intelligence Score Components ---

  // Component 1: Vocabulary & reasoning quality (25 pts)
  const vocabScore = Math.min(25, patterns.vocabularyRichness * 50);
  const templatePenalty = patterns.templateDetected ? 10 : 0;
  const patternScore = Math.max(0, vocabScore - templatePenalty);

  // Component 2: Strategy stability (25 pts)
  // Some drift is fine (adaptation), extreme drift is concerning
  const driftPenalty = drift.isSignificant ? drift.driftMagnitude * 40 : 0;
  const stabilityScore = Math.max(0, 25 - driftPenalty);

  // Component 3: Failure rate (30 pts)
  const totalEntries = entries.length || 1;
  const failureRate = failures.totalFailures / totalEntries;
  const failureScore = Math.max(0, 30 * (1 - failureRate * 2)); // 50% failure rate = 0 pts

  // Component 4: Confidence calibration (20 pts)
  // Well-calibrated agents have high confidence on coherent trades
  // and low confidence on uncertain ones
  const avgCoherence = entries.length > 0
    ? entries.reduce((s, e) => s + e.coherenceScore, 0) / entries.length
    : 0.5;
  const avgConfidence = entries.length > 0
    ? entries.reduce((s, e) => s + e.confidence, 0) / entries.length
    : 0.5;
  // Calibration error: how far apart are coherence and confidence?
  const calibrationError = Math.abs(avgCoherence - avgConfidence);
  const calibrationScore = Math.max(0, 20 * (1 - calibrationError * 2));

  const intelligenceScore = Math.round(
    Math.min(100, Math.max(0, patternScore + stabilityScore + failureScore + calibrationScore)),
  );

  // --- Strengths ---
  const strengths: string[] = [];
  if (patterns.vocabularyRichness > 0.4) {
    strengths.push("Rich, varied vocabulary in reasoning");
  }
  if (!patterns.templateDetected) {
    strengths.push("Produces unique reasoning for each decision");
  }
  if (failureRate < 0.10) {
    strengths.push("Very low failure rate across trades");
  }
  if (!drift.isSignificant) {
    strengths.push("Consistent strategy execution without drift");
  }
  if (calibrationError < 0.15) {
    strengths.push("Well-calibrated confidence levels");
  }
  if (patterns.reasoningLengthTrend === "increasing") {
    strengths.push("Reasoning depth is increasing over time");
  }
  if (strengths.length === 0) {
    strengths.push("Sufficient data for forensic analysis");
  }

  // --- Weaknesses ---
  const weaknesses: string[] = [];
  if (patterns.templateDetected) {
    weaknesses.push("Template reasoning detected — may be producing boilerplate");
  }
  if (patterns.vocabularyRichness < 0.2) {
    weaknesses.push("Low vocabulary richness suggests shallow reasoning");
  }
  if (drift.isSignificant) {
    weaknesses.push(`Strategy drift detected: ${drift.driftDirection} (magnitude ${drift.driftMagnitude.toFixed(2)})`);
  }
  if (failureRate > 0.30) {
    weaknesses.push(`High failure rate: ${(failureRate * 100).toFixed(0)}% of trades have issues`);
  }
  if (failures.failureModes.length > 0) {
    const topMode = failures.failureModes[0];
    weaknesses.push(`Primary failure mode: ${topMode.mode} (${topMode.count} occurrences)`);
  }
  if (calibrationError > 0.25) {
    weaknesses.push("Poor confidence calibration — confidence does not match coherence");
  }
  if (weaknesses.length === 0) {
    weaknesses.push("No significant weaknesses detected");
  }

  // --- Recommendations ---
  const recommendations: string[] = [];
  if (patterns.templateDetected) {
    recommendations.push("Vary reasoning prompts to avoid template lock-in");
  }
  if (patterns.vocabularyRichness < 0.2) {
    recommendations.push("Increase reasoning depth — require agents to cite specific data points");
  }
  if (drift.isSignificant) {
    recommendations.push("Investigate strategy drift cause — may indicate prompt decay or market regime change");
  }
  if (failures.failureModes.some((m) => m.mode === "overconfidence")) {
    recommendations.push("Add confidence penalty for unsupported claims");
  }
  if (failures.failureModes.some((m) => m.mode === "data_hallucination")) {
    recommendations.push("Strengthen market data grounding — inject real prices into prompts");
  }
  if (failures.failureModes.some((m) => m.mode === "rule_violation")) {
    recommendations.push("Reinforce position limits and trading rules in system prompt");
  }
  if (recommendations.length === 0) {
    recommendations.push("Continue monitoring — agent performance is within acceptable bounds");
  }

  return {
    agentId,
    generatedAt: new Date().toISOString(),
    patterns,
    drift,
    failures,
    intelligenceScore,
    strengths,
    weaknesses,
    recommendations,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Tokenize text into lowercase words, stripping punctuation */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

/** Build a percentage distribution of intents from a set of entries */
function buildIntentDistribution(
  entries: ForensicEntry[],
): { intent: string; percentage: number }[] {
  const counts = new Map<string, number>();
  for (const e of entries) {
    const intent = e.intent || "unknown";
    counts.set(intent, (counts.get(intent) ?? 0) + 1);
  }
  const total = entries.length || 1;
  return [...counts.entries()]
    .map(([intent, count]) => ({
      intent,
      percentage: round3(count / total),
    }))
    .sort((a, b) => b.percentage - a.percentage);
}

/**
 * Check whether a declared intent mismatches the trade action.
 * For example, a "bearish" intent with a "buy" action is a mismatch.
 */
function isIntentActionMismatch(intent: string, action: "buy" | "sell" | "hold"): boolean {
  const lower = intent.toLowerCase();
  if (action === "buy" && /bearish|short|sell|decline/.test(lower)) return true;
  if (action === "sell" && /bullish|long|buy|accumulate/.test(lower)) return true;
  return false;
}

/** Truncate a string to a max length, adding ellipsis if needed */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}

// ---------------------------------------------------------------------------
// Empty Report Factories
// ---------------------------------------------------------------------------

function emptyPatternReport(agentId: string): ReasoningPatternReport {
  return {
    agentId,
    totalAnalyzed: 0,
    vocabularyRichness: 0,
    templateDetected: false,
    topPhrases: [],
    avgReasoningLength: 0,
    reasoningLengthTrend: "stable",
  };
}

function emptyDriftReport(agentId: string): StrategyDriftReport {
  return {
    agentId,
    currentStrategy: [],
    historicalStrategy: [],
    driftMagnitude: 0,
    driftDirection: "insufficient data",
    isSignificant: false,
  };
}

function emptyFailureReport(agentId: string): FailureModeReport {
  return {
    agentId,
    totalFailures: 0,
    failureModes: [],
    commonHallucinationTypes: [],
    avgCoherenceOnFailure: 0,
    avgConfidenceOnFailure: 0,
  };
}
