/**
 * Demo Trading Service
 * 
 * Simulates stock trading without real blockchain transactions.
 * Perfect for hackathon judges to try MoltApp immediately.
 * 
 * Features:
 * - Mock wallet balances (100 SOL, 10000 USDC starting balance)
 * - Simulated buy/sell trades with realistic prices
 * - Records trades in DB with demo flag
 * - Updates positions just like real trading
 */

import { Decimal } from "decimal.js";
import { db } from "../db/index.ts";
import { trades, positions, wallets } from "../db/schema/index.ts";
import { eq, and, sql } from "drizzle-orm";
import { getStockBySymbol } from "./stocks.ts";
import type { TradeRequest, TradeResult } from "./trading.ts";

// ---------------------------------------------------------------------------
// Demo Constants
// ---------------------------------------------------------------------------

const DEMO_STARTING_SOL = "100.000000000"; // 100 SOL
const DEMO_STARTING_USDC = "10000.000000"; // 10,000 USDC

/** Simulated transaction signature prefix */
const DEMO_TX_PREFIX = "DEMO_";

/** Mock stock prices (in USDC per token) */
const DEMO_STOCK_PRICES: Record<string, string> = {
  AAPL: "150.25",
  TSLA: "245.80",
  NVDA: "890.50",
  MSFT: "420.15",
  GOOGL: "140.90",
  AMZN: "180.25",
  META: "485.60",
  BRK_B: "450.30",
  JPM: "190.75",
  V: "280.40",
};

// ---------------------------------------------------------------------------
// Helper: Generate demo transaction signature
// ---------------------------------------------------------------------------

function generateDemoTxSignature(): string {
  const randomHex = Math.random().toString(16).substring(2, 18);
  const timestamp = Date.now().toString(36);
  return `${DEMO_TX_PREFIX}${timestamp}_${randomHex}`;
}

// ---------------------------------------------------------------------------
// Helper: Get mock stock price
// ---------------------------------------------------------------------------

function getDemoPrice(symbol: string): Decimal {
  const priceStr = DEMO_STOCK_PRICES[symbol];
  if (!priceStr) {
    // Default price if not in catalog
    return new Decimal("100.00");
  }
  return new Decimal(priceStr);
}

// ---------------------------------------------------------------------------
// Helper: Get demo wallet balances
// ---------------------------------------------------------------------------

export async function getDemoBalances(agentId: string): Promise<{
  sol: { lamports: string; display: string };
  usdc: { rawAmount: string; display: string };
}> {
  // Check if wallet exists in DB
  const walletRecords = await db
    .select()
    .from(wallets)
    .where(eq(wallets.agentId, agentId))
    .limit(1);

  if (walletRecords.length === 0) {
    throw new Error("wallet_not_found");
  }

  // Calculate balances based on trades
  // Start with demo balances, subtract/add based on trade history
  let solBalance = new Decimal(DEMO_STARTING_SOL);
  let usdcBalance = new Decimal(DEMO_STARTING_USDC);

  const tradeRecords = await db
    .select()
    .from(trades)
    .where(eq(trades.agentId, agentId));

  for (const trade of tradeRecords) {
    const usdcAmount = new Decimal(trade.usdcAmount);
    if (trade.side === "buy") {
      usdcBalance = usdcBalance.minus(usdcAmount);
    } else {
      usdcBalance = usdcBalance.plus(usdcAmount);
    }
  }

  // Convert to blockchain units
  const lamports = solBalance.mul(1e9).toFixed(0);
  const usdcRaw = usdcBalance.mul(1e6).toFixed(0);

  return {
    sol: {
      lamports,
      display: solBalance.toFixed(9),
    },
    usdc: {
      rawAmount: usdcRaw,
      display: usdcBalance.toFixed(6),
    },
  };
}

// ---------------------------------------------------------------------------
// executeDemoBuy - Simulate a buy order
// ---------------------------------------------------------------------------

export async function executeDemoBuy(req: TradeRequest): Promise<TradeResult> {
  // 1. Validate stock
  const stock = getStockBySymbol(req.stockSymbol);
  if (!stock) {
    throw new Error(
      `stock_not_found: ${req.stockSymbol} is not a supported stock`
    );
  }

  // 2. Get wallet
  const walletRecords = await db
    .select()
    .from(wallets)
    .where(eq(wallets.agentId, req.agentId))
    .limit(1);

  if (walletRecords.length === 0) {
    throw new Error("wallet_not_found: no wallet for this agent");
  }

  // 3. Validate amount
  const usdcAmount = new Decimal(req.usdcAmount);
  if (usdcAmount.lte(0)) {
    throw new Error("invalid_amount: usdcAmount must be > 0");
  }
  if (usdcAmount.decimalPlaces() > 6) {
    throw new Error("invalid_amount: usdcAmount has more than 6 decimal places");
  }

  // 4. Check demo balance
  const balances = await getDemoBalances(req.agentId);
  const currentUsdc = new Decimal(balances.usdc.display);

  if (currentUsdc.lt(usdcAmount)) {
    throw new Error(
      `insufficient_usdc_balance: need ${usdcAmount.toFixed(6)} USDC, have ${currentUsdc.toFixed(6)} USDC`
    );
  }

  // 5. Calculate trade result using mock price
  const pricePerToken = getDemoPrice(stock.symbol);
  const stockQuantity = usdcAmount.div(pricePerToken);

  // 6. Generate demo transaction signature
  const txSignature = generateDemoTxSignature();

  // 7. Record trade in DB
  const [tradeRecord] = await db
    .insert(trades)
    .values({
      agentId: req.agentId,
      side: "buy",
      stockMintAddress: stock.mintAddress,
      stockSymbol: stock.symbol,
      stockQuantity: stockQuantity.toFixed(9),
      usdcAmount: usdcAmount.toFixed(6),
      pricePerToken: pricePerToken.toFixed(6),
      txSignature,
      jupiterRouteInfo: {
        demo: true,
        note: "Simulated trade in demo mode",
      },
      status: "confirmed",
    })
    .returning();

  // 8. Update position (upsert with weighted average cost basis)
  await db
    .insert(positions)
    .values({
      agentId: req.agentId,
      mintAddress: stock.mintAddress,
      symbol: stock.symbol,
      quantity: stockQuantity.toFixed(9),
      averageCostBasis: pricePerToken.toFixed(6),
    })
    .onConflictDoUpdate({
      target: [positions.agentId, positions.mintAddress],
      set: {
        quantity: sql`(${positions.quantity}::numeric + ${stockQuantity.toFixed(9)}::numeric)::numeric(20,9)`,
        averageCostBasis: sql`(
          (${positions.quantity}::numeric * ${positions.averageCostBasis}::numeric + ${stockQuantity.toFixed(9)}::numeric * ${pricePerToken.toFixed(6)}::numeric)
          / (${positions.quantity}::numeric + ${stockQuantity.toFixed(9)}::numeric)
        )::numeric(20,6)`,
        updatedAt: new Date(),
      },
    });

  // 9. Return result
  return {
    tradeId: tradeRecord.id,
    txSignature,
    status: "confirmed",
    side: "buy",
    stockSymbol: stock.symbol,
    stockQuantity: stockQuantity.toFixed(9),
    usdcAmount: usdcAmount.toFixed(6),
    pricePerToken: pricePerToken.toFixed(6),
  };
}

// ---------------------------------------------------------------------------
// executeDemoSell - Simulate a sell order
// ---------------------------------------------------------------------------

export async function executeDemoSell(req: TradeRequest): Promise<TradeResult> {
  // 1. Validate stock
  const stock = getStockBySymbol(req.stockSymbol);
  if (!stock) {
    throw new Error(
      `stock_not_found: ${req.stockSymbol} is not a supported stock`
    );
  }

  // 2. Get wallet
  const walletRecords = await db
    .select()
    .from(wallets)
    .where(eq(wallets.agentId, req.agentId))
    .limit(1);

  if (walletRecords.length === 0) {
    throw new Error("wallet_not_found: no wallet for this agent");
  }

  // 3. Validate quantity
  if (!req.stockQuantity) {
    throw new Error("invalid_amount: stockQuantity is required for sell orders");
  }
  const sellQuantity = new Decimal(req.stockQuantity);
  if (sellQuantity.lte(0)) {
    throw new Error("invalid_amount: stockQuantity must be > 0");
  }

  // 4. Position check
  const positionRecords = await db
    .select()
    .from(positions)
    .where(
      and(
        eq(positions.agentId, req.agentId),
        eq(positions.mintAddress, stock.mintAddress)
      )
    )
    .limit(1);

  if (positionRecords.length === 0) {
    throw new Error(
      `insufficient_stock_balance: no position in ${stock.symbol}`
    );
  }

  const existingPosition = positionRecords[0];
  const positionQuantity = new Decimal(existingPosition.quantity);

  if (positionQuantity.lt(sellQuantity)) {
    throw new Error(
      `insufficient_stock_balance: want to sell ${sellQuantity.toFixed(9)} ${stock.symbol} but only hold ${positionQuantity.toFixed(9)}`
    );
  }

  // 5. Calculate trade result using mock price
  const pricePerToken = getDemoPrice(stock.symbol);
  const usdcReceived = sellQuantity.mul(pricePerToken);

  // 6. Generate demo transaction signature
  const txSignature = generateDemoTxSignature();

  // 7. Record trade in DB
  const [tradeRecord] = await db
    .insert(trades)
    .values({
      agentId: req.agentId,
      side: "sell",
      stockMintAddress: stock.mintAddress,
      stockSymbol: stock.symbol,
      stockQuantity: sellQuantity.toFixed(9),
      usdcAmount: usdcReceived.toFixed(6),
      pricePerToken: pricePerToken.toFixed(6),
      txSignature,
      jupiterRouteInfo: {
        demo: true,
        note: "Simulated trade in demo mode",
      },
      status: "confirmed",
    })
    .returning();

  // 8. Update position: decrement or delete
  const newQuantity = positionQuantity.minus(sellQuantity);

  if (newQuantity.lte(0)) {
    // Position fully liquidated -- remove row
    await db
      .delete(positions)
      .where(eq(positions.id, existingPosition.id));
  } else {
    // Reduce quantity (averageCostBasis stays the same on sells)
    await db
      .update(positions)
      .set({
        quantity: newQuantity.toFixed(9),
        updatedAt: new Date(),
      })
      .where(eq(positions.id, existingPosition.id));
  }

  // 9. Return result
  return {
    tradeId: tradeRecord.id,
    txSignature,
    status: "confirmed",
    side: "sell",
    stockSymbol: stock.symbol,
    stockQuantity: sellQuantity.toFixed(9),
    usdcAmount: usdcReceived.toFixed(6),
    pricePerToken: pricePerToken.toFixed(6),
  };
}
