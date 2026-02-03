/**
 * Grok Trader Agent
 *
 * Contrarian trader powered by xAI's Grok via OpenAI-compatible API.
 * Looks for undervalued plays that others are ignoring. Buys fear, sells greed.
 * Favors beaten-down names with recovery potential.
 */

import OpenAI from "openai";
import {
  BaseTradingAgent,
  type MarketData,
  type PortfolioContext,
  type TradingDecision,
} from "./base-agent.ts";

// ---------------------------------------------------------------------------
// Grok Agent Configuration
// ---------------------------------------------------------------------------

const GROK_AGENT_CONFIG = {
  agentId: "grok-contrarian",
  name: "Grok ContrarianBot",
  model: "grok-3-mini-fast",
  provider: "xai" as const,
  description:
    "Contrarian trader that buys when others are fearful and sells when others are greedy. Looks for beaten-down stocks with recovery potential, meme stocks with cult followings, and undervalued plays the market is ignoring.",
  personality: `You are a witty contrarian trader who bets against the crowd.
You love finding diamonds in the rough — stocks everyone hates that are actually undervalued.
You're skeptical of consensus, suspicious of hype, and energized by sell-offs.
"Be greedy when others are fearful" is your mantra.
You have a dry sense of humor and often reference market history to support your thesis.
You love turnaround stories: GME, HOOD, COIN during their darkest days.
You're not reckless — you do your homework — but you're willing to take calculated bets on unpopular names.`,
  tradingStyle:
    "Contrarian — buys the dip aggressively, fades rallies in overextended names. Likes beaten-down stocks (GME, HOOD, COIN when down big). Sells winners that have run too far too fast. Moderate position sizing with conviction plays.",
  riskTolerance: "moderate" as const,
  maxPositionSize: 20, // Max 20% in one stock
  maxPortfolioAllocation: 75, // Up to 75% in stocks
};

// ---------------------------------------------------------------------------
// Grok Trader Implementation
// ---------------------------------------------------------------------------

export class GrokTrader extends BaseTradingAgent {
  private client: OpenAI | null = null;

  constructor() {
    super(GROK_AGENT_CONFIG);
  }

  /**
   * Lazily initialize the xAI client using OpenAI-compatible API.
   */
  private getClient(): OpenAI {
    if (!this.client) {
      const apiKey = process.env.XAI_API_KEY;
      if (!apiKey) {
        throw new Error(
          "XAI_API_KEY environment variable is not set. Grok agent cannot trade.",
        );
      }
      this.client = new OpenAI({
        apiKey,
        baseURL: "https://api.x.ai/v1",
      });
    }
    return this.client;
  }

  /**
   * Analyze market data using Grok for contrarian trading decisions.
   *
   * Grok looks for opportunities the crowd is missing: oversold stocks,
   * beaten-down names with recovery potential, and overextended rallies to fade.
   */
  async analyze(
    marketData: MarketData[],
    portfolio: PortfolioContext,
  ): Promise<TradingDecision> {
    try {
      const client = this.getClient();

      const systemPrompt = this.buildSystemPrompt();
      const userPrompt = this.buildUserPrompt(marketData, portfolio);

      // Add contrarian-specific instructions
      const contrarianAddendum = `

CONTRARIAN SIGNALS TO WATCH:
- Stocks DOWN >3% in 24h = potential buy opportunity (fear = opportunity)
- Stocks UP >5% in 24h = possibly overextended, consider taking profits if held
- Low volume + big drop = possible overreaction, look to buy
- Everyone's favorite stock hitting new highs = time to be cautious
- Look for MEAN REVERSION plays — stocks that deviated far from their normal price
- GameStop, Robinhood, Coinbase = your kind of stocks when they're beaten down
- Don't be contrarian just to be contrarian — have a THESIS for why the crowd is wrong`;

      const response = await client.chat.completions.create({
        model: this.config.model,
        max_tokens: 1024,
        temperature: 0.6, // Higher temperature for more creative contrarian plays
        messages: [
          {
            role: "system",
            content: systemPrompt + contrarianAddendum,
          },
          {
            role: "user",
            content: userPrompt,
          },
        ],
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        return this.fallbackHold("Grok returned empty response");
      }

      const decision = this.parseLLMResponse(content);

      // Apply contrarian-specific guardrails
      return this.applyContrarianGuardrails(decision, portfolio, marketData);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[GrokTrader] Analysis failed: ${message}`);
      return this.fallbackHold(message);
    }
  }

  /**
   * Apply contrarian-specific guardrails.
   * - Boost confidence on dip-buys (reward contrarian behavior)
   * - Prevent chasing rallies (penalize buying green)
   * - Enforce position and cash limits
   */
  private applyContrarianGuardrails(
    decision: TradingDecision,
    portfolio: PortfolioContext,
    marketData: MarketData[],
  ): TradingDecision {
    // If buying, check that we're buying weakness not strength
    if (decision.action === "buy") {
      const stock = marketData.find(
        (d) => d.symbol.toLowerCase() === decision.symbol.toLowerCase(),
      );

      if (stock && stock.change24h !== null) {
        // Warn (but allow) if buying a stock that's already up big
        if (stock.change24h > 3) {
          decision.reasoning += ` [CONTRARIAN WARNING: ${stock.symbol} is up ${stock.change24h.toFixed(1)}% today — this doesn't fit our contrarian thesis. Proceeding with reduced confidence.]`;
          decision.confidence = Math.max(10, decision.confidence - 20);
        }
        // Boost confidence on dip buys
        if (stock.change24h < -2) {
          decision.reasoning += ` [CONTRARIAN BOOST: ${stock.symbol} is down ${stock.change24h.toFixed(1)}% — classic buy-the-dip setup.]`;
          decision.confidence = Math.min(100, decision.confidence + 10);
        }
      }

      // Enforce position size limit
      const maxBuy =
        portfolio.totalValue * (this.config.maxPositionSize / 100);
      if (decision.quantity > maxBuy) {
        decision.quantity = Math.floor(maxBuy * 100) / 100;
        decision.reasoning += ` [GUARDRAIL: Capped at ${this.config.maxPositionSize}% = $${decision.quantity.toFixed(2)}]`;
      }

      // Cash buffer
      const minCash =
        portfolio.totalValue *
        ((100 - this.config.maxPortfolioAllocation) / 100);
      const cashAfterTrade = portfolio.cashBalance - decision.quantity;
      if (cashAfterTrade < minCash) {
        const adjusted = Math.max(0, portfolio.cashBalance - minCash);
        if (adjusted <= 0) {
          return {
            ...decision,
            action: "hold",
            quantity: 0,
            reasoning: `[GUARDRAIL] Cash reserve insufficient. Need $${minCash.toFixed(2)} minimum. ${decision.reasoning}`,
          };
        }
        decision.quantity = Math.floor(adjusted * 100) / 100;
        decision.reasoning += ` [GUARDRAIL: Reduced to $${decision.quantity.toFixed(2)} for cash reserve]`;
      }

      // Validate stock exists
      if (!stock) {
        return {
          ...decision,
          action: "hold",
          quantity: 0,
          reasoning: `[GUARDRAIL] Symbol ${decision.symbol} not in available market data. ${decision.reasoning}`,
        };
      }
    }

    // For sells, validate position exists
    if (decision.action === "sell") {
      const position = portfolio.positions.find(
        (p) => p.symbol.toLowerCase() === decision.symbol.toLowerCase(),
      );
      if (!position) {
        return {
          ...decision,
          action: "hold",
          quantity: 0,
          reasoning: `[GUARDRAIL] Cannot sell ${decision.symbol} — not held. ${decision.reasoning}`,
        };
      }
      if (decision.quantity > position.quantity) {
        decision.quantity = position.quantity;
        decision.reasoning += ` [GUARDRAIL: Sell capped at held quantity: ${position.quantity}]`;
      }

      // Contrarian: warn if selling a beaten-down stock (might be selling at the bottom)
      const stock = marketData.find(
        (d) => d.symbol.toLowerCase() === decision.symbol.toLowerCase(),
      );
      if (stock && stock.change24h !== null && stock.change24h < -3) {
        decision.reasoning += ` [CONTRARIAN NOTE: Selling while ${stock.symbol} is down ${stock.change24h.toFixed(1)}% — careful, this might be the bottom.]`;
      }
    }

    // Reject very low confidence
    if (decision.action !== "hold" && decision.confidence < 25) {
      return {
        ...decision,
        action: "hold",
        quantity: 0,
        reasoning: `[GUARDRAIL] Confidence ${decision.confidence}% too low (min 25%). ${decision.reasoning}`,
      };
    }

    return decision;
  }
}

/**
 * Singleton Grok trader instance.
 */
export const grokTrader = new GrokTrader();
