/**
 * Display and Query Limit Constants
 *
 * Centralized configuration for all display limits, query limits, and pagination
 * parameters used throughout the MoltApp codebase. Extracting these magic numbers
 * to named constants improves maintainability and enables systematic tuning of
 * UI display behavior.
 *
 * Usage:
 *   import { ALERTS_DISPLAY_LIMIT, RECENT_ROUNDS_WINDOW } from "../lib/display-limits.ts";
 *   const recentAlerts = allAlerts.slice(0, ALERTS_DISPLAY_LIMIT);
 */

// ---------------------------------------------------------------------------
// Core Display Limits (Top N Items)
// ---------------------------------------------------------------------------

/** Display limit for alert lists: show top 5 most critical alerts */
export const ALERTS_DISPLAY_LIMIT_SMALL = 5;

/** Display limit for alert lists: show top 10 alerts */
export const ALERTS_DISPLAY_LIMIT_MEDIUM = 10;

/** Display limit for alert lists: show top 20 alerts */
export const ALERTS_DISPLAY_LIMIT_LARGE = 20;

/** Display limit for alert lists: show top 50 alerts (API responses) */
export const ALERTS_DISPLAY_LIMIT_API = 50;

/** Display limit for pattern/signal lists: top 5 patterns */
export const PATTERNS_DISPLAY_LIMIT = 5;

/** Display limit for stock/symbol lists: top 5 stocks */
export const TOP_STOCKS_DISPLAY_LIMIT = 5;

/** Display limit for sector preferences: top 5 sectors */
export const TOP_SECTORS_DISPLAY_LIMIT = 5;

/** Display limit for trade lists: top 10 recent trades */
export const RECENT_TRADES_DISPLAY_LIMIT = 10;

/** Display limit for decision lists: top 20 decisions */
export const RECENT_DECISIONS_DISPLAY_LIMIT = 20;

/** Display limit for agent comparisons: show all 3 agents */
export const AGENT_COMPARISON_LIMIT = 3;

// ---------------------------------------------------------------------------
// Time Window Limits (Lookback Periods)
// ---------------------------------------------------------------------------

/** Recent activity window: last 7 rounds */
export const RECENT_ROUNDS_WINDOW_SMALL = 7;

/** Recent activity window: last 10 rounds */
export const RECENT_ROUNDS_WINDOW_MEDIUM = 10;

/** Recent activity window: last 20 rounds */
export const RECENT_ROUNDS_WINDOW_LARGE = 20;

/** Recent activity window: last 30 rounds */
export const RECENT_ROUNDS_WINDOW_MONTH = 30;

/** Recent activity window: last 50 rounds */
export const RECENT_ROUNDS_WINDOW_EXTENDED = 50;

/** Recent activity window: last 100 rounds */
export const RECENT_ROUNDS_WINDOW_FULL = 100;

// ---------------------------------------------------------------------------
// Database Query Limits
// ---------------------------------------------------------------------------

/** Database query limit: 50 records (default for most queries) */
export const QUERY_LIMIT_DEFAULT = 50;

/** Database query limit: 100 records (larger datasets) */
export const QUERY_LIMIT_MEDIUM = 100;

/** Database query limit: 200 records (comprehensive analysis) */
export const QUERY_LIMIT_LARGE = 200;

/** Database query limit: 500 records (full history scans) */
export const QUERY_LIMIT_EXTENDED = 500;

/** Database query limit: 1000 records (benchmark baseline calculations) */
export const QUERY_LIMIT_BENCHMARK = 1000;

// ---------------------------------------------------------------------------
// Data Retention/Buffer Limits
// ---------------------------------------------------------------------------

/** Memory buffer size: 200 items (in-memory circular buffers) */
export const BUFFER_SIZE_SMALL = 200;

/** Memory buffer size: 500 items */
export const BUFFER_SIZE_MEDIUM = 500;

/** Memory buffer size: 1000 items */
export const BUFFER_SIZE_LARGE = 1000;

/** Memory buffer size: 5000 items (large feature vectors) */
export const BUFFER_SIZE_EXTENDED = 5000;

/** Memory buffer size: 10,000 items (full historical retention) */
export const BUFFER_SIZE_FULL = 10000;

// ---------------------------------------------------------------------------
// Pagination Limits
// ---------------------------------------------------------------------------

/** Pagination: items per page for compact views */
export const ITEMS_PER_PAGE_COMPACT = 10;

/** Pagination: items per page for standard views */
export const ITEMS_PER_PAGE_STANDARD = 20;

/** Pagination: items per page for detailed views */
export const ITEMS_PER_PAGE_DETAILED = 50;

/** Pagination: items per page for comprehensive lists */
export const ITEMS_PER_PAGE_COMPREHENSIVE = 100;

// ---------------------------------------------------------------------------
// Chart/Visualization Limits
// ---------------------------------------------------------------------------

/** Chart data points: show last 30 points (30-day equity curve) */
export const CHART_POINTS_MONTH = 30;

/** Chart data points: show last 90 points (3-month backtest) */
export const CHART_POINTS_QUARTER = 90;

/** Chart data points: show last 180 points (6-month analysis) */
export const CHART_POINTS_SEMESTER = 180;

/** Chart data points: show last 365 points (1-year history) */
export const CHART_POINTS_YEAR = 365;

// ---------------------------------------------------------------------------
// Leaderboard/Ranking Limits
// ---------------------------------------------------------------------------

/** Leaderboard: show top 10 agents */
export const LEADERBOARD_TOP_COUNT = 10;

/** Leaderboard: show all active agents (typically 3 in MoltApp) */
export const LEADERBOARD_ALL_AGENTS = 10;

/** Benchmark dimensions: show top 5 dimensions */
export const BENCHMARK_TOP_DIMENSIONS = 5;

/** Benchmark pillars: show all 7 pillars */
export const BENCHMARK_ALL_PILLARS = 7;

// ---------------------------------------------------------------------------
// Text/Content Display Limits
// ---------------------------------------------------------------------------

/** Reasoning text preview: first 100 characters */
export const REASONING_PREVIEW_LENGTH_SHORT = 100;

/** Reasoning text preview: first 200 characters */
export const REASONING_PREVIEW_LENGTH_MEDIUM = 200;

/** Reasoning text preview: first 500 characters */
export const REASONING_PREVIEW_LENGTH_LONG = 500;

/** Reasoning text full: show up to 2000 characters */
export const REASONING_FULL_LENGTH_MAX = 2000;

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

/**
 * Slice an array to a specified limit with type safety.
 * Handles empty arrays and ensures limit is non-negative.
 *
 * @param items - Array to slice
 * @param limit - Maximum items to return
 * @returns Sliced array of at most `limit` items
 */
export function sliceToLimit<T>(items: T[], limit: number): T[] {
  if (!items || items.length === 0) return [];
  if (limit <= 0) return [];
  return items.slice(0, limit);
}

/**
 * Get the top N items from an array (alias for sliceToLimit for clarity).
 *
 * @param items - Array to slice
 * @param n - Number of top items to return
 * @returns Top N items
 */
export function topN<T>(items: T[], n: number): T[] {
  return sliceToLimit(items, n);
}
