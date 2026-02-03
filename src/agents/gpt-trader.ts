/**
 * GPT Trader Agent
 *
 * Aggressive momentum trader powered by OpenAI's GPT-4o.
 * Focuses on technical signals, momentum, and growth stocks.
 * Trades more frequently and takes larger positions than Claude.
 */

import OpenAI from "openai";
import {
  BaseTradingAgent,
  type MarketData,
  type PortfolioContext,
  type TradingDecision,
} from "./base-agent.ts";

// ---------------------------------------------------------------------------
// GPT Agent Configuration
// ---------------------------------------------------------------------------

const GPT_AGENT_CONFIG = {
  agentId: "gpt-momentum-trader",
  name: "GPT MomentumBot",
  model: "gpt-4o",
  provider: "openai" as const,
  description:
    "Aggressive growth and momentum trader that rides trends, buys breakouts, and cuts losers fast. Prefers high-beta tech and growth stocks with strong price action.",
  personality: `You are an aggressive momentum trader who thrives on volatility and price action.
You follow the trend — "the trend is your friend" — and look for stocks breaking out to new highs.
You move fast, cut losses quickly, and let winners run.
You love high-growth tech stocks, especially those with explosive earnings or catalysts.
You're confident, sometimes cocky, and always have a strong opinion.
When you see momentum, you go big. When momentum fades, you rotate fast.`,
  tradingStyle:
    "Momentum trading — buys breakouts, rides trends, cuts losers at -5%. Loves NVDA, TSLA, PLTR, COIN, MSTR. Prefers high-beta names with strong volume. Uses 24h price change as primary signal.",
  riskTolerance: "aggressive" as const,
  maxPositionSize: 25, // Max 25% of portfolio in one stock
  maxPortfolioAllocation: 85, // Up to 85% in stocks, only 15% cash
};

// ---------------------------------------------------------------------------
// GPT Trader Implementation
// ---------------------------------------------------------------------------

export class GPTTrader extends BaseTradingAgent {
  private client: OpenAI | null = null;

  constructor() {
    super(GPT_AGENT_CONFIG);
  }

  /**
   * Lazily initialize the OpenAI client.
   */
  private getClient(): OpenAI {
    if (!this.client) {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error(
          "OPENAI_API_KEY environment variable is not set. GPT agent cannot trade.",
        );
      }
      this.client = new OpenAI({ apiKey });
    }
    return this.client;
  }

  /**
   * Analyze market data using GPT-4o for momentum-based trading decisions.
   *
   * GPT is prompted as an aggressive momentum trader. It focuses heavily on
   * 24h price changes and volume to identify breakouts and trend continuations.
   */
  async analyze(
    marketData: MarketData[],
    portfolio: PortfolioContext,
  ): Promise<TradingDecision> {
    try {
      const client = this.getClient();

      const systemPrompt = this.buildSystemPrompt();
      const userPrompt = this.buildUserPrompt(marketData, portfolio);

      // Add momentum-specific instructions
      const momentumAddendum = `

MOMENTUM SIGNALS TO WATCH:
- Stocks up >2% in 24h = potential breakout, consider buying
- Stocks down >3% in 24h = momentum loss, consider selling if held
- High volume + positive price = strong bullish signal
- Look for the STRONGEST movers and ride the trend
- Cut any position that's down more than 5% from entry (stop loss)`;

      const response = await client.chat.completions.create({
        model: this.config.model,
        max_tokens: 1024,
        temperature: 0.5, // Moderate temperature for more varied momentum plays
        messages: [
          {
            role: "system",
            content: systemPrompt + momentumAddendum,
          },
          {
            role: "user",
            content: userPrompt,
          },
        ],
        response_format: { type: "json_object" },
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        return this.fallbackHold("GPT returned empty response");
      }

      const decision = this.parseLLMResponse(content);

      // Apply momentum-specific guardrails
      return this.applyMomentumGuardrails(decision, portfolio, marketData);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[GPTTrader] Analysis failed: ${message}`);
      return this.fallbackHold(message);
    }
  }

  /**
   * Apply momentum-specific guardrails.
   * - Enforce stop-loss on losing positions
   * - Cap position sizes (still aggressive but bounded)
   * - Ensure minimum cash for transaction fees
   */
  private applyMomentumGuardrails(
    decision: TradingDecision,
    portfolio: PortfolioContext,
    marketData: MarketData[],
  ): TradingDecision {
    // Check for stop-loss triggers on existing positions
    for (const pos of portfolio.positions) {
      if (pos.unrealizedPnlPercent <= -5) {
        // Force sell losers — overrides the LLM's decision
        return {
          action: "sell",
          symbol: pos.symbol,
          quantity: pos.quantity,
          reasoning: `[STOP-LOSS TRIGGERED] ${pos.symbol} is down ${pos.unrealizedPnlPercent.toFixed(1)}% from entry. Cutting losses. Original plan was: ${decision.action} ${decision.symbol}.`,
          confidence: 95,
          timestamp: new Date().toISOString(),
        };
      }
    }

    // For buys, enforce position limits
    if (decision.action === "buy") {
      const maxBuy =
        portfolio.totalValue * (this.config.maxPositionSize / 100);
      if (decision.quantity > maxBuy) {
        decision.quantity = Math.floor(maxBuy * 100) / 100;
        decision.reasoning += ` [GUARDRAIL: Capped at ${this.config.maxPositionSize}% = $${decision.quantity.toFixed(2)}]`;
      }

      // Keep minimum cash for fees
      const minCash = Math.max(
        10,
        portfolio.totalValue * ((100 - this.config.maxPortfolioAllocation) / 100),
      );
      const cashAfterTrade = portfolio.cashBalance - decision.quantity;
      if (cashAfterTrade < minCash) {
        const adjusted = Math.max(0, portfolio.cashBalance - minCash);
        if (adjusted <= 0) {
          return {
            ...decision,
            action: "hold",
            quantity: 0,
            reasoning: `[GUARDRAIL] Not enough cash. Need $${minCash.toFixed(2)} reserve. Cash: $${portfolio.cashBalance.toFixed(2)}. ${decision.reasoning}`,
          };
        }
        decision.quantity = Math.floor(adjusted * 100) / 100;
        decision.reasoning += ` [GUARDRAIL: Reduced to $${decision.quantity.toFixed(2)} for cash reserve]`;
      }

      // Validate the stock exists in market data
      const stockExists = marketData.some(
        (d) => d.symbol.toLowerCase() === decision.symbol.toLowerCase(),
      );
      if (!stockExists) {
        return {
          ...decision,
          action: "hold",
          quantity: 0,
          reasoning: `[GUARDRAIL] Symbol ${decision.symbol} not found in available market data. ${decision.reasoning}`,
        };
      }
    }

    // For sells, validate we hold the position
    if (decision.action === "sell") {
      const position = portfolio.positions.find(
        (p) => p.symbol.toLowerCase() === decision.symbol.toLowerCase(),
      );
      if (!position) {
        return {
          ...decision,
          action: "hold",
          quantity: 0,
          reasoning: `[GUARDRAIL] Cannot sell ${decision.symbol} — no position held. ${decision.reasoning}`,
        };
      }
      if (decision.quantity > position.quantity) {
        decision.quantity = position.quantity;
        decision.reasoning += ` [GUARDRAIL: Sell quantity capped at held amount: ${position.quantity}]`;
      }
    }

    return decision;
  }
}

/**
 * Singleton GPT trader instance.
 */
export const gptTrader = new GPTTrader();
