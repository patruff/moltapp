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

// ---------------------------------------------------------------------------
// Tool Context — passed into executeTool for data access
// ---------------------------------------------------------------------------

export interface ToolContext {
  agentId: string;
  portfolio: PortfolioContext;
  marketData: MarketData[];
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
      "Search for recent news about a stock, sector, or market topic using Brave Search.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            'Search query (e.g. "NVDA earnings 2026", "tech sector outlook")',
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
  args: Record<string, any>,
  ctx: ToolContext,
): Promise<string> {
  switch (toolName) {
    case "get_portfolio":
      return executeGetPortfolio(ctx);

    case "get_stock_prices":
      return executeGetStockPrices(args, ctx);

    case "get_active_theses":
      return executeGetActiveTheses(ctx);

    case "update_thesis":
      return executeUpdateThesis(args, ctx);

    case "close_thesis":
      return executeCloseThesis(args, ctx);

    case "search_news":
      return executeSearchNews(args);

    case "get_technical_indicators":
      return executeGetTechnicalIndicators(args);

    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
}

// ---------------------------------------------------------------------------
// Tool Implementations
// ---------------------------------------------------------------------------

function executeGetPortfolio(ctx: ToolContext): string {
  const { portfolio } = ctx;
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
  });
}

function executeGetStockPrices(
  args: Record<string, any>,
  ctx: ToolContext,
): string {
  if (!Array.isArray(args.symbols)) {
    return JSON.stringify({ error: "symbols must be an array" });
  }
  const symbols: string[] = args.symbols ?? [];
  const data =
    symbols.length === 0
      ? ctx.marketData
      : ctx.marketData.filter((d) =>
          symbols.some(
            (s: string) => s.toLowerCase() === d.symbol.toLowerCase(),
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
      theses.map((t: any) => ({
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
  args: Record<string, any>,
  ctx: ToolContext,
): Promise<string> {
  if (!args.symbol || typeof args.symbol !== "string") {
    return JSON.stringify({ success: false, error: "symbol is required" });
  }
  if (!args.thesis || typeof args.thesis !== "string") {
    return JSON.stringify({ success: false, error: "thesis is required" });
  }
  if (!args.conviction || typeof args.conviction !== "string") {
    return JSON.stringify({ success: false, error: "conviction is required" });
  }
  if (!args.direction || !["bullish", "bearish", "neutral"].includes(args.direction)) {
    return JSON.stringify({ success: false, error: "direction must be bullish, bearish, or neutral" });
  }
  try {
    const result = await upsertThesis(ctx.agentId, {
      symbol: args.symbol,
      thesis: args.thesis,
      conviction: Math.max(1, Math.min(10, parseInt(args.conviction) || 5)),
      direction: args.direction ?? "neutral",
      entryPrice: args.entry_price,
      targetPrice: args.target_price,
    });
    return JSON.stringify({ success: true, ...result });
  } catch (err) {
    return JSON.stringify({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function executeCloseThesis(
  args: Record<string, any>,
  ctx: ToolContext,
): Promise<string> {
  if (!args.symbol || typeof args.symbol !== "string") {
    return JSON.stringify({ success: false, error: "symbol is required" });
  }
  if (!args.reason || typeof args.reason !== "string") {
    return JSON.stringify({ success: false, error: "reason is required" });
  }
  try {
    const result = await closeThesis(ctx.agentId, args.symbol, args.reason);
    return JSON.stringify({ success: true, ...result });
  } catch (err) {
    return JSON.stringify({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function executeSearchNews(args: Record<string, any>): Promise<string> {
  if (!args.query || typeof args.query !== "string") {
    return JSON.stringify({ results: [], error: "query is required" });
  }
  const query = args.query ?? "";
  const apiKey = process.env.BRAVE_API_KEY;
  if (!apiKey) {
    return JSON.stringify({
      results: [],
      note: "News search unavailable (no BRAVE_API_KEY)",
    });
  }

  try {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", "5");

    const res = await fetch(url.toString(), {
      headers: {
        "X-Subscription-Token": apiKey,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return JSON.stringify({
        results: [],
        error: `Search returned ${res.status}`,
      });
    }

    const data = (await res.json()) as any;
    const results = (data.web?.results ?? []).slice(0, 5).map((r: any) => ({
      title: r.title ?? "",
      description: (r.description ?? "").slice(0, 300),
      url: r.url ?? "",
    }));
    return JSON.stringify({ results });
  } catch (err) {
    return JSON.stringify({
      results: [],
      error: err instanceof Error ? err.message : "Search failed",
    });
  }
}

function executeGetTechnicalIndicators(args: Record<string, any>): string {
  if (!args.symbol || typeof args.symbol !== "string") {
    return JSON.stringify({ error: "symbol is required" });
  }
  const symbol = args.symbol ?? "";
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
