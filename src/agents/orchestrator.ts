/**
 * Trading Orchestrator
 *
 * Runs all 3 AI agents in parallel, collects their decisions, executes trades,
 * and records everything to the database. This is the heart of MoltApp's
 * autonomous trading system.
 *
 * Architecture:
 * 1. Fetch current market data for all stocks
 * 2. Build portfolio context for each agent
 * 3. Run all 3 agents in parallel (Claude, GPT, Grok)
 * 4. Execute trade decisions that pass validation
 * 5. Record decisions + execution results to DB
 */

import { db } from "../db/index.ts";
import { agentDecisions } from "../db/schema/agent-decisions.ts";
import { trades } from "../db/schema/trades.ts";
import { positions } from "../db/schema/positions.ts";
import { XSTOCKS_CATALOG } from "../config/constants.ts";
import { claudeTrader } from "./claude-trader.ts";
import { gptTrader } from "./gpt-trader.ts";
import { grokTrader } from "./grok-trader.ts";
import { eq, desc, sql } from "drizzle-orm";
import type {
  BaseTradingAgent,
  MarketData,
  PortfolioContext,
  AgentPosition,
  TradingDecision,
  TradingRoundResult,
} from "./base-agent.ts";
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
  getSearchCacheMetrics,
} from "../services/search-cache.ts";
import { recordBalanceSnapshot, preTradeFundCheck } from "../services/agent-wallets.ts";
import {
  executeDecision as executeTradeDecision,
  executePipeline,
  getExecutionStats,
  getTradingMode,
  type ExecutionResult,
} from "../services/trade-executor.ts";
import { emitTradeAlert, emitRoundCompletedAlert, emitAgentDisagreementAlert } from "../services/alert-webhooks.ts";

// ---------------------------------------------------------------------------
// All registered agents
// ---------------------------------------------------------------------------

/** The 3 competing AI agents */
const ALL_AGENTS: BaseTradingAgent[] = [claudeTrader, gptTrader, grokTrader];

/** Agent configs for API responses (without live client instances) */
export function getAgentConfigs() {
  return ALL_AGENTS.map((a) => ({
    agentId: a.config.agentId,
    name: a.config.name,
    model: a.config.model,
    provider: a.config.provider,
    description: a.config.description,
    personality: a.config.personality,
    riskTolerance: a.config.riskTolerance,
    tradingStyle: a.config.tradingStyle,
    maxPositionSize: a.config.maxPositionSize,
    maxPortfolioAllocation: a.config.maxPortfolioAllocation,
  }));
}

/** Get a specific agent config by ID */
export function getAgentConfig(agentId: string) {
  const agent = ALL_AGENTS.find((a) => a.config.agentId === agentId);
  return agent
    ? {
        agentId: agent.config.agentId,
        name: agent.config.name,
        model: agent.config.model,
        provider: agent.config.provider,
        description: agent.config.description,
        personality: agent.config.personality,
        riskTolerance: agent.config.riskTolerance,
        tradingStyle: agent.config.tradingStyle,
        maxPositionSize: agent.config.maxPositionSize,
        maxPortfolioAllocation: agent.config.maxPortfolioAllocation,
      }
    : null;
}

// ---------------------------------------------------------------------------
// Market Data Fetching
// ---------------------------------------------------------------------------

/**
 * Fetch current market data for all xStocks tokens.
 * Uses Jupiter Price API V3 for real prices, with fallback to mock data.
 */
export async function getMarketData(): Promise<MarketData[]> {
  const results: MarketData[] = [];

  try {
    // Try to fetch real prices from Jupiter
    const mintAddresses = XSTOCKS_CATALOG.map((s) => s.mintAddress);
    const jupiterApiKey = process.env.JUPITER_API_KEY;

    // Batch in groups of 50 (Jupiter limit)
    const batches: string[][] = [];
    for (let i = 0; i < mintAddresses.length; i += 50) {
      batches.push(mintAddresses.slice(i, i + 50));
    }

    const priceMap = new Map<string, number>();

    for (const batch of batches) {
      const ids = batch.join(",");
      const url = `https://api.jup.ag/price/v3?ids=${ids}`;
      const headers: Record<string, string> = {};
      if (jupiterApiKey) {
        headers["x-api-key"] = jupiterApiKey;
      }

      try {
        const resp = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
        if (resp.ok) {
          const data = (await resp.json()) as {
            data: Record<string, { price: string }>;
          };
          for (const [mint, info] of Object.entries(data.data)) {
            if (info?.price) {
              priceMap.set(mint, parseFloat(info.price));
            }
          }
        }
      } catch {
        // Jupiter API failed for this batch, will use mock prices
      }
    }

    // Build market data from catalog
    for (const stock of XSTOCKS_CATALOG) {
      const price = priceMap.get(stock.mintAddress) ?? generateMockPrice(stock.symbol);
      const change24h = priceMap.has(stock.mintAddress) ? null : generateMockChange();
      const volume24h = priceMap.has(stock.mintAddress) ? null : generateMockVolume();

      results.push({
        symbol: stock.symbol,
        name: stock.name,
        mintAddress: stock.mintAddress,
        price,
        change24h,
        volume24h,
      });
    }
  } catch {
    // Complete fallback to mock data
    for (const stock of XSTOCKS_CATALOG) {
      results.push({
        symbol: stock.symbol,
        name: stock.name,
        mintAddress: stock.mintAddress,
        price: generateMockPrice(stock.symbol),
        change24h: generateMockChange(),
        volume24h: generateMockVolume(),
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Portfolio Context Builder
// ---------------------------------------------------------------------------

/**
 * Build the portfolio context for an AI agent by querying its positions.
 * In production this reads from the DB. For demo/simulation we use mock data.
 */
export async function getPortfolioContext(
  agentId: string,
  marketData: MarketData[],
): Promise<PortfolioContext> {
  try {
    // Query agent's current positions from DB
    const agentPositions = await db
      .select()
      .from(positions)
      .where(eq(positions.agentId, agentId));

    // Query agent's total deposits/withdrawals to calculate PnL
    const agentTrades = await db
      .select()
      .from(trades)
      .where(eq(trades.agentId, agentId));

    // Calculate cash balance: start with initial capital, subtract buys, add sells
    const INITIAL_CAPITAL = 10000; // $10k starting capital per AI agent
    let cashBalance = INITIAL_CAPITAL;
    for (const trade of agentTrades) {
      if (trade.side === "buy") {
        cashBalance -= parseFloat(trade.usdcAmount);
      } else if (trade.side === "sell") {
        cashBalance += parseFloat(trade.usdcAmount);
      }
    }

    // Build position details with current market prices
    const positionDetails: AgentPosition[] = agentPositions.map((pos) => {
      const market = marketData.find(
        (m) => m.symbol.toLowerCase() === pos.symbol.toLowerCase(),
      );
      const currentPrice = market?.price ?? parseFloat(pos.averageCostBasis);
      const qty = parseFloat(pos.quantity);
      const costBasis = parseFloat(pos.averageCostBasis);
      const unrealizedPnl = (currentPrice - costBasis) * qty;
      const unrealizedPnlPercent =
        costBasis > 0 ? ((currentPrice - costBasis) / costBasis) * 100 : 0;

      return {
        symbol: pos.symbol,
        quantity: qty,
        averageCostBasis: costBasis,
        currentPrice,
        unrealizedPnl,
        unrealizedPnlPercent,
      };
    });

    // Total portfolio value
    const positionsValue = positionDetails.reduce(
      (sum, p) => sum + p.currentPrice * p.quantity,
      0,
    );
    const totalValue = cashBalance + positionsValue;
    const totalPnl = totalValue - INITIAL_CAPITAL;
    const totalPnlPercent =
      INITIAL_CAPITAL > 0 ? (totalPnl / INITIAL_CAPITAL) * 100 : 0;

    return {
      cashBalance: Math.max(0, cashBalance),
      positions: positionDetails,
      totalValue,
      totalPnl,
      totalPnlPercent,
    };
  } catch (error) {
    // Fallback to default portfolio
    console.error(
      `[Orchestrator] Failed to build portfolio for ${agentId}:`,
      error,
    );
    return {
      cashBalance: 10000,
      positions: [],
      totalValue: 10000,
      totalPnl: 0,
      totalPnlPercent: 0,
    };
  }
}

// ---------------------------------------------------------------------------
// Trade Execution
// ---------------------------------------------------------------------------

/**
 * Execute a single agent's trading decision.
 * Records the decision to the agent_decisions table, then calls the
 * Trade Execution Engine to actually execute the trade (live or paper).
 */
async function executeAgentDecision(
  agent: BaseTradingAgent,
  decision: TradingDecision,
  marketData: MarketData[],
  roundId: string,
): Promise<TradingRoundResult> {
  const result: TradingRoundResult = {
    agentId: agent.agentId,
    agentName: agent.name,
    decision,
    executed: false,
  };

  // Record the decision to DB regardless of execution
  try {
    await db.insert(agentDecisions).values({
      agentId: agent.agentId,
      symbol: decision.symbol,
      action: decision.action,
      quantity: String(decision.quantity),
      reasoning: decision.reasoning,
      confidence: decision.confidence,
      modelUsed: agent.model,
      roundId,
      marketSnapshot: marketData.reduce(
        (acc, d) => {
          acc[d.symbol] = { price: d.price, change24h: d.change24h };
          return acc;
        },
        {} as Record<string, { price: number; change24h: number | null }>,
      ),
    });
  } catch (err) {
    console.error(
      `[Orchestrator] Failed to record decision for ${agent.agentId}:`,
      err,
    );
  }

  // Only execute buy/sell actions
  if (decision.action === "hold") {
    result.executed = true; // "Hold" is always successfully executed
    return result;
  }

  // Execute the trade via the Trade Execution Engine
  // This handles both live (Jupiter swaps) and paper (simulated) modes
  try {
    const execResult: ExecutionResult = await executeTradeDecision({
      agentId: agent.agentId,
      agentName: agent.name,
      decision,
      roundId,
    });

    result.executed = execResult.success;

    if (execResult.success) {
      result.executionDetails = {
        txSignature: execResult.tradeResult?.txSignature ?? execResult.paperTradeId,
        filledPrice: execResult.tradeResult
          ? parseFloat(execResult.tradeResult.pricePerToken)
          : undefined,
        usdcAmount: execResult.tradeResult
          ? parseFloat(execResult.tradeResult.usdcAmount)
          : (decision.action === "buy" ? decision.quantity : undefined),
        filledQuantity: execResult.tradeResult
          ? parseFloat(execResult.tradeResult.stockQuantity)
          : (decision.action === "sell" ? decision.quantity : undefined),
      };

      console.log(
        `[Orchestrator] ${agent.name} trade EXECUTED (${getTradingMode()}): ` +
        `${decision.action} ${decision.symbol} — ` +
        `tx: ${execResult.tradeResult?.txSignature ?? execResult.paperTradeId}`,
      );
    } else {
      result.executionError = execResult.error;
      console.warn(
        `[Orchestrator] ${agent.name} trade FAILED: ${execResult.error}`,
      );
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    result.executionError = errorMsg;
    console.error(
      `[Orchestrator] ${agent.name} execution error: ${errorMsg}`,
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// Trading Round Orchestrator
// ---------------------------------------------------------------------------

/**
 * Run a complete trading round with full production safety controls.
 *
 * Integrated services:
 * 1. Trading Lock — prevents concurrent rounds
 * 2. Search Cache — one search per cycle, shared across agents
 * 3. Circuit Breakers — enforces trade limits, cooldowns, position limits
 * 4. Trade Jitter — random delay between agent executions
 * 5. Balance Snapshots — record balances before/after trades
 *
 * This is the main entry point called by the cron/EventBridge trigger.
 */
export async function runTradingRound(): Promise<{
  roundId: string;
  timestamp: string;
  results: TradingRoundResult[];
  errors: string[];
  circuitBreakerActivations: CircuitBreakerActivation[];
  lockSkipped: boolean;
}> {
  const roundId = `round_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const timestamp = new Date().toISOString();

  console.log(`[Orchestrator] Starting trading round ${roundId} at ${timestamp}`);

  // Step 0: Acquire trading lock (prevents concurrent rounds)
  const lockResult = await withTradingLock(roundId, async () => {
    return await executeTradingRound(roundId, timestamp);
  });

  if (!lockResult) {
    const lockStatus = getLockStatus();
    console.log(
      `[Orchestrator] Round ${roundId} SKIPPED — another round is in progress (lock: ${lockStatus.lock?.lockId ?? "unknown"})`,
    );
    return {
      roundId,
      timestamp,
      results: [],
      errors: ["Trading round skipped — another round is in progress"],
      circuitBreakerActivations: [],
      lockSkipped: true,
    };
  }

  return lockResult.result;
}

/**
 * Inner trading round execution (runs while holding the lock).
 */
async function executeTradingRound(
  roundId: string,
  timestamp: string,
): Promise<{
  roundId: string;
  timestamp: string;
  results: TradingRoundResult[];
  errors: string[];
  circuitBreakerActivations: CircuitBreakerActivation[];
  lockSkipped: boolean;
}> {
  const errors: string[] = [];
  const allCircuitBreakerActivations: CircuitBreakerActivation[] = [];

  // Step 1: Fetch market data
  let marketData: MarketData[];
  try {
    marketData = await getMarketData();
    console.log(
      `[Orchestrator] Fetched market data for ${marketData.length} stocks`,
    );
  } catch (error) {
    const msg = `Failed to fetch market data: ${error instanceof Error ? error.message : String(error)}`;
    console.error(`[Orchestrator] ${msg}`);
    return {
      roundId,
      timestamp,
      results: [],
      errors: [msg],
      circuitBreakerActivations: [],
      lockSkipped: false,
    };
  }

  // Step 2: Fetch news (cached — one search per cycle for all agents)
  let newsContext = "";
  try {
    const symbols = marketData.map((d) => d.symbol);
    const cachedNews = await getCachedNews(symbols);
    newsContext = formatNewsForPrompt(cachedNews);
    console.log(
      `[Orchestrator] News context ready (${cachedNews.items.length} items, cache: ${getSearchCacheMetrics().hitRate}% hit rate)`,
    );
  } catch (err) {
    console.warn(
      `[Orchestrator] News fetch failed (non-critical): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Step 3: Inject news into market data for agent prompts
  if (newsContext) {
    for (const md of marketData) {
      md.news = md.news ?? [];
      md.news.push(newsContext);
    }
  }

  // Step 4: Run all agents sequentially with jitter and circuit breakers
  const results: TradingRoundResult[] = [];

  for (const agent of ALL_AGENTS) {
    try {
      console.log(`[Orchestrator] Running ${agent.name} (${agent.model})...`);

      // Pre-trade fund check
      const fundCheck = await preTradeFundCheck(agent.agentId);
      if (!fundCheck.ready) {
        console.warn(
          `[Orchestrator] ${agent.name} fund check failed: ${fundCheck.reason}`,
        );
        // Continue anyway — fund check is advisory for demo mode
      }

      // Record pre-trade balance snapshot
      await recordBalanceSnapshot(agent.agentId, `pre-trade-${roundId}`).catch(
        (err) =>
          console.warn(
            `[Orchestrator] Balance snapshot failed for ${agent.agentId}: ${err instanceof Error ? err.message : String(err)}`,
          ),
      );

      // Build portfolio context
      const portfolio = await getPortfolioContext(agent.agentId, marketData);

      // Get agent's trading decision
      const decision = await agent.analyze(marketData, portfolio);
      console.log(
        `[Orchestrator] ${agent.name} decided: ${decision.action} ${decision.symbol} (confidence: ${decision.confidence}%)`,
      );

      // Apply circuit breakers
      const cbResult = checkCircuitBreakers(
        agent.agentId,
        decision,
        portfolio,
      );
      allCircuitBreakerActivations.push(...cbResult.activations);

      if (!cbResult.allowed) {
        console.log(
          `[Orchestrator] ${agent.name} decision BLOCKED by circuit breaker`,
        );
      }

      // Execute the (possibly modified) decision via the Trade Execution Engine
      const execResult = await executeAgentDecision(
        agent,
        cbResult.decision,
        marketData,
        roundId,
      );

      // Record circuit breaker info in result
      if (cbResult.activations.length > 0) {
        execResult.executionDetails = execResult.executionDetails ?? {};
      }

      // Record trade execution in circuit breaker state
      if (
        execResult.executed &&
        cbResult.decision.action !== "hold"
      ) {
        recordTradeExecution(agent.agentId);
      }

      // Record post-trade balance snapshot
      await recordBalanceSnapshot(agent.agentId, `post-trade-${roundId}`).catch(
        (err) =>
          console.warn(
            `[Orchestrator] Post-trade snapshot failed for ${agent.agentId}: ${err instanceof Error ? err.message : String(err)}`,
          ),
      );

      results.push(execResult);

      // Apply jitter between agents (1-5 seconds)
      await applyTradeJitter();
    } catch (error) {
      const msg = `${agent.name} failed: ${error instanceof Error ? error.message : String(error)}`;
      console.error(`[Orchestrator] ${msg}`);
      errors.push(msg);

      results.push({
        agentId: agent.agentId,
        agentName: agent.name,
        decision: {
          action: "hold" as const,
          symbol: "SPYx",
          quantity: 0,
          reasoning: `Agent error: ${msg}`,
          confidence: 0,
          timestamp: new Date().toISOString(),
        },
        executed: false,
        executionError: msg,
      });
    }
  }

  console.log(
    `[Orchestrator] Round ${roundId} complete. ${results.length} agents ran. ${errors.length} errors. ${allCircuitBreakerActivations.length} circuit breaker activations. Mode: ${getTradingMode()}.`,
  );

  // Emit round completion alert
  try {
    emitRoundCompletedAlert({
      roundId,
      results: results.map((r) => ({
        agentId: r.agentId,
        agentName: r.agentName,
        action: r.decision.action,
        symbol: r.decision.symbol,
        confidence: r.decision.confidence,
        executed: r.executed,
      })),
      errors,
      circuitBreakerActivations: allCircuitBreakerActivations.length,
    });
  } catch {
    // Non-critical — don't fail the round for alert emission
  }

  // Detect agent disagreements (opposite positions on the same stock)
  try {
    const nonHoldResults = results.filter((r) => r.decision.action !== "hold");
    const bySymbol = new Map<string, typeof nonHoldResults>();
    for (const r of nonHoldResults) {
      const list = bySymbol.get(r.decision.symbol) ?? [];
      list.push(r);
      bySymbol.set(r.decision.symbol, list);
    }
    for (const [symbol, symbolResults] of bySymbol) {
      const hasBuy = symbolResults.some((r) => r.decision.action === "buy");
      const hasSell = symbolResults.some((r) => r.decision.action === "sell");
      if (hasBuy && hasSell) {
        emitAgentDisagreementAlert({
          roundId,
          symbol,
          agents: symbolResults.map((r) => ({
            agentId: r.agentId,
            agentName: r.agentName,
            action: r.decision.action,
            confidence: r.decision.confidence,
          })),
        });
      }
    }
  } catch {
    // Non-critical
  }

  return {
    roundId,
    timestamp,
    results,
    errors,
    circuitBreakerActivations: allCircuitBreakerActivations,
    lockSkipped: false,
  };
}

/**
 * Get the current trading infrastructure status.
 * Returns status for lock, circuit breakers, and search cache.
 */
export function getTradingInfraStatus() {
  return {
    lock: getLockStatus(),
    circuitBreaker: getCircuitBreakerStatus(),
    searchCache: getSearchCacheMetrics(),
  };
}

// ---------------------------------------------------------------------------
// Agent Stats Queries
// ---------------------------------------------------------------------------

/**
 * Get aggregate stats for an AI agent from the agent_decisions table.
 */
export async function getAgentStats(agentId: string) {
  try {
    const decisions = await db
      .select()
      .from(agentDecisions)
      .where(eq(agentDecisions.agentId, agentId))
      .orderBy(desc(agentDecisions.createdAt));

    const totalDecisions = decisions.length;
    const buyDecisions = decisions.filter((d) => d.action === "buy");
    const sellDecisions = decisions.filter((d) => d.action === "sell");
    const holdDecisions = decisions.filter((d) => d.action === "hold");

    const avgConfidence =
      totalDecisions > 0
        ? decisions.reduce((sum, d) => sum + d.confidence, 0) / totalDecisions
        : 0;

    // Symbol frequency
    const symbolCounts: Record<string, number> = {};
    for (const d of decisions) {
      if (d.action !== "hold") {
        symbolCounts[d.symbol] = (symbolCounts[d.symbol] || 0) + 1;
      }
    }

    const favoriteStock =
      Object.entries(symbolCounts).sort(([, a], [, b]) => b - a)[0]?.[0] ??
      null;

    return {
      totalDecisions,
      buyCount: buyDecisions.length,
      sellCount: sellDecisions.length,
      holdCount: holdDecisions.length,
      averageConfidence: Math.round(avgConfidence * 10) / 10,
      favoriteStock,
      lastDecision: decisions[0] ?? null,
      recentDecisions: decisions.slice(0, 10),
    };
  } catch (error) {
    console.error(`[Orchestrator] Failed to get stats for ${agentId}:`, error);
    return {
      totalDecisions: 0,
      buyCount: 0,
      sellCount: 0,
      holdCount: 0,
      averageConfidence: 0,
      favoriteStock: null,
      lastDecision: null,
      recentDecisions: [],
    };
  }
}

/**
 * Get an agent's trade/decision history with pagination.
 */
export async function getAgentTradeHistory(
  agentId: string,
  limit = 20,
  offset = 0,
) {
  try {
    const decisions = await db
      .select()
      .from(agentDecisions)
      .where(eq(agentDecisions.agentId, agentId))
      .orderBy(desc(agentDecisions.createdAt))
      .limit(limit)
      .offset(offset);

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(agentDecisions)
      .where(eq(agentDecisions.agentId, agentId));

    return {
      decisions,
      total: Number(countResult[0]?.count ?? 0),
      limit,
      offset,
    };
  } catch (error) {
    console.error(
      `[Orchestrator] Failed to get trade history for ${agentId}:`,
      error,
    );
    return { decisions: [], total: 0, limit, offset };
  }
}

/**
 * Get the portfolio (current positions) for an AI agent.
 */
export async function getAgentPortfolio(agentId: string) {
  try {
    const marketData = await getMarketData();
    const portfolio = await getPortfolioContext(agentId, marketData);
    return portfolio;
  } catch (error) {
    console.error(
      `[Orchestrator] Failed to get portfolio for ${agentId}:`,
      error,
    );
    return {
      cashBalance: 0,
      positions: [],
      totalValue: 0,
      totalPnl: 0,
      totalPnlPercent: 0,
    };
  }
}

// ---------------------------------------------------------------------------
// Mock Data Generators (used when Jupiter API is unavailable)
// ---------------------------------------------------------------------------

/** Base mock prices by symbol */
const MOCK_BASE_PRICES: Record<string, number> = {
  AAPLx: 178.50,
  AMZNx: 185.20,
  GOOGLx: 142.80,
  METAx: 505.30,
  MSFTx: 415.60,
  NVDAx: 890.50,
  TSLAx: 245.80,
  SPYx: 502.10,
  QQQx: 435.70,
  COINx: 205.40,
  CRCLx: 32.15,
  MSTRx: 1685.00,
  AVGOx: 168.90,
  JPMx: 198.50,
  HOODx: 22.80,
  LLYx: 785.20,
  CRMx: 272.60,
  NFLXx: 628.90,
  PLTRx: 24.50,
  GMEx: 17.80,
};

function generateMockPrice(symbol: string): number {
  const base = MOCK_BASE_PRICES[symbol] ?? 100;
  // Add ±2% random variation
  const variation = 1 + (Math.random() - 0.5) * 0.04;
  return Math.round(base * variation * 100) / 100;
}

function generateMockChange(): number {
  // Random 24h change between -5% and +5%
  return Math.round((Math.random() - 0.5) * 10 * 100) / 100;
}

function generateMockVolume(): number {
  // Random volume between $10M and $500M
  return Math.round((10 + Math.random() * 490) * 1_000_000);
}
