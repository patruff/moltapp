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

/**
 * Format a number as USD currency with 2 decimal places
 * @param value - The value to format (number or string)
 * @returns Formatted currency string like "1,234.56"
 *
 * @example
 * formatCurrency(1234.5678) // "1,234.57"
 * formatCurrency("5000") // "5,000.00"
 * formatCurrency("invalid") // "0.00"
 */
export function formatCurrency(value: string | number): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "0.00";
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Format a date as relative time (e.g., "5m ago", "2h ago")
 * @param date - The date to format (null returns "Never")
 * @returns Formatted time string like "5m ago" or "2d ago"
 *
 * @example
 * formatTimeAgo(new Date(Date.now() - 5 * 60 * 1000)) // "5m ago"
 * formatTimeAgo(new Date(Date.now() - 2 * 60 * 60 * 1000)) // "2h ago"
 * formatTimeAgo(null) // "Never"
 */
export function formatTimeAgo(date: Date | null): string {
  if (!date) return "Never";
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays}d ago`;
}

/**
 * Get CSS color class for positive/negative/neutral P&L
 * @param pnlPercent - The P&L percentage value
 * @returns CSS class string: "text-profit", "text-loss", or "text-gray-400"
 *
 * @example
 * pnlColor(5.5) // "text-profit"
 * pnlColor(-2.3) // "text-loss"
 * pnlColor(0) // "text-gray-400"
 */
export function pnlColor(pnlPercent: string | number): string {
  const num = typeof pnlPercent === "string" ? parseFloat(pnlPercent) : pnlPercent;
  if (num > 0) return "text-profit";
  if (num < 0) return "text-loss";
  return "text-gray-400";
}

/**
 * Get sign prefix for positive numbers (empty for negative/zero)
 * @param pnlPercent - The P&L percentage value
 * @returns "+" for positive numbers, "" for negative/zero
 *
 * @example
 * pnlSign(5.5) // "+"
 * pnlSign(-2.3) // ""
 * pnlSign(0) // ""
 */
export function pnlSign(pnlPercent: string | number): string {
  const num = typeof pnlPercent === "string" ? parseFloat(pnlPercent) : pnlPercent;
  if (num > 0) return "+";
  return "";
}

/**
 * Get karma badge stars based on karma level
 * @param karma - The karma score
 * @returns Star symbols (★): 1 star (10+), 2 stars (50+), 3 stars (100+)
 *
 * @example
 * karmaBadge(5) // ""
 * karmaBadge(25) // " ★"
 * karmaBadge(75) // " ★★"
 * karmaBadge(150) // " ★★★"
 */
export function karmaBadge(karma: number): string {
  if (karma >= 100) return " \u2605\u2605\u2605";
  if (karma >= 50) return " \u2605\u2605";
  if (karma >= 10) return " \u2605";
  return "";
}

/**
 * Generate Solscan transaction URL
 * @param sig - The transaction signature
 * @returns Full Solscan transaction URL
 *
 * @example
 * solscanTxUrl("abc123...") // "https://solscan.io/tx/abc123..."
 */
export function solscanTxUrl(sig: string): string {
  return `https://solscan.io/tx/${sig}`;
}

/**
 * Generate Solscan wallet URL
 * @param address - The wallet address
 * @returns Full Solscan wallet URL
 *
 * @example
 * solscanWalletUrl("abc123...") // "https://solscan.io/account/abc123..."
 */
export function solscanWalletUrl(address: string): string {
  return `https://solscan.io/account/${address}`;
}

/**
 * Get CSS background color class for grade badge
 * @param grade - The letter grade (A, B, C, D/F)
 * @returns CSS class string for badge styling
 *
 * @example
 * gradeToColor("A+") // "bg-green-900/50 text-green-400"
 * gradeToColor("B") // "bg-blue-900/50 text-blue-400"
 * gradeToColor("C-") // "bg-yellow-900/50 text-yellow-400"
 * gradeToColor("D") // "bg-red-900/50 text-red-400"
 */
export function gradeToColor(grade: string): string {
  if (grade.startsWith("A")) return "bg-green-900/50 text-green-400";
  if (grade.startsWith("B")) return "bg-blue-900/50 text-blue-400";
  if (grade.startsWith("C")) return "bg-yellow-900/50 text-yellow-400";
  return "bg-red-900/50 text-red-400";
}

/**
 * Get CSS background color class for score bar visualization
 * @param score - The numeric score (0.0 to 1.0)
 * @returns CSS class string for bar color
 *
 * @example
 * scoreToColor(0.85) // "bg-green-500"
 * scoreToColor(0.65) // "bg-blue-500"
 * scoreToColor(0.45) // "bg-yellow-500"
 * scoreToColor(0.25) // "bg-red-500"
 */
export function scoreToColor(score: number): string {
  if (score >= 0.8) return "bg-green-500";
  if (score >= 0.6) return "bg-blue-500";
  if (score >= 0.4) return "bg-yellow-500";
  return "bg-red-500";
}

/**
 * Format a score as percentage with custom decimal places
 * Used for displaying normalized scores (0.0-1.0) as percentages
 *
 * @param score - The score value (0.0 to 1.0)
 * @param decimals - Number of decimal places (default: 1)
 * @returns Formatted percentage string like "78.5%"
 *
 * @example
 * formatScorePercentage(0.785) // "78.5%"
 * formatScorePercentage(0.92, 0) // "92%"
 * formatScorePercentage(0.6543, 2) // "65.43%"
 */
export function formatScorePercentage(score: number, decimals: number = 1): string {
  return (score * 100).toFixed(decimals) + "%";
}

/**
 * Format P&L value with sign and currency formatting
 * Combines pnlSign() and formatCurrency() for consistent P&L display
 *
 * @param value - The P&L dollar amount
 * @returns Formatted string like "+$1,234.56" or "-$567.89"
 *
 * @example
 * formatPnlDisplay(1234.56) // "+$1,234.56"
 * formatPnlDisplay(-567.89) // "-$567.89"
 * formatPnlDisplay(0) // "$0.00"
 */
export function formatPnlDisplay(value: number): string {
  const sign = pnlSign(value);
  return `${sign}$${formatCurrency(Math.abs(value))}`;
}

/**
 * Format stock quantity with 4 decimal places
 * Used for consistent display of share quantities and stock amounts
 *
 * @param value - The quantity value (number or string)
 * @returns Formatted quantity string like "123.4567"
 *
 * @example
 * formatQuantity(123.456789) // "123.4568"
 * formatQuantity("50") // "50.0000"
 * formatQuantity("invalid") // "0.0000"
 */
export function formatQuantity(value: string | number): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "0.0000";
  return num.toFixed(4);
}

/**
 * Format large numbers with thousand separators
 * Used for token counts and other large numeric displays
 *
 * @param value - The number to format
 * @returns Formatted string like "1,234,567"
 *
 * @example
 * formatNumber(1234567) // "1,234,567"
 * formatNumber(1000) // "1,000"
 * formatNumber(42) // "42"
 */
export function formatNumber(value: number): string {
  return value.toLocaleString();
}
