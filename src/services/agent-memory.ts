/**
 * Agent Learning & Memory System
 *
 * Gives AI trading agents persistent memory and the ability to learn from
 * their past trades. Each agent maintains a knowledge base of:
 *
 * 1. Trade Outcomes — what they bought/sold and what happened
 * 2. Pattern Recognition — recurring market patterns they've seen
 * 3. Lessons Learned — extracted insights from wins and losses
 * 4. Stock Profiles — per-stock notes and observations
 * 5. Strategy Effectiveness — which approaches worked in which conditions
 * 6. Peer Analysis — observations about other agents' behavior
 *
 * The memory system generates a "memory prompt" that gets injected into
 * the agent's context before each trading decision, making them smarter
 * over time.
 *
 * This is a KEY differentiator: our agents don't just trade — they LEARN.
 */

import { db } from "../db/index.ts";
import { agentDecisions } from "../db/schema/agent-decisions.ts";
import { trades } from "../db/schema/trades.ts";
import { eq, and, gte } from "drizzle-orm";
import { round2, countByCondition } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Trade Magnitude Thresholds
 *
 * These thresholds classify trade outcomes by P&L magnitude for lesson extraction
 * and memory classification. Separating "big" from "small" wins/losses helps agents
 * recognize which patterns led to meaningful results vs minor noise.
 */

/**
 * Minimum absolute P&L percentage to classify as "big winner" or "big loser"
 * @example
 * - Trade with +7% P&L → "big winner" (magnitude 7 > 5)
 * - Trade with -8% P&L → "big loser" (magnitude 8 > 5)
 * - Trade with +3% P&L → "small winner" (magnitude 3 <= 5)
 */
const TRADE_MAGNITUDE_BIG_THRESHOLD = 5;

/**
 * Win Rate Thresholds for Performance Classification
 *
 * These thresholds determine when agent performance is classified as "strong recent",
 * "weak recent", "strong overall", or "weak overall". Used for generating lessons
 * and adjusting agent confidence in their own abilities.
 */

/**
 * Win rate threshold (as decimal) for "strong recent performance" classification
 * @example
 * - Last 5 trades: 4 wins / 5 total = 0.80 win rate → "strong recent" (0.80 > 0.6)
 * - Last 5 trades: 3 wins / 5 total = 0.60 win rate → borderline
 */
const WIN_RATE_STRONG_RECENT_THRESHOLD = 0.6;

/**
 * Win rate threshold (as decimal) for "weak recent performance" classification
 * @example
 * - Last 5 trades: 1 win / 5 total = 0.20 win rate → "weak recent" (0.20 < 0.4)
 * - Last 5 trades: 2 wins / 5 total = 0.40 win rate → borderline
 */
const WIN_RATE_WEAK_RECENT_THRESHOLD = 0.4;

/**
 * Win rate threshold (as percentage) for "strong overall track record" lesson
 * @example
 * - 58% overall win rate → "strong track record" (58 > 55)
 * - 52% overall win rate → no lesson (within normal range)
 */
const WIN_RATE_STRONG_OVERALL_THRESHOLD = 55;

/**
 * Win rate threshold (as percentage) for "below-average performance" lesson
 * @example
 * - 42% overall win rate → "below-average" (42 < 45)
 * - 48% overall win rate → no lesson (within normal range)
 */
const WIN_RATE_WEAK_OVERALL_THRESHOLD = 45;

/**
 * Win rate threshold (as percentage) for individual stock "strength" classification
 * @example
 * - AAPLx: 75% win rate over 8 trades → "strength" (75 > 70)
 * - TSLAx: 65% win rate over 6 trades → no special lesson
 */
const WIN_RATE_STOCK_STRENGTH_THRESHOLD = 70;

/**
 * Win rate threshold (as percentage) for individual stock "problematic" classification
 * @example
 * - GOOGx: 25% win rate over 5 trades → "problematic" (25 < 30)
 * - METAx: 35% win rate over 4 trades → no special lesson
 */
const WIN_RATE_STOCK_WEAKNESS_THRESHOLD = 30;

/**
 * Price Level Clustering Threshold
 *
 * Controls how close two prices must be (as fraction of price) to be considered
 * the same support/resistance level. Prevents creating redundant price levels
 * for minor price variations.
 */

/**
 * Maximum price distance (as fraction) to cluster prices as same level
 * @example
 * - Existing level: $100, New trade: $101 → |101-100|/100 = 0.01 < 0.02 → same level
 * - Existing level: $100, New trade: $103 → |103-100|/100 = 0.03 > 0.02 → new level
 * - 2% threshold works for most stock prices (tight enough to be meaningful, loose enough to cluster)
 */
const PRICE_LEVEL_PROXIMITY_THRESHOLD = 0.02;

/**
 * Pattern Detection Thresholds
 *
 * These thresholds control when trading patterns (streaks, timing edges, sector rotation,
 * confidence calibration) are detected and stored in agent memory. Higher thresholds
 * require stronger evidence before recognizing a pattern.
 */

/**
 * Minimum consecutive wins to classify as a "win streak" pattern
 * @example
 * - 3 consecutive wins on NVDAx → win streak pattern created
 * - 2 consecutive wins → no pattern yet (not enough evidence)
 */
const STREAK_MIN_CONSECUTIVE_WINS = 3;

/**
 * Minimum number of recent trades to analyze for sentiment classification
 * @example
 * - 3 recent trades → sufficient to classify as bullish/bearish/neutral
 * - 2 recent trades → not enough data for reliable sentiment
 */
const SENTIMENT_MIN_TRADES = 3;

/**
 * Minimum win rate (as percentage) for timing pattern detection
 * @example
 * - Short-term trades (< 2h): 65% win rate → timing edge pattern created (65 > 60)
 * - Medium-term trades (2-24h): 58% win rate → no pattern (below threshold)
 */
const TIMING_PATTERN_WIN_RATE_THRESHOLD = 60;



/**
 * Memory Retention Limits
 *
 * These limits control how many items are kept in various memory structures
 * to prevent unbounded memory growth while retaining the most relevant information.
 */

/**
 * Maximum number of recent trades to keep in memory
 * Already defined at line 181: const MAX_TRADE_MEMORIES = 200;
 */

/**
 * Maximum number of patterns to keep in memory
 * Already defined at line 182: const MAX_PATTERNS = 50;
 */

/**
 * Maximum number of key lessons to keep in memory
 * Already defined at line 183: const MAX_KEY_LESSONS = 20;
 */

/**
 * Maximum number of notes per stock profile
 * @example
 * - Stock has 25 notes accumulated → trim to most recent 20
 */
const MAX_STOCK_NOTES = 20;

/**
 * Maximum number of price levels to track per stock
 * @example
 * - Stock has 15 support/resistance levels → keep 10 strongest
 */
const MAX_PRICE_LEVELS = 10;

/**
 * Maximum number of peer observations to keep per agent
 * @example
 * - Recorded 60 observations about GPT MomentumBot → keep most recent 50
 */
const MAX_PEER_OBSERVATIONS = 50;

/**
 * Memory Display Limit Constants
 *
 * These constants control how many items are displayed in memory prompt summaries
 * to prevent overwhelming agents with excessive historical context.
 */

/**
 * Maximum active patterns to display in memory prompt.
 * Only patterns with 2+ occurrences and >50% success rate are shown.
 * @example
 * - Agent has 12 active patterns → show top 5 most successful
 */
const ACTIVE_PATTERNS_DISPLAY_LIMIT = 5;

/**
 * Maximum stock profiles to display in memory prompt.
 * Profiles for stocks with 2+ trades, sorted by trade count (most traded first).
 * @example
 * - Agent has traded 15 different stocks → show 8 most frequently traded
 */
const RELEVANT_STOCK_PROFILES_DISPLAY_LIMIT = 8;

/**
 * Text Truncation & Lookback Window Constants
 *
 * These constants control how much text and how many historical records
 * are included in agent memory prompts and lessons, balancing context
 * richness against prompt verbosity.
 */

/**
 * Maximum characters of trade reasoning text shown in win/loss lessons.
 * Captures the key thesis without overwhelming the lesson with the full reasoning.
 * @example
 * - Reasoning is 500 chars → show first 100 chars in lesson summary
 */
const REASONING_TEXT_DISPLAY_LENGTH = 100;

/**
 * Maximum characters of lesson text shown in recent trade summaries.
 * Short enough to fit in a compact trade line, long enough to convey the lesson.
 * @example
 * - Lesson is 200 chars → show first 60 chars in trade line
 */
const LESSON_TEXT_DISPLAY_LENGTH = 60;

/**
 * Number of recent trades examined for stock-level sentiment updates.
 * Uses the last N completed trades on a symbol to determine bullish/bearish/neutral.
 * @example
 * - 20 trades on AAPL → examine last 5 to set current sentiment
 */
const STOCK_SENTIMENT_RECENT_TRADES = 5;

/**
 * Number of recent completed trades examined for sector rotation detection.
 * Larger window catches longer-term sector trends vs short-term noise.
 * @example
 * - Agent has 100 trades → analyze last 30 for sector performance patterns
 */
const SECTOR_ROTATION_LOOKBACK_TRADES = 30;

/**
 * Number of recent trades shown in memory prompt (Section 5: Recent Trades).
 * Provides recency context for what the agent has been doing lately.
 * @example
 * - Agent has 50 trades → show last 5 for immediate context
 */
const MEMORY_PROMPT_RECENT_TRADES = 5;

/**
 * Number of recent trades returned in the getAgentMemory API response.
 * Larger than MEMORY_PROMPT_RECENT_TRADES since API consumers may want more detail.
 * @example
 * - Agent has 50 trades → return last 10 in API response
 */
const AGENT_MEMORY_API_RECENT_TRADES = 10;

/**
 * Database Query Limit for Memory Computation
 *
 * Maximum number of recent decisions and trades fetched from the database
 * when building agent memory (getAgentMemoryData). Controls how much
 * historical data is loaded into memory before filtering/analysis.
 *
 * Large enough to cover ~3-4 rounds of agent activity (each round has
 * ~10-20 decisions), while staying well within DB query performance limits.
 *
 * @example
 * - Agent has 800 decisions in DB → load last 200 for memory computation
 * - Agent has 50 decisions in DB → load all 50 (limit not reached)
 */
const MEMORY_COMPUTATION_QUERY_LIMIT = 200;

/**
 * Minimum Occurrence Thresholds
 *
 * These thresholds control when data becomes statistically significant enough
 * to generate lessons or classify patterns.
 */

/**
 * Minimum total trades for overall performance lesson generation
 * @example
 * - 12 total trades → can generate "strong track record" or "below-average" lesson
 * - 8 total trades → not enough data for overall performance assessment
 */
const MIN_TRADES_FOR_OVERALL_LESSON = 10;

/**
 * Minimum trades on a specific stock for stock-specific lesson generation
 * @example
 * - NVDAx: 6 trades → can generate "strength" or "problematic" lesson
 * - AAPLx: 3 trades → not enough data for stock-specific lesson
 */
const MIN_TRADES_FOR_STOCK_LESSON = 5;

/**
 * Minimum trades in a sector for sector performance classification
 * @example
 * - Tech sector: 5 trades → can classify as hot/cold sector
 * - Healthcare sector: 2 trades → not enough data
 */
const MIN_TRADES_FOR_SECTOR_CLASSIFICATION = 3;

/**
 * Minimum pattern occurrences for pattern lesson generation
 * @example
 * - Win streak pattern: 4 occurrences → include in key lessons (4 >= 3)
 * - Timing pattern: 2 occurrences → not included (not enough evidence)
 */
const MIN_PATTERN_OCCURRENCES_FOR_LESSON = 3;

/**
 * Minimum pattern success rate (as percentage) for pattern lesson generation
 * @example
 * - Sector rotation pattern: 65% success rate → include in lessons (65 > 60)
 * - Confidence pattern: 55% success rate → exclude (below threshold)
 */
const MIN_PATTERN_SUCCESS_RATE_FOR_LESSON = 60;


/**
 * Minimum total closed trades for confidence calibration pattern detection
 * @example
 * - 16 closed trades → can analyze calibration (16 >= 15)
 * - 12 closed trades → not enough data for calibration pattern
 */
const MIN_TRADES_FOR_CALIBRATION_PATTERN = 15;

/**
 * Minimum closed trades required for timing pattern detection (detectTimingPattern).
 * Needs enough trades across short/medium/long-term holding buckets to produce
 * statistically meaningful per-bucket win rates.
 * @example
 * - 12 closed trades → can analyze timing pattern (12 >= 10)
 * - 7 closed trades → not enough data across holding period buckets
 */
const MIN_TRADES_FOR_TIMING_PATTERN = 10;

/**
 * Minimum recent closed trades required for sector rotation detection (detectSectorRotation).
 * Applies to the SECTOR_ROTATION_LOOKBACK_TRADES window, not all trades, to detect
 * recent sector shifts rather than historical averages.
 * @example
 * - 15 recent trades in window → can detect sector rotation (15 >= 10)
 * - 8 recent trades in window → not enough data for rotation signal
 */
const MIN_TRADES_FOR_SECTOR_ROTATION_DETECTION = 10;

/**
 * Minimum pattern occurrences to display pattern in memory prompt (Section 3: Active Patterns).
 * Lower than MIN_PATTERN_OCCURRENCES_FOR_LESSON (3) so patterns appear in context before
 * they graduate to key lessons — gives agents early signal of emerging patterns.
 * @example
 * - Timing pattern: 2 occurrences → shown in memory prompt (2 >= 2)
 * - New pattern: 1 occurrence → too early to include (noise vs signal)
 */
const MIN_PATTERN_OCCURRENCES_FOR_DISPLAY = 2;

/**
 * Minimum pattern success rate (as percentage) to display in memory prompt.
 * Lower than MIN_PATTERN_SUCCESS_RATE_FOR_LESSON (60%) to show patterns with modest
 * evidence, while still filtering out below-chance patterns.
 * @example
 * - Sector pattern: 55% success rate → shown in prompt (55 > 50)
 * - Weak pattern: 48% success rate → below chance threshold, excluded
 */
const MIN_PATTERN_SUCCESS_RATE_FOR_DISPLAY = 50;


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TradeMemory {
  /** Trade ID or decision ID */
  id: string;
  /** Stock symbol */
  symbol: string;
  /** Buy or sell */
  action: "buy" | "sell";
  /** Entry price */
  entryPrice: number;
  /** Exit price (null if position still open) */
  exitPrice: number | null;
  /** P&L in USDC (null if still open) */
  pnl: number | null;
  /** P&L percentage (null if still open) */
  pnlPercent: number | null;
  /** Agent's original reasoning */
  reasoning: string;
  /** Original confidence */
  confidence: number;
  /** What the agent learned from this trade */
  lesson: string | null;
  /** Market conditions at the time */
  marketConditions: string;
  /** Holding period in hours (null if still open) */
  holdingHours: number | null;
  /** Was this trade part of a consensus? */
  wasConsensus: boolean;
  /** Timestamp */
  timestamp: string;
}

export interface PatternMemory {
  /** Unique pattern ID */
  id: string;
  /** Pattern name (e.g., "tech-selloff-recovery") */
  name: string;
  /** Description of the pattern */
  description: string;
  /** Symbols this pattern involves */
  symbols: string[];
  /** How many times this pattern has been observed */
  occurrences: number;
  /** Success rate when trading this pattern */
  successRate: number;
  /** Average return when this pattern plays out */
  avgReturn: number;
  /** Conditions that trigger this pattern */
  triggers: string[];
  /** Recommended action when pattern is detected */
  recommendedAction: "buy" | "sell" | "hold";
  /** Last time this pattern was observed */
  lastSeen: string;
}

export interface StockProfile {
  /** Stock symbol */
  symbol: string;
  /** Agent's notes about this stock */
  notes: string[];
  /** Number of times traded */
  tradeCount: number;
  /** Win rate with this stock */
  winRate: number;
  /** Average return on this stock */
  avgReturn: number;
  /** Best trade result (%) */
  bestTrade: number;
  /** Worst trade result (%) */
  worstTrade: number;
  /** Learned price levels (support/resistance the agent has observed) */
  priceLevels: Array<{
    type: "support" | "resistance";
    price: number;
    strength: number;
    lastTested: string;
  }>;
  /** Agent's overall sentiment toward this stock */
  sentiment: "bullish" | "bearish" | "neutral";
  /** Last updated */
  lastUpdated: string;
}

export interface StrategyMemory {
  /** Strategy name */
  name: string;
  /** Description */
  description: string;
  /** When this strategy works well */
  goodConditions: string[];
  /** When this strategy fails */
  badConditions: string[];
  /** Times used */
  timesUsed: number;
  /** Win rate */
  winRate: number;
  /** Average return */
  avgReturn: number;
  /** Current status */
  status: "active" | "paused" | "deprecated";
}

export interface PeerObservation {
  /** Other agent's ID */
  peerId: string;
  /** What this agent has noticed about the peer */
  observations: string[];
  /** How often they agree with this peer */
  agreementRate: number;
  /** When they tend to disagree */
  disagreementPatterns: string[];
  /** Perceived strengths */
  perceivedStrengths: string[];
  /** Perceived weaknesses */
  perceivedWeaknesses: string[];
}

export interface AgentMemoryState {
  /** Agent this memory belongs to */
  agentId: string;
  /** All trade memories (capped at 200) */
  tradeMemories: TradeMemory[];
  /** Detected patterns */
  patterns: PatternMemory[];
  /** Per-stock profiles */
  stockProfiles: Map<string, StockProfile>;
  /** Strategy effectiveness */
  strategies: StrategyMemory[];
  /** Observations about other agents */
  peerObservations: Map<string, PeerObservation>;
  /** Key lessons (top insights distilled from all memories) */
  keyLessons: string[];
  /** Total trades analyzed */
  totalTradesAnalyzed: number;
  /** Overall win rate */
  overallWinRate: number;
  /** Best performing sector */
  bestSector: string | null;
  /** Worst performing sector */
  worstSector: string | null;
  /** Last memory update */
  lastUpdated: string;
}

// ---------------------------------------------------------------------------
// In-memory storage (one per agent)
// ---------------------------------------------------------------------------

const agentMemories = new Map<string, AgentMemoryState>();

const MAX_TRADE_MEMORIES = 200;
const MAX_PATTERNS = 50;
const MAX_KEY_LESSONS = 20;

// ---------------------------------------------------------------------------
// Sector mapping (same as consensus engine)
// ---------------------------------------------------------------------------

const STOCK_SECTORS: Record<string, string> = {
  AAPLx: "tech",
  AMZNx: "tech",
  GOOGLx: "tech",
  METAx: "tech",
  MSFTx: "tech",
  NVDAx: "tech",
  TSLAx: "auto",
  SPYx: "index",
  QQQx: "index",
  COINx: "crypto",
  CRCLx: "crypto",
  MSTRx: "crypto",
  AVGOx: "tech",
  JPMx: "finance",
  HOODx: "finance",
  LLYx: "healthcare",
  CRMx: "tech",
  NFLXx: "media",
  PLTRx: "tech",
  GMEx: "retail",
};

// ---------------------------------------------------------------------------
// Memory Initialization
// ---------------------------------------------------------------------------

function getOrCreateMemory(agentId: string): AgentMemoryState {
  let memory = agentMemories.get(agentId);
  if (!memory) {
    memory = {
      agentId,
      tradeMemories: [],
      patterns: [],
      stockProfiles: new Map(),
      strategies: [],
      peerObservations: new Map(),
      keyLessons: [],
      totalTradesAnalyzed: 0,
      overallWinRate: 0,
      bestSector: null,
      worstSector: null,
      lastUpdated: new Date().toISOString(),
    };
    agentMemories.set(agentId, memory);
  }
  return memory;
}

// ---------------------------------------------------------------------------
// Trade Memory Recording
// ---------------------------------------------------------------------------

/**
 * Record a new trade outcome in the agent's memory.
 * Automatically extracts lessons and updates stock profiles.
 */
export function recordTradeMemory(
  agentId: string,
  trade: Omit<TradeMemory, "lesson" | "marketConditions">,
  marketConditions?: string,
): void {
  const memory = getOrCreateMemory(agentId);

  // Extract lesson from the trade outcome
  const lesson = extractLesson(trade);

  const tradeMemory: TradeMemory = {
    ...trade,
    lesson,
    marketConditions: marketConditions || "unknown",
  };

  // Add to memories (FIFO cap)
  memory.tradeMemories.push(tradeMemory);
  if (memory.tradeMemories.length > MAX_TRADE_MEMORIES) {
    memory.tradeMemories = memory.tradeMemories.slice(-MAX_TRADE_MEMORIES);
  }

  // Update stock profile
  updateStockProfile(memory, tradeMemory);

  // Update overall stats
  updateOverallStats(memory);

  // Check for pattern formation
  detectPatterns(memory);

  // Update key lessons
  updateKeyLessons(memory);

  memory.lastUpdated = new Date().toISOString();
}

/**
 * Extract a lesson from a trade outcome.
 */
function extractLesson(trade: Omit<TradeMemory, "lesson" | "marketConditions">): string {
  if (trade.pnl === null) return "Position still open — outcome pending";

  const isWin = trade.pnl > 0;
  const magnitude =
    trade.pnlPercent !== null ? Math.abs(trade.pnlPercent) : 0;

  if (isWin && magnitude > TRADE_MAGNITUDE_BIG_THRESHOLD) {
    return `Strong win on ${trade.symbol} (${trade.action}): +${magnitude.toFixed(1)}%. Confidence was ${trade.confidence}%. ${trade.reasoning.slice(0, REASONING_TEXT_DISPLAY_LENGTH)}`;
  }
  if (isWin && magnitude <= TRADE_MAGNITUDE_BIG_THRESHOLD) {
    return `Small win on ${trade.symbol} (${trade.action}): +${magnitude.toFixed(1)}%. The thesis was correct but upside was limited.`;
  }
  if (!isWin && magnitude > TRADE_MAGNITUDE_BIG_THRESHOLD) {
    return `Significant loss on ${trade.symbol} (${trade.action}): -${magnitude.toFixed(1)}%. Need to review: was the thesis wrong or was timing off? Original reasoning: ${trade.reasoning.slice(0, REASONING_TEXT_DISPLAY_LENGTH)}`;
  }
  if (!isWin && magnitude <= TRADE_MAGNITUDE_BIG_THRESHOLD) {
    return `Small loss on ${trade.symbol} (${trade.action}): -${magnitude.toFixed(1)}%. Minor setback, thesis may still play out over longer timeframe.`;
  }

  return `Breakeven trade on ${trade.symbol}`;
}

/**
 * Update the stock-specific profile based on a new trade.
 */
function updateStockProfile(
  memory: AgentMemoryState,
  trade: TradeMemory,
): void {
  let profile = memory.stockProfiles.get(trade.symbol);

  if (!profile) {
    profile = {
      symbol: trade.symbol,
      notes: [],
      tradeCount: 0,
      winRate: 0,
      avgReturn: 0,
      bestTrade: 0,
      worstTrade: 0,
      priceLevels: [],
      sentiment: "neutral",
      lastUpdated: new Date().toISOString(),
    };
    memory.stockProfiles.set(trade.symbol, profile);
  }

  profile.tradeCount++;

  if (trade.pnlPercent !== null) {
    // Update win rate
    const wins = memory.tradeMemories.filter(
      (t) =>
        t.symbol === trade.symbol && t.pnl !== null && t.pnl > 0,
    ).length;
    const total = memory.tradeMemories.filter(
      (t) => t.symbol === trade.symbol && t.pnl !== null,
    ).length;
    profile.winRate = total > 0 ? (wins / total) * 100 : 0;

    // Update avg return
    const returns = memory.tradeMemories
      .filter(
        (t) => t.symbol === trade.symbol && t.pnlPercent !== null,
      )
      .map((t) => t.pnlPercent!);
    profile.avgReturn =
      returns.length > 0 ? returns.reduce((s, r) => s + r, 0) / returns.length : 0;

    // Update best/worst
    if (trade.pnlPercent > profile.bestTrade) {
      profile.bestTrade = trade.pnlPercent;
    }
    if (trade.pnlPercent < profile.worstTrade) {
      profile.worstTrade = trade.pnlPercent;
    }
  }

  // Update price levels
  if (trade.entryPrice > 0) {
    updatePriceLevels(profile, trade);
  }

  // Update sentiment based on recent performance
  const recentTrades = memory.tradeMemories
    .filter((t) => t.symbol === trade.symbol && t.pnl !== null)
    .slice(-STOCK_SENTIMENT_RECENT_TRADES);
  const recentWins = countByCondition(recentTrades, (t) => t.pnl! > 0);
  const recentTotal = recentTrades.length;

  if (recentTotal >= SENTIMENT_MIN_TRADES) {
    profile.sentiment =
      recentWins / recentTotal > WIN_RATE_STRONG_RECENT_THRESHOLD
        ? "bullish"
        : recentWins / recentTotal < WIN_RATE_WEAK_RECENT_THRESHOLD
          ? "bearish"
          : "neutral";
  }

  // Add note if lesson exists
  if (trade.lesson) {
    profile.notes.push(trade.lesson);
    if (profile.notes.length > MAX_STOCK_NOTES) {
      profile.notes = profile.notes.slice(-MAX_STOCK_NOTES);
    }
  }

  profile.lastUpdated = new Date().toISOString();
}

/**
 * Track support/resistance levels from trade prices.
 */
function updatePriceLevels(profile: StockProfile, trade: TradeMemory): void {
  const price = trade.action === "buy" ? trade.entryPrice : trade.exitPrice;
  if (!price) return;

  // Check if this price is near an existing level (within 2%)
  const existingLevel = profile.priceLevels.find(
    (l) => Math.abs(l.price - price) / price < PRICE_LEVEL_PROXIMITY_THRESHOLD,
  );

  if (existingLevel) {
    existingLevel.strength++;
    existingLevel.lastTested = trade.timestamp;
    // If the price bounced, it's support; if it rejected, it's resistance
    if (trade.action === "buy" && (trade.pnl === null || trade.pnl >= 0)) {
      existingLevel.type = "support";
    } else if (trade.action === "sell" && (trade.pnl === null || trade.pnl >= 0)) {
      existingLevel.type = "resistance";
    }
  } else {
    profile.priceLevels.push({
      type: trade.action === "buy" ? "support" : "resistance",
      price: round2(price),
      strength: 1,
      lastTested: trade.timestamp,
    });

    // Keep only top 10 strongest levels
    if (profile.priceLevels.length > MAX_PRICE_LEVELS) {
      profile.priceLevels.sort((a, b) => b.strength - a.strength);
      profile.priceLevels = profile.priceLevels.slice(0, MAX_PRICE_LEVELS);
    }
  }
}

// ---------------------------------------------------------------------------
// Pattern Detection
// ---------------------------------------------------------------------------

/**
 * Detect recurring patterns in the agent's trade history.
 */
function detectPatterns(memory: AgentMemoryState): void {
  const trades = memory.tradeMemories;
  if (trades.length < MIN_TRADES_FOR_OVERALL_LESSON) return;

  // Pattern 1: Consecutive wins/losses on same stock
  detectStreakPattern(memory);

  // Pattern 2: Time-of-day patterns (if holding periods are consistent)
  detectTimingPattern(memory);

  // Pattern 3: Sector rotation patterns
  detectSectorRotation(memory);

  // Pattern 4: Confidence-outcome correlation
  detectConfidencePattern(memory);

  // Cap patterns
  if (memory.patterns.length > MAX_PATTERNS) {
    memory.patterns.sort((a, b) => b.occurrences - a.occurrences);
    memory.patterns = memory.patterns.slice(0, MAX_PATTERNS);
  }
}

function detectStreakPattern(memory: AgentMemoryState): void {
  const closedTrades = memory.tradeMemories.filter((t) => t.pnl !== null);
  if (closedTrades.length < MIN_TRADES_FOR_STOCK_LESSON) return;

  // Group by symbol
  const bySymbol = new Map<string, TradeMemory[]>();
  for (const trade of closedTrades) {
    if (!bySymbol.has(trade.symbol)) {
      bySymbol.set(trade.symbol, []);
    }
    bySymbol.get(trade.symbol)!.push(trade);
  }

  for (const [symbol, symbolTrades] of bySymbol.entries()) {
    if (symbolTrades.length < MIN_TRADES_FOR_SECTOR_CLASSIFICATION) continue;

    // Count consecutive wins
    let maxWinStreak = 0;
    let currentStreak = 0;
    for (const t of symbolTrades) {
      if (t.pnl! > 0) {
        currentStreak++;
        maxWinStreak = Math.max(maxWinStreak, currentStreak);
      } else {
        currentStreak = 0;
      }
    }

    if (maxWinStreak >= STREAK_MIN_CONSECUTIVE_WINS) {
      const patternId = `win-streak-${symbol}`;
      const existing = memory.patterns.find((p) => p.id === patternId);

      if (existing) {
        existing.occurrences = maxWinStreak;
        existing.lastSeen = new Date().toISOString();
      } else {
        memory.patterns.push({
          id: patternId,
          name: `${symbol} Win Streak`,
          description: `${maxWinStreak} consecutive profitable trades on ${symbol}. Consider continuing this streak.`,
          symbols: [symbol],
          occurrences: maxWinStreak,
          successRate:
            (countByCondition(symbolTrades, (t) => t.pnl! > 0) / symbolTrades.length) * 100,
          avgReturn:
            symbolTrades.reduce((s, t) => s + (t.pnlPercent || 0), 0) /
            symbolTrades.length,
          triggers: ["continuation of winning streak"],
          recommendedAction: "buy",
          lastSeen: new Date().toISOString(),
        });
      }
    }
  }
}

function detectTimingPattern(memory: AgentMemoryState): void {
  const closedTrades = memory.tradeMemories.filter(
    (t) => t.pnl !== null && t.holdingHours !== null,
  );
  if (closedTrades.length < MIN_TRADES_FOR_TIMING_PATTERN) return;

  // Categorize by holding period
  const shortTerm = closedTrades.filter((t) => t.holdingHours! < 2);
  const mediumTerm = closedTrades.filter(
    (t) => t.holdingHours! >= 2 && t.holdingHours! < 24,
  );
  const longTerm = closedTrades.filter((t) => t.holdingHours! >= 24);

  const categories = [
    { name: "short-term", trades: shortTerm, label: "< 2 hours" },
    { name: "medium-term", trades: mediumTerm, label: "2-24 hours" },
    { name: "long-term", trades: longTerm, label: "24+ hours" },
  ];

  let bestCategory: (typeof categories)[0] | null = null;
  let bestWinRate = 0;

  for (const cat of categories) {
    if (cat.trades.length < MIN_TRADES_FOR_SECTOR_CLASSIFICATION) continue;
    const winRate =
      (countByCondition(cat.trades, (t) => t.pnl! > 0) / cat.trades.length) * 100;
    if (winRate > bestWinRate) {
      bestWinRate = winRate;
      bestCategory = cat;
    }
  }

  if (bestCategory && bestWinRate > TIMING_PATTERN_WIN_RATE_THRESHOLD) {
    const patternId = `timing-${bestCategory.name}`;
    const existing = memory.patterns.find((p) => p.id === patternId);

    if (existing) {
      existing.occurrences = bestCategory.trades.length;
      existing.successRate = bestWinRate;
      existing.lastSeen = new Date().toISOString();
    } else {
      memory.patterns.push({
        id: patternId,
        name: `${bestCategory.name} Timing Edge`,
        description: `Higher win rate (${bestWinRate.toFixed(0)}%) on ${bestCategory.label} trades. Consider adjusting holding periods.`,
        symbols: [],
        occurrences: bestCategory.trades.length,
        successRate: bestWinRate,
        avgReturn:
          bestCategory.trades.reduce((s, t) => s + (t.pnlPercent || 0), 0) /
          bestCategory.trades.length,
        triggers: [`holding period: ${bestCategory.label}`],
        recommendedAction: "hold",
        lastSeen: new Date().toISOString(),
      });
    }
  }
}

function detectSectorRotation(memory: AgentMemoryState): void {
  const recentTrades = memory.tradeMemories
    .filter((t) => t.pnl !== null)
    .slice(-SECTOR_ROTATION_LOOKBACK_TRADES);
  if (recentTrades.length < MIN_TRADES_FOR_SECTOR_ROTATION_DETECTION) return;

  const sectorPerformance = new Map<
    string,
    { wins: number; total: number; avgReturn: number }
  >();

  for (const trade of recentTrades) {
    const sector = STOCK_SECTORS[trade.symbol] || "other";
    const existing = sectorPerformance.get(sector) || {
      wins: 0,
      total: 0,
      avgReturn: 0,
    };
    existing.total++;
    if (trade.pnl! > 0) existing.wins++;
    existing.avgReturn =
      (existing.avgReturn * (existing.total - 1) + (trade.pnlPercent || 0)) /
      existing.total;
    sectorPerformance.set(sector, existing);
  }

  // Find hot and cold sectors
  let bestSector: string | null = null;
  let worstSector: string | null = null;
  let bestReturn = -Infinity;
  let worstReturn = Infinity;

  for (const [sector, stats] of sectorPerformance.entries()) {
    if (stats.total < 3) continue;
    if (stats.avgReturn > bestReturn) {
      bestReturn = stats.avgReturn;
      bestSector = sector;
    }
    if (stats.avgReturn < worstReturn) {
      worstReturn = stats.avgReturn;
      worstSector = sector;
    }
  }

  memory.bestSector = bestSector;
  memory.worstSector = worstSector;

  if (bestSector && bestReturn > 1) {
    const patternId = `hot-sector-${bestSector}`;
    const existing = memory.patterns.find((p) => p.id === patternId);

    if (existing) {
      existing.occurrences =
        sectorPerformance.get(bestSector)?.total || 0;
      existing.lastSeen = new Date().toISOString();
    } else {
      memory.patterns.push({
        id: patternId,
        name: `Hot Sector: ${bestSector}`,
        description: `${bestSector} sector has been profitable (avg ${bestReturn.toFixed(1)}% return). Consider overweighting ${bestSector} stocks.`,
        symbols: Object.entries(STOCK_SECTORS)
          .filter(([_, s]) => s === bestSector)
          .map(([sym]) => sym),
        occurrences: sectorPerformance.get(bestSector)?.total || 0,
        successRate:
          ((sectorPerformance.get(bestSector)?.wins || 0) /
            (sectorPerformance.get(bestSector)?.total || 1)) *
          100,
        avgReturn: bestReturn,
        triggers: ["sector momentum"],
        recommendedAction: "buy",
        lastSeen: new Date().toISOString(),
      });
    }
  }
}

function detectConfidencePattern(memory: AgentMemoryState): void {
  const closedTrades = memory.tradeMemories.filter((t) => t.pnl !== null);
  if (closedTrades.length < MIN_TRADES_FOR_CALIBRATION_PATTERN) return;

  // Split into high/low confidence
  const highConf = closedTrades.filter((t) => t.confidence >= 70);
  const lowConf = closedTrades.filter((t) => t.confidence < 50);

  if (highConf.length < 5 || lowConf.length < 5) return;

  const highConfWinRate =
    (countByCondition(highConf, (t) => t.pnl! > 0) / highConf.length) * 100;
  const lowConfWinRate =
    (countByCondition(lowConf, (t) => t.pnl! > 0) / lowConf.length) * 100;

  const isCalibrated = Math.abs(highConfWinRate - lowConfWinRate) > 15;

  const patternId = "confidence-calibration";
  const existing = memory.patterns.find((p) => p.id === patternId);

  const description = isCalibrated
    ? `Well-calibrated confidence: High-conf trades win ${highConfWinRate.toFixed(0)}%, low-conf win ${lowConfWinRate.toFixed(0)}%. Trust your confidence signals.`
    : `Poorly calibrated: High-conf trades win ${highConfWinRate.toFixed(0)}%, low-conf win ${lowConfWinRate.toFixed(0)}%. Confidence doesn't predict outcomes well — be more skeptical of high-conf calls.`;

  if (existing) {
    existing.description = description;
    existing.occurrences = closedTrades.length;
    existing.lastSeen = new Date().toISOString();
  } else {
    memory.patterns.push({
      id: patternId,
      name: isCalibrated ? "Good Confidence Calibration" : "Overconfidence Warning",
      description,
      symbols: [],
      occurrences: closedTrades.length,
      successRate: highConfWinRate,
      avgReturn: 0,
      triggers: ["confidence assessment"],
      recommendedAction: "hold",
      lastSeen: new Date().toISOString(),
    });
  }
}

// ---------------------------------------------------------------------------
// Stats & Lessons
// ---------------------------------------------------------------------------

function updateOverallStats(memory: AgentMemoryState): void {
  const closed = memory.tradeMemories.filter((t) => t.pnl !== null);
  memory.totalTradesAnalyzed = closed.length;

  if (closed.length > 0) {
    const wins = countByCondition(closed, (t) => t.pnl! > 0);
    memory.overallWinRate = (wins / closed.length) * 100;
  }
}

function updateKeyLessons(memory: AgentMemoryState): void {
  const lessons: string[] = [];

  // Overall performance lesson
  if (memory.totalTradesAnalyzed >= 10) {
    if (memory.overallWinRate > WIN_RATE_STRONG_OVERALL_THRESHOLD) {
      lessons.push(
        `Strong track record: ${memory.overallWinRate.toFixed(0)}% win rate over ${memory.totalTradesAnalyzed} trades. Stay disciplined.`,
      );
    } else if (memory.overallWinRate < WIN_RATE_WEAK_OVERALL_THRESHOLD) {
      lessons.push(
        `Below-average win rate: ${memory.overallWinRate.toFixed(0)}%. Consider being more selective and only trading high-conviction ideas.`,
      );
    }
  }

  // Best/worst sector lessons
  if (memory.bestSector) {
    lessons.push(`Best-performing sector: ${memory.bestSector}. Consider overweighting.`);
  }
  if (memory.worstSector) {
    lessons.push(`Weakest sector: ${memory.worstSector}. Be cautious or avoid.`);
  }

  // Stock-specific lessons
  for (const [symbol, profile] of memory.stockProfiles.entries()) {
    if (profile.tradeCount >= 5) {
      if (profile.winRate > WIN_RATE_STOCK_STRENGTH_THRESHOLD) {
        lessons.push(
          `${symbol} is a strength: ${profile.winRate.toFixed(0)}% win rate across ${profile.tradeCount} trades.`,
        );
      } else if (profile.winRate < WIN_RATE_STOCK_WEAKNESS_THRESHOLD) {
        lessons.push(
          `${symbol} has been problematic: only ${profile.winRate.toFixed(0)}% win rate. Consider avoiding.`,
        );
      }
    }
  }

  // Pattern lessons
  for (const pattern of memory.patterns) {
    if (pattern.occurrences >= MIN_PATTERN_OCCURRENCES_FOR_LESSON && pattern.successRate > MIN_PATTERN_SUCCESS_RATE_FOR_LESSON) {
      lessons.push(`Pattern "${pattern.name}": ${pattern.description}`);
    }
  }

  // Cap and store
  memory.keyLessons = lessons.slice(0, MAX_KEY_LESSONS);
}

// ---------------------------------------------------------------------------
// Peer Analysis
// ---------------------------------------------------------------------------

/**
 * Record an observation about another agent's behavior.
 * Call this after each round when we see other agents' decisions.
 */
export function recordPeerObservation(
  agentId: string,
  peerId: string,
  observation: {
    agreedOnAction: boolean;
    peerAction: string;
    peerSymbol: string;
    peerConfidence: number;
  },
): void {
  const memory = getOrCreateMemory(agentId);
  let peer = memory.peerObservations.get(peerId);

  if (!peer) {
    peer = {
      peerId,
      observations: [],
      agreementRate: 0,
      disagreementPatterns: [],
      perceivedStrengths: [],
      perceivedWeaknesses: [],
    };
    memory.peerObservations.set(peerId, peer);
  }

  // Update agreement rate
  const allObs = [...peer.observations, observation.agreedOnAction ? "agree" : "disagree"];
  const agreements = countByCondition(allObs, (o) => o === "agree");
  peer.agreementRate = (agreements / allObs.length) * 100;

  // Record the observation
  const desc = observation.agreedOnAction
    ? `Agreed: both favored ${observation.peerAction} ${observation.peerSymbol}`
    : `Disagreed: they chose ${observation.peerAction} ${observation.peerSymbol} (confidence: ${observation.peerConfidence})`;
  peer.observations.push(desc);

  // Cap observations
  if (peer.observations.length > MAX_PEER_OBSERVATIONS) {
    peer.observations = peer.observations.slice(-MAX_PEER_OBSERVATIONS);
  }

  memory.lastUpdated = new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Memory Prompt Generation
// ---------------------------------------------------------------------------

/**
 * Generate a context-rich memory prompt to inject into the agent's
 * system prompt before each trading decision.
 *
 * This is the core output — it makes agents smarter over time.
 */
export function generateMemoryPrompt(agentId: string): string {
  const memory = agentMemories.get(agentId);
  if (!memory || memory.tradeMemories.length === 0) {
    return ""; // No memories yet — first trade
  }

  const sections: string[] = [];

  // Section 1: Overall performance summary
  sections.push(`YOUR TRADING RECORD: ${memory.totalTradesAnalyzed} trades analyzed, ${memory.overallWinRate.toFixed(0)}% win rate.`);

  // Section 2: Key lessons (most important)
  if (memory.keyLessons.length > 0) {
    sections.push(
      `LESSONS FROM PAST TRADES:\n${memory.keyLessons.map((l) => `• ${l}`).join("\n")}`,
    );
  }

  // Section 3: Active patterns
  const activePatterns = memory.patterns
    .filter((p) => p.occurrences >= MIN_PATTERN_OCCURRENCES_FOR_DISPLAY && p.successRate > MIN_PATTERN_SUCCESS_RATE_FOR_DISPLAY)
    .slice(0, ACTIVE_PATTERNS_DISPLAY_LIMIT);
  if (activePatterns.length > 0) {
    sections.push(
      `ACTIVE PATTERNS:\n${activePatterns.map((p) => `• ${p.name}: ${p.description}`).join("\n")}`,
    );
  }

  // Section 4: Stock-specific notes (for stocks currently in portfolio or being considered)
  const relevantProfiles = [...memory.stockProfiles.values()]
    .filter((p) => p.tradeCount >= 2)
    .sort((a, b) => b.tradeCount - a.tradeCount)
    .slice(0, RELEVANT_STOCK_PROFILES_DISPLAY_LIMIT);

  if (relevantProfiles.length > 0) {
    const profileLines = relevantProfiles.map((p) => {
      const priceLevels = p.priceLevels
        .filter((l) => l.strength >= 2)
        .map((l) => `${l.type}@$${l.price}`)
        .join(", ");
      return `• ${p.symbol}: ${p.tradeCount} trades, ${p.winRate.toFixed(0)}% win rate, avg return ${p.avgReturn.toFixed(1)}%, sentiment: ${p.sentiment}${priceLevels ? `, levels: ${priceLevels}` : ""}`;
    });
    sections.push(`STOCK KNOWLEDGE:\n${profileLines.join("\n")}`);
  }

  // Section 5: Recent trades (last N for recency context)
  const recentTrades = memory.tradeMemories.slice(-MEMORY_PROMPT_RECENT_TRADES);
  if (recentTrades.length > 0) {
    const tradeLines = recentTrades.map((t) => {
      const pnlStr =
        t.pnl !== null
          ? `${t.pnl >= 0 ? "+" : ""}$${t.pnl.toFixed(2)} (${t.pnlPercent?.toFixed(1)}%)`
          : "open";
      return `• ${t.action.toUpperCase()} ${t.symbol} @$${t.entryPrice.toFixed(2)} → ${pnlStr}${t.lesson ? ` [${t.lesson.slice(0, LESSON_TEXT_DISPLAY_LENGTH)}]` : ""}`;
    });
    sections.push(`RECENT TRADES:\n${tradeLines.join("\n")}`);
  }

  // Section 6: Peer observations (brief)
  const peerInsights: string[] = [];
  for (const [_, peer] of memory.peerObservations.entries()) {
    if (peer.observations.length >= 5) {
      peerInsights.push(
        `${peer.peerId}: ${peer.agreementRate.toFixed(0)}% agreement rate`,
      );
    }
  }
  if (peerInsights.length > 0) {
    sections.push(
      `OTHER AGENTS: ${peerInsights.join("; ")}`,
    );
  }

  return `\n--- MEMORY & LEARNING ---\n${sections.join("\n\n")}\n--- END MEMORY ---`;
}

// ---------------------------------------------------------------------------
// Load Historical Memory from DB
// ---------------------------------------------------------------------------

/**
 * Bootstrap agent memory from the database on startup.
 * Loads recent trades and decisions to build initial memory state.
 */
export async function loadMemoryFromDB(agentId: string): Promise<void> {
  const memory = getOrCreateMemory(agentId);

  // Load recent decisions
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);

  const recentDecisions = await db
    .select()
    .from(agentDecisions)
    .where(
      and(
        eq(agentDecisions.agentId, agentId),
        gte(agentDecisions.createdAt, cutoff),
      ),
    )
    .orderBy(agentDecisions.createdAt)
    .limit(MEMORY_COMPUTATION_QUERY_LIMIT);

  // Load recent trades
  const recentTrades = await db
    .select()
    .from(trades)
    .where(and(eq(trades.agentId, agentId), gte(trades.createdAt, cutoff)))
    .orderBy(trades.createdAt)
    .limit(MEMORY_COMPUTATION_QUERY_LIMIT);

  // Build trade memories from decisions and trades
  for (const decision of recentDecisions) {
    if (decision.action === "hold") continue;

    // Find matching trade
    const matchingTrade = recentTrades.find(
      (t: typeof recentTrades[0]) =>
        t.stockSymbol === decision.symbol &&
        t.agentId === decision.agentId &&
        Math.abs(
          t.createdAt.getTime() - decision.createdAt.getTime(),
        ) < 3600_000,
    );

    recordTradeMemory(agentId, {
      id: String(decision.id),
      symbol: decision.symbol,
      action: decision.action as "buy" | "sell",
      entryPrice: matchingTrade ? Number(matchingTrade.pricePerToken) : 0,
      exitPrice: null,
      pnl: null,
      pnlPercent: null,
      reasoning: decision.reasoning,
      confidence: decision.confidence,
      holdingHours: null,
      wasConsensus: false,
      timestamp: decision.createdAt.toISOString(),
    });
  }

  memory.lastUpdated = new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Public API — Status & Queries
// ---------------------------------------------------------------------------

/**
 * Get the full memory state for an agent (for API/debugging).
 */
export function getAgentMemory(agentId: string): {
  agentId: string;
  totalMemories: number;
  totalPatterns: number;
  totalStockProfiles: number;
  overallWinRate: number;
  bestSector: string | null;
  worstSector: string | null;
  keyLessons: string[];
  patterns: PatternMemory[];
  stockProfiles: StockProfile[];
  peerCount: number;
  recentTrades: TradeMemory[];
  lastUpdated: string;
} {
  const memory = getOrCreateMemory(agentId);

  return {
    agentId,
    totalMemories: memory.tradeMemories.length,
    totalPatterns: memory.patterns.length,
    totalStockProfiles: memory.stockProfiles.size,
    overallWinRate: round2(memory.overallWinRate),
    bestSector: memory.bestSector,
    worstSector: memory.worstSector,
    keyLessons: memory.keyLessons,
    patterns: memory.patterns,
    stockProfiles: [...memory.stockProfiles.values()],
    peerCount: memory.peerObservations.size,
    recentTrades: memory.tradeMemories.slice(-AGENT_MEMORY_API_RECENT_TRADES),
    lastUpdated: memory.lastUpdated,
  };
}

/**
 * Get memory system status across all agents.
 */
export function getMemorySystemStatus(): {
  agentsWithMemory: number;
  totalTradeMemories: number;
  totalPatterns: number;
  totalLessons: number;
  agents: Array<{
    agentId: string;
    memories: number;
    patterns: number;
    winRate: number;
    lastUpdated: string;
  }>;
} {
  let totalTradeMemories = 0;
  let totalPatterns = 0;
  let totalLessons = 0;
  const agents: Array<{
    agentId: string;
    memories: number;
    patterns: number;
    winRate: number;
    lastUpdated: string;
  }> = [];

  for (const [agentId, memory] of agentMemories.entries()) {
    totalTradeMemories += memory.tradeMemories.length;
    totalPatterns += memory.patterns.length;
    totalLessons += memory.keyLessons.length;

    agents.push({
      agentId,
      memories: memory.tradeMemories.length,
      patterns: memory.patterns.length,
      winRate: round2(memory.overallWinRate),
      lastUpdated: memory.lastUpdated,
    });
  }

  return {
    agentsWithMemory: agentMemories.size,
    totalTradeMemories,
    totalPatterns,
    totalLessons,
    agents,
  };
}

/**
 * Clear all memories for an agent (for testing or reset).
 */
export function clearAgentMemory(agentId: string): void {
  agentMemories.delete(agentId);
}
