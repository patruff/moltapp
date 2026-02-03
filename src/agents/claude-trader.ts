/**
 * Claude Trader Agent
 *
 * Conservative value investor powered by Anthropic's Claude.
 * Focuses on fundamentals, risk management, and long-term value.
 * Tends to hold larger cash positions and only buys high-conviction plays.
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  BaseTradingAgent,
  type MarketData,
  type PortfolioContext,
  type TradingDecision,
} from "./base-agent.ts";

// ---------------------------------------------------------------------------
// Claude Agent Configuration
// ---------------------------------------------------------------------------

const CLAUDE_AGENT_CONFIG = {
  agentId: "claude-value-investor",
  name: "Claude ValueBot",
  model: "claude-sonnet-4-20250514",
  provider: "anthropic" as const,
  description:
    "Conservative value investor that focuses on fundamentals, undervalued companies, and strong risk management. Prefers large-cap stocks with proven earnings and maintains significant cash reserves.",
  personality: `You are a disciplined value investor in the tradition of Warren Buffett and Benjamin Graham.
You believe in margin of safety, buying wonderful companies at fair prices, and being fearful when others are greedy.
You are patient and methodical — you'd rather miss a trade than make a bad one.
You speak with measured confidence and always explain your thesis clearly.
When markets are overheated, you prefer to hold cash and wait for better entries.`,
  tradingStyle:
    "Value investing — seeks undervalued companies with strong fundamentals. Buys on dips, holds for long-term appreciation. Avoids momentum plays and speculation. Prefers blue-chip mega-caps (AAPL, MSFT, GOOGL, JPN).",
  riskTolerance: "conservative" as const,
  maxPositionSize: 15, // Max 15% of portfolio in one stock
  maxPortfolioAllocation: 60, // Max 60% in stocks, 40% cash buffer
};

// ---------------------------------------------------------------------------
// Claude Trader Implementation
// ---------------------------------------------------------------------------

export class ClaudeTrader extends BaseTradingAgent {
  private client: Anthropic | null = null;

  constructor() {
    super(CLAUDE_AGENT_CONFIG);
  }

  /**
   * Lazily initialize the Anthropic client.
   * Throws a descriptive error if the API key is not configured.
   */
  private getClient(): Anthropic {
    if (!this.client) {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error(
          "ANTHROPIC_API_KEY environment variable is not set. Claude agent cannot trade.",
        );
      }
      this.client = new Anthropic({ apiKey });
    }
    return this.client;
  }

  /**
   * Analyze market data using Claude to produce a trading decision.
   *
   * Claude is prompted as a conservative value investor. It analyzes current
   * prices, 24h changes, volume, and the agent's portfolio to decide whether
   * to buy, sell, or hold.
   */
  async analyze(
    marketData: MarketData[],
    portfolio: PortfolioContext,
  ): Promise<TradingDecision> {
    try {
      const client = this.getClient();

      const systemPrompt = this.buildSystemPrompt();
      const userPrompt = this.buildUserPrompt(marketData, portfolio);

      const response = await client.messages.create({
        model: this.config.model,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: userPrompt,
          },
        ],
        temperature: 0.3, // Low temperature for more consistent, conservative decisions
      });

      // Extract text from response
      const textBlock = response.content.find((block) => block.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        return this.fallbackHold("Claude returned no text response");
      }

      const decision = this.parseLLMResponse(textBlock.text);

      // Apply conservative guardrails
      return this.applyGuardrails(decision, portfolio);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[ClaudeTrader] Analysis failed: ${message}`);
      return this.fallbackHold(message);
    }
  }

  /**
   * Apply conservative guardrails specific to Claude's value investing style.
   * - Reject low-confidence trades (< 40%)
   * - Enforce position size limits
   * - Ensure sufficient cash buffer
   */
  private applyGuardrails(
    decision: TradingDecision,
    portfolio: PortfolioContext,
  ): TradingDecision {
    // Don't trade on low confidence
    if (decision.action !== "hold" && decision.confidence < 40) {
      return {
        ...decision,
        action: "hold",
        quantity: 0,
        reasoning: `[GUARDRAIL] Original confidence (${decision.confidence}%) below 40% threshold. Defaulting to hold. Original reasoning: ${decision.reasoning}`,
      };
    }

    // For buys, enforce position limits
    if (decision.action === "buy") {
      const maxBuy =
        portfolio.totalValue * (this.config.maxPositionSize / 100);
      if (decision.quantity > maxBuy) {
        decision.quantity = Math.floor(maxBuy * 100) / 100;
        decision.reasoning += ` [GUARDRAIL: Position capped at ${this.config.maxPositionSize}% of portfolio = $${decision.quantity.toFixed(2)}]`;
      }

      // Ensure cash buffer
      const minCash =
        portfolio.totalValue *
        ((100 - this.config.maxPortfolioAllocation) / 100);
      const cashAfterTrade = portfolio.cashBalance - decision.quantity;
      if (cashAfterTrade < minCash) {
        const adjustedQuantity = Math.max(
          0,
          portfolio.cashBalance - minCash,
        );
        if (adjustedQuantity <= 0) {
          return {
            ...decision,
            action: "hold",
            quantity: 0,
            reasoning: `[GUARDRAIL] Insufficient cash buffer. Need $${minCash.toFixed(2)} minimum cash (${100 - this.config.maxPortfolioAllocation}% of portfolio). Original: ${decision.reasoning}`,
          };
        }
        decision.quantity = Math.floor(adjustedQuantity * 100) / 100;
        decision.reasoning += ` [GUARDRAIL: Buy reduced to $${decision.quantity.toFixed(2)} to maintain ${100 - this.config.maxPortfolioAllocation}% cash buffer]`;
      }
    }

    return decision;
  }
}

/**
 * Singleton Claude trader instance.
 * All trading rounds share this instance to reuse the Anthropic client.
 */
export const claudeTrader = new ClaudeTrader();
