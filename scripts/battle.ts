#!/usr/bin/env npx tsx
/**
 * MoltApp Battle Script
 *
 * Triggers 3 AI agents to analyze markets and trade real xStocks on Solana mainnet.
 * Each agent uses a different LLM and trading strategy:
 *
 *   - Grok Agent (xAI grok-4-fast) — Contrarian, buys fear sells greed
 *   - GPT Agent (OpenAI gpt-4o-mini) — Momentum/Technical, rides trends
 *   - Claude Agent (Anthropic claude-haiku) — Value investor, fundamentals-driven
 *
 * Flow:
 *   1. Fetch live xStock prices from Jupiter
 *   2. Query each LLM for trade decisions (JSON structured output)
 *   3. Get Jupiter V1 swap quotes
 *   4. Sign and submit transactions sequentially (single wallet)
 *   5. Log everything with reasoning for the benchmark
 *
 * Usage:
 *   npx tsx scripts/battle.ts                # Paper mode (default)
 *   TRADING_MODE=live npx tsx scripts/battle.ts  # Real money
 *   npx tsx scripts/battle.ts --fund 2       # Swap 2 SOL → USDC first
 */

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env manually (no dotenv dependency)
const envPath = resolve(__dirname, "../.env");
try {
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
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

const TRADING_MODE = (process.env.TRADING_MODE ?? "paper") as "live" | "paper";
const WALLET_ADDRESS = process.env.SOLANA_WALLET!;
const SOLANA_PRIVATE_KEY = process.env.SOLANA_PRIVATE_KEY;
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL!;
const JUPITER_API_KEY = process.env.JUPITER_API_KEY!;
const XAI_API_KEY = process.env.XAI_API_KEY!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// xStock mint addresses
const MINTS = {
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  SOL: "So11111111111111111111111111111111111111112",
  AAPLx: "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu",
  NVDAx: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
  TSLAx: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
} as const;

const TICKERS = ["AAPLx", "NVDAx", "TSLAx"] as const;
type Ticker = (typeof TICKERS)[number];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgentDecision {
  symbol: string;
  side: "buy" | "sell" | "hold";
  amountUsdc: number;
  reason: string;
  confidence: number;
  intent: string;
}

interface AgentResult {
  agent: string;
  model: string;
  provider: string;
  decision: AgentDecision;
  quoteOutAmount?: string;
  txSignature?: string;
  error?: string;
  durationMs: number;
}

interface MarketPrice {
  symbol: string;
  mint: string;
  pricePerToken: number;
  tokensPerUsdc: number;
}

// ---------------------------------------------------------------------------
// Jupiter V1 API
// ---------------------------------------------------------------------------

async function jupiterQuote(
  inputMint: string,
  outputMint: string,
  amount: number,
  slippageBps = 100
): Promise<any> {
  const url = new URL("https://api.jup.ag/swap/v1/quote");
  url.searchParams.set("inputMint", inputMint);
  url.searchParams.set("outputMint", outputMint);
  url.searchParams.set("amount", String(amount));
  url.searchParams.set("slippageBps", String(slippageBps));

  const res = await fetch(url.toString(), {
    headers: { "x-api-key": JUPITER_API_KEY },
  });
  if (!res.ok) {
    throw new Error(`Jupiter quote failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function jupiterSwap(quoteResponse: any): Promise<any> {
  const res = await fetch("https://api.jup.ag/swap/v1/swap", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": JUPITER_API_KEY,
    },
    body: JSON.stringify({
      quoteResponse,
      userPublicKey: WALLET_ADDRESS,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      dynamicSlippage: true,
      prioritizationFeeLamports: {
        priorityLevelWithMaxLamports: {
          maxLamports: 1_000_000,
          priorityLevel: "medium",
        },
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`Jupiter swap failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Market Data
// ---------------------------------------------------------------------------

async function fetchMarketPrices(): Promise<Map<Ticker, MarketPrice>> {
  const prices = new Map<Ticker, MarketPrice>();

  // Fetch all prices in parallel (100 USDC → token quotes)
  const results = await Promise.all(
    TICKERS.map(async (symbol) => {
      const mint = MINTS[symbol];
      const quote = await jupiterQuote(MINTS.USDC, mint, 100_000_000); // 100 USDC
      const outAmount = parseInt(quote.outAmount);
      const tokensPerUsdc = outAmount / 1_000_000 / 100; // normalized per 1 USDC
      const pricePerToken = 1 / tokensPerUsdc;
      return { symbol, mint, pricePerToken, tokensPerUsdc };
    })
  );

  for (const r of results) {
    prices.set(r.symbol as Ticker, r);
  }
  return prices;
}

// ---------------------------------------------------------------------------
// Wallet Balance
// ---------------------------------------------------------------------------

async function getWalletBalances(): Promise<{
  solLamports: number;
  usdcAmount: number;
  tokens: Map<string, number>;
}> {
  const balanceRes = await fetch(SOLANA_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getBalance",
      params: [WALLET_ADDRESS],
    }),
  });
  const balanceData = await balanceRes.json() as any;
  const solLamports = balanceData.result?.value ?? 0;

  // Get all token accounts
  const tokenRes = await fetch(SOLANA_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "getTokenAccountsByOwner",
      params: [
        WALLET_ADDRESS,
        { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
        { encoding: "jsonParsed" },
      ],
    }),
  });
  const tokenData = await tokenRes.json() as any;
  const tokens = new Map<string, number>();
  let usdcAmount = 0;

  for (const account of tokenData.result?.value ?? []) {
    const info = account.account?.data?.parsed?.info;
    if (info) {
      const mint = info.mint;
      const amount = parseFloat(info.tokenAmount?.uiAmountString ?? "0");
      tokens.set(mint, amount);
      if (mint === MINTS.USDC) usdcAmount = amount;
    }
  }

  return { solLamports, usdcAmount, tokens };
}

// ---------------------------------------------------------------------------
// LLM Agent Calls
// ---------------------------------------------------------------------------

function buildTradingPrompt(
  prices: Map<Ticker, MarketPrice>,
  balances: { solLamports: number; usdcAmount: number; tokens: Map<string, number> },
  personality: string
): string {
  const priceLines = TICKERS.map((t) => {
    const p = prices.get(t)!;
    return `  ${t}: $${p.pricePerToken.toFixed(2)}/token`;
  }).join("\n");

  const usdcBal = balances.usdcAmount.toFixed(2);
  const solBal = (balances.solLamports / 1_000_000_000).toFixed(4);

  // Check existing xStock positions
  const positionLines = TICKERS.map((t) => {
    const held = balances.tokens.get(MINTS[t]) ?? 0;
    return held > 0 ? `  ${t}: ${held.toFixed(6)} tokens` : null;
  })
    .filter(Boolean)
    .join("\n");

  return `You are an AI trading agent competing in the MoltApp benchmark on Solana.

Your personality: ${personality}

Current market prices (xStocks on Solana via Jupiter DEX):
${priceLines}

Your wallet:
  USDC: $${usdcBal}
  SOL: ${solBal}
${positionLines ? `  Positions:\n${positionLines}` : "  No xStock positions"}

Rules:
- You can buy xStocks with USDC or sell xStocks you hold
- Minimum trade: $1 USDC, maximum: $20 USDC (small benchmark trades)
- You MUST provide reasoning that explains your thesis
- If you have no USDC and no positions, respond with "hold"

Respond with ONLY a JSON object, no markdown, no explanation outside the JSON:
{
  "symbol": "AAPLx" | "NVDAx" | "TSLAx",
  "side": "buy" | "sell" | "hold",
  "amountUsdc": <number between 1 and 20>,
  "reason": "<2-3 sentences explaining your thesis>",
  "confidence": <0.0 to 1.0>,
  "intent": "momentum" | "value" | "contrarian" | "mean_reversion" | "hedge"
}`;
}

async function queryGrok(prompt: string): Promise<AgentDecision> {
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${XAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "grok-4-fast-non-reasoning",
      messages: [
        {
          role: "system",
          content:
            "You are a contrarian stock trader. You buy fear and sell greed. Look for overreactions and reversals. Always respond with valid JSON only.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 300,
      temperature: 0.7,
    }),
  });
  if (!res.ok) {
    throw new Error(`Grok API error: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as any;
  const content = data.choices[0].message.content.trim();
  return JSON.parse(content);
}

async function queryGPT(prompt: string): Promise<AgentDecision> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a momentum/technical stock trader. You ride trends, follow price action and volume breakouts. Always respond with valid JSON only.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 300,
      temperature: 0.5,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI API error: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as any;
  const content = data.choices[0].message.content.trim();
  return JSON.parse(content);
}

async function queryClaude(prompt: string): Promise<AgentDecision> {
  if (!ANTHROPIC_API_KEY || ANTHROPIC_API_KEY.startsWith("sk-ant-oat")) {
    throw new Error(
      "Anthropic API key is an OAuth token — needs a standard API key (sk-ant-api03-...) for direct calls"
    );
  }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-3-5-20241022",
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: `${prompt}\n\nYou are a value investor in the tradition of Warren Buffett. You seek undervalued stocks with a margin of safety. Conservative, fundamentals-driven. Respond with valid JSON only.`,
        },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`Anthropic API error: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as any;
  const content = data.content[0].text.trim();
  return JSON.parse(content);
}

// ---------------------------------------------------------------------------
// Trade Execution (Jupiter V1 + Solana signing)
// ---------------------------------------------------------------------------

async function executeSwap(
  decision: AgentDecision,
  mode: "live" | "paper"
): Promise<{ outAmount: string; txSignature?: string }> {
  if (decision.side === "hold") {
    return { outAmount: "0" };
  }

  const symbol = decision.symbol as Ticker;
  const stockMint = MINTS[symbol];
  if (!stockMint) throw new Error(`Unknown symbol: ${symbol}`);

  // Determine swap direction
  const inputMint = decision.side === "buy" ? MINTS.USDC : stockMint;
  const outputMint = decision.side === "buy" ? stockMint : MINTS.USDC;

  // Amount: USDC uses 6 decimals, xStocks use 6 decimals
  const amount =
    decision.side === "buy"
      ? Math.round(decision.amountUsdc * 1_000_000) // USDC amount
      : Math.round(decision.amountUsdc * 1_000_000); // token amount (amountUsdc repurposed for sell qty)

  // Get quote
  const quote = await jupiterQuote(inputMint, outputMint, amount);
  console.log(
    `    Quote: ${decision.side} ${decision.symbol} — in: ${quote.inAmount}, out: ${quote.outAmount}`
  );

  if (mode === "paper") {
    console.log(`    [PAPER] Simulated execution — no on-chain tx`);
    return { outAmount: quote.outAmount };
  }

  // Live mode: build swap transaction
  if (!SOLANA_PRIVATE_KEY) {
    throw new Error(
      "SOLANA_PRIVATE_KEY not set — cannot sign transactions in live mode"
    );
  }

  const swapData = await jupiterSwap(quote);

  if (swapData.swapTransaction) {
    // Decode, sign, and send the versioned transaction
    const { Connection, VersionedTransaction, Keypair } = await import(
      "@solana/web3.js"
    );
    const bs58 = (await import("bs58")).default;

    const connection = new Connection(SOLANA_RPC_URL, "confirmed");
    const keypair = Keypair.fromSecretKey(bs58.decode(SOLANA_PRIVATE_KEY));

    const txBuf = Buffer.from(swapData.swapTransaction, "base64");
    const transaction = VersionedTransaction.deserialize(txBuf);
    transaction.sign([keypair]);

    const rawTransaction = transaction.serialize();
    const txSignature = await connection.sendRawTransaction(rawTransaction, {
      skipPreflight: true,
      maxRetries: 3,
    });

    console.log(`    [LIVE] Transaction sent: ${txSignature}`);

    // Wait for confirmation
    const latestBlockhash = await connection.getLatestBlockhash();
    await connection.confirmTransaction(
      {
        signature: txSignature,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      },
      "confirmed"
    );
    console.log(`    [LIVE] Confirmed!`);

    return { outAmount: quote.outAmount, txSignature };
  }

  throw new Error("Jupiter swap response missing swapTransaction");
}

// ---------------------------------------------------------------------------
// Funding: Swap SOL → USDC
// ---------------------------------------------------------------------------

async function fundWithSol(solAmount: number): Promise<void> {
  console.log(`\n💰 Funding: Swapping ${solAmount} SOL → USDC...`);
  const lamports = Math.round(solAmount * 1_000_000_000);

  const quote = await jupiterQuote(MINTS.SOL, MINTS.USDC, lamports);
  const usdcOut = parseInt(quote.outAmount) / 1_000_000;
  console.log(`  Quote: ${solAmount} SOL → ${usdcOut.toFixed(2)} USDC`);

  if (TRADING_MODE === "paper") {
    console.log(`  [PAPER] Simulated SOL→USDC swap`);
    return;
  }

  if (!SOLANA_PRIVATE_KEY) {
    console.log(`  [SKIP] No private key — cannot execute funding swap`);
    return;
  }

  const result = await executeSwap(
    {
      symbol: "USDC" as any,
      side: "buy",
      amountUsdc: lamports,
      reason: "Funding wallet with USDC for trading",
      confidence: 1.0,
      intent: "hedge",
    },
    "live"
  );
  console.log(`  Funded! TX: ${result.txSignature}`);
}

// ---------------------------------------------------------------------------
// Main Battle Loop
// ---------------------------------------------------------------------------

async function runBattle(): Promise<void> {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  MoltApp Battle — ${new Date().toISOString()}`);
  console.log(`  Mode: ${TRADING_MODE.toUpperCase()}`);
  console.log(`  Wallet: ${WALLET_ADDRESS}`);
  console.log(`${"=".repeat(60)}\n`);

  // Check for --fund flag
  const fundArg = process.argv.find((a) => a.startsWith("--fund"));
  if (fundArg) {
    const solAmount = parseFloat(fundArg.split("=")[1] ?? process.argv[process.argv.indexOf(fundArg) + 1] ?? "1");
    await fundWithSol(solAmount);
  }

  // Step 1: Fetch market prices
  console.log("📊 Fetching market prices from Jupiter V1...");
  const prices = await fetchMarketPrices();
  for (const [symbol, data] of prices) {
    console.log(`  ${symbol}: $${data.pricePerToken.toFixed(2)}/token`);
  }

  // Step 2: Check wallet
  console.log("\n💳 Checking wallet balances...");
  const balances = await getWalletBalances();
  console.log(`  SOL: ${(balances.solLamports / 1e9).toFixed(4)}`);
  console.log(`  USDC: $${balances.usdcAmount.toFixed(2)}`);
  for (const [mint, amount] of balances.tokens) {
    if (mint !== MINTS.USDC && amount > 0) {
      const symbol = Object.entries(MINTS).find(([, m]) => m === mint)?.[0] ?? mint.slice(0, 8);
      console.log(`  ${symbol}: ${amount.toFixed(6)}`);
    }
  }

  // Step 3: Query agents sequentially (different LLMs)
  const agents: Array<{
    name: string;
    model: string;
    provider: string;
    queryFn: (prompt: string) => Promise<AgentDecision>;
    personality: string;
  }> = [
    {
      name: "Grok Trader",
      model: "grok-4-fast-non-reasoning",
      provider: "xai",
      queryFn: queryGrok,
      personality:
        "Contrarian trader. Buys fear, sells greed. Looks for overreactions and reversals in xStock prices.",
    },
    {
      name: "GPT Trader",
      model: "gpt-4o-mini",
      provider: "openai",
      queryFn: queryGPT,
      personality:
        "Momentum/technical trader. Rides trends, follows price action, tracks volume breakouts in xStocks.",
    },
    {
      name: "Claude Trader",
      model: "claude-haiku-3.5",
      provider: "anthropic",
      queryFn: queryClaude,
      personality:
        "Conservative value investor. Seeks undervalued stocks with margin of safety. Fundamentals-driven.",
    },
  ];

  const results: AgentResult[] = [];

  for (const agent of agents) {
    console.log(`\n🤖 ${agent.name} (${agent.model})...`);
    const start = Date.now();

    try {
      const prompt = buildTradingPrompt(prices, balances, agent.personality);
      const decision = await agent.queryFn(prompt);
      const elapsed = Date.now() - start;

      console.log(`  Decision: ${decision.side.toUpperCase()} ${decision.symbol}`);
      console.log(`  Amount: $${decision.amountUsdc} USDC`);
      console.log(`  Confidence: ${(decision.confidence * 100).toFixed(0)}%`);
      console.log(`  Reason: ${decision.reason}`);
      console.log(`  Intent: ${decision.intent}`);

      // Execute the trade
      let quoteOutAmount: string | undefined;
      let txSignature: string | undefined;

      if (decision.side !== "hold") {
        try {
          const execResult = await executeSwap(decision, TRADING_MODE);
          quoteOutAmount = execResult.outAmount;
          txSignature = execResult.txSignature;
        } catch (execErr: any) {
          console.log(`  ⚠️  Execution error: ${execErr.message}`);
        }
      }

      results.push({
        agent: agent.name,
        model: agent.model,
        provider: agent.provider,
        decision,
        quoteOutAmount,
        txSignature,
        durationMs: elapsed,
      });
    } catch (err: any) {
      const elapsed = Date.now() - start;
      console.log(`  ❌ Error: ${err.message}`);
      results.push({
        agent: agent.name,
        model: agent.model,
        provider: agent.provider,
        decision: {
          symbol: "N/A",
          side: "hold",
          amountUsdc: 0,
          reason: `Agent error: ${err.message}`,
          confidence: 0,
          intent: "N/A",
        },
        error: err.message,
        durationMs: elapsed,
      });
    }
  }

  // Step 4: Summary
  console.log(`\n${"=".repeat(60)}`);
  console.log("  BATTLE RESULTS");
  console.log(`${"=".repeat(60)}`);
  console.log(`  Mode: ${TRADING_MODE.toUpperCase()}`);
  console.log(`  Timestamp: ${new Date().toISOString()}`);
  console.log("");

  for (const r of results) {
    const status = r.error ? "❌ ERROR" : r.decision.side === "hold" ? "⏸  HOLD" : "✅ TRADED";
    console.log(
      `  ${status} | ${r.agent.padEnd(14)} | ${r.decision.side.toUpperCase().padEnd(4)} ${r.decision.symbol.padEnd(6)} | $${String(r.decision.amountUsdc).padEnd(5)} | ${(r.decision.confidence * 100).toFixed(0)}% conf | ${r.durationMs}ms`
    );
    if (r.txSignature) {
      console.log(`         TX: https://solscan.io/tx/${r.txSignature}`);
    }
  }

  // Output full JSON for benchmark ingestion
  const battleRecord = {
    timestamp: new Date().toISOString(),
    mode: TRADING_MODE,
    wallet: WALLET_ADDRESS,
    prices: Object.fromEntries(
      [...prices].map(([k, v]) => [k, { price: v.pricePerToken }])
    ),
    agents: results.map((r) => ({
      name: r.agent,
      model: r.model,
      provider: r.provider,
      decision: r.decision,
      execution: {
        outAmount: r.quoteOutAmount,
        txSignature: r.txSignature,
        error: r.error,
        durationMs: r.durationMs,
      },
    })),
  };

  console.log("\n📋 Full battle record (JSON):");
  console.log(JSON.stringify(battleRecord, null, 2));

  // Write to file for benchmark tracking
  const { writeFileSync } = await import("fs");
  const logPath = resolve(__dirname, `battle-${Date.now()}.json`);
  writeFileSync(logPath, JSON.stringify(battleRecord, null, 2));
  console.log(`\n📁 Battle log saved to: ${logPath}`);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

runBattle().catch((err) => {
  console.error("\n💥 Battle failed:", err);
  process.exit(1);
});
