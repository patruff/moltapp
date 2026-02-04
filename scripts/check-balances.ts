import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
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

const conn = new Connection(process.env.SOLANA_RPC_URL!, "confirmed");
const USDC = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

const agents = [
  { name: "Claude ValueBot", pub: process.env.ANTHROPIC_WALLET_PUBLIC! },
  { name: "GPT MomentumBot", pub: process.env.OPENAI_WALLET_PUBLIC! },
  { name: "Grok ContrarianBot", pub: process.env.GROK_WALLET_PUBLIC! },
];

async function main() {
  console.log("\n=== Agent Wallet Balances ===\n");
  for (const a of agents) {
    const pk = new PublicKey(a.pub);
    const sol = await conn.getBalance(pk);
    let usdc = 0;
    try {
      const ata = await getAssociatedTokenAddress(USDC, pk);
      const bal = await conn.getTokenAccountBalance(ata);
      usdc = parseFloat(bal.value.uiAmountString ?? "0");
    } catch {}
    console.log(`  ${a.name} (${a.pub.slice(0, 8)}...): ${(sol / LAMPORTS_PER_SOL).toFixed(4)} SOL, $${usdc.toFixed(2)} USDC`);
  }
  console.log("");
}
main();
