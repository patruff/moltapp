/**
 * Benchmark Validation Engine v12
 *
 * Production-grade validation layer that ensures every trade meets
 * benchmark-quality standards before it enters the scoring pipeline.
 * This is the gatekeeper between raw agent output and the benchmark dataset.
 *
 * Validation dimensions:
 * 1. STRUCTURAL VALIDITY — Does the trade have all required fields?
 * 2. REASONING DEPTH — Is the reasoning substantive enough to score?
 * 3. SOURCE VERIFICATION — Are claimed sources plausible?
 * 4. PRICE GROUNDING — Do price references match real market data?
 * 5. TEMPORAL CONSISTENCY — Does the reasoning reference current conditions?
 * 6. CONFIDENCE CALIBRATION — Is confidence within historical norms for this agent?
 * 7. ACTION-REASONING ALIGNMENT — Quick pre-check before full coherence analysis
 * 8. RISK AWARENESS — Does the reasoning acknowledge relevant risks?
 */

import type { MarketData, TradingDecision } from "../agents/base-agent.ts";
import type { AgentTradeConfig } from "./coherence-analyzer.ts";
import { normalize } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ValidationResult {
  /** Whether the trade passes minimum benchmark quality */
  valid: boolean;
  /** Overall quality score 0-1 */
  qualityScore: number;
  /** Grade letter */
  grade: string;
  /** Individual dimension scores */
  dimensions: ValidationDimension[];
  /** Issues found (warnings + errors) */
  issues: ValidationIssue[];
  /** Suggestions for improvement */
  suggestions: string[];
  /** Timestamp of validation */
  validatedAt: string;
}

export interface ValidationDimension {
  name: string;
  score: number;
  weight: number;
  passed: boolean;
  detail: string;
}

export interface ValidationIssue {
  severity: "error" | "warning" | "info";
  dimension: string;
  message: string;
  /** Specific text that triggered the issue */
  evidence?: string;
}

// ---------------------------------------------------------------------------
// Per-agent calibration history (in-memory sliding window)
// ---------------------------------------------------------------------------

const agentConfidenceHistory = new Map<string, number[]>();
const MAX_CONFIDENCE_HISTORY = 100;

export function recordConfidenceForCalibration(agentId: string, confidence: number): void {
  const history = agentConfidenceHistory.get(agentId) ?? [];
  history.push(confidence);
  if (history.length > MAX_CONFIDENCE_HISTORY) {
    history.shift();
  }
  agentConfidenceHistory.set(agentId, history);
}

function getConfidenceStats(agentId: string): { mean: number; stdDev: number; count: number } {
  const history = agentConfidenceHistory.get(agentId) ?? [];
  if (history.length < 5) {
    return { mean: 0.5, stdDev: 0.2, count: history.length };
  }
  const mean = history.reduce((s, v) => s + v, 0) / history.length;
  const variance = history.reduce((s, v) => s + (v - mean) ** 2, 0) / history.length;
  return { mean, stdDev: Math.sqrt(variance), count: history.length };
}

// ---------------------------------------------------------------------------
// Known finance terms for source verification
// ---------------------------------------------------------------------------

const VALID_SOURCE_PATTERNS = [
  "market_price_feed", "jupiter_price_api", "24h_price_change",
  "trading_volume", "portfolio_state", "news_feed",
  "technical_indicators", "fundamentals", "market_sentiment",
  "sector_analysis", "market_data", "earnings_data",
  "analyst_consensus", "options_flow", "insider_trading",
  "macro_indicators", "fed_policy", "correlation_analysis",
];

// ---------------------------------------------------------------------------
// Risk-related vocabulary
// ---------------------------------------------------------------------------

const RISK_VOCABULARY: RegExp[] = [
  /\brisk\b/i,
  /\bdownside\b/i,
  /\bvolatil/i,
  /\bdrawdown\b/i,
  /\bstop[- ]?loss\b/i,
  /\bhedg/i,
  /\bexposure\b/i,
  /\bloss\b/i,
  /\bworst[- ]?case\b/i,
  /\bprotect/i,
  /\buncertain/i,
  /\bcaution/i,
  /\bconcern/i,
  /\bdefensive/i,
];

// ---------------------------------------------------------------------------
// Core Validation Engine
// ---------------------------------------------------------------------------

/**
 * Validate a trade decision against all 8 benchmark quality dimensions.
 * Returns a comprehensive ValidationResult with scores, issues, and suggestions.
 */
export function validateForBenchmark(
  decision: TradingDecision,
  agentId: string,
  marketData: MarketData[],
  agentConfig?: AgentTradeConfig,
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const suggestions: string[] = [];
  const dimensions: ValidationDimension[] = [];

  // Normalize confidence to 0-1
  const confidence01 = decision.confidence > 1 ? decision.confidence / 100 : decision.confidence;

  // --- Dimension 1: Structural Validity (weight: 0.15) ---
  const structuralScore = validateStructure(decision, issues);
  dimensions.push({
    name: "structural_validity",
    score: structuralScore,
    weight: 0.15,
    passed: structuralScore >= 0.5,
    detail: structuralScore >= 0.8 ? "All required fields present" : "Missing or invalid fields detected",
  });

  // --- Dimension 2: Reasoning Depth (weight: 0.20) ---
  const depthScore = validateReasoningDepth(decision.reasoning, issues, suggestions);
  dimensions.push({
    name: "reasoning_depth",
    score: depthScore,
    weight: 0.20,
    passed: depthScore >= 0.3,
    detail: depthScore >= 0.7 ? "Substantive multi-factor reasoning" : depthScore >= 0.4 ? "Adequate but shallow reasoning" : "Insufficient reasoning depth",
  });

  // --- Dimension 3: Source Verification (weight: 0.10) ---
  const sourceScore = validateSources(decision, issues, suggestions);
  dimensions.push({
    name: "source_verification",
    score: sourceScore,
    weight: 0.10,
    passed: sourceScore >= 0.3,
    detail: sourceScore >= 0.7 ? "Sources are plausible and specific" : "Source claims need improvement",
  });

  // --- Dimension 4: Price Grounding (weight: 0.15) ---
  const priceScore = validatePriceGrounding(decision.reasoning, marketData, issues);
  dimensions.push({
    name: "price_grounding",
    score: priceScore,
    weight: 0.15,
    passed: priceScore >= 0.4,
    detail: priceScore >= 0.7 ? "Price references match market data" : "Price claims may be inaccurate",
  });

  // --- Dimension 5: Temporal Consistency (weight: 0.10) ---
  const temporalScore = validateTemporalConsistency(decision.reasoning, issues);
  dimensions.push({
    name: "temporal_consistency",
    score: temporalScore,
    weight: 0.10,
    passed: temporalScore >= 0.3,
    detail: temporalScore >= 0.7 ? "Reasoning references current conditions" : "Temporal context could be stronger",
  });

  // --- Dimension 6: Confidence Calibration (weight: 0.10) ---
  const calibrationScore = validateConfidenceCalibration(agentId, confidence01, decision, issues, suggestions);
  dimensions.push({
    name: "confidence_calibration",
    score: calibrationScore,
    weight: 0.10,
    passed: calibrationScore >= 0.3,
    detail: calibrationScore >= 0.7 ? "Confidence is within historical norms" : "Confidence may be miscalibrated",
  });

  // --- Dimension 7: Action-Reasoning Alignment (weight: 0.15) ---
  const alignmentScore = validateActionAlignment(decision, issues);
  dimensions.push({
    name: "action_reasoning_alignment",
    score: alignmentScore,
    weight: 0.15,
    passed: alignmentScore >= 0.3,
    detail: alignmentScore >= 0.7 ? "Reasoning supports the chosen action" : "Possible misalignment between reasoning and action",
  });

  // --- Dimension 8: Risk Awareness (weight: 0.05) ---
  const riskScore = validateRiskAwareness(decision.reasoning, decision.action, issues, suggestions);
  dimensions.push({
    name: "risk_awareness",
    score: riskScore,
    weight: 0.05,
    passed: true, // Risk awareness is never a blocking failure
    detail: riskScore >= 0.5 ? "Reasoning acknowledges relevant risks" : "Limited risk awareness in reasoning",
  });

  // --- Compute composite score ---
  const qualityScore = dimensions.reduce((sum, d) => sum + d.score * d.weight, 0);
  const roundedScore = Math.round(qualityScore * 1000) / 1000;

  // Grade assignment
  const grade = assignGrade(roundedScore);

  // Valid if no dimension has a critical failure AND composite is above threshold
  const hasBlockingFailure = dimensions.some((d) => !d.passed && d.weight >= 0.15);
  const valid = !hasBlockingFailure && roundedScore >= 0.25;

  // Record confidence for future calibration checks
  recordConfidenceForCalibration(agentId, confidence01);

  return {
    valid,
    qualityScore: roundedScore,
    grade,
    dimensions,
    issues,
    suggestions: suggestions.slice(0, 5), // Cap at 5 suggestions
    validatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Dimension Validators
// ---------------------------------------------------------------------------

function validateStructure(decision: TradingDecision, issues: ValidationIssue[]): number {
  let score = 1.0;

  if (!decision.action || !["buy", "sell", "hold"].includes(decision.action)) {
    issues.push({ severity: "error", dimension: "structural_validity", message: "Missing or invalid action field" });
    score -= 0.4;
  }

  if (!decision.symbol || decision.symbol.length === 0) {
    issues.push({ severity: "error", dimension: "structural_validity", message: "Missing symbol field" });
    score -= 0.3;
  }

  if (!decision.reasoning || decision.reasoning.length < 10) {
    issues.push({ severity: "error", dimension: "structural_validity", message: "Missing or too-short reasoning" });
    score -= 0.3;
  }

  if (typeof decision.confidence !== "number") {
    issues.push({ severity: "warning", dimension: "structural_validity", message: "Confidence is not a number" });
    score -= 0.1;
  }

  if (decision.action !== "hold" && (typeof decision.quantity !== "number" || decision.quantity <= 0)) {
    issues.push({ severity: "warning", dimension: "structural_validity", message: "Non-hold action with invalid quantity" });
    score -= 0.1;
  }

  if (!decision.timestamp) {
    issues.push({ severity: "info", dimension: "structural_validity", message: "Missing timestamp" });
    score -= 0.05;
  }

  return Math.max(0, score);
}

function validateReasoningDepth(reasoning: string, issues: ValidationIssue[], suggestions: string[]): number {
  const words = reasoning.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const sentences = reasoning.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const sentenceCount = sentences.length;

  let score = 0;

  // Word count scoring (20+ words = good, 50+ = great, 100+ = excellent)
  if (wordCount >= 100) score += 0.3;
  else if (wordCount >= 50) score += 0.25;
  else if (wordCount >= 20) score += 0.15;
  else {
    issues.push({ severity: "warning", dimension: "reasoning_depth", message: `Reasoning is only ${wordCount} words — substantive analysis needs 50+ words` });
    suggestions.push("Expand reasoning to include multiple analytical angles (price action, fundamentals, portfolio context)");
  }

  // Multi-sentence reasoning
  if (sentenceCount >= 5) score += 0.2;
  else if (sentenceCount >= 3) score += 0.15;
  else if (sentenceCount >= 2) score += 0.1;

  // Check for analytical dimensions
  const dimensions = [
    { pattern: /price|valuation|\$\d|\bP\/E\b/i, name: "price_analysis" },
    { pattern: /volume|liquidity|traded/i, name: "volume_analysis" },
    { pattern: /trend|momentum|moving\s+average|breakout/i, name: "technical_analysis" },
    { pattern: /fundamental|earnings|revenue|growth|margin/i, name: "fundamental_analysis" },
    { pattern: /portfolio|position|allocation|exposure/i, name: "portfolio_context" },
    { pattern: /risk|downside|protect|volatile/i, name: "risk_consideration" },
    { pattern: /sector|industry|market|macro|economy/i, name: "macro_context" },
    { pattern: /news|event|catalyst|announcement/i, name: "catalyst_awareness" },
  ];

  const dimensionsPresent = dimensions.filter((d) => d.pattern.test(reasoning)).length;
  score += Math.min(0.3, dimensionsPresent * 0.06); // Up to 0.3 for 5+ dimensions

  if (dimensionsPresent < 2) {
    suggestions.push("Include multiple analytical angles: price analysis, fundamentals, portfolio context, risk assessment");
  }

  // Check for quantitative claims (numbers, percentages)
  const quantClaims = (reasoning.match(/\d+\.?\d*%|\$\d+\.?\d*|\d+\.\d+/g) ?? []).length;
  if (quantClaims >= 3) score += 0.15;
  else if (quantClaims >= 1) score += 0.08;
  else {
    suggestions.push("Include specific numbers and percentages to ground your reasoning in data");
  }

  // Causal connectors (because, therefore, due to, since, as a result)
  const causalConnectors = (reasoning.match(/\bbecause\b|\btherefore\b|\bdue\s+to\b|\bsince\b|\bas\s+a\s+result\b|\bconsequently\b|\bhence\b|\bthus\b/gi) ?? []).length;
  if (causalConnectors >= 2) score += 0.05;

  return Math.min(1, score);
}

function validateSources(decision: TradingDecision, issues: ValidationIssue[], suggestions: string[]): number {
  const sources = decision.sources ?? [];

  if (sources.length === 0) {
    issues.push({ severity: "warning", dimension: "source_verification", message: "No data sources cited" });
    suggestions.push("Cite specific data sources used in analysis (e.g., 'market_price_feed', 'news_feed', 'technical_indicators')");
    return 0.2; // Minimal score — reasoning text might still reference data
  }

  let score = 0.4; // Base score for having sources

  // Check if sources are recognized
  const recognizedCount = sources.filter((s) =>
    VALID_SOURCE_PATTERNS.some((p) => s.toLowerCase().includes(p.toLowerCase()) || p.toLowerCase().includes(s.toLowerCase()))
  ).length;

  score += Math.min(0.3, (recognizedCount / Math.max(1, sources.length)) * 0.3);

  // Bonus for multiple distinct sources
  if (sources.length >= 3) score += 0.2;
  else if (sources.length >= 2) score += 0.1;

  // Check for source fabrication (very long or unusual source names)
  for (const src of sources) {
    if (src.length > 60) {
      issues.push({ severity: "info", dimension: "source_verification", message: `Unusually long source name: ${src.slice(0, 40)}...` });
    }
  }

  return Math.min(1, score);
}

function validatePriceGrounding(reasoning: string, marketData: MarketData[], issues: ValidationIssue[]): number {
  // Build price lookup
  const realPrices = new Map<string, number>();
  for (const d of marketData) {
    realPrices.set(d.symbol.toLowerCase(), d.price);
    realPrices.set(d.symbol.replace(/x$/i, "").toLowerCase(), d.price);
  }

  // If no market data, give benefit of the doubt
  if (marketData.length === 0) return 0.6;

  let score = 0.7; // Start with a good score and deduct for errors

  // Check price claims
  const pricePattern = /(\w+x?)\s+(?:is\s+)?(?:at|priced?\s+at|trading\s+at|currently)\s+\$?([\d,]+\.?\d*)/gi;
  let match;
  let claimCount = 0;
  let accurateCount = 0;

  while ((match = pricePattern.exec(reasoning)) !== null) {
    const symbol = match[1].toLowerCase();
    const claimed = parseFloat(match[2].replace(/,/g, ""));
    const real = realPrices.get(symbol);

    claimCount++;
    if (real !== undefined && claimed > 0) {
      const deviation = Math.abs(claimed - real) / real;
      if (deviation <= 0.05) {
        accurateCount++;
      } else if (deviation <= 0.20) {
        accurateCount += 0.5;
      } else {
        issues.push({
          severity: "warning",
          dimension: "price_grounding",
          message: `Price claim for ${symbol.toUpperCase()} ($${claimed.toFixed(2)}) deviates ${(deviation * 100).toFixed(0)}% from actual ($${real.toFixed(2)})`,
          evidence: match[0],
        });
        score -= 0.15;
      }
    }
  }

  // Bonus for making accurate price claims
  if (claimCount > 0 && accurateCount / claimCount >= 0.8) {
    score += 0.2;
  }

  // If reasoning mentions specific prices without errors, that's good
  if (claimCount === 0) {
    // No price claims — neutral, slightly lower score
    score = 0.6;
  }

  return normalize(score);
}

function validateTemporalConsistency(reasoning: string, issues: ValidationIssue[]): number {
  let score = 0.5; // Base score

  // Check for temporal references
  const temporalPatterns = [
    { pattern: /\bcurrent(ly)?\b|\bright\s+now\b|\btoday\b/i, weight: 0.15 },
    { pattern: /\brecent(ly)?\b|\blast\s+(week|month|day|session)\b/i, weight: 0.1 },
    { pattern: /\b24h\b|\b24-?hour\b|\bintraday\b/i, weight: 0.1 },
    { pattern: /\btrending\b|\bmoving\b|\bshifting\b/i, weight: 0.05 },
    { pattern: /\bsince\s+(yesterday|last|the)\b/i, weight: 0.1 },
  ];

  for (const { pattern, weight } of temporalPatterns) {
    if (pattern.test(reasoning)) {
      score += weight;
    }
  }

  // Red flag: reasoning that sounds generic / not grounded in current conditions
  if (!/\d/.test(reasoning)) {
    issues.push({ severity: "info", dimension: "temporal_consistency", message: "Reasoning contains no numbers — may not be grounded in current data" });
    score -= 0.1;
  }

  return normalize(score);
}

function validateConfidenceCalibration(
  agentId: string,
  confidence: number,
  decision: TradingDecision,
  issues: ValidationIssue[],
  suggestions: string[],
): number {
  const stats = getConfidenceStats(agentId);
  let score = 0.7; // Default good score

  // If we have enough history, check for anomalies
  if (stats.count >= 10) {
    const zScore = Math.abs(confidence - stats.mean) / Math.max(0.01, stats.stdDev);

    if (zScore > 3) {
      issues.push({
        severity: "warning",
        dimension: "confidence_calibration",
        message: `Confidence ${(confidence * 100).toFixed(0)}% is ${zScore.toFixed(1)} standard deviations from agent's mean of ${(stats.mean * 100).toFixed(0)}%`,
      });
      score -= 0.3;
    } else if (zScore > 2) {
      issues.push({
        severity: "info",
        dimension: "confidence_calibration",
        message: `Confidence is notably different from agent's historical average`,
      });
      score -= 0.1;
    }
  }

  // Very high confidence on hold actions is suspicious
  if (decision.action === "hold" && confidence > 0.9) {
    issues.push({
      severity: "info",
      dimension: "confidence_calibration",
      message: "Very high confidence (>90%) on a hold action — consider why confidence is so high if no trade is being made",
    });
    score -= 0.1;
  }

  // Very low confidence on aggressive actions
  if (decision.action !== "hold" && confidence < 0.2) {
    issues.push({
      severity: "warning",
      dimension: "confidence_calibration",
      message: "Trading with very low confidence (<20%) — consider whether this trade should be a hold instead",
    });
    suggestions.push("Low-confidence trades should include strong reasoning for why the trade is being taken despite uncertainty");
    score -= 0.2;
  }

  return normalize(score);
}

function validateActionAlignment(decision: TradingDecision, issues: ValidationIssue[]): number {
  const reasoning = decision.reasoning.toLowerCase();
  let score = 0.5; // Neutral start

  // Quick sentiment check
  const bullishWords = (reasoning.match(/\bbullish\b|\bupside\b|\bgrowth\b|\bundervalued\b|\bbreakout\b|\brally\b|\baccumulate\b|\boptimistic\b/g) ?? []).length;
  const bearishWords = (reasoning.match(/\bbearish\b|\bdownside\b|\bovervalued\b|\bbreakdown\b|\bcorrection\b|\bpessimistic\b|\bdeclining\b|\bweakness\b/g) ?? []).length;
  const holdWords = (reasoning.match(/\buncertain\b|\bwait\b|\bcaution\b|\bsideline\b|\bmixed\b|\binsufficient\b|\bpatien/g) ?? []).length;

  if (decision.action === "buy") {
    if (bullishWords > bearishWords) score = 0.85;
    else if (bullishWords === bearishWords && bullishWords > 0) score = 0.5;
    else if (bearishWords > bullishWords + 1) {
      // Check for contrarian/mean_reversion justification
      if (/contrarian|reversion|oversold|bounce|discount/i.test(reasoning)) {
        score = 0.7;
      } else {
        issues.push({ severity: "warning", dimension: "action_reasoning_alignment", message: "Bearish reasoning but choosing to buy" });
        score = 0.25;
      }
    }
  } else if (decision.action === "sell") {
    if (bearishWords > bullishWords) score = 0.85;
    else if (bearishWords === bullishWords && bearishWords > 0) score = 0.5;
    else if (bullishWords > bearishWords + 1) {
      if (/profit|take\s+gains|rebalance|trim|overexposed/i.test(reasoning)) {
        score = 0.7;
      } else {
        issues.push({ severity: "warning", dimension: "action_reasoning_alignment", message: "Bullish reasoning but choosing to sell" });
        score = 0.25;
      }
    }
  } else {
    // Hold
    if (holdWords > 0 || (bullishWords <= 1 && bearishWords <= 1)) score = 0.8;
    else if (bullishWords > 2 || bearishWords > 2) {
      if (/guardrail|limit|buffer|risk\s+management/i.test(reasoning)) {
        score = 0.75;
      } else {
        issues.push({ severity: "info", dimension: "action_reasoning_alignment", message: "Strong directional signals but choosing to hold" });
        score = 0.45;
      }
    }
  }

  return score;
}

function validateRiskAwareness(reasoning: string, action: string, issues: ValidationIssue[], suggestions: string[]): number {
  const riskMentions = RISK_VOCABULARY.filter((p) => p.test(reasoning)).length;

  if (action === "hold") {
    // Hold decisions don't need as much risk discussion
    return Math.min(1, 0.5 + riskMentions * 0.15);
  }

  if (riskMentions === 0) {
    issues.push({ severity: "info", dimension: "risk_awareness", message: "Reasoning does not mention any risk factors" });
    suggestions.push("Include risk awareness in reasoning — what could go wrong with this trade?");
    return 0.2;
  }

  if (riskMentions >= 3) return 1.0;
  if (riskMentions >= 2) return 0.8;
  return 0.5;
}

// ---------------------------------------------------------------------------
// Grade Assignment
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

// ---------------------------------------------------------------------------
// Batch Validation (for dataset-level quality assessment)
// ---------------------------------------------------------------------------

export interface DatasetQualityReport {
  totalTrades: number;
  validTrades: number;
  validationRate: number;
  avgQualityScore: number;
  gradeDistribution: Record<string, number>;
  commonIssues: { message: string; count: number }[];
  dimensionAverages: Record<string, number>;
  timestamp: string;
}

/**
 * Validate an entire batch of trades and produce a dataset quality report.
 * Used by the HuggingFace sync to ensure export quality.
 */
export function validateDatasetBatch(
  decisions: Array<{ decision: TradingDecision; agentId: string }>,
  marketData: MarketData[],
): DatasetQualityReport {
  const results = decisions.map(({ decision, agentId }) =>
    validateForBenchmark(decision, agentId, marketData),
  );

  const validCount = results.filter((r) => r.valid).length;
  const avgScore = results.length > 0
    ? results.reduce((s, r) => s + r.qualityScore, 0) / results.length
    : 0;

  // Grade distribution
  const gradeDistribution: Record<string, number> = {};
  for (const r of results) {
    gradeDistribution[r.grade] = (gradeDistribution[r.grade] ?? 0) + 1;
  }

  // Common issues
  const issueCount = new Map<string, number>();
  for (const r of results) {
    for (const issue of r.issues) {
      const key = issue.message;
      issueCount.set(key, (issueCount.get(key) ?? 0) + 1);
    }
  }
  const commonIssues = Array.from(issueCount.entries())
    .map(([message, count]) => ({ message, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Dimension averages
  const dimensionSums = new Map<string, { sum: number; count: number }>();
  for (const r of results) {
    for (const d of r.dimensions) {
      const existing = dimensionSums.get(d.name) ?? { sum: 0, count: 0 };
      existing.sum += d.score;
      existing.count += 1;
      dimensionSums.set(d.name, existing);
    }
  }
  const dimensionAverages: Record<string, number> = {};
  for (const [name, { sum, count }] of dimensionSums) {
    dimensionAverages[name] = Math.round((sum / count) * 1000) / 1000;
  }

  return {
    totalTrades: decisions.length,
    validTrades: validCount,
    validationRate: decisions.length > 0 ? Math.round((validCount / decisions.length) * 1000) / 1000 : 0,
    avgQualityScore: Math.round(avgScore * 1000) / 1000,
    gradeDistribution,
    commonIssues,
    dimensionAverages,
    timestamp: new Date().toISOString(),
  };
}
