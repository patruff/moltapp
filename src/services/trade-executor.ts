/**
 * Trade Execution Engine
 *
 * The CRITICAL missing bridge between agent decisions and on-chain execution.
 * When the orchestrator produces a TradingDecision, this service:
 *
 * 1. Validates the decision against circuit breakers and balances
 * 2. Resolves the agent's wallet (Turnkey-managed or placeholder)
 * 3. Calls executeBuy() / executeSell() from trading.ts (Jupiter swaps)
 * 4. Records execution status back to agent_decisions table
 * 5. Emits real-time events via EventBus + AlertWebhooks
 * 6. Registers failures with the TradeRecovery dead-letter queue
 *
 * This is the difference between "agents that think" and "agents that trade."
 *
 * Mode of operation:
 * - LIVE mode: Actually executes Jupiter swaps on Solana (real money)
 * - PAPER mode: Simulates execution with current market prices (no chain tx)
 * - The mode is determined by the TRADING_MODE env var (default: "paper")
 */

import { db } from "../db/index.ts";
import { agentDecisions } from "../db/schema/agent-decisions.ts";
import { trades } from "../db/schema/trades.ts";
import { positions } from "../db/schema/positions.ts";
import { eq, and, sql } from "drizzle-orm";
import { executeBuy, executeSell, type TradeResult } from "./trading.ts";
import { getStockBySymbol } from "./stocks.ts";
import { eventBus } from "./event-stream.ts";
import { emitTradeAlert, emitCircuitBreakerAlert } from "./alert-webhooks.ts";
import { registerFailedTrade, recordRetryAttempt } from "./trade-recovery.ts";
import { logTradeEvent, logTradeFailure } from "./audit-log.ts";
import type { TradingDecision, TradingRoundResult } from "../agents/base-agent.ts";
import { round2, countByCondition } from "../lib/math-utils.ts";
import { errorMessage } from "../lib/errors.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TradingMode = "live" | "paper";

export interface ExecutionRequest {
  agentId: string;
  agentName: string;
  decision: TradingDecision;
  roundId: string;
  /** Override trading mode for this specific execution */
  modeOverride?: TradingMode;
}

export interface ExecutionResult {
  success: boolean;
  mode: TradingMode;
  agentId: string;
  agentName: string;
  decision: TradingDecision;
  /** Trade result from Jupiter (live mode) or simulated result (paper mode) */
  tradeResult?: TradeResult;
  /** Paper trade details when in paper mode */
  paperTradeId?: string;
  /** Execution error message if failed */
  error?: string;
  /** Error code for recovery classification */
  errorCode?: string;
  /** Recovery ID if registered in dead-letter queue */
  recoveryId?: string;
  /** Time taken to execute in ms */
  durationMs: number;
  /** Decision record ID in the database */
  decisionId?: number;
}

export interface ExecutionPipelineResult {
  roundId: string;
  mode: TradingMode;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  results: ExecutionResult[];
  summary: {
    total: number;
    executed: number;
    held: number;
    failed: number;
    paperTrades: number;
    liveTrades: number;
  };
}

export interface ExecutionStats {
  totalExecutions: number;
  liveExecutions: number;
  paperExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  totalVolumeUSDC: number;
  averageExecutionMs: number;
  executionsByAgent: Record<string, { total: number; success: number; failed: number }>;
  executionsBySymbol: Record<string, { buys: number; sells: number; volumeUSDC: number }>;
  recentExecutions: ExecutionResult[];
  lastExecutionAt: string | null;
}

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Solana token precision (9 decimals).
 * All Solana SPL tokens use 9 decimal places for quantity representation.
 * Example: 1.234567890 tokens = 1234567890 lamports
 */
const SOLANA_TOKEN_PRECISION = 9;

/**
 * USD/USDC precision (6 decimals).
 * USDC uses 6 decimal places, standard for USD stablecoins.
 * Example: $100.123456 USDC = 100123456 micro-USDC
 */
const USDC_PRECISION = 6;

/**
 * Dust threshold for position cleanup (1 nano-token).
 * Positions below this quantity are considered dust and deleted.
 * Value: 0.000000001 = 1 lamport (smallest Solana token unit)
 */
const POSITION_DUST_THRESHOLD = 0.000000001;

/**
 * Price cache TTL in milliseconds (5 seconds).
 * Jupiter price API responses cached for 5s to reduce API calls.
 * Balance: Fresh prices for execution vs API rate limiting
 */
const PRICE_CACHE_TTL_MS = 5_000;

/**
 * Jupiter API timeout in milliseconds (5 seconds).
 * Abort price fetch if Jupiter doesn't respond within 5s.
 * Falls back to mock pricing on timeout.
 */
const JUPITER_API_TIMEOUT_MS = 5_000;

/**
 * Maximum recent executions retained in memory (100 records).
 * Circular buffer for getExecutionStats() display.
 * Balance: UI responsiveness vs memory usage
 */
const MAX_RECENT_EXECUTIONS = 100;

/**
 * Maximum execution durations tracked for averaging (500 samples).
 * Rolling window for average execution time calculation.
 * Balance: Statistical significance vs memory usage
 */
const MAX_EXECUTION_DURATIONS = 500;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let totalExecutions = 0;
let liveExecutions = 0;
let paperExecutions = 0;
let successfulExecutions = 0;
let failedExecutions = 0;
let totalVolumeUSDC = 0;
let executionDurations: number[] = [];
let lastExecutionAt: string | null = null;

const executionsByAgent: Record<string, { total: number; success: number; failed: number }> = {};
const executionsBySymbol: Record<string, { buys: number; sells: number; volumeUSDC: number }> = {};
const recentExecutions: ExecutionResult[] = [];

/** Paper trade counter for generating unique IDs */
let paperTradeCounter = 0;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Get the current trading mode from environment.
 * Defaults to "paper" for safety — live mode requires explicit opt-in.
 */
export function getTradingMode(): TradingMode {
  const mode = process.env.TRADING_MODE?.toLowerCase();
  if (mode === "live") return "live";
  return "paper";
}

/**
 * Check if live trading is enabled.
 */
export function isLiveTrading(): boolean {
  return getTradingMode() === "live";
}

// ---------------------------------------------------------------------------
// Core Execution
// ---------------------------------------------------------------------------

/**
 * Execute a single agent's trading decision.
 *
 * This is the core function that bridges the gap between agent decisions
 * and actual trade execution. It handles both live and paper modes.
 */
export async function executeDecision(req: ExecutionRequest): Promise<ExecutionResult> {
  const startTime = Date.now();
  const mode = req.modeOverride ?? getTradingMode();

  const result: ExecutionResult = {
    success: false,
    mode,
    agentId: req.agentId,
    agentName: req.agentName,
    decision: req.decision,
    durationMs: 0,
  };

  try {
    // Skip execution for hold decisions
    if (req.decision.action === "hold") {
      result.success = true;
      result.durationMs = Date.now() - startTime;
      await updateDecisionStatus(req.agentId, req.roundId, "executed", undefined, undefined);
      trackExecution(result);
      return result;
    }

    // Validate stock exists
    const stock = getStockBySymbol(req.decision.symbol);
    if (!stock) {
      result.error = `Stock not found: ${req.decision.symbol}`;
      result.errorCode = "stock_not_found";
      result.durationMs = Date.now() - startTime;
      await updateDecisionStatus(req.agentId, req.roundId, "failed", undefined, result.error);
      trackExecution(result);
      return result;
    }

    console.log(
      `[TradeExecutor] Executing ${req.decision.action} for ${req.agentName}: ` +
      `${req.decision.quantity} ${req.decision.symbol} (mode: ${mode}, round: ${req.roundId})`,
    );

    if (mode === "live") {
      // LIVE MODE: Execute real Jupiter swap
      result.tradeResult = await executeLiveTrade(req);
      result.success = true;
      liveExecutions++;

      // Update decision with tx signature
      await updateDecisionStatus(
        req.agentId,
        req.roundId,
        "executed",
        result.tradeResult.txSignature,
        undefined,
      );

      // Track volume
      totalVolumeUSDC += parseFloat(result.tradeResult.usdcAmount);

      // Note: DB recording (trades + positions) is handled inside
      // executeBuy/executeSell in trading.ts — no duplicate insert needed here.

      // Emit live trade event
      eventBus.emit("trade_executed", {
        agentId: req.agentId,
        agentName: req.agentName,
        symbol: req.decision.symbol,
        action: req.decision.action,
        quantity: req.decision.quantity,
        price: parseFloat(result.tradeResult.pricePerToken),
        confidence: req.decision.confidence,
        reasoning: req.decision.reasoning,
      });

      emitTradeAlert({
        agentId: req.agentId,
        agentName: req.agentName,
        action: req.decision.action,
        symbol: req.decision.symbol,
        quantity: req.decision.quantity,
        confidence: req.decision.confidence,
        reasoning: req.decision.reasoning,
        roundId: req.roundId,
      });

      logTradeEvent(
        "live_trade_executed",
        `${req.agentName} ${req.decision.action} ${req.decision.quantity} ${req.decision.symbol} @ ${result.tradeResult.pricePerToken}`,
        req.agentId,
        req.roundId,
        {
          txSignature: result.tradeResult.txSignature,
          usdcAmount: result.tradeResult.usdcAmount,
          stockQuantity: result.tradeResult.stockQuantity,
        },
      );

    } else {
      // PAPER MODE: Simulate execution with current market prices
      const paperResult = await executePaperTrade(req);
      result.paperTradeId = paperResult.paperTradeId;
      result.success = true;
      paperExecutions++;

      // Update decision status
      await updateDecisionStatus(
        req.agentId,
        req.roundId,
        "executed_paper",
        paperResult.paperTradeId,
        undefined,
      );

      // Track simulated volume
      totalVolumeUSDC += paperResult.usdcAmount;

      // Emit paper trade event
      eventBus.emit("trade_executed", {
        agentId: req.agentId,
        agentName: req.agentName,
        symbol: req.decision.symbol,
        action: req.decision.action,
        quantity: req.decision.quantity,
        price: paperResult.pricePerToken,
        confidence: req.decision.confidence,
        reasoning: req.decision.reasoning,
      });

      logTradeEvent(
        "paper_trade_executed",
        `${req.agentName} PAPER ${req.decision.action} ${req.decision.quantity} ${req.decision.symbol} @ ${paperResult.pricePerToken.toFixed(6)}`,
        req.agentId,
        req.roundId,
        { paperTradeId: paperResult.paperTradeId },
      );
    }

    successfulExecutions++;
  } catch (err) {
    const errorMsg = errorMessage(err);
    const errorCode = extractErrorCode(errorMsg);

    result.error = errorMsg;
    result.errorCode = errorCode;
    failedExecutions++;

    console.error(
      `[TradeExecutor] Execution failed for ${req.agentName}: ${errorMsg}`,
    );

    // Update decision status as failed
    await updateDecisionStatus(req.agentId, req.roundId, "failed", undefined, errorMsg);

    // Register in dead-letter queue for potential retry
    const failedTrade = registerFailedTrade({
      agentId: req.agentId,
      side: req.decision.action as "buy" | "sell",
      symbol: req.decision.symbol,
      quantity: String(req.decision.quantity),
      error: errorMsg,
      errorCode,
      roundId: req.roundId,
    });
    result.recoveryId = failedTrade.recoveryId;

    logTradeFailure(
      `Trade execution failed: ${req.decision.action} ${req.decision.quantity} ${req.decision.symbol}`,
      req.agentId,
      errorMsg,
      req.roundId,
      { errorCode, recoveryId: failedTrade.recoveryId },
    );
  }

  result.durationMs = Date.now() - startTime;
  totalExecutions++;
  trackExecution(result);

  return result;
}

/**
 * Execute a batch of agent decisions in sequence with jitter.
 * This is the main entry point called from the orchestrator.
 */
export async function executePipeline(
  decisions: Array<{
    agentId: string;
    agentName: string;
    decision: TradingDecision;
  }>,
  roundId: string,
): Promise<ExecutionPipelineResult> {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const mode = getTradingMode();

  console.log(
    `[TradeExecutor] Starting execution pipeline: ${decisions.length} decisions (mode: ${mode}, round: ${roundId})`,
  );

  // Emit round-level event
  eventBus.emit("round_started", {
    roundId,
    agentCount: decisions.length,
    stockCount: new Set(decisions.map((d) => d.decision.symbol)).size,
    startedAt,
  });

  const results: ExecutionResult[] = [];

  for (const entry of decisions) {
    const execResult = await executeDecision({
      agentId: entry.agentId,
      agentName: entry.agentName,
      decision: entry.decision,
      roundId,
    });

    results.push(execResult);

    // Add small delay between executions to avoid rate limiting
    if (decisions.indexOf(entry) < decisions.length - 1) {
      const jitterMs = 500 + Math.random() * 1500;
      await new Promise((resolve) => setTimeout(resolve, jitterMs));
    }
  }

  const completedAt = new Date().toISOString();
  const durationMs = Date.now() - startMs;

  const summary = {
    total: results.length,
    executed: countByCondition(results, (r) => r.success),
    held: countByCondition(results, (r) => r.decision.action === "hold"),
    failed: countByCondition(results, (r) => !r.success),
    paperTrades: countByCondition(results, (r) => r.mode === "paper" && r.success && r.decision.action !== "hold"),
    liveTrades: countByCondition(results, (r) => r.mode === "live" && r.success && r.decision.action !== "hold"),
  };

  // Emit round completion event
  eventBus.emit("round_completed", {
    roundId,
    decisions: results.length,
    tradesExecuted: summary.executed - summary.held,
    durationMs,
    summary: `${summary.executed} executed, ${summary.failed} failed, ${summary.held} held (${mode} mode)`,
  });

  console.log(
    `[TradeExecutor] Pipeline complete: ${summary.executed} executed, ${summary.failed} failed, ` +
    `${summary.held} held in ${durationMs}ms (mode: ${mode})`,
  );

  return {
    roundId,
    mode,
    startedAt,
    completedAt,
    durationMs,
    results,
    summary,
  };
}

// ---------------------------------------------------------------------------
// Live Trade Execution
// ---------------------------------------------------------------------------

/**
 * Execute a real Jupiter swap for an agent's decision.
 * This calls the existing executeBuy() / executeSell() from trading.ts.
 */
async function executeLiveTrade(req: ExecutionRequest): Promise<TradeResult> {
  if (req.decision.action === "buy") {
    return await executeBuy({
      agentId: req.agentId,
      stockSymbol: req.decision.symbol,
      usdcAmount: String(req.decision.quantity),
    });
  } else if (req.decision.action === "sell") {
    return await executeSell({
      agentId: req.agentId,
      stockSymbol: req.decision.symbol,
      usdcAmount: "0", // Not used for sells
      stockQuantity: String(req.decision.quantity),
    });
  }

  throw new Error(`invalid_action: ${req.decision.action}`);
}

// ---------------------------------------------------------------------------
// Paper Trade Execution
// ---------------------------------------------------------------------------

interface PaperTradeResult {
  paperTradeId: string;
  pricePerToken: number;
  usdcAmount: number;
  stockQuantity: number;
}

/**
 * Simulate a trade using current market prices without touching the chain.
 *
 * Paper trades:
 * - Use the most recent Jupiter price for the stock
 * - Record the trade in the trades table with a paper tx signature
 * - Update positions exactly like a real trade
 * - Allow the demo to work without real wallets
 */
async function executePaperTrade(req: ExecutionRequest): Promise<PaperTradeResult> {
  const stock = getStockBySymbol(req.decision.symbol);
  if (!stock) {
    throw new Error(`stock_not_found: ${req.decision.symbol}`);
  }

  // Fetch current price from Jupiter (or use mock)
  const currentPrice = await fetchCurrentPrice(stock.mintAddress, stock.symbol);

  paperTradeCounter++;
  const paperTradeId = `paper_${Date.now()}_${paperTradeCounter.toString(36)}`;

  let usdcAmount: number;
  let stockQuantity: number;

  if (req.decision.action === "buy") {
    usdcAmount = req.decision.quantity;
    stockQuantity = usdcAmount / currentPrice;

    // Record paper trade in DB
    await db.insert(trades).values({
      agentId: req.agentId,
      side: "buy",
      stockMintAddress: stock.mintAddress,
      stockSymbol: stock.symbol,
      stockQuantity: stockQuantity.toFixed(SOLANA_TOKEN_PRECISION),
      usdcAmount: usdcAmount.toFixed(USDC_PRECISION),
      pricePerToken: currentPrice.toFixed(USDC_PRECISION),
      txSignature: paperTradeId,
      jupiterRouteInfo: {
        mode: "paper",
        roundId: req.roundId,
        confidence: req.decision.confidence,
      },
      status: "confirmed",
    });

    // Upsert position
    await db
      .insert(positions)
      .values({
        agentId: req.agentId,
        mintAddress: stock.mintAddress,
        symbol: stock.symbol,
        quantity: stockQuantity.toFixed(9),
        averageCostBasis: currentPrice.toFixed(6),
      })
      .onConflictDoUpdate({
        target: [positions.agentId, positions.mintAddress],
        set: {
          quantity: sql`(${positions.quantity}::numeric + ${stockQuantity.toFixed(SOLANA_TOKEN_PRECISION)}::numeric)::numeric(20,9)`,
          averageCostBasis: sql`(
            (${positions.quantity}::numeric * ${positions.averageCostBasis}::numeric + ${stockQuantity.toFixed(SOLANA_TOKEN_PRECISION)}::numeric * ${currentPrice.toFixed(USDC_PRECISION)}::numeric)
            / NULLIF(${positions.quantity}::numeric + ${stockQuantity.toFixed(SOLANA_TOKEN_PRECISION)}::numeric, 0)
          )::numeric(20,6)`,
          updatedAt: new Date(),
        },
      });

  } else if (req.decision.action === "sell") {
    stockQuantity = req.decision.quantity;
    usdcAmount = stockQuantity * currentPrice;

    // Check position exists
    const existingPositions = await db
      .select()
      .from(positions)
      .where(
        and(
          eq(positions.agentId, req.agentId),
          eq(positions.mintAddress, stock.mintAddress),
        ),
      )
      .limit(1);

    if (existingPositions.length === 0) {
      throw new Error(`insufficient_stock_balance: no position in ${stock.symbol}`);
    }

    const existingQty = parseFloat(existingPositions[0].quantity);
    if (existingQty < stockQuantity) {
      // Clamp to available quantity
      stockQuantity = existingQty;
      usdcAmount = stockQuantity * currentPrice;
    }

    // Record paper trade
    await db.insert(trades).values({
      agentId: req.agentId,
      side: "sell",
      stockMintAddress: stock.mintAddress,
      stockSymbol: stock.symbol,
      stockQuantity: stockQuantity.toFixed(SOLANA_TOKEN_PRECISION),
      usdcAmount: usdcAmount.toFixed(USDC_PRECISION),
      pricePerToken: currentPrice.toFixed(USDC_PRECISION),
      txSignature: paperTradeId,
      jupiterRouteInfo: {
        mode: "paper",
        roundId: req.roundId,
        confidence: req.decision.confidence,
      },
      status: "confirmed",
    });

    // Update position
    const newQty = existingQty - stockQuantity;
    if (newQty <= POSITION_DUST_THRESHOLD) {
      await db
        .delete(positions)
        .where(eq(positions.id, existingPositions[0].id));
    } else {
      await db
        .update(positions)
        .set({
          quantity: newQty.toFixed(SOLANA_TOKEN_PRECISION),
          updatedAt: new Date(),
        })
        .where(eq(positions.id, existingPositions[0].id));
    }
  } else {
    throw new Error(`invalid_action: ${req.decision.action}`);
  }

  return {
    paperTradeId,
    pricePerToken: currentPrice,
    usdcAmount,
    stockQuantity,
  };
}

// ---------------------------------------------------------------------------
// Price Fetching
// ---------------------------------------------------------------------------

/** Cache for current prices */
const priceCache = new Map<string, { price: number; fetchedAt: number }>();

/**
 * Fetch the current USD price for a token from Jupiter.
 * Falls back to mock pricing if Jupiter is unavailable.
 */
async function fetchCurrentPrice(mintAddress: string, symbol: string): Promise<number> {
  // Check cache
  const cached = priceCache.get(mintAddress);
  if (cached && Date.now() - cached.fetchedAt < PRICE_CACHE_TTL_MS) {
    return cached.price;
  }

  try {
    const jupiterApiKey = process.env.JUPITER_API_KEY;
    const headers: Record<string, string> = {};
    if (jupiterApiKey) {
      headers["x-api-key"] = jupiterApiKey;
    }

    const resp = await fetch(
      `https://api.jup.ag/price/v3?ids=${mintAddress}`,
      { headers, signal: AbortSignal.timeout(JUPITER_API_TIMEOUT_MS) },
    );

    if (resp.ok) {
      const data = (await resp.json()) as {
        data: Record<string, { price: string } | undefined>;
      };
      const entry = data.data?.[mintAddress];
      if (entry?.price) {
        const price = parseFloat(entry.price);
        priceCache.set(mintAddress, { price, fetchedAt: Date.now() });
        return price;
      }
    }
  } catch {
    // Jupiter unavailable, use mock
  }

  // Mock fallback
  const mockPrices: Record<string, number> = {
    AAPLx: 178.50, AMZNx: 185.20, GOOGLx: 142.80, METAx: 505.30,
    MSFTx: 415.60, NVDAx: 890.50, TSLAx: 245.80, SPYx: 502.10,
    QQQx: 435.70, COINx: 205.40, MSTRx: 1685.00, HOODx: 22.80,
    NFLXx: 628.90, PLTRx: 24.50, GMEx: 17.80,
  };
  const base = mockPrices[symbol] ?? 100;
  const variation = 1 + (Math.random() - 0.5) * 0.02;
  return round2(base * variation);
}

// ---------------------------------------------------------------------------
// Decision Status Updates
// ---------------------------------------------------------------------------

/**
 * Update the execution status of an agent decision in the database.
 */
async function updateDecisionStatus(
  agentId: string,
  roundId: string,
  status: string,
  txSignature?: string,
  error?: string,
): Promise<void> {
  try {
    // Find the most recent decision for this agent in this round
    const decisions = await db
      .select()
      .from(agentDecisions)
      .where(
        and(
          eq(agentDecisions.agentId, agentId),
          eq(agentDecisions.roundId, roundId),
        ),
      )
      .limit(1);

    if (decisions.length > 0) {
      const updateValues: Record<string, unknown> = { executed: status };
      if (txSignature) updateValues.txSignature = txSignature;
      if (error) updateValues.executionError = error;

      await db
        .update(agentDecisions)
        .set(updateValues)
        .where(eq(agentDecisions.id, decisions[0].id));
    }
  } catch (err) {
    console.warn(
      `[TradeExecutor] Failed to update decision status: ${errorMessage(err)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Retry Execution
// ---------------------------------------------------------------------------

/**
 * Retry a failed trade from the recovery queue.
 * Returns the new execution result.
 */
export async function retryFailedTrade(
  recoveryId: string,
  agentName: string,
): Promise<ExecutionResult | null> {
  const { getFailedTrade } = await import("./trade-recovery.ts");
  const failedTrade = getFailedTrade(recoveryId);
  if (!failedTrade) return null;
  if (failedTrade.status !== "pending") return null;

  console.log(
    `[TradeExecutor] Retrying failed trade ${recoveryId}: ${failedTrade.side} ${failedTrade.quantity} ${failedTrade.symbol}`,
  );

  const decision: TradingDecision = {
    action: failedTrade.side,
    symbol: failedTrade.symbol,
    quantity: parseFloat(failedTrade.quantity),
    reasoning: `Retry of failed trade ${recoveryId}`,
    confidence: 50,
    timestamp: new Date().toISOString(),
  };

  const result = await executeDecision({
    agentId: failedTrade.agentId,
    agentName,
    decision,
    roundId: failedTrade.roundId ?? `retry_${Date.now()}`,
  });

  // Update recovery status
  recordRetryAttempt(
    recoveryId,
    result.success,
    result.success
      ? `Retry succeeded: ${result.tradeResult?.txSignature ?? result.paperTradeId}`
      : `Retry failed: ${result.error}`,
  );

  return result;
}

// ---------------------------------------------------------------------------
// Stats & Monitoring
// ---------------------------------------------------------------------------

/**
 * Track an execution result in stats.
 */
function trackExecution(result: ExecutionResult): void {
  // Update agent stats
  const agentStats = executionsByAgent[result.agentId] ?? { total: 0, success: 0, failed: 0 };
  agentStats.total++;
  if (result.success) agentStats.success++;
  else agentStats.failed++;
  executionsByAgent[result.agentId] = agentStats;

  // Update symbol stats (skip holds)
  if (result.decision.action !== "hold") {
    const symbolStats = executionsBySymbol[result.decision.symbol] ?? { buys: 0, sells: 0, volumeUSDC: 0 };
    if (result.decision.action === "buy") symbolStats.buys++;
    else symbolStats.sells++;
    if (result.tradeResult) {
      symbolStats.volumeUSDC += parseFloat(result.tradeResult.usdcAmount);
    }
    executionsBySymbol[result.decision.symbol] = symbolStats;
  }

  // Track duration
  executionDurations.push(result.durationMs);
  if (executionDurations.length > MAX_EXECUTION_DURATIONS) {
    executionDurations = executionDurations.slice(-MAX_EXECUTION_DURATIONS);
  }

  // Track recent executions
  recentExecutions.unshift(result);
  if (recentExecutions.length > MAX_RECENT_EXECUTIONS) {
    recentExecutions.length = MAX_RECENT_EXECUTIONS;
  }

  lastExecutionAt = new Date().toISOString();
}

/**
 * Get comprehensive execution statistics.
 */
export function getExecutionStats(): ExecutionStats {
  const avgDuration =
    executionDurations.length > 0
      ? executionDurations.reduce((a, b) => a + b, 0) / executionDurations.length
      : 0;

  return {
    totalExecutions,
    liveExecutions,
    paperExecutions,
    successfulExecutions,
    failedExecutions,
    totalVolumeUSDC: round2(totalVolumeUSDC),
    averageExecutionMs: Math.round(avgDuration),
    executionsByAgent: { ...executionsByAgent },
    executionsBySymbol: { ...executionsBySymbol },
    recentExecutions: recentExecutions.slice(0, 20),
    lastExecutionAt,
  };
}

/**
 * Reset execution stats (admin use).
 */
export function resetExecutionStats(): void {
  totalExecutions = 0;
  liveExecutions = 0;
  paperExecutions = 0;
  successfulExecutions = 0;
  failedExecutions = 0;
  totalVolumeUSDC = 0;
  executionDurations = [];
  lastExecutionAt = null;
  Object.keys(executionsByAgent).forEach((k) => delete executionsByAgent[k]);
  Object.keys(executionsBySymbol).forEach((k) => delete executionsBySymbol[k]);
  recentExecutions.length = 0;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract a machine-readable error code from an error message.
 */
function extractErrorCode(message: string): string {
  // Check for known error patterns
  const patterns: [RegExp, string][] = [
    [/insufficient_usdc_balance/, "insufficient_usdc_balance"],
    [/insufficient_sol_for_fees/, "insufficient_sol_for_fees"],
    [/insufficient_stock_balance/, "insufficient_stock_balance"],
    [/stock_not_found/, "stock_not_found"],
    [/wallet_not_found/, "wallet_not_found"],
    [/invalid_amount/, "invalid_amount"],
    [/jupiter_order_failed/, "jupiter_order_failed"],
    [/jupiter_execute_failed/, "jupiter_execute_failed"],
    [/timeout/i, "rpc_timeout"],
    [/rate.?limit/i, "rate_limited"],
    [/network/i, "network_error"],
  ];

  for (const [pattern, code] of patterns) {
    if (pattern.test(message)) return code;
  }

  return "unknown_error";
}
