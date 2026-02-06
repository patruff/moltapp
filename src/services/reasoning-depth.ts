/**
 * Reasoning Depth Analyzer
 *
 * Goes beyond coherence to measure the SOPHISTICATION of agent reasoning.
 * Coherence asks "does the logic match the action?" — Depth asks "how
 * thorough, nuanced, and multi-dimensional is the reasoning?"
 *
 * This is critical for the benchmark because a simple "price went up so buy"
 * is coherent (score 1.0) but shallow. A deep analysis that considers
 * multiple factors, acknowledges uncertainty, and weighs tradeoffs
 * represents genuinely better AI reasoning.
 *
 * Measured dimensions:
 * 1. ANALYTICAL BREADTH: How many distinct analytical angles are used?
 * 2. CAUSAL DEPTH: How many reasoning steps from observation to conclusion?
 * 3. UNCERTAINTY MODELING: Does the agent quantify uncertainty?
 * 4. TEMPORAL AWARENESS: Does reasoning consider past, present, AND future?
 * 5. COUNTERFACTUAL REASONING: Does the agent consider "what if I'm wrong?"
 * 6. CROSS-ASSET AWARENESS: Does the agent consider portfolio/sector effects?
 * 7. VOCABULARY SOPHISTICATION: Financial vocabulary diversity and precision
 */

import { countWords, splitSentences } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReasoningDepthScore {
  /** Overall depth score 0-1 */
  overall: number;
  /** How many analytical dimensions are covered */
  analyticalBreadth: number;
  /** How deep the causal chain goes */
  causalDepth: number;
  /** How well uncertainty is acknowledged/quantified */
  uncertaintyModeling: number;
  /** Past/present/future awareness */
  temporalAwareness: number;
  /** "What if I'm wrong" reasoning */
  counterfactualReasoning: number;
  /** Portfolio-level and cross-asset awareness */
  crossAssetAwareness: number;
  /** Financial vocabulary sophistication */
  vocabularySophistication: number;
  /** Word count of the reasoning */
  wordCount: number;
  /** Number of distinct analytical angles */
  angleCount: number;
  /** Depth classification */
  classification: "shallow" | "moderate" | "deep" | "expert";
}

export interface AgentDepthProfile {
  agentId: string;
  avgDepth: number;
  depthTrend: "improving" | "declining" | "stable";
  classification: "shallow" | "moderate" | "deep" | "expert";
  strongestDimension: string;
  weakestDimension: string;
  recentScores: ReasoningDepthScore[];
  totalAnalyzed: number;
}

export interface DepthComparison {
  agents: Array<{
    agentId: string;
    avgDepth: number;
    classification: string;
    dimensions: Record<string, number>;
  }>;
  deepestAgent: string | null;
  shallowestAgent: string | null;
  dimensionLeaders: Record<string, string>;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface DepthEntry {
  agentId: string;
  score: ReasoningDepthScore;
  reasoning: string;
  action: string;
  symbol: string;
  roundId: string;
  timestamp: string;
}

const depthHistory: DepthEntry[] = [];
const MAX_HISTORY = 3000;

// ---------------------------------------------------------------------------
// Analytical Dimension Detectors
// ---------------------------------------------------------------------------

/** Analytical angles that an agent might use */
const ANALYTICAL_ANGLES = [
  { name: "price_action", patterns: [/\bprice\b/i, /\$\d+/i, /\btrading\s+at\b/i] },
  { name: "momentum", patterns: [/\bmomentum\b/i, /\btrend\b/i, /\bbreakout\b/i, /\brally\b/i] },
  { name: "mean_reversion", patterns: [/\boversold\b/i, /\boverbought\b/i, /\bpullback\b/i, /\breversion\b/i] },
  { name: "volume_analysis", patterns: [/\bvolume\b/i, /\bliquidity\b/i, /\bturnover\b/i] },
  { name: "technical_indicators", patterns: [/\bRSI\b/, /\bMACD\b/, /\bmoving average\b/i, /\bSMA\b/, /\bEMA\b/] },
  { name: "fundamental", patterns: [/\bearnings\b/i, /\brevenue\b/i, /\bP\/E\b/i, /\bvaluation\b/i, /\bfundamental/i] },
  { name: "sentiment", patterns: [/\bsentiment\b/i, /\bmood\b/i, /\bfear\b/i, /\bgreed\b/i, /\boptimism\b/i] },
  { name: "sector_macro", patterns: [/\bsector\b/i, /\bmacro\b/i, /\bmarket\b/i, /\beconomy\b/i, /\bindustry\b/i] },
  { name: "risk_assessment", patterns: [/\brisk\b/i, /\bvolatility\b/i, /\bdrawdown\b/i, /\bdownside\b/i] },
  { name: "portfolio_context", patterns: [/\bportfolio\b/i, /\bposition\b/i, /\ballocation\b/i, /\bdiversif/i] },
  { name: "news_catalyst", patterns: [/\bnews\b/i, /\bannounce/i, /\bcatalyst\b/i, /\bevent\b/i, /\bheadline\b/i] },
  { name: "comparative", patterns: [/\bcompared\s+to\b/i, /\brelative\b/i, /\bvs\.?\b/i, /\bpeer\b/i, /\bbenchmark\b/i] },
];

/** Financial vocabulary for sophistication scoring */
const SOPHISTICATED_VOCAB = [
  "alpha", "beta", "sharpe", "sortino", "drawdown", "volatility",
  "correlation", "covariance", "variance", "standard deviation",
  "momentum", "mean reversion", "arbitrage", "convexity",
  "tail risk", "black swan", "fat tail", "skewness", "kurtosis",
  "risk-adjusted", "information ratio", "tracking error",
  "value at risk", "expected shortfall", "kelly criterion",
  "margin of safety", "intrinsic value", "discounted cash flow",
  "earnings yield", "free cash flow", "capital allocation",
  "systematic risk", "idiosyncratic", "factor exposure",
  "regime change", "liquidity premium", "market microstructure",
  "order flow", "VWAP", "TWAP", "slippage", "market impact",
  "sector rotation", "risk parity", "maximum drawdown",
  "monte carlo", "bootstrap", "backtest", "out-of-sample",
  "forward-looking", "leading indicator", "lagging indicator",
];

// ---------------------------------------------------------------------------
// Core Analysis
// ---------------------------------------------------------------------------

/**
 * Analyze the depth of an agent's reasoning.
 */
export function analyzeReasoningDepth(
  reasoning: string,
  action: "buy" | "sell" | "hold",
  agentId: string,
  symbol: string,
  roundId: string,
): ReasoningDepthScore {
  const wordCount = countWords(reasoning);

  // 1. Analytical breadth: how many distinct angles are used?
  const { breadth, angleCount } = measureAnalyticalBreadth(reasoning);

  // 2. Causal depth: how deep is the reasoning chain?
  const causalDepth = measureCausalDepth(reasoning);

  // 3. Uncertainty modeling
  const uncertaintyModeling = measureUncertaintyModeling(reasoning);

  // 4. Temporal awareness
  const temporalAwareness = measureTemporalAwareness(reasoning);

  // 5. Counterfactual reasoning
  const counterfactualReasoning = measureCounterfactualReasoning(reasoning);

  // 6. Cross-asset awareness
  const crossAssetAwareness = measureCrossAssetAwareness(reasoning);

  // 7. Vocabulary sophistication
  const vocabularySophistication = measureVocabularySophistication(reasoning);

  // Weighted overall score
  const overall = Math.round(
    (breadth * 0.20 +
      causalDepth * 0.15 +
      uncertaintyModeling * 0.15 +
      temporalAwareness * 0.10 +
      counterfactualReasoning * 0.15 +
      crossAssetAwareness * 0.10 +
      vocabularySophistication * 0.15) * 100,
  ) / 100;

  // Classification
  let classification: ReasoningDepthScore["classification"];
  if (overall >= 0.75) classification = "expert";
  else if (overall >= 0.55) classification = "deep";
  else if (overall >= 0.35) classification = "moderate";
  else classification = "shallow";

  const score: ReasoningDepthScore = {
    overall,
    analyticalBreadth: breadth,
    causalDepth,
    uncertaintyModeling,
    temporalAwareness,
    counterfactualReasoning,
    crossAssetAwareness,
    vocabularySophistication,
    wordCount,
    angleCount,
    classification,
  };

  // Record entry
  depthHistory.unshift({
    agentId,
    score,
    reasoning,
    action,
    symbol,
    roundId,
    timestamp: new Date().toISOString(),
  });
  if (depthHistory.length > MAX_HISTORY) {
    depthHistory.length = MAX_HISTORY;
  }

  return score;
}

function measureAnalyticalBreadth(reasoning: string): { breadth: number; angleCount: number } {
  let angleCount = 0;
  for (const angle of ANALYTICAL_ANGLES) {
    const used = angle.patterns.some((p) => p.test(reasoning));
    if (used) angleCount++;
  }
  // Normalize: using 6+ out of 12 angles = 1.0
  const breadth = Math.min(1, angleCount / 6);
  return { breadth: Math.round(breadth * 100) / 100, angleCount };
}

function measureCausalDepth(reasoning: string): number {
  let score = 0.2;

  // Count causal connectors (each one adds a step in the reasoning chain)
  const causalConnectors = [
    /\bbecause\b/gi, /\btherefore\b/gi, /\bconsequently\b/gi,
    /\bas a result\b/gi, /\bthis leads to\b/gi, /\bwhich means\b/gi,
    /\bthis suggests\b/gi, /\bimplying\b/gi, /\bhence\b/gi,
    /\bthus\b/gi, /\bso\b/gi, /\bdue to\b/gi,
    /\bgiven that\b/gi, /\bsince\b/gi,
  ];

  let connectorCount = 0;
  for (const pattern of causalConnectors) {
    const matches = reasoning.match(pattern);
    if (matches) connectorCount += matches.length;
  }

  // Each connector adds to depth (diminishing returns)
  score += Math.min(0.5, connectorCount * 0.1);

  // Multi-step reasoning (if...then...therefore)
  if (/\bif\b.{10,}\bthen\b/i.test(reasoning)) score += 0.1;

  // Chain reasoning (A leads to B leads to C)
  if (connectorCount >= 3) score += 0.1;

  // Evidence → inference → conclusion pattern
  const sentences = splitSentences(reasoning);
  if (sentences.length >= 3) score += 0.1;

  return Math.min(1, Math.round(score * 100) / 100);
}

function measureUncertaintyModeling(reasoning: string): number {
  let score = 0.1;

  // Probability language
  const probPatterns = [
    /\blikely\b/i, /\bunlikely\b/i, /\bprobably\b/i,
    /\bpossibly\b/i, /\bpotentially\b/i, /\bchance\b/i,
    /\bprobability\b/i, /\b\d+%\s+(?:chance|probability|likely)/i,
  ];
  for (const p of probPatterns) {
    if (p.test(reasoning)) score += 0.06;
  }

  // Hedging language (acknowledging limitations)
  const hedgePatterns = [
    /\bmight\b/i, /\bcould\b/i, /\bmay\b/i,
    /\buncertain\b/i, /\bhard to predict\b/i, /\bdifficult to say\b/i,
    /\bremains to be seen\b/i, /\bin my estimation\b/i,
  ];
  for (const p of hedgePatterns) {
    if (p.test(reasoning)) score += 0.05;
  }

  // Range estimates (showing uncertainty bounds)
  if (/\bbetween\s+\$?\d+\s+and\s+\$?\d+/i.test(reasoning)) score += 0.15;
  if (/\brange\b/i.test(reasoning)) score += 0.05;

  // Scenario analysis
  if (/\bscenario\b/i.test(reasoning)) score += 0.1;
  if (/\bbest case\b|\bworst case\b|\bbase case\b/i.test(reasoning)) score += 0.15;

  return Math.min(1, Math.round(score * 100) / 100);
}

function measureTemporalAwareness(reasoning: string): number {
  let score = 0.1;
  let dimensions = 0;

  // Past references
  if (/\bhistorically\b|\bpreviously\b|\blast\s+(?:week|month|quarter|year)\b|\bin the past\b/i.test(reasoning)) {
    score += 0.25;
    dimensions++;
  }

  // Present analysis
  if (/\bcurrently\b|\bright now\b|\bat present\b|\btoday\b/i.test(reasoning)) {
    score += 0.15;
    dimensions++;
  }

  // Future projection
  if (/\bgoing forward\b|\bnext\s+(?:week|month|quarter)\b|\bexpect\b|\bforecast\b|\bwill\s+likely\b/i.test(reasoning)) {
    score += 0.25;
    dimensions++;
  }

  // Time-horizon awareness (short vs long term)
  if (/\bshort.?term\b|\blong.?term\b|\bmedium.?term\b/i.test(reasoning)) {
    score += 0.15;
  }

  // Bonus for covering all three temporal dimensions
  if (dimensions >= 3) score += 0.1;

  return Math.min(1, Math.round(score * 100) / 100);
}

function measureCounterfactualReasoning(reasoning: string): number {
  let score = 0.05;

  // "What if" reasoning
  const counterfactualPatterns = [
    /\bwhat if\b/i, /\bif .+ fails?\b/i, /\bif .+ drops?\b/i,
    /\bon the other hand\b/i, /\balternatively\b/i,
    /\bhowever\b/i, /\bbut\b/i, /\bdespite\b/i, /\balthough\b/i,
    /\bnevertheless\b/i, /\bnonetheless\b/i,
  ];
  for (const p of counterfactualPatterns) {
    if (p.test(reasoning)) score += 0.06;
  }

  // Risk scenario consideration
  if (/\bif.+(?:falls|drops|declines|crashes)/i.test(reasoning)) score += 0.1;
  if (/\bstop.?loss\b|\bexit strategy\b|\bbail out\b/i.test(reasoning)) score += 0.1;

  // Explicit alternative actions considered
  if (/\bcould\s+also\b|\banother option\b|\binstead\b|\brather than\b/i.test(reasoning)) {
    score += 0.1;
  }

  // Acknowledging that the thesis might be wrong
  if (/\bI could be wrong\b|\brisk is\b|\bdownside scenario\b|\bbear case\b/i.test(reasoning)) {
    score += 0.15;
  }

  return Math.min(1, Math.round(score * 100) / 100);
}

function measureCrossAssetAwareness(reasoning: string): number {
  let score = 0.1;

  // Multiple stock references
  const stockMentions = reasoning.match(/\b[A-Z]{2,5}x\b/g) ?? [];
  const uniqueStocks = new Set(stockMentions);
  if (uniqueStocks.size > 1) score += 0.15;
  if (uniqueStocks.size > 3) score += 0.1;

  // Portfolio-level thinking
  if (/\bportfolio\b|\boverall\s+(?:position|exposure|allocation)\b/i.test(reasoning)) {
    score += 0.15;
  }

  // Sector/market-wide analysis
  if (/\bsector\b|\bmarket-wide\b|\bcorrelation\b|\bbeta\b/i.test(reasoning)) {
    score += 0.15;
  }

  // Concentration risk
  if (/\bconcentrat/i.test(reasoning)) score += 0.1;

  // Diversification
  if (/\bdiversif/i.test(reasoning)) score += 0.1;

  // Hedge discussion
  if (/\bhedge\b|\boffset\b|\bbalance\b/i.test(reasoning)) score += 0.1;

  return Math.min(1, Math.round(score * 100) / 100);
}

function measureVocabularySophistication(reasoning: string): number {
  const lower = reasoning.toLowerCase();
  let sophisticatedTermCount = 0;

  for (const term of SOPHISTICATED_VOCAB) {
    if (lower.includes(term.toLowerCase())) {
      sophisticatedTermCount++;
    }
  }

  // Normalize: using 5+ sophisticated terms = 1.0
  const score = Math.min(1, sophisticatedTermCount / 5);
  return Math.round(score * 100) / 100;
}

// ---------------------------------------------------------------------------
// Query API
// ---------------------------------------------------------------------------

/**
 * Get depth profile for a specific agent.
 */
export function getAgentDepthProfile(agentId: string): AgentDepthProfile {
  const entries = depthHistory.filter((e) => e.agentId === agentId);

  if (entries.length === 0) {
    return {
      agentId,
      avgDepth: 0,
      depthTrend: "stable",
      classification: "shallow",
      strongestDimension: "none",
      weakestDimension: "none",
      recentScores: [],
      totalAnalyzed: 0,
    };
  }

  const scores = entries.map((e) => e.score);
  const avgDepth = Math.round(
    (scores.reduce((s, v) => s + v.overall, 0) / scores.length) * 100,
  ) / 100;

  // Trend: compare first half vs second half
  let depthTrend: AgentDepthProfile["depthTrend"] = "stable";
  if (scores.length >= 6) {
    const recentAvg = scores.slice(0, Math.floor(scores.length / 2))
      .reduce((s, v) => s + v.overall, 0) / Math.floor(scores.length / 2);
    const olderAvg = scores.slice(Math.floor(scores.length / 2))
      .reduce((s, v) => s + v.overall, 0) / (scores.length - Math.floor(scores.length / 2));
    if (recentAvg > olderAvg + 0.05) depthTrend = "improving";
    else if (recentAvg < olderAvg - 0.05) depthTrend = "declining";
  }

  // Strongest and weakest dimensions
  const dimensionAvgs: Record<string, number> = {
    analyticalBreadth: avgDimension(scores, "analyticalBreadth"),
    causalDepth: avgDimension(scores, "causalDepth"),
    uncertaintyModeling: avgDimension(scores, "uncertaintyModeling"),
    temporalAwareness: avgDimension(scores, "temporalAwareness"),
    counterfactualReasoning: avgDimension(scores, "counterfactualReasoning"),
    crossAssetAwareness: avgDimension(scores, "crossAssetAwareness"),
    vocabularySophistication: avgDimension(scores, "vocabularySophistication"),
  };

  const sortedDims = Object.entries(dimensionAvgs).sort((a, b) => b[1] - a[1]);
  const strongestDimension = sortedDims[0][0];
  const weakestDimension = sortedDims[sortedDims.length - 1][0];

  // Classification
  let classification: AgentDepthProfile["classification"];
  if (avgDepth >= 0.75) classification = "expert";
  else if (avgDepth >= 0.55) classification = "deep";
  else if (avgDepth >= 0.35) classification = "moderate";
  else classification = "shallow";

  return {
    agentId,
    avgDepth,
    depthTrend,
    classification,
    strongestDimension,
    weakestDimension,
    recentScores: scores.slice(0, 10),
    totalAnalyzed: entries.length,
  };
}

function avgDimension(scores: ReasoningDepthScore[], dimension: keyof ReasoningDepthScore): number {
  const values = scores.map((s) => s[dimension] as number);
  return values.length > 0
    ? Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 100) / 100
    : 0;
}

/**
 * Compare reasoning depth across all agents.
 */
export function getDepthComparison(): DepthComparison {
  const agentIds = [...new Set(depthHistory.map((e) => e.agentId))];
  const agents = agentIds.map((id) => {
    const profile = getAgentDepthProfile(id);
    return {
      agentId: id,
      avgDepth: profile.avgDepth,
      classification: profile.classification,
      dimensions: {
        analyticalBreadth: avgDimension(profile.recentScores, "analyticalBreadth"),
        causalDepth: avgDimension(profile.recentScores, "causalDepth"),
        uncertaintyModeling: avgDimension(profile.recentScores, "uncertaintyModeling"),
        temporalAwareness: avgDimension(profile.recentScores, "temporalAwareness"),
        counterfactualReasoning: avgDimension(profile.recentScores, "counterfactualReasoning"),
        crossAssetAwareness: avgDimension(profile.recentScores, "crossAssetAwareness"),
        vocabularySophistication: avgDimension(profile.recentScores, "vocabularySophistication"),
      },
    };
  });

  agents.sort((a, b) => b.avgDepth - a.avgDepth);

  // Find dimension leaders
  const dimensionNames = [
    "analyticalBreadth", "causalDepth", "uncertaintyModeling",
    "temporalAwareness", "counterfactualReasoning", "crossAssetAwareness",
    "vocabularySophistication",
  ];
  const dimensionLeaders: Record<string, string> = {};
  for (const dim of dimensionNames) {
    let best = { agentId: "", score: -1 };
    for (const agent of agents) {
      const score = (agent.dimensions as Record<string, number>)[dim] ?? 0;
      if (score > best.score) {
        best = { agentId: agent.agentId, score };
      }
    }
    if (best.agentId) dimensionLeaders[dim] = best.agentId;
  }

  return {
    agents,
    deepestAgent: agents[0]?.agentId ?? null,
    shallowestAgent: agents.length > 0 ? agents[agents.length - 1].agentId : null,
    dimensionLeaders,
  };
}

/**
 * Get recent depth scores for display.
 */
export function getRecentDepthScores(limit = 20): DepthEntry[] {
  return depthHistory.slice(0, limit);
}
