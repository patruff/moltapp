/**
 * Trading Routes
 *
 * Core trading endpoints for executing buy/sell orders.
 * Now enforces REASONING-REQUIRED trades via Zod validation.
 *
 * BENCHMARK RULE: No black-box trades. Every trade must include:
 * - reasoning (min 20 chars explaining the logic)
 * - confidence (0-1 self-assessed)
 * - sources (data sources consulted)
 * - intent (strategy classification)
 *
 * Routes without reasoning are still accepted for backward compatibility
 * but flagged as "unreasoned" in the benchmark data.
 */

import { Hono } from "hono";
import { z } from "zod";
import { executeBuy, executeSell } from "../services/trading.ts";
import { executeDemoBuy, executeDemoSell } from "../services/demo-trading.ts";
import { env } from "../config/env.ts";
import { apiError, handleError } from "../lib/errors.ts";
import {
  tradeWithReasoningSchema,
  tradingIntentEnum,
  normalizeConfidence,
  extractSourcesFromReasoning,
  classifyIntent,
} from "../schemas/trade-reasoning.ts";
import { db } from "../db/index.ts";
import { tradeJustifications } from "../db/schema/trade-reasoning.ts";

type TradingEnv = { Variables: { agentId: string } };

export const tradingRoutes = new Hono<TradingEnv>();

// ---------------------------------------------------------------------------
// Reasoning-enhanced buy/sell schemas
// ---------------------------------------------------------------------------

/** Enhanced buy schema: includes reasoning fields */
const reasonedBuySchema = z.object({
  stockSymbol: z.string().min(1),
  usdcAmount: z.string().regex(/^\d+(\.\d{1,6})?$/),
  // Reasoning fields (required for benchmark scoring, optional for backward compat)
  reasoning: z.string().min(20, "Reasoning must explain your logic (min 20 chars)").optional(),
  confidence: z.number().min(0).max(1).optional(),
  sources: z.array(z.string()).min(1).optional(),
  intent: tradingIntentEnum.optional(),
  predictedOutcome: z.string().optional(),
});

/** Enhanced sell schema: includes reasoning fields */
const reasonedSellSchema = z.object({
  stockSymbol: z.string().min(1),
  stockQuantity: z.string().regex(/^\d+(\.\d{1,9})?$/),
  // Reasoning fields
  reasoning: z.string().min(20, "Reasoning must explain your logic (min 20 chars)").optional(),
  confidence: z.number().min(0).max(1).optional(),
  sources: z.array(z.string()).min(1).optional(),
  intent: tradingIntentEnum.optional(),
  predictedOutcome: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Helper: Record justification for direct API trades
// ---------------------------------------------------------------------------

async function recordTradeJustification(
  agentId: string,
  action: "buy" | "sell",
  symbol: string,
  quantity: number,
  reasoning?: string,
  confidence?: number,
  sources?: string[],
  intent?: string,
  predictedOutcome?: string,
): Promise<void> {
  const justificationId = `tj_api_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  const actualReasoning = reasoning ?? "No reasoning provided (direct API trade)";
  const actualConfidence = confidence ?? 0.5;
  const actualSources = sources ?? extractSourcesFromReasoning(actualReasoning);
  const actualIntent = intent ?? classifyIntent(actualReasoning, action);

  try {
    await db.insert(tradeJustifications).values({
      id: justificationId,
      agentId,
      reasoning: actualReasoning,
      confidence: normalizeConfidence(actualConfidence),
      sources: actualSources,
      intent: actualIntent,
      predictedOutcome: predictedOutcome ?? null,
      action,
      symbol,
      quantity,
      disciplinePass: reasoning ? "pending" : "unreasoned",
    });
  } catch (err) {
    console.warn(
      `[Trading] Failed to record justification: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// POST /buy -- Execute a buy trade (with optional reasoning)
// ---------------------------------------------------------------------------

tradingRoutes.post("/buy", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, "INVALID_JSON", "Request body must be valid JSON");
  }

  const parsed = reasonedBuySchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, "VALIDATION_FAILED", parsed.error.flatten());
  }

  const agentId = c.get("agentId");
  const hasReasoning = !!parsed.data.reasoning;

  // Record the justification (whether reasoned or not)
  await recordTradeJustification(
    agentId,
    "buy",
    parsed.data.stockSymbol,
    parseFloat(parsed.data.usdcAmount),
    parsed.data.reasoning,
    parsed.data.confidence,
    parsed.data.sources,
    parsed.data.intent,
    parsed.data.predictedOutcome,
  );

  try {
    const executeFunction = env.DEMO_MODE ? executeDemoBuy : executeBuy;
    const result = await executeFunction({
      agentId,
      stockSymbol: parsed.data.stockSymbol,
      usdcAmount: parsed.data.usdcAmount,
    });

    return c.json({
      ...result,
      benchmark: {
        reasoningProvided: hasReasoning,
        confidence: parsed.data.confidence ?? null,
        intent: parsed.data.intent ?? null,
        message: hasReasoning
          ? "Trade recorded with full reasoning for benchmark scoring"
          : "WARNING: Trade executed without reasoning. Provide reasoning, confidence, sources, and intent for benchmark scoring.",
      },
    });
  } catch (err) {
    return handleError(c, err);
  }
});

// ---------------------------------------------------------------------------
// POST /sell -- Execute a sell trade (with optional reasoning)
// ---------------------------------------------------------------------------

tradingRoutes.post("/sell", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, "INVALID_JSON", "Request body must be valid JSON");
  }

  const parsed = reasonedSellSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, "VALIDATION_FAILED", parsed.error.flatten());
  }

  const agentId = c.get("agentId");
  const hasReasoning = !!parsed.data.reasoning;

  // Record the justification
  await recordTradeJustification(
    agentId,
    "sell",
    parsed.data.stockSymbol,
    parseFloat(parsed.data.stockQuantity),
    parsed.data.reasoning,
    parsed.data.confidence,
    parsed.data.sources,
    parsed.data.intent,
    parsed.data.predictedOutcome,
  );

  try {
    const executeFunction = env.DEMO_MODE ? executeDemoSell : executeSell;
    const result = await executeFunction({
      agentId,
      stockSymbol: parsed.data.stockSymbol,
      usdcAmount: "0",
      stockQuantity: parsed.data.stockQuantity,
    });

    return c.json({
      ...result,
      benchmark: {
        reasoningProvided: hasReasoning,
        confidence: parsed.data.confidence ?? null,
        intent: parsed.data.intent ?? null,
        message: hasReasoning
          ? "Trade recorded with full reasoning for benchmark scoring"
          : "WARNING: Trade executed without reasoning. Provide reasoning, confidence, sources, and intent for benchmark scoring.",
      },
    });
  } catch (err) {
    return handleError(c, err);
  }
});

// ---------------------------------------------------------------------------
// POST /reasoned-buy — Strictly reasoning-required buy (rejects without reasoning)
// ---------------------------------------------------------------------------

const strictBuySchema = z.object({
  stockSymbol: z.string().min(1),
  usdcAmount: z.string().regex(/^\d+(\.\d{1,6})?$/),
  reasoning: z.string().min(20, "Reasoning must explain your logic"),
  confidence: z.number().min(0).max(1),
  sources: z.array(z.string()).min(1, "Must cite at least one data source"),
  intent: tradingIntentEnum,
  predictedOutcome: z.string().optional(),
});

tradingRoutes.post("/reasoned-buy", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, "INVALID_JSON", "Request body must be valid JSON");
  }

  const parsed = strictBuySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        ok: false,
        error: "REASONING_REQUIRED",
        message:
          "MoltApp benchmark requires reasoning for all trades. " +
          "Include: reasoning (min 20 chars), confidence (0-1), sources (array), intent.",
        validation: parsed.error.flatten(),
      },
      400,
    );
  }

  const agentId = c.get("agentId");

  await recordTradeJustification(
    agentId,
    "buy",
    parsed.data.stockSymbol,
    parseFloat(parsed.data.usdcAmount),
    parsed.data.reasoning,
    parsed.data.confidence,
    parsed.data.sources,
    parsed.data.intent,
    parsed.data.predictedOutcome,
  );

  try {
    const executeFunction = env.DEMO_MODE ? executeDemoBuy : executeBuy;
    const result = await executeFunction({
      agentId,
      stockSymbol: parsed.data.stockSymbol,
      usdcAmount: parsed.data.usdcAmount,
    });

    return c.json({
      ...result,
      benchmark: {
        reasoningProvided: true,
        confidence: parsed.data.confidence,
        intent: parsed.data.intent,
        sources: parsed.data.sources,
        message: "Trade recorded with full reasoning for benchmark scoring",
      },
    });
  } catch (err) {
    return handleError(c, err);
  }
});

// ---------------------------------------------------------------------------
// POST /reasoned-sell — Strictly reasoning-required sell
// ---------------------------------------------------------------------------

const strictSellSchema = z.object({
  stockSymbol: z.string().min(1),
  stockQuantity: z.string().regex(/^\d+(\.\d{1,9})?$/),
  reasoning: z.string().min(20, "Reasoning must explain your logic"),
  confidence: z.number().min(0).max(1),
  sources: z.array(z.string()).min(1, "Must cite at least one data source"),
  intent: tradingIntentEnum,
  predictedOutcome: z.string().optional(),
});

tradingRoutes.post("/reasoned-sell", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, "INVALID_JSON", "Request body must be valid JSON");
  }

  const parsed = strictSellSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        ok: false,
        error: "REASONING_REQUIRED",
        message:
          "MoltApp benchmark requires reasoning for all trades. " +
          "Include: reasoning (min 20 chars), confidence (0-1), sources (array), intent.",
        validation: parsed.error.flatten(),
      },
      400,
    );
  }

  const agentId = c.get("agentId");

  await recordTradeJustification(
    agentId,
    "sell",
    parsed.data.stockSymbol,
    parseFloat(parsed.data.stockQuantity),
    parsed.data.reasoning,
    parsed.data.confidence,
    parsed.data.sources,
    parsed.data.intent,
    parsed.data.predictedOutcome,
  );

  try {
    const executeFunction = env.DEMO_MODE ? executeDemoSell : executeSell;
    const result = await executeFunction({
      agentId,
      stockSymbol: parsed.data.stockSymbol,
      usdcAmount: "0",
      stockQuantity: parsed.data.stockQuantity,
    });

    return c.json({
      ...result,
      benchmark: {
        reasoningProvided: true,
        confidence: parsed.data.confidence,
        intent: parsed.data.intent,
        sources: parsed.data.sources,
        message: "Trade recorded with full reasoning for benchmark scoring",
      },
    });
  } catch (err) {
    return handleError(c, err);
  }
});
