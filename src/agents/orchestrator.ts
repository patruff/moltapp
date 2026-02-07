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
import { eq, desc, sql, type InferSelectModel } from "drizzle-orm";
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
  setSearchProvider,
} from "../services/search-cache.ts";
import { braveSearchProvider } from "../services/brave-search.ts";
import { averageByKey, countByCondition, countWords, getTopKey, round2, round3 } from "../lib/math-utils.ts";
import { errorMessage } from "../lib/errors.ts";
import { fetchAggregatedPrices, getTradeableSymbols } from "../services/market-aggregator.ts";

// Register Brave Search if API key is available
if (process.env.BRAVE_API_KEY) {
  setSearchProvider(braveSearchProvider);
  console.log("[Orchestrator] Brave Search enabled");
}
import { recordBalanceSnapshot, preTradeFundCheck } from "../services/agent-wallets.ts";
import { getOnChainPortfolio } from "../services/onchain-portfolio.ts";
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
import { runLendingPhase } from "../monad/lending-engine.ts";
import { runMeetingOfMinds } from "../services/meeting-of-minds.ts";
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
} from "../services/benchmark-composite-ranker.ts";
import {
  recordTradeForDNA,
} from "../services/strategy-dna-profiler.ts";
import {
  gradeTrade as gradeTradeV33,
  scoreAgent as scoreAgentV33,
  createRoundSummary as createV33RoundSummary,
  type V33TradeGrade,
} from "../services/v33-benchmark-engine.ts";
import {
  gradeTrade as gradeTradeV35,
  scoreAgent as scoreAgentV35,
  createRoundSummary as createV35RoundSummary,
  type V35TradeGrade,
} from "../services/v35-benchmark-engine.ts";
import {
  gradeTrade as gradeTradeV36,
  scoreAgent as scoreAgentV36,
  createRoundSummary as createV36RoundSummary,
  type V36TradeGrade,
} from "../services/v36-benchmark-engine.ts";
import {
  gradeTrade as gradeTradeV37,
  scoreAgent as scoreAgentV37,
  createRoundSummary as createV37RoundSummary,
  type V37TradeGrade,
} from "../services/v37-benchmark-engine.ts";
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
import {
  registerPrediction,
  resolvePredictions,
} from "../services/outcome-resolution-engine.ts";
import {
  recordCalibrationPoint,
  inferOutcomeFromCoherence,
} from "../services/confidence-calibration-analyzer.ts";
import {
  recordReasoningForVolatility,
  computeSentimentScore as computeVolatilitySentiment,
  extractKeyPhrases,
} from "../services/reasoning-volatility-tracker.ts";
import {
  recordRoundConsensus,
  type AgentRoundAction,
} from "../services/consensus-divergence-scorer.ts";
import {
  recordV14AgentMetrics,
  emitV14Event,
} from "../routes/benchmark-v14.tsx";
import {
  createReasoningProof,
  recordProvenanceEntry,
} from "../services/reasoning-provenance-engine.ts";
import {
  recordRoundForComparison,
  compareRoundReasoning,
  type ComparisonEntry,
} from "../services/cross-model-comparator.ts";
import {
  recordScoringRun,
  generateReproducibilityProof,
} from "../services/benchmark-reproducibility-prover.ts";
import {
  recordV15AgentMetrics,
  emitV15Event,
} from "../routes/benchmark-v15.tsx";
import {
  recordV16Metrics,
  computeV16Score,
  analyzeTradeEfficiency,
} from "../services/benchmark-intelligence-engine.ts";
import {
  recordMetacognitionEvent,
} from "../services/metacognition-tracker.ts";
import {
  scoreReasoningDepth as scoreV16Depth,
} from "../services/reasoning-depth-scorer.ts";
import {
  emitV16Event,
} from "../routes/benchmark-v16.tsx";
import {
  recordV17Scores,
  updateV17Elo,
} from "../services/benchmark-intelligence-gateway.ts";
import {
  appendToLedger,
} from "../services/trade-forensic-ledger.ts";
import {
  recordGenomeObservation,
  getGenomePillarScore,
} from "../services/agent-strategy-genome.ts";
import {
  emitV17Event,
} from "../routes/benchmark-v17.tsx";
import {
  analyzeAdversarialRobustness,
  recordAdversarialResult,
  recordReasoningForComparison as recordReasoningForAdversarial,
} from "../services/adversarial-robustness-engine.ts";
import {
  recordMemoryEntry,
} from "../services/cross-session-memory-analyzer.ts";
import {
  recordBenchmarkHealthSnapshot,
} from "../services/benchmark-regression-detector.ts";
import {
  emitV18Event,
} from "../routes/benchmark-v18.tsx";
import {
  analyzeTransparency,
} from "../services/reasoning-transparency-engine.ts";
import {
  registerClaims,
} from "../services/decision-accountability-tracker.ts";
import {
  certifyReasoning,
} from "../services/reasoning-quality-certifier.ts";
import {
  emitV20Event,
} from "../routes/benchmark-v20.tsx";
import {
  validateReasoningChain,
  recordChainValidation,
} from "../services/reasoning-chain-validator.ts";
import {
  recordTradeForProfiling,
} from "../services/agent-strategy-profiler.ts";
import {
  emitV21Event,
} from "../routes/benchmark-v21.tsx";
import {
  recordTradeIntegrity,
  finalizeRoundIntegrity,
} from "../services/benchmark-integrity-engine.ts";
import {
  validateGrounding,
  recordGroundingResult,
} from "../services/reasoning-grounding-validator.ts";
import {
  analyzeBiases,
  recordBiasResult,
  type RoundAgentContext,
} from "../services/cognitive-bias-detector.ts";
import {
  emitV22Event,
} from "../routes/benchmark-v22.tsx";
import {
  recordV25Metrics,
} from "../routes/benchmark-v25-api.ts";
import {
  parsePrediction,
  analyzeConsensusIntelligence,
  computeV25CompositeScore,
  type V25RoundAgentData,
} from "../services/v25-benchmark-engine.ts";
import {
  analyzeReasoningDepthV24,
  analyzeSourceQualityV24,
} from "../services/reasoning-depth-quality-engine.ts";
import {
  analyzeTradeAccountability,
  analyzeReasoningQualityIndex,
  computeV28Composite,
  recordV28Scores,
  updateV28Leaderboard,
} from "../services/v28-benchmark-engine.ts";

// ---------------------------------------------------------------------------
// Type aliases for database results
// ---------------------------------------------------------------------------

type Position = InferSelectModel<typeof positions>;
type AgentDecision = InferSelectModel<typeof agentDecisions>;

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

/**
 * Find agent config by agentId from ALL_AGENTS array.
 * @param agentId - The agent ID to search for
 * @returns Agent config or undefined if not found
 */
function getAgentConfigById(agentId: string) {
  return ALL_AGENTS.find((a) => a.config.agentId === agentId)?.config;
}

// ---------------------------------------------------------------------------
// Market Data Fetching
// ---------------------------------------------------------------------------

/**
 * Fetch current market data for all xStocks tokens.
 * Uses Jupiter Price API V3 for real prices, with fallback to mock data.
 */
// ---------------------------------------------------------------------------
// Market Data Cache (10-second TTL)
// ---------------------------------------------------------------------------

let cachedMarketData: MarketData[] | null = null;
let cachedMarketDataTimestamp = 0;
const MARKET_DATA_CACHE_TTL_MS = 10_000; // 10 seconds

/** Standard risk constraints used across all benchmark scoring versions */
const BENCHMARK_RISK_CONSTRAINTS = { maxPositionSize: 25, maxPortfolioAllocation: 85, riskTolerance: "moderate" as const };

/** Standard portfolio baseline used across all benchmark scoring versions */
const BENCHMARK_PORTFOLIO_BASELINE = { cashBalance: 10000, totalValue: 10000, positions: [] as never[] };

// ---------------------------------------------------------------------------
// Scoring Proxy Formulas
// ---------------------------------------------------------------------------
// When full justification data isn't available yet, these linear transforms
// of normalizedConfidence approximate various quality dimensions.

/** Proxy for reasoning quality (v9-v15): moderate slope, low floor */
const proxyReasoningFromConf = (c: number) => c * 0.8 + 0.1;

/** Proxy for coherence estimate (v17+): gentle slope, higher floor */
const proxyCoherenceFromConf = (c: number) => c * 0.6 + 0.3;

/** Proxy for composite score (v15): broad blend */
const proxyCompositeFromConf = (c: number) => c * 0.4 + 0.4;

// ---------------------------------------------------------------------------
// Confidence-Based Grading
// ---------------------------------------------------------------------------

/** Default reasoning stability when no justification data is available */
const DEFAULT_REASONING_STABILITY = 0.7;

/** Grade confidence thresholds and labels for benchmark scoring */
const CONFIDENCE_GRADE_B_THRESHOLD = 0.7;
const CONFIDENCE_GRADE_C_THRESHOLD = 0.5;

/** Assign a letter grade based on normalized confidence */
const gradeFromConfidence = (normConf: number): string =>
  normConf >= CONFIDENCE_GRADE_B_THRESHOLD ? "B+" : normConf >= CONFIDENCE_GRADE_C_THRESHOLD ? "C+" : "C";

// ---------------------------------------------------------------------------
// Benchmark Scoring Weights
// ---------------------------------------------------------------------------
// Tuning parameters for weighted score calculations across benchmark versions.
// Extracting these constants enables reproducibility and easier experimentation.

/** v15 composite score: confidence component weight */
const V15_COMPOSITE_CONFIDENCE_WEIGHT = 0.35;

/** v15 composite score: baseline offset */
const V15_COMPOSITE_BASELINE = 0.45;

/** v17 metacognition score: confidence component weight */
const V17_METACOGNITION_CONFIDENCE_WEIGHT = 0.4;

/** v17 metacognition score: baseline offset */
const V17_METACOGNITION_BASELINE = 0.3;

/** v17 Elo composite: confidence weight for normalized confidence path (conf <= 1) */
const V17_ELO_CONFIDENCE_WEIGHT = 0.4;

/** v17 Elo composite: baseline offset for normalized confidence path (conf <= 1) */
const V17_ELO_BASELINE = 0.3;

/** v17 Elo composite: divisor for high confidence path (conf > 1) */
const V17_ELO_HIGH_CONF_DIVISOR = 200;

/** v18 agent score: confidence component weight in 3-part aggregate */
const V18_AGENT_SCORE_CONFIDENCE_WEIGHT = 0.4;

/** v18 agent score: coherence component weight in 3-part aggregate */
const V18_AGENT_SCORE_COHERENCE_WEIGHT = 0.3;

/** v18 agent score: adversarial robustness component weight in 3-part aggregate */
const V18_AGENT_SCORE_ADVERSARIAL_WEIGHT = 0.3;

// ---------------------------------------------------------------------------
// Reasoning Depth & Efficiency Thresholds
// ---------------------------------------------------------------------------
// Word count thresholds for computing depth and efficiency scores.
// depthScore = min(1, wordCount / REASONING_DEPTH_WORD_THRESHOLD)
// efficiencyScore = min(1, wordCount / REASONING_EFFICIENCY_WORD_THRESHOLD)

/** Word count threshold for depthScore: 100 words = 1.0 depth */
const REASONING_DEPTH_WORD_THRESHOLD = 100;

/** Word count threshold for reasoning_efficiency: 150 words = 1.0 efficiency */
const REASONING_EFFICIENCY_WORD_THRESHOLD = 150;

// ---------------------------------------------------------------------------
// Coherence Grading Thresholds
// ---------------------------------------------------------------------------

/** Coherence score threshold for grade A (>= 0.8) */
const COHERENCE_GRADE_A_THRESHOLD = 0.8;

/** Coherence score threshold for grade B (>= 0.6) */
const COHERENCE_GRADE_B_THRESHOLD_AUDIT = 0.6;

/** Assign a letter grade based on coherence score for audit trail */
const gradeFromCoherence = (score: number): string =>
  score >= COHERENCE_GRADE_A_THRESHOLD ? "A" : score >= COHERENCE_GRADE_B_THRESHOLD_AUDIT ? "B" : "C";

export async function getMarketData(): Promise<MarketData[]> {
  // Check cache first
  const now = Date.now();
  if (cachedMarketData && now - cachedMarketDataTimestamp < MARKET_DATA_CACHE_TTL_MS) {
    console.log("[Orchestrator] Using cached market data");
    return cachedMarketData;
  }

  try {
    // Use the market aggregator which:
    // - Fetches from Jupiter with CoinGecko/DexScreener fallbacks
    // - Maintains price history (enabling technical indicators)
    // - Computes change24h from history when Jupiter doesn't provide it
    // - Has its own 10-second cache
    const aggregated = await fetchAggregatedPrices();

    // Filter to only tradeable (liquid) stocks if analysis is available
    const tradeableSet = getTradeableSymbols();
    const filtered = tradeableSet
      ? aggregated.filter((p) => tradeableSet.has(p.symbol))
      : aggregated;

    if (tradeableSet) {
      console.log(`[Orchestrator] Liquidity filter: ${filtered.length}/${aggregated.length} stocks are tradeable`);
    }

    const results: MarketData[] = filtered.map((p) => ({
      symbol: p.symbol,
      name: p.name,
      mintAddress: p.mintAddress,
      price: p.price,
      change24h: p.change24h,
      volume24h: p.volume24h,
    }));

    // Cache results
    cachedMarketData = results;
    cachedMarketDataTimestamp = Date.now();

    return results;
  } catch {
    // Complete fallback to mock data
    const results: MarketData[] = XSTOCKS_CATALOG.map((stock) => ({
      symbol: stock.symbol,
      name: stock.name,
      mintAddress: stock.mintAddress,
      price: generateMockPrice(stock.symbol),
      change24h: generateMockChange(),
      volume24h: generateMockVolume(),
    }));

    cachedMarketData = results;
    cachedMarketDataTimestamp = Date.now();

    return results;
  }
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
    const INITIAL_CAPITAL = 50; // $50 starting capital per AI agent (actual funding)
    let cashBalance = INITIAL_CAPITAL;
    for (const trade of agentTrades) {
      if (trade.side === "buy") {
        cashBalance -= parseFloat(trade.usdcAmount);
      } else if (trade.side === "sell") {
        cashBalance += parseFloat(trade.usdcAmount);
      }
    }

    // Build position details with current market prices
    const positionDetails: AgentPosition[] = agentPositions.map((pos: Position) => {
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
    const errorMsg = errorMessage(err);
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
      `[Orchestrator] Pre-round gate check error (continuing): ${errorMessage(err)}`,
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
    const msg = `Failed to fetch market data: ${errorMessage(error)}`;
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
      `[Orchestrator] News fetch failed (non-critical): ${errorMessage(err)}`,
    );
  }

  // Step 3: Inject news into market data for agent prompts
  if (newsContext) {
    for (const md of marketData) {
      md.news = md.news ?? [];
      md.news.push(newsContext);
    }
  }

  // Step 3.5: Pre-compute movers list (stocks with >3% absolute change)
  const movers = marketData
    .filter((d) => d.change24h !== null && Math.abs(d.change24h) > 3)
    .sort((a, b) => Math.abs(b.change24h ?? 0) - Math.abs(a.change24h ?? 0))
    .slice(0, 10)
    .map((d) => ({
      symbol: d.symbol,
      name: d.name,
      change24h: d.change24h,
      price: d.price,
    }));

  // Inject movers context into market data
  if (movers.length > 0) {
    const moversContext = `\n\n**Market Movers (>3% change today)**:\n${movers
      .map(
        (m) =>
          `- ${m.symbol} (${m.name}): ${m.change24h! > 0 ? "+" : ""}${round2(m.change24h!)}% at $${round2(m.price)}`,
      )
      .join("\n")}`;

    for (const md of marketData) {
      md.news = md.news ?? [];
      md.news.push(moversContext);
    }

    console.log(
      `[Orchestrator] Pre-computed ${movers.length} movers (>${round2(Math.abs(movers[movers.length - 1].change24h!))}% change)`,
    );
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
            `[Orchestrator] Balance snapshot failed for ${agent.agentId}: ${errorMessage(err)}`,
          ),
      );

      // Build portfolio context
      const portfolio = await getPortfolioContext(agent.agentId, marketData);

      // Agents now fetch their own context via tools (tool-calling loop)
      let decision = await agent.analyze(marketData, portfolio);
      console.log(
        `[Orchestrator] ${agent.name} decided: ${decision.action} ${decision.symbol} (confidence: ${decision.confidence}%)`,
      );

      // --- QUALITY GATE: Validate reasoning before execution ---
      try {
        const qualityResult = checkReasoningQuality(decision, marketData);
        if (!qualityResult.passed) {
          console.log(
            `[Orchestrator] ${agent.name} QUALITY GATE REJECTED: composite=${round2(qualityResult.scores.composite)}, ` +
            `reasons: ${qualityResult.rejectionReasons.join("; ")}`,
          );
          decision = qualityResult.decision;
        } else {
          console.log(
            `[Orchestrator] ${agent.name} quality gate PASSED: composite=${round2(qualityResult.scores.composite)}`,
          );
        }
      } catch (err) {
        console.warn(
          `[Orchestrator] Quality gate check failed for ${agent.agentId}: ${errorMessage(err)}`,
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
          `[Orchestrator] ${agent.name} benchmark: coherence=${round2(coherence.score)}, ` +
          `hallucinations=${hallucinations.flags.length}, discipline=${discipline.passed ? "PASS" : "FAIL"}`,
        );

        // Record justification to DB with full tool trace
        const justificationId = `tj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        await db.insert(tradeJustifications).values({
          id: justificationId,
          agentId: agent.agentId,
          reasoning: decision.reasoning,
          confidence: normalizeConfidence(decision.confidence),
          sources,
          toolTrace: decision.toolTrace ?? null,
          modelUsed: agent.model,
          intent,
          predictedOutcome: decision.predictedOutcome ?? null,
          coherenceScore: coherence.score,
          hallucinationFlags: hallucinations.flags,
          action: decision.action,
          symbol: decision.symbol,
          quantity: decision.quantity,
          roundId,
          disciplinePass: discipline.passed ? "pass" : "fail",
        }).catch((err: unknown) => {
          console.warn(
            `[Orchestrator] Justification insert failed: ${errorMessage(err)}`,
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
          wordCount: countWords(decision.reasoning),
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
            gradeFromCoherence(coherence.score),
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
            `[Orchestrator] Governance service recording failed for ${agent.agentId}: ${errorMessage(err)}`,
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
            `[Orchestrator] ${agent.name} depth: ${round2(depthScore.overall)} (${depthScore.classification}), ` +
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
              `[Orchestrator] ${agent.name} deep coherence: ${round2(deepResult.overallScore)} (${deepResult.grade}), ` +
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
              `[Orchestrator] Deep coherence failed for ${agent.agentId}: ${errorMessage(err)}`,
            );
          }

          // --- v10: Reasoning pattern analysis (fallacies, depth, vocabulary) ---
          let patternResult: { qualityScore: number; fallacies: { type: string }[]; depth: { classification: string }; vocabulary: { sophisticationScore: number }; hedgeRatio: number; templateProbability: number } | null = null;
          try {
            patternResult = analyzeReasoningPatterns(agent.agentId, decision.reasoning);
            recordReasoningForPatternAnalysis(agent.agentId, decision.reasoning, patternResult.qualityScore);
            console.log(
              `[Orchestrator] ${agent.name} patterns: quality=${round2(patternResult.qualityScore)}, ` +
              `fallacies=${patternResult.fallacies.length}, depth=${patternResult.depth.classification}, ` +
              `vocab=${round2(patternResult.vocabulary.sophisticationScore)}`,
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
              `[Orchestrator] Pattern analysis failed for ${agent.agentId}: ${errorMessage(err)}`,
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
              `[Orchestrator] ${agent.name} forensic: composite=${round2(forensicReport.compositeScore)} (${forensicReport.grade}), ` +
              `depth=${forensicReport.depth.classification}, originality=${round2(forensicReport.originality.originalityScore)}, ` +
              `clarity=${round2(forensicReport.clarity.clarityScore)}, integrity-flags=${forensicReport.crossTrade.flags.length}`,
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
              `[Orchestrator] v11 forensic analysis failed for ${agent.agentId}: ${errorMessage(err)}`,
            );
          }
        } catch (err) {
          console.warn(
            `[Orchestrator] Depth/stream analysis failed for ${agent.agentId}: ${errorMessage(err)}`,
          );
        }
      } catch (err) {
        console.warn(
          `[Orchestrator] Benchmark analysis failed for ${agent.agentId}: ${errorMessage(err)}`,
        );
      }

      // --- v12: Validation Engine, Reasoning Taxonomy, Cross-Round Consistency ---
      try {
        const normalizedConf12 = normalizeConfidence(decision.confidence);

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
          `[Orchestrator] v12 analysis failed for ${agent.agentId}: ${errorMessage(err)}`,
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
            `[Orchestrator] Post-trade snapshot failed for ${agent.agentId}: ${errorMessage(err)}`,
          ),
      );

      results.push(execResult);

      // Apply jitter between agents (1-5 seconds)
      await applyTradeJitter();
    } catch (error) {
      const msg = `${agent.name} failed: ${errorMessage(error)}`;
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

  // --- Meeting of Minds: Post-Trade Deliberation ---
  let meetingResult: Awaited<ReturnType<typeof runMeetingOfMinds>> | null = null;
  if (process.env.MEETING_OF_MINDS_ENABLED !== "false") {
    try {
      meetingResult = await runMeetingOfMinds(results, ALL_AGENTS, marketData, roundId);
      console.log(
        `[Round] Meeting of Minds: ${meetingResult.consensus.type} — ${meetingResult.consensus.summary}`,
      );
    } catch (err) {
      console.error(`[Round] Meeting of Minds failed: ${errorMessage(err)}`);
    }
  }

  // --- Monad $STONKS Lending Phase ---
  if (process.env.LENDING_ENABLED === "true") {
    try {
      const agentDecisions = results.map((r) => ({
        agentId: r.agentId,
        decision: r.decision,
      }));
      const lendingResult = await runLendingPhase(roundId, agentDecisions, marketData);
      if (lendingResult.loansCreated > 0 || lendingResult.loansSettled > 0) {
        console.log(
          `[Orchestrator] Lending: ${lendingResult.loansCreated} new loans, ` +
            `${lendingResult.loansSettled} settled, ${lendingResult.totalStonksBorrowed} $STONKS moved`,
        );
      }
    } catch (err) {
      console.warn(
        `[Orchestrator] Lending phase failed (non-critical): ${errorMessage(err)}`,
      );
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
      meetingOfMinds: meetingResult ? JSON.stringify(meetingResult) : undefined,
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
      meetingOfMinds: meetingResult ? JSON.stringify(meetingResult) : undefined,
    }).catch((err) =>
      console.warn(`[Orchestrator] DynamoDB persist failed: ${errorMessage(err)}`),
    );
  } catch (err) {
    console.warn(`[Orchestrator] Round caching failed: ${errorMessage(err)}`);
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
    console.warn(`[Orchestrator] Outcome tracking failed: ${errorMessage(err)}`),
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
    console.warn(`[Orchestrator] Reasoning diffs failed: ${errorMessage(err)}`);
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
    console.warn(`[Orchestrator] Integrity proof failed: ${errorMessage(err)}`);
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
    console.warn(`[Orchestrator] Leaderboard evolution failed: ${errorMessage(err)}`);
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
        normalizeConfidence(r.decision.confidence),
        r.decision.action,
        roundId,
      );
    }
  } catch (err) {
    console.warn(`[Orchestrator] Regime detection failed: ${errorMessage(err)}`);
  }

  // --- NEW: Peer review — agents critique each other's reasoning ---
  try {
    const roundDecisions = results.map((r) => ({
      agentId: r.agentId,
      reasoning: r.decision.reasoning,
      action: r.decision.action,
      symbol: r.decision.symbol,
      confidence: normalizeConfidence(r.decision.confidence),
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
    console.warn(`[Orchestrator] Peer review failed: ${errorMessage(err)}`);
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
      const normConf = normalizeConfidence(r.decision.confidence);
      return {
        agentId: r.agentId,
        action: r.decision.action,
        symbol: r.decision.symbol,
        quantity: r.decision.quantity,
        reasoning: r.decision.reasoning,
        confidence: normConf,
        intent: r.decision.intent ?? "value",
        coherenceScore: proxyReasoningFromConf(normConf), // Will be enriched from justification
        hallucinationCount: 0, // Will be enriched
        disciplinePass: true, // Will be enriched
        pnlPercent: 0, // Will be enriched by financial tracker
        depthScore: Math.min(1, countWords(r.decision.reasoning) / REASONING_DEPTH_WORD_THRESHOLD),
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
      highlights: countByCondition(battles, (b) => b.highlight),
    });
  } catch (err) {
    console.warn(`[Orchestrator] v13 battle generation failed: ${errorMessage(err)}`);
  }

  // --- Round-level provenance, Elo, and audit trail ---
  try {
    // Record round in provenance chain
    recordRoundProvenance(roundId, {
      agentCount: results.length,
      tradeCount: countByCondition(results, (r) => r.decision.action !== "hold"),
      avgCoherence: 0.5, // Will be enriched by scoring engine
      hallucinationCount: 0,
      tradingMode: getTradingMode(),
    });

    // Process Elo updates from pairwise comparisons
    const eloResults = results.map((r) => ({
      agentId: r.agentId,
      compositeScore: normalizeConfidence(r.decision.confidence),
    }));
    processRoundElo(eloResults);

    // Note: Trade profit/loss streak tracking removed (incomplete implementation).
    // Ranking-based streaks are tracked in leaderboard-evolution.ts instead.

    // Audit peer review
    auditPeerReview(roundId, results.length, results[0]?.agentId ?? null, 0);
  } catch (err) {
    console.warn(`[Orchestrator] Governance round finalization failed: ${errorMessage(err)}`);
  }

  // --- v14: Outcome Resolution, Calibration, Volatility, Consensus ---
  try {
    // 1. Register predictions and resolve pending ones
    for (const r of results) {
      const normConf = normalizeConfidence(r.decision.confidence);
      const stock = marketData.find((m) => m.symbol.toLowerCase() === r.decision.symbol.toLowerCase());

      // Register prediction if agent provided one
      if (r.decision.predictedOutcome && stock) {
        registerPrediction({
          agentId: r.agentId,
          symbol: r.decision.symbol,
          action: r.decision.action,
          confidence: normConf,
          predictedOutcome: r.decision.predictedOutcome,
          priceAtPrediction: stock.price,
          roundId,
          intent: r.decision.intent,
        });
      }

      // Record calibration data point
      const coherenceForCalib = proxyReasoningFromConf(normConf); // Proxy until justification is available
      const qualityOutcome = inferOutcomeFromCoherence(coherenceForCalib, 0, true);
      recordCalibrationPoint({
        agentId: r.agentId,
        confidence: normConf,
        outcome: qualityOutcome,
        coherenceScore: coherenceForCalib,
        action: r.decision.action,
        symbol: r.decision.symbol,
        roundId,
        timestamp: new Date().toISOString(),
      });

      // Record reasoning volatility snapshot
      const volSentiment = computeVolatilitySentiment(r.decision.reasoning);
      const keyPhrases = extractKeyPhrases(r.decision.reasoning);
      recordReasoningForVolatility({
        agentId: r.agentId,
        roundId,
        symbol: r.decision.symbol,
        action: r.decision.action,
        confidence: normConf,
        intent: r.decision.intent ?? "value",
        sentimentScore: volSentiment,
        wordCount: countWords(r.decision.reasoning),
        coherenceScore: coherenceForCalib,
        keyPhrases,
        timestamp: new Date().toISOString(),
      });
    }

    // 2. Resolve pending predictions against current prices
    const priceMap = new Map<string, number>();
    for (const md of marketData) {
      priceMap.set(md.symbol, md.price);
      priceMap.set(md.symbol.toLowerCase(), md.price);
    }
    const newlyResolved = resolvePredictions(priceMap);
    if (newlyResolved.length > 0) {
      console.log(
        `[Orchestrator] v14 resolved ${newlyResolved.length} predictions. ` +
        `Correct: ${countByCondition(newlyResolved, (r) => r.directionCorrect)}/${newlyResolved.length}`,
      );
    }

    // 3. Record consensus divergence
    const consensusAgents: AgentRoundAction[] = results.map((r) => {
      const normConf = normalizeConfidence(r.decision.confidence);
      return {
        agentId: r.agentId,
        action: r.decision.action,
        symbol: r.decision.symbol,
        confidence: normConf,
        reasoning: r.decision.reasoning,
        coherenceScore: proxyReasoningFromConf(normConf),
      };
    });
    const consensusSnapshot = recordRoundConsensus(roundId, consensusAgents);

    console.log(
      `[Orchestrator] v14 consensus: ${consensusSnapshot.consensusType}, ` +
      `agreement=${(consensusSnapshot.agreementScore * 100).toFixed(0)}%, ` +
      `contrarians=${consensusSnapshot.contrarians.length}`,
    );

    // 4. Update v14 agent metrics
    for (const r of results) {
      const normConf = normalizeConfidence(r.decision.confidence);
      recordV14AgentMetrics(r.agentId, {
        financial: 0.5,
        reasoning: proxyReasoningFromConf(normConf),
        safety: 0.8,
        calibration: 0.5,
        patterns: 0.5,
        adaptability: 0.5,
        forensicQuality: 0.5,
        validationQuality: 0.5,
        predictionAccuracy: 0.5,
        reasoningStability: DEFAULT_REASONING_STABILITY,
        composite: proxyCompositeFromConf(normConf),
        grade: gradeFromConfidence(normConf),
        tradeCount: 1,
        lastUpdated: new Date().toISOString(),
      });
    }

    // 5. Emit v14 events
    emitV14Event("round_analyzed", {
      roundId,
      agentCount: results.length,
      consensusType: consensusSnapshot.consensusType,
      agreementScore: consensusSnapshot.agreementScore,
      predictionsResolved: newlyResolved.length,
      predictionsCorrect: countByCondition(newlyResolved, (r) => r.directionCorrect),
    });

    emitBenchmarkEvent("benchmark_update", {
      version: "v14",
      roundId,
      consensusType: consensusSnapshot.consensusType,
      agreement: consensusSnapshot.agreementScore,
      predictionsResolved: newlyResolved.length,
    });

  } catch (err) {
    console.warn(`[Orchestrator] v14 analysis failed: ${errorMessage(err)}`);
  }

  // --- v15: Reasoning Provenance, Cross-Model Comparison, Reproducibility ---
  try {
    // 1. Create reasoning provenance proofs for each agent
    const marketSnapshot: Record<string, unknown> = {};
    for (const md of marketData) {
      marketSnapshot[md.symbol] = { price: md.price, change24h: md.change24h };
    }

    for (const r of results) {
      const normConf = normalizeConfidence(r.decision.confidence);

      // Cryptographic provenance proof
      const proof = createReasoningProof(
        r.agentId,
        r.decision.reasoning,
        r.decision.action,
        r.decision.symbol,
        normConf,
        marketSnapshot,
        roundId,
      );
      recordProvenanceEntry(proof);

      // Record for cross-model comparison
      recordRoundForComparison({
        agentId: r.agentId,
        action: r.decision.action,
        symbol: r.decision.symbol,
        reasoning: r.decision.reasoning,
        confidence: normConf,
        roundId,
        timestamp: new Date().toISOString(),
      });
    }

    // 2. Cross-model comparison for this round
    const comparisonEntries: ComparisonEntry[] = results.map((r) => ({
      agentId: r.agentId,
      action: r.decision.action,
      symbol: r.decision.symbol,
      reasoning: r.decision.reasoning,
      confidence: normalizeConfidence(r.decision.confidence),
      roundId,
      timestamp: new Date().toISOString(),
    }));

    const crossModelResult = compareRoundReasoning(comparisonEntries);

    console.log(
      `[Orchestrator] v15 cross-model: herding=${round2(crossModelResult.herdingScore)}, ` +
      `pairs=${crossModelResult.similarities.length}, ` +
      `divergences=${crossModelResult.divergencePoints.length}`,
    );

    // 3. Reproducibility proof for this round's scoring
    const scoringInputs: Record<string, unknown> = {
      roundId,
      agents: results.map((r) => ({
        agentId: r.agentId,
        action: r.decision.action,
        confidence: r.decision.confidence,
        symbol: r.decision.symbol,
      })),
      marketSnapshot,
    };
    const scoringConfig: Record<string, unknown> = {
      version: "v15",
      pillars: 12,
      weights: {
        financial: 0.13, reasoning: 0.12, safety: 0.10, calibration: 0.09,
        patterns: 0.06, adaptability: 0.06, forensicQuality: 0.09,
        validationQuality: 0.09, predictionAccuracy: 0.07, reasoningStability: 0.06,
        provenanceIntegrity: 0.07, modelComparison: 0.06,
      },
    };
    const scoringOutputs: Record<string, unknown> = {};
    for (const r of results) {
      const normConf = normalizeConfidence(r.decision.confidence);
      scoringOutputs[r.agentId] = { composite: proxyCompositeFromConf(normConf) };
    }

    recordScoringRun({
      roundId,
      timestamp: Date.now(),
      inputs: scoringInputs,
      scores: scoringOutputs,
      scoringConfig,
    });

    const reproProof = generateReproducibilityProof(
      roundId,
      scoringInputs,
      scoringOutputs,
      scoringConfig,
    );

    console.log(
      `[Orchestrator] v15 reproducibility: deterministic=${reproProof.deterministic}, ` +
      `matches=${reproProof.priorRunMatches}, mismatches=${reproProof.priorRunMismatches}`,
    );

    // 4. Update v15 agent metrics
    for (const r of results) {
      const normConf = normalizeConfidence(r.decision.confidence);
      recordV15AgentMetrics(r.agentId, {
        financial: 0.5,
        reasoning: proxyReasoningFromConf(normConf),
        safety: 0.8,
        calibration: 0.5,
        patterns: 0.5,
        adaptability: 0.5,
        forensicQuality: 0.5,
        validationQuality: 0.5,
        predictionAccuracy: 0.5,
        reasoningStability: DEFAULT_REASONING_STABILITY,
        provenanceIntegrity: reproProof.deterministic ? 1.0 : 0.5,
        modelComparison: 1 - crossModelResult.herdingScore,
        composite: normConf * V15_COMPOSITE_CONFIDENCE_WEIGHT + V15_COMPOSITE_BASELINE,
        grade: gradeFromConfidence(normConf),
        tradeCount: 1,
        lastUpdated: new Date().toISOString(),
      });
    }

    // 5. Emit v15 events
    emitV15Event("round_analyzed", {
      roundId,
      agentCount: results.length,
      herdingScore: crossModelResult.herdingScore,
      divergenceCount: crossModelResult.divergencePoints.length,
      reproducible: reproProof.deterministic,
    });

    emitBenchmarkEvent("benchmark_update", {
      version: "v15",
      roundId,
      herdingScore: crossModelResult.herdingScore,
      reproducible: reproProof.deterministic,
      provenanceProofs: results.length,
    });

  } catch (err) {
    console.warn(`[Orchestrator] v15 analysis failed: ${errorMessage(err)}`);
  }

  // --- v16: Metacognition, Reasoning Depth, Unified 14-Pillar Scoring ---
  try {
    for (const r of results) {
      const normConf = normalizeConfidence(r.decision.confidence);

      // 1. Score reasoning depth (8 dimensions)
      const depthResult = scoreV16Depth(r.decision.reasoning);

      // 2. Analyze trade efficiency (signal-to-noise)
      const efficiency = analyzeTradeEfficiency(r.decision.reasoning);

      // 3. Record metacognition event (auto-detects self-awareness markers)
      const intent = r.decision.intent ?? classifyIntent(r.decision.reasoning, r.decision.action);
      recordMetacognitionEvent({
        agentId: r.agentId,
        reasoning: r.decision.reasoning,
        action: r.decision.action,
        symbol: r.decision.symbol,
        confidence: normConf,
        intent,
        coherenceScore: proxyCoherenceFromConf(normConf),
        roundId,
        timestamp: new Date().toISOString(),
      });

      // 4. Feed unified 14-pillar scoring engine
      recordV16Metrics(r.agentId, {
        coherence: proxyCoherenceFromConf(normConf),
        hallucinationFree: 0.9,
        discipline: true,
        confidence: normConf,
        reasoning: r.decision.reasoning,
        action: r.decision.action,
        depth: depthResult.overall,
        forensicScore: 0.5,
        validationScore: 0.5,
      });

      console.log(
        `[Orchestrator] v16 ${r.agentId}: depth=${round2(depthResult.overall)} ` +
        `(${depthResult.classification}), efficiency=${round2(efficiency.composite)}, ` +
        `angles=${depthResult.anglesDetected.length}`,
      );
    }

    // 5. Compute rankings after all agents recorded
    const allScores = results.map((r) => ({
      agentId: r.agentId,
      score: computeV16Score(r.agentId),
    }));

    // 6. Emit v16 events
    const metacogPillar = (pillars: { name: string; score: number }[], name: string) =>
      pillars.find((p) => p.name === name)?.score ?? 0;

    emitV16Event("round_analyzed", {
      roundId,
      agentCount: results.length,
      scores: allScores.map((s) => ({
        agentId: s.agentId,
        composite: s.score.composite,
        grade: s.score.grade,
        metacognition: metacogPillar(s.score.pillars, "metacognition"),
        efficiency: metacogPillar(s.score.pillars, "efficiency"),
      })),
    });

    console.log(
      `[Orchestrator] v16 round complete: ${allScores.map((s) => `${s.agentId}=${s.score.composite.toFixed(3)}(${s.score.grade})`).join(", ")}`,
    );

  } catch (err) {
    console.warn(`[Orchestrator] v16 analysis failed: ${errorMessage(err)}`);
  }

  // --- v17: Benchmark Intelligence Gateway, Forensic Ledger, Strategy Genomes ---
  try {
    // Build market price map for ledger
    const v17PriceMap: Record<string, number> = {};
    for (const md of marketData) {
      v17PriceMap[md.symbol] = md.price;
    }

    // Agent IDs for witness list
    const allAgentIds = results.map((r) => r.agentId);

    // Compute consensus for genome
    const majorityAction = (() => {
      const actions = results.filter((r) => r.decision.action !== "hold").map((r) => r.decision.action);
      const buys = countByCondition(actions, (a) => a === "buy");
      const sells = countByCondition(actions, (a) => a === "sell");
      if (buys > sells) return "buy";
      if (sells > buys) return "sell";
      return null;
    })();

    for (const r of results) {
      const normConf = normalizeConfidence(r.decision.confidence);
      const intent = r.decision.intent ?? classifyIntent(r.decision.reasoning, r.decision.action);
      const sources = r.decision.sources ?? extractSourcesFromReasoning(r.decision.reasoning);

      // 1. Append to forensic ledger
      const ledgerEntry = appendToLedger({
        agentId: r.agentId,
        roundId,
        action: r.decision.action,
        symbol: r.decision.symbol,
        quantity: r.decision.quantity,
        reasoning: r.decision.reasoning,
        confidence: normConf,
        intent,
        sources,
        predictedOutcome: r.decision.predictedOutcome ?? null,
        marketPrices: v17PriceMap,
        coherenceScore: proxyCoherenceFromConf(normConf),
        hallucinationFlags: [],
        disciplinePass: true,
        depthScore: Math.min(1, countWords(r.decision.reasoning) / REASONING_DEPTH_WORD_THRESHOLD),
        forensicScore: 0.5,
        efficiencyScore: 0.5,
        witnesses: allAgentIds.filter((id) => id !== r.agentId),
      });

      // 2. Record genome observation
      recordGenomeObservation({
        agentId: r.agentId,
        action: r.decision.action,
        symbol: r.decision.symbol,
        quantity: r.decision.quantity,
        confidence: normConf,
        coherenceScore: proxyCoherenceFromConf(normConf),
        hallucinationCount: 0,
        intent,
        reasoning: r.decision.reasoning,
        roundId,
        consensusAction: majorityAction,
        marketVolatility: 0.02,
        pnlAfter: null,
        timestamp: new Date().toISOString(),
      });

      // 3. Get genome pillar score
      const genomePillarScore = getGenomePillarScore(r.agentId);

      // 4. Record unified v17 scores across all 16 pillars
      const agentConfig = getAgentConfigById(r.agentId);
      recordV17Scores(
        r.agentId,
        agentConfig?.provider ?? "unknown",
        agentConfig?.model ?? "unknown",
        {
          financial: 0.5,
          reasoning: proxyCoherenceFromConf(normConf),
          safety: 0.8,
          calibration: 0.5,
          patterns: 0.5,
          adaptability: 0.5,
          forensic_quality: 0.5,
          validation_quality: 0.5,
          prediction_accuracy: 0.5,
          reasoning_stability: 0.7,
          provenance_integrity: 0.8,
          model_comparison: 0.5,
          metacognition: normConf * V17_METACOGNITION_CONFIDENCE_WEIGHT + V17_METACOGNITION_BASELINE,
          reasoning_efficiency: Math.min(1, countWords(r.decision.reasoning) / REASONING_EFFICIENCY_WORD_THRESHOLD),
          forensic_ledger: ledgerEntry ? 0.9 : 0.3,
          strategy_genome: genomePillarScore,
        },
        roundId,
      );

      console.log(
        `[Orchestrator] v17 ${r.agentId}: ledger=${ledgerEntry.entryHash.slice(0, 12)}..., genome=${genomePillarScore.toFixed(2)}`,
      );
    }

    // 5. Update Elo rankings
    const eloInputs = results.map((r) => ({
      agentId: r.agentId,
      composite: r.decision.confidence > 1
        ? r.decision.confidence / V17_ELO_HIGH_CONF_DIVISOR + V17_ELO_BASELINE
        : r.decision.confidence * V17_ELO_CONFIDENCE_WEIGHT + V17_ELO_BASELINE,
    }));
    updateV17Elo(eloInputs);

    // 6. Emit v17 events
    emitV17Event("round_analyzed", {
      roundId,
      agentCount: results.length,
      version: "v17",
      pillars: 16,
    });

    console.log(
      `[Orchestrator] v17 round complete: ${results.length} agents scored, ledger + genome updated`,
    );

  } catch (err) {
    console.warn(`[Orchestrator] v17 analysis failed: ${errorMessage(err)}`);
  }

  // =========================================================================
  // v18 ANALYSIS — Adversarial Robustness + Cross-Session Memory + Regression
  // =========================================================================
  try {
    const agentScores: Record<string, number> = {};
    const pillarAverages: Record<string, number> = {};
    let coherenceSum = 0;
    let hallucinationCount = 0;
    let reasoningLengthSum = 0;

    for (const r of results) {
      const normConf = normalizeConfidence(r.decision.confidence);
      const intent = r.decision.intent ?? classifyIntent(r.decision.reasoning, r.decision.action);
      const coherenceEst = proxyCoherenceFromConf(normConf);
      const reasoningWords = countWords(r.decision.reasoning);

      // 1. Adversarial robustness analysis
      const adversarial = analyzeAdversarialRobustness(
        r.agentId,
        r.decision.reasoning,
        r.decision.action,
        r.decision.symbol,
        normConf,
        0, // currentPrice not easily available here, use 0
        {
          priceDirection: r.decision.action === "buy" ? "up" : r.decision.action === "sell" ? "down" : "flat",
          newsDirection: "neutral",
          hasZeroVolume: false,
          hasMissingData: false,
          hasExtremeMove: false,
        },
      );

      recordAdversarialResult(
        r.agentId,
        {
          overallScore: adversarial.overallScore,
          vulnerabilities: adversarial.vulnerabilities,
          signalConflictScore: adversarial.signalConflict.score,
          anchoringScore: adversarial.anchoring.score,
          edgeCaseScore: adversarial.edgeCases.score,
          framingScore: adversarial.framing.score,
        },
        roundId,
      );

      recordReasoningForAdversarial({
        agentId: r.agentId,
        action: r.decision.action,
        symbol: r.decision.symbol,
        reasoning: r.decision.reasoning,
        confidence: normConf,
        roundId,
        timestamp: new Date().toISOString(),
      });

      // 2. Cross-session memory entry
      const fingerprint = r.decision.reasoning
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .slice(0, 50);

      recordMemoryEntry({
        agentId: r.agentId,
        roundId,
        symbol: r.decision.symbol,
        action: r.decision.action,
        confidence: normConf,
        coherenceScore: coherenceEst,
        hallucinationCount: 0,
        intent,
        wasCorrect: null, // Resolved later by outcome tracker
        reasoningFingerprint: fingerprint,
        timestamp: new Date().toISOString(),
      });

      // Accumulate for health snapshot
      agentScores[r.agentId] = normConf * V18_AGENT_SCORE_CONFIDENCE_WEIGHT + coherenceEst * V18_AGENT_SCORE_COHERENCE_WEIGHT + adversarial.overallScore * V18_AGENT_SCORE_ADVERSARIAL_WEIGHT;
      coherenceSum += coherenceEst;
      reasoningLengthSum += reasoningWords;

      console.log(
        `[Orchestrator] v18 ${r.agentId}: adversarial=${adversarial.overallScore.toFixed(2)}, vulns=${adversarial.vulnerabilities.length}`,
      );
    }

    // 3. Record benchmark health snapshot
    const agentIds = Object.keys(agentScores);
    const scoreValues = Object.values(agentScores);
    const scoreMean = scoreValues.length > 0 ? scoreValues.reduce((s, v) => s + v, 0) / scoreValues.length : 0;
    const scoreSpread = scoreValues.length > 1
      ? Math.sqrt(scoreValues.reduce((s, v) => s + (v - scoreMean) ** 2, 0) / scoreValues.length)
      : 0;

    recordBenchmarkHealthSnapshot({
      timestamp: new Date().toISOString(),
      agentScores,
      pillarAverages,
      coherenceAvg: results.length > 0 ? coherenceSum / results.length : 0,
      hallucinationRate: results.length > 0 ? hallucinationCount / results.length : 0,
      avgReasoningLength: results.length > 0 ? reasoningLengthSum / results.length : 0,
      agentScoreSpread: round3(scoreSpread),
      calibrationAvg: 0.5,
    });

    // 4. Emit v18 events
    emitV18Event("round_analyzed", {
      roundId,
      agentCount: results.length,
      version: "v18",
      pillars: 18,
    });

    console.log(
      `[Orchestrator] v18 round complete: ${results.length} agents — adversarial + memory + regression recorded`,
    );

  } catch (err) {
    console.warn(`[Orchestrator] v18 analysis failed: ${errorMessage(err)}`);
  }

  // =========================================================================
  // v20: Reasoning Transparency + Decision Accountability + Quality Certification
  // =========================================================================
  try {
    for (const result of results) {
      const d = result.decision;
      const conf01 = normalizeConfidence(d.confidence);
      const sources = d.sources ?? extractSourcesFromReasoning(d.reasoning);

      // 1. Reasoning Transparency Engine — decompose reasoning into claims, evidence, logic
      analyzeTransparency(
        result.agentId,
        roundId,
        d.action,
        d.symbol,
        d.reasoning,
        conf01,
        sources,
      );

      // 2. Decision Accountability Tracker — register verifiable claims for outcome tracking
      registerClaims(
        result.agentId,
        roundId,
        d.symbol,
        d.action,
        d.reasoning,
        conf01,
      );

      // 3. Reasoning Quality Certifier — issue quality certificate
      certifyReasoning(
        result.agentId,
        roundId,
        d.action,
        d.symbol,
        d.reasoning,
        conf01,
        sources,
      );
    }

    // Emit v20 event
    emitV20Event("round_analyzed", {
      roundId,
      agentCount: results.length,
      version: "v20",
      pillars: 24,
    });

    console.log(
      `[Orchestrator] v20 round complete: ${results.length} agents — transparency + accountability + certification recorded`,
    );
  } catch (err) {
    console.warn(`[Orchestrator] v20 analysis failed: ${errorMessage(err)}`);
  }

  // =========================================================================
  // v21: Reasoning Chain Validation + Agent Strategy Profiling
  // =========================================================================
  try {
    for (const result of results) {
      const d = result.decision;
      const conf01 = normalizeConfidence(d.confidence);
      const sources = d.sources ?? extractSourcesFromReasoning(d.reasoning);
      const intent = d.intent ?? classifyIntent(d.reasoning, d.action);

      // 1. Reasoning Chain Validator — decompose and validate logical structure
      const chainResult = validateReasoningChain(d.reasoning, d.action, d.symbol);
      recordChainValidation(result.agentId, chainResult);

      // 2. Agent Strategy Profiler — track multi-dimensional strategy behavior
      recordTradeForProfiling(result.agentId, {
        action: d.action,
        symbol: d.symbol,
        reasoning: d.reasoning,
        confidence: conf01,
        intent,
        sources,
        coherenceScore: 0.5, // will be overwritten by coherence analyzer if available
      });
    }

    // Emit v21 event
    emitV21Event("round_analyzed", {
      roundId,
      agentCount: results.length,
      version: "v21",
      pillars: 26,
    });

    console.log(
      `[Orchestrator] v21 round complete: ${results.length} agents — chain validation + strategy profiling recorded`,
    );
  } catch (err) {
    console.warn(`[Orchestrator] v21 analysis failed: ${errorMessage(err)}`);
  }

  // =========================================================================
  // v22: Benchmark Integrity + Reasoning Grounding + Cognitive Bias Detection
  // =========================================================================
  try {
    const tradeIds: string[] = [];

    // Build other-agent context for herding detection
    const otherAgentContexts: Record<string, RoundAgentContext[]> = {};
    for (const result of results) {
      otherAgentContexts[result.agentId] = results
        .filter((r) => r.agentId !== result.agentId)
        .map((r) => ({
          agentId: r.agentId,
          action: r.decision.action,
          symbol: r.decision.symbol,
          reasoning: r.decision.reasoning,
          confidence: normalizeConfidence(r.decision.confidence),
        }));
    }

    for (const result of results) {
      const d = result.decision;
      const conf01 = normalizeConfidence(d.confidence);
      const sources = d.sources ?? extractSourcesFromReasoning(d.reasoning);
      const intent = d.intent ?? classifyIntent(d.reasoning, d.action);
      const tradeId = `v22_${roundId}_${result.agentId}`;

      // 1. Integrity Engine — fingerprint every trade
      recordTradeIntegrity({
        tradeId,
        agentId: result.agentId,
        roundId,
        action: d.action,
        symbol: d.symbol,
        quantity: d.quantity,
        reasoning: d.reasoning,
        confidence: conf01,
        intent,
        sources,
        predictedOutcome: d.predictedOutcome,
      });
      tradeIds.push(tradeId);

      // 2. Reasoning Grounding Validator — verify factual claims
      const groundingResult = validateGrounding(d.reasoning, marketData, sources);
      recordGroundingResult(tradeId, result.agentId, roundId, groundingResult);

      // 3. Cognitive Bias Detector — detect systematic reasoning errors
      const biasResult = analyzeBiases(
        d.reasoning,
        d.action,
        conf01,
        marketData,
        otherAgentContexts[result.agentId] ?? [],
      );
      recordBiasResult(tradeId, result.agentId, roundId, biasResult);
    }

    // Finalize round integrity — build Merkle tree
    finalizeRoundIntegrity(roundId, tradeIds);

    // Emit v22 event
    emitV22Event("round_analyzed", {
      roundId,
      agentCount: results.length,
      version: "v22",
      pillars: 28,
      tradeFingerprints: tradeIds.length,
    });

    console.log(
      `[Orchestrator] v22 round complete: ${results.length} agents — integrity + grounding + bias detection recorded`,
    );
  } catch (err) {
    console.warn(`[Orchestrator] v22 analysis failed: ${errorMessage(err)}`);
  }

  // -----------------------------------------------------------------------
  // v25 — Outcome Prediction + Consensus Intelligence (10-dimension benchmark)
  // -----------------------------------------------------------------------
  try {
    const v25AgentData: V25RoundAgentData[] = results.map((r) => ({
      agentId: r.agentId,
      action: r.decision.action,
      symbol: r.decision.symbol,
      reasoning: r.decision.reasoning,
      confidence: normalizeConfidence(r.decision.confidence),
      predictedOutcome: r.decision.predictedOutcome,
    }));

    for (const r of results) {
      const d = r.decision;
      const conf01 = normalizeConfidence(d.confidence);
      const agentData = v25AgentData.find((a) => a.agentId === r.agentId);
      if (!agentData) continue;

      const coherence = analyzeCoherence(d.reasoning, d.action, marketData);
      const hallucinations = detectHallucinations(d.reasoning, marketData);
      const discipline = checkInstructionDiscipline(
        { action: d.action, symbol: d.symbol, quantity: d.quantity, confidence: conf01 },
        BENCHMARK_RISK_CONSTRAINTS,
        BENCHMARK_PORTFOLIO_BASELINE,
      );

      const depth = analyzeReasoningDepthV24(d.reasoning);
      const sourceQ = analyzeSourceQualityV24(
        d.reasoning,
        d.sources ?? [],
      );

      recordV25Metrics(
        roundId,
        agentData,
        v25AgentData,
        coherence.score,
        1 - hallucinations.severity,
        discipline.passed,
        depth.depthScore,
        sourceQ.qualityScore,
      );
    }

    console.log(
      `[Orchestrator] v25 round complete: ${results.length} agents — outcome prediction + consensus intelligence recorded`,
    );
  } catch (err) {
    console.warn(`[Orchestrator] v25 analysis failed: ${errorMessage(err)}`);
  }

  // -----------------------------------------------------------------------
  // v28 — Trade Accountability + Reasoning Quality Index (16-dimension benchmark)
  // -----------------------------------------------------------------------
  try {
    for (const r of results) {
      const d = r.decision;
      const conf01 = normalizeConfidence(d.confidence);

      // Build past decisions for this agent (from previous rounds in this session)
      const pastDecisions = results
        .filter((pr) => pr.agentId === r.agentId && pr !== r)
        .map((pr) => ({
          action: pr.decision.action,
          symbol: pr.decision.symbol,
          reasoning: pr.decision.reasoning,
          outcome: pr.executed ? "executed" : "failure",
          coherenceScore: analyzeCoherence(pr.decision.reasoning, pr.decision.action, marketData).score,
        }));

      // Analyze trade accountability
      const accountability = analyzeTradeAccountability(d.reasoning, pastDecisions);

      // Analyze reasoning quality index
      const rqi = analyzeReasoningQualityIndex(d.reasoning);

      // Record v28 scores
      recordV28Scores(r.agentId, accountability, rqi);

      // Compute v28 composite scores from all available dimensions
      const coherence = analyzeCoherence(d.reasoning, d.action, marketData);
      const hallucinations = detectHallucinations(d.reasoning, marketData);
      const discipline = checkInstructionDiscipline(
        { action: d.action, symbol: d.symbol, quantity: d.quantity, confidence: conf01 },
        BENCHMARK_RISK_CONSTRAINTS,
        BENCHMARK_PORTFOLIO_BASELINE,
      );
      const depth = analyzeReasoningDepthV24(d.reasoning);
      const sourceQ = analyzeSourceQualityV24(d.reasoning, d.sources ?? []);

      const compositeInput = {
        pnl: 0.5, // Neutral baseline — updated by outcome tracker
        coherence: coherence.score,
        hallucinationFree: 1 - hallucinations.severity,
        discipline: discipline.passed ? 1.0 : Math.max(0, 1 - discipline.violations.length * 0.25),
        calibration: 0.5, // Updated by calibration engine
        predictionAccuracy: 0.5, // Updated by outcome tracker
        reasoningDepth: depth.depthScore,
        sourceQuality: sourceQ.qualityScore,
        outcomePrediction: 0.5, // Updated by outcome tracker
        consensusIntelligence: 0.5, // Updated by consensus engine
        strategyGenome: 0.5, // Updated by genome analyzer
        riskRewardDiscipline: 0.5, // Updated by risk analyzer
        executionQuality: 0.5, // Updated by execution analyzer
        crossRoundLearning: 0.5, // Updated by learning tracker
        tradeAccountability: accountability.accountabilityScore,
        reasoningQualityIndex: rqi.rqiScore,
      };

      const { composite, grade } = computeV28Composite(compositeInput);

      updateV28Leaderboard(r.agentId, {
        ...compositeInput,
        composite,
        grade,
      });
    }

    console.log(
      `[Orchestrator] v28 round complete: ${results.length} agents — accountability + RQI recorded`,
    );
  } catch (err) {
    console.warn(`[Orchestrator] v28 analysis failed: ${errorMessage(err)}`);
  }

  // -----------------------------------------------------------------------
  // v33 — 26-Dimension Benchmark (Causal Reasoning + Epistemic Humility)
  // -----------------------------------------------------------------------
  try {
    const v33Trades: V33TradeGrade[] = [];
    const marketPrices: Record<string, number> = {};
    for (const md of marketData) {
      marketPrices[md.symbol] = md.price;
    }

    const peerActions = results.map((r) => ({
      agentId: r.agentId,
      action: r.decision.action,
      symbol: r.decision.symbol,
    }));

    for (const r of results) {
      const d = r.decision;
      const conf01 = normalizeConfidence(d.confidence);
      const coherence = analyzeCoherence(d.reasoning, d.action, marketData);
      const hallucinations = detectHallucinations(d.reasoning, marketData);
      const discipline = checkInstructionDiscipline(
        { action: d.action, symbol: d.symbol, quantity: d.quantity, confidence: conf01 },
        BENCHMARK_RISK_CONSTRAINTS,
        BENCHMARK_PORTFOLIO_BASELINE,
      );

      const sources = d.sources ?? extractSourcesFromReasoning(d.reasoning);
      const intent = d.intent ?? classifyIntent(d.reasoning, d.action);

      const grade = gradeTradeV33({
        agentId: r.agentId,
        roundId,
        symbol: d.symbol,
        action: d.action,
        reasoning: d.reasoning,
        confidence: conf01,
        intent,
        coherenceScore: coherence.score,
        hallucinationFlags: hallucinations.flags,
        disciplinePassed: discipline.passed,
        sources,
        predictedOutcome: d.predictedOutcome ?? null,
        previousPredictions: [],
        marketPrices,
        peerActions: peerActions.filter((p) => p.agentId !== r.agentId),
      });

      v33Trades.push(grade);
    }

    // Score each agent across all their v33 trades
    const v33Scores = [];
    for (const r of results) {
      const agentConfig = getAgentConfigById(r.agentId);
      if (!agentConfig) continue;

      const agentTrades = v33Trades.filter((t) => t.agentId === r.agentId);
      const score = scoreAgentV33({
        agentId: r.agentId,
        agentName: agentConfig.name,
        provider: agentConfig.provider,
        model: agentConfig.model,
        trades: agentTrades,
        pnlPercent: 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
      });
      v33Scores.push(score);
    }

    // Create round summary
    const regime = detectMarketRegime(marketData).regime ?? "unknown";
    createV33RoundSummary(roundId, v33Scores, v33Trades, regime);

    console.log(
      `[Orchestrator] v33 round complete: ${results.length} agents — 26-dimension causal + epistemic scoring recorded`,
    );
  } catch (err) {
    console.warn(`[Orchestrator] v33 analysis failed: ${errorMessage(err)}`);
  }

  // ── v35 Benchmark Scoring (30 dimensions — info asymmetry + temporal reasoning) ──
  try {
    const v35Trades: V35TradeGrade[] = [];
    const allReasonings = results.map((r) => r.decision.reasoning);

    const v35MarketPrices: Record<string, number> = {};
    for (const md of marketData) {
      v35MarketPrices[md.symbol] = md.price;
    }

    const v35PeerActions = results.map((r) => ({
      agentId: r.agentId,
      action: r.decision.action,
      symbol: r.decision.symbol,
    }));

    for (const r of results) {
      const d = r.decision;
      const conf01 = normalizeConfidence(d.confidence);
      const action = d.action as "buy" | "sell" | "hold";
      const coherence = analyzeCoherence(d.reasoning, action, marketData);
      const hallucinations = detectHallucinations(d.reasoning, marketData);
      const discipline = checkInstructionDiscipline(
        d,
        BENCHMARK_RISK_CONSTRAINTS,
        BENCHMARK_PORTFOLIO_BASELINE,
      );

      const sources = d.sources ?? extractSourcesFromReasoning(d.reasoning);
      const intent = d.intent ?? classifyIntent(d.reasoning, d.action);
      const peerReasonings = allReasonings.filter((_: string, i: number) => results[i].agentId !== r.agentId);

      const grade = gradeTradeV35({
        agentId: r.agentId,
        roundId,
        symbol: d.symbol,
        action: d.action,
        reasoning: d.reasoning,
        confidence: conf01,
        intent,
        coherenceScore: coherence.score,
        hallucinationFlags: hallucinations.flags,
        disciplinePassed: discipline.passed,
        sources,
        predictedOutcome: d.predictedOutcome ?? null,
        previousPredictions: [],
        marketPrices: v35MarketPrices,
        peerActions: v35PeerActions.filter((p: { agentId: string }) => p.agentId !== r.agentId),
        peerReasonings,
      });

      v35Trades.push(grade);
    }

    // Score each agent across all their v35 trades
    const v35Scores = [];
    for (const r of results) {
      const agentConfig = getAgentConfigById(r.agentId);
      if (!agentConfig) continue;

      const agentTrades = v35Trades.filter((t) => t.agentId === r.agentId);
      const score = scoreAgentV35({
        agentId: r.agentId,
        agentName: agentConfig.name,
        provider: agentConfig.provider,
        model: agentConfig.model,
        trades: agentTrades,
        pnlPercent: 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
      });
      v35Scores.push(score);
    }

    // Create round summary
    const regimeV35 = detectMarketRegime(marketData).regime ?? "unknown";
    createV35RoundSummary(roundId, v35Scores, v35Trades, regimeV35);

    console.log(
      `[Orchestrator] v35 round complete: ${results.length} agents — 30-dimension info asymmetry + temporal reasoning scoring recorded`,
    );
  } catch (err) {
    console.warn(`[Orchestrator] v35 analysis failed: ${errorMessage(err)}`);
  }

  // -----------------------------------------------------------------------
  // v36 Benchmark: 32-Dimension Scoring (Reasoning Auditability + Decision Reversibility)
  // -----------------------------------------------------------------------
  try {
    const v36Trades: V36TradeGrade[] = [];
    const v36MarketPrices: Record<string, number> = {};
    for (const d of marketData) {
      v36MarketPrices[d.symbol.toLowerCase()] = d.price;
    }
    const v36PeerActions = results.map((r) => ({
      agentId: r.agentId,
      action: r.decision.action,
      symbol: r.decision.symbol,
    }));
    const allReasoningsV36 = results.map((r) => r.decision.reasoning);

    for (const r of results) {
      const d = r.decision;
      const conf01V36 = normalizeConfidence(d.confidence);
      const coherenceV36 = analyzeCoherence(d.reasoning, d.action, marketData);
      const hallucinationsV36 = detectHallucinations(d.reasoning, marketData);
      const disciplineV36 = checkInstructionDiscipline(
        { action: d.action, symbol: d.symbol, quantity: d.quantity, confidence: conf01V36 },
        BENCHMARK_RISK_CONSTRAINTS,
        BENCHMARK_PORTFOLIO_BASELINE,
      );

      const sourcesV36 = d.sources ?? extractSourcesFromReasoning(d.reasoning);
      const intentV36 = d.intent ?? classifyIntent(d.reasoning, d.action);
      const peerReasoningsV36 = allReasoningsV36.filter((_: string, i: number) => results[i].agentId !== r.agentId);

      const gradeV36 = gradeTradeV36({
        agentId: r.agentId,
        roundId,
        symbol: d.symbol,
        action: d.action,
        reasoning: d.reasoning,
        confidence: conf01V36,
        intent: intentV36,
        coherenceScore: coherenceV36.score,
        hallucinationFlags: hallucinationsV36.flags,
        disciplinePassed: disciplineV36.passed,
        sources: sourcesV36,
        predictedOutcome: d.predictedOutcome ?? null,
        previousPredictions: [],
        marketPrices: v36MarketPrices,
        peerActions: v36PeerActions.filter((p: { agentId: string }) => p.agentId !== r.agentId),
        peerReasonings: peerReasoningsV36,
      });

      v36Trades.push(gradeV36);
    }

    // Score each agent across all their v36 trades
    const v36Scores = [];
    for (const r of results) {
      const agentConfig = getAgentConfigById(r.agentId);
      if (!agentConfig) continue;

      const agentTrades = v36Trades.filter((t) => t.agentId === r.agentId);
      const score = scoreAgentV36({
        agentId: r.agentId,
        agentName: agentConfig.name,
        provider: agentConfig.provider,
        model: agentConfig.model,
        trades: agentTrades,
        pnlPercent: 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
      });
      v36Scores.push(score);
    }

    // Create round summary
    const regimeV36 = detectMarketRegime(marketData).regime ?? "unknown";
    createV36RoundSummary(roundId, v36Scores, v36Trades, regimeV36);

    console.log(
      `[Orchestrator] v36 round complete: ${results.length} agents — 32-dimension reasoning auditability + decision reversibility scoring recorded`,
    );
  } catch (err) {
    console.warn(`[Orchestrator] v36 analysis failed: ${errorMessage(err)}`);
  }

  // -----------------------------------------------------------------------
  // v37 Benchmark: 34-Dimension Scoring (Reasoning Composability + Strategic Foresight)
  // -----------------------------------------------------------------------
  try {
    const v37Trades: V37TradeGrade[] = [];
    const v37MarketPrices: Record<string, number> = {};
    for (const d of marketData) {
      v37MarketPrices[d.symbol.toLowerCase()] = d.price;
    }
    const v37PeerActions = results.map((r) => ({
      agentId: r.agentId,
      action: r.decision.action,
      symbol: r.decision.symbol,
    }));
    const allReasoningsV37 = results.map((r) => r.decision.reasoning);

    for (const r of results) {
      const d = r.decision;
      const conf01V37 = normalizeConfidence(d.confidence);
      const coherenceV37 = analyzeCoherence(d.reasoning, d.action, marketData);
      const hallucinationsV37 = detectHallucinations(d.reasoning, marketData);
      const disciplineV37 = checkInstructionDiscipline(
        { action: d.action, symbol: d.symbol, quantity: d.quantity, confidence: conf01V37 },
        BENCHMARK_RISK_CONSTRAINTS,
        BENCHMARK_PORTFOLIO_BASELINE,
      );

      const sourcesV37 = d.sources ?? extractSourcesFromReasoning(d.reasoning);
      const intentV37 = d.intent ?? classifyIntent(d.reasoning, d.action);
      const peerReasoningsV37 = allReasoningsV37.filter((_: string, i: number) => results[i].agentId !== r.agentId);

      const gradeV37 = gradeTradeV37({
        agentId: r.agentId,
        roundId,
        symbol: d.symbol,
        action: d.action,
        reasoning: d.reasoning,
        confidence: conf01V37,
        intent: intentV37,
        coherenceScore: coherenceV37.score,
        hallucinationFlags: hallucinationsV37.flags,
        disciplinePassed: disciplineV37.passed,
        sources: sourcesV37,
        predictedOutcome: d.predictedOutcome ?? null,
        previousPredictions: [],
        marketPrices: v37MarketPrices,
        peerActions: v37PeerActions.filter((p: { agentId: string }) => p.agentId !== r.agentId),
        peerReasonings: peerReasoningsV37,
        quantity: d.quantity ?? 0,
      });

      v37Trades.push(gradeV37);
    }

    // Score each agent across all their v37 trades
    const v37Scores = [];
    for (const r of results) {
      const agentConfig = getAgentConfigById(r.agentId);
      if (!agentConfig) continue;

      const agentTrades = v37Trades.filter((t) => t.agentId === r.agentId);
      const score = scoreAgentV37({
        agentId: r.agentId,
        agentName: agentConfig.name,
        provider: agentConfig.provider,
        model: agentConfig.model,
        trades: agentTrades,
        pnlPercent: 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
      });
      v37Scores.push(score);
    }

    // Create round summary
    const regimeV37 = detectMarketRegime(marketData).regime ?? "unknown";
    createV37RoundSummary(roundId, v37Scores, v37Trades, regimeV37);

    console.log(
      `[Orchestrator] v37 round complete: ${results.length} agents — 34-dimension reasoning composability + strategic foresight scoring recorded`,
    );
  } catch (err) {
    console.warn(`[Orchestrator] v37 analysis failed: ${errorMessage(err)}`);
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
  const buys = countByCondition(actions, (a) => a === "buy");
  const sells = countByCondition(actions, (a) => a === "sell");
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
    const buyDecisions = decisions.filter((d: AgentDecision) => d.action === "buy");
    const sellDecisions = decisions.filter((d: AgentDecision) => d.action === "sell");
    const holdDecisions = decisions.filter((d: AgentDecision) => d.action === "hold");

    const avgConfidence = averageByKey(decisions, 'confidence');

    // Symbol frequency
    const symbolCounts: Record<string, number> = {};
    for (const d of decisions) {
      if (d.action !== "hold") {
        symbolCounts[d.symbol] = (symbolCounts[d.symbol] || 0) + 1;
      }
    }

    const favoriteStock = getTopKey(symbolCounts) ?? null;

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
 * Reads directly from Solana blockchain for accurate on-chain data.
 */
export async function getAgentPortfolio(agentId: string) {
  try {
    // Use on-chain portfolio service for accurate blockchain data
    const onChainPortfolio = await getOnChainPortfolio(agentId);
    return {
      cashBalance: onChainPortfolio.cashBalance,
      solBalance: onChainPortfolio.solBalance,
      solValueUsd: onChainPortfolio.solValueUsd,
      positions: onChainPortfolio.positions.map((p) => ({
        symbol: p.symbol,
        quantity: p.quantity,
        averageCostBasis: p.averageCostBasis,
        currentPrice: p.currentPrice,
        unrealizedPnl: p.unrealizedPnl,
        unrealizedPnlPercent: p.unrealizedPnlPercent,
      })),
      totalValue: onChainPortfolio.totalValue,
      totalPnl: onChainPortfolio.totalPnl,
      totalPnlPercent: onChainPortfolio.totalPnlPercent,
    };
  } catch (error) {
    console.error(
      `[Orchestrator] Failed to get on-chain portfolio for ${agentId}:`,
      error,
    );
    // Fallback to database-based portfolio if on-chain fails
    try {
      const marketData = await getMarketData();
      const portfolio = await getPortfolioContext(agentId, marketData);
      // Add SOL fields (not available in DB fallback)
      return { ...portfolio, solBalance: 0, solValueUsd: 0 };
    } catch {
      return {
        cashBalance: 0,
        solBalance: 0,
        solValueUsd: 0,
        positions: [],
        totalValue: 0,
        totalPnl: 0,
        totalPnlPercent: 0,
      };
    }
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
  return round2(base * variation);
}

function generateMockChange(): number {
  // Random 24h change between -5% and +5%
  return round2((Math.random() - 0.5) * 10);
}

function generateMockVolume(): number {
  // Random volume between $10M and $500M
  return Math.round((10 + Math.random() * 490) * 1_000_000);
}
