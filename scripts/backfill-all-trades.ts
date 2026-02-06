#!/usr/bin/env npx tsx
/**
 * Backfill trades for all agents based on their on-chain positions.
 */
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  for (const line of readFileSync(resolve(__dirname, "../.env"), "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
} catch {}

const { db } = await import("../src/db/index.ts");
const { trades, positions, agentDecisions } = await import("../src/db/schema/index.ts");
const { eq, and } = await import("drizzle-orm");
const { XSTOCKS_CATALOG } = await import("../src/config/constants.ts");
const { getAllAgentWallets, getAgentWalletStatus } = await import("../src/services/agent-wallets.ts");

const mintBySymbol = new Map(XSTOCKS_CATALOG.map(s => [s.symbol, s.mintAddress]));

// Realistic price estimates for calculating cost basis
const PRICE_ESTIMATES: Record<string, number> = {
  AAPLx: 178, GOOGLx: 175, MSFTx: 415, NVDAx: 131, TSLAx: 245,
  AMZNx: 178, METAx: 505, TMOx: 580, MSTRx: 320, COINx: 225,
  HOODx: 25, CRCLx: 42, GMEx: 27,
};

const wallets = getAllAgentWallets();

for (const wallet of wallets) {
  console.log(`\n=== ${wallet.agentName} (${wallet.agentId}) ===`);
  
  // Get on-chain holdings
  const status = await getAgentWalletStatus(wallet.agentId);
  
  // Get existing trades for this agent
  const existingTrades = await db.select().from(trades).where(eq(trades.agentId, wallet.agentId));
  const existingSymbols = new Set(existingTrades.map(t => t.stockSymbol));
  
  console.log(`  On-chain positions: ${status.xStockHoldings.length}`);
  console.log(`  Existing trades: ${existingTrades.length}`);
  
  // Get buy decisions for timestamps
  const buyDecisions = await db.select()
    .from(agentDecisions)
    .where(and(eq(agentDecisions.agentId, wallet.agentId), eq(agentDecisions.action, "buy")));
  const firstBuyBySymbol = new Map<string, typeof buyDecisions[0]>();
  for (const d of buyDecisions) {
    if (d.symbol && !firstBuyBySymbol.has(d.symbol)) {
      firstBuyBySymbol.set(d.symbol, d);
    }
  }
  
  let created = 0;
  
  for (const holding of status.xStockHoldings) {
    // Skip if we already have a trade for this symbol
    if (existingSymbols.has(holding.symbol)) {
      console.log(`  SKIP ${holding.symbol}: trade already exists`);
      continue;
    }
    
    const mintAddress = mintBySymbol.get(holding.symbol) || holding.mintAddress;
    const decision = firstBuyBySymbol.get(holding.symbol);
    
    // Estimate trade amount and price
    const estimatedPrice = PRICE_ESTIMATES[holding.symbol] || 100;
    const estimatedUsdcAmount = (holding.amount * estimatedPrice).toFixed(2);
    
    const tradeData = {
      agentId: wallet.agentId,
      side: "buy" as const,
      stockMintAddress: mintAddress,
      stockSymbol: holding.symbol,
      stockQuantity: holding.amount.toString(),
      usdcAmount: estimatedUsdcAmount,
      pricePerToken: estimatedPrice.toFixed(2),
      status: "confirmed" as const,
      txSignature: `backfill_${holding.symbol}_${wallet.agentId}_${Date.now()}`,
      createdAt: decision?.createdAt || new Date(),
    };
    
    console.log(`  CREATE: BUY ${holding.symbol} qty=${holding.amount.toFixed(6)} ~$${estimatedUsdcAmount}`);
    await db.insert(trades).values(tradeData);
    created++;
    
    // Update position cost basis
    await db.update(positions)
      .set({ averageCostBasis: estimatedPrice.toFixed(2) })
      .where(and(eq(positions.agentId, wallet.agentId), eq(positions.symbol, holding.symbol)));
  }
  
  console.log(`  Created ${created} new trade records`);
}

console.log("\n✓ Done backfilling all trades");
process.exit(0);
