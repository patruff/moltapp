#!/usr/bin/env npx tsx
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

const { getAllAgentWallets, getAgentWalletStatus } = await import("../src/services/agent-wallets.ts");
const { db } = await import("../src/db/index.ts");
const { trades, positions } = await import("../src/db/schema/index.ts");
const { eq } = await import("drizzle-orm");
const { USDC_MINT_MAINNET } = await import("../src/config/constants.ts");

const wallets = getAllAgentWallets();

console.log("=== Actual Wallet Balances (On-Chain) ===\n");

for (const wallet of wallets) {
  console.log(`${wallet.agentName} (${wallet.agentId}):`);
  console.log(`  Wallet: ${wallet.publicKey}`);
  
  try {
    const status = await getAgentWalletStatus(wallet.agentId);
    console.log(`  SOL Balance: ${status.solBalance.toFixed(4)} SOL`);
    
    // Find USDC in token balances
    const usdcToken = status.tokenBalances.find(t => t.mintAddress === USDC_MINT_MAINNET);
    const usdcBalance = usdcToken?.amount || 0;
    console.log(`  USDC Balance: $${usdcBalance.toFixed(2)}`);
    
    console.log(`  xStock Holdings (${status.xStockHoldings.length}):`);
    let totalXStockValue = 0;
    for (const h of status.xStockHoldings) {
      console.log(`    ${h.symbol}: ${h.amount.toFixed(6)}`);
    }
    
    console.log(`  Token Balances (${status.tokenBalances.length}):`);
    for (const t of status.tokenBalances) {
      console.log(`    ${t.mintAddress.slice(0, 8)}...: ${t.amount}`);
    }
  } catch (e) {
    console.log(`  ERROR: ${e}`);
  }
  
  // Check DB trades
  const agentTrades = await db.select().from(trades).where(eq(trades.agentId, wallet.agentId));
  console.log(`  DB Trades: ${agentTrades.length}`);
  
  // Check DB positions
  const agentPositions = await db.select().from(positions).where(eq(positions.agentId, wallet.agentId));
  console.log(`  DB Positions: ${agentPositions.length}`);
  
  console.log();
}

process.exit(0);
