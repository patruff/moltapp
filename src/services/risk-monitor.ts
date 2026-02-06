/**
 * Real-Time Risk Monitor
 *
 * Continuous monitoring of portfolio health, position integrity, and
 * anomaly detection. This is the "second pair of eyes" that catches
 * issues the circuit breakers might miss.
 *
 * Features:
 * - Drawdown Tracking: monitor peak-to-trough portfolio declines
 * - Risk Score: single 0-100 score summarizing portfolio risk level
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Drawdown Tracking
// ---------------------------------------------------------------------------

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
 * Get recent snapshots for an agent.
 */
export function getSnapshots(agentId: string, limit = 20): PortfolioSnapshot[] {
  const snapshots = portfolioSnapshots.get(agentId) ?? [];
  return snapshots.slice(-limit);
}

// ---------------------------------------------------------------------------
// Anomaly Log Management
// ---------------------------------------------------------------------------

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
// Risk Score Access
// ---------------------------------------------------------------------------

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
