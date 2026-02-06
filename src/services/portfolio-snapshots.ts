/**
 * Portfolio Snapshot Persistence Service
 *
 * Takes and stores point-in-time snapshots of each agent's portfolio after
 * every trading round. This enables:
 *
 * - Historical equity curve reconstruction
 * - Drawdown analysis over time (not just current)
 * - P&L audit trail for competition integrity
 * - Time-series performance comparison between agents
 * - Replay of portfolio state at any past round
 *
 * Snapshots are stored in Postgres (portfolio_snapshots table) and also
 * held in an in-memory ring buffer for fast API access.
 */

import { db } from "../db/index.ts";
import {
  portfolioSnapshots,
  competitionScores,
} from "../db/schema/portfolio-snapshots.ts";
import { trades } from "../db/schema/trades.ts";
import { positions } from "../db/schema/positions.ts";
import { eq, desc, sql, and, gte, lte, type InferSelectModel } from "drizzle-orm";
import { round2 } from "../lib/math-utils.ts";
import { errorMessage } from "../lib/errors.ts";

type PortfolioSnapshotRow = InferSelectModel<typeof portfolioSnapshots>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SnapshotPosition {
  symbol: string;
  mintAddress: string;
  quantity: number;
  averageCostBasis: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  portfolioWeight: number;
}

export interface PortfolioSnapshot {
  id?: number;
  agentId: string;
  roundId: string | null;
  trigger: "round_end" | "scheduled" | "manual";
  cashBalance: number;
  positionsValue: number;
  totalValue: number;
  totalPnl: number;
  totalPnlPercent: number;
  positionCount: number;
  positions: SnapshotPosition[];
  createdAt: string;
}

export interface EquityCurvePoint {
  timestamp: string;
  totalValue: number;
  totalPnl: number;
  totalPnlPercent: number;
  positionCount: number;
  drawdownPercent: number;
}

export interface DrawdownAnalysis {
  currentDrawdown: number;
  maxDrawdown: number;
  maxDrawdownDate: string | null;
  peakValue: number;
  peakDate: string | null;
  troughValue: number;
  troughDate: string | null;
  recoveryDays: number | null;
  drawdownPeriods: Array<{
    start: string;
    end: string | null;
    depth: number;
    recovered: boolean;
  }>;
}

export interface AgentPerformanceTimeline {
  agentId: string;
  snapshots: PortfolioSnapshot[];
  equityCurve: EquityCurvePoint[];
  drawdown: DrawdownAnalysis;
  summary: {
    startValue: number;
    endValue: number;
    totalReturn: number;
    totalReturnPercent: number;
    bestDay: { date: string; return_: number } | null;
    worstDay: { date: string; return_: number } | null;
    avgDailyReturn: number;
    volatility: number;
    sharpeRatio: number | null;
    roundsTracked: number;
  };
}

// ---------------------------------------------------------------------------
// In-Memory Ring Buffer (fast access for recent snapshots)
// ---------------------------------------------------------------------------

const MAX_BUFFER_PER_AGENT = 200;
const snapshotBuffer = new Map<string, PortfolioSnapshot[]>();

function bufferSnapshot(snapshot: PortfolioSnapshot): void {
  const existing = snapshotBuffer.get(snapshot.agentId) ?? [];
  existing.push(snapshot);
  if (existing.length > MAX_BUFFER_PER_AGENT) {
    existing.shift();
  }
  snapshotBuffer.set(snapshot.agentId, existing);
}

function getBufferedSnapshots(agentId: string): PortfolioSnapshot[] {
  return snapshotBuffer.get(agentId) ?? [];
}

// ---------------------------------------------------------------------------
// Snapshot Creation
// ---------------------------------------------------------------------------

/** Starting capital per agent — must match orchestrator.ts */
const INITIAL_CAPITAL = 10_000;

/**
 * Take a portfolio snapshot for a single agent.
 *
 * Reads the agent's current positions, calculates total value using
 * provided market prices, and persists to both DB and memory buffer.
 */
export async function takeSnapshot(
  agentId: string,
  roundId: string | null,
  trigger: "round_end" | "scheduled" | "manual",
  marketPrices: Map<string, number>,
): Promise<PortfolioSnapshot> {
  // 1. Get agent's current positions
  const agentPositions = await db
    .select()
    .from(positions)
    .where(eq(positions.agentId, agentId));

  // 2. Get agent's trade history to calculate cash balance
  const agentTrades = await db
    .select()
    .from(trades)
    .where(eq(trades.agentId, agentId));

  let cashBalance = INITIAL_CAPITAL;
  for (const trade of agentTrades) {
    if (trade.side === "buy") {
      cashBalance -= parseFloat(trade.usdcAmount);
    } else if (trade.side === "sell") {
      cashBalance += parseFloat(trade.usdcAmount);
    }
  }
  cashBalance = Math.max(0, cashBalance);

  // 3. Build position snapshots
  let positionsValue = 0;
  const positionSnapshots: SnapshotPosition[] = [];

  for (const pos of agentPositions) {
    const qty = parseFloat(pos.quantity);
    const costBasis = parseFloat(pos.averageCostBasis);
    const currentPrice = marketPrices.get(pos.symbol) ?? costBasis;
    const marketValue = qty * currentPrice;
    const unrealizedPnl = (currentPrice - costBasis) * qty;
    const unrealizedPnlPercent =
      costBasis > 0 ? ((currentPrice - costBasis) / costBasis) * 100 : 0;

    positionsValue += marketValue;

    positionSnapshots.push({
      symbol: pos.symbol,
      mintAddress: pos.mintAddress,
      quantity: qty,
      averageCostBasis: costBasis,
      currentPrice,
      marketValue,
      unrealizedPnl,
      unrealizedPnlPercent,
      portfolioWeight: 0, // calculated below
    });
  }

  // 4. Calculate totals
  const totalValue = cashBalance + positionsValue;
  const totalPnl = totalValue - INITIAL_CAPITAL;
  const totalPnlPercent =
    INITIAL_CAPITAL > 0 ? (totalPnl / INITIAL_CAPITAL) * 100 : 0;

  // 5. Set portfolio weights
  for (const ps of positionSnapshots) {
    ps.portfolioWeight = totalValue > 0 ? (ps.marketValue / totalValue) * 100 : 0;
  }

  // 6. Build snapshot object
  const snapshot: PortfolioSnapshot = {
    agentId,
    roundId,
    trigger,
    cashBalance,
    positionsValue,
    totalValue,
    totalPnl,
    totalPnlPercent,
    positionCount: positionSnapshots.length,
    positions: positionSnapshots,
    createdAt: new Date().toISOString(),
  };

  // 7. Persist to DB
  try {
    const [inserted] = await db
      .insert(portfolioSnapshots)
      .values({
        agentId: snapshot.agentId,
        roundId: snapshot.roundId,
        trigger: snapshot.trigger,
        cashBalance: snapshot.cashBalance.toFixed(6),
        positionsValue: snapshot.positionsValue.toFixed(6),
        totalValue: snapshot.totalValue.toFixed(6),
        totalPnl: snapshot.totalPnl.toFixed(6),
        totalPnlPercent: snapshot.totalPnlPercent.toFixed(4),
        positionCount: snapshot.positionCount,
        positions: snapshot.positions,
      })
      .returning();
    snapshot.id = inserted.id;
  } catch (err) {
    console.warn(
      `[PortfolioSnapshots] DB persist failed for ${agentId}: ${errorMessage(err)}`,
    );
  }

  // 8. Buffer in memory
  bufferSnapshot(snapshot);

  return snapshot;
}

/**
 * Take snapshots for all agents in a single round.
 * Called from the orchestrator after each trading round completes.
 */
export async function takeRoundSnapshots(
  roundId: string,
  agentIds: string[],
  marketPrices: Map<string, number>,
): Promise<PortfolioSnapshot[]> {
  const snapshots: PortfolioSnapshot[] = [];

  for (const agentId of agentIds) {
    try {
      const snapshot = await takeSnapshot(
        agentId,
        roundId,
        "round_end",
        marketPrices,
      );
      snapshots.push(snapshot);
    } catch (err) {
      console.error(
        `[PortfolioSnapshots] Failed to snapshot ${agentId}: ${errorMessage(err)}`,
      );
    }
  }

  return snapshots;
}

// ---------------------------------------------------------------------------
// Equity Curve & Drawdown Analysis
// ---------------------------------------------------------------------------

/**
 * Build an equity curve from snapshots with drawdown at each point.
 */
export function buildEquityCurve(
  snapshots: PortfolioSnapshot[],
): EquityCurvePoint[] {
  if (snapshots.length === 0) return [];

  const sorted = [...snapshots].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  let peakValue = INITIAL_CAPITAL;
  const curve: EquityCurvePoint[] = [];

  for (const snap of sorted) {
    if (snap.totalValue > peakValue) {
      peakValue = snap.totalValue;
    }
    const drawdownPercent =
      peakValue > 0 ? ((peakValue - snap.totalValue) / peakValue) * 100 : 0;

    curve.push({
      timestamp: snap.createdAt,
      totalValue: snap.totalValue,
      totalPnl: snap.totalPnl,
      totalPnlPercent: snap.totalPnlPercent,
      positionCount: snap.positionCount,
      drawdownPercent,
    });
  }

  return curve;
}

/**
 * Compute drawdown analysis from an equity curve.
 */
export function analyzeDrawdown(curve: EquityCurvePoint[]): DrawdownAnalysis {
  if (curve.length === 0) {
    return {
      currentDrawdown: 0,
      maxDrawdown: 0,
      maxDrawdownDate: null,
      peakValue: INITIAL_CAPITAL,
      peakDate: null,
      troughValue: INITIAL_CAPITAL,
      troughDate: null,
      recoveryDays: null,
      drawdownPeriods: [],
    };
  }

  let peakValue = INITIAL_CAPITAL;
  let peakDate: string | null = null;
  let maxDrawdown = 0;
  let maxDrawdownDate: string | null = null;
  let troughValue = INITIAL_CAPITAL;
  let troughDate: string | null = null;

  const drawdownPeriods: DrawdownAnalysis["drawdownPeriods"] = [];
  let currentPeriodStart: string | null = null;
  let currentPeriodDepth = 0;

  for (const point of curve) {
    if (point.totalValue > peakValue) {
      // New peak — close any open drawdown period
      if (currentPeriodStart !== null) {
        drawdownPeriods.push({
          start: currentPeriodStart,
          end: point.timestamp,
          depth: currentPeriodDepth,
          recovered: true,
        });
        currentPeriodStart = null;
        currentPeriodDepth = 0;
      }
      peakValue = point.totalValue;
      peakDate = point.timestamp;
    }

    const dd =
      peakValue > 0
        ? ((peakValue - point.totalValue) / peakValue) * 100
        : 0;

    if (dd > 0 && currentPeriodStart === null) {
      currentPeriodStart = point.timestamp;
    }

    if (dd > currentPeriodDepth) {
      currentPeriodDepth = dd;
    }

    if (dd > maxDrawdown) {
      maxDrawdown = dd;
      maxDrawdownDate = point.timestamp;
      troughValue = point.totalValue;
      troughDate = point.timestamp;
    }
  }

  // Close any open drawdown period
  if (currentPeriodStart !== null) {
    drawdownPeriods.push({
      start: currentPeriodStart,
      end: null,
      depth: currentPeriodDepth,
      recovered: false,
    });
  }

  const currentDrawdown = curve.length > 0 ? curve[curve.length - 1].drawdownPercent : 0;

  // Recovery days: days from trough to recovery (or null if still in drawdown)
  let recoveryDays: number | null = null;
  if (troughDate && drawdownPeriods.length > 0) {
    const lastPeriod = drawdownPeriods[drawdownPeriods.length - 1];
    if (lastPeriod.recovered && lastPeriod.end) {
      const troughMs = new Date(lastPeriod.start).getTime();
      const recoveryMs = new Date(lastPeriod.end).getTime();
      recoveryDays = Math.round((recoveryMs - troughMs) / (1000 * 60 * 60 * 24));
    }
  }

  return {
    currentDrawdown: round2(currentDrawdown),
    maxDrawdown: round2(maxDrawdown),
    maxDrawdownDate,
    peakValue: round2(peakValue),
    peakDate,
    troughValue: round2(troughValue),
    troughDate,
    recoveryDays,
    drawdownPeriods: drawdownPeriods.slice(-20), // Keep last 20 periods
  };
}

// ---------------------------------------------------------------------------
// Performance Timeline
// ---------------------------------------------------------------------------

/**
 * Build a full performance timeline for an agent.
 * Combines snapshots, equity curve, drawdown, and summary statistics.
 */
export async function getAgentTimeline(
  agentId: string,
  options?: { limit?: number; fromDate?: string; toDate?: string },
): Promise<AgentPerformanceTimeline> {
  const limit = options?.limit ?? 500;

  // Try DB first, fall back to buffer
  let snapshots: PortfolioSnapshot[] = [];

  try {
    const conditions = [eq(portfolioSnapshots.agentId, agentId)];
    if (options?.fromDate) {
      conditions.push(gte(portfolioSnapshots.createdAt, new Date(options.fromDate)));
    }
    if (options?.toDate) {
      conditions.push(lte(portfolioSnapshots.createdAt, new Date(options.toDate)));
    }

    const dbSnapshots = await db
      .select()
      .from(portfolioSnapshots)
      .where(and(...conditions))
      .orderBy(desc(portfolioSnapshots.createdAt))
      .limit(limit);

    snapshots = dbSnapshots.map((row: PortfolioSnapshotRow) => ({
      id: row.id,
      agentId: row.agentId,
      roundId: row.roundId,
      trigger: row.trigger as "round_end" | "scheduled" | "manual",
      cashBalance: parseFloat(row.cashBalance),
      positionsValue: parseFloat(row.positionsValue),
      totalValue: parseFloat(row.totalValue),
      totalPnl: parseFloat(row.totalPnl),
      totalPnlPercent: parseFloat(row.totalPnlPercent),
      positionCount: row.positionCount,
      positions: row.positions as SnapshotPosition[],
      createdAt: row.createdAt.toISOString(),
    }));
  } catch {
    // Fall back to buffer
    snapshots = getBufferedSnapshots(agentId);
  }

  // If no DB snapshots, use buffer
  if (snapshots.length === 0) {
    snapshots = getBufferedSnapshots(agentId);
  }

  // Sort chronologically
  snapshots.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  // Build equity curve and drawdown
  const equityCurve = buildEquityCurve(snapshots);
  const drawdown = analyzeDrawdown(equityCurve);

  // Compute summary statistics
  const summary = computeSummary(snapshots, equityCurve);

  return {
    agentId,
    snapshots,
    equityCurve,
    drawdown,
    summary,
  };
}

/**
 * Compute summary statistics from snapshots.
 */
function computeSummary(
  snapshots: PortfolioSnapshot[],
  curve: EquityCurvePoint[],
): AgentPerformanceTimeline["summary"] {
  if (snapshots.length === 0) {
    return {
      startValue: INITIAL_CAPITAL,
      endValue: INITIAL_CAPITAL,
      totalReturn: 0,
      totalReturnPercent: 0,
      bestDay: null,
      worstDay: null,
      avgDailyReturn: 0,
      volatility: 0,
      sharpeRatio: null,
      roundsTracked: 0,
    };
  }

  const startValue = snapshots[0].totalValue;
  const endValue = snapshots[snapshots.length - 1].totalValue;
  const totalReturn = endValue - startValue;
  const totalReturnPercent =
    startValue > 0 ? (totalReturn / startValue) * 100 : 0;

  // Compute daily returns (period-to-period)
  const returns: number[] = [];
  const returnDates: string[] = [];

  for (let i = 1; i < snapshots.length; i++) {
    const prevValue = snapshots[i - 1].totalValue;
    if (prevValue > 0) {
      const periodReturn =
        ((snapshots[i].totalValue - prevValue) / prevValue) * 100;
      returns.push(periodReturn);
      returnDates.push(snapshots[i].createdAt);
    }
  }

  // Best/worst day
  let bestDay: { date: string; return_: number } | null = null;
  let worstDay: { date: string; return_: number } | null = null;

  for (let i = 0; i < returns.length; i++) {
    if (bestDay === null || returns[i] > bestDay.return_) {
      bestDay = { date: returnDates[i], return_: round2(returns[i]) };
    }
    if (worstDay === null || returns[i] < worstDay.return_) {
      worstDay = { date: returnDates[i], return_: round2(returns[i]) };
    }
  }

  // Average daily return
  const avgDailyReturn =
    returns.length > 0
      ? returns.reduce((a, b) => a + b, 0) / returns.length
      : 0;

  // Volatility (standard deviation of returns)
  let volatility = 0;
  if (returns.length > 1) {
    const variance =
      returns.reduce((sum, r) => sum + Math.pow(r - avgDailyReturn, 2), 0) /
      (returns.length - 1);
    volatility = Math.sqrt(variance);
  }

  // Annualized Sharpe ratio (assuming risk-free rate ≈ 0 for simplicity)
  // Annualize: assuming ~2 snapshots/day with 30-min rounds
  const annualizationFactor = Math.sqrt(252 * 48); // 48 half-hour periods per day
  const sharpeRatio =
    volatility > 0
      ? round2((avgDailyReturn / volatility) * annualizationFactor)
      : null;

  return {
    startValue: round2(startValue),
    endValue: round2(endValue),
    totalReturn: round2(totalReturn),
    totalReturnPercent: round2(totalReturnPercent),
    bestDay,
    worstDay,
    avgDailyReturn: Math.round(avgDailyReturn * 10000) / 10000,
    volatility: Math.round(volatility * 10000) / 10000,
    sharpeRatio,
    roundsTracked: snapshots.length,
  };
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/**
 * Compare performance timelines across multiple agents.
 */
export async function compareAgentTimelines(
  agentIds: string[],
  options?: { limit?: number; fromDate?: string; toDate?: string },
): Promise<{
  agents: Array<{
    agentId: string;
    summary: AgentPerformanceTimeline["summary"];
    drawdown: DrawdownAnalysis;
    latestSnapshot: PortfolioSnapshot | null;
  }>;
  rankings: {
    byReturn: string[];
    bySharpe: string[];
    byDrawdown: string[];
  };
}> {
  const timelines = await Promise.all(
    agentIds.map((id) => getAgentTimeline(id, options)),
  );

  const agents = timelines.map((t) => ({
    agentId: t.agentId,
    summary: t.summary,
    drawdown: t.drawdown,
    latestSnapshot:
      t.snapshots.length > 0 ? t.snapshots[t.snapshots.length - 1] : null,
  }));

  // Rankings
  const byReturn = [...agents]
    .sort((a, b) => b.summary.totalReturnPercent - a.summary.totalReturnPercent)
    .map((a) => a.agentId);

  const bySharpe = [...agents]
    .sort((a, b) => (b.summary.sharpeRatio ?? -999) - (a.summary.sharpeRatio ?? -999))
    .map((a) => a.agentId);

  const byDrawdown = [...agents]
    .sort((a, b) => a.drawdown.maxDrawdown - b.drawdown.maxDrawdown)
    .map((a) => a.agentId);

  return {
    agents,
    rankings: { byReturn, bySharpe, byDrawdown },
  };
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export function getSnapshotMetrics(): {
  bufferedAgents: number;
  totalBufferedSnapshots: number;
  agentCounts: Record<string, number>;
} {
  const agentCounts: Record<string, number> = {};
  let total = 0;
  for (const [agentId, snaps] of snapshotBuffer) {
    agentCounts[agentId] = snaps.length;
    total += snaps.length;
  }
  return {
    bufferedAgents: snapshotBuffer.size,
    totalBufferedSnapshots: total,
    agentCounts,
  };
}
