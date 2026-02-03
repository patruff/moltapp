/**
 * Price Validator API Routes
 *
 * Endpoints for multi-source price validation, slippage protection,
 * and trade execution price verification.
 */

import { Hono } from "hono";
import {
  validatePrice,
  validateBatch,
  quickValidate,
  getValidationConfigs,
  configureLiveValidation,
  configurePaperValidation,
  getPriceValidatorMetrics,
  resetPriceValidatorMetrics,
} from "../services/price-validator.ts";

export const priceValidatorRoutes = new Hono();

/** GET / — get validator metrics */
priceValidatorRoutes.get("/", (c) => {
  return c.json(getPriceValidatorMetrics());
});

/** GET /config — get validation configs */
priceValidatorRoutes.get("/config", (c) => {
  return c.json(getValidationConfigs());
});

/** GET /quick/:symbol — quick validate a symbol */
priceValidatorRoutes.get("/quick/:symbol", (c) => {
  const symbol = c.req.param("symbol");
  return c.json(quickValidate(symbol));
});

/** POST /validate — validate a price before execution */
priceValidatorRoutes.post("/validate", async (c) => {
  const body = (await c.req.json()) as {
    symbol: string;
    mintAddress: string;
    proposedPrice: number;
    agentId: string;
    side: "buy" | "sell";
    usdcAmount: number;
    allowStale?: boolean;
  };

  const result = await validatePrice(body);
  return c.json(result);
});

/** POST /validate-batch — batch validate multiple symbols */
priceValidatorRoutes.post("/validate-batch", async (c) => {
  const body = (await c.req.json()) as {
    symbols: string[];
    agentId: string;
  };

  const results = await validateBatch(body.symbols, body.agentId);
  return c.json({ results, count: Object.keys(results).length });
});

/** PUT /config/live — update live validation config */
priceValidatorRoutes.put("/config/live", async (c) => {
  const body = (await c.req.json()) as Record<string, unknown>;
  const config = configureLiveValidation(body);
  return c.json(config);
});

/** PUT /config/paper — update paper validation config */
priceValidatorRoutes.put("/config/paper", async (c) => {
  const body = (await c.req.json()) as Record<string, unknown>;
  const config = configurePaperValidation(body);
  return c.json(config);
});

/** POST /reset — reset metrics */
priceValidatorRoutes.post("/reset", (c) => {
  resetPriceValidatorMetrics();
  return c.json({ status: "reset" });
});
