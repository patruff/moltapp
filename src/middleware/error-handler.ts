/**
 * Global Error Handler Middleware
 *
 * Catches unhandled errors in any route and returns a consistent
 * structured JSON response. Also logs errors with timestamps for
 * debugging.
 */

import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

// ---------------------------------------------------------------------------
// Error response type
// ---------------------------------------------------------------------------

export interface StructuredError {
  error: string;
  code: string;
  status: number;
  requestId?: string;
}

// ---------------------------------------------------------------------------
// Custom application error class
// ---------------------------------------------------------------------------

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: string;

  constructor(statusCode: number, errorCode: string, message: string) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

// ---------------------------------------------------------------------------
// Error mapper: known error types → structured response
// ---------------------------------------------------------------------------

function mapErrorToResponse(err: unknown): StructuredError {
  // Custom AppError
  if (err instanceof AppError) {
    return {
      error: err.message,
      code: err.errorCode,
      status: err.statusCode,
    };
  }

  // Standard Error
  if (err instanceof Error) {
    // Check for Zod validation errors
    if (err.name === "ZodError") {
      return {
        error: "Validation failed",
        code: "VALIDATION_FAILED",
        status: 400,
      };
    }

    // Check for JSON parse errors
    if (err.message.includes("JSON")) {
      return {
        error: "Invalid request body",
        code: "INVALID_JSON",
        status: 400,
      };
    }

    // Generic 500
    return {
      error: "Internal server error",
      code: "INTERNAL_ERROR",
      status: 500,
    };
  }

  // Fallback
  return {
    error: "An unexpected error occurred",
    code: "INTERNAL_ERROR",
    status: 500,
  };
}

// ---------------------------------------------------------------------------
// Logging helper
// ---------------------------------------------------------------------------

function logError(err: unknown, path: string, method: string): void {
  const timestamp = new Date().toISOString();
  const errMsg =
    err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  const stack = err instanceof Error ? err.stack : undefined;

  console.error(
    JSON.stringify({
      level: "error",
      timestamp,
      method,
      path,
      error: errMsg,
      ...(stack && { stack }),
    })
  );
}

// ---------------------------------------------------------------------------
// Hono onError handler
// ---------------------------------------------------------------------------

/**
 * Global error handler for Hono's app.onError().
 *
 * Usage:
 *   app.onError(globalErrorHandler);
 */
export function globalErrorHandler(err: Error, c: Context): Response {
  const path = c.req.path;
  const method = c.req.method;

  logError(err, path, method);

  const structured = mapErrorToResponse(err);

  return c.json(structured, structured.status as ContentfulStatusCode);
}

// ---------------------------------------------------------------------------
// 404 Not Found handler
// ---------------------------------------------------------------------------

/**
 * Global 404 handler for Hono's app.notFound().
 *
 * Usage:
 *   app.notFound(notFoundHandler);
 */
export function notFoundHandler(c: Context): Response {
  return c.json(
    {
      error: `Route ${c.req.method} ${c.req.path} not found`,
      code: "NOT_FOUND",
      status: 404,
    },
    404
  );
}
