/**
 * Trading Tools — Tool definitions & central executor for autonomous agents
 *
 * 10 tools agents can call during their tool-calling loop:
 *   get_portfolio, get_stock_prices, get_active_theses,
 *   update_thesis, close_thesis, search_news, get_technical_indicators,
 *   get_execution_quote, execute_trade, get_wallet_status
 *
 * Provides dual-format output for Anthropic and OpenAI tool schemas.
 */

import type { MarketData, PortfolioContext } from "./base-agent.ts";
import {
  getActiveTheses,
  upsertThesis,
  closeThesis,
} from "../services/agent-theses.ts";
import { computeIndicators } from "../services/market-aggregator.ts";
import { computeAgentPerformance } from "../services/performance-tracker.ts";
import type { agentTheses } from "../db/schema/agent-theses.ts";
import type { InferSelectModel } from "drizzle-orm";
import { XSTOCKS_CATALOG, USDC_MINT_MAINNET } from "../config/constants.ts";
import {
  MS_PER_HOUR,
  MS_PER_DAY,
  MS_PER_WEEK,
  MS_PER_MONTH,
} from "../config/financial-constants.ts";
import { errorMessage } from "../lib/errors.ts";
import { executeBuy, executeSell } from "../services/trading.ts";
import { getAgentWalletStatus } from "../services/agent-wallets.ts";
import {
  enforcePolicy,
  recordTrade,
  getAgentTradeStats,
  getAgentPolicy,
} from "../services/wallet-policy.ts";

// ---------------------------------------------------------------------------
// News & Search Tool Constants
// ---------------------------------------------------------------------------

/**
 * Maximum number of news articles or search results returned per query.
 *
 * Controls response verbosity: 10 results gives agents sufficient coverage
 * without overwhelming the context window (~800-2000 tokens per batch).
 * Applies to both Alpha Vantage news feed (filtered results) and Brave web
 * search results.
 *
 * Also used as the Alpha Vantage API `limit` query parameter.
 */
const SEARCH_NEWS_RESULTS_LIMIT = 10;

/**
 * Maximum character length for article/result description snippets.
 *
 * Truncates description text at 400 characters to balance information density
 * with token efficiency. 400 characters typically captures the lede paragraph
 * (who/what/when/where) without including full article body.
 *
 * Applied to Alpha Vantage article summaries and Brave search descriptions.
 */
const NEWS_DESCRIPTION_MAX_CHARS = 400;

/**
 * HTTP fetch timeout for Alpha Vantage news sentiment API calls (milliseconds).
 *
 * 10 seconds allows for typical AV API latency (200-2000ms) while preventing
 * indefinite hangs on slow/congested requests.
 */
const AV_NEWS_FETCH_TIMEOUT_MS = 10_000;

/**
 * HTTP fetch timeout for Brave web search API calls (milliseconds).
 *
 * 10 seconds matches AV timeout for consistent news tool latency profile.
 * Brave typically responds in 300-1500ms; 10s handles congested requests.
 */
const BRAVE_SEARCH_FETCH_TIMEOUT_MS = 10_000;

/**
 * HTTP fetch timeout for Jupiter Ultra Order API quote requests (milliseconds).
 *
 * 15 seconds is longer than news timeouts because Jupiter quotes involve
 * on-chain route computation across multiple DEX pools.  Jupiter typically
 * responds in 500-3000ms; 15s tolerates occasional routing delays.
 */
const JUPITER_QUOTE_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Token Decimal Conversion Constants
// ---------------------------------------------------------------------------

/**
 * Raw units per USDC token (6 decimal places: 1 USDC = 1,000,000 raw units).
 *
 * Used to convert between human-readable USDC amounts and Jupiter API raw
 * lamport-equivalent integers for USDC (SPL token with 6 decimals).
 *
 * Formula: rawUnits = usdcAmount × USDC_RAW_UNITS_PER_USDC
 * Example: $50.00 USDC = 50 × 1,000,000 = 50,000,000 raw units
 */
const USDC_RAW_UNITS_PER_USDC = 1_000_000;

/**
 * Raw units per xStock token (8 decimal places: 1 share = 100,000,000 raw units).
 *
 * xStock tokens (tokenized equities via Backed Finance) use 8 decimal places,
 * matching the Bitcoin/Solana ecosystem convention for precision-critical assets.
 *
 * Formula: rawUnits = shareAmount × XSTOCK_RAW_UNITS_PER_TOKEN
 * Example: 0.5 shares = 0.5 × 100,000,000 = 50,000,000 raw units
 */
const XSTOCK_RAW_UNITS_PER_TOKEN = 100_000_000;

/**
 * Display decimal places for USDC amounts in trade execution strings.
 *
 * USDC has 6 decimal places (matching raw precision). Used with .toFixed() to
 * produce string amounts passed to executeBuy() — e.g., "50.000000" USDC.
 */
const USDC_DISPLAY_DECIMALS = 6;

/**
 * Display decimal places for xStock quantities in trade execution strings.
 *
 * xStock tokens have 8 decimal places. Used with .toFixed() in executeSell()
 * to produce precise share count strings — e.g., "0.50000000" shares.
 */
const XSTOCK_DISPLAY_DECIMALS = 8;

// ---------------------------------------------------------------------------
// Tool Input Validation Constants — string field character limits
// ---------------------------------------------------------------------------

/**
 * Maximum character length for investment thesis text (update_thesis tool).
 *
 * 2 000 characters gives agents ample space for a full thesis (~400 words)
 * covering catalysts, valuation, risk factors, and price targets — while
 * keeping the stored string from bloating the agent-theses DB column.
 *
 * Applied via: validateStringField(args.thesis, "thesis", THESIS_TEXT_MAX_LENGTH)
 */
const THESIS_TEXT_MAX_LENGTH = 2000;

/**
 * Maximum character length for thesis closure reason (close_thesis tool).
 *
 * 1 000 characters is enough for a concise one-paragraph explanation of why
 * the thesis is closed (stop-loss hit, target reached, thesis invalidated).
 * Shorter than thesis text since reasons are summaries, not full analyses.
 *
 * Applied via: validateStringField(args.reason, "reason", CLOSE_REASON_MAX_LENGTH)
 */
const CLOSE_REASON_MAX_LENGTH = 1000;

/**
 * Maximum character length for news search query strings (search_news tool).
 *
 * 500 characters accommodates detailed multi-term queries while preventing
 * agents from passing entire paragraphs as search queries, which would waste
 * API quota and degrade search result quality.
 *
 * Applied via: validateStringField(args.query, "query", SEARCH_QUERY_MAX_LENGTH)
 */
const SEARCH_QUERY_MAX_LENGTH = 500;

/**
 * Maximum character length for trade execution reasoning (execute_trade tool).
 *
 * 2 000 characters matches THESIS_TEXT_MAX_LENGTH — the reasoning field
 * documents the agent's decision rationale for each live trade, stored in the
 * trade history for audit and learning purposes.
 *
 * Applied via: validateStringField(args.reasoning, "reasoning", EXECUTION_REASONING_MAX_LENGTH)
 */
const EXECUTION_REASONING_MAX_LENGTH = 2000;

// ---------------------------------------------------------------------------
// Brave Search Result Count Constant
// ---------------------------------------------------------------------------

/**
 * Number of web search results to request from the Brave Search API per query.
 *
 * 15 results gives agents broader context than AV news (which is limited to
 * SEARCH_NEWS_RESULTS_LIMIT=10 after filtering). Brave results are raw web
 * pages, so more results improve the chance of finding fresh, relevant content.
 *
 * Used as URL query param: url.searchParams.set("count", String(BRAVE_SEARCH_COUNT))
 *
 * The final displayed results are still capped at SEARCH_NEWS_RESULTS_LIMIT
 * (10) via rawResults.slice(0, SEARCH_NEWS_RESULTS_LIMIT) — so BRAVE_SEARCH_COUNT
 * > SEARCH_NEWS_RESULTS_LIMIT acts as a pre-filter buffer allowing deduplication
 * before the final slice.
 */
const BRAVE_SEARCH_COUNT = 15;

// ---------------------------------------------------------------------------
// Trade Amount Validation Constants
// ---------------------------------------------------------------------------

/**
 * Maximum allowed trade amount in a single get_execution_quote or execute_trade call.
 *
 * 1 billion (1_000_000_000) is a safety ceiling that catches obvious agent errors
 * (e.g., passing raw lamports instead of USDC amounts). No legitimate single
 * trade should approach this size given typical agent starting capital of ~$10 000.
 *
 * Formula check: args.amount > MAX_TRADE_AMOUNT → reject with error
 */
const MAX_TRADE_AMOUNT = 1_000_000_000;

/**
 * Minimum allowed trade amount in a single get_execution_quote or execute_trade call.
 *
 * 0.01 USDC (1 cent) is the practical floor below which Jupiter routing becomes
 * unreliable and slippage approaches 100% due to DEX minimum fill sizes.
 * Also prevents agents from accidentally submitting zero-equivalent amounts.
 *
 * Formula check: args.amount < MIN_TRADE_AMOUNT → reject with error
 */
const MIN_TRADE_AMOUNT = 0.01;

// ---------------------------------------------------------------------------
// Price Impact Threshold Constants
// ---------------------------------------------------------------------------

/**
 * Price impact percentage above which the mid-market price is considered stale.
 *
 * If the implied price impact exceeds 20%, it almost certainly means the
 * mid-market price from get_stock_prices is stale or diverged from the real
 * on-chain price — not that the trade itself has extreme market impact.
 * In this case the impact figure is replaced with -1 ("unreliable") and
 * agents are told to treat effectivePrice as the current market rate.
 *
 * Formula: priceImpactPercent > STALE_PRICE_IMPACT_THRESHOLD → flag stale
 */
const STALE_PRICE_IMPACT_THRESHOLD = 20;

/**
 * Price impact percentage above which a "high impact" warning is shown.
 *
 * Trades with >1% price impact materially move the market and should prompt
 * agents to consider splitting the order into smaller tranches. Below 1% is
 * considered normal execution slippage for retail-sized positions.
 *
 * Formula: priceImpactPercent > HIGH_PRICE_IMPACT_THRESHOLD → warn agent
 */
const HIGH_PRICE_IMPACT_THRESHOLD = 1;

// ---------------------------------------------------------------------------
// Tool Context — passed into executeTool for data access
// ---------------------------------------------------------------------------

export interface ToolContext {
  agentId: string;
  portfolio: PortfolioContext;
  marketData: MarketData[];
}

// ---------------------------------------------------------------------------
// Tool Argument Types — strongly typed arguments for each tool
// ---------------------------------------------------------------------------

export interface GetPortfolioArgs {
  // No arguments
}

export interface GetStockPricesArgs {
  symbols: string[];
}

export interface GetActiveThesesArgs {
  // No arguments
}

export interface UpdateThesisArgs {
  symbol: string;
  thesis: string;
  conviction: string;
  direction: "bullish" | "bearish" | "neutral";
  entry_price?: string;
  target_price?: string;
}

export interface CloseThesisArgs {
  symbol: string;
  reason: string;
}

export interface SearchNewsArgs {
  query: string;
  freshness?: "ph" | "pd" | "pw" | "pm";
  sources?: "news" | "social" | "all";
}

export interface GetTechnicalIndicatorsArgs {
  symbol: string;
}

export interface GetExecutionQuoteArgs {
  symbol: string;
  side: "buy" | "sell";
  amount: number;
}

export interface ExecuteTradeArgs {
  symbol: string;
  side: "buy" | "sell";
  /** For buys: USDC to spend. For sells: number of shares to sell. */
  amount: number;
  /** Required reasoning for why the agent is executing this trade now. */
  reasoning: string;
}

export interface GetWalletStatusArgs {
  // No arguments
}

export type ToolArgs =
  | GetPortfolioArgs
  | GetStockPricesArgs
  | GetActiveThesesArgs
  | UpdateThesisArgs
  | CloseThesisArgs
  | SearchNewsArgs
  | GetTechnicalIndicatorsArgs
  | GetExecutionQuoteArgs
  | ExecuteTradeArgs
  | GetWalletStatusArgs;

// ---------------------------------------------------------------------------
// Input Validation Helpers
// ---------------------------------------------------------------------------

/**
 * Validates a required string field (non-empty after trimming)
 * @param value - The value to validate
 * @param fieldName - Name of the field for error messages
 * @param maxLength - Optional maximum length in characters
 * @returns Error message if invalid, null if valid
 */
function validateStringField(
  value: unknown,
  fieldName: string,
  maxLength?: number,
): string | null {
  if (!value || typeof value !== "string" || value.trim().length === 0) {
    return `${fieldName} is required and cannot be empty`;
  }
  if (maxLength && value.length > maxLength) {
    return `${fieldName} must be ${maxLength} characters or less`;
  }
  return null;
}

/**
 * Validates a numeric field with bounds checking
 * @param value - The value to parse and validate (string or number)
 * @param fieldName - Name of the field for error messages
 * @param min - Minimum allowed value (inclusive)
 * @param max - Maximum allowed value (inclusive), or Infinity for no upper bound
 * @returns Error message if invalid, null if valid
 */
function validateNumericField(
  value: unknown,
  fieldName: string,
  min: number,
  max: number = Infinity,
): string | null {
  if (!value) {
    return `${fieldName} is required`;
  }
  const num = typeof value === "string" ? parseFloat(value) : Number(value);
  if (isNaN(num) || num < min || num > max) {
    if (max === Infinity) {
      return `${fieldName} must be a positive number`;
    }
    return `${fieldName} must be a number between ${min}-${max}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tool Schema Definitions
// ---------------------------------------------------------------------------

export interface ToolParam {
  type: string;
  description: string;
  enum?: string[];
  items?: { type: string };
}

interface ToolDef {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, ToolParam>;
    required: string[];
  };
}

const TOOL_DEFINITIONS: ToolDef[] = [
  {
    name: "get_portfolio",
    description:
      "Get your current portfolio: cash balance, positions with PnL, and total portfolio value.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_stock_prices",
    description:
      "Get current prices, 24h change, and volume for specific stocks or all stocks. Pass an empty symbols array to get all stocks.",
    parameters: {
      type: "object",
      properties: {
        symbols: {
          type: "array",
          description:
            'Stock symbols to look up (e.g. ["AAPLx","TSLAx"]). Empty array = all stocks.',
          items: { type: "string" },
        },
      },
      required: ["symbols"],
    },
  },
  {
    name: "get_active_theses",
    description:
      "Get your currently active investment theses. These persist across trading rounds so you remember your reasoning.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "update_thesis",
    description:
      "Create or update an investment thesis for a stock. Records your reasoning, conviction, and price targets.",
    parameters: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Stock symbol (e.g. AAPLx)" },
        thesis: {
          type: "string",
          description: "Your investment thesis — why you are bullish/bearish",
        },
        conviction: {
          type: "string",
          description: "Conviction level 1-10 (as a string number)",
        },
        direction: {
          type: "string",
          description: "Your directional view",
          enum: ["bullish", "bearish", "neutral"],
        },
        entry_price: {
          type: "string",
          description: "Entry price when thesis was formed (optional)",
        },
        target_price: {
          type: "string",
          description: "Target price you expect (optional)",
        },
      },
      required: ["symbol", "thesis", "conviction", "direction"],
    },
  },
  {
    name: "close_thesis",
    description:
      "Close an active thesis when your view has changed or you've exited the position.",
    parameters: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Stock symbol" },
        reason: {
          type: "string",
          description: "Why you are closing this thesis",
        },
      },
      required: ["symbol", "reason"],
    },
  },
  {
    name: "search_news",
    description:
      "Search for recent news about a stock, sector, or market topic using Brave Search. Returns 10 results with timestamps. Use freshness='ph' for past hour (breaking news) or 'pd' for past day (default). Use sources to target specific sites.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            'Search query (e.g. "NVDA earnings 2026", "Apple stock news")',
        },
        freshness: {
          type: "string",
          description:
            'Time filter: "ph" (past hour), "pd" (past day, default), "pw" (past week), "pm" (past month)',
          enum: ["ph", "pd", "pw", "pm"],
        },
        sources: {
          type: "string",
          description:
            'Target specific sources: "news" (press releases), "social" (Reddit/X), "all" (default)',
          enum: ["news", "social", "all"],
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_technical_indicators",
    description:
      "Get technical indicators (SMA, EMA, RSI, momentum, trend) for a stock.",
    parameters: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Stock symbol (e.g. NVDAx)" },
      },
      required: ["symbol"],
    },
  },
  {
    name: "get_execution_quote",
    description:
      "Get an accurate execution quote from Jupiter DEX showing exact output amount, price impact, and slippage for a specific trade size. Use this before trading to verify execution price.",
    parameters: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Stock symbol to trade (e.g. AAPLx)" },
        side: { type: "string", description: "Trade direction", enum: ["buy", "sell"] },
        amount: { type: "number", description: "Amount in USDC (for buys) or shares (for sells)" },
      },
      required: ["symbol", "side", "amount"],
    },
  },
  {
    name: "execute_trade",
    description:
      "Execute a real trade on-chain via Jupiter DEX. IMPORTANT: This sends a real Solana transaction that buys/sells tokenized stocks. Use get_execution_quote first to check price impact. Subject to wallet policy limits (max trade size, daily volume, rate limits).",
    parameters: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Stock symbol to trade (e.g. AAPLx)" },
        side: { type: "string", description: "Trade direction", enum: ["buy", "sell"] },
        amount: { type: "number", description: "For buys: USDC to spend. For sells: number of shares to sell." },
        reasoning: { type: "string", description: "Why you are executing this trade now (required for audit trail)" },
      },
      required: ["symbol", "side", "amount", "reasoning"],
    },
  },
  {
    name: "get_wallet_status",
    description:
      "Get your wallet status: SOL balance (for fees), USDC balance, xStock holdings, and trading policy limits (daily volume used, trades remaining).",
    parameters: { type: "object", properties: {}, required: [] },
  },
];

// ---------------------------------------------------------------------------
// Dual-Format Tool Accessors
// ---------------------------------------------------------------------------

/**
 * Anthropic tool format: { name, description, input_schema }
 */
export function getAnthropicTools() {
  return TOOL_DEFINITIONS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

/**
 * OpenAI tool format: { type: "function", function: { name, description, parameters } }
 */
export function getOpenAITools() {
  return TOOL_DEFINITIONS.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

// ---------------------------------------------------------------------------
// Central Tool Executor
// ---------------------------------------------------------------------------

/**
 * Execute a tool call and return the result as a JSON string.
 */
export async function executeTool(
  toolName: string,
  args: ToolArgs,
  ctx: ToolContext,
): Promise<string> {
  switch (toolName) {
    case "get_portfolio":
      return executeGetPortfolio(ctx);

    case "get_stock_prices":
      return executeGetStockPrices(args as GetStockPricesArgs, ctx);

    case "get_active_theses":
      return executeGetActiveTheses(ctx);

    case "update_thesis":
      return executeUpdateThesis(args as UpdateThesisArgs, ctx);

    case "close_thesis":
      return executeCloseThesis(args as CloseThesisArgs, ctx);

    case "search_news":
      return executeSearchNews(args as SearchNewsArgs);

    case "get_technical_indicators":
      return executeGetTechnicalIndicators(args as GetTechnicalIndicatorsArgs);

    case "get_execution_quote":
      return executeGetExecutionQuote(args as GetExecutionQuoteArgs, ctx);

    case "execute_trade":
      return executeExecuteTrade(args as ExecuteTradeArgs, ctx);

    case "get_wallet_status":
      return executeGetWalletStatus(ctx);

    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
}

// ---------------------------------------------------------------------------
// Tool Implementations
// ---------------------------------------------------------------------------

async function executeGetPortfolio(ctx: ToolContext): Promise<string> {
  const { portfolio, agentId } = ctx;

  // Fetch performance feedback so agents can self-correct
  let performance: Record<string, unknown> = {};
  try {
    const perf = await computeAgentPerformance(agentId);
    const confidenceGap =
      perf.decisions.avgConfidence - perf.trading.winRate * 100;
    performance = {
      win_rate: perf.trading.winRate,
      avg_win: perf.trading.avgWin,
      avg_loss: perf.trading.avgLoss,
      profit_factor: perf.trading.profitFactor,
      current_streak: perf.trading.currentStreak,
      total_trades: perf.trading.totalTrades,
      avg_confidence: perf.decisions.avgConfidence,
      overconfidence_warning:
        perf.trading.totalTrades >= 5 && confidenceGap > 15,
      confidence_gap: perf.trading.totalTrades >= 5 ? confidenceGap : null,
    };
  } catch {
    // Graceful degradation - portfolio still works without performance data
  }

  return JSON.stringify({
    cash_usdc: portfolio.cashBalance,
    total_portfolio_value: portfolio.totalValue,
    total_pnl: portfolio.totalPnl,
    total_pnl_percent: portfolio.totalPnlPercent,
    position_count: portfolio.positions.length,
    positions: portfolio.positions.map((p) => ({
      symbol: p.symbol,
      quantity: p.quantity,
      avg_cost: p.averageCostBasis,
      current_price: p.currentPrice,
      unrealized_pnl: p.unrealizedPnl,
      unrealized_pnl_percent: p.unrealizedPnlPercent,
    })),
    performance,
  });
}

function executeGetStockPrices(
  args: GetStockPricesArgs,
  ctx: ToolContext,
): string {
  if (!Array.isArray(args.symbols)) {
    return JSON.stringify({ error: "symbols must be an array" });
  }
  const symbols = args.symbols;
  const data =
    symbols.length === 0
      ? ctx.marketData
      : ctx.marketData.filter((d) =>
          symbols.some(
            (s) => s.toLowerCase() === d.symbol.toLowerCase(),
          ),
        );
  return JSON.stringify(
    data.map((d) => ({
      symbol: d.symbol,
      name: d.name,
      price: d.price,
      change_24h: d.change24h,
      volume_24h: d.volume24h,
    })),
  );
}

async function executeGetActiveTheses(ctx: ToolContext): Promise<string> {
  try {
    const theses = await getActiveTheses(ctx.agentId);
    return JSON.stringify(
      theses.map((t: InferSelectModel<typeof agentTheses>) => ({
        symbol: t.symbol,
        thesis: t.thesis,
        conviction: t.conviction,
        direction: t.direction,
        entry_price: t.entryPrice,
        target_price: t.targetPrice,
        updated_at: t.updatedAt,
      })),
    );
  } catch (err) {
    return JSON.stringify({ error: "Failed to fetch theses", theses: [] });
  }
}

async function executeUpdateThesis(
  args: UpdateThesisArgs,
  ctx: ToolContext,
): Promise<string> {
  // Validate required string fields
  const symbolError = validateStringField(args.symbol, "symbol");
  if (symbolError) {
    return JSON.stringify({ success: false, error: symbolError });
  }
  const thesisError = validateStringField(args.thesis, "thesis", THESIS_TEXT_MAX_LENGTH);
  if (thesisError) {
    return JSON.stringify({ success: false, error: thesisError });
  }

  // Validate conviction is a valid number 1-10
  const convictionError = validateNumericField(args.conviction, "conviction", 1, 10);
  if (convictionError) {
    return JSON.stringify({ success: false, error: convictionError });
  }
  const convictionNum = parseInt(args.conviction, 10);

  if (!args.direction || !["bullish", "bearish", "neutral"].includes(args.direction)) {
    return JSON.stringify({ success: false, error: "direction must be bullish, bearish, or neutral" });
  }

  // Validate optional price fields if provided
  if (args.entry_price !== undefined && args.entry_price !== null && args.entry_price !== "") {
    const entryPriceError = validateNumericField(args.entry_price, "entry_price", 0.01);
    if (entryPriceError) {
      return JSON.stringify({ success: false, error: entryPriceError });
    }
  }
  if (args.target_price !== undefined && args.target_price !== null && args.target_price !== "") {
    const targetPriceError = validateNumericField(args.target_price, "target_price", 0.01);
    if (targetPriceError) {
      return JSON.stringify({ success: false, error: targetPriceError });
    }
  }

  try {
    const result = await upsertThesis(ctx.agentId, {
      symbol: args.symbol,
      thesis: args.thesis,
      conviction: convictionNum,
      direction: args.direction ?? "neutral",
      entryPrice: args.entry_price,
      targetPrice: args.target_price,
    });
    return JSON.stringify({ success: true, ...result });
  } catch (err) {
    return JSON.stringify({
      success: false,
      error: errorMessage(err),
    });
  }
}

async function executeCloseThesis(
  args: CloseThesisArgs,
  ctx: ToolContext,
): Promise<string> {
  // Validate required string fields
  const symbolError = validateStringField(args.symbol, "symbol");
  if (symbolError) {
    return JSON.stringify({ success: false, error: symbolError });
  }
  const reasonError = validateStringField(args.reason, "reason", CLOSE_REASON_MAX_LENGTH);
  if (reasonError) {
    return JSON.stringify({ success: false, error: reasonError });
  }
  try {
    const result = await closeThesis(ctx.agentId, args.symbol, args.reason);
    return JSON.stringify({ success: true, ...result });
  } catch (err) {
    return JSON.stringify({
      success: false,
      error: errorMessage(err),
    });
  }
}

interface BraveSearchResult {
  title?: string;
  description?: string;
  url?: string;
  age?: string;
  page_age?: string;
}

interface BraveSearchResponse {
  web?: {
    results?: BraveSearchResult[];
  };
  query?: {
    original?: string;
  };
}

interface AlphaVantageArticle {
  title?: string;
  url?: string;
  time_published?: string;
  summary?: string;
  source?: string;
  overall_sentiment_score?: number;
  overall_sentiment_label?: string;
}

interface AlphaVantageResponse {
  feed?: AlphaVantageArticle[];
  Note?: string;
  Information?: string;
}

/**
 * Enhanced news search with sentiment scoring via Alpha Vantage (free tier).
 * Falls back to Brave Search if Alpha Vantage unavailable.
 *
 * Freshness options:
 * - "ph" = past hour (breaking news)
 * - "pd" = past day (default, recommended for trading)
 * - "pw" = past week
 * - "pm" = past month
 *
 * Source options:
 * - "news" = official press releases (globenewswire, prnewswire, businesswire)
 * - "social" = social sentiment (reddit, x.com)
 * - "all" = no filter (default)
 */
async function executeSearchNews(args: SearchNewsArgs): Promise<string> {
  // Validate required string fields
  const queryError = validateStringField(args.query, "query", SEARCH_QUERY_MAX_LENGTH);
  if (queryError) {
    return JSON.stringify({ results: [], error: queryError });
  }

  // Validate enum fields if provided
  if (args.freshness && !["ph", "pd", "pw", "pm"].includes(args.freshness)) {
    return JSON.stringify({
      results: [],
      error: "freshness must be one of: ph, pd, pw, pm"
    });
  }
  if (args.sources && !["news", "social", "all"].includes(args.sources)) {
    return JSON.stringify({
      results: [],
      error: "sources must be one of: news, social, all"
    });
  }

  const alphaVantageKey = process.env.ALPHA_VANTAGE_API_KEY;
  const braveKey = process.env.BRAVE_API_KEY;

  // Try Alpha Vantage first (free tier with sentiment data)
  if (alphaVantageKey) {
    const alphaResult = await executeSearchNewsAlphaVantage(args, alphaVantageKey);
    if (alphaResult) return alphaResult;
  }

  // Fallback to Brave Search
  if (braveKey) {
    return executeSearchNewsBrave(args, braveKey);
  }

  return JSON.stringify({
    results: [],
    note: "News search unavailable (no ALPHA_VANTAGE_API_KEY or BRAVE_API_KEY)",
  });
}

/**
 * Search news via Alpha Vantage (primary, free with sentiment).
 */
async function executeSearchNewsAlphaVantage(
  args: SearchNewsArgs,
  apiKey: string,
): Promise<string | null> {
  try {
    // Extract ticker symbol from query if present
    // Look for patterns like "AAPLx", "AAPL", "Apple stock"
    const query = args.query.toLowerCase();
    let ticker: string | null = null;

    // Try to find xStock symbol
    for (const stock of XSTOCKS_CATALOG) {
      const sym = stock.symbol.toLowerCase();
      const name = stock.name.toLowerCase();
      const rawTicker = stock.symbol.replace(/x$/i, "");

      if (query.includes(sym) || query.includes(name.toLowerCase()) || query.includes(rawTicker.toLowerCase())) {
        ticker = rawTicker;
        break;
      }
    }

    if (!ticker) {
      // Can't map to ticker, return null to fallback to Brave
      return null;
    }

    const url = new URL("https://www.alphavantage.co/query");
    url.searchParams.set("function", "NEWS_SENTIMENT");
    url.searchParams.set("tickers", ticker);
    url.searchParams.set("limit", String(SEARCH_NEWS_RESULTS_LIMIT));
    url.searchParams.set("apikey", apiKey);

    // Map freshness to time_from/time_to if needed
    // Alpha Vantage doesn't have direct freshness param, so we'll filter client-side
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(AV_NEWS_FETCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      return null;
    }

    const data = (await res.json()) as AlphaVantageResponse;

    // Check for API limit
    if (data.Note || data.Information) {
      console.warn("[AlphaVantage] API limit or error");
      return null;
    }

    const feed = data.feed ?? [];
    if (feed.length === 0) {
      return null;
    }

    // Filter by freshness client-side
    const freshness = args.freshness ?? "pd";
    const now = Date.now();
    const freshnessMs = {
      ph: MS_PER_HOUR, // 1 hour
      pd: MS_PER_DAY, // 1 day
      pw: MS_PER_WEEK, // 1 week
      pm: MS_PER_MONTH, // 1 month (30-day approximation)
    }[freshness];

    const filteredFeed = feed.filter((article) => {
      if (!article.time_published) return true;
      try {
        const timeStr = article.time_published;
        const year = timeStr.slice(0, 4);
        const month = timeStr.slice(4, 6);
        const day = timeStr.slice(6, 8);
        const hour = timeStr.slice(9, 11);
        const minute = timeStr.slice(11, 13);
        const second = timeStr.slice(13, 15);
        const publishedDate = new Date(
          `${year}-${month}-${day}T${hour}:${minute}:${second}Z`,
        );
        const age = now - publishedDate.getTime();
        return age <= freshnessMs;
      } catch {
        return true;
      }
    });

    const results = filteredFeed.slice(0, SEARCH_NEWS_RESULTS_LIMIT).map((article) => ({
      title: article.title ?? "",
      description: (article.summary ?? "").slice(0, NEWS_DESCRIPTION_MAX_CHARS),
      url: article.url ?? "",
      source: article.source ?? "Alpha Vantage",
      sentiment_score: article.overall_sentiment_score ?? 0,
      sentiment_label: article.overall_sentiment_label ?? "Neutral",
    }));

    const currentTime = new Date().toISOString();
    const freshnessLabel = {
      ph: "past hour",
      pd: "past 24 hours",
      pw: "past week",
      pm: "past month",
    }[freshness];

    return JSON.stringify({
      results,
      context: {
        query: args.query,
        ticker,
        freshness: freshnessLabel,
        currentTimestamp: currentTime,
        source: "Alpha Vantage (free tier with sentiment)",
        note: `Results include sentiment scores (-1 to +1). Use sentiment_score for conviction adjustments.`,
      },
    });
  } catch (err) {
    console.warn(`[AlphaVantage] Search failed: ${errorMessage(err)}`);
    return null;
  }
}

/**
 * Search news via Brave Search (fallback).
 */
async function executeSearchNewsBrave(
  args: SearchNewsArgs,
  apiKey: string,
): Promise<string> {
  // Build query with optional site targeting
  let query = args.query;
  const sources = args.sources ?? "all";

  if (sources === "news") {
    // Target official news/press release sites
    query = `(site:globenewswire.com OR site:prnewswire.com OR site:businesswire.com OR site:reuters.com OR site:bloomberg.com) ${query}`;
  } else if (sources === "social") {
    // Target social/sentiment sites
    query = `(site:reddit.com OR site:x.com OR site:twitter.com) ${query}`;
  }

  // Freshness: default to past day for trading relevance
  const freshness = args.freshness ?? "pd";

  try {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(BRAVE_SEARCH_COUNT));
    url.searchParams.set("freshness", freshness);
    url.searchParams.set("text_decorations", "false");

    const res = await fetch(url.toString(), {
      headers: {
        "X-Subscription-Token": apiKey,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(BRAVE_SEARCH_FETCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      return JSON.stringify({
        results: [],
        error: `Search returned ${res.status}`,
      });
    }

    const data = (await res.json()) as BraveSearchResponse;
    const rawResults = data.web?.results ?? [];

    // Format results with age context
    const results = rawResults.slice(0, SEARCH_NEWS_RESULTS_LIMIT).map((r) => ({
      title: r.title ?? "",
      description: (r.description ?? "").slice(0, NEWS_DESCRIPTION_MAX_CHARS),
      url: r.url ?? "",
      age: r.age ?? r.page_age ?? "unknown",
    }));

    const currentTime = new Date().toISOString();
    const freshnessLabel = {
      ph: "past hour",
      pd: "past 24 hours",
      pw: "past week",
      pm: "past month",
    }[freshness];

    return JSON.stringify({
      results,
      context: {
        query: args.query,
        sources,
        freshness: freshnessLabel,
        currentTimestamp: currentTime,
        source: "Brave Search (fallback)",
        note: `Results are from ${freshnessLabel}. Discard any information that contradicts current date: ${currentTime.slice(0, 10)}.`,
      },
    });
  } catch (err) {
    return JSON.stringify({
      results: [],
      error: errorMessage(err),
    });
  }
}

function executeGetTechnicalIndicators(args: GetTechnicalIndicatorsArgs): string {
  if (!args.symbol || typeof args.symbol !== "string") {
    return JSON.stringify({ error: "symbol is required" });
  }
  const symbol = args.symbol;
  try {
    const indicators = computeIndicators(symbol);
    return JSON.stringify(indicators);
  } catch {
    return JSON.stringify({
      symbol,
      sma20: null,
      ema12: null,
      ema26: null,
      rsi14: null,
      momentum: null,
      trend: "sideways",
      signalStrength: 50,
      note: "Insufficient data for indicators",
    });
  }
}

/**
 * Get accurate execution quote from Jupiter DEX.
 *
 * Uses Jupiter's Ultra Order API to get exact output amount and slippage
 * for a specific trade size. This is the same API used for actual trades,
 * ensuring quote accuracy matches execution.
 *
 * Note: For agents, we use a dummy taker address since we're just getting
 * a quote, not executing the trade.
 */
async function executeGetExecutionQuote(
  args: GetExecutionQuoteArgs,
  ctx: ToolContext,
): Promise<string> {
  if (!args.symbol || typeof args.symbol !== "string") {
    return JSON.stringify({ error: "symbol is required" });
  }
  if (!args.side || !["buy", "sell"].includes(args.side)) {
    return JSON.stringify({ error: "side must be 'buy' or 'sell'" });
  }
  if (!args.amount || typeof args.amount !== "number" || args.amount <= 0) {
    return JSON.stringify({ error: "amount must be a positive number" });
  }
  if (!Number.isFinite(args.amount)) {
    return JSON.stringify({ error: "amount must be a finite number" });
  }
  if (args.amount > MAX_TRADE_AMOUNT) {
    return JSON.stringify({ error: "amount exceeds maximum (1B)" });
  }
  if (args.amount < MIN_TRADE_AMOUNT) {
    return JSON.stringify({ error: "amount must be at least 0.01" });
  }

  // Find the stock in catalog
  const stock = XSTOCKS_CATALOG.find(
    (s) => s.symbol.toLowerCase() === args.symbol.toLowerCase(),
  );
  if (!stock) {
    return JSON.stringify({ error: `Unknown symbol: ${args.symbol}` });
  }

  const jupiterApiKey = process.env.JUPITER_API_KEY;
  if (!jupiterApiKey) {
    return JSON.stringify({
      error: "Execution quotes unavailable (no JUPITER_API_KEY)",
      note: "Use get_stock_prices for mid-market price estimates instead.",
    });
  }

  try {
    let inputMint: string;
    let outputMint: string;
    let amountRaw: string;

    if (args.side === "buy") {
      // Buying stock: USDC -> Stock
      inputMint = USDC_MINT_MAINNET;
      outputMint = stock.mintAddress;
      // USDC has 6 decimals
      amountRaw = Math.floor(args.amount * USDC_RAW_UNITS_PER_USDC).toString();
    } else {
      // Selling stock: Stock -> USDC
      inputMint = stock.mintAddress;
      outputMint = USDC_MINT_MAINNET;
      // Stock has 8 decimals (per catalog)
      amountRaw = Math.floor(args.amount * XSTOCK_RAW_UNITS_PER_TOKEN).toString();
    }

    // Use Jupiter Ultra Order API (same as actual trades)
    // We use a dummy taker since we just need the quote, not the transaction
    const dummyTaker = "11111111111111111111111111111111"; // System program (valid but unused)

    const url = new URL("https://api.jup.ag/ultra/v1/order");
    url.searchParams.set("inputMint", inputMint);
    url.searchParams.set("outputMint", outputMint);
    url.searchParams.set("amount", amountRaw);
    url.searchParams.set("taker", dummyTaker);

    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "x-api-key": jupiterApiKey,
      },
      signal: AbortSignal.timeout(JUPITER_QUOTE_TIMEOUT_MS),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      // Parse common Jupiter error formats
      try {
        const errJson = JSON.parse(errText);
        if (errJson.error || errJson.message) {
          return JSON.stringify({
            symbol: args.symbol,
            side: args.side,
            error: errJson.error || errJson.message,
            note: "Route not available - token may have low liquidity. Try a smaller amount.",
          });
        }
      } catch {}
      return JSON.stringify({
        error: `Jupiter quote failed: ${res.status}`,
        details: errText.slice(0, 200),
      });
    }

    const order = (await res.json()) as {
      inAmount: string;
      outAmount: string;
      slippageBps: number;
      swapType?: string;
    };

    // Validate quote response amounts
    const inAmountParsed = parseInt(order.inAmount, 10);
    const outAmountParsed = parseInt(order.outAmount, 10);
    if (isNaN(inAmountParsed) || isNaN(outAmountParsed)) {
      return JSON.stringify({
        error: "Invalid quote data from Jupiter API",
        details: "Could not parse amounts from response"
      });
    }

    // Calculate effective price
    let effectivePrice: number;
    let inputAmount: number;
    let outputAmount: number;

    if (args.side === "buy") {
      // Input is USDC (6 decimals), output is stock (8 decimals)
      inputAmount = inAmountParsed / USDC_RAW_UNITS_PER_USDC;
      outputAmount = outAmountParsed / XSTOCK_RAW_UNITS_PER_TOKEN;
      effectivePrice = inputAmount / outputAmount;
    } else {
      // Input is stock (8 decimals), output is USDC (6 decimals)
      inputAmount = inAmountParsed / XSTOCK_RAW_UNITS_PER_TOKEN;
      outputAmount = outAmountParsed / USDC_RAW_UNITS_PER_USDC;
      effectivePrice = outputAmount / inputAmount;
    }

    // Get mid-market price from context for comparison
    const midMarketData = ctx.marketData.find(
      (m) => m.symbol.toLowerCase() === args.symbol.toLowerCase(),
    );
    const midMarketPrice = midMarketData?.price ?? effectivePrice;

    // Calculate implied price impact
    let priceImpactPercent = Math.abs(
      ((effectivePrice - midMarketPrice) / midMarketPrice) * 100,
    );

    // Guard against stale/divergent mid-market prices producing extreme impacts
    // If impact > 20%, the mid-market price is likely stale — flag but cap
    let priceNote: string;
    if (priceImpactPercent > STALE_PRICE_IMPACT_THRESHOLD) {
      priceNote = `WARNING: Mid-market price may be stale (${midMarketPrice.toFixed(2)} vs effective ${effectivePrice.toFixed(2)}). Price impact unreliable. Use effectivePrice as current market rate.`;
      priceImpactPercent = -1; // Signal unreliable
    } else if (priceImpactPercent > HIGH_PRICE_IMPACT_THRESHOLD) {
      priceNote = "WARNING: High price impact (>1%). Consider smaller trade size.";
    } else {
      priceNote = "Quote matches execution conditions. Valid for ~30 seconds.";
    }

    return JSON.stringify({
      symbol: args.symbol,
      side: args.side,
      requestedAmount: args.amount,
      inputAmount: inputAmount.toFixed(args.side === "buy" ? 2 : 6),
      outputAmount: outputAmount.toFixed(args.side === "buy" ? 6 : 2),
      effectivePrice: effectivePrice.toFixed(4),
      midMarketPrice: midMarketPrice.toFixed(4),
      priceImpactPercent: priceImpactPercent === -1 ? "unreliable" : priceImpactPercent.toFixed(4),
      slippageBps: order.slippageBps,
      swapType: order.swapType ?? "unknown",
      note: priceNote,
    });
  } catch (err) {
    return JSON.stringify({
      symbol: args.symbol,
      side: args.side,
      error: errorMessage(err),
      note: "Use get_stock_prices for mid-market estimates instead.",
    });
  }
}

// ---------------------------------------------------------------------------
// execute_trade — On-chain trade execution via Jupiter + Turnkey
// ---------------------------------------------------------------------------

async function executeExecuteTrade(
  args: ExecuteTradeArgs,
  ctx: ToolContext,
): Promise<string> {
  // Validate required fields
  const symbolError = validateStringField(args.symbol, "symbol");
  if (symbolError) {
    return JSON.stringify({ success: false, error: symbolError });
  }
  if (!args.side || !["buy", "sell"].includes(args.side)) {
    return JSON.stringify({ success: false, error: "side must be 'buy' or 'sell'" });
  }
  if (!args.amount || typeof args.amount !== "number" || args.amount <= 0) {
    return JSON.stringify({ success: false, error: "amount must be a positive number" });
  }
  if (!Number.isFinite(args.amount)) {
    return JSON.stringify({ success: false, error: "amount must be a finite number" });
  }
  const reasoningError = validateStringField(args.reasoning, "reasoning", EXECUTION_REASONING_MAX_LENGTH);
  if (reasoningError) {
    return JSON.stringify({ success: false, error: reasoningError });
  }

  // Verify symbol exists
  const stock = XSTOCKS_CATALOG.find(
    (s) => s.symbol.toLowerCase() === args.symbol.toLowerCase(),
  );
  if (!stock) {
    return JSON.stringify({
      success: false,
      error: `Unknown symbol: ${args.symbol}. Use get_stock_prices to see available stocks.`,
    });
  }

  // Enforce wallet policy guardrails
  const policyCheck = enforcePolicy(ctx.agentId, stock.symbol, args.side, args.amount);
  if (!policyCheck.allowed) {
    return JSON.stringify({
      success: false,
      error: `Policy rejected: ${policyCheck.reason}`,
      note: "Use get_wallet_status to check your current trading limits.",
    });
  }

  try {
    let result;
    if (args.side === "buy") {
      result = await executeBuy({
        agentId: ctx.agentId,
        stockSymbol: stock.symbol,
        usdcAmount: args.amount.toFixed(USDC_DISPLAY_DECIMALS),
      });
    } else {
      result = await executeSell({
        agentId: ctx.agentId,
        stockSymbol: stock.symbol,
        usdcAmount: "0",
        stockQuantity: args.amount.toFixed(XSTOCK_DISPLAY_DECIMALS),
      });
    }

    // Record successful trade in policy tracker
    const tradeUsdcAmount = parseFloat(result.usdcAmount);
    recordTrade(ctx.agentId, stock.symbol, tradeUsdcAmount);

    return JSON.stringify({
      success: true,
      tradeId: result.tradeId,
      txSignature: result.txSignature,
      side: result.side,
      symbol: result.stockSymbol,
      quantity: result.stockQuantity,
      usdcAmount: result.usdcAmount,
      pricePerToken: result.pricePerToken,
      reasoning: args.reasoning,
    });
  } catch (err) {
    const msg = errorMessage(err);
    return JSON.stringify({
      success: false,
      error: msg,
      note: msg.includes("slippage")
        ? "Trade rejected due to excessive slippage. Try a smaller amount or different stock."
        : msg.includes("insufficient")
          ? "Insufficient balance. Use get_wallet_status to check your balances."
          : "Trade execution failed. Check error details and try again.",
    });
  }
}

// ---------------------------------------------------------------------------
// get_wallet_status — Wallet balances + policy limits
// ---------------------------------------------------------------------------

async function executeGetWalletStatus(ctx: ToolContext): Promise<string> {
  try {
    const [walletStatus, tradeStats] = await Promise.all([
      getAgentWalletStatus(ctx.agentId),
      Promise.resolve(getAgentTradeStats(ctx.agentId)),
    ]);

    const policy = getAgentPolicy(ctx.agentId);

    return JSON.stringify({
      publicKey: walletStatus.publicKey,
      solBalance: walletStatus.solBalance,
      hasMinimumSol: walletStatus.hasMinimumSol,
      xStockHoldings: walletStatus.xStockHoldings.map((h) => ({
        symbol: h.symbol,
        name: h.name,
        amount: h.amount,
      })),
      tradingPolicy: {
        enabled: policy.enabled,
        maxTradeSize: policy.maxTradeSize,
        dailyVolumeUsed: tradeStats.dailyVolumeUsed,
        dailyVolumeLimit: tradeStats.dailyVolumeLimit,
        tradesLastHour: tradeStats.tradesLastHour,
        maxTradesPerHour: tradeStats.maxTradesPerHour,
        tradesLast24h: tradeStats.tradesLast24h,
      },
      lastCheckedAt: walletStatus.lastCheckedAt,
    });
  } catch (err) {
    return JSON.stringify({
      error: errorMessage(err),
      note: "Could not fetch wallet status. Wallet may not be configured for this agent.",
    });
  }
}
