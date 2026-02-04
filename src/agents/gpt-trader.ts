/**
 * GPT Trader Agent
 *
 * Autonomous tool-calling momentum trader powered by OpenAI GPT.
 * Uses the shared skill.md prompt template with momentum strategy overrides.
 */

import OpenAI from "openai";
import {
  BaseTradingAgent,
  type AgentTurn,
  type ToolCall,
  type ToolResult,
} from "./base-agent.ts";
import { getOpenAITools } from "./trading-tools.ts";

// ---------------------------------------------------------------------------
// GPT Agent Configuration
// ---------------------------------------------------------------------------

const GPT_AGENT_CONFIG = {
  agentId: "gpt-momentum-trader",
  name: "GPT MomentumBot",
  model: "gpt-4o-mini",
  provider: "openai" as const,
  description:
    "Aggressive growth and momentum trader that rides trends, buys breakouts, and cuts losers fast. Prefers high-beta tech and growth stocks with strong price action.",
  personality:
    "Aggressive momentum trader. Rides trends, cuts losers fast, lets winners run.",
  tradingStyle:
    "Trend-following — buys breakouts with strong momentum and volume.",
  riskTolerance: "aggressive" as const,
  maxPositionSize: 25,
  maxPortfolioAllocation: 85,
  skillOverrides: {
    AGENT_NAME: "GPT MomentumBot",
    STRATEGY:
      "You are an aggressive momentum trader who thrives on volatility and price action. You follow the trend — 'the trend is your friend'. You look for stocks breaking out to new highs with strong volume. You move fast, cut losses quickly at -5% (stop loss), and let winners run. You love high-growth tech stocks: NVDA, TSLA, PLTR, COIN, MSTR. Build a portfolio of trending names. Rotate slowly out of weakening names. Up to 85% in stocks, only 15% cash.",
    RISK_TOLERANCE: "aggressive",
    PREFERRED_SECTORS:
      "High-beta tech, growth stocks, crypto-adjacent (COIN, MSTR)",
    CUSTOM_RULES:
      "**Stop-Loss Rule:** If any position is down more than 5% from your entry, SELL it immediately. Cut losers fast.",
  },
};

// ---------------------------------------------------------------------------
// GPT Trader Implementation
// ---------------------------------------------------------------------------

export class GPTTrader extends BaseTradingAgent {
  private client: OpenAI | null = null;

  constructor() {
    super(GPT_AGENT_CONFIG);
  }

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

  // -----------------------------------------------------------------------
  // Provider-specific tool-calling implementation
  // -----------------------------------------------------------------------

  getProviderTools() {
    return getOpenAITools();
  }

  buildInitialMessages(userMessage: string): any[] {
    return [{ role: "user" as const, content: userMessage }];
  }

  appendToolResults(
    messages: any[],
    turn: AgentTurn,
    results: ToolResult[],
  ): any[] {
    // Build the assistant message with tool_calls
    const assistantMsg: any = {
      role: "assistant",
      content: turn.textResponse ?? null,
      tool_calls: turn.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.arguments),
        },
      })),
    };

    // Build individual tool result messages
    const toolMsgs = results.map((r) => ({
      role: "tool" as const,
      tool_call_id: r.toolCallId,
      content: r.result,
    }));

    return [...messages, assistantMsg, ...toolMsgs];
  }

  async callWithTools(
    system: string,
    messages: any[],
    tools: any[],
  ): Promise<AgentTurn> {
    const client = this.getClient();

    const response = await client.chat.completions.create({
      model: this.config.model,
      max_tokens: 2048,
      temperature: 0.5,
      messages: [{ role: "system", content: system }, ...messages],
      tools,
    });

    const choice = response.choices[0];
    if (!choice) {
      return { toolCalls: [], textResponse: null, stopReason: "end_turn" };
    }

    const msg = choice.message;
    const toolCalls: ToolCall[] = (msg.tool_calls ?? [])
      .filter((tc): tc is Extract<typeof tc, { type: "function" }> => tc.type === "function")
      .map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments || "{}"),
      }));

    let stopReason: AgentTurn["stopReason"] = "end_turn";
    if (choice.finish_reason === "tool_calls") stopReason = "tool_use";
    else if (choice.finish_reason === "length") stopReason = "max_tokens";

    return {
      toolCalls,
      textResponse: msg.content ?? null,
      stopReason,
    };
  }
}

/**
 * Singleton GPT trader instance.
 */
export const gptTrader = new GPTTrader();
