/**
 * Base Agent Types & Abstract Class
 *
 * Defines the core interfaces and abstract base class for all AI trading agents
 * competing on MoltApp. Agents are autonomous tool-calling agents that gather
 * their own information via tools and persist investment theses across rounds.
 */

import { executeTool, type ToolContext } from "./trading-tools.ts";
import { SKILL_TEMPLATE } from "./skill-template.ts";

// ---------------------------------------------------------------------------
// Core Types
// ---------------------------------------------------------------------------

/** Real-time market data for a single stock */
export interface MarketData {
  symbol: string;
  name: string;
  mintAddress: string;
  price: number;
  change24h: number | null;
  volume24h: number | null;
  news?: string[];
}

/** A structured trade decision from an AI agent */
export interface TradingDecision {
  action: "buy" | "sell" | "hold";
  symbol: string;
  /** Quantity in USDC for buys, stock units for sells. 0 for hold. */
  quantity: number;
  /** The agent's reasoning behind this decision */
  reasoning: string;
  /** Confidence score 0-100 */
  confidence: number;
  /** ISO timestamp when decision was made */
  timestamp: string;
  /** Data sources the agent cited */
  sources?: string[];
  /** Trading intent classification */
  intent?: string;
  /** What the agent predicts will happen */
  predictedOutcome?: string;
  /** Portfolio thesis status — why holding, or what changed */
  thesisStatus?: string;
}

/** Portfolio position for agent context */
export interface AgentPosition {
  symbol: string;
  quantity: number;
  averageCostBasis: number;
  currentPrice: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
}

/** Agent's current portfolio state for decision context */
export interface PortfolioContext {
  cashBalance: number;
  positions: AgentPosition[];
  totalValue: number;
  totalPnl: number;
  totalPnlPercent: number;
}

/** Configuration for an AI trading agent */
export interface AgentConfig {
  agentId: string;
  name: string;
  model: string;
  provider: "anthropic" | "openai" | "xai";
  description: string;
  personality: string;
  riskTolerance: "conservative" | "moderate" | "aggressive";
  tradingStyle: string;
  maxPositionSize: number;
  maxPortfolioAllocation: number;
  /** Temperature for API calls (0.0-1.0) */
  temperature: number;
  walletAddress?: string;
  /** Optional overrides for skill.md template placeholders */
  skillOverrides?: Record<string, string>;
}

/** Aggregate stats for an agent */
export interface AgentStats {
  totalTrades: number;
  winRate: number;
  totalPnl: number;
  totalPnlPercent: number;
  bestTrade: { symbol: string; pnl: number } | null;
  worstTrade: { symbol: string; pnl: number } | null;
  averageConfidence: number;
  averageHoldingPeriod: number;
  sharpeRatio: number | null;
}

/** Result of a trading round for a single agent */
export interface TradingRoundResult {
  agentId: string;
  agentName: string;
  decision: TradingDecision;
  executed: boolean;
  executionError?: string;
  executionDetails?: {
    txSignature?: string;
    filledPrice?: number;
    filledQuantity?: number;
    usdcAmount?: number;
  };
}

// ---------------------------------------------------------------------------
// Tool-Calling Types
// ---------------------------------------------------------------------------

/** A tool call from the LLM */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

/** Result of executing a tool call */
export interface ToolResult {
  toolCallId: string;
  result: string;
}

/** A single turn in the agent conversation */
export interface AgentTurn {
  toolCalls: ToolCall[];
  textResponse: string | null;
  stopReason: "tool_use" | "end_turn" | "max_tokens";
}

// ---------------------------------------------------------------------------
// Skill Template Loader
// ---------------------------------------------------------------------------

const SKILL_DEFAULTS: Record<string, string> = {
  AGENT_NAME: "Trading Agent",
  STRATEGY:
    "You are an autonomous AI trading agent. Develop your OWN strategy based on your research using the available tools. There are 66 tokenized stocks (xStocks) available across all sectors — tech, healthcare, finance, consumer, energy, industrials, ETFs, and more. Scan the full market each round. Build a diversified portfolio of 5-8 stocks. Document your reasoning via theses. HOLD unless your thesis changes materially or a genuinely high-conviction opportunity appears.",
  RISK_TOLERANCE: "moderate",
  PREFERRED_SECTORS: "All sectors — scan the full 66-stock universe each round",
  CUSTOM_RULES: "",
};

let skillTemplate: string | null = null;

function getSkillTemplate(): string {
  if (!skillTemplate) {
    // Use embedded template (works in Lambda where file system access is limited)
    skillTemplate = SKILL_TEMPLATE;
  }
  return skillTemplate;
}

export function loadSkillPrompt(overrides?: Record<string, string>): string {
  let skill = getSkillTemplate();
  const merged = { ...SKILL_DEFAULTS, ...overrides };
  for (const [key, value] of Object.entries(merged)) {
    skill = skill.replaceAll(`{{${key}}}`, value);
  }
  return skill;
}

// ---------------------------------------------------------------------------
// Abstract Base Class
// ---------------------------------------------------------------------------

/** Max tool-calling turns before forcing a decision */
const MAX_TURNS = 8;

/**
 * Abstract base class for all AI trading agents.
 *
 * Subclasses implement provider-specific tool-calling methods.
 * The base class orchestrates the tool-calling loop via runAgentLoop().
 */
export abstract class BaseTradingAgent {
  readonly config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = config;
  }

  get agentId(): string {
    return this.config.agentId;
  }

  get name(): string {
    return this.config.name;
  }

  get model(): string {
    return this.config.model;
  }

  get provider(): string {
    return this.config.provider;
  }

  // -------------------------------------------------------------------------
  // Abstract methods — each provider implements its own tool-calling API
  // -------------------------------------------------------------------------

  /** Make a single LLM call with tools and return the response turn */
  abstract callWithTools(
    system: string,
    messages: any[],
    tools: any[],
  ): Promise<AgentTurn>;

  /** Get tools in the provider's native format */
  abstract getProviderTools(): any[];

  /** Build initial messages array from a user message string */
  abstract buildInitialMessages(userMessage: string): any[];

  /** Append tool results to the conversation messages */
  abstract appendToolResults(
    messages: any[],
    turn: AgentTurn,
    results: ToolResult[],
  ): any[];

  // -------------------------------------------------------------------------
  // Public API — analyze() delegates to the tool-calling loop
  // -------------------------------------------------------------------------

  /**
   * Analyze market data and portfolio context to produce a trading decision.
   * This is the main entry point called by the orchestrator.
   */
  async analyze(
    marketData: MarketData[],
    portfolio: PortfolioContext,
  ): Promise<TradingDecision> {
    try {
      return await this.runAgentLoop(marketData, portfolio);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[${this.config.name}] Agent loop failed: ${message}`);
      return this.fallbackHold(message);
    }
  }

  // -------------------------------------------------------------------------
  // Tool-Calling Loop
  // -------------------------------------------------------------------------

  /**
   * Run the autonomous tool-calling loop:
   * 1. Load skill.md as system prompt
   * 2. Build initial user message with top movers summary
   * 3. Loop: call LLM → if tool calls, execute tools → if text, parse decision
   * 4. Return TradingDecision
   */
  protected async runAgentLoop(
    marketData: MarketData[],
    portfolio: PortfolioContext,
  ): Promise<TradingDecision> {
    // System prompt from skill.md with agent-specific overrides
    const system = loadSkillPrompt(this.config.skillOverrides);

    // Build initial user message with top movers summary
    const topMovers = [...marketData]
      .filter((d) => d.change24h !== null)
      .sort((a, b) => Math.abs(b.change24h!) - Math.abs(a.change24h!))
      .slice(0, 10)
      .map(
        (d) =>
          `${d.symbol}: $${d.price.toFixed(2)} (${d.change24h! >= 0 ? "+" : ""}${d.change24h!.toFixed(2)}%)`,
      )
      .join(", ");

    const positionSummary =
      portfolio.positions.length > 0
        ? portfolio.positions
            .map((p) => `${p.symbol} (${p.unrealizedPnlPercent >= 0 ? "+" : ""}${p.unrealizedPnlPercent.toFixed(1)}%)`)
            .join(", ")
        : "no positions yet";

    const userMessage = `New trading round. Top movers: ${topMovers}. You have ${portfolio.positions.length} positions (${positionSummary}), $${portfolio.cashBalance.toFixed(2)} cash, $${portfolio.totalValue.toFixed(2)} total value. Use your tools to research, then decide.`;

    // Get tools in provider format
    const tools = this.getProviderTools();
    let messages = this.buildInitialMessages(userMessage);

    // Tool context for executing tool calls
    const ctx: ToolContext = {
      agentId: this.config.agentId,
      portfolio,
      marketData,
    };

    // Tool-calling loop
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const agentTurn = await this.callWithTools(system, messages, tools);

      if (agentTurn.stopReason === "tool_use" && agentTurn.toolCalls.length > 0) {
        // Execute all tool calls
        const results: ToolResult[] = [];
        for (const tc of agentTurn.toolCalls) {
          console.log(
            `[${this.config.name}] Tool call: ${tc.name}(${JSON.stringify(tc.arguments).slice(0, 100)})`,
          );
          const result = await executeTool(tc.name, tc.arguments, ctx);
          results.push({ toolCallId: tc.id, result });
        }

        // Append assistant turn + tool results to messages
        messages = this.appendToolResults(messages, agentTurn, results);
        continue;
      }

      // Text response — try to parse a trading decision
      if (agentTurn.textResponse) {
        try {
          return this.parseLLMResponse(agentTurn.textResponse);
        } catch (err) {
          console.warn(
            `[${this.config.name}] Failed to parse response on turn ${turn + 1}: ${err instanceof Error ? err.message : String(err)}`,
          );
          // If max_tokens, try partial parse; otherwise continue
          if (agentTurn.stopReason === "max_tokens") {
            return this.fallbackHold("Response truncated (max_tokens)");
          }
          // If end_turn but parse failed, give up
          if (agentTurn.stopReason === "end_turn") {
            return this.fallbackHold(
              `Could not parse decision: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }

      // No text and no tool calls — shouldn't happen, but guard against it
      if (!agentTurn.textResponse && agentTurn.toolCalls.length === 0) {
        return this.fallbackHold("Empty response from LLM");
      }
    }

    // Exhausted all turns without a decision
    return this.fallbackHold("Max turns exceeded (8)");
  }

  // -------------------------------------------------------------------------
  // Shared Helpers
  // -------------------------------------------------------------------------

  /**
   * Parse and validate an LLM response into a TradingDecision.
   * Handles common LLM response quirks (markdown wrapping, extra text).
   */
  protected parseLLMResponse(raw: string): TradingDecision {
    // Strip markdown code fences if present
    let cleaned = raw.trim();
    if (cleaned.startsWith("```json")) {
      cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith("```")) {
      cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith("```")) {
      cleaned = cleaned.slice(0, -3);
    }
    cleaned = cleaned.trim();

    // Try to find JSON object in the response
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`No JSON object found in LLM response: ${raw.slice(0, 200)}`);
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate required fields
    if (!parsed.action || !["buy", "sell", "hold"].includes(parsed.action)) {
      throw new Error(`Invalid action: ${parsed.action}`);
    }
    if (!parsed.symbol || typeof parsed.symbol !== "string") {
      throw new Error(`Invalid symbol: ${parsed.symbol}`);
    }
    if (typeof parsed.quantity !== "number" || parsed.quantity < 0) {
      parsed.quantity = 0;
    }
    if (typeof parsed.confidence !== "number") {
      parsed.confidence = 50;
    }
    parsed.confidence = Math.max(0, Math.min(100, parsed.confidence));

    if (!parsed.reasoning || typeof parsed.reasoning !== "string") {
      parsed.reasoning = "No reasoning provided";
    }

    // Extract benchmark fields (sources, intent, predictedOutcome)
    const sources: string[] = Array.isArray(parsed.sources)
      ? parsed.sources.filter((s: unknown) => typeof s === "string")
      : [];

    const intent = typeof parsed.intent === "string" ? parsed.intent : undefined;
    const predictedOutcome = typeof parsed.predictedOutcome === "string" ? parsed.predictedOutcome : undefined;
    const thesisStatus = typeof parsed.thesisStatus === "string" ? parsed.thesisStatus : undefined;

    return {
      action: parsed.action,
      symbol: parsed.symbol,
      quantity: parsed.quantity,
      reasoning: parsed.reasoning,
      confidence: parsed.confidence,
      timestamp: new Date().toISOString(),
      sources: sources.length > 0 ? sources : undefined,
      intent,
      predictedOutcome,
      thesisStatus,
    };
  }

  /**
   * Create a fallback "hold" decision when the agent encounters an error.
   */
  protected fallbackHold(reason: string): TradingDecision {
    return {
      action: "hold",
      symbol: "SPYx",
      quantity: 0,
      reasoning: `Agent error — defaulting to hold: ${reason}`,
      confidence: 0,
      timestamp: new Date().toISOString(),
    };
  }
}
