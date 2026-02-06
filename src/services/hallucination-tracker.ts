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

import { round2, round3 } from "../lib/math-utils.ts";

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

  const totalEvents = tradeAnalyses.filter((t) => t.hadHallucinations).length;
  const totalClean = tradeAnalyses.filter((t) => !t.hadHallucinations).length;
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
  const recent7 = agentTrades.slice(0, 7);
  const recent30 = agentTrades.slice(0, 30);

  const rolling7 = recent7.length > 0
    ? recent7.filter((t) => t.hadHallucinations).length / recent7.length
    : 0;
  const rolling30 = recent30.length > 0
    ? recent30.filter((t) => t.hadHallucinations).length / recent30.length
    : 0;
  const allTimeRate = totalTrades > 0 ? totalEvents / totalTrades : 0;
  const currentRate = rolling7;

  // Trend detection: compare recent 7 vs previous 7
  let trend: "improving" | "worsening" | "stable" = "stable";
  if (agentTrades.length >= 14) {
    const prev7 = agentTrades.slice(7, 14);
    const prevRate = prev7.length > 0
      ? prev7.filter((t) => t.hadHallucinations).length / prev7.length
      : 0;
    if (rolling7 < prevRate - 0.05) trend = "improving";
    else if (rolling7 > prevRate + 0.05) trend = "worsening";
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
    .filter(([, stats]) => stats.total >= 3 && stats.hallucinated > 0)
    .map(([symbol, stats]) => ({
      symbol,
      rate: round2(stats.hallucinated / stats.total),
    }))
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 5);

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
    price_hallucination: "Agent claimed a price that differs >20% from reality",
    unknown_ticker: "Agent referenced a stock ticker not in the available catalog",
    implausible_claim: "Agent claimed an implausible percentage change (>50% daily)",
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
