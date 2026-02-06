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

import { countWords, round3 } from "../lib/math-utils.ts";

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
    dataCompleteness: Math.min(1, total / 20),
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
  const avgCoherence = entries.reduce((s, e) => s + e.coherenceScore, 0) / total;
  const halRate = entries.filter((e) => e.hallucinationCount > 0).length / total;
  const discRate = entries.filter((e) => e.disciplinePass).length / total;
  const avgWords = entries.reduce((s, e) => s + e.wordCount, 0) / total;

  if (avgCoherence >= 0.7) {
    insights.push({
      category: "Reasoning Quality",
      observation: "Consistently produces coherent reasoning that matches trading actions",
      evidence: `Average coherence: ${avgCoherence.toFixed(2)} (${total} trades)`,
      severity: "high",
    });
  }

  if (halRate <= 0.05) {
    insights.push({
      category: "Factual Accuracy",
      observation: "Very low hallucination rate — rarely fabricates market data",
      evidence: `Hallucination rate: ${(halRate * 100).toFixed(1)}%`,
      severity: "high",
    });
  }

  if (discRate >= 0.9) {
    insights.push({
      category: "Rule Compliance",
      observation: "Excellent instruction discipline — follows position limits and rules",
      evidence: `Discipline rate: ${(discRate * 100).toFixed(0)}%`,
      severity: "medium",
    });
  }

  if (avgWords >= 50) {
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
  const halRate = entries.filter((e) => e.hallucinationCount > 0).length / total;
  const discRate = entries.filter((e) => e.disciplinePass).length / total;
  const avgWords = entries.reduce((s, e) => s + e.wordCount, 0) / total;
  const holdRate = entries.filter((e) => e.action === "hold").length / total;

  if (avgCoherence < 0.5) {
    insights.push({
      category: "Reasoning Quality",
      observation: "Reasoning frequently contradicts trading actions",
      evidence: `Average coherence: ${avgCoherence.toFixed(2)} — below 0.5 threshold`,
      severity: "high",
    });
  }

  if (halRate > 0.15) {
    insights.push({
      category: "Factual Accuracy",
      observation: "Frequently fabricates or misquotes market data in reasoning",
      evidence: `Hallucination rate: ${(halRate * 100).toFixed(1)}%`,
      severity: "high",
    });
  }

  if (discRate < 0.7) {
    insights.push({
      category: "Rule Compliance",
      observation: "Frequently violates position limits or trading rules",
      evidence: `Discipline rate: ${(discRate * 100).toFixed(0)}%`,
      severity: "medium",
    });
  }

  if (avgWords < 25) {
    insights.push({
      category: "Reasoning Depth",
      observation: "Reasoning is too brief — lacks analytical depth",
      evidence: `Average only ${avgWords.toFixed(0)} words per reasoning`,
      severity: "medium",
    });
  }

  if (holdRate > 0.7) {
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
  if (confStdDev < 0.08 && total >= 5) {
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
  const nonHoldCount = entries.filter((e) => e.action !== "hold").length;
  const topSymbolCount = Math.max(...symbolCounts.values(), 0);
  if (nonHoldCount > 5 && topSymbolCount / nonHoldCount > 0.5) {
    const topSymbol = [...symbolCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    patterns.push({
      name: "Symbol Fixation",
      description: `Disproportionately trades ${topSymbol ?? "one stock"} (${((topSymbolCount / nonHoldCount) * 100).toFixed(0)}% of trades)`,
      frequency: topSymbolCount / nonHoldCount,
      impact: "negative",
    });
  }

  // Pattern: Momentum following
  const momentumTrades = entries.filter((e) => e.intent === "momentum").length;
  if (momentumTrades / total > 0.4) {
    patterns.push({
      name: "Momentum Follower",
      description: "Predominantly follows price trends rather than fundamental analysis",
      frequency: momentumTrades / total,
      impact: "neutral",
    });
  }

  // Pattern: Contrarian tendency
  const contrarianTrades = entries.filter((e) => e.intent === "contrarian").length;
  if (contrarianTrades / total > 0.3) {
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
  const buyCount = entries.filter((e) => e.action === "buy").length;
  const sellCount = entries.filter((e) => e.action === "sell").length;
  const holdCount = entries.filter((e) => e.action === "hold").length;
  const confidences = entries.map((e) => e.confidence);

  return {
    riskTolerance: holdCount / total > 0.5 ? "conservative" : buyCount / total > 0.4 ? "aggressive" : "moderate",
    avgPositionSize: 0, // Would need trade amounts
    holdRate: Math.round((holdCount / total) * 100) / 100,
    actionDistribution: {
      buy: Math.round((buyCount / total) * 100) / 100,
      sell: Math.round((sellCount / total) * 100) / 100,
      hold: Math.round((holdCount / total) * 100) / 100,
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
  const halRate = entries.filter((e) => e.hallucinationCount > 0).length / total;
  const discRate = entries.filter((e) => e.disciplinePass).length / total;
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
  if (secondAvg > firstAvg + 0.05) qualityTrend = "improving";
  else if (secondAvg < firstAvg - 0.05) qualityTrend = "declining";

  return {
    avgCoherence: Math.round(avgCoherence * 100) / 100,
    avgWordCount: Math.round(avgWordCount),
    hallucinationRate: round3(halRate),
    disciplineRate: Math.round(discRate * 100) / 100,
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
      avgConfidence: Math.round((stats.totalConf / stats.count) * 100) / 100,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const intentDistribution: Record<string, number> = {};
  for (const [k, v] of intentCounts) {
    intentDistribution[k] = Math.round((v / entries.length) * 100) / 100;
  }

  const topIntent = [...intentCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown";

  let directionalBias: "buy-heavy" | "sell-heavy" | "balanced" = "balanced";
  const total = buyCount + sellCount;
  if (total > 0) {
    if (buyCount / total > 0.65) directionalBias = "buy-heavy";
    else if (sellCount / total > 0.65) directionalBias = "sell-heavy";
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
    { min: 0, max: 0.25, label: "0-25%" },
    { min: 0.25, max: 0.5, label: "25-50%" },
    { min: 0.5, max: 0.75, label: "50-75%" },
    { min: 0.75, max: 1.01, label: "75-100%" },
  ];

  const confidenceBuckets = buckets.map((b) => {
    const inBucket = entries.filter((e) => e.confidence >= b.min && e.confidence < b.max);
    const avgCoh = inBucket.length > 0
      ? inBucket.reduce((s, e) => s + e.coherenceScore, 0) / inBucket.length
      : 0;
    return {
      range: b.label,
      count: inBucket.length,
      avgCoherence: Math.round(avgCoh * 100) / 100,
    };
  });

  return {
    avgConfidence: Math.round(avgConf * 100) / 100,
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

  if (riskProfile.holdRate > 0.6) {
    recs.push("Consider being more active: the hold rate is very high. Take trades when conviction is clear.");
  }

  return [...new Set(recs)]; // deduplicate
}

function computeIntelligenceGrade(
  quality: ReasoningQualitySection,
  confidence: ConfidenceProfileSection,
): string {
  const score =
    quality.avgCoherence * 0.3 +
    (1 - quality.hallucinationRate) * 0.25 +
    quality.disciplineRate * 0.2 +
    confidence.calibrationScore * 0.15 +
    Math.min(1, quality.avgWordCount / 80) * 0.1;

  if (score >= 0.9) return "A+";
  if (score >= 0.85) return "A";
  if (score >= 0.8) return "A-";
  if (score >= 0.75) return "B+";
  if (score >= 0.7) return "B";
  if (score >= 0.65) return "B-";
  if (score >= 0.6) return "C+";
  if (score >= 0.55) return "C";
  if (score >= 0.5) return "C-";
  if (score >= 0.4) return "D";
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

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}
