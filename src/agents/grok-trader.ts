/**
 * Grok Trader Agent
 *
 * Autonomous tool-calling contrarian trader powered by xAI Grok
 * via the OpenAI-compatible API. Uses the shared skill.md prompt
 * template with contrarian strategy overrides.
 */

import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import {
  BaseTradingAgent,
  type AgentTurn,
  type ToolResult,
} from "./base-agent.ts";
import { getOpenAITools } from "./trading-tools.ts";
import {
  buildOpenAIMessages,
  appendOpenAIToolResults,
  createOpenAICompatibleCaller,
} from "./openai-compatible-utils.ts";
import { createXAIClientGetter } from "./client-factory.ts";

// ---------------------------------------------------------------------------
// Grok Agent Configuration
// ---------------------------------------------------------------------------

const GROK_AGENT_CONFIG = {
  agentId: "grok-contrarian",
  name: "Grok 4",
  model: "grok-4",
  provider: "xai" as const,
  description:
    "Flagship autonomous trading agent powered by xAI Grok 4 — frontier reasoning model with real-time X/Twitter sentiment.",
  personality: "Contrarian thinker with access to real-time X/Twitter sentiment and breaking news.",
  tradingStyle: "News-driven catalyst trading with contrarian positioning.",
  riskTolerance: "moderate" as const,
  maxPositionSize: 25,
  maxPortfolioAllocation: 80,
  temperature: 0.7,
  skillOverrides: {
    AGENT_NAME: "Grok 4",
  },
};

// ---------------------------------------------------------------------------
// Grok Trader Implementation (OpenAI-compatible API)
// ---------------------------------------------------------------------------

export class GrokTrader extends BaseTradingAgent {
  callWithTools: (
    system: string,
    messages: ChatCompletionMessageParam[],
    tools: ChatCompletionTool[],
  ) => Promise<AgentTurn>;

  constructor() {
    super(GROK_AGENT_CONFIG);
    const getClient = createXAIClientGetter();
    this.callWithTools = createOpenAICompatibleCaller(
      getClient,
      this.config.model,
      this.config.temperature,
    );
  }

  // -----------------------------------------------------------------------
  // Provider-specific tool-calling implementation
  // -----------------------------------------------------------------------

  getProviderTools(): ChatCompletionTool[] {
    return getOpenAITools();
  }

  buildInitialMessages(userMessage: string): ChatCompletionMessageParam[] {
    return buildOpenAIMessages(userMessage);
  }

  appendUserMessage(messages: ChatCompletionMessageParam[], text: string): ChatCompletionMessageParam[] {
    return [...messages, { role: "user", content: text }];
  }

  appendToolResults(
    messages: ChatCompletionMessageParam[],
    turn: AgentTurn,
    results: ToolResult[],
  ): ChatCompletionMessageParam[] {
    return appendOpenAIToolResults(messages, turn, results);
  }
}

/**
 * Singleton Grok trader instance.
 */
export const grokTrader = new GrokTrader();
