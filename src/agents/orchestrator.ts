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
import {
  persistRound,
  cacheRound,
  type PersistedAgentResult,
} from "../services/dynamo-round-persister.ts";
import { enrichAgentContext } from "../services/agent-context-enricher.ts";
import { recordMarketReturn } from "../services/portfolio-risk-analyzer.ts";
import { runPreRoundGate } from "../services/pre-round-gate.ts";
import { trackLatency } from "../services/observability.ts";
import {
  analyzeCoherence,
  detectHallucinations,
  checkInstructionDiscipline,
} from "../services/coherence-analyzer.ts";
import {
  normalizeConfidence,
  extractSourcesFromReasoning,
  classifyIntent,
} from "../schemas/trade-reasoning.ts";
import { tradeJustifications } from "../db/schema/trade-reasoning.ts";
import { addBrainFeedEntry, buildBrainFeedEntry } from "../routes/brain-feed.ts";
import { checkReasoningQuality } from "../services/reasoning-quality-gate.ts";
import { trackOutcomes } from "../services/outcome-tracker.ts";
import {
  recordReasoningSnapshot,
  generateRoundDiffs,
} from "../services/reasoning-diff-engine.ts";
import { recordTradeForAttribution } from "../services/strategy-attribution.ts";
import { recordHallucinationAnalysis } from "../services/hallucination-tracker.ts";
import { recordReasoningEntry } from "../services/reasoning-profile.ts";
import { recordTimelineSnapshot } from "../services/reasoning-timeline.ts";
import { recordIntelligenceEntry } from "../services/agent-intelligence-report.ts";
import { recordForensicEntry } from "../services/reasoning-forensics.ts";
import { recordComparisonEntry } from "../routes/benchmark-comparison.ts";
import { recordRoundForIntegrity } from "../services/benchmark-integrity.ts";
import { recordQualityDataPoint } from "../services/adaptive-quality-gate.ts";
import { recordRoundResult as recordLeaderboardRoundResult } from "../services/leaderboard-evolution.ts";
import { conductRoundPeerReview } from "../services/peer-review.ts";
import { analyzeReasoningDepth } from "../services/reasoning-depth.ts";
import {
  detectMarketRegime,
  recordRegimeTradeEntry,
} from "../services/regime-reasoning.ts";
import { recordBenchmarkScore } from "../services/benchmark-reproducibility.ts";
import { emitBenchmarkEvent } from "../routes/benchmark-stream.ts";
import {
  analyzeDeepCoherence,
  recordDeepAnalysis,
} from "../services/deep-coherence-analyzer.ts";
import {
  recordRoundProvenance,
  recordScoringProvenance,
} from "../services/benchmark-provenance.ts";
import {
  auditScoring,
  auditQualityGate,
  auditHallucination,
  auditPeerReview,
} from "../services/benchmark-audit-trail.ts";
import {
  processRoundElo,
  updateStreak,
} from "../services/benchmark-composite-ranker.ts";
import {
  recordTradeForDNA,
} from "../services/strategy-dna-profiler.ts";
import {
  recordDriftSnapshot,
  buildDriftSnapshot,
} from "../services/reasoning-drift-detector.ts";
import {
  analyzeReasoningPatterns,
  recordReasoningForPatternAnalysis,
} from "../services/reasoning-pattern-detector.ts";
import {
  analyzeForensics,
  seedForensicHistory,
} from "../services/reasoning-forensic-engine.ts";
import {
  recordV11Metrics,
} from "../services/benchmark-v11-scorer.ts";
import {
  emitV11Event,
} from "../routes/benchmark-v11.tsx";
import {
  validateForBenchmark,
} from "../services/benchmark-validation-engine.ts";
import {
  classifyReasoning,
  recordTaxonomyClassification,
} from "../services/reasoning-taxonomy.ts";
import {
  recordConsistencyEntry,
} from "../services/cross-round-consistency.ts";
import {
  recordV12AgentMetrics,
  emitV12Event,
} from "../routes/benchmark-v12.tsx";
import {
  generateRoundBattles,
  type BattleParticipant,
} from "../services/battle-scoring-engine.ts";
import {
  compareAllReasoning,
} from "../services/reasoning-battle-engine.ts";
import {
  emitV13Event,
} from "../routes/benchmark-v13.tsx";

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

  // Step -1: Run pre-round health gate
  try {
    const gateResult = await runPreRoundGate();
    if (!gateResult.proceed) {
      console.warn(
        `[Orchestrator] Round ${roundId} BLOCKED by pre-round gate: ${gateResult.blockReason}`,
      );
      return {
        roundId,
        timestamp,
        results: [],
        errors: [`Pre-round gate blocked: ${gateResult.blockReason}`],
        circuitBreakerActivations: [],
        lockSkipped: false,
      };
    }
    console.log(
      `[Orchestrator] Pre-round gate PASSED (${gateResult.mode}): ${gateResult.summary.passed}/${gateResult.summary.total} checks OK in ${gateResult.durationMs}ms`,
    );
  } catch (err) {
    // Gate check failure is non-fatal — log and continue
    console.warn(
      `[Orchestrator] Pre-round gate check error (continuing): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

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

      // Enrich context with technical indicators, memory, peer actions, risk
      let enrichedMarketData = marketData;
      try {
        const enrichedContext = await enrichAgentContext(agent.agentId, marketData, portfolio);
        // Inject enriched context into market data news field for the agent
        if (enrichedContext.fullPromptSection) {
          enrichedMarketData = marketData.map((md) => ({
            ...md,
            news: [...(md.news ?? []), enrichedContext.fullPromptSection],
          }));
          // Only inject into the first stock to avoid duplication
          enrichedMarketData = [
            { ...enrichedMarketData[0], news: [...(marketData[0]?.news ?? []), enrichedContext.fullPromptSection] },
            ...marketData.slice(1),
          ];
        }
      } catch (err) {
        console.warn(
          `[Orchestrator] Context enrichment failed for ${agent.agentId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      // Get agent's trading decision (with enriched context)
      let decision = await agent.analyze(enrichedMarketData, portfolio);
      console.log(
        `[Orchestrator] ${agent.name} decided: ${decision.action} ${decision.symbol} (confidence: ${decision.confidence}%)`,
      );

      // --- QUALITY GATE: Validate reasoning before execution ---
      try {
        const qualityResult = checkReasoningQuality(decision, marketData);
        if (!qualityResult.passed) {
          console.log(
            `[Orchestrator] ${agent.name} QUALITY GATE REJECTED: composite=${qualityResult.scores.composite.toFixed(2)}, ` +
            `reasons: ${qualityResult.rejectionReasons.join("; ")}`,
          );
          decision = qualityResult.decision;
        } else {
          console.log(
            `[Orchestrator] ${agent.name} quality gate PASSED: composite=${qualityResult.scores.composite.toFixed(2)}`,
          );
        }
      } catch (err) {
        console.warn(
          `[Orchestrator] Quality gate check failed for ${agent.agentId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      // --- BENCHMARK: Coherence Analysis & Justification Recording ---
      try {
        const coherence = analyzeCoherence(
          decision.reasoning,
          decision.action,
          marketData,
        );
        const hallucinations = detectHallucinations(decision.reasoning, marketData);
        const discipline = checkInstructionDiscipline(
          {
            action: decision.action,
            symbol: decision.symbol,
            quantity: decision.quantity,
            confidence: normalizeConfidence(decision.confidence),
          },
          {
            maxPositionSize: agent.config.maxPositionSize,
            maxPortfolioAllocation: agent.config.maxPortfolioAllocation,
            riskTolerance: agent.config.riskTolerance,
          },
          {
            cashBalance: portfolio.cashBalance,
            totalValue: portfolio.totalValue,
            positions: portfolio.positions.map((p) => ({
              symbol: p.symbol,
              quantity: p.quantity,
              currentPrice: p.currentPrice,
            })),
          },
        );

        // Extract or use agent-provided sources/intent
        const sources = decision.sources ?? extractSourcesFromReasoning(decision.reasoning);
        const intent = decision.intent ?? classifyIntent(decision.reasoning, decision.action);

        console.log(
          `[Orchestrator] ${agent.name} benchmark: coherence=${coherence.score.toFixed(2)}, ` +
          `hallucinations=${hallucinations.flags.length}, discipline=${discipline.passed ? "PASS" : "FAIL"}`,
        );

        // Record justification to DB
        const justificationId = `tj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        await db.insert(tradeJustifications).values({
          id: justificationId,
          agentId: agent.agentId,
          reasoning: decision.reasoning,
          confidence: normalizeConfidence(decision.confidence),
          sources,
          intent,
          predictedOutcome: decision.predictedOutcome ?? null,
          coherenceScore: coherence.score,
          hallucinationFlags: hallucinations.flags,
          action: decision.action,
          symbol: decision.symbol,
          quantity: decision.quantity,
          roundId,
          disciplinePass: discipline.passed ? "pass" : "fail",
        }).catch((err) => {
          console.warn(
            `[Orchestrator] Justification insert failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });

        // Add to brain feed cache
        const feedEntry = buildBrainFeedEntry(
          {
            agentId: agent.agentId,
            action: decision.action,
            symbol: decision.symbol,
            quantity: decision.quantity,
            reasoning: decision.reasoning,
            confidence: decision.confidence,
            roundId,
          },
          coherence,
          hallucinations,
        );
        addBrainFeedEntry(feedEntry);

        // --- NEW: Feed reasoning diff engine, attribution, hallucination tracker, profile ---
        const normalizedConf = normalizeConfidence(decision.confidence);

        recordReasoningSnapshot({
          agentId: agent.agentId,
          action: decision.action,
          symbol: decision.symbol,
          quantity: decision.quantity,
          reasoning: decision.reasoning,
          confidence: normalizedConf,
          intent,
          sources,
          coherenceScore: coherence.score,
          hallucinationCount: hallucinations.flags.length,
          roundId,
          timestamp: new Date().toISOString(),
        });

        recordHallucinationAnalysis(
          agent.agentId,
          decision.symbol,
          roundId,
          hallucinations.flags,
          hallucinations.severity,
          normalizedConf,
          decision.action,
        );

        recordReasoningEntry({
          agentId: agent.agentId,
          reasoning: decision.reasoning,
          action: decision.action,
          symbol: decision.symbol,
          confidence: normalizedConf,
          intent,
          coherenceScore: coherence.score,
          timestamp: new Date().toISOString(),
        });

        // Feed timeline analyzer and intelligence report generator
        const sentimentScore = coherence.signals.reduce((s, sig) => {
          if (sig.type === "bullish") return s + sig.weight * 0.1;
          if (sig.type === "bearish") return s - sig.weight * 0.1;
          return s;
        }, 0);

        recordTimelineSnapshot({
          agentId: agent.agentId,
          roundId,
          action: decision.action,
          symbol: decision.symbol,
          reasoning: decision.reasoning,
          confidence: normalizedConf,
          intent,
          coherenceScore: coherence.score,
          hallucinationCount: hallucinations.flags.length,
          wordCount: decision.reasoning.split(/\s+/).length,
          sentimentScore: Math.max(-1, Math.min(1, sentimentScore)),
          timestamp: new Date().toISOString(),
        });

        recordIntelligenceEntry({
          agentId: agent.agentId,
          action: decision.action,
          symbol: decision.symbol,
          reasoning: decision.reasoning,
          confidence: normalizedConf,
          intent,
          coherenceScore: coherence.score,
          hallucinationCount: hallucinations.flags.length,
          disciplinePass: discipline.passed,
          timestamp: new Date().toISOString(),
        });

        // Feed reasoning forensics
        recordForensicEntry({
          agentId: agent.agentId,
          reasoning: decision.reasoning,
          action: decision.action as "buy" | "sell" | "hold",
          intent,
          confidence: normalizedConf,
          coherenceScore: coherence.score,
          hallucinationFlags: hallucinations.flags,
          disciplineViolations: discipline.passed ? [] : discipline.violations,
          timestamp: new Date().toISOString(),
        });

        // Feed benchmark comparison engine
        recordComparisonEntry({
          roundId,
          agentId: agent.agentId,
          pnl: portfolio.totalPnlPercent,
          coherence: coherence.score,
          hallucinationCount: hallucinations.flags.length,
          timestamp: Date.now(),
        });

        // Feed adaptive quality gate history
        recordQualityDataPoint(
          agent.agentId,
          coherence.score,
          hallucinations.severity,
          discipline.passed,
        );

        // --- Feed provenance, audit, DNA, and drift services ---
        try {
          // Audit trail: record scoring event
          auditScoring(
            agent.agentId,
            { composite: coherence.score, coherence: coherence.score, hallucinationRate: hallucinations.severity },
            coherence.score >= 0.8 ? "A" : coherence.score >= 0.6 ? "B" : "C",
            roundId,
          );

          // Audit trail: hallucination flags
          if (hallucinations.flags.length > 0) {
            auditHallucination(agent.agentId, decision.symbol, hallucinations.flags, roundId);
          }

          // Audit trail: quality gate
          auditQualityGate(agent.agentId, discipline.passed, coherence.score, 0.3);

          // Strategy DNA profiler
          recordTradeForDNA({
            agentId: agent.agentId,
            action: decision.action,
            symbol: decision.symbol,
            quantity: decision.quantity,
            confidence: normalizedConf,
            reasoning: decision.reasoning,
            intent,
            coherenceScore: coherence.score,
            timestamp: new Date().toISOString(),
          });

          // Reasoning drift detector
          const driftSnap = buildDriftSnapshot({
            agentId: agent.agentId,
            roundId,
            reasoning: decision.reasoning,
            coherenceScore: coherence.score,
            hallucinationCount: hallucinations.flags.length,
            confidence: normalizedConf,
            intent,
            action: decision.action,
          });
          recordDriftSnapshot(driftSnap);

          // Provenance chain: scoring event
          recordScoringProvenance(agent.agentId, {
            composite: coherence.score,
            coherence: coherence.score,
            hallucinationRate: hallucinations.severity,
            discipline: discipline.passed ? 1 : 0,
            pnl: portfolio.totalPnlPercent,
            sharpe: 0,
          });
        } catch (err) {
          console.warn(
            `[Orchestrator] Governance service recording failed for ${agent.agentId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }

        // --- NEW: Reasoning depth analysis ---
        try {
          const depthScore = analyzeReasoningDepth(
            decision.reasoning,
            decision.action,
            agent.agentId,
            decision.symbol,
            roundId,
          );
          console.log(
            `[Orchestrator] ${agent.name} depth: ${depthScore.overall.toFixed(2)} (${depthScore.classification}), ` +
            `angles=${depthScore.angleCount}`,
          );

          // Feed benchmark reproducibility engine
          recordBenchmarkScore(agent.agentId, roundId, {
            coherence: coherence.score,
            depth: depthScore.overall,
            hallucinationRate: hallucinations.severity,
            discipline: discipline.passed ? 1 : 0,
            confidence: normalizedConf,
          });

          // Emit SSE benchmark events
          emitBenchmarkEvent("trade_reasoning", {
            action: decision.action,
            symbol: decision.symbol,
            confidence: normalizedConf,
            intent,
            reasoningPreview: decision.reasoning.slice(0, 200),
          }, agent.agentId);

          emitBenchmarkEvent("coherence_scored", {
            score: coherence.score,
            explanation: coherence.explanation,
            signalCount: coherence.signals.length,
          }, agent.agentId);

          emitBenchmarkEvent("depth_analyzed", {
            overall: depthScore.overall,
            classification: depthScore.classification,
            angleCount: depthScore.angleCount,
          }, agent.agentId);

          if (hallucinations.flags.length > 0) {
            emitBenchmarkEvent("hallucination_flagged", {
              flags: hallucinations.flags,
              severity: hallucinations.severity,
              symbol: decision.symbol,
            }, agent.agentId);
          }

          // --- Deep coherence analysis (structural reasoning quality) ---
          try {
            const deepResult = analyzeDeepCoherence(
              decision.reasoning,
              decision.action,
              decision.symbol,
              normalizedConf,
              marketData,
            );
            recordDeepAnalysis(agent.agentId, deepResult);
            console.log(
              `[Orchestrator] ${agent.name} deep coherence: ${deepResult.overallScore.toFixed(2)} (${deepResult.grade}), ` +
              `strengths=${deepResult.strengths.length}, weaknesses=${deepResult.weaknesses.length}`,
            );

            emitBenchmarkEvent("deep_coherence", {
              overallScore: deepResult.overallScore,
              grade: deepResult.grade,
              strengthCount: deepResult.strengths.length,
              weaknessCount: deepResult.weaknesses.length,
              wordCount: deepResult.textMetrics.wordCount,
            }, agent.agentId);
          } catch (err) {
            console.warn(
              `[Orchestrator] Deep coherence failed for ${agent.agentId}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }

          // --- v10: Reasoning pattern analysis (fallacies, depth, vocabulary) ---
          let patternResult: { qualityScore: number; fallacies: { type: string }[]; depth: { classification: string }; vocabulary: { sophisticationScore: number }; hedgeRatio: number; templateProbability: number } | null = null;
          try {
            patternResult = analyzeReasoningPatterns(agent.agentId, decision.reasoning);
            recordReasoningForPatternAnalysis(agent.agentId, decision.reasoning, patternResult.qualityScore);
            console.log(
              `[Orchestrator] ${agent.name} patterns: quality=${patternResult.qualityScore.toFixed(2)}, ` +
              `fallacies=${patternResult.fallacies.length}, depth=${patternResult.depth.classification}, ` +
              `vocab=${patternResult.vocabulary.sophisticationScore.toFixed(2)}`,
            );

            emitBenchmarkEvent("pattern_analyzed", {
              qualityScore: patternResult.qualityScore,
              fallacyCount: patternResult.fallacies.length,
              fallacies: patternResult.fallacies.map((f) => f.type),
              depthClassification: patternResult.depth.classification,
              vocabularySophistication: patternResult.vocabulary.sophisticationScore,
              hedgeRatio: patternResult.hedgeRatio,
              templateProbability: patternResult.templateProbability,
            }, agent.agentId);
          } catch (err) {
            console.warn(
              `[Orchestrator] Pattern analysis failed for ${agent.agentId}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }

          // --- v11: Forensic reasoning analysis ---
          try {
            const forensicReport = analyzeForensics(
              agent.agentId,
              roundId,
              decision.reasoning,
              decision.action,
              decision.symbol,
              normalizedConf,
            );

            // Seed forensic history for cross-trade analysis
            seedForensicHistory(
              agent.agentId,
              decision.reasoning,
              decision.action,
              decision.symbol,
              normalizedConf,
            );

            // Record into v11 scoring engine
            recordV11Metrics(agent.agentId, {
              coherence: coherence.score,
              depth: forensicReport.depth.depthScore,
              hallucinationFree: 1 - hallucinations.severity,
              discipline: discipline.passed ? 1 : 0,
              confidence: normalizedConf,
              forensicStructure: forensicReport.structural.structureScore,
              forensicOriginality: forensicReport.originality.originalityScore,
              forensicClarity: forensicReport.clarity.clarityScore,
              forensicIntegrity: forensicReport.crossTrade.flags.length === 0 ? 1 : Math.max(0, 1 - forensicReport.crossTrade.flags.length * 0.2),
              patternQuality: patternResult?.qualityScore ?? 0.5,
            });

            console.log(
              `[Orchestrator] ${agent.name} forensic: composite=${forensicReport.compositeScore.toFixed(2)} (${forensicReport.grade}), ` +
              `depth=${forensicReport.depth.classification}, originality=${forensicReport.originality.originalityScore.toFixed(2)}, ` +
              `clarity=${forensicReport.clarity.clarityScore.toFixed(2)}, integrity-flags=${forensicReport.crossTrade.flags.length}`,
            );

            emitV11Event("forensic_analyzed", {
              compositeScore: forensicReport.compositeScore,
              grade: forensicReport.grade,
              depthClassification: forensicReport.depth.classification,
              dimensionsCovered: forensicReport.depth.dimensionCount,
              originalityScore: forensicReport.originality.originalityScore,
              templateProbability: forensicReport.originality.templateProbability,
              clarityScore: forensicReport.clarity.clarityScore,
              integrityFlags: forensicReport.crossTrade.flags,
              structureScore: forensicReport.structural.structureScore,
              quantitativeClaims: forensicReport.structural.quantitativeClaimCount,
              causalConnectors: forensicReport.structural.causalConnectorCount,
            }, agent.agentId);

            emitBenchmarkEvent("v11_forensic", {
              compositeScore: forensicReport.compositeScore,
              grade: forensicReport.grade,
              depthClassification: forensicReport.depth.classification,
              originalityScore: forensicReport.originality.originalityScore,
            }, agent.agentId);
          } catch (err) {
            console.warn(
              `[Orchestrator] v11 forensic analysis failed for ${agent.agentId}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        } catch (err) {
          console.warn(
            `[Orchestrator] Depth/stream analysis failed for ${agent.agentId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      } catch (err) {
        console.warn(
          `[Orchestrator] Benchmark analysis failed for ${agent.agentId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      // --- v12: Validation Engine, Reasoning Taxonomy, Cross-Round Consistency ---
      try {
        const normalizedConf12 = decision.confidence > 1 ? decision.confidence / 100 : decision.confidence;

        // 1. Validate trade against benchmark quality dimensions
        const validationResult = validateForBenchmark(
          decision,
          agent.agentId,
          marketData,
          {
            maxPositionSize: agent.config.maxPositionSize,
            maxPortfolioAllocation: agent.config.maxPortfolioAllocation,
            riskTolerance: agent.config.riskTolerance,
          },
        );

        console.log(
          `[Orchestrator] ${agent.name} v12 validation: quality=${validationResult.qualityScore.toFixed(3)} (${validationResult.grade}), ` +
          `valid=${validationResult.valid}, issues=${validationResult.issues.length}`,
        );

        emitV12Event("trade_validated", {
          qualityScore: validationResult.qualityScore,
          grade: validationResult.grade,
          valid: validationResult.valid,
          issueCount: validationResult.issues.length,
          dimensions: validationResult.dimensions.map((d) => ({
            name: d.name,
            score: d.score,
            passed: d.passed,
          })),
        }, agent.agentId);

        // 2. Classify reasoning into taxonomy
        const taxonomy = classifyReasoning(decision.reasoning, decision.action);
        recordTaxonomyClassification(agent.agentId, taxonomy);

        console.log(
          `[Orchestrator] ${agent.name} taxonomy: ${taxonomy.fingerprint}, ` +
          `strategy=${taxonomy.strategy}, sophistication=${taxonomy.sophisticationLevel}/5, ` +
          `biases=${taxonomy.cognitivePatterns.length}`,
        );

        emitV12Event("taxonomy_classified", {
          fingerprint: taxonomy.fingerprint,
          strategy: taxonomy.strategy,
          analyticalMethod: taxonomy.analyticalMethod,
          reasoningStructure: taxonomy.reasoningStructure,
          sophisticationLevel: taxonomy.sophisticationLevel,
          cognitivePatterns: taxonomy.cognitivePatterns.map((p) => p.type),
          themes: taxonomy.themes,
          classificationConfidence: taxonomy.classificationConfidence,
        }, agent.agentId);

        // 3. Record for cross-round consistency tracking
        const intent12 = decision.intent ?? "value";
        recordConsistencyEntry({
          agentId: agent.agentId,
          roundId,
          symbol: decision.symbol,
          action: decision.action,
          confidence: normalizedConf12,
          reasoning: decision.reasoning,
          intent: intent12,
          coherenceScore: validationResult.dimensions.find((d) => d.name === "action_reasoning_alignment")?.score ?? 0.5,
          timestamp: new Date().toISOString(),
        });

        // 4. Update composite v12 metrics for dashboard
        recordV12AgentMetrics(agent.agentId, {
          financial: 0.5, // Will be updated by financial tracker
          reasoning: validationResult.dimensions.find((d) => d.name === "reasoning_depth")?.score ?? 0.5,
          safety: validationResult.dimensions.find((d) => d.name === "price_grounding")?.score ?? 0.5,
          calibration: validationResult.dimensions.find((d) => d.name === "confidence_calibration")?.score ?? 0.5,
          patterns: taxonomy.sophisticationLevel / 5,
          adaptability: 0.5,
          forensicQuality: validationResult.dimensions.find((d) => d.name === "source_verification")?.score ?? 0.5,
          validationQuality: validationResult.qualityScore,
          composite: validationResult.qualityScore * 0.6 + (taxonomy.sophisticationLevel / 5) * 0.2 + 0.5 * 0.2,
          grade: validationResult.grade,
          dominantStrategy: taxonomy.strategy,
          sophistication: taxonomy.sophisticationLevel,
          biasCount: taxonomy.cognitivePatterns.length,
          consistencyScore: 0.5, // Updated by consistency tracker
          qualityTrend: "stable",
          anomalyCount: 0,
          tradeCount: 1,
          lastUpdated: new Date().toISOString(),
        });

      } catch (err) {
        console.warn(
          `[Orchestrator] v12 analysis failed for ${agent.agentId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

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

  // Track round duration for observability
  const roundDurationMs = Date.now() - new Date(timestamp).getTime();
  trackLatency(roundDurationMs);

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

  // Persist round to DynamoDB and in-memory cache
  const roundDuration = Date.now() - new Date(timestamp).getTime();
  try {
    // Build a PersistedRound for the in-memory cache
    const cachedRound = {
      roundId,
      timestamp,
      durationMs: roundDuration,
      tradingMode: getTradingMode(),
      results: results.map((r): PersistedAgentResult => ({
        agentId: r.agentId,
        agentName: r.agentName,
        action: r.decision.action,
        symbol: r.decision.symbol,
        quantity: r.decision.quantity,
        reasoning: r.decision.reasoning,
        confidence: r.decision.confidence,
        executed: r.executed,
        executionError: r.executionError,
        txSignature: r.executionDetails?.txSignature,
        filledPrice: r.executionDetails?.filledPrice,
        usdcAmount: r.executionDetails?.usdcAmount,
      })),
      errors,
      circuitBreakerActivations: allCircuitBreakerActivations.length,
      lockSkipped: false,
      consensus: computeRoundConsensus(results),
      summary: buildRoundSummaryText(results, errors),
      ttl: Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60,
    };

    // Always cache in memory (fast)
    cacheRound(cachedRound);

    // Persist to DynamoDB (async, non-blocking)
    persistRound({
      roundId,
      timestamp,
      durationMs: roundDuration,
      tradingMode: getTradingMode(),
      results,
      errors,
      circuitBreakerActivations: allCircuitBreakerActivations,
      lockSkipped: false,
    }).catch((err) =>
      console.warn(`[Orchestrator] DynamoDB persist failed: ${err instanceof Error ? err.message : String(err)}`),
    );
  } catch (err) {
    console.warn(`[Orchestrator] Round caching failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Track SPYx return for risk analysis beta calculation
  try {
    const spyData = marketData.find((m) => m.symbol === "SPYx");
    if (spyData?.change24h !== null && spyData?.change24h !== undefined) {
      recordMarketReturn(spyData.change24h);
    }
  } catch {
    // Non-critical
  }

  // Track outcomes for previous trades (async, non-blocking)
  trackOutcomes(marketData).catch((err) =>
    console.warn(`[Orchestrator] Outcome tracking failed: ${err instanceof Error ? err.message : String(err)}`),
  );

  // Generate reasoning diffs for this round (compare how agents reasoned differently)
  try {
    const diffReport = generateRoundDiffs(roundId);
    if (diffReport) {
      console.log(
        `[Orchestrator] Round diffs: ${diffReport.diffs.length} comparisons, ` +
        `avgDivergence=${diffReport.stats.avgDivergence}, ` +
        `conflicts=${diffReport.stats.actionConflictRate}`,
      );
    }
  } catch (err) {
    console.warn(`[Orchestrator] Reasoning diffs failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Record round integrity proof (Merkle hash of all justifications)
  try {
    const roundJustifications = results.map((r) => ({
      agentId: r.agentId,
      action: r.decision.action,
      symbol: r.decision.symbol,
      reasoning: r.decision.reasoning,
      confidence: r.decision.confidence,
      timestamp: r.decision.timestamp ?? timestamp,
    }));
    recordRoundForIntegrity(roundId, roundJustifications);
  } catch (err) {
    console.warn(`[Orchestrator] Integrity proof failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Feed leaderboard evolution with round results
  try {
    const leaderboardResults = results.map((r) => ({
      agentId: r.agentId,
      agentName: r.agentName,
      compositeScore: r.decision.confidence / 100,
      pnl: 0,
      coherence: 0,
      hallucinationRate: 0,
    }));
    recordLeaderboardRoundResult(roundId, leaderboardResults);
  } catch (err) {
    console.warn(`[Orchestrator] Leaderboard evolution failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // --- NEW: Market regime detection + regime-tagged scoring ---
  try {
    const regimeSnapshot = detectMarketRegime(
      marketData.map((d) => ({
        symbol: d.symbol,
        price: d.price,
        change24h: d.change24h,
      })),
    );
    console.log(
      `[Orchestrator] Market regime: ${regimeSnapshot.regime} (avg: ${regimeSnapshot.avgChange}%, vol: ${regimeSnapshot.changeStdDev.toFixed(2)})`,
    );

    emitBenchmarkEvent("regime_detected", {
      regime: regimeSnapshot.regime,
      avgChange: regimeSnapshot.avgChange,
      volatility: regimeSnapshot.changeStdDev,
      stocksUp: regimeSnapshot.stocksUp,
      stocksDown: regimeSnapshot.stocksDown,
    });

    // Tag each agent's trade with the current regime
    for (const r of results) {
      recordRegimeTradeEntry(
        r.agentId,
        regimeSnapshot.regime,
        0.5, // coherence will be filled from justification
        0.5, // depth will be filled from depth analyzer
        false,
        r.decision.confidence > 1 ? r.decision.confidence / 100 : r.decision.confidence,
        r.decision.action,
        roundId,
      );
    }
  } catch (err) {
    console.warn(`[Orchestrator] Regime detection failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // --- NEW: Peer review — agents critique each other's reasoning ---
  try {
    const roundDecisions = results.map((r) => ({
      agentId: r.agentId,
      reasoning: r.decision.reasoning,
      action: r.decision.action,
      symbol: r.decision.symbol,
      confidence: r.decision.confidence > 1 ? r.decision.confidence / 100 : r.decision.confidence,
    }));

    const peerReport = conductRoundPeerReview(roundDecisions, roundId);
    console.log(
      `[Orchestrator] Peer review: ${peerReport.reviews.length} reviews, ` +
      `disagreement=${(peerReport.disagreementRate * 100).toFixed(0)}%, ` +
      `best=${peerReport.bestReviewed?.agentId ?? "none"} (${peerReport.bestReviewed?.avgScore?.toFixed(2) ?? 0})`,
    );

    emitBenchmarkEvent("peer_review", {
      reviewCount: peerReport.reviews.length,
      disagreementRate: peerReport.disagreementRate,
      bestReviewed: peerReport.bestReviewed,
      mostControversial: peerReport.mostControversial,
    });
  } catch (err) {
    console.warn(`[Orchestrator] Peer review failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Emit round completed event
  emitBenchmarkEvent("round_completed", {
    roundId,
    agentCount: results.length,
    errorCount: errors.length,
    tradingMode: getTradingMode(),
  });

  // --- v13: Head-to-Head Agent Battles ---
  try {
    // Build battle participants from round results
    const battleParticipants: BattleParticipant[] = results.map((r) => {
      const normConf = r.decision.confidence > 1 ? r.decision.confidence / 100 : r.decision.confidence;
      return {
        agentId: r.agentId,
        action: r.decision.action,
        symbol: r.decision.symbol,
        quantity: r.decision.quantity,
        reasoning: r.decision.reasoning,
        confidence: normConf,
        intent: r.decision.intent ?? "value",
        coherenceScore: normConf * 0.8 + 0.1, // Will be enriched from justification
        hallucinationCount: 0, // Will be enriched
        disciplinePass: true, // Will be enriched
        pnlPercent: 0, // Will be enriched by financial tracker
        depthScore: Math.min(1, r.decision.reasoning.split(/\s+/).length / 100),
        originalityScore: 0.5, // Will be enriched
      };
    });

    const battles = generateRoundBattles(roundId, battleParticipants);

    console.log(
      `[Orchestrator] v13 battles: ${battles.length} matchups, ` +
      `winners=${battles.filter((b) => b.overallWinner).map((b) => b.overallWinner).join(",")}`,
    );

    for (const battle of battles) {
      emitV13Event("battle_completed", {
        battleId: battle.battleId,
        agentA: battle.agentA.agentId,
        agentB: battle.agentB.agentId,
        winner: battle.overallWinner,
        margin: battle.marginOfVictory,
        compositeA: battle.compositeScoreA,
        compositeB: battle.compositeScoreB,
        highlight: battle.highlight,
        narrativePreview: battle.narrative.slice(0, 200),
      }, battle.overallWinner ?? undefined);
    }

    // Reasoning quality comparisons
    const reasoningComparisons = compareAllReasoning(
      results.map((r) => ({
        agentId: r.agentId,
        reasoning: r.decision.reasoning,
      })),
    );

    for (const comp of reasoningComparisons) {
      emitV13Event("reasoning_compared", {
        agentA: comp.agentAId,
        agentB: comp.agentBId,
        winner: comp.winner,
        scoreA: comp.agentAScore,
        scoreB: comp.agentBScore,
        summary: comp.summary.slice(0, 200),
      });
    }

    emitBenchmarkEvent("v13_battles", {
      roundId,
      battleCount: battles.length,
      comparisonCount: reasoningComparisons.length,
      highlights: battles.filter((b) => b.highlight).length,
    });
  } catch (err) {
    console.warn(`[Orchestrator] v13 battle generation failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // --- Round-level provenance, Elo, and audit trail ---
  try {
    // Record round in provenance chain
    recordRoundProvenance(roundId, {
      agentCount: results.length,
      tradeCount: results.filter((r) => r.decision.action !== "hold").length,
      avgCoherence: 0.5, // Will be enriched by scoring engine
      hallucinationCount: 0,
      tradingMode: getTradingMode(),
    });

    // Process Elo updates from pairwise comparisons
    const eloResults = results.map((r) => ({
      agentId: r.agentId,
      compositeScore: r.decision.confidence > 1 ? r.decision.confidence / 100 : r.decision.confidence,
    }));
    processRoundElo(eloResults);

    // Update streaks
    for (const r of results) {
      updateStreak(r.agentId, r.executed && r.decision.action !== "hold" ? null : null);
    }

    // Audit peer review
    auditPeerReview(roundId, results.length, results[0]?.agentId ?? null, 0);
  } catch (err) {
    console.warn(`[Orchestrator] Governance round finalization failed: ${err instanceof Error ? err.message : String(err)}`);
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
 * Compute consensus type from round results.
 */
function computeRoundConsensus(results: TradingRoundResult[]): "unanimous" | "majority" | "split" | "no_trades" {
  const nonHold = results.filter((r) => r.decision.action !== "hold");
  if (nonHold.length === 0) return "no_trades";
  const actions = nonHold.map((r) => r.decision.action);
  const buys = actions.filter((a) => a === "buy").length;
  const sells = actions.filter((a) => a === "sell").length;
  if (buys === nonHold.length || sells === nonHold.length) return "unanimous";
  if (buys > sells && buys > 1) return "majority";
  if (sells > buys && sells > 1) return "majority";
  return "split";
}

/**
 * Build human-readable round summary.
 */
function buildRoundSummaryText(results: TradingRoundResult[], errors: string[]): string {
  const parts: string[] = [];
  for (const r of results) {
    const status = r.executed ? "OK" : "FAIL";
    parts.push(`${r.agentName}: ${r.decision.action.toUpperCase()} ${r.decision.symbol} (${r.decision.confidence}%) ${status}`);
  }
  if (errors.length > 0) parts.push(`${errors.length} error(s)`);
  return parts.join(" | ");
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
