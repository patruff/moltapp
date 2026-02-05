/**
 * Shared formatting utilities for consistent display across the application
 */

/**
 * Format a percentage value with optional sign prefix and custom decimal places
 * @param value - The percentage value (e.g., 5.67 for 5.67%)
 * @param decimals - Number of decimal places (default: 1)
 * @returns Formatted string like "+5.7%" or "-2.3%"
 *
 * @example
 * formatPercentage(5.67) // "+5.7%"
 * formatPercentage(-2.34) // "-2.3%"
 * formatPercentage(0.5, 2) // "+0.50%"
 */
export function formatPercentage(value: string | number, decimals: number = 1): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "0.0%";

  const sign = num > 0 ? "+" : "";
  return `${sign}${num.toFixed(decimals)}%`;
}

/**
 * Calculate and format the expected percentage move from entry to target price
 * @param targetPrice - The target price for the position
 * @param entryPrice - The entry price for the position
 * @param decimals - Number of decimal places (default: 1)
 * @returns Formatted percentage string like "+15.3%" or "-8.2%"
 *
 * @example
 * calculateTargetMovePercent(115, 100) // "+15.0%"
 * calculateTargetMovePercent(95, 100) // "-5.0%"
 */
export function calculateTargetMovePercent(
  targetPrice: string | number,
  entryPrice: string | number,
  decimals: number = 1
): string {
  const target = typeof targetPrice === "string" ? parseFloat(targetPrice) : targetPrice;
  const entry = typeof entryPrice === "string" ? parseFloat(entryPrice) : entryPrice;

  if (isNaN(target) || isNaN(entry) || entry === 0) return "0.0%";

  const percentMove = ((target - entry) / entry) * 100;
  const sign = percentMove > 0 ? "+" : "";
  return `${sign}${percentMove.toFixed(decimals)}%`;
}

/**
 * Calculate the raw percentage move value (without formatting)
 * Useful when you need the numeric value for calculations or comparisons
 *
 * @example
 * calculateTargetMoveValue(115, 100) // 15.0
 */
export function calculateTargetMoveValue(
  targetPrice: string | number,
  entryPrice: string | number
): number {
  const target = typeof targetPrice === "string" ? parseFloat(targetPrice) : targetPrice;
  const entry = typeof entryPrice === "string" ? parseFloat(entryPrice) : entryPrice;

  if (isNaN(target) || isNaN(entry) || entry === 0) return 0;

  return ((target - entry) / entry) * 100;
}

/**
 * Truncate a Solana transaction signature or wallet address for display
 * Shows first 8 and last 8 characters with "..." in the middle
 *
 * @param address - The full address or signature string
 * @returns Truncated string like "AbC12345...XyZ98765"
 *
 * @example
 * truncateAddress("AbC12345678901234567890XyZ98765") // "AbC12345...XyZ98765"
 * truncateAddress("short") // "short" (no truncation if <= 16 chars)
 */
export function truncateAddress(address: string): string {
  if (address.length <= 16) return address;
  return address.slice(0, 8) + "..." + address.slice(-8);
}

/**
 * Truncate text to a maximum length with ellipsis
 * Useful for previewing long strings like reasoning text or tool results
 *
 * @param text - The text to truncate
 * @param maxLength - Maximum length before truncation (default: 200)
 * @returns Truncated string with "..." appended if over limit
 *
 * @example
 * truncateText("Long reasoning text...", 50) // "Long reasoning text..." (if > 50 chars)
 * truncateText("Short text", 50) // "Short text" (no truncation)
 */
export function truncateText(text: string, maxLength: number = 200): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}
