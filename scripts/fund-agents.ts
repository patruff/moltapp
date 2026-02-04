#!/usr/bin/env npx tsx
/**
 * Fund Agent Wallets
 *
 * Transfers SOL and USDC from the main wallet to each agent's dedicated wallet.
 * Run once to set up agents, then top up as needed.
 *
 * Usage:
 *   npx tsx scripts/fund-agents.ts              # Default: 0.5 SOL + $40 USDC each
 *   npx tsx scripts/fund-agents.ts --sol 1 --usdc 50  # Custom amounts
 *   npx tsx scripts/fund-agents.ts --dry-run     # Show what would happen
 */

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import bs58 from "bs58";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env
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

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const RPC_URL = process.env.SOLANA_RPC_URL!;
const MAIN_PRIVATE = process.env.SOLANA_WALLET_PRIVATE!;
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

const AGENTS = [
  {
    name: "Grok Trader",
    publicKey: process.env.GROK_WALLET_PUBLIC!,
  },
  {
    name: "GPT Trader",
    publicKey: process.env.OPENAI_WALLET_PUBLIC!,
  },
  {
    name: "Claude Trader",
    publicKey: process.env.ANTHROPIC_WALLET_PUBLIC!,
  },
];

// Parse CLI args
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const solIdx = args.indexOf("--sol");
const usdcIdx = args.indexOf("--usdc");
const SOL_PER_AGENT = solIdx >= 0 ? parseFloat(args[solIdx + 1]) : 0.5;
const USDC_PER_AGENT = usdcIdx >= 0 ? parseFloat(args[usdcIdx + 1]) : 40;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\n${"=".repeat(50)}`);
  console.log(`  MoltApp Agent Funding`);
  console.log(`  ${dryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`${"=".repeat(50)}\n`);

  const connection = new Connection(RPC_URL, "confirmed");
  const mainKeypair = Keypair.fromSecretKey(bs58.decode(MAIN_PRIVATE));
  const mainPubkey = mainKeypair.publicKey;

  // Check main wallet balance
  const mainSolBalance = await connection.getBalance(mainPubkey);
  const mainSol = mainSolBalance / LAMPORTS_PER_SOL;

  // Get main USDC balance
  const mainUsdcAta = await getAssociatedTokenAddress(USDC_MINT, mainPubkey);
  let mainUsdc = 0;
  try {
    const mainUsdcAccount = await connection.getTokenAccountBalance(mainUsdcAta);
    mainUsdc = parseFloat(mainUsdcAccount.value.uiAmountString ?? "0");
  } catch {}

  console.log(`Main wallet: ${mainPubkey.toBase58()}`);
  console.log(`  SOL: ${mainSol.toFixed(4)}`);
  console.log(`  USDC: $${mainUsdc.toFixed(2)}`);

  const totalSolNeeded = SOL_PER_AGENT * AGENTS.length;
  const totalUsdcNeeded = USDC_PER_AGENT * AGENTS.length;

  console.log(`\nPlan: Send ${SOL_PER_AGENT} SOL + $${USDC_PER_AGENT} USDC to each of ${AGENTS.length} agents`);
  console.log(`Total: ${totalSolNeeded} SOL + $${totalUsdcNeeded} USDC`);

  if (mainSol < totalSolNeeded + 0.01) {
    console.log(`\n  WARNING: Main wallet has ${mainSol.toFixed(4)} SOL, need ${totalSolNeeded + 0.01} SOL (including tx fees)`);
  }
  if (mainUsdc < totalUsdcNeeded) {
    console.log(`\n  WARNING: Main wallet has $${mainUsdc.toFixed(2)} USDC, need $${totalUsdcNeeded}`);
  }

  if (dryRun) {
    console.log("\n  DRY RUN — no transactions sent.\n");
    for (const agent of AGENTS) {
      console.log(`  ${agent.name}: would receive ${SOL_PER_AGENT} SOL + $${USDC_PER_AGENT} USDC`);
      console.log(`    -> ${agent.publicKey}`);
    }
    return;
  }

  // Execute transfers sequentially (single wallet)
  for (const agent of AGENTS) {
    console.log(`\n--- Funding ${agent.name} ---`);
    console.log(`  Wallet: ${agent.publicKey}`);
    const agentPubkey = new PublicKey(agent.publicKey);

    // 1. Send SOL
    if (SOL_PER_AGENT > 0) {
      console.log(`  Sending ${SOL_PER_AGENT} SOL...`);
      const solTx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: mainPubkey,
          toPubkey: agentPubkey,
          lamports: Math.round(SOL_PER_AGENT * LAMPORTS_PER_SOL),
        })
      );
      try {
        const solSig = await connection.sendTransaction(solTx, [mainKeypair]);
        await connection.confirmTransaction(solSig, "confirmed");
        console.log(`  SOL sent! TX: ${solSig}`);
      } catch (err: any) {
        console.log(`  SOL transfer failed: ${err.message}`);
      }
    }

    // 2. Send USDC (need to create ATA if it doesn't exist)
    if (USDC_PER_AGENT > 0) {
      console.log(`  Sending $${USDC_PER_AGENT} USDC...`);
      try {
        // Get or create the agent's USDC token account
        const agentUsdcAta = await getOrCreateAssociatedTokenAccount(
          connection,
          mainKeypair, // payer for ATA creation if needed
          USDC_MINT,
          agentPubkey
        );
        console.log(`  Agent USDC ATA: ${agentUsdcAta.address.toBase58()}`);

        // Transfer USDC (6 decimals)
        const usdcAmount = Math.round(USDC_PER_AGENT * 1_000_000);
        const usdcTx = new Transaction().add(
          createTransferInstruction(
            mainUsdcAta,
            agentUsdcAta.address,
            mainPubkey,
            usdcAmount,
            [],
            TOKEN_PROGRAM_ID
          )
        );
        const usdcSig = await connection.sendTransaction(usdcTx, [mainKeypair]);
        await connection.confirmTransaction(usdcSig, "confirmed");
        console.log(`  USDC sent! TX: ${usdcSig}`);
      } catch (err: any) {
        console.log(`  USDC transfer failed: ${err.message}`);
      }
    }
  }

  // Final balance check
  console.log(`\n${"=".repeat(50)}`);
  console.log("  Final Balances");
  console.log(`${"=".repeat(50)}`);

  const finalMainSol = await connection.getBalance(mainPubkey);
  let finalMainUsdc = 0;
  try {
    const acc = await connection.getTokenAccountBalance(mainUsdcAta);
    finalMainUsdc = parseFloat(acc.value.uiAmountString ?? "0");
  } catch {}
  console.log(`  Main: ${(finalMainSol / LAMPORTS_PER_SOL).toFixed(4)} SOL, $${finalMainUsdc.toFixed(2)} USDC`);

  for (const agent of AGENTS) {
    const agentPubkey = new PublicKey(agent.publicKey);
    const agentSol = await connection.getBalance(agentPubkey);
    let agentUsdc = 0;
    try {
      const ata = await getAssociatedTokenAddress(USDC_MINT, agentPubkey);
      const acc = await connection.getTokenAccountBalance(ata);
      agentUsdc = parseFloat(acc.value.uiAmountString ?? "0");
    } catch {}
    console.log(`  ${agent.name}: ${(agentSol / LAMPORTS_PER_SOL).toFixed(4)} SOL, $${agentUsdc.toFixed(2)} USDC`);
  }

  console.log("");
}

main().catch((err) => {
  console.error("Funding failed:", err);
  process.exit(1);
});
