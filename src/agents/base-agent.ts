/**
 * Base Agent Types & Abstract Class
 *
 * Defines the core interfaces and abstract base class for all AI trading agents
 * competing on MoltApp. Agents are autonomous tool-calling agents that gather
 * their own information via tools and persist investment theses across rounds.
 */

import { executeTool, type ToolContext } from "./trading-tools.ts";
import { SKILL_TEMPLATE } from "./skill-template.ts";
import { recordLlmUsage } from "../services/llm-cost-tracker.ts";
import { errorMessage } from "../lib/errors.ts";

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

/** A complete tool trace entry for audit/benchmark */
export interface ToolTraceEntry {
  turn: number;
  tool: string;
  arguments: Record<string, any>;
  result: string;
  timestamp: string;
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
  /** Complete tool call trace for audit/benchmark */
  toolTrace?: ToolTraceEntry[];
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
  provider: "anthropic" | "openai" | "xai" | "google";
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
  /** Cheap model for research/tool-calling phase (defaults to main model) */
  researchModel?: string;
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
  /** Token usage from this LLM call (if available) */
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
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

/** Max tool-calling turns in research phase before forcing a decision */
const MAX_TURNS = 6;

/** Max total tool calls in research phase before forcing a decision */
const MAX_TOOL_CALLS = 12;

// ---------------------------------------------------------------------------
// Context Truncation & Display Limit Constants
// ---------------------------------------------------------------------------

/**
 * Maximum number of top-moving stocks to show in the initial user message.
 * Controls how many movers the agent sees before starting research.
 * Higher values give more market context; lower values keep the message concise.
 * @example 10 movers → "AAPL: $182.50 (+1.2%), TSLA: $245.00 (-0.8%), ..."
 */
const TOP_MOVERS_DISPLAY_LIMIT = 10;

/**
 * Maximum characters to show from tool call arguments in console logs.
 * Prevents overly long log lines when tool arguments are large JSON objects.
 * @example JSON.stringify({symbols: ["AAPL","TSLA","NVDA",...]}).slice(0, 80)
 */
const TOOL_ARGS_LOG_PREVIEW_LENGTH = 80;

/**
 * Maximum length (characters) of tool results stored in the tool trace.
 * Limits per-entry size in the trace array used for benchmark/audit output.
 * Excess is replaced with "...[truncated]" marker.
 * @example 2000 chars ≈ ~500 tokens, keeps trace readable without losing key data
 */
const TOOL_TRACE_RESULT_MAX_LENGTH = 2000;

/**
 * Maximum length (characters) of executed trade results shown in research brief.
 * Truncates long trade confirmations (signature, fill details) to key information.
 * @example 300 chars captures tx hash + filled price + quantity
 */
const TRADE_RESULT_BRIEF_LENGTH = 300;

/**
 * Maximum characters of tool call arguments shown per entry in research brief.
 * Keeps the research brief compact while preserving tool identity.
 * @example 100 chars captures symbol list and key parameters
 */
const BRIEF_TOOL_ARGS_LENGTH = 100;

/**
 * Maximum characters of tool result shown per entry in research brief.
 * Balances data richness vs token consumption in the decision model's input.
 * @example 500 chars ≈ ~125 tokens per tool entry, 12 tools = ~1500 tokens
 */
const BRIEF_TOOL_RESULT_LENGTH = 500;

/**
 * Maximum total length (characters) of the compiled research brief.
 * ~1500 tokens at ~4 chars/token. Prevents context window overload in decision phase.
 * Excess is replaced with "\n\n...[research data truncated]" marker.
 * @example 6000 chars ≈ 1500 tokens for research data + ~200 tokens for decision prompt
 */
const RESEARCH_BRIEF_MAX_LENGTH = 6000;

/**
 * Maximum characters of raw LLM response shown in error messages.
 * Provides enough context to diagnose parsing failures without flooding logs.
 * @example 200 chars shows the start of a malformed JSON response for debugging
 */
const LLM_ERROR_PREVIEW_LENGTH = 200;

// ---------------------------------------------------------------------------
// Decision Parsing Constants
// ---------------------------------------------------------------------------

/**
 * Default confidence score when the LLM omits or provides a non-numeric value.
 * Neutral midpoint (50/100) signals uncertainty without biasing toward high or low.
 * @example LLM returns `{"action":"buy","symbol":"AAPLx"}` (no confidence field)
 *   → confidence defaults to CONFIDENCE_DEFAULT (50) = neutral / uncertain
 */
const CONFIDENCE_DEFAULT = 50;

/**
 * Minimum valid confidence score (inclusive).
 * Ensures clamped output stays within the 0-100 scale expected by benchmark scoring.
 */
const CONFIDENCE_MIN = 0;

/**
 * Maximum valid confidence score (inclusive).
 * Ensures clamped output stays within the 0-100 scale expected by benchmark scoring.
 * Formula: Math.max(CONFIDENCE_MIN, Math.min(CONFIDENCE_MAX, parsed.confidence))
 * @example confidence = 120 → clamped to CONFIDENCE_MAX (100)
 */
const CONFIDENCE_MAX = 100;

/** Minimal system prompt for the research phase (~80 tokens) */
const RESEARCH_SYSTEM_PROMPT = `You are a trading research assistant. Gather market data using the available tools. Steps:
1. Check portfolio positions and active theses (get_portfolio, get_active_theses)
2. Get prices and news for relevant stocks (get_stock_prices, search_news)
3. Check technical indicators (get_technical_indicators)
4. Update or manage theses as needed (update_thesis, close_thesis)
5. Check wallet status before trading (get_wallet_status)
6. If you have high conviction, get a quote first (get_execution_quote) then execute (execute_trade)
Call tools systematically to gather comprehensive data. You may execute trades directly if conviction is high.`;

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
    messages: unknown[],
    tools: unknown[],
  ): Promise<AgentTurn>;

  /** Get tools in the provider's native format */
  abstract getProviderTools(): unknown[];

  /** Build initial messages array from a user message string */
  abstract buildInitialMessages(userMessage: string): unknown[];

  /** Append tool results to the conversation messages */
  abstract appendToolResults(
    messages: unknown[],
    turn: AgentTurn,
    results: ToolResult[],
  ): unknown[];

  /** Append a user message to the conversation (for forced decision prompts) */
  abstract appendUserMessage(messages: unknown[], text: string): unknown[];

  /**
   * Make a single LLM call using the cheap research model.
   * Defaults to callWithTools() (same model). Subclasses override to use cheaper models.
   */
  callWithToolsForResearch(
    system: string,
    messages: unknown[],
    tools: unknown[],
  ): Promise<AgentTurn> {
    return this.callWithTools(system, messages, tools);
  }

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
      const message = errorMessage(error);
      console.error(`[${this.config.name}] Agent loop failed: ${message}`);
      return this.fallbackHold(message);
    }
  }

  // -------------------------------------------------------------------------
  // Tool-Calling Loop
  // -------------------------------------------------------------------------

  /**
   * Two-phase agent loop:
   * Phase 1 (Research): Cheap model gathers data via tool calls
   * Phase 2 (Decision): Expensive model receives full skill.md + compiled research brief
   */
  protected async runAgentLoop(
    marketData: MarketData[],
    portfolio: PortfolioContext,
  ): Promise<TradingDecision> {
    // System prompt from skill.md with agent-specific overrides (used in decision phase)
    const system = loadSkillPrompt(this.config.skillOverrides);

    // Build initial user message with top movers summary
    const topMovers = [...marketData]
      .filter((d) => d.change24h !== null)
      .sort((a, b) => Math.abs(b.change24h!) - Math.abs(a.change24h!))
      .slice(0, TOP_MOVERS_DISPLAY_LIMIT)
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

    // Tool context for executing tool calls
    const ctx: ToolContext = {
      agentId: this.config.agentId,
      portfolio,
      marketData,
    };

    // Capture complete tool trace for audit/benchmark
    const toolTrace: ToolTraceEntry[] = [];
    let totalToolCalls = 0;

    // Track LLM token usage separately for research and decision phases
    const researchUsage = { inputTokens: 0, outputTokens: 0 };
    const decisionUsage = { inputTokens: 0, outputTokens: 0 };

    // Helper to record usage to database before returning
    const recordUsage = async () => {
      const roundId = `round_${Date.now()}`;
      const researchModel = this.config.researchModel ?? this.config.model;
      if (researchUsage.inputTokens > 0 || researchUsage.outputTokens > 0) {
        await recordLlmUsage({
          roundId,
          agentId: this.config.agentId,
          model: researchModel,
          inputTokens: researchUsage.inputTokens,
          outputTokens: researchUsage.outputTokens,
        }).catch((err) => console.error(`[${this.config.name}] Failed to record research usage:`, err));
      }
      if (decisionUsage.inputTokens > 0 || decisionUsage.outputTokens > 0) {
        await recordLlmUsage({
          roundId,
          agentId: this.config.agentId,
          model: this.config.model,
          inputTokens: decisionUsage.inputTokens,
          outputTokens: decisionUsage.outputTokens,
        }).catch((err) => console.error(`[${this.config.name}] Failed to record decision usage:`, err));
      }
    };

    // ---- Phase 1: Research (cheap model with minimal system prompt) ----
    const researchModel = this.config.researchModel ?? this.config.model;
    console.log(`[${this.config.name}] Research phase (${researchModel})`);

    let messages = this.buildInitialMessages(userMessage);

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const agentTurn = await this.callWithToolsForResearch(RESEARCH_SYSTEM_PROMPT, messages, tools);

      // Accumulate research usage
      if (agentTurn.usage) {
        researchUsage.inputTokens += agentTurn.usage.inputTokens;
        researchUsage.outputTokens += agentTurn.usage.outputTokens;
      }

      if (agentTurn.stopReason === "tool_use" && agentTurn.toolCalls.length > 0) {
        // Check if we're at the tool call limit
        if (totalToolCalls + agentTurn.toolCalls.length >= MAX_TOOL_CALLS) {
          console.log(
            `[${this.config.name}] Tool call limit reached (${totalToolCalls}/${MAX_TOOL_CALLS}). Moving to decision phase.`,
          );
          break;
        }

        // Execute all tool calls
        const results: ToolResult[] = [];
        for (const tc of agentTurn.toolCalls) {
          totalToolCalls++;
          console.log(
            `[${this.config.name}] Tool call #${totalToolCalls}/${MAX_TOOL_CALLS}: ${tc.name}(${JSON.stringify(tc.arguments).slice(0, TOOL_ARGS_LOG_PREVIEW_LENGTH)})`,
          );
          const result = await executeTool(tc.name, tc.arguments, ctx);
          results.push({ toolCallId: tc.id, result });

          // Record to tool trace for benchmark
          toolTrace.push({
            turn: turn + 1,
            tool: tc.name,
            arguments: tc.arguments,
            result: result.length > TOOL_TRACE_RESULT_MAX_LENGTH ? result.slice(0, TOOL_TRACE_RESULT_MAX_LENGTH) + "...[truncated]" : result,
            timestamp: new Date().toISOString(),
          });
        }

        // Append assistant turn + tool results to messages
        messages = this.appendToolResults(messages, agentTurn, results);
        continue;
      }

      // Research model stopped calling tools — move to decision phase
      break;
    }

    // ---- Phase 2: Decision (expensive model with full skill.md, NO tools) ----
    console.log(`[${this.config.name}] Decision phase (${this.config.model})`);
    const researchBrief = this.compileResearchBrief(toolTrace, userMessage);
    const decisionMessages = this.buildInitialMessages(researchBrief);

    try {
      const decisionTurn = await this.callWithTools(system, decisionMessages, []);

      // Accumulate decision usage
      if (decisionTurn.usage) {
        decisionUsage.inputTokens += decisionTurn.usage.inputTokens;
        decisionUsage.outputTokens += decisionTurn.usage.outputTokens;
      }

      if (decisionTurn.textResponse) {
        const decision = this.parseLLMResponse(decisionTurn.textResponse);
        decision.toolTrace = toolTrace;
        await recordUsage();
        return decision;
      }
    } catch (err) {
      console.warn(`[${this.config.name}] Decision phase failed: ${errorMessage(err)}`);
    }

    const fallback = this.fallbackHold("Decision phase failed to produce a valid response");
    fallback.toolTrace = toolTrace;
    await recordUsage();
    return fallback;
  }

  // -------------------------------------------------------------------------
  // Shared Helpers
  // -------------------------------------------------------------------------

  /**
   * Compile tool trace into a concise research brief for the decision model.
   * Includes round context and all tool results, truncated to ~1500 tokens (~6000 chars).
   */
  protected compileResearchBrief(toolTrace: ToolTraceEntry[], userMessage: string): string {
    let brief = `ROUND CONTEXT:\n${userMessage}\n\nRESEARCH DATA GATHERED (${toolTrace.length} tool calls):\n`;

    // Check if any trades were executed during research phase
    const executedTrades = toolTrace.filter((e) => e.tool === "execute_trade");
    if (executedTrades.length > 0) {
      brief += `\nTRADES ALREADY EXECUTED THIS ROUND (${executedTrades.length}):\n`;
      for (const trade of executedTrades) {
        brief += `- ${trade.result.slice(0, TRADE_RESULT_BRIEF_LENGTH)}\n`;
      }
      brief += "\n";
    }

    for (const entry of toolTrace) {
      const args = JSON.stringify(entry.arguments).slice(0, BRIEF_TOOL_ARGS_LENGTH);
      brief += `\n--- ${entry.tool}(${args}) ---\n`;
      brief += entry.result.slice(0, BRIEF_TOOL_RESULT_LENGTH) + "\n";
    }

    // Truncate to ~1500 tokens (~6000 chars) to keep decision model input reasonable
    if (brief.length > RESEARCH_BRIEF_MAX_LENGTH) {
      brief = brief.slice(0, RESEARCH_BRIEF_MAX_LENGTH) + "\n\n...[research data truncated]";
    }

    brief += "\n\nBased on ALL the research above, output ONLY a valid JSON trading decision with: action (buy/sell/hold), symbol, quantity (USDC for buys, shares for sells, 0 for holds), reasoning, confidence (0-100), sources (array of data sources used), intent, predictedOutcome, thesisStatus.";
    if (executedTrades.length > 0) {
      brief += " NOTE: Trades were already executed during research. Your decision should reflect what ADDITIONAL action (if any) to take, or 'hold' if the executed trades are sufficient.";
    }

    return brief;
  }

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
      throw new Error(`No JSON object found in LLM response: ${raw.slice(0, LLM_ERROR_PREVIEW_LENGTH)}`);
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
      parsed.confidence = CONFIDENCE_DEFAULT;
    }
    parsed.confidence = Math.max(CONFIDENCE_MIN, Math.min(CONFIDENCE_MAX, parsed.confidence));

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
