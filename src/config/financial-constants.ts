/**
 * Financial Constants - Single Source of Truth
 *
 * All financial calculations, P&L metrics, risk-adjusted returns, and leaderboard rankings
 * MUST use these constants to ensure consistency across the entire application.
 *
 * CRITICAL: Do NOT duplicate these constants in other files. Import from here.
 */

/**
 * Trading Days Per Year
 *
 * Standard market assumption: 252 trading days per year (365 days - weekends - holidays)
 * Used for annualizing returns, volatility, Sharpe/Sortino ratios, and risk metrics.
 *
 * IMPORTANT: Was incorrectly set to 250 in agent-comparison.ts (now fixed)
 */
export const TRADING_DAYS_PER_YEAR = 252;

/**
 * Annual Risk-Free Rate
 *
 * Used as baseline for excess return calculations in Sharpe/Sortino ratios.
 * Standard assumption: 5% annual return on risk-free assets (US Treasury rates).
 *
 * IMPORTANT: Was incorrectly set to 0.045 (4.5%) in risk-adjusted-leaderboard.ts (now fixed)
 */
export const ANNUAL_RISK_FREE_RATE = 0.05;

/**
 * Agent Initial Capital (USDC)
 *
 * Each agent starts with this amount of USDC for trading.
 * Used for P&L percentage calculations and portfolio value normalization.
 *
 * NOTE: Different contexts use different initial capital:
 * - Live trading: 50 USDC (onchain-portfolio.ts, leaderboard.ts)
 * - Backtesting/simulations: 10,000 USDC (backtesting.ts, decision-replay.ts, portfolio-snapshots.ts)
 */
export const LIVE_INITIAL_CAPITAL = 50;
export const BACKTEST_INITIAL_CAPITAL = 10_000;

/**
 * Time Conversion Constants
 *
 * Standard millisecond conversions for time-based calculations.
 * Used across the codebase for time-based filtering, expiration, and analytics.
 *
 * IMPORTANT: Do NOT duplicate these in other files. Import from here.
 */
export const MS_PER_SECOND = 1000;
export const MS_PER_MINUTE = 60 * MS_PER_SECOND;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE; // 3,600,000ms
export const MS_PER_DAY = 24 * MS_PER_HOUR; // 86,400,000ms
export const MS_PER_WEEK = 7 * MS_PER_DAY; // 604,800,000ms
export const MS_PER_MONTH = 30 * MS_PER_DAY; // 2,592,000,000ms (30-day month approximation)

/**
 * Rounds Per Trading Day
 *
 * Assumed number of trading rounds executed per day (used in agent-comparison.ts).
 * Standard assumption: 3 rounds per day for active trading strategies.
 */
export const ROUNDS_PER_TRADING_DAY = 3;
