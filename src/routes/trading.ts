import { Hono } from "hono";
import { z } from "zod";
import { executeBuy, executeSell } from "../services/trading.ts";
import { executeDemoBuy, executeDemoSell } from "../services/demo-trading.ts";
import { env } from "../config/env.ts";

type TradingEnv = { Variables: { agentId: string } };

export const tradingRoutes = new Hono<TradingEnv>();

// ---------------------------------------------------------------------------
// Error handling helper
// ---------------------------------------------------------------------------

function errorToHttpStatus(errorMessage: string): number {
  const prefix = errorMessage.split(":")[0];
  switch (prefix) {
    case "stock_not_found":
    case "wallet_not_found":
      return 404;
    case "insufficient_usdc_balance":
    case "insufficient_sol_for_fees":
    case "insufficient_stock_balance":
    case "invalid_amount":
      return 400;
    case "jupiter_order_failed":
    case "jupiter_execute_failed":
      return 502;
    default:
      return 500;
  }
}

function formatErrorResponse(err: unknown): {
  status: number;
  body: { error: string; details: string };
} {
  const message = err instanceof Error ? err.message : String(err);
  const prefix = message.split(":")[0];
  return {
    status: errorToHttpStatus(message),
    body: { error: prefix, details: message },
  };
}

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
    return c.json(
      { error: "invalid_json", details: "Request body must be valid JSON" },
      400
    );
  }

  const parsed = buyBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "validation_failed", details: parsed.error.flatten() },
      400
    );
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
    const { status, body: errBody } = formatErrorResponse(err);
    return c.json(errBody, status as 400);
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
    return c.json(
      { error: "invalid_json", details: "Request body must be valid JSON" },
      400
    );
  }

  const parsed = sellBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "validation_failed", details: parsed.error.flatten() },
      400
    );
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
    const { status, body: errBody } = formatErrorResponse(err);
    return c.json(errBody, status as 400);
  }
});
