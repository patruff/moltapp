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
  temperature: 0.5,
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
