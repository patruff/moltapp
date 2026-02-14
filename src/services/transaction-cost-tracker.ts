/**
 * Transaction Cost Tracker Service
 *
 * Records per-trade transaction costs (slippage + estimated swap fees + network fees)
 * and provides aggregation methods for accurate P&L calculation.
 *
 * Problem: P&L calculations that only compare portfolio value vs initial capital
 * miss the cumulative drag of transaction costs:
 *   - Jupiter swap fees (~0.1-0.5% per trade, varies by route)
 *   - Price slippage (difference between quoted reference price and actual fill)
 *   - Solana network fees (~0.000005 SOL per tx, negligible but tracked)
 *
 * This service tracks these costs in-memory per trade and exposes aggregated
 * totals for the leaderboard to subtract from reported P&L.
 *
 * Storage: In-memory with configurable max retention.
 * Data also persisted in the trades table's jupiterRouteInfo JSONB field.
 */

import { sumByKey } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Maximum number of cost records retained in memory.
 *
 * Older records are evicted (FIFO) when this limit is reached.
 * 10,000 records covers ~2-4 weeks of trading at typical volumes.
 */
const MAX_COST_RECORDS = 10_000;

/**
 * Estimated Jupiter swap fee as a fraction of trade size.
 *
 * Jupiter Ultra charges platform fees that vary by route (0.1-0.5%).
 * We use 0.3% (30bps) as a conservative middle estimate.
 * This is applied when actual fee data isn't available from the swap response.
 */
const ESTIMATED_SWAP_FEE_RATE = 0.003;

/**
 * Estimated Solana network fee per transaction in USDC terms.
 *
 * Base fee is ~0.000005 SOL (~$0.001 at $200/SOL). Priority fees can be higher
 * but are typically under $0.01. We use $0.005 as a reasonable estimate.
 * Negligible per trade but adds up over hundreds of trades.
 */
const ESTIMATED_NETWORK_FEE_USDC = 0.005;

/**
 * Estimated slippage rate for fallback transaction cost calculations.
 *
 * Used in estimateTransactionCosts() when actual slippage data isn't available
 * (e.g., after server restart, before in-memory records accumulate).
 *
 * Conservative estimate: 0.15% (15 bps) average slippage for xStocks on Jupiter.
 * Based on typical xStock liquidity and market conditions:
 *   - High liquidity (AAPLx, MSFTx, TSLAx): ~5-10 bps
 *   - Medium liquidity (NVDAx, GOOGx): ~10-20 bps
 *   - Lower liquidity (smaller cap): ~20-30 bps
 *
 * 15 bps is a reasonable midpoint for portfolio-level estimates.
 * This directly affects P&L calculations shown on the leaderboard when
 * actual measured slippage isn't available from in-memory records.
 */
const ESTIMATED_SLIPPAGE_RATE = 0.0015;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TransactionCostRecord {
  /** Unique trade ID from the trades table */
  tradeId: number;
  /** Agent who executed the trade */
  agentId: string;
  /** Token symbol (e.g., "AAPLx") */
  symbol: string;
  /** Trade side */
  side: "buy" | "sell";
  /** USDC amount of the trade (absolute value) */
  usdcAmount: number;
  /**
   * Actual measured slippage in basis points.
   * Positive = worse than reference price (paid more for buys, received less for sells).
   * Calculated as: |referencePrice - executionPrice| / referencePrice * 10000
   */
  actualSlippageBps: number;
  /** Slippage cost in USDC terms: usdcAmount * (slippageBps / 10000) */
  slippageCostUsdc: number;
  /** Estimated swap fee in USDC: usdcAmount * ESTIMATED_SWAP_FEE_RATE */
  estimatedSwapFeeUsdc: number;
  /** Estimated network fee in USDC (per-transaction flat cost) */
  networkFeeUsdc: number;
  /** Total transaction cost: slippageCost + swapFee + networkFee */
  totalCostUsdc: number;
  /** When the trade was executed */
  timestamp: Date;
}

export interface AgentTransactionCostSummary {
  agentId: string;
  /** Total number of trades tracked */
  tradeCount: number;
  /** Sum of all transaction costs in USDC */
  totalCostUsdc: number;
  /** Average cost per trade in USDC */
  avgCostPerTradeUsdc: number;
  /** Total slippage cost component */
  totalSlippageCostUsdc: number;
  /** Total estimated swap fee component */
  totalSwapFeeUsdc: number;
  /** Total network fee component */
  totalNetworkFeeUsdc: number;
  /** Average slippage in basis points (weighted by trade size) */
  avgSlippageBps: number;
  /** Total USDC volume tracked */
  totalVolumeUsdc: number;
  /** Total cost as percentage of volume */
  costAsPercentOfVolume: number;
}

// ---------------------------------------------------------------------------
// In-Memory Storage
// ---------------------------------------------------------------------------

const costRecords: TransactionCostRecord[] = [];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Record a transaction cost for a completed trade.
 *
 * Call this from trading.ts after each successful executeBuy/executeSell.
 * The slippage data comes from the checkSlippage() function that already
 * runs during trade execution.
 */
export function recordTransactionCost(params: {
  tradeId: number;
  agentId: string;
  symbol: string;
  side: "buy" | "sell";
  usdcAmount: number;
  /** Actual slippage percentage from checkSlippage() (e.g., 0.5 means 0.5%) */
  slippagePercent: number;
}): TransactionCostRecord {
  const slippageBps = Math.abs(params.slippagePercent) * 100; // percent -> bps
  const slippageCostUsdc = params.usdcAmount * (slippageBps / 10_000);
  const estimatedSwapFeeUsdc = params.usdcAmount * ESTIMATED_SWAP_FEE_RATE;
  const networkFeeUsdc = ESTIMATED_NETWORK_FEE_USDC;
  const totalCostUsdc = slippageCostUsdc + estimatedSwapFeeUsdc + networkFeeUsdc;

  const record: TransactionCostRecord = {
    tradeId: params.tradeId,
    agentId: params.agentId,
    symbol: params.symbol,
    side: params.side,
    usdcAmount: params.usdcAmount,
    actualSlippageBps: slippageBps,
    slippageCostUsdc,
    estimatedSwapFeeUsdc,
    networkFeeUsdc,
    totalCostUsdc,
    timestamp: new Date(),
  };

  // FIFO eviction when at capacity
  if (costRecords.length >= MAX_COST_RECORDS) {
    costRecords.shift();
  }
  costRecords.push(record);

  console.log(
    `[TxCostTracker] ${params.side.toUpperCase()} ${params.symbol}: ` +
    `slippage=${slippageBps.toFixed(1)}bps ($${slippageCostUsdc.toFixed(4)}) ` +
    `swapFee=$${estimatedSwapFeeUsdc.toFixed(4)} ` +
    `networkFee=$${networkFeeUsdc.toFixed(4)} ` +
    `total=$${totalCostUsdc.toFixed(4)}`
  );

  return record;
}

/**
 * Get aggregated transaction costs for a specific agent.
 *
 * Used by the leaderboard to subtract costs from reported P&L.
 */
export function getAgentTransactionCosts(agentId: string): AgentTransactionCostSummary {
  const agentRecords = costRecords.filter((r) => r.agentId === agentId);

  if (agentRecords.length === 0) {
    return {
      agentId,
      tradeCount: 0,
      totalCostUsdc: 0,
      avgCostPerTradeUsdc: 0,
      totalSlippageCostUsdc: 0,
      totalSwapFeeUsdc: 0,
      totalNetworkFeeUsdc: 0,
      avgSlippageBps: 0,
      totalVolumeUsdc: 0,
      costAsPercentOfVolume: 0,
    };
  }

  const totalCostUsdc = sumByKey(agentRecords, 'totalCostUsdc');
  const totalSlippageCostUsdc = sumByKey(agentRecords, 'slippageCostUsdc');
  const totalSwapFeeUsdc = sumByKey(agentRecords, 'estimatedSwapFeeUsdc');
  const totalNetworkFeeUsdc = sumByKey(agentRecords, 'networkFeeUsdc');
  const totalVolumeUsdc = sumByKey(agentRecords, 'usdcAmount');

  // Volume-weighted average slippage
  const weightedSlippageSum = agentRecords.reduce(
    (sum, r) => sum + r.actualSlippageBps * r.usdcAmount,
    0,
  );
  const avgSlippageBps = totalVolumeUsdc > 0 ? weightedSlippageSum / totalVolumeUsdc : 0;

  return {
    agentId,
    tradeCount: agentRecords.length,
    totalCostUsdc,
    avgCostPerTradeUsdc: totalCostUsdc / agentRecords.length,
    totalSlippageCostUsdc,
    totalSwapFeeUsdc,
    totalNetworkFeeUsdc,
    avgSlippageBps,
    totalVolumeUsdc,
    costAsPercentOfVolume: totalVolumeUsdc > 0 ? (totalCostUsdc / totalVolumeUsdc) * 100 : 0,
  };
}

/**
 * Estimate transaction costs for an agent using trade count and average trade size.
 *
 * Fallback method when in-memory records aren't available (e.g., after restart).
 * Uses the conservative ESTIMATED_SWAP_FEE_RATE plus a typical slippage estimate.
 *
 * @param tradeCount Number of confirmed trades
 * @param totalVolumeUsdc Total USDC volume traded (buys + sells)
 */
export function estimateTransactionCosts(
  tradeCount: number,
  totalVolumeUsdc: number,
): number {
  if (tradeCount === 0 || totalVolumeUsdc <= 0) return 0;

  // Estimated swap fee: 0.3% of total volume
  const swapFees = totalVolumeUsdc * ESTIMATED_SWAP_FEE_RATE;

  // Estimated slippage: ~0.15% average (15bps) — conservative for xStocks liquidity
  const estimatedSlippage = totalVolumeUsdc * ESTIMATED_SLIPPAGE_RATE;

  // Network fees: flat per transaction
  const networkFees = tradeCount * ESTIMATED_NETWORK_FEE_USDC;

  return swapFees + estimatedSlippage + networkFees;
}

/**
 * Get all cost records (for debugging/admin).
 */
export function getAllTransactionCosts(): TransactionCostRecord[] {
  return [...costRecords];
}

/**
 * Get cost records for a specific agent (for detailed reporting).
 */
export function getAgentCostRecords(agentId: string): TransactionCostRecord[] {
  return costRecords.filter((r) => r.agentId === agentId);
}
