import { Hono } from "hono";
import { z } from "zod";
import { executeBuy, executeSell } from "../services/trading.ts";
import { executeDemoBuy, executeDemoSell } from "../services/demo-trading.ts";
import { env } from "../config/env.ts";
import { apiError, handleError } from "../lib/errors.ts";

type TradingEnv = { Variables: { agentId: string } };

export const tradingRoutes = new Hono<TradingEnv>();

// ---------------------------------------------------------------------------
// POST /buy -- Execute a buy trade
// ---------------------------------------------------------------------------

const buyBodySchema = z.object({
  stockSymbol: z.string().min(1),
  usdcAmount: z.string().regex(/^\d+(\.\d{1,6})?$/),
});

tradingRoutes.post("/buy", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, "INVALID_JSON", "Request body must be valid JSON");
  }

  const parsed = buyBodySchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, "VALIDATION_FAILED", parsed.error.flatten());
  }

  try {
    // Use demo trading if DEMO_MODE is enabled
    const executeFunction = env.DEMO_MODE ? executeDemoBuy : executeBuy;
    const result = await executeFunction({
      agentId: c.get("agentId"),
      stockSymbol: parsed.data.stockSymbol,
      usdcAmount: parsed.data.usdcAmount,
    });
    return c.json(result);
  } catch (err) {
    return handleError(c, err);
  }
});

// ---------------------------------------------------------------------------
// POST /sell -- Execute a sell trade
// ---------------------------------------------------------------------------

const sellBodySchema = z.object({
  stockSymbol: z.string().min(1),
  stockQuantity: z.string().regex(/^\d+(\.\d{1,9})?$/),
});

tradingRoutes.post("/sell", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, "INVALID_JSON", "Request body must be valid JSON");
  }

  const parsed = sellBodySchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, "VALIDATION_FAILED", parsed.error.flatten());
  }

  try {
    // Use demo trading if DEMO_MODE is enabled
    const executeFunction = env.DEMO_MODE ? executeDemoSell : executeSell;
    const result = await executeFunction({
      agentId: c.get("agentId"),
      stockSymbol: parsed.data.stockSymbol,
      usdcAmount: "0", // Ignored for sells; stockQuantity drives the order
      stockQuantity: parsed.data.stockQuantity,
    });
    return c.json(result);
  } catch (err) {
    return handleError(c, err);
  }
});
