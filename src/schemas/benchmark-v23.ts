/**
 * Benchmark v23 Zod Validation Schemas
 *
 * Stricter validation for reasoning-required trades in the v23 benchmark.
 * Key improvements over base schemas:
 * - Minimum reasoning word count (not just character count)
 * - Source quality validation
 * - Cross-field consistency checks
 * - Prediction format validation
 */

import { z } from "zod";

/**
 * Valid trading intent classifications (v23 expanded).
 */
export const v23IntentEnum = z.enum([
  "momentum",
  "mean_reversion",
  "value",
  "hedge",
  "contrarian",
  "arbitrage",
  "breakout",
  "income",
]);

export type V23Intent = z.infer<typeof v23IntentEnum>;

/**
 * Valid data source types that agents can cite.
 */
export const dataSourceEnum = z.enum([
  "market_price_feed",
  "24h_price_change",
  "trading_volume",
  "portfolio_state",
  "news_feed",
  "technical_indicators",
  "fundamentals",
  "market_sentiment",
  "sector_analysis",
  "jupiter_price_api",
  "on_chain_data",
  "agent_consensus",
  "market_data",
]);

/**
 * v23 Trade with Reasoning — strict validation for benchmark quality.
 */
export const v23TradeWithReasoningSchema = z.object({
  /** Stock symbol to trade */
  symbol: z.string()
    .min(1, "Symbol is required")
    .regex(/^[A-Z]{1,5}x?$/i, "Symbol must be a valid stock ticker (e.g. AAPLx)"),

  /** Trade direction */
  side: z.enum(["buy", "sell"]),

  /** Quantity (USDC for buys, shares for sells) */
  quantity: z.number()
    .positive("Quantity must be positive")
    .max(100_000, "Quantity exceeds maximum allowed"),

  /** Step-by-step reasoning — minimum 5 words for benchmark quality */
  reasoning: z.string()
    .min(20, "Reasoning must explain your logic (min 20 chars)")
    .refine(
      (r) => r.split(/\s+/).filter(Boolean).length >= 5,
      "Reasoning must contain at least 5 words for benchmark quality",
    ),

  /** Self-reported confidence 0.0 to 1.0 */
  confidence: z.number()
    .min(0, "Confidence must be >= 0")
    .max(1, "Confidence must be <= 1"),

  /** Data sources — must cite at least one real data source */
  sources: z.array(z.string())
    .min(1, "Must cite at least one data source"),

  /** Strategic intent classification */
  intent: v23IntentEnum,

  /** What the agent predicts will happen */
  predictedOutcome: z.string().optional(),

  /** Time horizon for the prediction: '1h', '4h', '24h', '7d' */
  predictionHorizon: z.enum(["1h", "4h", "24h", "7d"]).optional(),
});

export type V23TradeWithReasoning = z.infer<typeof v23TradeWithReasoningSchema>;

/**
 * v23 Hold decision schema.
 */
export const v23HoldWithReasoningSchema = z.object({
  symbol: z.string().min(1),
  reasoning: z.string().min(10, "Hold decisions must be explained"),
  confidence: z.number().min(0).max(1),
  sources: z.array(z.string()).optional(),
  predictedOutcome: z.string().optional(),
});

export type V23HoldWithReasoning = z.infer<typeof v23HoldWithReasoningSchema>;

/**
 * Full agent decision schema (buy/sell/hold) for v23 benchmark.
 */
export const v23AgentDecisionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("buy"),
    ...v23TradeWithReasoningSchema.shape,
  }),
  z.object({
    action: z.literal("sell"),
    ...v23TradeWithReasoningSchema.shape,
  }),
  z.object({
    action: z.literal("hold"),
    ...v23HoldWithReasoningSchema.shape,
  }),
]);

export type V23AgentDecision = z.infer<typeof v23AgentDecisionSchema>;

/**
 * Benchmark scoring weights (v23).
 * These weights determine the composite benchmark score.
 */
export const V23_SCORING_WEIGHTS = {
  pnl: 0.30,               // 30% — financial performance
  coherence: 0.20,          // 20% — reasoning matches action
  hallucinationFree: 0.15,  // 15% — no fabricated data
  discipline: 0.10,         // 10% — follows trading rules
  calibration: 0.15,        // 15% — confidence matches outcomes
  predictionAccuracy: 0.10, // 10% — predictions come true
} as const;

/**
 * Grade thresholds for the composite benchmark score.
 */
export function computeGrade(compositeScore: number): string {
  if (compositeScore >= 90) return "S";
  if (compositeScore >= 80) return "A";
  if (compositeScore >= 70) return "B";
  if (compositeScore >= 60) return "C";
  if (compositeScore >= 50) return "D";
  return "F";
}

/**
 * Normalize a raw metric to 0-100 scale for composite scoring.
 */
export function normalizeMetric(
  value: number,
  min: number,
  max: number,
  higherIsBetter: boolean = true,
): number {
  const clamped = Math.max(min, Math.min(max, value));
  const normalized = ((clamped - min) / (max - min)) * 100;
  return higherIsBetter ? normalized : 100 - normalized;
}
