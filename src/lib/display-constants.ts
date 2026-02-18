/**
 * Display Limit Constants
 *
 * Centralized constants for UI display limits, pagination, and text truncation.
 * These control how many results are shown in API responses and UI components.
 *
 * Usage:
 * - Import the specific constant you need
 * - Use in .slice(), .filter(), or pagination logic
 * - All display limits are tunable from this single location
 */

// ---------------------------------------------------------------------------
// Top N Result Display Limits
// ---------------------------------------------------------------------------

/**
 * TOP_TRADES_LIMIT = 5
 *
 * Maximum number of top trades shown in leaderboards and agent profiles.
 * Used for: best trades, top positions.
 */
export const TOP_TRADES_LIMIT = 5;

/**
 * WORST_TRADES_LIMIT = 3
 *
 * Maximum number of worst trades shown in agent analysis endpoints.
 * Used for: worstTrades arrays in composability, foresight, auditability, reversibility analysis.
 *
 * Fewer worst trades shown than top trades (3 vs 5) because worst-trade analysis
 * is a secondary signal — enough to illustrate failure modes without overwhelming.
 * Formula: sorted.slice(-WORST_TRADES_LIMIT).reverse() = 3 worst trades in ascending order.
 */
export const WORST_TRADES_LIMIT = 3;

/**
 * TOP_DIMENSIONS_LIMIT = 5
 *
 * Maximum number of top-performing dimensions shown in agent scorecards.
 */
export const TOP_DIMENSIONS_LIMIT = 5;

/**
 * WEAK_DIMENSIONS_LIMIT = 3
 *
 * Maximum number of weakest dimensions shown in agent analysis.
 */
export const WEAK_DIMENSIONS_LIMIT = 3;

/**
 * TOP_AGENTS_LIMIT = 10
 *
 * Default number of agents shown in leaderboard pagination.
 */
export const TOP_AGENTS_LIMIT = 10;

/**
 * TOP_PREDICTIONS_LIMIT = 10
 *
 * Maximum predictions shown in prediction tracking endpoints.
 */
export const TOP_PREDICTIONS_LIMIT = 10;

/**
 * TOP_CORRELATIONS_LIMIT = 5
 *
 * Maximum correlations shown in dimension analysis.
 */
export const TOP_CORRELATIONS_LIMIT = 5;

// ---------------------------------------------------------------------------
// Text Truncation Limits (Characters)
// ---------------------------------------------------------------------------

/**
 * REASONING_DISPLAY_LENGTH = 300
 *
 * Maximum reasoning text length (characters) for detailed views.
 * Used in: trade grades, agent reasoning history, detailed analysis.
 */
export const REASONING_DISPLAY_LENGTH = 300;

/**
 * REASONING_PREVIEW_LENGTH = 200
 *
 * Maximum reasoning text length (characters) for preview/summary views.
 * Used in: lists, tables, compact displays.
 */
export const REASONING_PREVIEW_LENGTH = 200;

/**
 * DESCRIPTION_DISPLAY_LENGTH = 500
 *
 * Maximum description text length (characters).
 */
export const DESCRIPTION_DISPLAY_LENGTH = 500;

/**
 * SHORT_TEXT_LENGTH = 150
 *
 * Maximum length for short text snippets.
 */
export const SHORT_TEXT_LENGTH = 150;

/**
 * VERY_SHORT_TEXT_LENGTH = 80
 *
 * Maximum length for very short text snippets (one-liners).
 */
export const VERY_SHORT_TEXT_LENGTH = 80;

// ---------------------------------------------------------------------------
// API Query Limits
// ---------------------------------------------------------------------------

/**
 * DEFAULT_QUERY_LIMIT = 50
 *
 * Default pagination limit when no explicit limit provided.
 */
export const DEFAULT_QUERY_LIMIT = 50;

/**
 * MAX_QUERY_LIMIT = 200
 *
 * Maximum allowed pagination limit (prevents excessive data transfer).
 */
export const MAX_QUERY_LIMIT = 200;

/**
 * TRADES_QUERY_LIMIT = 20
 *
 * Default number of trades returned in trade history queries.
 */
export const TRADES_QUERY_LIMIT = 20;

// ---------------------------------------------------------------------------
// Specific Use Cases
// ---------------------------------------------------------------------------

/**
 * ALERT_HISTORY_LIMIT = 8
 *
 * Maximum alerts shown in alert history views.
 */
export const ALERT_HISTORY_LIMIT = 8;

/**
 * RECENT_ROUNDS_LIMIT = 16
 *
 * Maximum recent rounds shown in round history.
 */
export const RECENT_ROUNDS_LIMIT = 16;

/**
 * SIGNAL_HISTORY_LIMIT = 12
 *
 * Maximum signals shown in signal tracking.
 */
export const SIGNAL_HISTORY_LIMIT = 12;

/**
 * CONSENSUS_AGENTS_LIMIT = 13
 *
 * Maximum agents shown in consensus analysis.
 */
export const CONSENSUS_AGENTS_LIMIT = 13;
