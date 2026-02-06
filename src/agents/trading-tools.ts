/**
 * Trading Tools — Tool definitions & central executor for autonomous agents
 *
 * 7 tools agents can call during their tool-calling loop:
 *   get_portfolio, get_stock_prices, get_active_theses,
 *   update_thesis, close_thesis, search_news, get_technical_indicators
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
import { errorMessage } from "../lib/errors.ts";

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

export type ToolArgs =
  | GetPortfolioArgs
  | GetStockPricesArgs
  | GetActiveThesesArgs
  | UpdateThesisArgs
  | CloseThesisArgs
  | SearchNewsArgs
  | GetTechnicalIndicatorsArgs
  | GetExecutionQuoteArgs;

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
  const thesisError = validateStringField(args.thesis, "thesis", 2000);
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
  const reasonError = validateStringField(args.reason, "reason", 1000);
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
  const queryError = validateStringField(args.query, "query", 500);
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
    url.searchParams.set("limit", "10");
    url.searchParams.set("apikey", apiKey);

    // Map freshness to time_from/time_to if needed
    // Alpha Vantage doesn't have direct freshness param, so we'll filter client-side
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(10000),
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
      ph: 60 * 60 * 1000, // 1 hour
      pd: 24 * 60 * 60 * 1000, // 1 day
      pw: 7 * 24 * 60 * 60 * 1000, // 1 week
      pm: 30 * 24 * 60 * 60 * 1000, // 1 month
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

    const results = filteredFeed.slice(0, 10).map((article) => ({
      title: article.title ?? "",
      description: (article.summary ?? "").slice(0, 400),
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
    url.searchParams.set("count", "15");
    url.searchParams.set("freshness", freshness);
    url.searchParams.set("text_decorations", "false");

    const res = await fetch(url.toString(), {
      headers: {
        "X-Subscription-Token": apiKey,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10000),
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
    const results = rawResults.slice(0, 10).map((r) => ({
      title: r.title ?? "",
      description: (r.description ?? "").slice(0, 400),
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
  if (args.amount > 1_000_000_000) {
    return JSON.stringify({ error: "amount exceeds maximum (1B)" });
  }
  if (args.amount < 0.01) {
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
      amountRaw = Math.floor(args.amount * 1_000_000).toString();
    } else {
      // Selling stock: Stock -> USDC
      inputMint = stock.mintAddress;
      outputMint = USDC_MINT_MAINNET;
      // Stock has 8 decimals (per catalog)
      amountRaw = Math.floor(args.amount * 100_000_000).toString();
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
      signal: AbortSignal.timeout(15000),
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
      inputAmount = inAmountParsed / 1_000_000;
      outputAmount = outAmountParsed / 100_000_000;
      effectivePrice = inputAmount / outputAmount;
    } else {
      // Input is stock (8 decimals), output is USDC (6 decimals)
      inputAmount = inAmountParsed / 100_000_000;
      outputAmount = outAmountParsed / 1_000_000;
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
    if (priceImpactPercent > 20) {
      priceNote = `WARNING: Mid-market price may be stale (${midMarketPrice.toFixed(2)} vs effective ${effectivePrice.toFixed(2)}). Price impact unreliable. Use effectivePrice as current market rate.`;
      priceImpactPercent = -1; // Signal unreliable
    } else if (priceImpactPercent > 1) {
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
