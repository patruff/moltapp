/**
 * Portfolio Musings — "If I Had to Start Over" Reflections
 *
 * After each trading round (post-Meeting of Minds), each agent reflects:
 *   Phase 1: "If you had $20 USDC to invest from scratch today, how would you allocate?"
 *   Phase 2: "Here's your actual portfolio. Any regrets?"
 *
 * Produces two valuable datasets per round:
 * - Ideal portfolio allocation (what the agent WOULD do unencumbered by history)
 * - Regret analysis (gap between ideal and actual, honest self-assessment)
 *
 * Follows the same pattern as meeting-of-minds.ts: direct LLM calls per agent,
 * structured response parsing, in-memory history with accessor functions.
 */

import Anthropic from "@anthropic-ai/sdk";
import { ID_RANDOM_START, ID_RANDOM_LENGTH_SHORT, ID_RANDOM_LENGTH_STANDARD, ID_RANDOM_LENGTH_LONG } from "../config/constants.ts";
import OpenAI from "openai";
import type {
  TradingRoundResult,
  MarketData,
  AgentConfig,
  PortfolioContext,
} from "../agents/base-agent.ts";
import type { BaseTradingAgent } from "../agents/base-agent.ts";
import { errorMessage } from "../lib/errors.ts";
import { getPortfolioContext } from "../agents/orchestrator.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IdealAllocation {
  symbol: string;
  amountUsd: number;
  reasoning: string;
}

export interface AgentMusing {
  agentId: string;
  agentName: string;
  // Phase 1: Ideal portfolio
  idealPortfolio: IdealAllocation[];
  totalAllocated: number;
  strategy: string;
  idealPortfolioRaw: string;
  // Phase 2: Regrets
  biggestRegret: string;
  bestDecision: string;
  wouldChange: string;
  regretScore: number; // 0-10
  reflection: string;
  regretsRaw: string;
}

export interface MusingsResult {
  musingsId: string;
  roundId: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  musings: AgentMusing[];
  // Computed insights
  consensusStocks: string[];
  universalRegrets: string[];
  avgRegretScore: number;
}

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Maximum tokens per LLM response in musings.
 * Agents need more room than meetings to describe full portfolio allocations.
 * @default 500 - Allows detailed allocation reasoning across multiple stocks
 */
const MAX_RESPONSE_TOKENS = 500;

/**
 * LLM sampling temperature for musings responses.
 * Slightly higher than meetings to encourage creative/honest reflection.
 * @default 0.5 - Balanced between consistency and genuine introspection
 */
const MUSINGS_TEMPERATURE = 0.5;

/**
 * Hypothetical starting capital for the "fresh start" scenario.
 * @default 20 - $20 USDC, matching real agent funding levels
 */
const STARTING_CAPITAL = 20;

/**
 * Maximum musings results stored in memory.
 * Circular buffer: oldest removed when limit exceeded.
 * @default 50 - Matches meeting-of-minds history depth
 */
const MAX_MUSINGS_HISTORY = 50;

/**
 * Estimated cost per LLM message in USD (rough tracking).
 * @default 0.01 - Approximate cost for 500-token response
 */
const COST_PER_MESSAGE_USD = 0.01;

/**
 * Minimum number of agents that must pick a stock for it to be "consensus".
 * @default 2 - Majority of 3 agents
 */
const CONSENSUS_MIN_AGENTS = 2;

/**
 * Maximum regret score (upper bound clamp).
 * @default 10
 */
const REGRET_SCORE_MAX = 10;

/**
 * Minimum regret score (lower bound clamp).
 * @default 0
 */
const REGRET_SCORE_MIN = 0;

/**
 * Maximum number of top movers to include in the fresh-start scenario prompt.
 * Controls how many stocks (sorted by absolute 24h change) are highlighted.
 * @default 10 - Shows the 10 most volatile stocks for allocation consideration
 * Example: 30 stocks available → show top 10 movers + all 30 in compact table
 */
const TOP_MOVERS_DISPLAY_LIMIT = 10;

/**
 * Maximum characters of strategy description to show in console log output.
 * Truncates the agent's strategy field for compact log lines.
 * @default 60 - Fits one line without wrapping; shows intent without full verbosity
 * Example: "Diversify across tech and healthcare, avoid high-P/E stocks for now..."
 *           → "Diversify across tech and healthcare, avoid high-P/E stocks for"...
 */
const STRATEGY_DESCRIPTION_LOG_LENGTH = 60;

// ---------------------------------------------------------------------------
// In-Memory Storage
// ---------------------------------------------------------------------------

const musingsHistory: MusingsResult[] = [];

export function getMusingsByRoundId(roundId: string): MusingsResult | undefined {
  return musingsHistory.find((m) => m.roundId === roundId);
}

export function getLatestMusings(): MusingsResult | undefined {
  return musingsHistory.length > 0
    ? musingsHistory[musingsHistory.length - 1]
    : undefined;
}

export function getRecentMusings(limit: number): MusingsResult[] {
  return musingsHistory.slice(-limit).reverse();
}

// ---------------------------------------------------------------------------
// LLM Call Helpers (same pattern as meeting-of-minds.ts)
// ---------------------------------------------------------------------------

async function callClaudeForMusings(
  systemPrompt: string,
  userMessage: string,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return "[Claude unavailable — no API key]";

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: MAX_RESPONSE_TOKENS,
    temperature: MUSINGS_TEMPERATURE,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const block = response.content[0];
  return block.type === "text" ? block.text : "[no response]";
}

async function callOpenAIForMusings(
  systemPrompt: string,
  userMessage: string,
  model: string,
  baseURL?: string,
  apiKeyOverride?: string,
): Promise<string> {
  const apiKey = apiKeyOverride
    ?? (baseURL ? process.env.XAI_API_KEY : process.env.OPENAI_API_KEY);
  if (!apiKey) return `[${model} unavailable — no API key]`;

  const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
  const response = await client.chat.completions.create({
    model,
    max_tokens: MAX_RESPONSE_TOKENS,
    temperature: MUSINGS_TEMPERATURE,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
  });

  return response.choices?.[0]?.message?.content ?? "[no response]";
}

async function callAgentForMusings(
  agentConfig: AgentConfig,
  systemPrompt: string,
  userMessage: string,
): Promise<string> {
  switch (agentConfig.provider) {
    case "anthropic":
      return callClaudeForMusings(systemPrompt, userMessage);
    case "openai":
      return callOpenAIForMusings(systemPrompt, userMessage, agentConfig.model);
    case "xai":
      return callOpenAIForMusings(
        systemPrompt,
        userMessage,
        agentConfig.model,
        "https://api.x.ai/v1",
      );
    case "google":
      return callOpenAIForMusings(
        systemPrompt,
        userMessage,
        agentConfig.model,
        "https://generativelanguage.googleapis.com/v1beta/openai/",
        process.env.GOOGLE_API_KEY,
      );
    default:
      return "[unknown provider]";
  }
}

// ---------------------------------------------------------------------------
// Prompt Builders
// ---------------------------------------------------------------------------

function buildMusingsSystemPrompt(agentConfig: AgentConfig): string {
  return (
    `You are ${agentConfig.name}, an AI trading agent reflecting on your portfolio strategy. ` +
    `Your personality: ${agentConfig.personality} ` +
    `Your trading style: ${agentConfig.tradingStyle}\n\n` +
    `You are participating in a post-round reflection exercise. ` +
    `Be honest and introspective. Stay in character with your trading personality.`
  );
}

function buildFreshStartPrompt(marketData: MarketData[]): string {
  // Build market summary: top movers + compact table
  const sorted = [...marketData].sort((a, b) => {
    const aChange = Math.abs(a.change24h ?? 0);
    const bChange = Math.abs(b.change24h ?? 0);
    return bChange - aChange;
  });

  const topMovers = sorted.slice(0, TOP_MOVERS_DISPLAY_LIMIT);
  const moverLines = topMovers.map(
    (m) =>
      `  ${m.symbol}: $${m.price.toFixed(2)} (${(m.change24h ?? 0) >= 0 ? "+" : ""}${(m.change24h ?? 0).toFixed(1)}%)`,
  );

  const allSymbolLines = marketData.map(
    (m) =>
      `${m.symbol}: $${m.price.toFixed(2)} (${(m.change24h ?? 0) >= 0 ? "+" : ""}${(m.change24h ?? 0).toFixed(1)}%)`,
  );

  return (
    `SCENARIO: You have $${STARTING_CAPITAL} USDC to invest from scratch across these xStocks.\n` +
    `Forget your current portfolio — this is a clean slate.\n\n` +
    `TOP 10 MOVERS TODAY:\n${moverLines.join("\n")}\n\n` +
    `ALL AVAILABLE STOCKS:\n${allSymbolLines.join(" | ")}\n\n` +
    `Allocate your ideal $${STARTING_CAPITAL} portfolio. For each position:\n` +
    `- Symbol, amount in USDC, and why\n\n` +
    `Format your response EXACTLY as:\n` +
    `ALLOCATION:\n` +
    `- SYMBOL: $AMOUNT — REASONING\n` +
    `- SYMBOL: $AMOUNT — REASONING\n` +
    `...\n` +
    `TOTAL: $${STARTING_CAPITAL}.00\n` +
    `STRATEGY: [1-2 sentence summary of your allocation philosophy]`
  );
}

function buildRegretsPrompt(
  idealPortfolioRaw: string,
  portfolio: PortfolioContext,
): string {
  // Format actual portfolio
  const positionLines = portfolio.positions.map(
    (p) =>
      `  ${p.symbol}: ${p.quantity.toFixed(4)} units, avg cost $${p.averageCostBasis.toFixed(2)}, ` +
      `now $${p.currentPrice.toFixed(2)}, P&L ${p.unrealizedPnlPercent >= 0 ? "+" : ""}${p.unrealizedPnlPercent.toFixed(1)}%`,
  );

  const portfolioSummary =
    `YOUR ACTUAL PORTFOLIO:\n` +
    `  Cash: $${portfolio.cashBalance.toFixed(2)}\n` +
    `  Total Value: $${portfolio.totalValue.toFixed(2)}\n` +
    `  Total P&L: ${portfolio.totalPnlPercent >= 0 ? "+" : ""}${portfolio.totalPnlPercent.toFixed(1)}%\n` +
    (positionLines.length > 0
      ? `  Positions:\n${positionLines.join("\n")}`
      : `  No open positions`);

  return (
    `You just described your ideal $${STARTING_CAPITAL} portfolio:\n\n${idealPortfolioRaw}\n\n` +
    `Now here's your ACTUAL portfolio:\n\n${portfolioSummary}\n\n` +
    `Compare your ideal allocation to your actual holdings.\n` +
    `- What would you do differently?\n` +
    `- Any positions you regret?\n` +
    `- Any positions you're glad you have?\n\n` +
    `Format your response EXACTLY as:\n` +
    `BIGGEST_REGRET: [symbol or "none"] — [why]\n` +
    `BEST_DECISION: [symbol or "none"] — [why]\n` +
    `WOULD_CHANGE: [what you'd do differently, 1-2 sentences]\n` +
    `REGRET_SCORE: [0-10, where 0 = "I'd do the exact same thing" and 10 = "completely different"]\n` +
    `REFLECTION: [2-3 sentence honest self-assessment]`
  );
}

// ---------------------------------------------------------------------------
// Response Parsers
// ---------------------------------------------------------------------------

function parseIdealPortfolio(raw: string): {
  allocations: IdealAllocation[];
  total: number;
  strategy: string;
} {
  const allocations: IdealAllocation[] = [];

  // Extract allocation lines: "- SYMBOL: $AMOUNT — REASONING"
  const allocationBlock = raw.match(/ALLOCATION:\s*([\s\S]*?)(?=TOTAL:|STRATEGY:|$)/i);
  if (allocationBlock) {
    const lines = allocationBlock[1].split("\n").filter((l) => l.trim().startsWith("-"));
    for (const line of lines) {
      const match = line.match(/-\s*(\w+):\s*\$?([\d.]+)\s*[—–-]\s*(.*)/);
      if (match) {
        allocations.push({
          symbol: match[1].trim(),
          amountUsd: parseFloat(match[2]),
          reasoning: match[3].trim(),
        });
      }
    }
  }

  // Extract total
  const totalMatch = raw.match(/TOTAL:\s*\$?([\d.]+)/i);
  const total = totalMatch ? parseFloat(totalMatch[1]) : allocations.reduce((s, a) => s + a.amountUsd, 0);

  // Extract strategy
  const strategyMatch = raw.match(/STRATEGY:\s*(.*)/i);
  const strategy = strategyMatch ? strategyMatch[1].trim() : "";

  return { allocations, total, strategy };
}

function parseRegrets(raw: string): {
  biggestRegret: string;
  bestDecision: string;
  wouldChange: string;
  regretScore: number;
  reflection: string;
} {
  const regretMatch = raw.match(/BIGGEST_REGRET:\s*(.*)/i);
  const bestMatch = raw.match(/BEST_DECISION:\s*(.*)/i);
  const changeMatch = raw.match(/WOULD_CHANGE:\s*(.*)/i);
  const scoreMatch = raw.match(/REGRET_SCORE:\s*(\d+)/i);
  const reflectionMatch = raw.match(/REFLECTION:\s*([\s\S]*?)(?=BIGGEST_REGRET:|BEST_DECISION:|WOULD_CHANGE:|REGRET_SCORE:|$)/i);

  // Try a more targeted reflection extraction (everything after REFLECTION:)
  let reflection = "";
  if (reflectionMatch) {
    reflection = reflectionMatch[1].trim();
  } else {
    const simpleReflection = raw.match(/REFLECTION:\s*(.*)/i);
    if (simpleReflection) reflection = simpleReflection[1].trim();
  }

  const rawScore = scoreMatch ? parseInt(scoreMatch[1], 10) : 5;
  const regretScore = Math.min(REGRET_SCORE_MAX, Math.max(REGRET_SCORE_MIN, rawScore));

  return {
    biggestRegret: regretMatch ? regretMatch[1].trim() : "unknown",
    bestDecision: bestMatch ? bestMatch[1].trim() : "unknown",
    wouldChange: changeMatch ? changeMatch[1].trim() : "unknown",
    regretScore,
    reflection: reflection || "No reflection provided.",
  };
}

// ---------------------------------------------------------------------------
// Computed Insights
// ---------------------------------------------------------------------------

function computeConsensusStocks(musings: AgentMusing[]): string[] {
  // Find stocks that 2+ agents would buy in their ideal portfolio
  const stockCounts = new Map<string, number>();
  for (const m of musings) {
    for (const alloc of m.idealPortfolio) {
      stockCounts.set(alloc.symbol, (stockCounts.get(alloc.symbol) ?? 0) + 1);
    }
  }
  return [...stockCounts.entries()]
    .filter(([, count]) => count >= CONSENSUS_MIN_AGENTS)
    .sort((a, b) => b[1] - a[1])
    .map(([symbol]) => symbol);
}

function computeUniversalRegrets(musings: AgentMusing[]): string[] {
  // Find symbols mentioned as regrets by multiple agents
  const regretSymbols: string[] = [];
  for (const m of musings) {
    // Extract symbol from biggest regret (format: "SYMBOL — reason")
    const symbolMatch = m.biggestRegret.match(/^(\w+x?)\b/i);
    if (symbolMatch && symbolMatch[1].toLowerCase() !== "none") {
      regretSymbols.push(symbolMatch[1]);
    }
  }

  // Count occurrences
  const counts = new Map<string, number>();
  for (const s of regretSymbols) {
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= CONSENSUS_MIN_AGENTS)
    .map(([symbol]) => symbol);
}

// ---------------------------------------------------------------------------
// Core: Run Portfolio Musings
// ---------------------------------------------------------------------------

export async function runPortfolioMusings(
  results: TradingRoundResult[],
  agents: BaseTradingAgent[],
  marketData: MarketData[],
  roundId: string,
): Promise<MusingsResult> {
  const musingsId = `musings_${Date.now()}_${Math.random().toString(36).slice(ID_RANDOM_START, ID_RANDOM_START + ID_RANDOM_LENGTH_STANDARD)}`;
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const musings: AgentMusing[] = [];

  console.log(
    `[Musings] Starting portfolio musings ${musingsId} for round ${roundId}`,
  );

  for (const agent of agents) {
    const config = agent.config;
    const systemPrompt = buildMusingsSystemPrompt(config);

    try {
      // --- Phase 1: Fresh Start ---
      const freshStartPrompt = buildFreshStartPrompt(marketData);
      const idealResponse = await callAgentForMusings(
        config,
        systemPrompt,
        freshStartPrompt,
      );

      const { allocations, total, strategy } = parseIdealPortfolio(idealResponse);

      // --- Phase 2: Regrets ---
      const portfolio = await getPortfolioContext(config.agentId, marketData);
      const regretsPrompt = buildRegretsPrompt(idealResponse, portfolio);
      const regretsResponse = await callAgentForMusings(
        config,
        systemPrompt,
        regretsPrompt,
      );

      const regrets = parseRegrets(regretsResponse);

      musings.push({
        agentId: config.agentId,
        agentName: config.name,
        idealPortfolio: allocations,
        totalAllocated: total,
        strategy,
        idealPortfolioRaw: idealResponse,
        biggestRegret: regrets.biggestRegret,
        bestDecision: regrets.bestDecision,
        wouldChange: regrets.wouldChange,
        regretScore: regrets.regretScore,
        reflection: regrets.reflection,
        regretsRaw: regretsResponse,
      });

      console.log(
        `[Musings] ${config.name}: regret ${regrets.regretScore}/10, ` +
          `ideal portfolio: ${allocations.length} stocks, strategy: ${strategy.slice(0, STRATEGY_DESCRIPTION_LOG_LENGTH)}...`,
      );
    } catch (err) {
      console.error(
        `[Musings] ${config.name} failed: ${errorMessage(err)}`,
      );
      musings.push({
        agentId: config.agentId,
        agentName: config.name,
        idealPortfolio: [],
        totalAllocated: 0,
        strategy: "Error during musings",
        idealPortfolioRaw: `[Error: ${errorMessage(err)}]`,
        biggestRegret: "unknown",
        bestDecision: "unknown",
        wouldChange: "unknown",
        regretScore: 5,
        reflection: `Musings failed: ${errorMessage(err)}`,
        regretsRaw: `[Error: ${errorMessage(err)}]`,
      });
    }
  }

  // Computed insights
  const consensusStocks = computeConsensusStocks(musings);
  const universalRegrets = computeUniversalRegrets(musings);
  const avgRegretScore =
    musings.length > 0
      ? Math.round(
          (musings.reduce((s, m) => s + m.regretScore, 0) / musings.length) * 10,
        ) / 10
      : 0;

  const completedAt = new Date().toISOString();
  const durationMs = Date.now() - startMs;

  const result: MusingsResult = {
    musingsId,
    roundId,
    startedAt,
    completedAt,
    durationMs,
    musings,
    consensusStocks,
    universalRegrets,
    avgRegretScore,
  };

  // Store in history
  musingsHistory.push(result);
  if (musingsHistory.length > MAX_MUSINGS_HISTORY) {
    musingsHistory.splice(0, musingsHistory.length - MAX_MUSINGS_HISTORY);
  }

  console.log(
    `[Musings] Completed ${musingsId}: avg regret ${avgRegretScore}/10, ` +
      `consensus stocks: ${consensusStocks.join(", ") || "none"}, ` +
      `universal regrets: ${universalRegrets.join(", ") || "none"}, ` +
      `duration=${durationMs}ms`,
  );

  return result;
}
