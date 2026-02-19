/**
 * Input Validation Middleware
 *
 * Zod-based request validation for Hono routes.
 * Provides reusable validation schemas and a generic validator factory.
 */

import type { Context, Next } from "hono";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Validation error response format
// ---------------------------------------------------------------------------

interface ValidationErrorResponse {
  error: string;
  code: string;
  status: number;
  details: {
    issues: Array<{
      path: string;
      message: string;
    }>;
  };
}

// ---------------------------------------------------------------------------
// Generic validator middleware factory
// ---------------------------------------------------------------------------

/**
 * Creates Hono middleware that validates the JSON request body
 * against a Zod schema. On failure, returns a structured 400 error.
 * On success, the parsed data is available at c.get("validatedBody").
 */
export function validateBody<T extends z.ZodTypeAny>(schema: T) {
  return async (c: Context, next: Next) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      const resp: ValidationErrorResponse = {
        error: "Request body must be valid JSON",
        code: "INVALID_JSON",
        status: 400,
        details: { issues: [{ path: "body", message: "Failed to parse JSON" }] },
      };
      return c.json(resp, 400);
    }

    const result = schema.safeParse(body);
    if (!result.success) {
      const issues = result.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      }));
      const resp: ValidationErrorResponse = {
        error: "Validation failed",
        code: "VALIDATION_FAILED",
        status: 400,
        details: { issues },
      };
      return c.json(resp, 400);
    }

    c.set("validatedBody", result.data);
    await next();
  };
}

/**
 * Creates Hono middleware that validates query string parameters
 * against a Zod schema. On failure, returns a structured 400 error.
 * On success, the parsed data is available at c.get("validatedQuery").
 */
export function validateQuery<T extends z.ZodTypeAny>(schema: T) {
  return async (c: Context, next: Next) => {
    const raw = c.req.query();
    const result = schema.safeParse(raw);
    if (!result.success) {
      const issues = result.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      }));
      const resp: ValidationErrorResponse = {
        error: "Invalid query parameters",
        code: "VALIDATION_FAILED",
        status: 400,
        details: { issues },
      };
      return c.json(resp, 400);
    }

    c.set("validatedQuery", result.data);
    await next();
  };
}

// ---------------------------------------------------------------------------
// Validation Schema Constants
// ---------------------------------------------------------------------------

/**
 * Maximum length for a stock symbol string (e.g., "AAPL", "GOOGL", "xAAPL").
 * Longest current xStocks ticker is 5 characters; 10 gives headroom for future additions.
 */
const STOCK_SYMBOL_MAX_LENGTH = 10;

/**
 * Maximum decimal places allowed in a USDC amount string.
 * USDC has 6 decimals on-chain (1 USDC = 10^6 raw units), so inputs beyond
 * 6 decimal places would be silently truncated by the blockchain.
 */
const USDC_DECIMALS = 6;

/**
 * Maximum decimal places allowed in a stock (xStock) quantity string.
 * xStocks are SPL tokens with 9 decimal places (1 xStock = 10^9 raw lamports),
 * matching the SOL precision standard used by most Solana programs.
 */
const XSTOCK_DECIMALS = 9;

/**
 * Maximum length for an agent name string.
 * 64 characters accommodates descriptive names like "GPT-4 Momentum Trader v2"
 * while preventing excessively long names in API responses and leaderboard display.
 */
const AGENT_NAME_MAX_LENGTH = 64;

/**
 * Maximum length for a demo session display name.
 * 32 characters fits comfortably in the leaderboard UI column without truncation.
 */
const DISPLAY_NAME_MAX_LENGTH = 32;

/**
 * Minimum length of a valid base-58 encoded Solana wallet address.
 * Solana public keys are 32 bytes; base-58 encoding produces 32-44 characters.
 * Addresses shorter than 32 characters are definitely invalid.
 */
const SOLANA_ADDRESS_MIN_LENGTH = 32;

/**
 * Maximum length of a valid base-58 encoded Solana wallet address.
 * The longest possible encoding of a 32-byte public key in base-58 is 44 characters.
 */
const SOLANA_ADDRESS_MAX_LENGTH = 44;

/**
 * Maximum number of records returned by a single paginated API request.
 * 100 items balances response payload size against the number of round-trips
 * a client needs to fetch a full agent trade history or leaderboard page.
 */
const PAGINATION_LIMIT_MAX = 100;

// ---------------------------------------------------------------------------
// Reusable schemas
// ---------------------------------------------------------------------------

/** Schema for buy order request body */
export const buyOrderSchema = z.object({
  stockSymbol: z
    .string()
    .min(1, "stockSymbol is required")
    .max(STOCK_SYMBOL_MAX_LENGTH, "stockSymbol too long"),
  usdcAmount: z
    .string()
    .regex(/^\d+(\.\d{1,6})?$/, "usdcAmount must be a decimal string with up to 6 decimals"),
});

/** Schema for sell order request body */
export const sellOrderSchema = z.object({
  stockSymbol: z
    .string()
    .min(1, "stockSymbol is required")
    .max(STOCK_SYMBOL_MAX_LENGTH, "stockSymbol too long"),
  stockQuantity: z
    .string()
    .regex(/^\d+(\.\d{1,9})?$/, "stockQuantity must be a decimal string with up to 9 decimals"),
});

/** Schema for agent registration request body */
export const registerSchema = z.object({
  agentName: z
    .string()
    .min(1, "agentName is required")
    .max(AGENT_NAME_MAX_LENGTH, "agentName must be 64 characters or less"),
  identityToken: z.string().min(1, "identityToken is required"),
});

/** Schema for demo trade request body */
export const demoTradeSchema = z.object({
  symbol: z.string().min(1, "symbol is required").max(STOCK_SYMBOL_MAX_LENGTH, "symbol too long"),
  side: z.enum(["buy", "sell"], {
    error: "side must be 'buy' or 'sell'",
  }),
  quantity: z.number().positive("quantity must be positive"),
});

/** Schema for demo session start body */
export const demoStartSchema = z.object({
  displayName: z
    .string()
    .min(1, "displayName must not be empty")
    .max(DISPLAY_NAME_MAX_LENGTH, "displayName must be 32 characters or less")
    .optional(),
});

/** Schema for withdrawal request body */
export const withdrawSchema = z.object({
  destinationAddress: z
    .string()
    .min(SOLANA_ADDRESS_MIN_LENGTH, "Invalid Solana address")
    .max(SOLANA_ADDRESS_MAX_LENGTH, "Invalid Solana address"),
  amount: z
    .string()
    .regex(/^\d+(\.\d{1,6})?$/, "amount must be a decimal string"),
});

/** Schema for pagination query params */
export const paginationSchema = z.object({
  limit: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().min(1).max(PAGINATION_LIMIT_MAX))
    .optional(),
  offset: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().min(0))
    .optional(),
});
