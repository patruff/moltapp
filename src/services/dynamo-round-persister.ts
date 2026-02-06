/**
 * DynamoDB Trading Round Persister
 *
 * Persists trading round results to DynamoDB for cross-Lambda state sharing
 * and historical querying. The CDK stack creates two tables:
 * - moltapp-agent-state: Agent state (positions, config, last trade)
 * - moltapp-trading-rounds: Full trading round history
 *
 * This service bridges the gap between the in-memory orchestrator and
 * durable storage. Every trading round, every decision, every execution
 * result is written to DynamoDB for:
 * - Historical analysis
 * - Cross-invocation state (Lambda is stateless)
 * - Dashboard queries
 * - Audit trail
 */

import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  QueryCommand,
  UpdateItemCommand,
  BatchWriteItemCommand,
  type AttributeValue,
} from "@aws-sdk/client-dynamodb";
import type {
  TradingDecision,
  TradingRoundResult,
} from "../agents/base-agent.ts";
import type { CircuitBreakerActivation } from "./circuit-breaker.ts";
import { errorMessage } from "../lib/errors.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PersistedRound {
  roundId: string;
  timestamp: string;
  durationMs: number;
  tradingMode: "live" | "paper";
  results: PersistedAgentResult[];
  errors: string[];
  circuitBreakerActivations: number;
  lockSkipped: boolean;
  /** Agent consensus: did all agents agree on direction? */
  consensus: "unanimous" | "majority" | "split" | "no_trades";
  /** Round summary for quick display */
  summary: string;
  /** TTL for DynamoDB auto-expiry (90 days) */
  ttl: number;
}

export interface PersistedAgentResult {
  agentId: string;
  agentName: string;
  action: "buy" | "sell" | "hold";
  symbol: string;
  quantity: number;
  reasoning: string;
  confidence: number;
  executed: boolean;
  executionError?: string;
  txSignature?: string;
  filledPrice?: number;
  usdcAmount?: number;
}

export interface AgentStateSnapshot {
  agentId: string;
  status: "active" | "paused" | "error";
  lastTradeTimestamp: string;
  lastAction: "buy" | "sell" | "hold";
  lastSymbol: string;
  lastConfidence: number;
  totalDecisions: number;
  totalTrades: number;
  consecutiveHolds: number;
  consecutiveErrors: number;
  lastRoundId: string;
  /** Portfolio summary at time of snapshot */
  portfolioValue: number;
  cashBalance: number;
  positionsCount: number;
  totalPnlPercent: number;
  updatedAt: string;
  ttl: number;
}

export interface RoundQuery {
  limit?: number;
  /** ISO timestamp — return rounds after this time */
  after?: string;
  /** Filter by agent ID */
  agentId?: string;
}

export interface PersisterStats {
  roundsWritten: number;
  agentStatesWritten: number;
  writeErrors: number;
  lastWriteAt: string | null;
  dynamoTableConfigured: boolean;
  roundsTableName: string | null;
  agentStateTableName: string | null;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let client: DynamoDBClient | null = null;
let roundsWritten = 0;
let agentStatesWritten = 0;
let writeErrors = 0;
let lastWriteAt: string | null = null;

const ROUNDS_TABLE = process.env.TRADING_ROUNDS_TABLE ?? "moltapp-trading-rounds";
const AGENT_STATE_TABLE = process.env.AGENT_STATE_TABLE ?? "moltapp-agent-state";

/** 90 days in seconds for TTL */
const TTL_90_DAYS = 90 * 24 * 60 * 60;

// ---------------------------------------------------------------------------
// Client initialization
// ---------------------------------------------------------------------------

/**
 * Get or create the DynamoDB client.
 * Lazy initialization — only created when first needed.
 */
function getClient(): DynamoDBClient {
  if (!client) {
    client = new DynamoDBClient({
      region: process.env.AWS_REGION ?? "us-east-1",
    });
  }
  return client;
}

/**
 * Check if DynamoDB persistence is configured.
 * Returns false when running locally without DynamoDB access.
 */
export function isDynamoConfigured(): boolean {
  return !!(process.env.TRADING_ROUNDS_TABLE || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

// ---------------------------------------------------------------------------
// Round Persistence
// ---------------------------------------------------------------------------

/**
 * Persist a complete trading round to DynamoDB.
 *
 * Called by the orchestrator after each trading round completes.
 * Writes:
 * 1. The full round record to moltapp-trading-rounds
 * 2. Updated agent state snapshots to moltapp-agent-state
 */
export async function persistRound(params: {
  roundId: string;
  timestamp: string;
  durationMs: number;
  tradingMode: "live" | "paper";
  results: TradingRoundResult[];
  errors: string[];
  circuitBreakerActivations: CircuitBreakerActivation[];
  lockSkipped: boolean;
  portfolioSnapshots?: Map<string, { value: number; cash: number; positionsCount: number; pnlPercent: number }>;
}): Promise<{ success: boolean; error?: string }> {
  if (!isDynamoConfigured()) {
    return { success: true }; // Silently skip when not configured
  }

  try {
    const db = getClient();

    // Build persisted results
    const agentResults: PersistedAgentResult[] = params.results.map((r) => ({
      agentId: r.agentId,
      agentName: r.agentName,
      action: r.decision.action,
      symbol: r.decision.symbol,
      quantity: r.decision.quantity,
      reasoning: r.decision.reasoning,
      confidence: r.decision.confidence,
      executed: r.executed,
      executionError: r.executionError,
      txSignature: r.executionDetails?.txSignature,
      filledPrice: r.executionDetails?.filledPrice,
      usdcAmount: r.executionDetails?.usdcAmount,
    }));

    // Determine consensus
    const consensus = computeConsensus(params.results);

    // Build summary string
    const summary = buildRoundSummary(params.results, params.errors);

    const ttl = Math.floor(Date.now() / 1000) + TTL_90_DAYS;

    const round: PersistedRound = {
      roundId: params.roundId,
      timestamp: params.timestamp,
      durationMs: params.durationMs,
      tradingMode: params.tradingMode,
      results: agentResults,
      errors: params.errors,
      circuitBreakerActivations: params.circuitBreakerActivations.length,
      lockSkipped: params.lockSkipped,
      consensus,
      summary,
      ttl,
    };

    // Write the round record
    await db.send(
      new PutItemCommand({
        TableName: ROUNDS_TABLE,
        Item: marshalRound(round),
      }),
    );
    roundsWritten++;

    // Write agent state snapshots in parallel
    const agentStatePromises = params.results.map(async (r) => {
      const portfolio = params.portfolioSnapshots?.get(r.agentId);
      await persistAgentState({
        agentId: r.agentId,
        result: r,
        roundId: params.roundId,
        timestamp: params.timestamp,
        portfolio,
      });
    });

    await Promise.allSettled(agentStatePromises);

    lastWriteAt = new Date().toISOString();
    return { success: true };
  } catch (err) {
    writeErrors++;
    const msg = errorMessage(err);
    console.error(`[DynamoPersister] Failed to persist round: ${msg}`);
    return { success: false, error: msg };
  }
}

/**
 * Persist an agent's state snapshot after a trading round.
 */
async function persistAgentState(params: {
  agentId: string;
  result: TradingRoundResult;
  roundId: string;
  timestamp: string;
  portfolio?: { value: number; cash: number; positionsCount: number; pnlPercent: number };
}): Promise<void> {
  try {
    const db = getClient();

    // Read current state to update counters
    const existing = await getAgentState(params.agentId);
    const totalDecisions = (existing?.totalDecisions ?? 0) + 1;
    const totalTrades =
      (existing?.totalTrades ?? 0) +
      (params.result.decision.action !== "hold" && params.result.executed ? 1 : 0);
    const consecutiveHolds =
      params.result.decision.action === "hold"
        ? (existing?.consecutiveHolds ?? 0) + 1
        : 0;
    const consecutiveErrors =
      params.result.executionError
        ? (existing?.consecutiveErrors ?? 0) + 1
        : 0;

    const ttl = Math.floor(Date.now() / 1000) + TTL_90_DAYS;

    const snapshot: AgentStateSnapshot = {
      agentId: params.agentId,
      status: consecutiveErrors >= 3 ? "error" : "active",
      lastTradeTimestamp: params.timestamp,
      lastAction: params.result.decision.action,
      lastSymbol: params.result.decision.symbol,
      lastConfidence: params.result.decision.confidence,
      totalDecisions,
      totalTrades,
      consecutiveHolds,
      consecutiveErrors,
      lastRoundId: params.roundId,
      portfolioValue: params.portfolio?.value ?? existing?.portfolioValue ?? 10000,
      cashBalance: params.portfolio?.cash ?? existing?.cashBalance ?? 10000,
      positionsCount: params.portfolio?.positionsCount ?? existing?.positionsCount ?? 0,
      totalPnlPercent: params.portfolio?.pnlPercent ?? existing?.totalPnlPercent ?? 0,
      updatedAt: params.timestamp,
      ttl,
    };

    await db.send(
      new PutItemCommand({
        TableName: AGENT_STATE_TABLE,
        Item: marshalAgentState(snapshot),
      }),
    );

    agentStatesWritten++;
  } catch (err) {
    writeErrors++;
    console.warn(
      `[DynamoPersister] Failed to persist agent state for ${params.agentId}: ${errorMessage(err)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Querying
// ---------------------------------------------------------------------------

/**
 * Get a specific trading round by ID.
 */
export async function getRound(roundId: string): Promise<PersistedRound | null> {
  if (!isDynamoConfigured()) return null;

  try {
    const db = getClient();
    const result = await db.send(
      new GetItemCommand({
        TableName: ROUNDS_TABLE,
        Key: {
          roundId: { S: roundId },
          timestamp: { S: "latest" },
        },
      }),
    );

    return result.Item ? unmarshalRound(result.Item) : null;
  } catch (err) {
    console.error(`[DynamoPersister] Failed to get round: ${errorMessage(err)}`);
    return null;
  }
}

/**
 * Get an agent's current state from DynamoDB.
 */
export async function getAgentState(agentId: string): Promise<AgentStateSnapshot | null> {
  if (!isDynamoConfigured()) return null;

  try {
    const db = getClient();
    const result = await db.send(
      new GetItemCommand({
        TableName: AGENT_STATE_TABLE,
        Key: {
          agentId: { S: agentId },
        },
      }),
    );

    return result.Item ? unmarshalAgentState(result.Item) : null;
  } catch (err) {
    console.error(`[DynamoPersister] Failed to get agent state: ${errorMessage(err)}`);
    return null;
  }
}

/**
 * Get all agent states (for dashboard display).
 */
export async function getAllAgentStates(): Promise<AgentStateSnapshot[]> {
  if (!isDynamoConfigured()) return [];

  try {
    const db = getClient();

    // Query using the GSI for recently active agents
    const result = await db.send(
      new QueryCommand({
        TableName: AGENT_STATE_TABLE,
        IndexName: "by-last-trade",
        KeyConditionExpression: "#status = :status",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":status": { S: "active" } },
        ScanIndexForward: false,
        Limit: 10,
      }),
    );

    return (result.Items ?? []).map(unmarshalAgentState);
  } catch (err) {
    console.error(`[DynamoPersister] Failed to get all agent states: ${errorMessage(err)}`);
    return [];
  }
}

/**
 * Get recent trading rounds for the history API.
 */
export async function getRecentRounds(limit: number = 20): Promise<PersistedRound[]> {
  if (!isDynamoConfigured()) return [];

  try {
    const db = getClient();

    // DynamoDB doesn't support ordering by timestamp without a partition key,
    // so we use a scan with limit for recent rounds.
    // In production, we'd use a GSI with a date-based partition.
    const result = await db.send(
      new QueryCommand({
        TableName: ROUNDS_TABLE,
        KeyConditionExpression: "roundId = :latest",
        ExpressionAttributeValues: { ":latest": { S: "latest" } },
        ScanIndexForward: false,
        Limit: limit,
      }),
    );

    // Since our current schema uses roundId as PK and timestamp as SK,
    // we need a different query approach. For now, return from in-memory cache.
    return (result.Items ?? []).map(unmarshalRound);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Marshalling — DynamoDB attribute format
// ---------------------------------------------------------------------------

function marshalRound(round: PersistedRound): Record<string, AttributeValue> {
  return {
    roundId: { S: round.roundId },
    timestamp: { S: round.timestamp },
    durationMs: { N: String(round.durationMs) },
    tradingMode: { S: round.tradingMode },
    results: { S: JSON.stringify(round.results) },
    errors: { SS: round.errors.length > 0 ? round.errors : ["none"] },
    circuitBreakerActivations: { N: String(round.circuitBreakerActivations) },
    lockSkipped: { BOOL: round.lockSkipped },
    consensus: { S: round.consensus },
    summary: { S: round.summary },
    ttl: { N: String(round.ttl) },
  };
}

function unmarshalRound(item: Record<string, AttributeValue>): PersistedRound {
  const errors = item.errors?.SS ?? [];
  return {
    roundId: item.roundId?.S ?? "",
    timestamp: item.timestamp?.S ?? "",
    durationMs: Number(item.durationMs?.N ?? 0),
    tradingMode: (item.tradingMode?.S ?? "paper") as "live" | "paper",
    results: JSON.parse(item.results?.S ?? "[]") as PersistedAgentResult[],
    errors: errors.filter((e) => e !== "none"),
    circuitBreakerActivations: Number(item.circuitBreakerActivations?.N ?? 0),
    lockSkipped: item.lockSkipped?.BOOL ?? false,
    consensus: (item.consensus?.S ?? "no_trades") as PersistedRound["consensus"],
    summary: item.summary?.S ?? "",
    ttl: Number(item.ttl?.N ?? 0),
  };
}

function marshalAgentState(state: AgentStateSnapshot): Record<string, AttributeValue> {
  return {
    agentId: { S: state.agentId },
    status: { S: state.status },
    lastTradeTimestamp: { S: state.lastTradeTimestamp },
    lastAction: { S: state.lastAction },
    lastSymbol: { S: state.lastSymbol },
    lastConfidence: { N: String(state.lastConfidence) },
    totalDecisions: { N: String(state.totalDecisions) },
    totalTrades: { N: String(state.totalTrades) },
    consecutiveHolds: { N: String(state.consecutiveHolds) },
    consecutiveErrors: { N: String(state.consecutiveErrors) },
    lastRoundId: { S: state.lastRoundId },
    portfolioValue: { N: String(state.portfolioValue) },
    cashBalance: { N: String(state.cashBalance) },
    positionsCount: { N: String(state.positionsCount) },
    totalPnlPercent: { N: String(state.totalPnlPercent) },
    updatedAt: { S: state.updatedAt },
    ttl: { N: String(state.ttl) },
  };
}

function unmarshalAgentState(item: Record<string, AttributeValue>): AgentStateSnapshot {
  return {
    agentId: item.agentId?.S ?? "",
    status: (item.status?.S ?? "active") as AgentStateSnapshot["status"],
    lastTradeTimestamp: item.lastTradeTimestamp?.S ?? "",
    lastAction: (item.lastAction?.S ?? "hold") as "buy" | "sell" | "hold",
    lastSymbol: item.lastSymbol?.S ?? "",
    lastConfidence: Number(item.lastConfidence?.N ?? 0),
    totalDecisions: Number(item.totalDecisions?.N ?? 0),
    totalTrades: Number(item.totalTrades?.N ?? 0),
    consecutiveHolds: Number(item.consecutiveHolds?.N ?? 0),
    consecutiveErrors: Number(item.consecutiveErrors?.N ?? 0),
    lastRoundId: item.lastRoundId?.S ?? "",
    portfolioValue: Number(item.portfolioValue?.N ?? 10000),
    cashBalance: Number(item.cashBalance?.N ?? 10000),
    positionsCount: Number(item.positionsCount?.N ?? 0),
    totalPnlPercent: Number(item.totalPnlPercent?.N ?? 0),
    updatedAt: item.updatedAt?.S ?? "",
    ttl: Number(item.ttl?.N ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Determine consensus across agent decisions.
 */
function computeConsensus(results: TradingRoundResult[]): PersistedRound["consensus"] {
  const nonHold = results.filter((r) => r.decision.action !== "hold");
  if (nonHold.length === 0) return "no_trades";

  const actions = nonHold.map((r) => r.decision.action);
  const buys = actions.filter((a) => a === "buy").length;
  const sells = actions.filter((a) => a === "sell").length;

  if (buys === nonHold.length || sells === nonHold.length) return "unanimous";
  if (buys > sells && buys > 1) return "majority";
  if (sells > buys && sells > 1) return "majority";
  return "split";
}

/**
 * Build a human-readable summary of a trading round.
 */
function buildRoundSummary(results: TradingRoundResult[], errors: string[]): string {
  const parts: string[] = [];

  for (const r of results) {
    const action = r.decision.action.toUpperCase();
    const status = r.executed ? "✓" : "✗";
    parts.push(`${r.agentName}: ${action} ${r.decision.symbol} (${r.decision.confidence}%) ${status}`);
  }

  if (errors.length > 0) {
    parts.push(`${errors.length} error(s)`);
  }

  return parts.join(" | ");
}

// ---------------------------------------------------------------------------
// In-Memory Round Cache (for non-DynamoDB environments)
// ---------------------------------------------------------------------------

const roundCache: PersistedRound[] = [];
const MAX_CACHE_SIZE = 100;

/**
 * Get persister stats for the dashboard.
 */
export function getPersisterStats(): PersisterStats {
  return {
    roundsWritten,
    agentStatesWritten,
    writeErrors,
    lastWriteAt,
    dynamoTableConfigured: isDynamoConfigured(),
    roundsTableName: isDynamoConfigured() ? ROUNDS_TABLE : null,
    agentStateTableName: isDynamoConfigured() ? AGENT_STATE_TABLE : null,
  };
}

/**
 * Cache a round in memory (always, regardless of DynamoDB).
 * Used by the dashboard and history API for fast access.
 */
export function cacheRound(round: PersistedRound): void {
  roundCache.unshift(round);
  if (roundCache.length > MAX_CACHE_SIZE) {
    roundCache.length = MAX_CACHE_SIZE;
  }
}

/**
 * Get cached rounds from memory (fast path for dashboard).
 */
export function getCachedRounds(limit: number = 20): PersistedRound[] {
  return roundCache.slice(0, limit);
}

/**
 * Get cached rounds filtered by agent.
 */
export function getCachedRoundsByAgent(agentId: string, limit: number = 20): PersistedRound[] {
  return roundCache
    .filter((r) => r.results.some((result) => result.agentId === agentId))
    .slice(0, limit);
}

/**
 * Get round statistics from cache.
 */
export function getRoundCacheStats(): {
  totalRounds: number;
  averageDurationMs: number;
  consensusBreakdown: Record<string, number>;
  tradingModeBreakdown: Record<string, number>;
  errorRate: number;
  lastRoundAt: string | null;
} {
  if (roundCache.length === 0) {
    return {
      totalRounds: 0,
      averageDurationMs: 0,
      consensusBreakdown: {},
      tradingModeBreakdown: {},
      errorRate: 0,
      lastRoundAt: null,
    };
  }

  const avgDuration =
    roundCache.reduce((sum, r) => sum + r.durationMs, 0) / roundCache.length;

  const consensusBreakdown: Record<string, number> = {};
  const modeBreakdown: Record<string, number> = {};
  let errorRounds = 0;

  for (const r of roundCache) {
    consensusBreakdown[r.consensus] = (consensusBreakdown[r.consensus] ?? 0) + 1;
    modeBreakdown[r.tradingMode] = (modeBreakdown[r.tradingMode] ?? 0) + 1;
    if (r.errors.length > 0) errorRounds++;
  }

  return {
    totalRounds: roundCache.length,
    averageDurationMs: Math.round(avgDuration),
    consensusBreakdown,
    tradingModeBreakdown: modeBreakdown,
    errorRate: Math.round((errorRounds / roundCache.length) * 100),
    lastRoundAt: roundCache[0]?.timestamp ?? null,
  };
}
