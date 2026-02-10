/**
 * Gemini Trader Agent
 *
 * Autonomous tool-calling analytical trader powered by Google Gemini
 * via the OpenAI-compatible API. Uses the shared skill.md prompt
 * template with analytical/data-driven strategy overrides.
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
import { createGeminiClientGetter } from "./client-factory.ts";

// ---------------------------------------------------------------------------
// Gemini Agent Configuration
// ---------------------------------------------------------------------------

const GEMINI_AGENT_CONFIG = {
  agentId: "gemini-analyst",
  name: "Gemini 2.5 Flash",
  model: "gemini-2.5-flash-preview-05-20",
  provider: "google" as const,
  description:
    "Analytical trading agent powered by Google Gemini 2.5 Flash — fast multimodal reasoning with strong quantitative analysis.",
  personality: "Data-driven analyst with systematic quantitative approach and pattern recognition.",
  tradingStyle: "Quantitative analysis with systematic position sizing and risk management.",
  riskTolerance: "moderate" as const,
  maxPositionSize: 25,
  maxPortfolioAllocation: 80,
  temperature: 0.7,
  skillOverrides: {
    AGENT_NAME: "Gemini 2.5 Flash",
  },
};

// ---------------------------------------------------------------------------
// Gemini Trader Implementation (OpenAI-compatible API)
// ---------------------------------------------------------------------------

export class GeminiTrader extends BaseTradingAgent {
  callWithTools: (
    system: string,
    messages: ChatCompletionMessageParam[],
    tools: ChatCompletionTool[],
  ) => Promise<AgentTurn>;

  constructor() {
    super(GEMINI_AGENT_CONFIG);
    const getClient = createGeminiClientGetter();
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
 * Singleton Gemini trader instance.
 */
export const geminiTrader = new GeminiTrader();
