/**
 * Benchmark UI Color Utilities
 *
 * Shared color classification functions and constants for benchmark routes.
 * Centralizes score-to-color mapping logic to prevent duplication across v35/v36/v37.
 */

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Score threshold for high-quality dimension performance (green color)
 * Scores >= 70 indicate excellent performance on a dimension
 */
export const DOT_COLOR_THRESHOLD_HIGH = 70;

/**
 * Score threshold for moderate dimension performance (gold color)
 * Scores >= 40 but < 70 indicate acceptable performance on a dimension
 */
export const DOT_COLOR_THRESHOLD_MID = 40;

/**
 * High-quality score color (green)
 * Used when dimension score >= DOT_COLOR_THRESHOLD_HIGH
 */
export const DOT_COLOR_HIGH = "#00ff88";

/**
 * Moderate-quality score color (gold)
 * Used when dimension score >= DOT_COLOR_THRESHOLD_MID but < DOT_COLOR_THRESHOLD_HIGH
 */
export const DOT_COLOR_MID = "#ffd700";

/**
 * Low-quality score color (red)
 * Used when dimension score < DOT_COLOR_THRESHOLD_MID
 */
export const DOT_COLOR_LOW = "#ff4444";

/**
 * Maximum number of recent trades shown in main feed (leaderboard page).
 * Controls `.slice(0, N)` on trade feed items.
 *
 * Rationale: 10 items provides sufficient recent activity context without overwhelming
 * the UI. Leaderboard focus should be on aggregate stats, not individual trade details.
 */
export const FEED_ITEMS_DISPLAY_LIMIT = 10;

/**
 * Maximum number of trades fetched from getTradeGrades() for recent activity.
 * Used as API call parameter: `getTradeGrades(N)`.
 *
 * Rationale: 20 trades provides sufficient history for feed items (top 10 shown)
 * plus backup for filtering/sorting without excessive memory overhead.
 */
export const RECENT_TRADES_API_LIMIT = 20;

/**
 * Maximum number of round summaries fetched from getRoundSummaries().
 * Used as API call parameter: `getRoundSummaries(N)`.
 *
 * Rationale: 5 rounds provides recent context for trend analysis (improving/declining)
 * without cluttering the dashboard. Most users care about current state, not deep history.
 */
export const RECENT_ROUNDS_API_LIMIT = 5;

/**
 * Maximum character length for reasoning snippet preview in trade feed.
 * Controls `reasoning.slice(0, N)` for truncated text display.
 *
 * Rationale: 120 characters (~2 short sentences) provides enough context to understand
 * trade rationale without expanding accordion. Consistent across v33-v37.
 */
export const REASONING_PREVIEW_CHAR_LIMIT = 120;

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

/**
 * Get color for a dimension score dot based on performance thresholds
 *
 * @param v - Dimension score (0-100 scale)
 * @returns Hex color string: green (>=70), gold (>=40), or red (<40)
 *
 * @example
 * dotClr(85)  // "#00ff88" (green - excellent)
 * dotClr(55)  // "#ffd700" (gold - moderate)
 * dotClr(30)  // "#ff4444" (red - poor)
 */
export function dotClr(v: number): string {
  return v >= DOT_COLOR_THRESHOLD_HIGH
    ? DOT_COLOR_HIGH
    : v >= DOT_COLOR_THRESHOLD_MID
    ? DOT_COLOR_MID
    : DOT_COLOR_LOW;
}
