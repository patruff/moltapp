/**
 * Trade Reasoning Validation Schemas
 *
 * Zod schemas that enforce reasoning-required trades.
 * Every agent MUST explain WHY it's trading. No black-box trades.
 * This is what makes MoltApp a benchmark, not just a leaderboard.
 */

import { z } from "zod";
import { normalize } from "../lib/math-utils.ts";

/**
 * Valid trading intent classifications.
 * Agents must declare their strategy intent for each trade.
 */
export const tradingIntentEnum = z.enum([
  "momentum",        // Riding price trends
  "mean_reversion",  // Betting on price returning to average
  "value",           // Buying undervalued assets
  "hedge",           // Reducing risk exposure
  "contrarian",      // Going against the crowd
  "arbitrage",       // Exploiting price differences
]);

export type TradingIntent = z.infer<typeof tradingIntentEnum>;

/**
 * Schema for trades that require reasoning.
 * This is validated BEFORE any trade executes.
 */
export const tradeWithReasoningSchema = z.object({
  /** Stock symbol to trade */
  symbol: z.string().min(1, "Symbol is required"),

  /** Trade direction */
  side: z.enum(["buy", "sell"]),

  /** Quantity (USDC for buys, shares for sells) */
  quantity: z.number().positive("Quantity must be positive"),

  /** Step-by-step reasoning — the core of the benchmark */
  reasoning: z.string().min(20, "Reasoning must explain your logic (min 20 chars)"),

  /** Self-reported confidence 0.0 to 1.0 */
  confidence: z.number().min(0, "Confidence must be >= 0").max(1, "Confidence must be <= 1"),

  /** Data sources the agent consulted */
  sources: z.array(z.string()).min(1, "Must cite at least one data source"),

  /** Strategic intent classification */
  intent: tradingIntentEnum,

  /** What the agent predicts will happen */
  predictedOutcome: z.string().optional(),
});

export type TradeWithReasoning = z.infer<typeof tradeWithReasoningSchema>;

/**
 * Schema for hold decisions (also need reasoning for the benchmark).
 */
export const holdWithReasoningSchema = z.object({
  /** Stock symbol analyzed */
  symbol: z.string().min(1),

  /** Why the agent chose to hold */
  reasoning: z.string().min(10, "Hold decisions must be explained"),

  /** Self-reported confidence in the hold decision */
  confidence: z.number().min(0).max(1),

  /** Sources consulted */
  sources: z.array(z.string()).optional(),
});

export type HoldWithReasoning = z.infer<typeof holdWithReasoningSchema>;

/**
 * Schema for the full agent decision (buy/sell/hold) with reasoning.
 * Used by the orchestrator to validate all agent outputs.
 */
export const agentDecisionWithReasoningSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("buy"),
    ...tradeWithReasoningSchema.shape,
  }),
  z.object({
    action: z.literal("sell"),
    ...tradeWithReasoningSchema.shape,
  }),
  z.object({
    action: z.literal("hold"),
    ...holdWithReasoningSchema.shape,
  }),
]);

export type AgentDecisionWithReasoning = z.infer<typeof agentDecisionWithReasoningSchema>;

/**
 * Normalize an agent's confidence from 0-100 scale to 0-1 scale.
 * Agents may return either scale; we standardize to 0-1.
 */
export function normalizeConfidence(raw: number): number {
  if (raw > 1) {
    // Assume 0-100 scale, convert to 0-1
    return normalize(raw / 100);
  }
  return normalize(raw);
}

/**
 * Extract sources from an agent's reasoning text.
 * Looks for common patterns like "based on price data", "Jupiter prices", etc.
 */
export function extractSourcesFromReasoning(reasoning: string): string[] {
  const sources: string[] = [];
  const patterns: [RegExp, string][] = [
    [/price\s+data/i, "market_price_feed"],
    [/jupiter/i, "jupiter_price_api"],
    [/24h\s+change|24-hour/i, "24h_price_change"],
    [/volume/i, "trading_volume"],
    [/portfolio|position/i, "portfolio_state"],
    [/news|headline/i, "news_feed"],
    [/technical|indicator|RSI|MACD|moving\s+average/i, "technical_indicators"],
    [/fundamental|earnings|revenue|P\/E/i, "fundamentals"],
    [/sentiment|mood/i, "market_sentiment"],
    [/correlation|peer|sector/i, "sector_analysis"],
  ];

  for (const [pattern, source] of patterns) {
    if (pattern.test(reasoning)) {
      sources.push(source);
    }
  }

  // Always include at least the market data source
  if (sources.length === 0) {
    sources.push("market_data");
  }

  return sources;
}

/**
 * Classify the trading intent from an agent's reasoning.
 * Uses keyword analysis to determine strategy type.
 */
export function classifyIntent(reasoning: string, action: string): TradingIntent {
  const lower = reasoning.toLowerCase();

  if (/undervalued|intrinsic\s+value|margin\s+of\s+safety|fair\s+price|cheap/i.test(lower)) {
    return "value";
  }
  if (/momentum|trend|breakout|rally|surge|continuing\s+to\s+rise/i.test(lower)) {
    return "momentum";
  }
  if (/reversion|oversold|overbought|bounce|pullback|correction/i.test(lower)) {
    return "mean_reversion";
  }
  if (/hedge|protect|downside|risk\s+reduction|defensive/i.test(lower)) {
    return "hedge";
  }
  if (/contrarian|against\s+the\s+crowd|overreaction|panic/i.test(lower)) {
    return "contrarian";
  }
  if (/arbitrage|price\s+difference|mispricing|spread/i.test(lower)) {
    return "arbitrage";
  }

  // Default based on action
  return action === "buy" ? "value" : "momentum";
}
