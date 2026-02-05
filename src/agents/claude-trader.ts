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
  name: "Opus 4.5",
  model: "claude-opus-4-5-20251101",
  provider: "anthropic" as const,
  description:
    "Flagship autonomous trading agent powered by Anthropic Claude Opus 4.5 — the most capable reasoning model.",
  personality: "Deep analytical thinker. Builds sophisticated multi-factor theses with extended reasoning.",
  tradingStyle: "Thesis-driven portfolio construction with rigorous risk management.",
  riskTolerance: "moderate" as const,
  maxPositionSize: 25,
  maxPortfolioAllocation: 80,
  temperature: 1, // Opus 4.5 uses extended thinking, temperature must be 1
  skillOverrides: {
    AGENT_NAME: "Opus 4.5",
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
      temperature: this.config.temperature,
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
