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
// Reusable schemas
// ---------------------------------------------------------------------------

/** Schema for buy order request body */
export const buyOrderSchema = z.object({
  stockSymbol: z
    .string()
    .min(1, "stockSymbol is required")
    .max(10, "stockSymbol too long"),
  usdcAmount: z
    .string()
    .regex(/^\d+(\.\d{1,6})?$/, "usdcAmount must be a decimal string with up to 6 decimals"),
});

/** Schema for sell order request body */
export const sellOrderSchema = z.object({
  stockSymbol: z
    .string()
    .min(1, "stockSymbol is required")
    .max(10, "stockSymbol too long"),
  stockQuantity: z
    .string()
    .regex(/^\d+(\.\d{1,9})?$/, "stockQuantity must be a decimal string with up to 9 decimals"),
});

/** Schema for agent registration request body */
export const registerSchema = z.object({
  agentName: z
    .string()
    .min(1, "agentName is required")
    .max(64, "agentName must be 64 characters or less"),
  identityToken: z.string().min(1, "identityToken is required"),
});

/** Schema for demo trade request body */
export const demoTradeSchema = z.object({
  symbol: z.string().min(1, "symbol is required").max(10, "symbol too long"),
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
    .max(32, "displayName must be 32 characters or less")
    .optional(),
});

/** Schema for withdrawal request body */
export const withdrawSchema = z.object({
  destinationAddress: z
    .string()
    .min(32, "Invalid Solana address")
    .max(44, "Invalid Solana address"),
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
    .pipe(z.number().min(1).max(100))
    .optional(),
  offset: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().min(0))
    .optional(),
});
