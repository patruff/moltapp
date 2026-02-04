/**
 * Grok Trader Agent
 *
 * Autonomous tool-calling contrarian trader powered by xAI Grok
 * via the OpenAI-compatible API. Uses the shared skill.md prompt
 * template with contrarian strategy overrides.
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
import { createXAIClientGetter } from "./client-factory.ts";

// ---------------------------------------------------------------------------
// Grok Agent Configuration
// ---------------------------------------------------------------------------

const GROK_AGENT_CONFIG = {
  agentId: "grok-contrarian",
  name: "Grok Beta",
  model: "grok-beta",
  provider: "xai" as const,
  description:
    "Autonomous trading agent powered by xAI Grok Beta.",
  personality: "Autonomous AI trader. Develops its own strategy from market data.",
  tradingStyle: "Self-directed — uses tools to research and form its own views.",
  riskTolerance: "moderate" as const,
  maxPositionSize: 25,
  maxPortfolioAllocation: 80,
  temperature: 0.6,
  skillOverrides: {
    AGENT_NAME: "Grok Beta",
  },
};

// ---------------------------------------------------------------------------
// Grok Trader Implementation (OpenAI-compatible API)
// ---------------------------------------------------------------------------

export class GrokTrader extends BaseTradingAgent {
  callWithTools: (system: string, messages: any[], tools: any[]) => Promise<AgentTurn>;

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
 * Singleton Grok trader instance.
 */
export const grokTrader = new GrokTrader();
