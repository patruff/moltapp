#!/usr/bin/env npx tsx
/**
 * Fund Monad Agent Wallets
 *
 * Transfers MON (gas) and $STONKS tokens from the deployer wallet to each
 * agent's dedicated Monad wallet. Follows the pattern from fund-agents.ts.
 *
 * Usage:
 *   npx tsx scripts/fund-monad-agents.ts              # Default: 0.1 MON + 100K $STONKS each
 *   npx tsx scripts/fund-monad-agents.ts --mon 0.5 --stonks 200000  # Custom amounts
 *   npx tsx scripts/fund-monad-agents.ts --dry-run     # Show what would happen
 */

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";
import { ethers } from "ethers";

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

const MONAD_CHAIN_ID = 143;
const RPC_URL = process.env.MONAD_RPC_URL!;
const DEPLOYER_KEY = process.env.MONAD_DEPLOYER_PRIVATE_KEY!;
const STONKS_ADDRESS = process.env.STONKS_TOKEN_ADDRESS!;

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

// Agent wallets (derived from their private keys)
function getAgentWallets(provider: ethers.JsonRpcProvider) {
  const agents = [
    { name: "Claude ValueBot", envKey: "CLAUDE_MONAD_PRIVATE_KEY" },
    { name: "GPT MomentumBot", envKey: "GPT_MONAD_PRIVATE_KEY" },
    { name: "Grok ContrarianBot", envKey: "GROK_MONAD_PRIVATE_KEY" },
  ];

  return agents
    .filter((a) => process.env[a.envKey])
    .map((a) => {
      const wallet = new ethers.Wallet(process.env[a.envKey]!, provider);
      return { name: a.name, address: wallet.address };
    });
}

// Parse CLI args
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const monIdx = args.indexOf("--mon");
const stonksIdx = args.indexOf("--stonks");
const MON_PER_AGENT = monIdx >= 0 ? parseFloat(args[monIdx + 1]) : 0.1;
const STONKS_PER_AGENT = stonksIdx >= 0 ? parseFloat(args[stonksIdx + 1]) : 100_000;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!RPC_URL) {
    console.error("Missing MONAD_RPC_URL in .env");
    process.exit(1);
  }
  if (!DEPLOYER_KEY) {
    console.error("Missing MONAD_DEPLOYER_PRIVATE_KEY in .env");
    process.exit(1);
  }
  if (!STONKS_ADDRESS) {
    console.error("Missing STONKS_TOKEN_ADDRESS in .env (run create-stonks-token.ts first)");
    process.exit(1);
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`  MoltApp Monad Agent Funding`);
  console.log(`  ${dryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`${"=".repeat(50)}\n`);

  const provider = new ethers.JsonRpcProvider(RPC_URL, MONAD_CHAIN_ID);
  const deployer = new ethers.Wallet(DEPLOYER_KEY, provider);
  const stonksContract = new ethers.Contract(STONKS_ADDRESS, ERC20_ABI, deployer);

  // Check deployer balances
  const deployerMon = await provider.getBalance(deployer.address);
  const deployerStonks = await stonksContract.balanceOf(deployer.address);
  const decimals: bigint = await stonksContract.decimals();

  console.log(`Deployer: ${deployer.address}`);
  console.log(`  MON: ${ethers.formatEther(deployerMon)}`);
  console.log(`  $STONKS: ${ethers.formatUnits(deployerStonks, decimals)}`);
  console.log(`  Token contract: ${STONKS_ADDRESS}`);

  const agents = getAgentWallets(provider);
  if (agents.length === 0) {
    console.error("\nNo agent Monad private keys found in .env");
    console.error("Required: CLAUDE_MONAD_PRIVATE_KEY, GPT_MONAD_PRIVATE_KEY, GROK_MONAD_PRIVATE_KEY");
    process.exit(1);
  }

  const totalMonNeeded = MON_PER_AGENT * agents.length;
  const totalStonksNeeded = STONKS_PER_AGENT * agents.length;

  console.log(`\nPlan: Send ${MON_PER_AGENT} MON + ${STONKS_PER_AGENT.toLocaleString()} $STONKS to each of ${agents.length} agents`);
  console.log(`Total: ${totalMonNeeded} MON + ${totalStonksNeeded.toLocaleString()} $STONKS\n`);

  const monBalanceEth = Number(ethers.formatEther(deployerMon));
  const stonksBalanceNum = Number(ethers.formatUnits(deployerStonks, decimals));

  if (monBalanceEth < totalMonNeeded + 0.01) {
    console.log(`  WARNING: Deployer has ${monBalanceEth.toFixed(4)} MON, need ${(totalMonNeeded + 0.01).toFixed(4)} MON`);
  }
  if (stonksBalanceNum < totalStonksNeeded) {
    console.log(`  WARNING: Deployer has ${stonksBalanceNum.toLocaleString()} $STONKS, need ${totalStonksNeeded.toLocaleString()}`);
  }

  if (dryRun) {
    console.log("\n  DRY RUN — no transactions sent.\n");
    for (const agent of agents) {
      console.log(`  ${agent.name}: would receive ${MON_PER_AGENT} MON + ${STONKS_PER_AGENT.toLocaleString()} $STONKS`);
      console.log(`    -> ${agent.address}`);
    }
    return;
  }

  // Execute transfers
  for (const agent of agents) {
    console.log(`\n--- Funding ${agent.name} ---`);
    console.log(`  Address: ${agent.address}`);

    // 1. Send MON (native gas token)
    if (MON_PER_AGENT > 0) {
      console.log(`  Sending ${MON_PER_AGENT} MON...`);
      try {
        const tx = await deployer.sendTransaction({
          to: agent.address,
          value: ethers.parseEther(MON_PER_AGENT.toString()),
        });
        const receipt = await tx.wait();
        console.log(`  MON sent! TX: ${receipt!.hash}`);
      } catch (err: any) {
        console.log(`  MON transfer failed: ${err.message}`);
      }
    }

    // 2. Send $STONKS (ERC-20 transfer)
    if (STONKS_PER_AGENT > 0) {
      console.log(`  Sending ${STONKS_PER_AGENT.toLocaleString()} $STONKS...`);
      try {
        const rawAmount = ethers.parseUnits(STONKS_PER_AGENT.toString(), decimals);
        const tx = await stonksContract.transfer(agent.address, rawAmount);
        const receipt = await tx.wait();
        console.log(`  $STONKS sent! TX: ${receipt.hash}`);
      } catch (err: any) {
        console.log(`  $STONKS transfer failed: ${err.message}`);
      }
    }
  }

  // Final balance check
  console.log(`\n${"=".repeat(50)}`);
  console.log("  Final Balances");
  console.log(`${"=".repeat(50)}`);

  const finalDeployerMon = await provider.getBalance(deployer.address);
  const finalDeployerStonks = await stonksContract.balanceOf(deployer.address);
  console.log(`  Deployer: ${ethers.formatEther(finalDeployerMon)} MON, ${ethers.formatUnits(finalDeployerStonks, decimals)} $STONKS`);

  for (const agent of agents) {
    const agentMon = await provider.getBalance(agent.address);
    const agentStonks = await stonksContract.balanceOf(agent.address);
    console.log(`  ${agent.name}: ${ethers.formatEther(agentMon)} MON, ${ethers.formatUnits(agentStonks, decimals)} $STONKS`);
  }

  console.log("");
}

main().catch((err) => {
  console.error("Funding failed:", err);
  process.exit(1);
});
