#!/usr/bin/env node
/**
 * MoltApp Onboarding CLI
 *
 * Interactive setup wizard for non-technical users.
 * Guides through: API key detection -> wallet generation -> funding -> trading.
 *
 * Usage:
 *   npm run onboard           # Mainnet setup
 *   npm run onboard:devnet    # Devnet setup (with free airdrop)
 */

import * as readline from "node:readline";
import * as fs from "node:fs";
import * as path from "node:path";
import { generateWallet, checkBalance, waitForFunding, getDevnetAirdrop } from "./wallet-setup.ts";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const IS_DEVNET = process.argv.includes("--devnet");
const ENV_FILE = path.resolve(process.cwd(), ".env");
const MIN_SOL = IS_DEVNET ? 0.01 : 0.01;

const API_KEYS = [
  { key: "GOOGLE_API_KEY", name: "Google Gemini", url: "https://aistudio.google.com/apikey" },
  { key: "ANTHROPIC_API_KEY", name: "Anthropic Claude", url: "https://console.anthropic.com/settings/keys" },
  { key: "OPENAI_API_KEY", name: "OpenAI GPT", url: "https://platform.openai.com/api-keys" },
  { key: "XAI_API_KEY", name: "xAI Grok", url: "https://console.x.ai/" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

function print(msg: string) {
  console.log(msg);
}

function printHeader(title: string) {
  print("");
  print("=".repeat(60));
  print(`  ${title}`);
  print("=".repeat(60));
  print("");
}

function printStep(n: number, msg: string) {
  print(`  [${n}] ${msg}`);
}

/**
 * Read existing .env file into a key-value map.
 */
function readEnvFile(): Map<string, string> {
  const env = new Map<string, string>();
  if (!fs.existsSync(ENV_FILE)) return env;

  const content = fs.readFileSync(ENV_FILE, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    env.set(key, value);
  }
  return env;
}

/**
 * Append or update a key in the .env file.
 */
function setEnvValue(key: string, value: string) {
  let content = "";
  if (fs.existsSync(ENV_FILE)) {
    content = fs.readFileSync(ENV_FILE, "utf-8");
  }

  const lines = content.split("\n");
  let found = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(`${key}=`)) {
      lines[i] = `${key}=${value}`;
      found = true;
      break;
    }
  }

  if (!found) {
    lines.push(`${key}=${value}`);
  }

  fs.writeFileSync(ENV_FILE, lines.join("\n"));
  // Also set in process.env for current session
  process.env[key] = value;
}

/**
 * Simple text-art QR-like display of a wallet address.
 * (Real QR would need a dependency — this shows a copy-friendly address.)
 */
function displayWalletAddress(address: string) {
  print("");
  print("  +--------------------------------------------------+");
  print("  |                                                  |");
  print(`  |  ${address}  |`);
  print("  |                                                  |");
  print("  +--------------------------------------------------+");
  print("");
  print("  Copy this address to send SOL to your MoltApp wallet.");
  print("");
}

// ---------------------------------------------------------------------------
// Onboarding Steps
// ---------------------------------------------------------------------------

async function stepWelcome() {
  printHeader("Welcome to MoltApp");
  print("  MoltApp runs AI trading agents that compete on Solana xStocks.");
  print("  Each agent analyzes markets, makes trades, and learns from outcomes.");
  print("");
  if (IS_DEVNET) {
    print("  ** DEVNET MODE ** — Using test tokens (no real money).");
    print("");
  }
  print("  This wizard will help you:");
  print("    1. Connect an AI provider (Gemini, Claude, GPT, or Grok)");
  print("    2. Create a Solana wallet for trading");
  print("    3. Fund the wallet");
  print("    4. Start trading!");
  print("");
  await ask("  Press Enter to continue...");
}

async function stepDetectKeys(): Promise<string[]> {
  printHeader("Step 1: AI Provider Setup");

  const envMap = readEnvFile();
  const found: string[] = [];

  for (const { key, name } of API_KEYS) {
    const value = process.env[key] || envMap.get(key);
    if (value && value.length > 5) {
      found.push(name);
      print(`  [OK] ${name} — API key found`);
    } else {
      print(`  [  ] ${name} — not configured`);
    }
  }

  print("");

  if (found.length > 0) {
    print(`  You have ${found.length} provider(s) configured: ${found.join(", ")}`);
    const addMore = await ask("  Add another provider? (y/N): ");
    if (addMore.toLowerCase() !== "y") return found;
  } else {
    print("  No AI providers found. You need at least one API key.");
    print("");
  }

  // Help user add a key
  print("  Available providers:");
  for (let i = 0; i < API_KEYS.length; i++) {
    print(`    ${i + 1}. ${API_KEYS[i].name} — ${API_KEYS[i].url}`);
  }
  print("");

  const choice = await ask("  Which provider? (1-4, or press Enter to skip): ");
  const idx = parseInt(choice, 10) - 1;

  if (idx >= 0 && idx < API_KEYS.length) {
    const provider = API_KEYS[idx];
    print("");
    print(`  Get your ${provider.name} API key at:`);
    print(`  ${provider.url}`);
    print("");

    const apiKey = await ask(`  Paste your ${provider.name} API key: `);
    if (apiKey.length > 5) {
      setEnvValue(provider.key, apiKey);
      found.push(provider.name);
      print(`  [OK] ${provider.name} key saved to .env`);
    } else {
      print("  Skipped — key too short.");
    }
  }

  if (found.length === 0) {
    print("");
    print("  WARNING: No API keys configured. You can add them later to .env");
    print("  MoltApp needs at least one AI provider to trade.");
  }

  return found;
}

async function stepWalletSetup(): Promise<string | null> {
  printHeader("Step 2: Wallet Setup");

  // Check if wallet already exists
  const envMap = readEnvFile();
  const existingPub = process.env.ONBOARD_WALLET_PUBLIC || envMap.get("ONBOARD_WALLET_PUBLIC");
  const existingSec = process.env.ONBOARD_WALLET_SECRET || envMap.get("ONBOARD_WALLET_SECRET");

  if (existingPub && existingSec) {
    print(`  Existing wallet found: ${existingPub}`);
    const reuse = await ask("  Use this wallet? (Y/n): ");
    if (reuse.toLowerCase() !== "n") {
      return existingPub;
    }
  }

  print("  Generating a new Solana wallet...");
  print("");

  const wallet = generateWallet();

  setEnvValue("ONBOARD_WALLET_PUBLIC", wallet.publicKey);
  setEnvValue("ONBOARD_WALLET_SECRET", wallet.secretKey);

  print(`  Wallet created!`);
  displayWalletAddress(wallet.publicKey);

  print("  IMPORTANT: Your secret key has been saved to .env");
  print("  Never share your .env file or secret key with anyone.");
  print("");

  return wallet.publicKey;
}

async function stepFundWallet(publicKey: string) {
  printHeader("Step 3: Fund Your Wallet");

  if (IS_DEVNET) {
    print("  Requesting devnet SOL airdrop (free test tokens)...");
    try {
      const result = await getDevnetAirdrop(publicKey);
      print(`  Airdrop successful! +${result.sol} SOL (tx: ${result.signature.slice(0, 20)}...)`);
      print("");
      const balance = await checkBalance(publicKey, true);
      print(`  Current balance: ${balance.sol.toFixed(4)} SOL`);
      return;
    } catch (err) {
      print(`  Airdrop failed: ${err instanceof Error ? err.message : String(err)}`);
      print("  Devnet faucet may be rate-limited. Try again in a few minutes.");
      return;
    }
  }

  // Mainnet funding instructions
  print("  Your wallet needs SOL for transaction fees.");
  print("  Recommended: 0.1 SOL (~$20) is enough for many trades.");
  print("");
  print("  How to fund your wallet:");
  print("");
  printStep(1, "Install Phantom wallet: https://phantom.com/download");
  printStep(2, "Create a wallet with Google (Gmail) — no seed phrase needed");
  printStep(3, 'Use Phantom\'s built-in "Buy" button to purchase SOL');
  printStep(4, "Send SOL to your MoltApp wallet address:");
  print("");
  displayWalletAddress(publicKey);
  print("  Alternative: Send SOL from any exchange (Coinbase, Binance, etc.)");
  print("");

  const waitForFunds = await ask("  Wait for funding? (Y/n): ");
  if (waitForFunds.toLowerCase() === "n") {
    print("  You can fund later and run: npm run dev");
    return;
  }

  print("");
  print("  Watching for incoming SOL...");
  print("  (Press Ctrl+C to stop waiting)");
  print("");

  try {
    const balance = await waitForFunding(
      publicKey,
      MIN_SOL,
      false,
      (bal) => {
        process.stdout.write(`\r  Balance: ${bal.sol.toFixed(6)} SOL — waiting for >= ${MIN_SOL} SOL...`);
      },
    );
    print("");
    print(`  Wallet funded! Balance: ${balance.sol.toFixed(6)} SOL`);
  } catch {
    print("");
    print("  Timed out waiting for funds. You can fund later and run: npm run dev");
  }
}

async function stepReady(providers: string[]) {
  printHeader("Setup Complete!");

  print("  Your MoltApp instance is configured:");
  print("");
  for (const p of providers) {
    print(`    [OK] ${p} agent`);
  }
  print("");
  print("  To start trading:");
  print("    npm run dev");
  print("");
  print("  To run another setup:");
  print(IS_DEVNET ? "    npm run onboard:devnet" : "    npm run onboard");
  print("");
  print("  Dashboard will be at: http://localhost:3000");
  print("");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  try {
    await stepWelcome();
    const providers = await stepDetectKeys();
    const publicKey = await stepWalletSetup();
    if (publicKey) {
      await stepFundWallet(publicKey);
    }
    await stepReady(providers);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ERR_USE_AFTER_CLOSE") {
      // User pressed Ctrl+C during readline
      print("\n  Setup cancelled.");
    } else {
      console.error("Setup error:", err);
    }
  } finally {
    rl.close();
  }
}

main();
