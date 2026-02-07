/**
 * On-Chain Portfolio Sync
 *
 * This service reads agent portfolios directly from Solana blockchain,
 * ensuring dashboard data matches actual on-chain holdings.
 *
 * Sources of truth:
 * 1. Solana blockchain — token balances
 * 2. Jupiter Price API — current prices
 * 3. Trades table — historical transactions for P&L calculation
 */

import { getAgentWalletStatus, getAgentWallet, getAllAgentWallets } from "./agent-wallets.ts";
import { getPrices } from "./jupiter.ts";
import { db } from "../db/index.ts";
import { positions } from "../db/schema/positions.ts";
import { trades } from "../db/schema/trades.ts";
import { eq, and } from "drizzle-orm";
import { XSTOCKS_CATALOG, USDC_MINT_MAINNET } from "../config/constants.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OnChainPortfolio {
  agentId: string;
  agentName: string;
  walletAddress: string;
  /** USDC balance from on-chain */
  cashBalance: number;
  /** SOL balance from on-chain */
  solBalance: number;
  /** SOL value in USD */
  solValueUsd: number;
  /** xStock positions from on-chain */
  positions: Array<{
    symbol: string;
    name: string;
    mintAddress: string;
    quantity: number;
    currentPrice: number;
    value: number;
    averageCostBasis: number;
    unrealizedPnl: number;
    unrealizedPnlPercent: number;
  }>;
  /** Total portfolio value (cash + positions + SOL) */
  totalValue: number;
  /** Total P&L from all trades */
  totalPnl: number;
  totalPnlPercent: number;
  /** Funding amount (what was deposited) */
  initialCapital: number;
  /** Last sync timestamp */
  lastSyncedAt: string;
  /** Data source */
  source: "on-chain";
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Initial capital per agent (actual funding amount) */
const AGENT_INITIAL_CAPITAL = 50; // $50 USDC per agent

/** USDC decimals */
const USDC_DECIMALS = 6;

/** Approximate SOL price in USD (for portfolio valuation) */
const SOL_PRICE_USD = 200; // Conservative estimate, update as needed

// ---------------------------------------------------------------------------
// Core Functions
// ---------------------------------------------------------------------------

/**
 * Get portfolio directly from Solana blockchain for an agent.
 * This is the source of truth for all dashboard displays.
 */
export async function getOnChainPortfolio(agentId: string): Promise<OnChainPortfolio> {
  const wallet = getAgentWallet(agentId);
  if (!wallet) {
    throw new Error(`Agent wallet not found: ${agentId}`);
  }

  // Get on-chain status (SOL, tokens)
  const walletStatus = await getAgentWalletStatus(agentId);

  // Get current prices from Jupiter
  const mintAddresses = XSTOCKS_CATALOG.map(s => s.mintAddress);
  mintAddresses.push(USDC_MINT_MAINNET);
  const priceData = await getPrices(mintAddresses);

  // Find USDC balance in token holdings
  let cashBalance = 0;
  const usdcToken = walletStatus.tokenBalances.find(t => t.mintAddress === USDC_MINT_MAINNET);
  if (usdcToken) {
    cashBalance = usdcToken.amount;
  }

  // Get historical trades for cost basis calculation
  const agentTrades = await db.select().from(trades).where(eq(trades.agentId, agentId));

  // Calculate average cost basis per symbol from trades
  const costBasisMap = new Map<string, { totalCost: number; totalQty: number }>();
  for (const trade of agentTrades) {
    const symbol = trade.stockSymbol;
    const qty = parseFloat(trade.stockQuantity);
    const cost = parseFloat(trade.usdcAmount);

    if (trade.side === "buy") {
      const existing = costBasisMap.get(symbol) || { totalCost: 0, totalQty: 0 };
      existing.totalCost += cost;
      existing.totalQty += qty;
      costBasisMap.set(symbol, existing);
    } else if (trade.side === "sell") {
      const existing = costBasisMap.get(symbol);
      if (existing) {
        // Reduce quantity proportionally (FIFO approximation)
        const avgCost = existing.totalCost / existing.totalQty;
        existing.totalCost -= avgCost * qty;
        existing.totalQty -= qty;
        costBasisMap.set(symbol, existing);
      }
    }
  }

  // Build positions from on-chain xStock holdings
  const positionList = walletStatus.xStockHoldings.map(holding => {
    const stockInfo = XSTOCKS_CATALOG.find(s => s.mintAddress === holding.mintAddress);

    // Get cost basis from trades
    const costData = costBasisMap.get(holding.symbol);
    const avgCostBasis = costData && costData.totalQty > 0
      ? costData.totalCost / costData.totalQty
      : 0;

    // Use live Jupiter price when available. If Jupiter is down, fall back to
    // cost basis so unrealized P&L = 0 (conservative). This avoids random mock
    // prices (±5% variation) contaminating P&L calculations on every refresh.
    const jupiterPrice = priceData[holding.mintAddress]?.usdPrice;
    const price = jupiterPrice ?? (avgCostBasis > 0 ? avgCostBasis : 0);
    const value = holding.amount * price;

    const unrealizedPnl = avgCostBasis > 0 ? (price - avgCostBasis) * holding.amount : 0;
    const unrealizedPnlPercent = avgCostBasis > 0 ? ((price - avgCostBasis) / avgCostBasis) * 100 : 0;

    return {
      symbol: holding.symbol,
      name: holding.name,
      mintAddress: holding.mintAddress,
      quantity: holding.amount,
      currentPrice: price,
      value,
      averageCostBasis: avgCostBasis,
      unrealizedPnl,
      unrealizedPnlPercent,
    };
  });

  // Calculate SOL value
  const solBalance = walletStatus.solBalance;
  const solValueUsd = solBalance * SOL_PRICE_USD;

  // Calculate totals (including SOL value)
  const positionsValue = positionList.reduce((sum, p) => sum + p.value, 0);
  const totalValue = cashBalance + positionsValue + solValueUsd;
  const totalPnl = totalValue - AGENT_INITIAL_CAPITAL;
  const totalPnlPercent = AGENT_INITIAL_CAPITAL > 0 ? (totalPnl / AGENT_INITIAL_CAPITAL) * 100 : 0;

  return {
    agentId,
    agentName: wallet.agentName,
    walletAddress: wallet.publicKey,
    cashBalance,
    solBalance,
    solValueUsd,
    positions: positionList,
    totalValue,
    totalPnl,
    totalPnlPercent,
    initialCapital: AGENT_INITIAL_CAPITAL,
    lastSyncedAt: new Date().toISOString(),
    source: "on-chain",
  };
}

/**
 * Sync on-chain balances to the positions table.
 * This updates the database to match blockchain state.
 */
export async function syncOnChainToDatabase(agentId: string): Promise<{
  synced: number;
  added: number;
  updated: number;
  removed: number;
}> {
  const wallet = getAgentWallet(agentId);
  if (!wallet) {
    throw new Error(`Agent wallet not found: ${agentId}`);
  }

  // Skip placeholder wallets
  if (wallet.publicKey === "11111111111111111111111111111111") {
    return { synced: 0, added: 0, updated: 0, removed: 0 };
  }

  // Get on-chain holdings
  const walletStatus = await getAgentWalletStatus(agentId);
  const onChainHoldings = new Map(
    walletStatus.xStockHoldings.map(h => [h.symbol, h])
  );

  // Get current database positions
  const dbPositions = await db.select().from(positions).where(eq(positions.agentId, agentId));
  const dbPositionMap = new Map(dbPositions.map((p: typeof positions.$inferSelect) => [p.symbol, p]));

  let added = 0;
  let updated = 0;
  let removed = 0;

  // Get historical trades for cost basis
  const agentTrades = await db.select().from(trades).where(eq(trades.agentId, agentId));
  const costBasisMap = new Map<string, number>();
  const qtyMap = new Map<string, number>();

  for (const trade of agentTrades) {
    const symbol = trade.stockSymbol;
    const qty = parseFloat(trade.stockQuantity);
    const cost = parseFloat(trade.usdcAmount);

    if (trade.side === "buy") {
      const existingQty = qtyMap.get(symbol) || 0;
      const existingCost = costBasisMap.get(symbol) || 0;
      qtyMap.set(symbol, existingQty + qty);
      costBasisMap.set(symbol, existingCost + cost);
    }
  }

  // Add/update positions from on-chain
  for (const [symbol, holding] of onChainHoldings) {
    const totalCost = costBasisMap.get(symbol) || 0;
    const totalQty = qtyMap.get(symbol) || holding.amount;
    const avgCostBasis = totalQty > 0 ? (totalCost / totalQty).toString() : "0";

    const existing = dbPositionMap.get(symbol);
    if (existing) {
      // Update existing position
      await db.update(positions)
        .set({
          quantity: holding.amount.toString(),
          averageCostBasis: avgCostBasis,
        })
        .where(and(eq(positions.agentId, agentId), eq(positions.symbol, symbol)));
      updated++;
    } else {
      // Add new position (include mintAddress from on-chain holding)
      await db.insert(positions).values({
        agentId,
        mintAddress: holding.mintAddress,
        symbol,
        quantity: holding.amount.toString(),
        averageCostBasis: avgCostBasis,
      });
      added++;
    }
  }

  // Remove positions no longer on-chain
  for (const [symbol] of dbPositionMap) {
    if (!onChainHoldings.has(symbol as string)) {
      await db.delete(positions)
        .where(and(eq(positions.agentId, agentId), eq(positions.symbol, symbol as string)));
      removed++;
    }
  }

  console.log(
    `[OnChainSync] ${agentId}: synced ${onChainHoldings.size} positions — ` +
    `${added} added, ${updated} updated, ${removed} removed`
  );

  return {
    synced: onChainHoldings.size,
    added,
    updated,
    removed,
  };
}

/**
 * Sync all agent portfolios from on-chain to database.
 */
export async function syncAllAgentPortfolios(): Promise<{
  agents: Array<{
    agentId: string;
    synced: number;
    added: number;
    updated: number;
    removed: number;
  }>;
  totalSynced: number;
}> {
  const wallets = getAllAgentWallets();
  const results: Array<{
    agentId: string;
    synced: number;
    added: number;
    updated: number;
    removed: number;
  }> = [];

  for (const wallet of wallets) {
    try {
      const result = await syncOnChainToDatabase(wallet.agentId);
      results.push({ agentId: wallet.agentId, ...result });
    } catch (err) {
      console.error(`[OnChainSync] Failed to sync ${wallet.agentId}:`, err);
      results.push({ agentId: wallet.agentId, synced: 0, added: 0, updated: 0, removed: 0 });
    }
  }

  return {
    agents: results,
    totalSynced: results.reduce((sum, r) => sum + r.synced, 0),
  };
}

/**
 * Get all agent portfolios from on-chain.
 */
export async function getAllOnChainPortfolios(): Promise<OnChainPortfolio[]> {
  const wallets = getAllAgentWallets();
  const portfolios: OnChainPortfolio[] = [];

  for (const wallet of wallets) {
    try {
      const portfolio = await getOnChainPortfolio(wallet.agentId);
      portfolios.push(portfolio);
    } catch (err) {
      console.error(`[OnChainPortfolio] Failed to get portfolio for ${wallet.agentId}:`, err);
    }
  }

  return portfolios;
}
