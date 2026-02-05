/**
 * Query Parameter Parsing Utilities
 *
 * Centralized, NaN-safe parsing for API route query parameters.
 * Prevents database crashes from malformed inputs like ?limit=abc
 */

/**
 * Safely parse a query parameter string to an integer with bounds checking.
 *
 * @param value - Query parameter string value (from c.req.query())
 * @param defaultValue - Fallback value if parsing fails or value is undefined
 * @param min - Optional minimum bound (inclusive)
 * @param max - Optional maximum bound (inclusive)
 * @returns Parsed integer within bounds, or defaultValue if invalid
 *
 * @example
 * // Basic usage with default
 * const limit = parseQueryInt(c.req.query("limit"), 20);
 *
 * @example
 * // With bounds (1-100)
 * const limit = parseQueryInt(c.req.query("limit"), 20, 1, 100);
 *
 * @example
 * // Malformed input handling
 * parseQueryInt("abc", 20, 1, 100) // returns 20 (default)
 * parseQueryInt("150", 20, 1, 100) // returns 100 (max bound)
 * parseQueryInt("-5", 20, 1, 100)  // returns 20 (default, negative rejected)
 */
export function parseQueryInt(
  value: string | undefined,
  defaultValue: number,
  min?: number,
  max?: number
): number {
  let result = defaultValue;

  if (value) {
    const parsed = parseInt(value, 10);
    // Only accept valid, non-negative integers
    if (!isNaN(parsed) && parsed >= 0) {
      result = parsed;
      // Apply bounds if specified
      if (min !== undefined && result < min) result = min;
      if (max !== undefined && result > max) result = max;
    }
  }

  return result;
}
