/**
 * Slippage Analyzer
 *
 * Tracks and analyzes the difference between expected and actual execution prices
 * for all trades on the MoltApp platform.
 *
 * Features:
 * - Record expected vs actual execution prices per trade
 * - Per-agent slippage analysis (which agent gets better fills)
 * - Per-stock slippage analysis (which stocks have higher slippage)
 * - Time-of-day slippage analysis (when is slippage worst)
 * - Slippage trend tracking (is slippage improving or worsening)
 * - P&L impact analysis (how much slippage costs in aggregate)
 * - Anomaly detection (flag unusually high slippage events)
 *
 * Storage: In-memory with configurable max retention.
 * Production would persist to DynamoDB.
 */

import { round2, averageAbsoluteByKey, countByCondition, findMax } from "../lib/math-utils.ts";
import { ID_RANDOM_START, ID_RANDOM_LENGTH_SHORT } from "../config/constants.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Slippage Analyzer Configuration Constants
 *
 * These constants control anomaly detection thresholds, data retention limits,
 * and statistical analysis parameters for execution quality monitoring.
 *
 * Tuning these constants enables systematic experimentation with slippage
 * detection sensitivity and data retention policies.
 */

// 1. Anomaly Detection Thresholds
/**
 * Warning-level slippage threshold in basis points (1% = 100bps).
 *
 * Trades with slippage exceeding this threshold are flagged as "warning" severity.
 * Set to 100bps (1%) to catch moderately high slippage events.
 *
 * Example: A trade with 150bps (1.5%) slippage triggers a warning alert.
 */
const ANOMALY_THRESHOLD_BPS = 100;

/**
 * Critical-level slippage threshold in basis points (3% = 300bps).
 *
 * Trades with slippage exceeding this threshold are flagged as "critical" severity.
 * Set to 300bps (3%) to catch extreme slippage events requiring investigation.
 *
 * Example: A trade with 350bps (3.5%) slippage triggers a critical alert.
 */
const CRITICAL_THRESHOLD_BPS = 300;

// 2. Data Retention Limits
/**
 * Maximum number of slippage records retained in memory.
 *
 * Older records are evicted when this limit is reached. Set to 10,000 to
 * balance memory usage with historical analysis depth (~1-2 weeks of data
 * at typical trading volumes).
 */
const MAX_SLIPPAGE_RECORDS = 10_000;

/**
 * Maximum number of anomaly records retained in memory.
 *
 * Older anomalies are evicted when this limit is reached. Set to 500 to
 * maintain a reasonable anomaly history without unbounded growth.
 */
const MAX_ANOMALY_RECORDS = 500;

// 3. Display/Query Limits
/**
 * Default maximum number of records returned by getSlippageAnomalies().
 *
 * Limits API response size to prevent overwhelming consumers. Set to 50
 * to show ~1 day of anomalies at typical trading volumes.
 */
const ANOMALIES_DISPLAY_LIMIT = 50;

/**
 * Default maximum number of records returned by getRecentSlippage().
 *
 * Limits API response size for recent slippage queries. Set to 100 to
 * show ~1-2 days of recent trades at typical trading volumes.
 */
const RECENT_SLIPPAGE_LIMIT = 100;

// 4. Statistical Analysis Parameters
/**
 * Percentile level for median calculation (50th percentile).
 *
 * Used in getSlippageStats() to compute median slippage.
 */
const PERCENTILE_MEDIAN = 50;

/**
 * Percentile level for 95th percentile calculation.
 *
 * Used in getSlippageStats() to identify high-end slippage outliers.
 */
const PERCENTILE_95 = 95;

/**
 * Percentile level for 99th percentile calculation.
 *
 * Used in getSlippageStats() to identify extreme slippage outliers.
 */
const PERCENTILE_99 = 99;

// 5. Calculation Conversion Constants
/**
 * Multiplier to convert decimal fraction to basis points (1% = 100bps).
 *
 * Formula: decimal × BPS_MULTIPLIER = basis points
 * Example: 0.0123 × 10,000 = 123bps (1.23%)
 *
 * Used throughout slippage calculations to express precision in basis points
 * rather than raw decimal fractions.
 */
const BPS_MULTIPLIER = 10_000;

/**
 * Multiplier to convert decimal fraction to percentage (0.5 = 50%).
 *
 * Formula: decimal × PERCENT_MULTIPLIER = percentage
 * Example: 0.75 × 100 = 75%
 *
 * Used for displaying favorable trade percentages and other ratio-based metrics.
 */
const PERCENT_MULTIPLIER = 100;

/**
 * Divisor to convert percentile value (0-100) to array fraction (0-1).
 *
 * Formula: percentile / PERCENTILE_DIVISOR = array fraction
 * Example: 95th percentile / 100 = 0.95 array position
 *
 * Used in percentile() helper function for statistical calculations.
 */
const PERCENTILE_DIVISOR = 100;

/**
 * Milliseconds in a 24-hour statistics window for recent slippage trend analysis.
 *
 * Formula: 24 hours × 60 minutes × 60 seconds × 1000 milliseconds = 86,400,000ms
 * Example: Date.now() - STATS_WINDOW_24H_MS = timestamp 24 hours ago
 *
 * Used in getSlippageStats to compute average slippage over the last 24 hours
 * (the "now24h" cutoff) for trend comparison alongside the all-time average.
 */
const STATS_WINDOW_24H_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SlippageRecord {
  id: string;
  timestamp: string;
  agentId: string;
  agentName: string;
  symbol: string;
  action: "buy" | "sell";
  /** Expected price at time of decision (from Jupiter quote) */
  expectedPrice: number;
  /** Actual execution price (from filled trade) */
  actualPrice: number;
  /** Absolute slippage in USD */
  slippageUsd: number;
  /** Slippage as percentage of expected price */
  slippageBps: number;
  /** Trade quantity */
  quantity: number;
  /** Total slippage impact in USD (slippageUsd * quantity) */
  totalImpactUsd: number;
  /** Was this considered favorable (got better price than expected) */
  favorable: boolean;
  /** Jupiter request ID */
  jupiterRequestId?: string;
  /** Transaction signature */
  txSignature?: string;
  /** Trading round ID */
  roundId?: string;
  /** Market session at time of trade */
  marketSession?: string;
}

export interface SlippageStats {
  totalTrades: number;
  avgSlippageBps: number;
  medianSlippageBps: number;
  maxSlippageBps: number;
  minSlippageBps: number;
  p95SlippageBps: number;
  p99SlippageBps: number;
  totalSlippageCostUsd: number;
  favorableTradesPercent: number;
  /** Average slippage over the last 24 hours */
  avg24hSlippageBps: number;
  /** Slippage trend (positive = worsening, negative = improving) */
  trendBps: number;
}

export interface AgentSlippageProfile {
  agentId: string;
  agentName: string;
  totalTrades: number;
  avgSlippageBps: number;
  totalSlippageCostUsd: number;
  favorablePercent: number;
  worstSlippage: {
    symbol: string;
    slippageBps: number;
    timestamp: string;
  } | null;
  bestSlippage: {
    symbol: string;
    slippageBps: number;
    timestamp: string;
  } | null;
}

export interface StockSlippageProfile {
  symbol: string;
  totalTrades: number;
  avgSlippageBps: number;
  maxSlippageBps: number;
  totalSlippageCostUsd: number;
  buySlippageBps: number;
  sellSlippageBps: number;
  /** Slippage by time of day (ET hour -> avg bps) */
  byHour: Record<number, number>;
}

export interface SlippageAnomaly {
  record: SlippageRecord;
  reason: string;
  severity: "warning" | "critical";
  threshold: number;
  actual: number;
}

export interface SlippageAnalyzerConfig {
  /** Maximum number of records to retain in memory */
  maxRecords: number;
  /** Threshold (in bps) above which slippage is flagged as anomalous */
  anomalyThresholdBps: number;
  /** Critical threshold (in bps) */
  criticalThresholdBps: number;
  /** Enable/disable anomaly detection */
  anomalyDetectionEnabled: boolean;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const records: SlippageRecord[] = [];
const anomalies: SlippageAnomaly[] = [];

let analyzerConfig: SlippageAnalyzerConfig = {
  maxRecords: MAX_SLIPPAGE_RECORDS,
  anomalyThresholdBps: ANOMALY_THRESHOLD_BPS,
  criticalThresholdBps: CRITICAL_THRESHOLD_BPS,
  anomalyDetectionEnabled: true,
};

// ---------------------------------------------------------------------------
// Record Slippage
// ---------------------------------------------------------------------------

/**
 * Record a slippage observation from a completed trade.
 *
 * Call this after every trade execution with the expected (quoted)
 * and actual (filled) prices.
 */
export function recordSlippage(params: {
  agentId: string;
  agentName: string;
  symbol: string;
  action: "buy" | "sell";
  expectedPrice: number;
  actualPrice: number;
  quantity: number;
  jupiterRequestId?: string;
  txSignature?: string;
  roundId?: string;
  marketSession?: string;
}): SlippageRecord {
  const {
    agentId,
    agentName,
    symbol,
    action,
    expectedPrice,
    actualPrice,
    quantity,
  } = params;

  // Calculate slippage
  // For buys: positive slippage = paid more than expected (bad)
  // For sells: positive slippage = received less than expected (bad)
  let slippageUsd: number;
  if (action === "buy") {
    slippageUsd = actualPrice - expectedPrice;
  } else {
    slippageUsd = expectedPrice - actualPrice;
  }

  // favorable = got a better price than expected
  const favorable = slippageUsd < 0;

  // Use signed bps for the record (negative = favorable)
  const signedBps =
    expectedPrice > 0
      ? Math.round((slippageUsd / expectedPrice) * BPS_MULTIPLIER)
      : 0;

  const totalImpactUsd = Math.abs(slippageUsd) * quantity;

  const record: SlippageRecord = {
    id: `slip_${Date.now()}_${Math.random().toString(36).slice(ID_RANDOM_START, ID_RANDOM_START + ID_RANDOM_LENGTH_SHORT)}`,
    timestamp: new Date().toISOString(),
    agentId,
    agentName,
    symbol,
    action,
    expectedPrice,
    actualPrice,
    slippageUsd: Math.abs(slippageUsd),
    slippageBps: signedBps,
    quantity,
    totalImpactUsd,
    favorable,
    jupiterRequestId: params.jupiterRequestId,
    txSignature: params.txSignature,
    roundId: params.roundId,
    marketSession: params.marketSession,
  };

  // Store record
  records.unshift(record);
  if (records.length > analyzerConfig.maxRecords) {
    records.length = analyzerConfig.maxRecords;
  }

  // Anomaly detection
  if (analyzerConfig.anomalyDetectionEnabled) {
    detectAnomalies(record);
  }

  console.log(
    `[SlippageAnalyzer] Recorded: ${agentName} ${action} ${symbol} — ` +
      `expected=$${expectedPrice.toFixed(4)}, actual=$${actualPrice.toFixed(4)}, ` +
      `slippage=${signedBps}bps (${favorable ? "favorable" : "unfavorable"})`,
  );

  return record;
}

// ---------------------------------------------------------------------------
// Aggregate Statistics
// ---------------------------------------------------------------------------

/**
 * Get overall slippage statistics.
 */
export function getSlippageStats(since?: Date): SlippageStats {
  const filtered = since
    ? records.filter((r) => new Date(r.timestamp) >= since)
    : records;

  if (filtered.length === 0) {
    return {
      totalTrades: 0,
      avgSlippageBps: 0,
      medianSlippageBps: 0,
      maxSlippageBps: 0,
      minSlippageBps: 0,
      p95SlippageBps: 0,
      p99SlippageBps: 0,
      totalSlippageCostUsd: 0,
      favorableTradesPercent: 0,
      avg24hSlippageBps: 0,
      trendBps: 0,
    };
  }

  const bpsValues = filtered.map((r) => Math.abs(r.slippageBps));
  bpsValues.sort((a, b) => a - b);

  const totalSlippageCostUsd = filtered.reduce(
    (sum, r) => sum + r.totalImpactUsd,
    0,
  );
  const favorableCount = countByCondition(filtered, (r) => r.favorable);

  // 24-hour stats
  const now24h = new Date(Date.now() - STATS_WINDOW_24H_MS);
  const last24h = filtered.filter((r) => new Date(r.timestamp) >= now24h);
  const avg24h = averageAbsoluteByKey(last24h, 'slippageBps');

  // Trend: compare first half vs second half average slippage
  const halfIdx = Math.floor(filtered.length / 2);
  const firstHalf = filtered.slice(halfIdx);
  const secondHalf = filtered.slice(0, halfIdx);
  const firstAvg = averageAbsoluteByKey(firstHalf, 'slippageBps');
  const secondAvg = averageAbsoluteByKey(secondHalf, 'slippageBps');
  const trendBps = Math.round(secondAvg - firstAvg);

  return {
    totalTrades: filtered.length,
    avgSlippageBps: Math.round(
      bpsValues.reduce((a, b) => a + b, 0) / bpsValues.length,
    ),
    medianSlippageBps: percentile(bpsValues, PERCENTILE_MEDIAN),
    maxSlippageBps: bpsValues[bpsValues.length - 1],
    minSlippageBps: bpsValues[0],
    p95SlippageBps: percentile(bpsValues, PERCENTILE_95),
    p99SlippageBps: percentile(bpsValues, PERCENTILE_99),
    totalSlippageCostUsd: round2(totalSlippageCostUsd),
    favorableTradesPercent: Math.round(
      (favorableCount / filtered.length) * PERCENT_MULTIPLIER,
    ),
    avg24hSlippageBps: Math.round(avg24h),
    trendBps,
  };
}

/**
 * Get slippage profile per agent.
 */
export function getAgentSlippageProfiles(): AgentSlippageProfile[] {
  const agentMap = new Map<
    string,
    { agentName: string; records: SlippageRecord[] }
  >();

  for (const r of records) {
    const existing = agentMap.get(r.agentId);
    if (existing) {
      existing.records.push(r);
    } else {
      agentMap.set(r.agentId, { agentName: r.agentName, records: [r] });
    }
  }

  const profiles: AgentSlippageProfile[] = [];

  for (const [agentId, data] of agentMap) {
    const agentRecords = data.records;
    const totalCost = agentRecords.reduce(
      (sum, r) => sum + r.totalImpactUsd,
      0,
    );
    const favorableCount = countByCondition(agentRecords, (r) => r.favorable);
    const avgBps = averageAbsoluteByKey(agentRecords, 'slippageBps');

    // Find worst and best slippage
    const sorted = [...agentRecords].sort(
      (a, b) => Math.abs(b.slippageBps) - Math.abs(a.slippageBps),
    );
    const worstRecord = sorted[0];
    const bestSorted = [...agentRecords].sort(
      (a, b) => Math.abs(a.slippageBps) - Math.abs(b.slippageBps),
    );
    const bestRecord = bestSorted[0];

    profiles.push({
      agentId,
      agentName: data.agentName,
      totalTrades: agentRecords.length,
      avgSlippageBps: Math.round(avgBps),
      totalSlippageCostUsd: round2(totalCost),
      favorablePercent: Math.round(
        (favorableCount / agentRecords.length) * PERCENT_MULTIPLIER,
      ),
      worstSlippage: worstRecord
        ? {
            symbol: worstRecord.symbol,
            slippageBps: worstRecord.slippageBps,
            timestamp: worstRecord.timestamp,
          }
        : null,
      bestSlippage: bestRecord
        ? {
            symbol: bestRecord.symbol,
            slippageBps: bestRecord.slippageBps,
            timestamp: bestRecord.timestamp,
          }
        : null,
    });
  }

  return profiles.sort((a, b) => a.avgSlippageBps - b.avgSlippageBps);
}

/**
 * Get slippage profile per stock.
 */
export function getStockSlippageProfiles(): StockSlippageProfile[] {
  const stockMap = new Map<string, SlippageRecord[]>();

  for (const r of records) {
    const existing = stockMap.get(r.symbol) ?? [];
    existing.push(r);
    stockMap.set(r.symbol, existing);
  }

  const profiles: StockSlippageProfile[] = [];

  for (const [symbol, stockRecords] of stockMap) {
    const totalCost = stockRecords.reduce(
      (sum, r) => sum + r.totalImpactUsd,
      0,
    );
    const avgBps = stockRecords.length > 0
      ? stockRecords.reduce((sum, r) => sum + Math.abs(r.slippageBps), 0) / stockRecords.length
      : 0;
    const absBpsValues = stockRecords.map((r: SlippageRecord) => ({ value: Math.abs(r.slippageBps) }));
    const maxBps = findMax(absBpsValues, 'value')?.value ?? 0;

    const buys = stockRecords.filter((r) => r.action === "buy");
    const sells = stockRecords.filter((r) => r.action === "sell");

    const buyBps = buys.length > 0
      ? buys.reduce((sum, r) => sum + Math.abs(r.slippageBps), 0) / buys.length
      : 0;
    const sellBps = sells.length > 0
      ? sells.reduce((sum, r) => sum + Math.abs(r.slippageBps), 0) / sells.length
      : 0;

    // By hour of day
    const byHour: Record<number, { total: number; count: number }> = {};
    for (const r of stockRecords) {
      // Parse hour from timestamp (approximate — doesn't handle timezone perfectly)
      const hour = new Date(r.timestamp).getHours();
      if (!byHour[hour]) {
        byHour[hour] = { total: 0, count: 0 };
      }
      byHour[hour].total += Math.abs(r.slippageBps);
      byHour[hour].count++;
    }

    const byHourAvg: Record<number, number> = {};
    for (const [h, data] of Object.entries(byHour)) {
      byHourAvg[Number(h)] = Math.round(data.total / data.count);
    }

    profiles.push({
      symbol,
      totalTrades: stockRecords.length,
      avgSlippageBps: Math.round(avgBps),
      maxSlippageBps: maxBps,
      totalSlippageCostUsd: round2(totalCost),
      buySlippageBps: Math.round(buyBps),
      sellSlippageBps: Math.round(sellBps),
      byHour: byHourAvg,
    });
  }

  return profiles.sort((a, b) => b.avgSlippageBps - a.avgSlippageBps);
}

// ---------------------------------------------------------------------------
// Anomaly Detection
// ---------------------------------------------------------------------------

function detectAnomalies(record: SlippageRecord): void {
  const absBps = Math.abs(record.slippageBps);

  if (absBps >= analyzerConfig.criticalThresholdBps) {
    const anomaly: SlippageAnomaly = {
      record,
      reason: `Critical slippage: ${absBps}bps exceeds ${analyzerConfig.criticalThresholdBps}bps threshold`,
      severity: "critical",
      threshold: analyzerConfig.criticalThresholdBps,
      actual: absBps,
    };
    anomalies.unshift(anomaly);
    console.error(
      `[SlippageAnalyzer] CRITICAL anomaly: ${record.agentName} ${record.action} ${record.symbol} — ${absBps}bps slippage`,
    );
  } else if (absBps >= analyzerConfig.anomalyThresholdBps) {
    const anomaly: SlippageAnomaly = {
      record,
      reason: `High slippage: ${absBps}bps exceeds ${analyzerConfig.anomalyThresholdBps}bps threshold`,
      severity: "warning",
      threshold: analyzerConfig.anomalyThresholdBps,
      actual: absBps,
    };
    anomalies.unshift(anomaly);
    console.warn(
      `[SlippageAnalyzer] WARNING anomaly: ${record.agentName} ${record.action} ${record.symbol} — ${absBps}bps slippage`,
    );
  }

  // Keep anomalies bounded
  if (anomalies.length > MAX_ANOMALY_RECORDS) {
    anomalies.length = MAX_ANOMALY_RECORDS;
  }
}

/**
 * Get recent slippage anomalies.
 */
export function getSlippageAnomalies(
  limit = ANOMALIES_DISPLAY_LIMIT,
  severity?: "warning" | "critical",
): SlippageAnomaly[] {
  const filtered = severity
    ? anomalies.filter((a) => a.severity === severity)
    : anomalies;
  return filtered.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Recent Records
// ---------------------------------------------------------------------------

/**
 * Get recent slippage records with optional filtering.
 */
export function getRecentSlippage(params?: {
  agentId?: string;
  symbol?: string;
  action?: "buy" | "sell";
  limit?: number;
  since?: Date;
}): SlippageRecord[] {
  let filtered = records;

  if (params?.agentId) {
    filtered = filtered.filter((r) => r.agentId === params.agentId);
  }
  if (params?.symbol) {
    filtered = filtered.filter((r) => r.symbol === params.symbol);
  }
  if (params?.action) {
    filtered = filtered.filter((r) => r.action === params.action);
  }
  if (params?.since) {
    filtered = filtered.filter(
      (r) => new Date(r.timestamp) >= params.since!,
    );
  }

  return filtered.slice(0, params?.limit ?? RECENT_SLIPPAGE_LIMIT);
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Update slippage analyzer configuration.
 */
export function configureSlippageAnalyzer(
  updates: Partial<SlippageAnalyzerConfig>,
): SlippageAnalyzerConfig {
  analyzerConfig = { ...analyzerConfig, ...updates };
  console.log(
    `[SlippageAnalyzer] Config updated: anomalyThreshold=${analyzerConfig.anomalyThresholdBps}bps, ` +
      `critical=${analyzerConfig.criticalThresholdBps}bps, maxRecords=${analyzerConfig.maxRecords}`,
  );
  return analyzerConfig;
}

/**
 * Get current slippage analyzer configuration.
 */
export function getSlippageAnalyzerConfig(): SlippageAnalyzerConfig {
  return { ...analyzerConfig };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const idx = Math.ceil((p / PERCENTILE_DIVISOR) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, Math.min(idx, sortedValues.length - 1))];
}
