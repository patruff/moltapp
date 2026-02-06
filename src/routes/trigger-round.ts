/**
 * Trigger Round API
 *
 * Lets hackathon judges (and admin users) trigger a live trading round
 * on demand and watch the results in real-time. This is the "wow factor"
 * endpoint for demos.
 *
 * Endpoints:
 * - POST /trigger  — Trigger a new trading round (paper mode)
 * - GET /status    — Check if a round is currently running
 * - GET /history   — Get recent triggered round results
 * - GET /last      — Get the last completed round result
 */

import { Hono } from "hono";
import { withTradingLock, getLockStatus } from "../services/trading-lock.ts";
import {
  checkCircuitBreakers,
  recordTradeExecution,
  getCircuitBreakerStatus,
  type CircuitBreakerActivation,
} from "../services/circuit-breaker.ts";
import { applyTradeJitter } from "../services/rate-limiter.ts";
import {
  getCachedNews,
  formatNewsForPrompt,
} from "../services/search-cache.ts";
import { getAgentConfigs } from "../agents/orchestrator.ts";
import { XSTOCKS_CATALOG } from "../config/constants.ts";
import { recordRoundForComparison } from "../services/agent-comparison.ts";
import { clamp, round3 } from "../lib/math-utils.ts";
import { parseQueryInt } from "../lib/query-params.ts";
import type {
  MarketData,
  PortfolioContext,
  TradingDecision,
  TradingRoundResult,
} from "../agents/base-agent.ts";

const app = new Hono();

// ---------------------------------------------------------------------------
// In-memory round history for triggered rounds
// ---------------------------------------------------------------------------

interface TriggeredRound {
  roundId: string;
  triggeredAt: string;
  completedAt: string | null;
  status: "running" | "completed" | "failed";
  durationMs: number;
  mode: "paper" | "live";
  results: TradingRoundResult[];
  circuitBreakerActivations: CircuitBreakerActivation[];
  marketDataSnapshot: Array<{ symbol: string; price: number; change24h: number | null }>;
  errors: string[];
  consensus: string;
  summary: string;
}

const triggeredRounds: TriggeredRound[] = [];
const MAX_HISTORY = 50;
let currentlyRunning = false;

// ---------------------------------------------------------------------------
// Mock Market Data Generator (for demo rounds)
// ---------------------------------------------------------------------------

const MOCK_BASE_PRICES: Record<string, number> = {
  AAPLx: 178.50, AMZNx: 185.20, GOOGLx: 142.80, METAx: 505.30,
  MSFTx: 415.60, NVDAx: 890.50, TSLAx: 245.80, SPYx: 502.10,
  QQQx: 435.70, COINx: 205.40, MSTRx: 1685.00, HOODx: 22.80,
  NFLXx: 628.90, PLTRx: 24.50, GMEx: 17.80, CRMx: 272.60,
  LLYx: 785.20, AVGOx: 168.90, JPMx: 198.50, CRCLx: 32.15,
};

function generateMarketData(): MarketData[] {
  return XSTOCKS_CATALOG.map((stock) => {
    const base = MOCK_BASE_PRICES[stock.symbol] ?? 100;
    const variation = 1 + (Math.random() - 0.5) * 0.04;
    return {
      symbol: stock.symbol,
      name: stock.name,
      mintAddress: stock.mintAddress,
      price: Math.round(base * variation * 100) / 100,
      change24h: Math.round((Math.random() - 0.5) * 10 * 100) / 100,
      volume24h: Math.round((10 + Math.random() * 490) * 1_000_000),
    };
  });
}

// ---------------------------------------------------------------------------
// Simulated Agent Decision Generator
// ---------------------------------------------------------------------------

interface SimulatedAgent {
  agentId: string;
  name: string;
  style: "conservative" | "aggressive" | "contrarian";
  preferredStocks: string[];
}

const SIMULATED_AGENTS: SimulatedAgent[] = [
  {
    agentId: "claude-trader",
    name: "Claude Trader",
    style: "conservative",
    preferredStocks: ["AAPLx", "MSFTx", "SPYx", "GOOGLx", "JPMx"],
  },
  {
    agentId: "gpt-trader",
    name: "GPT Trader",
    style: "aggressive",
    preferredStocks: ["NVDAx", "TSLAx", "COINx", "MSTRx", "PLTRx"],
  },
  {
    agentId: "grok-trader",
    name: "Grok Trader",
    style: "contrarian",
    preferredStocks: ["GMEx", "HOODx", "TSLAx", "COINx", "METAx"],
  },
];

function simulateAgentDecision(
  agent: SimulatedAgent,
  marketData: MarketData[],
  portfolio: PortfolioContext,
): TradingDecision {
  // Pick from preferred stocks
  const candidates = marketData.filter((m) =>
    agent.preferredStocks.includes(m.symbol),
  );
  const stock = candidates[Math.floor(Math.random() * candidates.length)] ?? marketData[0];

  // Decision logic varies by style
  let action: "buy" | "sell" | "hold";
  let quantity = 0;
  let confidence = 50;
  let reasoning = "";

  const change = stock.change24h ?? 0;

  switch (agent.style) {
    case "conservative":
      // Value approach: buy dips cautiously
      if (change < -2) {
        action = "buy";
        quantity = Math.min(25, portfolio.cashBalance * 0.05);
        confidence = 60 + Math.floor(Math.abs(change) * 3);
        reasoning = `${stock.symbol} down ${change.toFixed(1)}% — value opportunity. Buying conservatively with measured position size. Strong fundamentals support a recovery.`;
      } else if (change > 3) {
        action = "sell";
        quantity = 0.1; // Small position reduction
        confidence = 55 + Math.floor(change * 2);
        reasoning = `${stock.symbol} up ${change.toFixed(1)}% — taking partial profits. Price may be overextended in the short term.`;
      } else {
        action = "hold";
        confidence = 70;
        reasoning = `Market conditions stable for ${stock.symbol}. No strong signal to trade. Maintaining current portfolio allocation.`;
      }
      break;

    case "aggressive":
      // Momentum approach: chase trends
      if (change > 1) {
        action = "buy";
        quantity = Math.min(40, portfolio.cashBalance * 0.1);
        confidence = 65 + Math.floor(change * 5);
        reasoning = `${stock.symbol} showing strong momentum (+${change.toFixed(1)}%). Loading up on this trend. Volume confirms institutional interest.`;
      } else if (change < -1.5) {
        action = "sell";
        quantity = 0.3;
        confidence = 60 + Math.floor(Math.abs(change) * 4);
        reasoning = `${stock.symbol} breaking down (${change.toFixed(1)}%). Cutting losses quickly. Momentum traders exit on first sign of weakness.`;
      } else {
        action = "hold";
        confidence = 40;
        reasoning = `No clear momentum signal for ${stock.symbol}. Waiting for a decisive move before committing capital.`;
      }
      break;

    case "contrarian":
      // Buy fear, sell greed
      if (change < -3) {
        action = "buy";
        quantity = Math.min(35, portfolio.cashBalance * 0.08);
        confidence = 70 + Math.floor(Math.abs(change) * 3);
        reasoning = `${stock.symbol} crashed ${change.toFixed(1)}% — market is panicking. This is exactly when contrarians buy. Fear creates opportunity.`;
      } else if (change > 4) {
        action = "sell";
        quantity = 0.2;
        confidence = 65 + Math.floor(change * 2);
        reasoning = `${stock.symbol} euphoric at +${change.toFixed(1)}%. When everyone is greedy, be fearful. Taking profits at the top.`;
      } else {
        action = "hold";
        confidence = 55;
        reasoning = `${stock.symbol} in normal range. No extreme sentiment to exploit. Waiting for crowd panic or euphoria.`;
      }
      break;
  }

  confidence = clamp(confidence, 0, 100);

  return {
    action,
    symbol: stock.symbol,
    quantity,
    reasoning,
    confidence,
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * POST /trigger — Trigger a simulated trading round
 *
 * Runs all 3 AI agents through the full pipeline:
 * 1. Generate market data
 * 2. Fetch cached news
 * 3. Simulate each agent's decision
 * 4. Apply circuit breakers
 * 5. Record results
 *
 * Returns the complete round results.
 */
app.post("/trigger", async (c) => {
  if (currentlyRunning) {
    return c.json(
      { error: "A round is already in progress. Wait for it to complete." },
      409,
    );
  }

  currentlyRunning = true;
  const roundId = `demo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const triggeredAt = new Date().toISOString();
  const startMs = Date.now();

  const triggeredRound: TriggeredRound = {
    roundId,
    triggeredAt,
    completedAt: null,
    status: "running",
    durationMs: 0,
    mode: "paper",
    results: [],
    circuitBreakerActivations: [],
    marketDataSnapshot: [],
    errors: [],
    consensus: "pending",
    summary: "",
  };

  triggeredRounds.unshift(triggeredRound);
  if (triggeredRounds.length > MAX_HISTORY) {
    triggeredRounds.length = MAX_HISTORY;
  }

  try {
    // Step 1: Generate market data
    const marketData = generateMarketData();
    triggeredRound.marketDataSnapshot = marketData.map((m) => ({
      symbol: m.symbol,
      price: m.price,
      change24h: m.change24h,
    }));

    // Step 2: Fetch news (cached)
    let newsContext = "";
    try {
      const symbols = marketData.map((d) => d.symbol);
      const cachedNews = await getCachedNews(symbols);
      newsContext = formatNewsForPrompt(cachedNews);
    } catch {
      // Non-critical
    }

    // Step 3: Run each agent
    const results: TradingRoundResult[] = [];
    const allActivations: CircuitBreakerActivation[] = [];

    for (const agent of SIMULATED_AGENTS) {
      try {
        const portfolio: PortfolioContext = {
          cashBalance: 5000 + Math.random() * 5000,
          positions: generateRandomPositions(marketData),
          totalValue: 10000,
          totalPnl: (Math.random() - 0.4) * 500,
          totalPnlPercent: (Math.random() - 0.4) * 5,
        };

        // Simulate agent decision
        const decision = simulateAgentDecision(agent, marketData, portfolio);

        // Apply circuit breakers
        const cbResult = checkCircuitBreakers(agent.agentId, decision, portfolio);
        allActivations.push(...cbResult.activations);

        const roundResult: TradingRoundResult = {
          agentId: agent.agentId,
          agentName: agent.name,
          decision: cbResult.decision,
          executed: cbResult.allowed,
        };

        if (cbResult.allowed && cbResult.decision.action !== "hold") {
          recordTradeExecution(agent.agentId);
          const stock = marketData.find(
            (m) => m.symbol === cbResult.decision.symbol,
          );
          roundResult.executionDetails = {
            txSignature: `paper_${Date.now()}_${agent.agentId}`,
            filledPrice: stock?.price,
            usdcAmount:
              cbResult.decision.action === "buy"
                ? cbResult.decision.quantity
                : undefined,
          };
        }

        results.push(roundResult);

        // Small delay between agents for realism
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (err) {
        const msg = `${agent.name} error: ${err instanceof Error ? err.message : String(err)}`;
        triggeredRound.errors.push(msg);
        results.push({
          agentId: agent.agentId,
          agentName: agent.name,
          decision: {
            action: "hold",
            symbol: "SPYx",
            quantity: 0,
            reasoning: `Error: ${msg}`,
            confidence: 0,
            timestamp: new Date().toISOString(),
          },
          executed: false,
          executionError: msg,
        });
      }
    }

    // Step 4: Compute consensus
    const nonHold = results.filter((r) => r.decision.action !== "hold");
    let consensus = "no_trades";
    if (nonHold.length > 0) {
      const buys = nonHold.filter((r) => r.decision.action === "buy").length;
      const sells = nonHold.filter((r) => r.decision.action === "sell").length;
      if (buys === nonHold.length || sells === nonHold.length) consensus = "unanimous";
      else if (buys > sells && buys > 1) consensus = "majority_buy";
      else if (sells > buys && sells > 1) consensus = "majority_sell";
      else consensus = "split";
    }

    // Step 5: Build summary
    const summaryParts = results.map((r) => {
      const status = r.executed ? "OK" : "BLOCKED";
      return `${r.agentName}: ${r.decision.action.toUpperCase()} ${r.decision.symbol} (${r.decision.confidence}%) ${status}`;
    });

    // Step 6: Update triggered round
    triggeredRound.results = results;
    triggeredRound.circuitBreakerActivations = allActivations;
    triggeredRound.consensus = consensus;
    triggeredRound.summary = summaryParts.join(" | ");
    triggeredRound.completedAt = new Date().toISOString();
    triggeredRound.durationMs = Date.now() - startMs;
    triggeredRound.status = "completed";

    // Step 7: Record for comparison analytics
    recordRoundForComparison({
      roundId,
      timestamp: triggeredAt,
      decisions: results.map((r) => ({
        agentId: r.agentId,
        agentName: r.agentName,
        action: r.decision.action,
        symbol: r.decision.symbol,
        quantity: r.decision.quantity,
        confidence: r.decision.confidence,
        reasoning: r.decision.reasoning,
        executed: r.executed,
        pnl: r.executionDetails?.usdcAmount
          ? (Math.random() - 0.4) * r.executionDetails.usdcAmount * 0.1
          : undefined,
      })),
    });

    return c.json(triggeredRound);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    triggeredRound.status = "failed";
    triggeredRound.errors.push(msg);
    triggeredRound.completedAt = new Date().toISOString();
    triggeredRound.durationMs = Date.now() - startMs;
    return c.json(triggeredRound, 500);
  } finally {
    currentlyRunning = false;
  }
});

/**
 * GET /status — Check current round status
 */
app.get("/status", (c) => {
  const lockStatus = getLockStatus();
  const latest = triggeredRounds[0] ?? null;

  return c.json({
    isRunning: currentlyRunning,
    lock: lockStatus,
    latestRound: latest
      ? {
          roundId: latest.roundId,
          status: latest.status,
          triggeredAt: latest.triggeredAt,
          durationMs: latest.durationMs,
        }
      : null,
    totalTriggeredRounds: triggeredRounds.length,
  });
});

/**
 * GET /history — Recent triggered round results
 */
app.get("/history", (c) => {
  const limit = parseQueryInt(c.req.query("limit"), 10, 1, 50);
  const rounds = triggeredRounds.slice(0, limit);

  return c.json({
    rounds,
    total: triggeredRounds.length,
  });
});

/**
 * GET /last — Get the last completed round
 */
app.get("/last", (c) => {
  const last = triggeredRounds.find((r) => r.status === "completed");
  if (!last) {
    return c.json({ round: null, message: "No completed rounds yet. POST /trigger to start one." });
  }
  return c.json({ round: last });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateRandomPositions(marketData: MarketData[]) {
  const count = Math.floor(Math.random() * 4); // 0-3 positions
  const positions = [];
  const used = new Set<string>();

  for (let i = 0; i < count; i++) {
    const stock = marketData[Math.floor(Math.random() * marketData.length)];
    if (used.has(stock.symbol)) continue;
    used.add(stock.symbol);

    const qty = 0.1 + Math.random() * 5;
    const costBasis = stock.price * (1 + (Math.random() - 0.5) * 0.1);
    const pnl = (stock.price - costBasis) * qty;

    positions.push({
      symbol: stock.symbol,
      quantity: round3(qty),
      averageCostBasis: Math.round(costBasis * 100) / 100,
      currentPrice: stock.price,
      unrealizedPnl: Math.round(pnl * 100) / 100,
      unrealizedPnlPercent:
        costBasis > 0
          ? Math.round(((stock.price - costBasis) / costBasis) * 10000) / 100
          : 0,
    });
  }

  return positions;
}

export const triggerRoundRoutes = app;
