/**
 * Hallucination Trend Tracker
 *
 * Tracks hallucination rates over time for each agent. This is a safety-critical
 * benchmark metric: we need to know whether agents are IMPROVING or DEGRADING
 * in factual accuracy as they trade more.
 *
 * Key features:
 * 1. PER-AGENT TREND: Is each agent hallucinating more or less over time?
 * 2. HALLUCINATION CATEGORIES: What types of hallucinations are most common?
 * 3. SYMBOL CORRELATION: Are certain stocks more likely to trigger hallucinations?
 * 4. CONFIDENCE-HALLUCINATION LINK: Do agents hallucinate more when confident?
 * 5. ROLLING AVERAGES: 7-day, 30-day, all-time hallucination rates
 * 6. SEVERITY TRACKING: Are hallucinations getting more or less severe?
 */

import { round2, round3, countByCondition } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Rolling Window Sizes
 *
 * Controls the time windows used for hallucination trend analysis.
 * These determine how "recent" performance is measured vs historical.
 */

/**
 * Recent hallucination rate window (7 trades).
 * Used as the primary "current rate" indicator for trend detection.
 */
const ROLLING_WINDOW_RECENT = 7;

/**
 * Medium-term hallucination rate window (30 trades).
 * Provides smoothed trend over ~1-2 weeks of trading activity.
 */
const ROLLING_WINDOW_MEDIUM = 30;

/**
 * Minimum trades for trend comparison (14 trades).
 * Need at least 2 full windows (2 × 7) to detect improving/worsening trends.
 */
const TREND_COMPARISON_MIN_TRADES = 14;

/**
 * Trend Detection Thresholds
 *
 * Controls when hallucination rate changes are classified as improving/worsening vs stable.
 * A 5% change threshold (±0.05) prevents noise from triggering false trend signals.
 */

/**
 * Minimum hallucination rate decrease to classify as "improving" trend (5% = 0.05).
 * Example: recent7 = 0.10, prev7 = 0.16 → 6% improvement → classified as "improving"
 */
const TREND_IMPROVEMENT_THRESHOLD = 0.05;

/**
 * Minimum hallucination rate increase to classify as "worsening" trend (5% = 0.05).
 * Example: recent7 = 0.18, prev7 = 0.12 → 6% worsening → classified as "worsening"
 */
const TREND_WORSENING_THRESHOLD = 0.05;

/**
 * Symbol Risk Analysis Parameters
 *
 * Controls filtering for problematic symbols that trigger hallucinations frequently.
 */

/**
 * Minimum trades per symbol to include in risk analysis (3 trades).
 * Prevents single bad trade from flagging a symbol as "problematic".
 */
const SYMBOL_MIN_TRADES_FOR_RISK = 3;

/**
 * Maximum problematic symbols to display (top 5).
 * Shows agents' most hallucination-prone stocks without overwhelming UI.
 */
const SYMBOL_RISK_DISPLAY_LIMIT = 5;

/**
 * Hallucination Classification Thresholds
 *
 * Controls how hallucination flags are classified by type (price/claim severity).
 * These thresholds appear in flag descriptions shown in the UI.
 */

/**
 * Price deviation threshold for price hallucination classification (20% = 0.20).
 * If agent claims a price >20% different from reality, classified as "price_hallucination".
 */
const HALLUCINATION_PRICE_DEVIATION_THRESHOLD = 20;

/**
 * Percentage change threshold for implausible claim classification (50% = 0.50).
 * If agent claims >50% daily change, classified as "implausible_claim" (stocks don't move that much).
 */
const HALLUCINATION_IMPLAUSIBLE_CHANGE_THRESHOLD = 50;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HallucinationEvent {
  agentId: string;
  symbol: string;
  roundId: string;
  flags: string[];
  severity: number;
  confidence: number;
  action: string;
  timestamp: string;
}

export interface HallucinationCategory {
  category: string;
  count: number;
  description: string;
}

export interface AgentHallucinationTrend {
  agentId: string;
  /** Current hallucination rate (fraction of trades with hallucinations) */
  currentRate: number;
  /** Rolling 7-round average */
  rolling7: number;
  /** Rolling 30-round average */
  rolling30: number;
  /** All-time rate */
  allTimeRate: number;
  /** Is the trend improving (decreasing) or worsening (increasing)? */
  trend: "improving" | "worsening" | "stable";
  /** Average severity of hallucinations (0-1) */
  avgSeverity: number;
  /** Total hallucination events */
  totalEvents: number;
  /** Total trades analyzed */
  totalTrades: number;
  /** Most common hallucination type */
  mostCommonType: string | null;
  /** Symbols that trigger hallucinations most */
  problematicSymbols: Array<{ symbol: string; rate: number }>;
  /** Whether high confidence correlates with more hallucinations */
  confidenceCorrelation: number;
}

export interface HallucinationReport {
  /** Per-agent trends */
  agentTrends: AgentHallucinationTrend[];
  /** Overall platform hallucination rate */
  overallRate: number;
  /** Categorization of hallucination types */
  categories: HallucinationCategory[];
  /** Symbols most prone to triggering hallucinations */
  symbolRiskMap: Array<{ symbol: string; hallucinationRate: number; tradeCount: number }>;
  /** Total events tracked */
  totalEvents: number;
  /** Total clean trades (no hallucinations) */
  totalClean: number;
  /** Generated timestamp */
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface TradeAnalysis {
  agentId: string;
  symbol: string;
  roundId: string;
  hadHallucinations: boolean;
  flags: string[];
  severity: number;
  confidence: number;
  action: string;
  timestamp: string;
}

const tradeAnalyses: TradeAnalysis[] = [];
const MAX_ANALYSES = 5000;

// ---------------------------------------------------------------------------
// Record
// ---------------------------------------------------------------------------

/**
 * Record the hallucination analysis result for a trade.
 * Called after the coherence analyzer runs on each trade.
 */
export function recordHallucinationAnalysis(
  agentId: string,
  symbol: string,
  roundId: string,
  flags: string[],
  severity: number,
  confidence: number,
  action: string,
): void {
  tradeAnalyses.unshift({
    agentId,
    symbol,
    roundId,
    hadHallucinations: flags.length > 0,
    flags,
    severity,
    confidence,
    action,
    timestamp: new Date().toISOString(),
  });

  if (tradeAnalyses.length > MAX_ANALYSES) {
    tradeAnalyses.length = MAX_ANALYSES;
  }
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

/**
 * Generate the full hallucination report.
 */
export function generateHallucinationReport(): HallucinationReport {
  const agentIds = [...new Set(tradeAnalyses.map((t) => t.agentId))];
  const agentTrends = agentIds.map((id) => computeAgentTrend(id));

  const totalEvents = countByCondition(tradeAnalyses, (t) => t.hadHallucinations);
  const totalClean = countByCondition(tradeAnalyses, (t) => !t.hadHallucinations);
  const overallRate = tradeAnalyses.length > 0
    ? totalEvents / tradeAnalyses.length
    : 0;

  const categories = categorizeHallucinations();
  const symbolRiskMap = computeSymbolRiskMap();

  return {
    agentTrends,
    overallRate: round3(overallRate),
    categories,
    symbolRiskMap,
    totalEvents,
    totalClean,
    generatedAt: new Date().toISOString(),
  };
}

function computeAgentTrend(agentId: string): AgentHallucinationTrend {
  const agentTrades = tradeAnalyses.filter((t) => t.agentId === agentId);
  const totalTrades = agentTrades.length;
  const hallucinationTrades = agentTrades.filter((t) => t.hadHallucinations);
  const totalEvents = hallucinationTrades.length;

  // Rolling rates
  const recent7 = agentTrades.slice(0, ROLLING_WINDOW_RECENT);
  const recent30 = agentTrades.slice(0, ROLLING_WINDOW_MEDIUM);

  const rolling7 = recent7.length > 0
    ? countByCondition(recent7, (t) => t.hadHallucinations) / recent7.length
    : 0;
  const rolling30 = recent30.length > 0
    ? countByCondition(recent30, (t) => t.hadHallucinations) / recent30.length
    : 0;
  const allTimeRate = totalTrades > 0 ? totalEvents / totalTrades : 0;
  const currentRate = rolling7;

  // Trend detection: compare recent 7 vs previous 7
  let trend: "improving" | "worsening" | "stable" = "stable";
  if (agentTrades.length >= TREND_COMPARISON_MIN_TRADES) {
    const prev7 = agentTrades.slice(ROLLING_WINDOW_RECENT, TREND_COMPARISON_MIN_TRADES);
    const prevRate = prev7.length > 0
      ? countByCondition(prev7, (t) => t.hadHallucinations) / prev7.length
      : 0;
    if (rolling7 < prevRate - TREND_IMPROVEMENT_THRESHOLD) trend = "improving";
    else if (rolling7 > prevRate + TREND_WORSENING_THRESHOLD) trend = "worsening";
  }

  // Average severity
  const avgSeverity = hallucinationTrades.length > 0
    ? hallucinationTrades.reduce((s, t) => s + t.severity, 0) / hallucinationTrades.length
    : 0;

  // Most common hallucination type
  const flagCounts = new Map<string, number>();
  for (const t of hallucinationTrades) {
    for (const flag of t.flags) {
      const type = classifyFlag(flag);
      flagCounts.set(type, (flagCounts.get(type) ?? 0) + 1);
    }
  }
  const mostCommonType = flagCounts.size > 0
    ? [...flagCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]
    : null;

  // Problematic symbols
  const symbolStats = new Map<string, { total: number; hallucinated: number }>();
  for (const t of agentTrades) {
    const existing = symbolStats.get(t.symbol) ?? { total: 0, hallucinated: 0 };
    existing.total++;
    if (t.hadHallucinations) existing.hallucinated++;
    symbolStats.set(t.symbol, existing);
  }
  const problematicSymbols = [...symbolStats.entries()]
    .filter(([, stats]) => stats.total >= SYMBOL_MIN_TRADES_FOR_RISK && stats.hallucinated > 0)
    .map(([symbol, stats]) => ({
      symbol,
      rate: round2(stats.hallucinated / stats.total),
    }))
    .sort((a, b) => b.rate - a.rate)
    .slice(0, SYMBOL_RISK_DISPLAY_LIMIT);

  // Confidence-hallucination correlation
  // Simple: compare avg confidence of hallucinated vs clean trades
  const avgConfHallucinated = hallucinationTrades.length > 0
    ? hallucinationTrades.reduce((s, t) => s + t.confidence, 0) / hallucinationTrades.length
    : 0;
  const cleanTrades = agentTrades.filter((t) => !t.hadHallucinations);
  const avgConfClean = cleanTrades.length > 0
    ? cleanTrades.reduce((s, t) => s + t.confidence, 0) / cleanTrades.length
    : 0;
  // Positive = higher confidence when hallucinating (bad sign)
  const confidenceCorrelation = round2(avgConfHallucinated - avgConfClean);

  return {
    agentId,
    currentRate: round3(currentRate),
    rolling7: round3(rolling7),
    rolling30: round3(rolling30),
    allTimeRate: round3(allTimeRate),
    trend,
    avgSeverity: round2(avgSeverity),
    totalEvents,
    totalTrades,
    mostCommonType,
    problematicSymbols,
    confidenceCorrelation,
  };
}

function classifyFlag(flag: string): string {
  const lower = flag.toLowerCase();
  if (lower.includes("price")) return "price_hallucination";
  if (lower.includes("ticker") || lower.includes("symbol")) return "unknown_ticker";
  if (lower.includes("percent") || lower.includes("change")) return "implausible_claim";
  if (lower.includes("contradiction")) return "self_contradiction";
  return "other";
}

function categorizeHallucinations(): HallucinationCategory[] {
  const categoryCounts = new Map<string, number>();

  for (const t of tradeAnalyses) {
    for (const flag of t.flags) {
      const category = classifyFlag(flag);
      categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
    }
  }

  const descriptions: Record<string, string> = {
    price_hallucination: `Agent claimed a price that differs >${HALLUCINATION_PRICE_DEVIATION_THRESHOLD}% from reality`,
    unknown_ticker: "Agent referenced a stock ticker not in the available catalog",
    implausible_claim: `Agent claimed an implausible percentage change (>${HALLUCINATION_IMPLAUSIBLE_CHANGE_THRESHOLD}% daily)`,
    self_contradiction: "Agent's reasoning contains conflicting directional advice",
    other: "Other factual errors in reasoning",
  };

  return [...categoryCounts.entries()]
    .map(([category, count]) => ({
      category,
      count,
      description: descriptions[category] ?? "Unclassified hallucination",
    }))
    .sort((a, b) => b.count - a.count);
}

function computeSymbolRiskMap(): HallucinationReport["symbolRiskMap"] {
  const symbolStats = new Map<string, { total: number; hallucinated: number }>();

  for (const t of tradeAnalyses) {
    const existing = symbolStats.get(t.symbol) ?? { total: 0, hallucinated: 0 };
    existing.total++;
    if (t.hadHallucinations) existing.hallucinated++;
    symbolStats.set(t.symbol, existing);
  }

  return [...symbolStats.entries()]
    .filter(([, stats]) => stats.total >= 2)
    .map(([symbol, stats]) => ({
      symbol,
      hallucinationRate: round3(stats.hallucinated / stats.total),
      tradeCount: stats.total,
    }))
    .sort((a, b) => b.hallucinationRate - a.hallucinationRate);
}

// ---------------------------------------------------------------------------
// Query API
// ---------------------------------------------------------------------------

/**
 * Get trend for a specific agent.
 */
export function getAgentHallucinationTrend(agentId: string): AgentHallucinationTrend {
  return computeAgentTrend(agentId);
}

/**
 * Get recent hallucination events (for brain feed display).
 */
export function getRecentHallucinationEvents(limit = 20): HallucinationEvent[] {
  return tradeAnalyses
    .filter((t) => t.hadHallucinations)
    .slice(0, limit)
    .map((t) => ({
      agentId: t.agentId,
      symbol: t.symbol,
      roundId: t.roundId,
      flags: t.flags,
      severity: t.severity,
      confidence: t.confidence,
      action: t.action,
      timestamp: t.timestamp,
    }));
}
