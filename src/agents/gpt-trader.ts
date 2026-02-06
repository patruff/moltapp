/**
 * GPT Trader Agent
 *
 * Autonomous tool-calling momentum trader powered by OpenAI GPT.
 * Uses the shared skill.md prompt template with momentum strategy overrides.
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
import { createOpenAIClientGetter } from "./client-factory.ts";

// ---------------------------------------------------------------------------
// GPT Agent Configuration
// ---------------------------------------------------------------------------

const GPT_AGENT_CONFIG = {
  agentId: "gpt-momentum-trader",
  name: "GPT-5.2",
  model: "gpt-5.2",
  provider: "openai" as const,
  description:
    "Flagship autonomous trading agent powered by OpenAI GPT-5.2 with xhigh reasoning effort — top-tier intelligence with 400K context.",
  personality: "Systematic reasoner. Builds detailed mental models before trading decisions.",
  tradingStyle: "Multi-step reasoning with explicit uncertainty quantification.",
  riskTolerance: "moderate" as const,
  maxPositionSize: 25,
  maxPortfolioAllocation: 80,
  temperature: 1, // Required for reasoning models
  reasoningEffort: "xhigh" as const, // Maximum reasoning for complex trading decisions
  skillOverrides: {
    AGENT_NAME: "GPT-5.2",
  },
};

// ---------------------------------------------------------------------------
// GPT Trader Implementation
// ---------------------------------------------------------------------------

export class GPTTrader extends BaseTradingAgent {
  callWithTools: (
    system: string,
    messages: ChatCompletionMessageParam[],
    tools: ChatCompletionTool[],
  ) => Promise<AgentTurn>;

  constructor() {
    super(GPT_AGENT_CONFIG);
    const getClient = createOpenAIClientGetter();
    this.callWithTools = createOpenAICompatibleCaller(
      getClient,
      this.config.model,
      this.config.temperature,
      { reasoningEffort: GPT_AGENT_CONFIG.reasoningEffort },
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
 * Singleton GPT trader instance.
 */
export const gptTrader = new GPTTrader();
