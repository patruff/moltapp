/**
 * Claude Trader Agent
 *
 * Autonomous tool-calling value investor powered by Anthropic Claude.
 * Uses the shared skill.md prompt template with value-investing overrides.
 */

import type Anthropic from "@anthropic-ai/sdk";
import {
  BaseTradingAgent,
  type AgentTurn,
  type ToolCall,
  type ToolResult,
} from "./base-agent.ts";
import { getAnthropicTools } from "./trading-tools.ts";
import { createAnthropicClientGetter } from "./client-factory.ts";

// ---------------------------------------------------------------------------
// Claude Agent Configuration
// ---------------------------------------------------------------------------

const CLAUDE_AGENT_CONFIG = {
  agentId: "claude-value-investor",
  name: "Claude ValueBot",
  model: "claude-haiku-4-5-20251101",
  provider: "anthropic" as const,
  description:
    "Conservative value investor that focuses on fundamentals, undervalued companies, and strong risk management. Prefers large-cap stocks with proven earnings and maintains significant cash reserves.",
  personality:
    "Disciplined value investor. Patient, methodical, prefers margin of safety.",
  tradingStyle:
    "Value investing — builds a portfolio of 8-12 blue-chip conviction stocks.",
  riskTolerance: "conservative" as const,
  maxPositionSize: 15,
  maxPortfolioAllocation: 60,
  skillOverrides: {
    AGENT_NAME: "Claude ValueBot",
    STRATEGY:
      "You are a disciplined value investor in the tradition of Warren Buffett and Benjamin Graham. You believe in margin of safety, buying wonderful companies at fair prices, and being fearful when others are greedy. You are patient and methodical — you'd rather miss a trade than make a bad one. Prefer mega-caps (AAPL, MSFT, GOOGL, NVDA) with proven fundamentals. Build a portfolio of 8-12 blue-chip conviction stocks. Only sell when fundamentals deteriorate. Keep at least 40% cash buffer.",
    RISK_TOLERANCE: "conservative",
    PREFERRED_SECTORS: "Mega-cap tech, healthcare, finance — proven blue chips",
    CUSTOM_RULES: "",
  },
};

// ---------------------------------------------------------------------------
// Claude Trader Implementation
// ---------------------------------------------------------------------------

export class ClaudeTrader extends BaseTradingAgent {
  private getClient: () => Anthropic;

  constructor() {
    super(CLAUDE_AGENT_CONFIG);
    this.getClient = createAnthropicClientGetter();
  }

  // -----------------------------------------------------------------------
  // Provider-specific tool-calling implementation
  // -----------------------------------------------------------------------

  getProviderTools() {
    return getAnthropicTools();
  }

  buildInitialMessages(userMessage: string): any[] {
    return [{ role: "user", content: userMessage }];
  }

  appendToolResults(
    messages: any[],
    turn: AgentTurn,
    results: ToolResult[],
  ): any[] {
    // Build the assistant message with tool_use blocks
    const assistantContent: any[] = [];

    // Add text if present
    if (turn.textResponse) {
      assistantContent.push({ type: "text", text: turn.textResponse });
    }

    // Add tool_use blocks
    for (const tc of turn.toolCalls) {
      assistantContent.push({
        type: "tool_use",
        id: tc.id,
        name: tc.name,
        input: tc.arguments,
      });
    }

    // Build tool_result user message
    const toolResultContent = results.map((r) => ({
      type: "tool_result" as const,
      tool_use_id: r.toolCallId,
      content: r.result,
    }));

    return [
      ...messages,
      { role: "assistant", content: assistantContent },
      { role: "user", content: toolResultContent },
    ];
  }

  async callWithTools(
    system: string,
    messages: any[],
    tools: any[],
  ): Promise<AgentTurn> {
    const client = this.getClient();

    const response = await client.messages.create({
      model: this.config.model,
      max_tokens: 2048,
      system,
      messages,
      tools,
      temperature: 0.3,
    });

    // Parse response
    const toolCalls: ToolCall[] = [];
    let textResponse: string | null = null;

    for (const block of response.content) {
      if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, any>,
        });
      } else if (block.type === "text") {
        textResponse = (textResponse ?? "") + block.text;
      }
    }

    let stopReason: AgentTurn["stopReason"] = "end_turn";
    if (response.stop_reason === "tool_use") stopReason = "tool_use";
    else if (response.stop_reason === "max_tokens") stopReason = "max_tokens";

    return { toolCalls, textResponse, stopReason };
  }
}

/**
 * Singleton Claude trader instance.
 */
export const claudeTrader = new ClaudeTrader();
