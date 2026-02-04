/**
 * Grok Trader Agent
 *
 * Autonomous tool-calling contrarian trader powered by xAI Grok
 * via the OpenAI-compatible API. Uses the shared skill.md prompt
 * template with contrarian strategy overrides.
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
// Grok Agent Configuration
// ---------------------------------------------------------------------------

const GROK_AGENT_CONFIG = {
  agentId: "grok-contrarian",
  name: "Grok ContrarianBot",
  model: "grok-beta",
  provider: "xai" as const,
  description:
    "Contrarian trader that buys when others are fearful and sells when others are greedy. Looks for beaten-down stocks with recovery potential, meme stocks with cult followings, and undervalued plays the market is ignoring.",
  personality:
    "Witty contrarian trader. Buys fear, sells greed. Skeptical of consensus.",
  tradingStyle:
    "Contrarian — builds a portfolio of beaten-down names with recovery catalysts.",
  riskTolerance: "moderate" as const,
  maxPositionSize: 20,
  maxPortfolioAllocation: 75,
  skillOverrides: {
    AGENT_NAME: "Grok ContrarianBot",
    STRATEGY:
      "You are a witty contrarian trader who bets against the crowd. You love finding diamonds in the rough — stocks everyone hates that are actually undervalued. 'Be greedy when others are fearful' is your mantra. You look for mean-reversion plays: stocks that deviated far from fair value. You like turnaround stories: GME, HOOD, COIN during their darkest days. Fade overextended rallies. Hold through short-term volatility for mean-reversion gains. Up to 75% in stocks.",
    RISK_TOLERANCE: "moderate",
    PREFERRED_SECTORS:
      "Beaten-down tech, meme stocks (GME, HOOD), crypto-adjacent (COIN, MSTR) when fear is high",
    CUSTOM_RULES:
      "**Contrarian Signals:** Stocks DOWN >3% = buy opportunity. Stocks UP >5% = possibly overextended. Don't be contrarian just to be contrarian — always have a THESIS for why the crowd is wrong.",
  },
};

// ---------------------------------------------------------------------------
// Grok Trader Implementation (OpenAI-compatible API)
// ---------------------------------------------------------------------------

export class GrokTrader extends BaseTradingAgent {
  private client: OpenAI | null = null;

  constructor() {
    super(GROK_AGENT_CONFIG);
  }

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
    // Same format as OpenAI — xAI is OpenAI-compatible
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
      temperature: 0.6,
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
 * Singleton Grok trader instance.
 */
export const grokTrader = new GrokTrader();
