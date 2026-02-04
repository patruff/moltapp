/**
 * Agent Strategy Profiler (v21)
 *
 * Goes beyond simple intent classification to build a comprehensive behavioral
 * profile of each agent's trading strategy. Tracks how agents adapt their strategy
 * across market conditions and whether they show genuine strategic intelligence.
 *
 * Dimensions profiled:
 * 1. CONVICTION CONSISTENCY: Does the agent follow through on its stated convictions?
 * 2. RISK AWARENESS DEPTH: How deeply does the agent consider risks?
 * 3. MARKET SENSITIVITY: How responsive to market data vs. rigid formula?
 * 4. STRATEGIC ADAPTABILITY: Does strategy evolve across rounds?
 * 5. INFORMATION UTILIZATION: How much of available data does the agent actually use?
 *
 * Each dimension is scored 0-1 with trend tracking and evidence trails. The
 * profiler enables researchers to distinguish genuinely strategic agents from
 * those that apply rigid heuristics regardless of context.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single scored dimension within an agent's strategy profile. */
export interface StrategyDimension {
  /** Human-readable dimension name */
  name: string;
  /** Score from 0 (worst) to 1 (best) */
  score: number;
  /** Natural-language evidence supporting the score */
  evidence: string;
  /** Whether this dimension is improving, declining, or stable over time */
  trendDirection: "improving" | "declining" | "stable";
}

/** Complete multi-dimensional strategy profile for a single agent. */
export interface StrategyProfile {
  /** Unique agent identifier */
  agentId: string;
  /** All five scored dimensions */
  dimensions: StrategyDimension[];
  /** Weighted average across all dimensions */
  overallScore: number;
  /** The intent the agent uses most frequently */
  dominantStrategy: string;
  /** 0-1 measure of how varied the agent's strategies are (higher = more diverse) */
  strategicFlexibility: number;
  /** 0-1 measure of alignment between stated intent and actual actions */
  consistencyWithStatedIntent: number;
  /** Total number of trades analyzed */
  tradeCount: number;
  /** ISO timestamp of last profile computation */
  lastUpdated: string;
}

/** A single trade observation fed into the profiler. */
interface TradeRecord {
  /** buy | sell | hold */
  action: string;
  /** Ticker symbol traded */
  symbol: string;
  /** Full reasoning text from the agent */
  reasoning: string;
  /** Agent-reported confidence 0-1 */
  confidence: number;
  /** Agent-stated trading intent (e.g. momentum, value, hedge) */
  intent: string;
  /** Data sources the agent cited */
  sources: string[];
  /** Coherence score from earlier pipeline stages */
  coherenceScore: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum trade records retained per agent to bound memory usage. */
const MAX_RECORDS_PER_AGENT = 200;

/**
 * Known data source types that an agent could reference. Used to compute
 * the information utilization ratio.
 */
const KNOWN_SOURCE_TYPES = [
  "price",
  "volume",
  "news",
  "sentiment",
  "technical",
  "fundamental",
  "macro",
  "social",
  "analyst",
  "earnings",
];

/** Keywords that signal risk-aware reasoning. */
const RISK_KEYWORDS = [
  "hedge",
  "downside",
  "stop-loss",
  "stop loss",
  "risk",
  "caution",
  "volatility",
  "drawdown",
  "exposure",
  "protect",
  "diversif",
  "worst-case",
  "worst case",
  "tail risk",
  "black swan",
  "liquidat",
  "margin",
];

/** Keywords that signal engagement with specific market data. */
const MARKET_DATA_KEYWORDS = [
  "price",
  "volume",
  "moving average",
  "rsi",
  "macd",
  "support",
  "resistance",
  "breakout",
  "gap",
  "spread",
  "bid",
  "ask",
  "open interest",
  "market cap",
  "p/e",
  "eps",
  "yield",
  "dividend",
  "52-week",
  "52 week",
  "all-time",
  "intraday",
  "close",
  "high",
  "low",
];

/**
 * Dimension weights for the overall pillar score.
 * Sum = 1.0.
 */
const DIMENSION_WEIGHTS: Record<string, number> = {
  conviction_consistency: 0.25,
  risk_awareness: 0.20,
  market_sensitivity: 0.20,
  strategic_adaptability: 0.20,
  information_utilization: 0.15,
};

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------

const agentTradeRecords: Map<string, TradeRecord[]> = new Map();
const agentProfiles: Map<string, StrategyProfile> = new Map();

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Count how many entries in `text` match any of the given keywords
 * (case-insensitive). Returns both match count and unique keyword count.
 */
function countKeywordMatches(
  text: string,
  keywords: string[],
): { totalHits: number; uniqueHits: number } {
  const lower = text.toLowerCase();
  let totalHits = 0;
  let uniqueHits = 0;

  for (const kw of keywords) {
    const regex = new RegExp(kw, "gi");
    const matches = lower.match(regex);
    if (matches && matches.length > 0) {
      totalHits += matches.length;
      uniqueHits++;
    }
  }

  return { totalHits, uniqueHits };
}

/**
 * Compute standard deviation of an array of numbers.
 */
function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance =
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Determine trend direction by comparing the first half average to the
 * second half average of a series of values.
 */
function detectTrend(
  values: number[],
): "improving" | "declining" | "stable" {
  if (values.length < 4) return "stable";
  const mid = Math.floor(values.length / 2);
  const firstHalf = values.slice(0, mid);
  const secondHalf = values.slice(mid);
  const avgFirst = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;
  const delta = avgSecond - avgFirst;
  if (delta > 0.05) return "improving";
  if (delta < -0.05) return "declining";
  return "stable";
}

/**
 * Map an intent string to a simplified intent category for grouping.
 */
function normalizeIntent(intent: string): string {
  const lower = (intent || "unknown").toLowerCase().trim();
  if (lower.includes("momentum")) return "momentum";
  if (lower.includes("value")) return "value";
  if (lower.includes("hedge")) return "hedge";
  if (lower.includes("contrarian")) return "contrarian";
  if (lower.includes("swing")) return "swing";
  if (lower.includes("scalp")) return "scalp";
  if (lower.includes("growth")) return "growth";
  if (lower.includes("income") || lower.includes("dividend")) return "income";
  if (lower.includes("specul")) return "speculative";
  return lower;
}

// ---------------------------------------------------------------------------
// Dimension scorers
// ---------------------------------------------------------------------------

/**
 * Dimension 1: Conviction Consistency
 *
 * Measures alignment between stated confidence and actual trading behavior.
 * An agent with high conviction consistency puts its money where its mouth is:
 * high confidence trades are aggressive (buy/sell), low confidence leads to holds.
 */
function scoreConvictionConsistency(trades: TradeRecord[]): StrategyDimension {
  if (trades.length < 3) {
    return {
      name: "conviction_consistency",
      score: 0.5,
      evidence: "Insufficient data (fewer than 3 trades)",
      trendDirection: "stable",
    };
  }

  // For each trade, check if action aligns with confidence level
  const alignmentScores: number[] = [];
  for (const t of trades) {
    const isActive = t.action === "buy" || t.action === "sell";
    const isHold = t.action === "hold";

    if (t.confidence >= 0.7 && isActive) {
      // High confidence + active trade = aligned
      alignmentScores.push(1.0);
    } else if (t.confidence >= 0.7 && isHold) {
      // High confidence but holding = misaligned
      alignmentScores.push(0.2);
    } else if (t.confidence <= 0.3 && isHold) {
      // Low confidence + hold = aligned (prudent)
      alignmentScores.push(1.0);
    } else if (t.confidence <= 0.3 && isActive) {
      // Low confidence but trading actively = misaligned
      alignmentScores.push(0.3);
    } else {
      // Medium confidence range: any action is reasonable
      alignmentScores.push(0.7);
    }
  }

  const score = alignmentScores.reduce((s, v) => s + v, 0) / alignmentScores.length;
  const trend = detectTrend(alignmentScores);

  const highConfActive = trades.filter(
    (t) => t.confidence >= 0.7 && (t.action === "buy" || t.action === "sell"),
  ).length;
  const lowConfHold = trades.filter(
    (t) => t.confidence <= 0.3 && t.action === "hold",
  ).length;

  return {
    name: "conviction_consistency",
    score: Math.max(0, Math.min(1, score)),
    evidence:
      `${highConfActive} high-confidence active trades, ` +
      `${lowConfHold} prudent low-confidence holds out of ${trades.length} total. ` +
      `Alignment score: ${(score * 100).toFixed(1)}%`,
    trendDirection: trend,
  };
}

/**
 * Dimension 2: Risk Awareness Depth
 *
 * Scans reasoning text for risk-related keywords and measures both breadth
 * (how many distinct risk concepts) and depth (how frequently risk is discussed).
 */
function scoreRiskAwareness(trades: TradeRecord[]): StrategyDimension {
  if (trades.length === 0) {
    return {
      name: "risk_awareness",
      score: 0,
      evidence: "No trades to analyze",
      trendDirection: "stable",
    };
  }

  const perTradeScores: number[] = [];
  let totalUniqueKeywords = new Set<string>();

  for (const t of trades) {
    const { totalHits, uniqueHits } = countKeywordMatches(
      t.reasoning,
      RISK_KEYWORDS,
    );
    // Depth component: how many risk mentions per trade (diminishing returns)
    const depthScore = Math.min(1, totalHits / 4);
    // Breadth component: how many unique risk concepts
    const breadthScore = Math.min(1, uniqueHits / 5);
    const tradeScore = depthScore * 0.4 + breadthScore * 0.6;
    perTradeScores.push(tradeScore);

    // Track unique keywords across all trades
    for (const kw of RISK_KEYWORDS) {
      if (t.reasoning.toLowerCase().includes(kw)) {
        totalUniqueKeywords.add(kw);
      }
    }
  }

  const score = perTradeScores.reduce((s, v) => s + v, 0) / perTradeScores.length;
  const trend = detectTrend(perTradeScores);
  const tradesWithRisk = perTradeScores.filter((s) => s > 0.1).length;

  return {
    name: "risk_awareness",
    score: Math.max(0, Math.min(1, score)),
    evidence:
      `${tradesWithRisk}/${trades.length} trades mention risk concepts. ` +
      `${totalUniqueKeywords.size}/${RISK_KEYWORDS.length} unique risk keywords detected. ` +
      `Depth score: ${(score * 100).toFixed(1)}%`,
    trendDirection: trend,
  };
}

/**
 * Dimension 3: Market Sensitivity
 *
 * Measures how much the agent references specific market data points in its
 * reasoning. A high score means the agent is responsive to actual market
 * conditions rather than applying a rigid formula.
 */
function scoreMarketSensitivity(trades: TradeRecord[]): StrategyDimension {
  if (trades.length === 0) {
    return {
      name: "market_sensitivity",
      score: 0,
      evidence: "No trades to analyze",
      trendDirection: "stable",
    };
  }

  const perTradeScores: number[] = [];

  for (const t of trades) {
    const { uniqueHits } = countKeywordMatches(t.reasoning, MARKET_DATA_KEYWORDS);
    // Check for specific numeric references (prices, percentages)
    const numericRefs = (t.reasoning.match(/\$\d+[\d,.]*|\d+\.?\d*%/g) || []).length;
    // Check for symbol-specific references
    const symbolRef = t.reasoning.toLowerCase().includes(t.symbol.toLowerCase()) ? 1 : 0;

    // Keyword breadth (0-1): how many market data types referenced
    const keywordScore = Math.min(1, uniqueHits / 6);
    // Numeric specificity (0-1): does the agent cite actual numbers
    const numericScore = Math.min(1, numericRefs / 3);
    // Symbol awareness (0 or 1): does the agent reference the specific ticker
    const combinedScore = keywordScore * 0.4 + numericScore * 0.35 + symbolRef * 0.25;

    perTradeScores.push(combinedScore);
  }

  const score = perTradeScores.reduce((s, v) => s + v, 0) / perTradeScores.length;
  const trend = detectTrend(perTradeScores);
  const highSensitivity = perTradeScores.filter((s) => s > 0.5).length;

  return {
    name: "market_sensitivity",
    score: Math.max(0, Math.min(1, score)),
    evidence:
      `${highSensitivity}/${trades.length} trades show strong market data engagement. ` +
      `Average sensitivity: ${(score * 100).toFixed(1)}%`,
    trendDirection: trend,
  };
}

/**
 * Dimension 4: Strategic Adaptability
 *
 * Measures whether the agent's strategy evolves over time or remains static.
 * Computed by tracking how the distribution of intents changes across the
 * first half vs. second half of the trade history.
 */
function scoreStrategicAdaptability(trades: TradeRecord[]): StrategyDimension {
  if (trades.length < 6) {
    return {
      name: "strategic_adaptability",
      score: 0.5,
      evidence: "Insufficient data (fewer than 6 trades) to measure adaptability",
      trendDirection: "stable",
    };
  }

  const mid = Math.floor(trades.length / 2);
  const firstHalf = trades.slice(0, mid);
  const secondHalf = trades.slice(mid);

  // Build intent distribution for each half
  const buildDist = (records: TradeRecord[]): Map<string, number> => {
    const dist = new Map<string, number>();
    for (const r of records) {
      const intent = normalizeIntent(r.intent);
      dist.set(intent, (dist.get(intent) ?? 0) + 1);
    }
    // Normalize to proportions
    for (const [key, count] of dist) {
      dist.set(key, count / records.length);
    }
    return dist;
  };

  const distFirst = buildDist(firstHalf);
  const distSecond = buildDist(secondHalf);

  // Compute Jensen-Shannon-style divergence (simplified) between the two distributions
  const allIntents = new Set([...distFirst.keys(), ...distSecond.keys()]);
  let divergence = 0;
  for (const intent of allIntents) {
    const p = distFirst.get(intent) ?? 0;
    const q = distSecond.get(intent) ?? 0;
    divergence += Math.abs(p - q);
  }
  // divergence ranges from 0 (identical) to 2 (completely different)
  // Normalize to 0-1 where higher = more adaptive
  const adaptabilityScore = Math.min(1, divergence / 1.5);

  // Also check confidence evolution (are they adjusting conviction levels?)
  const confFirst = firstHalf.map((t) => t.confidence);
  const confSecond = secondHalf.map((t) => t.confidence);
  const confShift = Math.abs(
    confFirst.reduce((s, v) => s + v, 0) / confFirst.length -
    confSecond.reduce((s, v) => s + v, 0) / confSecond.length,
  );

  const combinedScore = adaptabilityScore * 0.7 + Math.min(1, confShift * 3) * 0.3;

  // Compute per-window scores for trend detection
  const windowSize = Math.max(3, Math.floor(trades.length / 4));
  const windowScores: number[] = [];
  for (let i = 0; i + windowSize <= trades.length; i += windowSize) {
    const window = trades.slice(i, i + windowSize);
    const intents = new Set(window.map((t) => normalizeIntent(t.intent)));
    windowScores.push(Math.min(1, intents.size / 3));
  }
  const trend = detectTrend(windowScores);

  return {
    name: "strategic_adaptability",
    score: Math.max(0, Math.min(1, combinedScore)),
    evidence:
      `Intent distribution shift: ${(divergence * 100).toFixed(1)}% divergence between halves. ` +
      `Confidence shift: ${(confShift * 100).toFixed(1)}%. ` +
      `Unique intents: first half ${distFirst.size}, second half ${distSecond.size}`,
    trendDirection: trend,
  };
}

/**
 * Dimension 5: Information Utilization
 *
 * Measures what fraction of available data source types the agent actually
 * references. An agent that only ever cites "price" is less analytically
 * sophisticated than one citing price, volume, news, sentiment, and fundamentals.
 */
function scoreInformationUtilization(trades: TradeRecord[]): StrategyDimension {
  if (trades.length === 0) {
    return {
      name: "information_utilization",
      score: 0,
      evidence: "No trades to analyze",
      trendDirection: "stable",
    };
  }

  const perTradeScores: number[] = [];
  const globalSourceTypes = new Set<string>();

  for (const t of trades) {
    // Classify each cited source into a source type
    const tradeSourceTypes = new Set<string>();
    for (const src of t.sources) {
      const srcLower = src.toLowerCase();
      for (const knownType of KNOWN_SOURCE_TYPES) {
        if (srcLower.includes(knownType)) {
          tradeSourceTypes.add(knownType);
          globalSourceTypes.add(knownType);
        }
      }
      // If no known type matched, still count as a generic source
      if (tradeSourceTypes.size === 0 && src.trim().length > 0) {
        tradeSourceTypes.add("other");
        globalSourceTypes.add("other");
      }
    }

    // Also scan reasoning for source type references
    for (const knownType of KNOWN_SOURCE_TYPES) {
      if (t.reasoning.toLowerCase().includes(knownType)) {
        tradeSourceTypes.add(knownType);
        globalSourceTypes.add(knownType);
      }
    }

    const utilization = Math.min(1, tradeSourceTypes.size / 4);
    perTradeScores.push(utilization);
  }

  const score = perTradeScores.reduce((s, v) => s + v, 0) / perTradeScores.length;
  const trend = detectTrend(perTradeScores);

  return {
    name: "information_utilization",
    score: Math.max(0, Math.min(1, score)),
    evidence:
      `${globalSourceTypes.size}/${KNOWN_SOURCE_TYPES.length} source types used across all trades. ` +
      `Per-trade average: ${(score * 100).toFixed(1)}% utilization. ` +
      `Types seen: ${[...globalSourceTypes].sort().join(", ") || "none"}`,
    trendDirection: trend,
  };
}

// ---------------------------------------------------------------------------
// Intent-action consistency helper
// ---------------------------------------------------------------------------

/**
 * Compute how well an agent's stated intent matches its actual action.
 * For example, a "momentum" intent should correlate with buy actions when
 * the reasoning mentions upward trends, and sell when downward.
 */
function computeIntentConsistency(trades: TradeRecord[]): number {
  if (trades.length === 0) return 0.5;

  let consistent = 0;
  for (const t of trades) {
    const intent = normalizeIntent(t.intent);
    const reasoning = t.reasoning.toLowerCase();

    let isConsistent = false;

    switch (intent) {
      case "momentum":
        // Momentum + buy when reasoning mentions upward signals, or sell on downward
        isConsistent =
          (t.action === "buy" && /up|bull|gain|rise|rally|breakout|higher/i.test(reasoning)) ||
          (t.action === "sell" && /down|bear|drop|fall|decline|lower/i.test(reasoning)) ||
          t.action === "hold";
        break;
      case "value":
        // Value + buy when reasoning mentions undervalued / cheap
        isConsistent =
          (t.action === "buy" && /undervalue|cheap|discount|below.*value|bargain/i.test(reasoning)) ||
          (t.action === "sell" && /overvalue|expensive|premium|above.*value/i.test(reasoning)) ||
          t.action === "hold";
        break;
      case "hedge":
        // Hedge intent should mostly produce sell or hold actions
        isConsistent = t.action === "sell" || t.action === "hold";
        break;
      case "contrarian":
        // Hard to assess without consensus data; give benefit of doubt
        isConsistent = true;
        break;
      default:
        // For other intents, check if coherence score is above threshold
        isConsistent = t.coherenceScore >= 0.5;
        break;
    }

    if (isConsistent) consistent++;
  }

  return consistent / trades.length;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Record a trade for strategy profiling.
 *
 * Appends the trade to the agent's history (capped at MAX_RECORDS_PER_AGENT)
 * and triggers a profile recomputation so the profile stays current.
 *
 * @param agentId - Unique agent identifier
 * @param trade   - The trade record to ingest
 */
export function recordTradeForProfiling(
  agentId: string,
  trade: TradeRecord,
): void {
  const records = agentTradeRecords.get(agentId) ?? [];
  records.push(trade);

  // Evict oldest records if we exceed the cap
  if (records.length > MAX_RECORDS_PER_AGENT) {
    records.splice(0, records.length - MAX_RECORDS_PER_AGENT);
  }

  agentTradeRecords.set(agentId, records);

  // Recompute profile on every record to keep it fresh
  const profile = computeStrategyProfile(agentId);
  agentProfiles.set(agentId, profile);
}

/**
 * Compute a full strategy profile for the given agent based on all
 * recorded trades. Evaluates all five dimensions and derives aggregate
 * metrics including dominant strategy, flexibility, and intent consistency.
 *
 * @param agentId - Unique agent identifier
 * @returns Complete StrategyProfile with all dimensions scored
 */
export function computeStrategyProfile(agentId: string): StrategyProfile {
  const trades = agentTradeRecords.get(agentId) ?? [];

  // Score each dimension
  const dimensions: StrategyDimension[] = [
    scoreConvictionConsistency(trades),
    scoreRiskAwareness(trades),
    scoreMarketSensitivity(trades),
    scoreStrategicAdaptability(trades),
    scoreInformationUtilization(trades),
  ];

  // Weighted overall score
  const overallScore = dimensions.reduce((sum, dim) => {
    const weight = DIMENSION_WEIGHTS[dim.name] ?? 0.2;
    return sum + dim.score * weight;
  }, 0);

  // Dominant strategy: most frequent normalized intent
  const intentCounts = new Map<string, number>();
  for (const t of trades) {
    const intent = normalizeIntent(t.intent);
    intentCounts.set(intent, (intentCounts.get(intent) ?? 0) + 1);
  }
  let dominantStrategy = "unknown";
  let maxCount = 0;
  for (const [intent, count] of intentCounts) {
    if (count > maxCount) {
      maxCount = count;
      dominantStrategy = intent;
    }
  }

  // Strategic flexibility: Shannon entropy of intent distribution, normalized
  let flexibility = 0;
  if (trades.length > 0 && intentCounts.size > 1) {
    let entropy = 0;
    for (const count of intentCounts.values()) {
      const p = count / trades.length;
      if (p > 0) entropy -= p * Math.log2(p);
    }
    // Normalize by max possible entropy (log2 of number of distinct intents)
    const maxEntropy = Math.log2(intentCounts.size);
    flexibility = maxEntropy > 0 ? entropy / maxEntropy : 0;
  }

  // Intent-action consistency
  const consistencyWithStatedIntent = computeIntentConsistency(trades);

  const profile: StrategyProfile = {
    agentId,
    dimensions,
    overallScore: Math.max(0, Math.min(1, overallScore)),
    dominantStrategy,
    strategicFlexibility: Math.max(0, Math.min(1, flexibility)),
    consistencyWithStatedIntent: Math.max(0, Math.min(1, consistencyWithStatedIntent)),
    tradeCount: trades.length,
    lastUpdated: new Date().toISOString(),
  };

  agentProfiles.set(agentId, profile);
  return profile;
}

/**
 * Get the single pillar score for the Strategy Profiler dimension.
 *
 * Uses weighted averaging across the five dimensions:
 * - Conviction Consistency: 25%
 * - Risk Awareness: 20%
 * - Market Sensitivity: 20%
 * - Strategic Adaptability: 20%
 * - Information Utilization: 15%
 *
 * @param agentId - Unique agent identifier
 * @returns Pillar score 0-1 (defaults to 0.5 if no data)
 */
export function getStrategyPillarScore(agentId: string): number {
  const profile = agentProfiles.get(agentId);
  if (!profile) return 0.5;

  return profile.dimensions.reduce((sum, dim) => {
    const weight = DIMENSION_WEIGHTS[dim.name] ?? 0.2;
    return sum + dim.score * weight;
  }, 0);
}

/**
 * Retrieve all computed strategy profiles keyed by agent ID.
 *
 * @returns Record mapping agent IDs to their latest StrategyProfile
 */
export function getAllStrategyProfiles(): Record<string, StrategyProfile> {
  const result: Record<string, StrategyProfile> = {};
  for (const [id, profile] of agentProfiles) {
    result[id] = profile;
  }
  return result;
}

/**
 * Compute aggregate statistics across all profiled agents.
 *
 * Provides a high-level view of the agent population's strategic behavior,
 * including average scores, dominant strategy distribution, and per-dimension
 * averages useful for dashboard display.
 *
 * @returns Aggregate strategy statistics
 */
export function getStrategyStats(): {
  totalAgents: number;
  avgOverallScore: number;
  dominantStrategies: Record<string, number>;
  dimensionAverages: Record<string, number>;
} {
  const profiles = [...agentProfiles.values()];

  if (profiles.length === 0) {
    return {
      totalAgents: 0,
      avgOverallScore: 0,
      dominantStrategies: {},
      dimensionAverages: {},
    };
  }

  // Average overall score
  const avgOverallScore =
    profiles.reduce((s, p) => s + p.overallScore, 0) / profiles.length;

  // Count dominant strategies
  const dominantStrategies: Record<string, number> = {};
  for (const p of profiles) {
    dominantStrategies[p.dominantStrategy] =
      (dominantStrategies[p.dominantStrategy] ?? 0) + 1;
  }

  // Per-dimension averages across all agents
  const dimensionSums: Record<string, number> = {};
  const dimensionCounts: Record<string, number> = {};

  for (const p of profiles) {
    for (const dim of p.dimensions) {
      dimensionSums[dim.name] = (dimensionSums[dim.name] ?? 0) + dim.score;
      dimensionCounts[dim.name] = (dimensionCounts[dim.name] ?? 0) + 1;
    }
  }

  const dimensionAverages: Record<string, number> = {};
  for (const name of Object.keys(dimensionSums)) {
    dimensionAverages[name] = dimensionSums[name] / dimensionCounts[name];
  }

  return {
    totalAgents: profiles.length,
    avgOverallScore,
    dominantStrategies,
    dimensionAverages,
  };
}
