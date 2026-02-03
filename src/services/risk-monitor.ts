/**
 * Real-Time Risk Monitor
 *
 * Continuous monitoring of portfolio health, position integrity, and
 * anomaly detection. This is the "second pair of eyes" that catches
 * issues the circuit breakers might miss.
 *
 * Features:
 * - Position Reconciliation: compare DB positions against on-chain balances
 * - Live PnL Validation: detect unrealistic PnL swings
 * - Anomaly Detection: flag unusual trading patterns
 * - Drawdown Tracking: monitor peak-to-trough portfolio declines
 * - Concentration Risk: detect over-concentration in sectors/stocks
 * - Correlation-Adjusted Risk: detect correlated positions amplifying risk
 * - Risk Score: single 0-100 score summarizing portfolio risk level
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PositionReconciliation {
  agentId: string;
  symbol: string;
  dbQuantity: number;
  onChainQuantity: number | null;
  discrepancy: number;
  /** Whether the discrepancy exceeds the tolerance threshold */
  mismatch: boolean;
  checkedAt: string;
}

export interface PnLValidation {
  agentId: string;
  currentPnlPercent: number;
  previousPnlPercent: number;
  changePnlPercent: number;
  /** Whether the PnL change exceeds normal bounds */
  anomalous: boolean;
  reason: string | null;
}

export interface TradingAnomaly {
  type: AnomalyType;
  agentId: string;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  detectedAt: string;
  metadata: Record<string, unknown>;
}

export type AnomalyType =
  | "excessive_trading"
  | "pnl_spike"
  | "position_concentration"
  | "sector_concentration"
  | "drawdown_warning"
  | "drawdown_critical"
  | "correlation_risk"
  | "stale_position"
  | "round_trip_detected"
  | "confidence_divergence";

export interface DrawdownTracker {
  agentId: string;
  peakValue: number;
  peakDate: string;
  troughValue: number;
  troughDate: string;
  currentDrawdownPercent: number;
  maxDrawdownPercent: number;
  isInDrawdown: boolean;
}

export interface RiskScore {
  agentId: string;
  overall: number; // 0 (no risk) to 100 (extreme risk)
  components: {
    concentrationRisk: number;
    drawdownRisk: number;
    volatilityRisk: number;
    tradingFrequencyRisk: number;
    correlationRisk: number;
  };
  level: "low" | "moderate" | "elevated" | "high" | "extreme";
  calculatedAt: string;
}

export interface RiskMonitorMetrics {
  reconciliationsRun: number;
  mismatches: number;
  anomaliesDetected: number;
  anomaliesBySeverity: Record<string, number>;
  anomaliesByType: Record<string, number>;
  agentsMonitored: number;
  lastCheckAt: string | null;
}

export interface PortfolioSnapshot {
  agentId: string;
  totalValue: number;
  cashBalance: number;
  positionCount: number;
  positions: Array<{
    symbol: string;
    quantity: number;
    currentPrice: number;
    value: number;
    allocationPercent: number;
  }>;
  pnlPercent: number;
  snapshotAt: string;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** PnL change threshold (%) to flag as anomalous in a single round */
const PNL_ANOMALY_THRESHOLD_PERCENT = 15;
/** Position reconciliation tolerance (fractional amount) */
const RECONCILIATION_TOLERANCE = 0.001;
/** Drawdown warning threshold (%) */
const DRAWDOWN_WARNING_PERCENT = 10;
/** Drawdown critical threshold (%) */
const DRAWDOWN_CRITICAL_PERCENT = 25;
/** Maximum allocation in a single stock (%) before flagging */
const CONCENTRATION_WARN_PERCENT = 40;
/** Maximum number of trades per hour before flagging excessive trading */
const EXCESSIVE_TRADES_PER_HOUR = 10;
/** Number of hours after which a position with no price update is "stale" */
const STALE_POSITION_HOURS = 48;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const drawdownTrackers = new Map<string, DrawdownTracker>();
const anomalyLog: TradingAnomaly[] = [];
const portfolioSnapshots = new Map<string, PortfolioSnapshot[]>();
const tradeTimestamps = new Map<string, number[]>();
const previousPnl = new Map<string, number>();
const riskScores = new Map<string, RiskScore>();

let metrics: RiskMonitorMetrics = {
  reconciliationsRun: 0,
  mismatches: 0,
  anomaliesDetected: 0,
  anomaliesBySeverity: {},
  anomaliesByType: {},
  agentsMonitored: 0,
  lastCheckAt: null,
};

const MAX_ANOMALY_LOG = 500;
const MAX_SNAPSHOTS_PER_AGENT = 100;

// ---------------------------------------------------------------------------
// Position Reconciliation
// ---------------------------------------------------------------------------

/**
 * Reconcile DB position quantities against actual on-chain token balances.
 *
 * In production, this should be called periodically (e.g., every hour)
 * to detect drift between the database and the blockchain.
 */
export function reconcilePosition(
  agentId: string,
  symbol: string,
  dbQuantity: number,
  onChainQuantity: number | null,
): PositionReconciliation {
  metrics.reconciliationsRun++;

  const discrepancy =
    onChainQuantity !== null ? Math.abs(dbQuantity - onChainQuantity) : 0;
  const mismatch =
    onChainQuantity !== null && discrepancy > RECONCILIATION_TOLERANCE;

  if (mismatch) {
    metrics.mismatches++;
    const anomaly: TradingAnomaly = {
      type: "stale_position",
      agentId,
      severity: discrepancy > dbQuantity * 0.1 ? "high" : "medium",
      description: `Position mismatch for ${symbol}: DB=${dbQuantity.toFixed(6)}, Chain=${onChainQuantity!.toFixed(6)}, Diff=${discrepancy.toFixed(6)}`,
      detectedAt: new Date().toISOString(),
      metadata: { symbol, dbQuantity, onChainQuantity, discrepancy },
    };
    recordAnomaly(anomaly);
  }

  return {
    agentId,
    symbol,
    dbQuantity,
    onChainQuantity,
    discrepancy,
    mismatch,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Batch reconcile all positions for an agent.
 */
export function reconcileAllPositions(
  agentId: string,
  dbPositions: Array<{ symbol: string; quantity: number }>,
  onChainBalances: Map<string, number>,
): PositionReconciliation[] {
  return dbPositions.map((pos) => {
    const onChainQty = onChainBalances.get(pos.symbol) ?? null;
    return reconcilePosition(agentId, pos.symbol, pos.quantity, onChainQty);
  });
}

// ---------------------------------------------------------------------------
// PnL Validation
// ---------------------------------------------------------------------------

/**
 * Validate that PnL changes are within expected bounds.
 * Flags anomalous PnL swings that could indicate:
 * - Data feed errors (price spikes)
 * - Execution errors (wrong quantities)
 * - Market events (legitimate but noteworthy)
 */
export function validatePnL(
  agentId: string,
  currentPnlPercent: number,
): PnLValidation {
  const prevPnl = previousPnl.get(agentId) ?? 0;
  const changePnl = currentPnlPercent - prevPnl;
  const anomalous = Math.abs(changePnl) > PNL_ANOMALY_THRESHOLD_PERCENT;

  previousPnl.set(agentId, currentPnlPercent);

  let reason: string | null = null;
  if (anomalous) {
    reason =
      changePnl > 0
        ? `Suspicious PnL spike: +${changePnl.toFixed(2)}% in one round`
        : `Severe PnL drop: ${changePnl.toFixed(2)}% in one round`;

    recordAnomaly({
      type: "pnl_spike",
      agentId,
      severity: Math.abs(changePnl) > 30 ? "critical" : "high",
      description: reason,
      detectedAt: new Date().toISOString(),
      metadata: { currentPnlPercent, previousPnlPercent: prevPnl, changePnl },
    });
  }

  return {
    agentId,
    currentPnlPercent,
    previousPnlPercent: prevPnl,
    changePnlPercent: changePnl,
    anomalous,
    reason,
  };
}

// ---------------------------------------------------------------------------
// Drawdown Tracking
// ---------------------------------------------------------------------------

/**
 * Update drawdown tracking for an agent.
 * Tracks the maximum peak-to-trough decline in portfolio value.
 */
export function updateDrawdown(
  agentId: string,
  currentValue: number,
): DrawdownTracker {
  let tracker = drawdownTrackers.get(agentId);

  if (!tracker) {
    tracker = {
      agentId,
      peakValue: currentValue,
      peakDate: new Date().toISOString(),
      troughValue: currentValue,
      troughDate: new Date().toISOString(),
      currentDrawdownPercent: 0,
      maxDrawdownPercent: 0,
      isInDrawdown: false,
    };
    drawdownTrackers.set(agentId, tracker);
    return tracker;
  }

  // Update peak
  if (currentValue > tracker.peakValue) {
    tracker.peakValue = currentValue;
    tracker.peakDate = new Date().toISOString();
    tracker.isInDrawdown = false;
  }

  // Calculate current drawdown from peak
  const drawdown =
    tracker.peakValue > 0
      ? ((tracker.peakValue - currentValue) / tracker.peakValue) * 100
      : 0;

  tracker.currentDrawdownPercent = Math.round(drawdown * 100) / 100;

  if (drawdown > 0) {
    tracker.isInDrawdown = true;

    if (currentValue < tracker.troughValue || !tracker.isInDrawdown) {
      tracker.troughValue = currentValue;
      tracker.troughDate = new Date().toISOString();
    }
  }

  // Update max drawdown
  if (drawdown > tracker.maxDrawdownPercent) {
    tracker.maxDrawdownPercent = Math.round(drawdown * 100) / 100;
  }

  // Generate anomalies for significant drawdowns
  if (drawdown >= DRAWDOWN_CRITICAL_PERCENT) {
    recordAnomaly({
      type: "drawdown_critical",
      agentId,
      severity: "critical",
      description: `Critical drawdown: ${drawdown.toFixed(2)}% from peak $${tracker.peakValue.toFixed(2)} (current: $${currentValue.toFixed(2)})`,
      detectedAt: new Date().toISOString(),
      metadata: { drawdownPercent: drawdown, peakValue: tracker.peakValue, currentValue },
    });
  } else if (drawdown >= DRAWDOWN_WARNING_PERCENT) {
    recordAnomaly({
      type: "drawdown_warning",
      agentId,
      severity: "medium",
      description: `Drawdown warning: ${drawdown.toFixed(2)}% from peak $${tracker.peakValue.toFixed(2)}`,
      detectedAt: new Date().toISOString(),
      metadata: { drawdownPercent: drawdown, peakValue: tracker.peakValue, currentValue },
    });
  }

  return { ...tracker };
}

/**
 * Get drawdown tracker for an agent.
 */
export function getDrawdownTracker(agentId: string): DrawdownTracker | null {
  const tracker = drawdownTrackers.get(agentId);
  return tracker ? { ...tracker } : null;
}

// ---------------------------------------------------------------------------
// Portfolio Snapshot
// ---------------------------------------------------------------------------

/**
 * Record a portfolio snapshot for historical tracking.
 */
export function recordSnapshot(snapshot: PortfolioSnapshot): void {
  const agentSnapshots = portfolioSnapshots.get(snapshot.agentId) ?? [];
  agentSnapshots.push(snapshot);

  if (agentSnapshots.length > MAX_SNAPSHOTS_PER_AGENT) {
    agentSnapshots.splice(0, agentSnapshots.length - MAX_SNAPSHOTS_PER_AGENT);
  }

  portfolioSnapshots.set(snapshot.agentId, agentSnapshots);
  metrics.agentsMonitored = portfolioSnapshots.size;
  metrics.lastCheckAt = new Date().toISOString();
}

/**
 * Get recent snapshots for an agent.
 */
export function getSnapshots(agentId: string, limit = 20): PortfolioSnapshot[] {
  const snapshots = portfolioSnapshots.get(agentId) ?? [];
  return snapshots.slice(-limit);
}

// ---------------------------------------------------------------------------
// Anomaly Detection
// ---------------------------------------------------------------------------

/**
 * Check for excessive trading frequency.
 */
export function checkTradingFrequency(agentId: string): TradingAnomaly | null {
  const now = Date.now();
  const timestamps = tradeTimestamps.get(agentId) ?? [];

  // Clean old timestamps (keep last 24 hours)
  const cutoff = now - 24 * 60 * 60 * 1000;
  const recentTimestamps = timestamps.filter((ts) => ts > cutoff);
  tradeTimestamps.set(agentId, recentTimestamps);

  // Check hourly rate
  const hourCutoff = now - 60 * 60 * 1000;
  const tradesLastHour = recentTimestamps.filter((ts) => ts > hourCutoff).length;

  if (tradesLastHour > EXCESSIVE_TRADES_PER_HOUR) {
    const anomaly: TradingAnomaly = {
      type: "excessive_trading",
      agentId,
      severity: tradesLastHour > EXCESSIVE_TRADES_PER_HOUR * 2 ? "high" : "medium",
      description: `${tradesLastHour} trades in the last hour (threshold: ${EXCESSIVE_TRADES_PER_HOUR})`,
      detectedAt: new Date().toISOString(),
      metadata: { tradesLastHour, tradesLast24h: recentTimestamps.length },
    };
    recordAnomaly(anomaly);
    return anomaly;
  }

  return null;
}

/**
 * Record a trade timestamp for frequency tracking.
 */
export function recordTradeTimestamp(agentId: string): void {
  const timestamps = tradeTimestamps.get(agentId) ?? [];
  timestamps.push(Date.now());
  tradeTimestamps.set(agentId, timestamps);
}

/**
 * Check for position concentration risk.
 */
export function checkConcentrationRisk(
  agentId: string,
  positions: Array<{ symbol: string; value: number }>,
  totalValue: number,
): TradingAnomaly[] {
  const anomalies: TradingAnomaly[] = [];

  if (totalValue <= 0) return anomalies;

  for (const pos of positions) {
    const allocationPercent = (pos.value / totalValue) * 100;

    if (allocationPercent > CONCENTRATION_WARN_PERCENT) {
      const anomaly: TradingAnomaly = {
        type: "position_concentration",
        agentId,
        severity: allocationPercent > 60 ? "high" : "medium",
        description: `${pos.symbol} is ${allocationPercent.toFixed(1)}% of portfolio (threshold: ${CONCENTRATION_WARN_PERCENT}%)`,
        detectedAt: new Date().toISOString(),
        metadata: {
          symbol: pos.symbol,
          allocationPercent,
          value: pos.value,
          totalValue,
        },
      };
      anomalies.push(anomaly);
      recordAnomaly(anomaly);
    }
  }

  return anomalies;
}

/**
 * Detect round-trip trades (buy then sell same stock in short period).
 * Could indicate erratic agent behavior or oscillating LLM decisions.
 */
export function detectRoundTrip(
  agentId: string,
  recentDecisions: Array<{
    action: string;
    symbol: string;
    timestamp: string;
  }>,
): TradingAnomaly | null {
  // Look for buy-sell or sell-buy of same stock within last 3 decisions
  const last3 = recentDecisions.slice(0, 3);

  for (let i = 0; i < last3.length - 1; i++) {
    for (let j = i + 1; j < last3.length; j++) {
      if (
        last3[i].symbol === last3[j].symbol &&
        last3[i].action !== last3[j].action &&
        last3[i].action !== "hold" &&
        last3[j].action !== "hold"
      ) {
        const anomaly: TradingAnomaly = {
          type: "round_trip_detected",
          agentId,
          severity: "medium",
          description: `Round-trip detected: ${last3[j].action} then ${last3[i].action} ${last3[i].symbol} within recent rounds`,
          detectedAt: new Date().toISOString(),
          metadata: {
            symbol: last3[i].symbol,
            actions: [last3[j].action, last3[i].action],
          },
        };
        recordAnomaly(anomaly);
        return anomaly;
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Risk Score Calculation
// ---------------------------------------------------------------------------

/**
 * Calculate a comprehensive risk score for an agent's portfolio.
 * Score 0 (no risk) to 100 (extreme risk).
 */
export function calculateRiskScore(params: {
  agentId: string;
  positions: Array<{ symbol: string; value: number; pnlPercent: number }>;
  totalValue: number;
  cashPercent: number;
  drawdownPercent: number;
  tradesLastHour: number;
  maxPositionPercent: number;
}): RiskScore {
  const {
    agentId,
    positions,
    totalValue,
    cashPercent,
    drawdownPercent,
    tradesLastHour,
    maxPositionPercent,
  } = params;

  // Component 1: Concentration risk (0-100)
  const concentrationRisk = Math.min(100, (maxPositionPercent / 50) * 100);

  // Component 2: Drawdown risk (0-100)
  const drawdownRisk = Math.min(100, (drawdownPercent / 30) * 100);

  // Component 3: Volatility risk (based on PnL spread across positions)
  const pnlValues = positions.map((p) => p.pnlPercent);
  const pnlStdDev =
    pnlValues.length > 1 ? calculateStdDev(pnlValues) : 0;
  const volatilityRisk = Math.min(100, (pnlStdDev / 20) * 100);

  // Component 4: Trading frequency risk (0-100)
  const tradingFrequencyRisk = Math.min(
    100,
    (tradesLastHour / EXCESSIVE_TRADES_PER_HOUR) * 100,
  );

  // Component 5: Correlation risk (simplified — low cash = high correlation)
  const correlationRisk = Math.min(
    100,
    Math.max(0, ((100 - cashPercent) / 80) * 100),
  );

  // Weighted overall score
  const overall = Math.round(
    concentrationRisk * 0.25 +
      drawdownRisk * 0.30 +
      volatilityRisk * 0.15 +
      tradingFrequencyRisk * 0.10 +
      correlationRisk * 0.20,
  );

  // Determine level
  let level: RiskScore["level"];
  if (overall >= 80) level = "extreme";
  else if (overall >= 60) level = "high";
  else if (overall >= 40) level = "elevated";
  else if (overall >= 20) level = "moderate";
  else level = "low";

  const score: RiskScore = {
    agentId,
    overall,
    components: {
      concentrationRisk: Math.round(concentrationRisk),
      drawdownRisk: Math.round(drawdownRisk),
      volatilityRisk: Math.round(volatilityRisk),
      tradingFrequencyRisk: Math.round(tradingFrequencyRisk),
      correlationRisk: Math.round(correlationRisk),
    },
    level,
    calculatedAt: new Date().toISOString(),
  };

  riskScores.set(agentId, score);
  return score;
}

/**
 * Get the most recent risk score for an agent.
 */
export function getRiskScore(agentId: string): RiskScore | null {
  return riskScores.get(agentId) ?? null;
}

/**
 * Get risk scores for all monitored agents.
 */
export function getAllRiskScores(): RiskScore[] {
  return Array.from(riskScores.values());
}

// ---------------------------------------------------------------------------
// Anomaly Log Management
// ---------------------------------------------------------------------------

function recordAnomaly(anomaly: TradingAnomaly): void {
  anomalyLog.push(anomaly);
  metrics.anomaliesDetected++;
  metrics.anomaliesBySeverity[anomaly.severity] =
    (metrics.anomaliesBySeverity[anomaly.severity] ?? 0) + 1;
  metrics.anomaliesByType[anomaly.type] =
    (metrics.anomaliesByType[anomaly.type] ?? 0) + 1;

  if (anomalyLog.length > MAX_ANOMALY_LOG) {
    anomalyLog.splice(0, anomalyLog.length - MAX_ANOMALY_LOG);
  }

  const severityEmoji =
    anomaly.severity === "critical"
      ? "CRITICAL"
      : anomaly.severity === "high"
        ? "HIGH"
        : anomaly.severity === "medium"
          ? "MEDIUM"
          : "LOW";

  console.warn(
    `[RiskMonitor] ${severityEmoji} anomaly [${anomaly.type}] for ${anomaly.agentId}: ${anomaly.description}`,
  );
}

/**
 * Get recent anomalies, optionally filtered by agent or type.
 */
export function getAnomalies(filters?: {
  agentId?: string;
  type?: AnomalyType;
  severity?: string;
  limit?: number;
}): TradingAnomaly[] {
  let filtered = [...anomalyLog];

  if (filters?.agentId) {
    filtered = filtered.filter((a) => a.agentId === filters.agentId);
  }
  if (filters?.type) {
    filtered = filtered.filter((a) => a.type === filters.type);
  }
  if (filters?.severity) {
    filtered = filtered.filter((a) => a.severity === filters.severity);
  }

  const limit = filters?.limit ?? 50;
  return filtered.slice(-limit);
}

// ---------------------------------------------------------------------------
// Comprehensive Risk Check
// ---------------------------------------------------------------------------

/**
 * Run all risk checks for an agent in one call.
 * This is the recommended method for the orchestrator to call after each round.
 */
export function runRiskChecks(params: {
  agentId: string;
  totalValue: number;
  cashBalance: number;
  positions: Array<{
    symbol: string;
    quantity: number;
    currentPrice: number;
    pnlPercent: number;
  }>;
  pnlPercent: number;
  recentDecisions?: Array<{
    action: string;
    symbol: string;
    timestamp: string;
  }>;
}): {
  pnlValidation: PnLValidation;
  drawdown: DrawdownTracker;
  concentrationAnomalies: TradingAnomaly[];
  frequencyAnomaly: TradingAnomaly | null;
  roundTripAnomaly: TradingAnomaly | null;
  riskScore: RiskScore;
} {
  const { agentId, totalValue, cashBalance, positions, pnlPercent } = params;

  // PnL validation
  const pnlValidation = validatePnL(agentId, pnlPercent);

  // Drawdown tracking
  const drawdown = updateDrawdown(agentId, totalValue);

  // Concentration risk
  const positionsWithValue = positions.map((p) => ({
    symbol: p.symbol,
    value: p.quantity * p.currentPrice,
    pnlPercent: p.pnlPercent,
  }));
  const concentrationAnomalies = checkConcentrationRisk(
    agentId,
    positionsWithValue,
    totalValue,
  );

  // Trading frequency
  const frequencyAnomaly = checkTradingFrequency(agentId);

  // Round-trip detection
  const roundTripAnomaly = params.recentDecisions
    ? detectRoundTrip(agentId, params.recentDecisions)
    : null;

  // Calculate max position allocation
  const maxPosPercent =
    totalValue > 0
      ? Math.max(
          0,
          ...positionsWithValue.map((p) => (p.value / totalValue) * 100),
        )
      : 0;

  const hourTimestamps = tradeTimestamps.get(agentId) ?? [];
  const hourCutoff = Date.now() - 60 * 60 * 1000;
  const tradesLastHour = hourTimestamps.filter((ts) => ts > hourCutoff).length;

  // Risk score
  const riskScore = calculateRiskScore({
    agentId,
    positions: positionsWithValue,
    totalValue,
    cashPercent: totalValue > 0 ? (cashBalance / totalValue) * 100 : 100,
    drawdownPercent: drawdown.currentDrawdownPercent,
    tradesLastHour,
    maxPositionPercent: maxPosPercent,
  });

  // Record snapshot
  recordSnapshot({
    agentId,
    totalValue,
    cashBalance,
    positionCount: positions.length,
    positions: positionsWithValue.map((p) => ({
      symbol: p.symbol,
      quantity:
        positions.find((pos) => pos.symbol === p.symbol)?.quantity ?? 0,
      currentPrice:
        positions.find((pos) => pos.symbol === p.symbol)?.currentPrice ?? 0,
      value: p.value,
      allocationPercent:
        totalValue > 0 ? (p.value / totalValue) * 100 : 0,
    })),
    pnlPercent,
    snapshotAt: new Date().toISOString(),
  });

  return {
    pnlValidation,
    drawdown,
    concentrationAnomalies,
    frequencyAnomaly,
    roundTripAnomaly,
    riskScore,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function calculateStdDev(values: number[]): number {
  if (values.length <= 1) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map((v) => Math.pow(v - mean, 2));
  const variance =
    squaredDiffs.reduce((a, b) => a + b, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/**
 * Get risk monitor metrics.
 */
export function getRiskMonitorMetrics(): RiskMonitorMetrics {
  return {
    ...metrics,
    anomaliesBySeverity: { ...metrics.anomaliesBySeverity },
    anomaliesByType: { ...metrics.anomaliesByType },
  };
}

/**
 * Reset risk monitor state (admin use).
 */
export function resetRiskMonitor(): void {
  drawdownTrackers.clear();
  anomalyLog.length = 0;
  portfolioSnapshots.clear();
  tradeTimestamps.clear();
  previousPnl.clear();
  riskScores.clear();
  metrics = {
    reconciliationsRun: 0,
    mismatches: 0,
    anomaliesDetected: 0,
    anomaliesBySeverity: {},
    anomaliesByType: {},
    agentsMonitored: 0,
    lastCheckAt: null,
  };
}
