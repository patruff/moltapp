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
  temperature: 0.6,
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
