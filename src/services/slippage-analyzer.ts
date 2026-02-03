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
  maxRecords: 10_000,
  anomalyThresholdBps: 100, // 1% slippage = warning
  criticalThresholdBps: 300, // 3% slippage = critical
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

  const slippageBps =
    expectedPrice > 0
      ? Math.round((Math.abs(slippageUsd) / expectedPrice) * 10_000)
      : 0;

  // Positive bps = unfavorable, negative not possible (we use absolute for bps)
  // favorable = got a better price than expected
  const favorable = slippageUsd < 0;

  // Use signed bps for the record (negative = favorable)
  const signedBps =
    expectedPrice > 0
      ? Math.round((slippageUsd / expectedPrice) * 10_000)
      : 0;

  const totalImpactUsd = Math.abs(slippageUsd) * quantity;

  const record: SlippageRecord = {
    id: `slip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
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
  const favorableCount = filtered.filter((r) => r.favorable).length;

  // 24-hour stats
  const now24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const last24h = filtered.filter((r) => new Date(r.timestamp) >= now24h);
  const avg24h =
    last24h.length > 0
      ? last24h.reduce((sum, r) => sum + Math.abs(r.slippageBps), 0) /
        last24h.length
      : 0;

  // Trend: compare first half vs second half average slippage
  const halfIdx = Math.floor(filtered.length / 2);
  const firstHalf = filtered.slice(halfIdx);
  const secondHalf = filtered.slice(0, halfIdx);
  const firstAvg =
    firstHalf.length > 0
      ? firstHalf.reduce((s, r) => s + Math.abs(r.slippageBps), 0) /
        firstHalf.length
      : 0;
  const secondAvg =
    secondHalf.length > 0
      ? secondHalf.reduce((s, r) => s + Math.abs(r.slippageBps), 0) /
        secondHalf.length
      : 0;
  const trendBps = Math.round(secondAvg - firstAvg);

  return {
    totalTrades: filtered.length,
    avgSlippageBps: Math.round(
      bpsValues.reduce((a, b) => a + b, 0) / bpsValues.length,
    ),
    medianSlippageBps: percentile(bpsValues, 50),
    maxSlippageBps: bpsValues[bpsValues.length - 1],
    minSlippageBps: bpsValues[0],
    p95SlippageBps: percentile(bpsValues, 95),
    p99SlippageBps: percentile(bpsValues, 99),
    totalSlippageCostUsd: Math.round(totalSlippageCostUsd * 100) / 100,
    favorableTradesPercent: Math.round(
      (favorableCount / filtered.length) * 100,
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
    const favorableCount = agentRecords.filter((r) => r.favorable).length;
    const avgBps =
      agentRecords.reduce((sum, r) => sum + Math.abs(r.slippageBps), 0) /
      agentRecords.length;

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
      totalSlippageCostUsd: Math.round(totalCost * 100) / 100,
      favorablePercent: Math.round(
        (favorableCount / agentRecords.length) * 100,
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
    const avgBps =
      stockRecords.reduce((sum, r) => sum + Math.abs(r.slippageBps), 0) /
      stockRecords.length;
    const maxBps = Math.max(...stockRecords.map((r) => Math.abs(r.slippageBps)));

    const buys = stockRecords.filter((r) => r.action === "buy");
    const sells = stockRecords.filter((r) => r.action === "sell");

    const buyBps =
      buys.length > 0
        ? buys.reduce((sum, r) => sum + Math.abs(r.slippageBps), 0) /
          buys.length
        : 0;
    const sellBps =
      sells.length > 0
        ? sells.reduce((sum, r) => sum + Math.abs(r.slippageBps), 0) /
          sells.length
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
      totalSlippageCostUsd: Math.round(totalCost * 100) / 100,
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
  if (anomalies.length > 500) {
    anomalies.length = 500;
  }
}

/**
 * Get recent slippage anomalies.
 */
export function getSlippageAnomalies(
  limit = 50,
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

  return filtered.slice(0, params?.limit ?? 100);
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
  const idx = Math.ceil((p / 100) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, Math.min(idx, sortedValues.length - 1))];
}
