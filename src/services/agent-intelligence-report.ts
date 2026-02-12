/**
 * Agent Intelligence Report Generator
 *
 * Generates comprehensive intelligence reports for each AI agent.
 * These reports are the "scouting reports" of AI trading —
 * they tell researchers everything about an agent's capabilities,
 * weaknesses, and behavioral patterns.
 *
 * Report sections:
 * 1. EXECUTIVE SUMMARY — One-paragraph assessment
 * 2. STRENGTHS — What the agent does well
 * 3. WEAKNESSES — Where the agent fails
 * 4. BEHAVIORAL PATTERNS — Detected tendencies
 * 5. RISK PROFILE — How the agent handles risk
 * 6. REASONING QUALITY — Coherence, hallucination, discipline metrics
 * 7. MARKET BIAS — Sector/stock preferences
 * 8. CONFIDENCE PROFILE — Calibration and over/under-confidence analysis
 * 9. RECOMMENDATIONS — What would improve this agent?
 */

import { averageByKey, countByCondition, countWords, round2, round3, stdDev } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Strength identification thresholds for detecting agent capabilities.
 * These control when an agent's metric qualifies as a notable strength
 * in the intelligence report.
 */

/** Coherence threshold for "strong reasoning" strength (>= 0.7 = coherent reasoning matches actions) */
const STRENGTH_COHERENCE_THRESHOLD = 0.7;

/** Hallucination rate threshold for "low hallucination" strength (<= 0.05 = 5% hallucination rate) */
const STRENGTH_HALLUCINATION_RATE_MAX = 0.05;

/** Discipline rate threshold for "excellent rule compliance" strength (>= 0.9 = 90% discipline) */
const STRENGTH_DISCIPLINE_RATE_MIN = 0.9;

/** Word count threshold for "detailed reasoning" strength (>= 50 words = substantive analysis) */
const STRENGTH_WORD_COUNT_MIN = 50;

/**
 * Weakness identification thresholds for detecting agent failure modes.
 * These control when an agent's metric qualifies as a critical weakness
 * in the intelligence report.
 */

/** Coherence threshold for "poor reasoning" weakness (< 0.5 = reasoning contradicts actions) */
const WEAKNESS_COHERENCE_THRESHOLD = 0.5;

/** Hallucination rate threshold for "frequent fabrication" weakness (> 0.15 = 15% hallucination rate) */
const WEAKNESS_HALLUCINATION_RATE_MAX = 0.15;

/** Discipline rate threshold for "poor rule compliance" weakness (< 0.7 = 70% discipline) */
const WEAKNESS_DISCIPLINE_RATE_MIN = 0.7;

/** Word count threshold for "insufficient reasoning depth" weakness (< 25 words = too brief) */
const WEAKNESS_WORD_COUNT_MIN = 25;

/** Hold rate threshold for "excessive conservatism" weakness (> 0.7 = 70% hold rate) */
const WEAKNESS_HOLD_RATE_MAX = 0.7;

/**
 * Behavioral pattern detection thresholds.
 * These control when specific agent behaviors are flagged as patterns.
 */

/** Confidence std dev threshold for "confidence anchoring" pattern (< 0.08 = minimal confidence variation) */
const PATTERN_CONFIDENCE_STDDEV_THRESHOLD = 0.08;

/** Minimum trades required for pattern detection (5 trades minimum for statistical significance) */
const PATTERN_MIN_TRADES = 5;

/** Symbol fixation ratio threshold (> 0.5 = >50% trades in one symbol) */
const PATTERN_SYMBOL_FIXATION_RATIO = 0.5;

/** Momentum follower threshold (> 0.4 = >40% momentum trades) */
const PATTERN_MOMENTUM_THRESHOLD = 0.4;

/** Contrarian tendency threshold (> 0.3 = >30% contrarian trades) */
const PATTERN_CONTRARIAN_THRESHOLD = 0.3;

/**
 * Quality trend detection thresholds.
 * Compare first half vs second half coherence to detect improvement/decline.
 */

/** Coherence improvement threshold (+0.05 = 5% coherence increase = "improving" trend) */
const QUALITY_TREND_IMPROVEMENT_THRESHOLD = 0.05;

/** Coherence decline threshold (-0.05 = 5% coherence decrease = "declining" trend) */
const QUALITY_TREND_DECLINE_THRESHOLD = 0.05;

/**
 * Directional bias classification thresholds.
 * Classify agent trading style based on buy/sell ratio.
 */

/** Buy-heavy threshold (> 0.65 = >65% buys = "buy-heavy" bias) */
const DIRECTIONAL_BIAS_BUY_HEAVY_THRESHOLD = 0.65;

/** Sell-heavy threshold (> 0.65 = >65% sells = "sell-heavy" bias) */
const DIRECTIONAL_BIAS_SELL_HEAVY_THRESHOLD = 0.65;

/**
 * Intelligence grade thresholds.
 * Define score boundaries for A+ through F letter grades.
 */

/** A+ grade threshold (>= 0.9 composite score = exceptional intelligence) */
const GRADE_THRESHOLD_A_PLUS = 0.9;

/** A grade threshold (>= 0.85 composite score = excellent intelligence) */
const GRADE_THRESHOLD_A = 0.85;

/** A- grade threshold (>= 0.8 composite score = very good intelligence) */
const GRADE_THRESHOLD_A_MINUS = 0.8;

/** B+ grade threshold (>= 0.75 composite score = good intelligence) */
const GRADE_THRESHOLD_B_PLUS = 0.75;

/** B grade threshold (>= 0.7 composite score = above average intelligence) */
const GRADE_THRESHOLD_B = 0.7;

/** B- grade threshold (>= 0.65 composite score = slightly above average intelligence) */
const GRADE_THRESHOLD_B_MINUS = 0.65;

/** C+ grade threshold (>= 0.6 composite score = average intelligence) */
const GRADE_THRESHOLD_C_PLUS = 0.6;

/** C grade threshold (>= 0.55 composite score = below average intelligence) */
const GRADE_THRESHOLD_C = 0.55;

/** C- grade threshold (>= 0.5 composite score = poor intelligence) */
const GRADE_THRESHOLD_C_MINUS = 0.5;

/** D grade threshold (>= 0.4 composite score = very poor intelligence, < 0.4 = F) */
const GRADE_THRESHOLD_D = 0.4;

/**
 * Intelligence grade component weights.
 * Control how much each metric contributes to the composite intelligence score.
 */

/** Coherence weight (0.3 = 30% of grade, HIGHEST weight - logical consistency is primary indicator) */
const GRADE_WEIGHT_COHERENCE = 0.3;

/** Hallucination-free weight (0.25 = 25% of grade, critical to avoid fabricated data) */
const GRADE_WEIGHT_HALLUCINATION_FREE = 0.25;

/** Discipline weight (0.2 = 20% of grade, rule compliance is important) */
const GRADE_WEIGHT_DISCIPLINE = 0.2;

/** Calibration weight (0.15 = 15% of grade, confidence accuracy matters) */
const GRADE_WEIGHT_CALIBRATION = 0.15;

/** Word depth weight (0.1 = 10% of grade, length alone doesn't guarantee quality) */
const GRADE_WEIGHT_WORD_DEPTH = 0.1;

/**
 * Word count normalization parameters.
 */

/** Word count divisor for grade contribution (80 words = 100% contribution, 40 words = 50% contribution) */
const WORD_COUNT_NORMALIZATION_DIVISOR = 80;

/**
 * Confidence bucket boundaries.
 * Define confidence tier ranges for confidence profile analysis.
 */

/** Low confidence bucket upper bound (0-25% confidence range) */
const CONFIDENCE_BUCKET_LOW_MAX = 0.25;

/** Medium-low confidence bucket upper bound (25-50% confidence range) */
const CONFIDENCE_BUCKET_MEDIUM_LOW_MAX = 0.5;

/** Medium-high confidence bucket upper bound (50-75% confidence range) */
const CONFIDENCE_BUCKET_MEDIUM_HIGH_MAX = 0.75;

/** High confidence bucket upper bound (75-100% confidence range, 1.01 to include 1.0) */
const CONFIDENCE_BUCKET_HIGH_MAX = 1.01;

/**
 * Data completeness calculation parameters.
 */

/** Trade count divisor for data completeness (20 trades = 100% completeness, 10 trades = 50% completeness) */
const DATA_COMPLETENESS_DIVISOR = 20;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IntelligenceReport {
  agentId: string;
  agentName: string;
  generatedAt: string;

  executiveSummary: string;

  strengths: ReportInsight[];
  weaknesses: ReportInsight[];

  behavioralPatterns: BehavioralPattern[];

  riskProfile: RiskProfile;

  reasoningQuality: ReasoningQualitySection;

  marketBias: MarketBiasSection;

  confidenceProfile: ConfidenceProfileSection;

  recommendations: string[];

  /** Overall intelligence grade (A+ through F) */
  grade: string;

  /** Data completeness: what % of possible metrics are available */
  dataCompleteness: number;
}

export interface ReportInsight {
  category: string;
  observation: string;
  evidence: string;
  severity: "high" | "medium" | "low";
}

export interface BehavioralPattern {
  name: string;
  description: string;
  frequency: number; // 0-1 how often this pattern appears
  impact: "positive" | "negative" | "neutral";
}

export interface RiskProfile {
  riskTolerance: string;
  avgPositionSize: number;
  holdRate: number;
  actionDistribution: Record<string, number>;
  maxConfidence: number;
  minConfidence: number;
  prefersBullish: boolean;
}

export interface ReasoningQualitySection {
  avgCoherence: number;
  avgWordCount: number;
  hallucinationRate: number;
  disciplineRate: number;
  qualityTrend: "improving" | "stable" | "declining";
  bestCoherenceScore: number;
  worstCoherenceScore: number;
}

export interface MarketBiasSection {
  /** Most traded symbols */
  favoriteSymbols: Array<{ symbol: string; count: number; avgConfidence: number }>;
  /** Most used intents */
  intentDistribution: Record<string, number>;
  /** Dominant trading style */
  dominantStyle: string;
  /** Does the agent show bias toward buy/sell? */
  directionalBias: "buy-heavy" | "sell-heavy" | "balanced";
}

export interface ConfidenceProfileSection {
  avgConfidence: number;
  calibrationScore: number;
  overconfidentRate: number; // % of high-conf trades that lost
  underconfidentRate: number; // % of low-conf trades that won
  confidenceBuckets: Array<{ range: string; count: number; avgCoherence: number }>;
}

// ---------------------------------------------------------------------------
// State: Reasoning Data Cache
// ---------------------------------------------------------------------------

interface ReasoningEntry {
  agentId: string;
  action: string;
  symbol: string;
  reasoning: string;
  confidence: number;
  intent: string;
  coherenceScore: number;
  hallucinationCount: number;
  disciplinePass: boolean;
  wordCount: number;
  timestamp: string;
}

const reasoningData: ReasoningEntry[] = [];
const MAX_ENTRIES = 5000;

/**
 * Record a reasoning entry for intelligence report generation.
 */
export function recordIntelligenceEntry(entry: Omit<ReasoningEntry, "wordCount">): void {
  reasoningData.push({
    ...entry,
    wordCount: countWords(entry.reasoning),
  });
  if (reasoningData.length > MAX_ENTRIES) {
    reasoningData.splice(0, reasoningData.length - MAX_ENTRIES);
  }
}

// ---------------------------------------------------------------------------
// Report Generation
// ---------------------------------------------------------------------------

/**
 * Generate a full intelligence report for an agent.
 */
export function generateIntelligenceReport(
  agentId: string,
  agentName: string,
): IntelligenceReport {
  const entries = reasoningData.filter((e) => e.agentId === agentId);
  const total = entries.length;

  if (total === 0) {
    return emptyReport(agentId, agentName);
  }

  const strengths = identifyStrengths(entries);
  const weaknesses = identifyWeaknesses(entries);
  const behavioralPatterns = detectPatterns(entries);
  const riskProfile = buildRiskProfile(entries);
  const reasoningQuality = buildReasoningQuality(entries);
  const marketBias = buildMarketBias(entries);
  const confidenceProfile = buildConfidenceProfile(entries);
  const recommendations = generateRecommendations(weaknesses, behavioralPatterns, riskProfile);
  const grade = computeIntelligenceGrade(reasoningQuality, confidenceProfile);
  const executiveSummary = buildExecutiveSummary(
    agentId, agentName, total, grade, strengths, weaknesses, riskProfile,
  );

  return {
    agentId,
    agentName,
    generatedAt: new Date().toISOString(),
    executiveSummary,
    strengths,
    weaknesses,
    behavioralPatterns,
    riskProfile,
    reasoningQuality,
    marketBias,
    confidenceProfile,
    recommendations,
    grade,
    dataCompleteness: Math.min(1, total / DATA_COMPLETENESS_DIVISOR),
  };
}

/**
 * Generate reports for all known agents.
 */
export function generateAllReports(): IntelligenceReport[] {
  const agentIds = [...new Set(reasoningData.map((e) => e.agentId))];
  return agentIds.map((id) => generateIntelligenceReport(id, id));
}

// ---------------------------------------------------------------------------
// Internal: Analysis Functions
// ---------------------------------------------------------------------------

function identifyStrengths(entries: ReasoningEntry[]): ReportInsight[] {
  const insights: ReportInsight[] = [];
  const total = entries.length;
  const avgCoherence = averageByKey(entries, 'coherenceScore');
  const halRate = countByCondition(entries, (e) => e.hallucinationCount > 0) / total;
  const discRate = countByCondition(entries, (e) => e.disciplinePass) / total;
  const avgWords = averageByKey(entries, 'wordCount');

  if (avgCoherence >= STRENGTH_COHERENCE_THRESHOLD) {
    insights.push({
      category: "Reasoning Quality",
      observation: "Consistently produces coherent reasoning that matches trading actions",
      evidence: `Average coherence: ${avgCoherence.toFixed(2)} (${total} trades)`,
      severity: "high",
    });
  }

  if (halRate <= STRENGTH_HALLUCINATION_RATE_MAX) {
    insights.push({
      category: "Factual Accuracy",
      observation: "Very low hallucination rate — rarely fabricates market data",
      evidence: `Hallucination rate: ${(halRate * 100).toFixed(1)}%`,
      severity: "high",
    });
  }

  if (discRate >= STRENGTH_DISCIPLINE_RATE_MIN) {
    insights.push({
      category: "Rule Compliance",
      observation: "Excellent instruction discipline — follows position limits and rules",
      evidence: `Discipline rate: ${(discRate * 100).toFixed(0)}%`,
      severity: "medium",
    });
  }

  if (avgWords >= STRENGTH_WORD_COUNT_MIN) {
    insights.push({
      category: "Reasoning Depth",
      observation: "Provides detailed, substantive reasoning for trade decisions",
      evidence: `Average ${avgWords.toFixed(0)} words per reasoning`,
      severity: "medium",
    });
  }

  return insights;
}

function identifyWeaknesses(entries: ReasoningEntry[]): ReportInsight[] {
  const insights: ReportInsight[] = [];
  const total = entries.length;
  const avgCoherence = entries.reduce((s, e) => s + e.coherenceScore, 0) / total;
  const halRate = countByCondition(entries, (e) => e.hallucinationCount > 0) / total;
  const discRate = countByCondition(entries, (e) => e.disciplinePass) / total;
  const avgWords = entries.reduce((s, e) => s + e.wordCount, 0) / total;
  const holdRate = countByCondition(entries, (e) => e.action === "hold") / total;

  if (avgCoherence < WEAKNESS_COHERENCE_THRESHOLD) {
    insights.push({
      category: "Reasoning Quality",
      observation: "Reasoning frequently contradicts trading actions",
      evidence: `Average coherence: ${avgCoherence.toFixed(2)} — below ${WEAKNESS_COHERENCE_THRESHOLD} threshold`,
      severity: "high",
    });
  }

  if (halRate > WEAKNESS_HALLUCINATION_RATE_MAX) {
    insights.push({
      category: "Factual Accuracy",
      observation: "Frequently fabricates or misquotes market data in reasoning",
      evidence: `Hallucination rate: ${(halRate * 100).toFixed(1)}%`,
      severity: "high",
    });
  }

  if (discRate < WEAKNESS_DISCIPLINE_RATE_MIN) {
    insights.push({
      category: "Rule Compliance",
      observation: "Frequently violates position limits or trading rules",
      evidence: `Discipline rate: ${(discRate * 100).toFixed(0)}%`,
      severity: "medium",
    });
  }

  if (avgWords < WEAKNESS_WORD_COUNT_MIN) {
    insights.push({
      category: "Reasoning Depth",
      observation: "Reasoning is too brief — lacks analytical depth",
      evidence: `Average only ${avgWords.toFixed(0)} words per reasoning`,
      severity: "medium",
    });
  }

  if (holdRate > WEAKNESS_HOLD_RATE_MAX) {
    insights.push({
      category: "Decision Making",
      observation: "Excessively conservative — holds too often instead of trading",
      evidence: `Hold rate: ${(holdRate * 100).toFixed(0)}%`,
      severity: "low",
    });
  }

  return insights;
}

function detectPatterns(entries: ReasoningEntry[]): BehavioralPattern[] {
  const patterns: BehavioralPattern[] = [];
  const total = entries.length;

  // Pattern: Confidence anchoring (always similar confidence)
  const confidences = entries.map((e) => e.confidence);
  const confStdDev = stdDev(confidences);
  if (confStdDev < PATTERN_CONFIDENCE_STDDEV_THRESHOLD && total >= PATTERN_MIN_TRADES) {
    patterns.push({
      name: "Confidence Anchoring",
      description: "Reports nearly the same confidence level regardless of market conditions",
      frequency: Math.min(1, 1 - confStdDev * 10),
      impact: "negative",
    });
  }

  // Pattern: Symbol fixation (trading same stock repeatedly)
  const symbolCounts = new Map<string, number>();
  for (const e of entries.filter((e) => e.action !== "hold")) {
    symbolCounts.set(e.symbol, (symbolCounts.get(e.symbol) ?? 0) + 1);
  }
  const nonHoldCount = countByCondition(entries, (e) => e.action !== "hold");
  const topSymbolCount = Math.max(...symbolCounts.values(), 0);
  if (nonHoldCount > PATTERN_MIN_TRADES && topSymbolCount / nonHoldCount > PATTERN_SYMBOL_FIXATION_RATIO) {
    const topSymbol = [...symbolCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    patterns.push({
      name: "Symbol Fixation",
      description: `Disproportionately trades ${topSymbol ?? "one stock"} (${((topSymbolCount / nonHoldCount) * 100).toFixed(0)}% of trades)`,
      frequency: topSymbolCount / nonHoldCount,
      impact: "negative",
    });
  }

  // Pattern: Momentum following
  const momentumTrades = countByCondition(entries, (e) => e.intent === "momentum");
  if (momentumTrades / total > PATTERN_MOMENTUM_THRESHOLD) {
    patterns.push({
      name: "Momentum Follower",
      description: "Predominantly follows price trends rather than fundamental analysis",
      frequency: momentumTrades / total,
      impact: "neutral",
    });
  }

  // Pattern: Contrarian tendency
  const contrarianTrades = countByCondition(entries, (e) => e.intent === "contrarian");
  if (contrarianTrades / total > PATTERN_CONTRARIAN_THRESHOLD) {
    patterns.push({
      name: "Contrarian Tendency",
      description: "Frequently goes against market consensus",
      frequency: contrarianTrades / total,
      impact: "neutral",
    });
  }

  return patterns;
}

function buildRiskProfile(entries: ReasoningEntry[]): RiskProfile {
  const total = entries.length;
  const buyCount = countByCondition(entries, (e) => e.action === "buy");
  const sellCount = countByCondition(entries, (e) => e.action === "sell");
  const holdCount = countByCondition(entries, (e) => e.action === "hold");
  const confidences = entries.map((e) => e.confidence);

  return {
    riskTolerance: holdCount / total > 0.5 ? "conservative" : buyCount / total > 0.4 ? "aggressive" : "moderate",
    avgPositionSize: 0, // Would need trade amounts
    holdRate: round2(holdCount / total),
    actionDistribution: {
      buy: round2(buyCount / total),
      sell: round2(sellCount / total),
      hold: round2(holdCount / total),
    },
    maxConfidence: Math.max(...confidences),
    minConfidence: Math.min(...confidences),
    prefersBullish: buyCount > sellCount,
  };
}

function buildReasoningQuality(entries: ReasoningEntry[]): ReasoningQualitySection {
  const total = entries.length;
  const avgCoherence = entries.reduce((s, e) => s + e.coherenceScore, 0) / total;
  const avgWordCount = entries.reduce((s, e) => s + e.wordCount, 0) / total;
  const halRate = countByCondition(entries, (e) => e.hallucinationCount > 0) / total;
  const discRate = countByCondition(entries, (e) => e.disciplinePass) / total;
  const coherences = entries.map((e) => e.coherenceScore);

  // Quality trend: compare first half vs second half coherence
  const half = Math.floor(total / 2);
  const firstHalf = entries.slice(0, half);
  const secondHalf = entries.slice(half);
  const firstAvg = firstHalf.length > 0
    ? firstHalf.reduce((s, e) => s + e.coherenceScore, 0) / firstHalf.length
    : 0;
  const secondAvg = secondHalf.length > 0
    ? secondHalf.reduce((s, e) => s + e.coherenceScore, 0) / secondHalf.length
    : 0;

  let qualityTrend: "improving" | "stable" | "declining" = "stable";
  if (secondAvg > firstAvg + QUALITY_TREND_IMPROVEMENT_THRESHOLD) qualityTrend = "improving";
  else if (secondAvg < firstAvg - QUALITY_TREND_DECLINE_THRESHOLD) qualityTrend = "declining";

  return {
    avgCoherence: round2(avgCoherence),
    avgWordCount: Math.round(avgWordCount),
    hallucinationRate: round3(halRate),
    disciplineRate: round2(discRate),
    qualityTrend,
    bestCoherenceScore: Math.max(...coherences),
    worstCoherenceScore: Math.min(...coherences),
  };
}

function buildMarketBias(entries: ReasoningEntry[]): MarketBiasSection {
  const symbolStats = new Map<string, { count: number; totalConf: number }>();
  const intentCounts = new Map<string, number>();
  let buyCount = 0;
  let sellCount = 0;

  for (const e of entries) {
    if (e.action !== "hold") {
      const existing = symbolStats.get(e.symbol) ?? { count: 0, totalConf: 0 };
      existing.count++;
      existing.totalConf += e.confidence;
      symbolStats.set(e.symbol, existing);

      if (e.action === "buy") buyCount++;
      else sellCount++;
    }
    intentCounts.set(e.intent, (intentCounts.get(e.intent) ?? 0) + 1);
  }

  const favoriteSymbols = [...symbolStats.entries()]
    .map(([symbol, stats]) => ({
      symbol,
      count: stats.count,
      avgConfidence: round2(stats.totalConf / stats.count),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const intentDistribution: Record<string, number> = {};
  for (const [k, v] of intentCounts) {
    intentDistribution[k] = round2(v / entries.length);
  }

  const topIntent = [...intentCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown";

  let directionalBias: "buy-heavy" | "sell-heavy" | "balanced" = "balanced";
  const total = buyCount + sellCount;
  if (total > 0) {
    if (buyCount / total > DIRECTIONAL_BIAS_BUY_HEAVY_THRESHOLD) directionalBias = "buy-heavy";
    else if (sellCount / total > DIRECTIONAL_BIAS_SELL_HEAVY_THRESHOLD) directionalBias = "sell-heavy";
  }

  return {
    favoriteSymbols,
    intentDistribution,
    dominantStyle: topIntent,
    directionalBias,
  };
}

function buildConfidenceProfile(entries: ReasoningEntry[]): ConfidenceProfileSection {
  const total = entries.length;
  const avgConf = entries.reduce((s, e) => s + e.confidence, 0) / total;

  const buckets = [
    { min: 0, max: CONFIDENCE_BUCKET_LOW_MAX, label: "0-25%" },
    { min: CONFIDENCE_BUCKET_LOW_MAX, max: CONFIDENCE_BUCKET_MEDIUM_LOW_MAX, label: "25-50%" },
    { min: CONFIDENCE_BUCKET_MEDIUM_LOW_MAX, max: CONFIDENCE_BUCKET_MEDIUM_HIGH_MAX, label: "50-75%" },
    { min: CONFIDENCE_BUCKET_MEDIUM_HIGH_MAX, max: CONFIDENCE_BUCKET_HIGH_MAX, label: "75-100%" },
  ];

  const confidenceBuckets = buckets.map((b) => {
    const inBucket = entries.filter((e) => e.confidence >= b.min && e.confidence < b.max);
    const avgCoh = inBucket.length > 0
      ? inBucket.reduce((s, e) => s + e.coherenceScore, 0) / inBucket.length
      : 0;
    return {
      range: b.label,
      count: inBucket.length,
      avgCoherence: round2(avgCoh),
    };
  });

  return {
    avgConfidence: round2(avgConf),
    calibrationScore: 0.5, // Would be enriched by outcome tracker
    overconfidentRate: 0,
    underconfidentRate: 0,
    confidenceBuckets,
  };
}

function generateRecommendations(
  weaknesses: ReportInsight[],
  patterns: BehavioralPattern[],
  riskProfile: RiskProfile,
): string[] {
  const recs: string[] = [];

  for (const w of weaknesses) {
    if (w.category === "Reasoning Quality") {
      recs.push("Improve reasoning coherence: ensure bullish reasoning leads to buy actions and vice versa.");
    }
    if (w.category === "Factual Accuracy") {
      recs.push("Reduce hallucinations: only reference prices and data explicitly provided in the prompt.");
    }
    if (w.category === "Rule Compliance") {
      recs.push("Enforce position limits: check portfolio allocation before proposing trades.");
    }
    if (w.category === "Reasoning Depth") {
      recs.push("Provide more detailed analysis: reference specific price levels, changes, and data sources.");
    }
  }

  for (const p of patterns) {
    if (p.name === "Confidence Anchoring") {
      recs.push("Vary confidence based on conviction: some trades should have notably higher/lower confidence.");
    }
    if (p.name === "Symbol Fixation") {
      recs.push("Diversify analysis: consider a broader set of available stocks.");
    }
  }

  if (riskProfile.holdRate > WEAKNESS_HOLD_RATE_MAX - 0.1) {
    recs.push("Consider being more active: the hold rate is very high. Take trades when conviction is clear.");
  }

  return [...new Set(recs)]; // deduplicate
}

function computeIntelligenceGrade(
  quality: ReasoningQualitySection,
  confidence: ConfidenceProfileSection,
): string {
  const score =
    quality.avgCoherence * GRADE_WEIGHT_COHERENCE +
    (1 - quality.hallucinationRate) * GRADE_WEIGHT_HALLUCINATION_FREE +
    quality.disciplineRate * GRADE_WEIGHT_DISCIPLINE +
    confidence.calibrationScore * GRADE_WEIGHT_CALIBRATION +
    Math.min(1, quality.avgWordCount / WORD_COUNT_NORMALIZATION_DIVISOR) * GRADE_WEIGHT_WORD_DEPTH;

  if (score >= GRADE_THRESHOLD_A_PLUS) return "A+";
  if (score >= GRADE_THRESHOLD_A) return "A";
  if (score >= GRADE_THRESHOLD_A_MINUS) return "A-";
  if (score >= GRADE_THRESHOLD_B_PLUS) return "B+";
  if (score >= GRADE_THRESHOLD_B) return "B";
  if (score >= GRADE_THRESHOLD_B_MINUS) return "B-";
  if (score >= GRADE_THRESHOLD_C_PLUS) return "C+";
  if (score >= GRADE_THRESHOLD_C) return "C";
  if (score >= GRADE_THRESHOLD_C_MINUS) return "C-";
  if (score >= GRADE_THRESHOLD_D) return "D";
  return "F";
}

function buildExecutiveSummary(
  agentId: string,
  agentName: string,
  total: number,
  grade: string,
  strengths: ReportInsight[],
  weaknesses: ReportInsight[],
  riskProfile: RiskProfile,
): string {
  const topStrength = strengths[0]?.observation ?? "No notable strengths detected";
  const topWeakness = weaknesses[0]?.observation ?? "No critical weaknesses detected";
  const riskStyle = riskProfile.riskTolerance;
  const bias = riskProfile.prefersBullish ? "bullish" : "bearish";

  return `${agentName} (${agentId}) has been graded ${grade} based on ${total} trading decisions. ` +
    `This ${riskStyle} agent shows a ${bias} bias. ` +
    `Key strength: ${topStrength.toLowerCase()}. ` +
    `Key weakness: ${topWeakness.toLowerCase()}.`;
}

function emptyReport(agentId: string, agentName: string): IntelligenceReport {
  return {
    agentId,
    agentName,
    generatedAt: new Date().toISOString(),
    executiveSummary: `No trading data available for ${agentName}.`,
    strengths: [],
    weaknesses: [],
    behavioralPatterns: [],
    riskProfile: {
      riskTolerance: "unknown",
      avgPositionSize: 0,
      holdRate: 0,
      actionDistribution: {},
      maxConfidence: 0,
      minConfidence: 0,
      prefersBullish: false,
    },
    reasoningQuality: {
      avgCoherence: 0,
      avgWordCount: 0,
      hallucinationRate: 0,
      disciplineRate: 0,
      qualityTrend: "stable",
      bestCoherenceScore: 0,
      worstCoherenceScore: 0,
    },
    marketBias: {
      favoriteSymbols: [],
      intentDistribution: {},
      dominantStyle: "unknown",
      directionalBias: "balanced",
    },
    confidenceProfile: {
      avgConfidence: 0,
      calibrationScore: 0.5,
      overconfidentRate: 0,
      underconfidentRate: 0,
      confidenceBuckets: [],
    },
    recommendations: [],
    grade: "N/A",
    dataCompleteness: 0,
  };
}

