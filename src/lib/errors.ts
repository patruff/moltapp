/**
 * Standardized Error Handling
 * 
 * Provides consistent error response format across all API routes.
 * Format: { error: string, code: string, details?: any }
 */

import type { Context } from "hono";

export interface ApiError {
  error: string;
  code: string;
  details?: unknown;
}

/**
 * Standard error codes mapped to HTTP status codes
 */
export const ErrorCodes = {
  // 400 Bad Request
  VALIDATION_FAILED: { status: 400, code: "validation_failed" },
  INVALID_JSON: { status: 400, code: "invalid_json" },
  INVALID_AMOUNT: { status: 400, code: "invalid_amount" },
  INVALID_DESTINATION: { status: 400, code: "invalid_destination" },
  INSUFFICIENT_BALANCE: { status: 400, code: "insufficient_balance" },
  INSUFFICIENT_USDC_BALANCE: { status: 400, code: "insufficient_usdc_balance" },
  INSUFFICIENT_SOL_FOR_FEES: { status: 400, code: "insufficient_sol_for_fees" },
  INSUFFICIENT_STOCK_BALANCE: { status: 400, code: "insufficient_stock_balance" },

  // 401 Unauthorized
  INVALID_IDENTITY_TOKEN: { status: 401, code: "invalid_identity_token" },
  INVALID_API_KEY: { status: 401, code: "invalid_api_key" },
  MISSING_API_KEY: { status: 401, code: "missing_api_key" },

  // 403 Forbidden
  DEMO_MODE_DISABLED: { status: 403, code: "demo_mode_disabled" },

  // 404 Not Found
  STOCK_NOT_FOUND: { status: 404, code: "stock_not_found" },
  WALLET_NOT_FOUND: { status: 404, code: "wallet_not_found" },
  AGENT_NOT_FOUND: { status: 404, code: "agent_not_found" },

  // 429 Too Many Requests
  RATE_LIMITED: { status: 429, code: "rate_limited" },

  // 500 Internal Server Error
  INTERNAL_ERROR: { status: 500, code: "internal_error" },
  WALLET_CREATION_FAILED: { status: 500, code: "wallet_creation_failed" },
  WITHDRAWAL_FAILED: { status: 500, code: "withdrawal_failed" },
  TRADE_EXECUTION_FAILED: { status: 500, code: "trade_execution_failed" },

  // 502 Bad Gateway
  MOLTBOOK_VERIFICATION_FAILED: { status: 502, code: "moltbook_verification_failed" },
  JUPITER_ORDER_FAILED: { status: 502, code: "jupiter_order_failed" },
  JUPITER_EXECUTE_FAILED: { status: 502, code: "jupiter_execute_failed" },

  // 503 Service Unavailable
  MOLTBOOK_RATE_LIMITED: { status: 503, code: "moltbook_rate_limited" },
} as const;

/**
 * Create a standardized API error response
 */
export function apiError(
  c: Context,
  errorCode: keyof typeof ErrorCodes,
  details?: unknown
) {
  const { status, code } = ErrorCodes[errorCode];
  const response: ApiError = {
    error: code,
    code,
    ...(details !== undefined && { details }),
  };
  return c.json(response, status);
}

/**
 * Parse error from caught exception and return appropriate API error
 */
export function handleError(c: Context, err: unknown): Response {
  // Handle Error instances
  if (err instanceof Error) {
    const message = err.message;

    // Try to extract error code from message (format: "code: details")
    const colonIndex = message.indexOf(":");
    if (colonIndex > 0) {
      const prefix = message.substring(0, colonIndex);
      const details = message.substring(colonIndex + 2); // Skip ": "

      // Map common error prefixes to error codes
      const errorMap: Record<string, keyof typeof ErrorCodes> = {
        stock_not_found: "STOCK_NOT_FOUND",
        wallet_not_found: "WALLET_NOT_FOUND",
        insufficient_usdc_balance: "INSUFFICIENT_USDC_BALANCE",
        insufficient_sol_for_fees: "INSUFFICIENT_SOL_FOR_FEES",
        insufficient_stock_balance: "INSUFFICIENT_STOCK_BALANCE",
        invalid_amount: "INVALID_AMOUNT",
        jupiter_order_failed: "JUPITER_ORDER_FAILED",
        jupiter_execute_failed: "JUPITER_EXECUTE_FAILED",
        withdrawal_failed: "WITHDRAWAL_FAILED",
        wallet_creation_failed: "WALLET_CREATION_FAILED",
      };

      const errorCode = errorMap[prefix];
      if (errorCode) {
        return apiError(c, errorCode, details);
      }
    }

    // Fallback to generic internal error with message
    return apiError(c, "INTERNAL_ERROR", message);
  }

  // Handle non-Error thrown values
  return apiError(c, "INTERNAL_ERROR", String(err));
}

/**
 * Helper to throw an error that will be handled by handleError
 */
export function throwApiError(code: keyof typeof ErrorCodes, details?: string): never {
  const { code: errorCode } = ErrorCodes[code];
  const message = details ? `${errorCode}: ${details}` : errorCode;
  throw new Error(message);
}
