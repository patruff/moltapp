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
  REASONING_REQUIRED: { status: 400, code: "reasoning_required" },

  // 401 Unauthorized
  UNAUTHORIZED: { status: 401, code: "unauthorized" },
  INVALID_IDENTITY_TOKEN: { status: 401, code: "invalid_identity_token" },
  INVALID_API_KEY: { status: 401, code: "invalid_api_key" },
  MISSING_API_KEY: { status: 401, code: "missing_api_key" },

  // 403 Forbidden
  DEMO_MODE_DISABLED: { status: 403, code: "demo_mode_disabled" },

  // 404 Not Found
  STOCK_NOT_FOUND: { status: 404, code: "stock_not_found" },
  WALLET_NOT_FOUND: { status: 404, code: "wallet_not_found" },
  AGENT_NOT_FOUND: { status: 404, code: "agent_not_found" },
  DECISION_NOT_FOUND: { status: 404, code: "decision_not_found" },
  ALERT_NOT_FOUND: { status: 404, code: "alert_not_found" },
  STOP_RULE_NOT_FOUND: { status: 404, code: "stop_rule_not_found" },
  SWARM_PREDICTION_NOT_FOUND: { status: 404, code: "swarm_prediction_not_found" },
  DELIBERATION_NOT_FOUND: { status: 404, code: "deliberation_not_found" },
  REASONING_NOT_FOUND: { status: 404, code: "reasoning_not_found" },
  NOT_RANKED: { status: 404, code: "not_ranked" },

  // 422 Unprocessable Entity
  QUALITY_GATE_REJECTED: { status: 422, code: "quality_gate_rejected" },

  // 429 Too Many Requests
  RATE_LIMITED: { status: 429, code: "rate_limited" },

  // 500 Internal Server Error
  INTERNAL_ERROR: { status: 500, code: "internal_error" },
  COMPARISON_FAILED: { status: 500, code: "comparison_failed" },
  WALLET_CREATION_FAILED: { status: 500, code: "wallet_creation_failed" },
  WITHDRAWAL_FAILED: { status: 500, code: "withdrawal_failed" },
  TRADE_EXECUTION_FAILED: { status: 500, code: "trade_execution_failed" },
  ON_CHAIN_FETCH_FAILED: { status: 500, code: "on_chain_fetch_failed" },

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
 * Safely extract an error message from an unknown caught value.
 * Replaces the common pattern: `error instanceof Error ? error.message : String(error)`
 */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
