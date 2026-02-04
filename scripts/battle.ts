#!/usr/bin/env npx tsx
/**
 * MoltApp Battle Script v2
 *
 * Three AI agents research markets via Brave Search, then trade real xStocks
 * on Solana mainnet. Each agent gets $10 USDC budget and up to 5 web searches.
 *
 *   - Grok Agent (xAI grok-4-fast-reasoning) — Contrarian
 *   - GPT Agent (OpenAI gpt-5-mini) — Momentum/Quant
 *   - Claude Agent (Anthropic claude-3.5-haiku) — Value Investor
 *
 * Usage:
 *   npx tsx scripts/battle.ts              # Paper mode (default)
 *   TRADING_MODE=live npx tsx scripts/battle.ts  # Real trades
 */

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync, writeFileSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env
const envPath = resolve(__dirname, "../.env");
try {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
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
const WALLET_ADDRESS = process.env.SOLANA_WALLET_PUBLIC!;
const SOLANA_PRIVATE_KEY = process.env.SOLANA_WALLET_PRIVATE;
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL!;
const JUPITER_API_KEY = process.env.JUPITER_API_KEY!;
const XAI_API_KEY = process.env.XAI_API_KEY!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;
const BRAVE_API_KEY = process.env.BRAVE_API_KEY!;

const AGENT_BUDGET_USDC = 2; // $2 per agent for testing (tiny trades)
const MAX_SEARCHES = 3; // searches per agent

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
  searchQueries?: string[];
}

interface AgentResult {
  agent: string;
  model: string;
  provider: string;
  decision: AgentDecision;
  research: string[];
  quoteOutAmount?: string;
  txSignature?: string;
  error?: string;
  durationMs: number;
}

interface MarketPrice {
  symbol: string;
  mint: string;
  pricePerToken: number;
}

// ---------------------------------------------------------------------------
// Brave Search
// ---------------------------------------------------------------------------

async function braveSearch(query: string): Promise<string> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", "5");

  const res = await fetch(url.toString(), {
    headers: {
      "X-Subscription-Token": BRAVE_API_KEY,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    return `Search failed: ${res.status}`;
  }
  const data = (await res.json()) as any;
  const results = data.web?.results ?? [];
  return results
    .slice(0, 5)
    .map((r: any) => `- ${r.title}: ${(r.description ?? "").slice(0, 150)}`)
    .join("\n");
}

async function researchStock(symbol: string): Promise<string> {
  const realName: Record<string, string> = {
    AAPLx: "Apple AAPL",
    NVDAx: "NVIDIA NVDA",
    TSLAx: "Tesla TSLA",
  };
  const name = realName[symbol] ?? symbol;

  const queries = [
    `${name} stock price today February 2026`,
    `${name} stock news latest analyst rating`,
    `${name} earnings outlook 2026`,
  ];

  const results: string[] = [];
  for (const q of queries.slice(0, MAX_SEARCHES)) {
    console.log(`    Searching: "${q}"`);
    const r = await braveSearch(q);
    results.push(`[${q}]\n${r}`);
  }
  return results.join("\n\n");
}

// ---------------------------------------------------------------------------
// Jupiter V1 API
// ---------------------------------------------------------------------------

async function jupiterQuote(
  inputMint: string,
  outputMint: string,
  amount: number,
  slippageBps = 150
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
    throw new Error(`Jupiter quote: ${res.status} ${await res.text()}`);
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
    throw new Error(`Jupiter swap: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Market Data & Wallet
// ---------------------------------------------------------------------------

async function fetchPrices(): Promise<Map<Ticker, MarketPrice>> {
  const prices = new Map<Ticker, MarketPrice>();
  const results = await Promise.all(
    TICKERS.map(async (symbol) => {
      const mint = MINTS[symbol];
      const quote = await jupiterQuote(MINTS.USDC, mint, 100_000_000); // 100 USDC
      const tokensPerHundredUsdc = parseInt(quote.outAmount) / 1_000_000;
      const pricePerToken = 100 / tokensPerHundredUsdc;
      return { symbol, mint, pricePerToken };
    })
  );
  for (const r of results) prices.set(r.symbol as Ticker, r);
  return prices;
}

async function getBalances() {
  const [balRes, tokenRes] = await Promise.all([
    fetch(SOLANA_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "getBalance",
        params: [WALLET_ADDRESS],
      }),
    }),
    fetch(SOLANA_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 2, method: "getTokenAccountsByOwner",
        params: [WALLET_ADDRESS,
          { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
          { encoding: "jsonParsed" }],
      }),
    }),
  ]);

  const balData = (await balRes.json()) as any;
  const tokData = (await tokenRes.json()) as any;

  const solLamports: number = balData.result?.value ?? 0;
  const tokens = new Map<string, number>();
  let usdcAmount = 0;

  for (const acct of tokData.result?.value ?? []) {
    const info = acct.account?.data?.parsed?.info;
    if (info) {
      const mint: string = info.mint;
      const amt = parseFloat(info.tokenAmount?.uiAmountString ?? "0");
      tokens.set(mint, amt);
      if (mint === MINTS.USDC) usdcAmount = amt;
    }
  }
  return { solLamports, usdcAmount, tokens };
}

// ---------------------------------------------------------------------------
// LLM Agents
// ---------------------------------------------------------------------------

function buildPrompt(
  prices: Map<Ticker, MarketPrice>,
  balances: { usdcAmount: number; tokens: Map<string, number> },
  personality: string,
  research: string,
  budget: number
): string {
  const priceLines = TICKERS.map(
    (t) => `  ${t}: $${prices.get(t)!.pricePerToken.toFixed(2)}/token`
  ).join("\n");

  const positions = TICKERS.map((t) => {
    const held = balances.tokens.get(MINTS[t]) ?? 0;
    return held > 0 ? `  ${t}: ${held.toFixed(6)} tokens` : null;
  })
    .filter(Boolean)
    .join("\n");

  return `You are an AI trading agent in the MoltApp benchmark on Solana.
Personality: ${personality}

MARKET PRICES (xStocks via Jupiter DEX — these are tokenized fractions of real stocks):
${priceLines}

YOUR BUDGET: $${budget.toFixed(2)} USDC for this trade
${positions ? `YOUR POSITIONS:\n${positions}` : "NO POSITIONS YET"}

RESEARCH (from web search):
${research}

RULES:
- Budget is $${budget.toFixed(2)} USDC. Trade between $1 and $${budget.toFixed(0)} USDC.
- You may hold if you see no opportunity.
- Provide clear reasoning backed by your research.

Respond with ONLY valid JSON (no markdown fences):
{
  "symbol": "AAPLx" | "NVDAx" | "TSLAx",
  "side": "buy" | "sell" | "hold",
  "amountUsdc": <number, 1 to ${budget.toFixed(0)}>,
  "reason": "<2-4 sentences citing your research>",
  "confidence": <0.0 to 1.0>,
  "intent": "momentum" | "value" | "contrarian" | "mean_reversion" | "hedge"
}`;
}

function extractJson(text: string): any {
  // Strip markdown fences if present
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "");
  }
  return JSON.parse(cleaned);
}

async function queryGrok(prompt: string): Promise<AgentDecision> {
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${XAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "grok-4-fast-reasoning",
      messages: [
        {
          role: "system",
          content:
            "You are a contrarian stock trader. Buy fear, sell greed. Respond with valid JSON only, no markdown.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 500,
      temperature: 0.7,
    }),
  });
  if (!res.ok) throw new Error(`Grok: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as any;
  const content = data.choices[0].message.content.trim();
  return extractJson(content);
}

async function queryGPT(prompt: string): Promise<AgentDecision> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-5-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a quantitative momentum trader. Follow technicals, volume, and trend signals. Respond with valid JSON only.",
        },
        { role: "user", content: prompt },
      ],
      max_completion_tokens: 1000,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`GPT: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as any;
  const content = data.choices[0].message.content.trim();
  return extractJson(content);
}

async function queryClaude(prompt: string): Promise<AgentDecision> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-3-5-haiku-latest",
      max_tokens: 500,
      system:
        "You are a conservative value investor. Seek margin of safety, fundamentals. Respond with valid JSON only, no markdown.",
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Claude: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as any;
  const content = data.content[0].text.trim();
  return extractJson(content);
}

// ---------------------------------------------------------------------------
// Trade Execution
// ---------------------------------------------------------------------------

async function executeSwap(
  decision: AgentDecision,
  mode: "live" | "paper"
): Promise<{ outAmount: string; txSignature?: string }> {
  if (decision.side === "hold") return { outAmount: "0" };

  const symbol = decision.symbol as Ticker;
  const stockMint = MINTS[symbol];
  if (!stockMint) throw new Error(`Unknown symbol: ${symbol}`);

  const inputMint = decision.side === "buy" ? MINTS.USDC : stockMint;
  const outputMint = decision.side === "buy" ? stockMint : MINTS.USDC;
  const amount = Math.round(decision.amountUsdc * 1_000_000);

  const quote = await jupiterQuote(inputMint, outputMint, amount);
  const outTokens = parseInt(quote.outAmount) / 1_000_000;
  console.log(
    `    Quote: ${decision.side} ${decision.symbol} — $${decision.amountUsdc} USDC -> ${outTokens.toFixed(6)} tokens`
  );

  if (mode === "paper") {
    console.log(`    [PAPER] Simulated — no on-chain tx`);
    return { outAmount: quote.outAmount };
  }

  // LIVE MODE
  if (!SOLANA_PRIVATE_KEY) {
    throw new Error("SOLANA_WALLET_PRIVATE not set");
  }

  const swapData = await jupiterSwap(quote);

  if (!swapData.swapTransaction) {
    throw new Error("Jupiter response missing swapTransaction");
  }

  const { Connection, VersionedTransaction, Keypair } = await import(
    "@solana/web3.js"
  );
  const bs58 = (await import("bs58")).default;

  const connection = new Connection(SOLANA_RPC_URL, "confirmed");
  const keypair = Keypair.fromSecretKey(bs58.decode(SOLANA_PRIVATE_KEY));

  const txBuf = Buffer.from(swapData.swapTransaction, "base64");
  const transaction = VersionedTransaction.deserialize(txBuf);
  transaction.sign([keypair]);

  const txSignature = await connection.sendRawTransaction(
    transaction.serialize(),
    { skipPreflight: true, maxRetries: 3 }
  );
  console.log(`    [LIVE] TX sent: ${txSignature}`);

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

// ---------------------------------------------------------------------------
// Main Battle
// ---------------------------------------------------------------------------

async function runBattle(): Promise<void> {
  const startTime = Date.now();
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  MoltApp Battle v2 — ${new Date().toISOString()}`);
  console.log(`  Mode: ${TRADING_MODE.toUpperCase()}`);
  console.log(`  Wallet: ${WALLET_ADDRESS}`);
  console.log(`  Agent Budget: $${AGENT_BUDGET_USDC} USDC each`);
  console.log(`${"=".repeat(60)}\n`);

  // 1. Prices
  console.log("Fetching xStock prices from Jupiter V1...");
  const prices = await fetchPrices();
  for (const [sym, p] of prices) {
    console.log(`  ${sym}: $${p.pricePerToken.toFixed(2)}/token`);
  }

  // 2. Balances
  console.log("\nChecking wallet...");
  const balances = await getBalances();
  console.log(`  SOL: ${(balances.solLamports / 1e9).toFixed(4)}`);
  console.log(`  USDC: $${balances.usdcAmount.toFixed(2)}`);
  for (const [mint, amount] of balances.tokens) {
    if (mint !== MINTS.USDC && amount > 0) {
      const sym =
        Object.entries(MINTS).find(([, m]) => m === mint)?.[0] ?? "unknown";
      console.log(`  ${sym}: ${amount.toFixed(6)}`);
    }
  }

  if (balances.usdcAmount < AGENT_BUDGET_USDC && TRADING_MODE === "live") {
    console.log(`\n  WARNING: Only $${balances.usdcAmount.toFixed(2)} USDC — need $${AGENT_BUDGET_USDC * 3} for all 3 agents`);
  }

  // 3. Research phase — all 3 stocks in parallel
  console.log("\nResearching markets via Brave Search...");
  const researchResults = new Map<string, string>();
  for (const ticker of TICKERS) {
    const research = await researchStock(ticker);
    researchResults.set(ticker, research);
  }
  const allResearch = TICKERS.map(
    (t) => `=== ${t} ===\n${researchResults.get(t)}`
  ).join("\n\n");

  // 4. Agent decisions
  const agents = [
    {
      name: "Grok Trader",
      model: "grok-4-fast-reasoning",
      provider: "xai",
      queryFn: queryGrok,
      personality:
        "Contrarian. Buys fear, sells greed. Looks for overreactions. Finds value where others see risk.",
    },
    {
      name: "GPT Trader",
      model: "gpt-5-mini",
      provider: "openai",
      queryFn: queryGPT,
      personality:
        "Quant momentum trader. Follows technicals, trend strength, volume breakouts. Data-driven.",
    },
    {
      name: "Claude Trader",
      model: "claude-3.5-haiku",
      provider: "anthropic",
      queryFn: queryClaude,
      personality:
        "Conservative value investor. Warren Buffett style. Margin of safety. Fundamentals over hype.",
    },
  ];

  const results: AgentResult[] = [];

  for (const agent of agents) {
    console.log(`\n--- ${agent.name} (${agent.model}) ---`);
    const start = Date.now();

    try {
      const prompt = buildPrompt(
        prices,
        balances,
        agent.personality,
        allResearch,
        AGENT_BUDGET_USDC
      );
      console.log(`  Thinking...`);
      const decision = await agent.queryFn(prompt);
      const elapsed = Date.now() - start;

      // Clamp amount to budget
      if (decision.amountUsdc > AGENT_BUDGET_USDC) {
        decision.amountUsdc = AGENT_BUDGET_USDC;
      }

      console.log(
        `  Decision: ${decision.side.toUpperCase()} ${decision.symbol}`
      );
      console.log(`  Amount: $${decision.amountUsdc} USDC`);
      console.log(
        `  Confidence: ${((decision.confidence ?? 0) * 100).toFixed(0)}%`
      );
      console.log(`  Intent: ${decision.intent}`);
      console.log(`  Reason: ${decision.reason}`);

      let quoteOutAmount: string | undefined;
      let txSignature: string | undefined;

      if (decision.side !== "hold" && decision.amountUsdc >= 1) {
        try {
          const exec = await executeSwap(decision, TRADING_MODE);
          quoteOutAmount = exec.outAmount;
          txSignature = exec.txSignature;
        } catch (e: any) {
          console.log(`  Exec error: ${e.message}`);
        }
      }

      results.push({
        agent: agent.name,
        model: agent.model,
        provider: agent.provider,
        decision,
        research: [allResearch.slice(0, 500) + "..."],
        quoteOutAmount,
        txSignature,
        durationMs: elapsed,
      });
    } catch (err: any) {
      console.log(`  ERROR: ${err.message}`);
      results.push({
        agent: agent.name,
        model: agent.model,
        provider: agent.provider,
        decision: {
          symbol: "N/A",
          side: "hold",
          amountUsdc: 0,
          reason: `Error: ${err.message}`,
          confidence: 0,
          intent: "N/A",
        },
        research: [],
        error: err.message,
        durationMs: Date.now() - start,
      });
    }
  }

  // 5. Summary
  const totalDuration = Date.now() - startTime;
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  BATTLE RESULTS — ${TRADING_MODE.toUpperCase()} MODE`);
  console.log(`${"=".repeat(60)}`);

  for (const r of results) {
    const icon = r.error
      ? "X"
      : r.decision.side === "hold"
        ? "-"
        : ">";
    console.log(
      `  ${icon} ${r.agent.padEnd(14)} | ${r.decision.side.toUpperCase().padEnd(4)} ${(r.decision.symbol ?? "").padEnd(6)} | $${String(r.decision.amountUsdc).padEnd(4)} | ${((r.decision.confidence ?? 0) * 100).toFixed(0)}% | ${r.durationMs}ms`
    );
    if (r.txSignature) {
      console.log(
        `    https://solscan.io/tx/${r.txSignature}`
      );
    }
  }
  console.log(`\n  Total time: ${(totalDuration / 1000).toFixed(1)}s`);

  // 6. Save battle record
  const record = {
    version: 2,
    timestamp: new Date().toISOString(),
    mode: TRADING_MODE,
    wallet: WALLET_ADDRESS,
    budget_per_agent: AGENT_BUDGET_USDC,
    prices: Object.fromEntries(
      [...prices].map(([k, v]) => [k, v.pricePerToken])
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

  const logPath = resolve(__dirname, `battle-${Date.now()}.json`);
  writeFileSync(logPath, JSON.stringify(record, null, 2));
  console.log(`\n  Battle log: ${logPath}`);
}

runBattle().catch((err) => {
  console.error("\nBattle failed:", err);
  process.exit(1);
});
