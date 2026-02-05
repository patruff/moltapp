/**
 * GPT Trader Agent
 *
 * Autonomous tool-calling momentum trader powered by OpenAI GPT.
 * Uses the shared skill.md prompt template with momentum strategy overrides.
 */

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
  model: "gpt-5.2-xhigh",
  provider: "openai" as const,
  description:
    "Flagship autonomous trading agent powered by OpenAI GPT-5.2 (xhigh) — top-tier intelligence with 400K context.",
  personality: "Systematic reasoner. Builds detailed mental models before trading decisions.",
  tradingStyle: "Multi-step reasoning with explicit uncertainty quantification.",
  riskTolerance: "moderate" as const,
  maxPositionSize: 25,
  maxPortfolioAllocation: 80,
  temperature: 0.7,
  skillOverrides: {
    AGENT_NAME: "GPT-5.2",
  },
};

// ---------------------------------------------------------------------------
// GPT Trader Implementation
// ---------------------------------------------------------------------------

export class GPTTrader extends BaseTradingAgent {
  callWithTools: (system: string, messages: any[], tools: any[]) => Promise<AgentTurn>;

  constructor() {
    super(GPT_AGENT_CONFIG);
    const getClient = createOpenAIClientGetter();
    this.callWithTools = createOpenAICompatibleCaller(
      getClient,
      this.config.model,
      this.config.temperature,
    );
  }

  // -----------------------------------------------------------------------
  // Provider-specific tool-calling implementation
  // -----------------------------------------------------------------------

  getProviderTools() {
    return getOpenAITools();
  }

  buildInitialMessages(userMessage: string): any[] {
    return buildOpenAIMessages(userMessage);
  }

  appendToolResults(
    messages: any[],
    turn: AgentTurn,
    results: ToolResult[],
  ): any[] {
    return appendOpenAIToolResults(messages, turn, results);
  }
}

/**
 * Singleton GPT trader instance.
 */
export const gptTrader = new GPTTrader();
