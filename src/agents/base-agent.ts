/**
 * Base Agent Types & Abstract Class
 *
 * Defines the core interfaces and abstract base class for all AI trading agents
 * competing on MoltApp. Each agent has a unique personality, LLM backend, and
 * trading strategy. They analyze market data and return structured trade decisions.
 */

// ---------------------------------------------------------------------------
// Core Types
// ---------------------------------------------------------------------------

/** Real-time market data for a single stock */
export interface MarketData {
  symbol: string;
  name: string;
  mintAddress: string;
  price: number;
  change24h: number | null;
  volume24h: number | null;
  news?: string[];
}

/** A structured trade decision from an AI agent */
export interface TradingDecision {
  action: "buy" | "sell" | "hold";
  symbol: string;
  /** Quantity in USDC for buys, stock units for sells. 0 for hold. */
  quantity: number;
  /** The agent's reasoning behind this decision */
  reasoning: string;
  /** Confidence score 0-100 */
  confidence: number;
  /** ISO timestamp when decision was made */
  timestamp: string;
}

/** Portfolio position for agent context */
export interface AgentPosition {
  symbol: string;
  quantity: number;
  averageCostBasis: number;
  currentPrice: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
}

/** Agent's current portfolio state for decision context */
export interface PortfolioContext {
  cashBalance: number;
  positions: AgentPosition[];
  totalValue: number;
  totalPnl: number;
  totalPnlPercent: number;
}

/** Configuration for an AI trading agent */
export interface AgentConfig {
  agentId: string;
  name: string;
  model: string;
  provider: "anthropic" | "openai" | "xai";
  description: string;
  personality: string;
  riskTolerance: "conservative" | "moderate" | "aggressive";
  tradingStyle: string;
  maxPositionSize: number;
  maxPortfolioAllocation: number;
  walletAddress?: string;
}

/** Aggregate stats for an agent */
export interface AgentStats {
  totalTrades: number;
  winRate: number;
  totalPnl: number;
  totalPnlPercent: number;
  bestTrade: { symbol: string; pnl: number } | null;
  worstTrade: { symbol: string; pnl: number } | null;
  averageConfidence: number;
  averageHoldingPeriod: number;
  sharpeRatio: number | null;
}

/** Result of a trading round for a single agent */
export interface TradingRoundResult {
  agentId: string;
  agentName: string;
  decision: TradingDecision;
  executed: boolean;
  executionError?: string;
  executionDetails?: {
    txSignature?: string;
    filledPrice?: number;
    filledQuantity?: number;
    usdcAmount?: number;
  };
}

// ---------------------------------------------------------------------------
// Abstract Base Class
// ---------------------------------------------------------------------------

/**
 * Abstract base class for all AI trading agents.
 *
 * Subclasses must implement `analyze()` which calls their respective LLM
 * to produce a TradingDecision. The base class provides common helpers for
 * prompt construction, decision validation, and error handling.
 */
export abstract class BaseTradingAgent {
  readonly config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = config;
  }

  get agentId(): string {
    return this.config.agentId;
  }

  get name(): string {
    return this.config.name;
  }

  get model(): string {
    return this.config.model;
  }

  get provider(): string {
    return this.config.provider;
  }

  // -------------------------------------------------------------------------
  // Abstract method — each agent implements its own LLM call
  // -------------------------------------------------------------------------

  /**
   * Analyze market data and portfolio context to produce a trading decision.
   * This is the core method each agent subclass must implement.
   */
  abstract analyze(
    marketData: MarketData[],
    portfolio: PortfolioContext,
  ): Promise<TradingDecision>;

  // -------------------------------------------------------------------------
  // Shared Helpers
  // -------------------------------------------------------------------------

  /**
   * Build the system prompt incorporating the agent's personality and strategy.
   */
  protected buildSystemPrompt(): string {
    return `You are ${this.config.name}, an AI stock trading agent on MoltApp — a competitive trading platform where AI agents trade real tokenized stocks on Solana.

PERSONALITY: ${this.config.personality}

TRADING STYLE: ${this.config.tradingStyle}

RISK TOLERANCE: ${this.config.riskTolerance}

RULES:
- You trade tokenized real stocks (xStocks) on Solana via Jupiter Protocol.
- Available stocks include: AAPLx, AMZNx, GOOGLx, METAx, MSFTx, NVDAx, TSLAx, SPYx, QQQx, COINx, MSTRx, HOODx, NFLXx, PLTRx, GMEx, and others.
- You compete against other AI agents on a public leaderboard ranked by P&L.
- Max position size: ${this.config.maxPositionSize}% of portfolio per stock.
- Max portfolio allocation: ${this.config.maxPortfolioAllocation}% in stocks (rest in USDC cash).
- You MUST respond with valid JSON only. No markdown, no explanation outside the JSON.

RESPONSE FORMAT (strict JSON):
{
  "action": "buy" | "sell" | "hold",
  "symbol": "STOCKx",
  "quantity": <number>,
  "reasoning": "<your analysis and reasoning>",
  "confidence": <0-100>
}

For "buy": quantity is USDC amount to spend.
For "sell": quantity is number of shares to sell.
For "hold": quantity should be 0, symbol can be any stock you analyzed.`;
  }

  /**
   * Build the user prompt with current market data and portfolio context.
   */
  protected buildUserPrompt(
    marketData: MarketData[],
    portfolio: PortfolioContext,
  ): string {
    const marketSection = marketData
      .map((d) => {
        const change = d.change24h !== null ? `${d.change24h > 0 ? "+" : ""}${d.change24h.toFixed(2)}%` : "N/A";
        const vol = d.volume24h !== null ? `$${(d.volume24h / 1_000_000).toFixed(1)}M` : "N/A";
        return `  ${d.symbol} (${d.name}): $${d.price.toFixed(2)} | 24h: ${change} | Vol: ${vol}`;
      })
      .join("\n");

    const positionSection =
      portfolio.positions.length > 0
        ? portfolio.positions
            .map((p) => {
              const pnlStr = `${p.unrealizedPnl >= 0 ? "+" : ""}$${p.unrealizedPnl.toFixed(2)} (${p.unrealizedPnlPercent >= 0 ? "+" : ""}${p.unrealizedPnlPercent.toFixed(1)}%)`;
              return `  ${p.symbol}: ${p.quantity.toFixed(4)} shares @ $${p.averageCostBasis.toFixed(2)} avg | Current: $${p.currentPrice.toFixed(2)} | PnL: ${pnlStr}`;
            })
            .join("\n")
        : "  (No open positions)";

    return `CURRENT MARKET DATA:
${marketSection}

YOUR PORTFOLIO:
  Cash (USDC): $${portfolio.cashBalance.toFixed(2)}
  Total Value: $${portfolio.totalValue.toFixed(2)}
  Total PnL: ${portfolio.totalPnl >= 0 ? "+" : ""}$${portfolio.totalPnl.toFixed(2)} (${portfolio.totalPnlPercent >= 0 ? "+" : ""}${portfolio.totalPnlPercent.toFixed(1)}%)

YOUR CURRENT POSITIONS:
${positionSection}

Analyze the market data and your portfolio. Make ONE trading decision. Respond with JSON only.`;
  }

  /**
   * Parse and validate an LLM response into a TradingDecision.
   * Handles common LLM response quirks (markdown wrapping, extra text).
   */
  protected parseLLMResponse(raw: string): TradingDecision {
    // Strip markdown code fences if present
    let cleaned = raw.trim();
    if (cleaned.startsWith("```json")) {
      cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith("```")) {
      cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith("```")) {
      cleaned = cleaned.slice(0, -3);
    }
    cleaned = cleaned.trim();

    // Try to find JSON object in the response
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`No JSON object found in LLM response: ${raw.slice(0, 200)}`);
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate required fields
    if (!parsed.action || !["buy", "sell", "hold"].includes(parsed.action)) {
      throw new Error(`Invalid action: ${parsed.action}`);
    }
    if (!parsed.symbol || typeof parsed.symbol !== "string") {
      throw new Error(`Invalid symbol: ${parsed.symbol}`);
    }
    if (typeof parsed.quantity !== "number" || parsed.quantity < 0) {
      parsed.quantity = 0;
    }
    if (typeof parsed.confidence !== "number") {
      parsed.confidence = 50;
    }
    parsed.confidence = Math.max(0, Math.min(100, parsed.confidence));

    if (!parsed.reasoning || typeof parsed.reasoning !== "string") {
      parsed.reasoning = "No reasoning provided";
    }

    return {
      action: parsed.action,
      symbol: parsed.symbol,
      quantity: parsed.quantity,
      reasoning: parsed.reasoning,
      confidence: parsed.confidence,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Create a fallback "hold" decision when the agent encounters an error.
   */
  protected fallbackHold(reason: string): TradingDecision {
    return {
      action: "hold",
      symbol: "SPYx",
      quantity: 0,
      reasoning: `Agent error — defaulting to hold: ${reason}`,
      confidence: 0,
      timestamp: new Date().toISOString(),
    };
  }
}
