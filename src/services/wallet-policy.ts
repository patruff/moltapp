import {
  XSTOCKS_CATALOG,
  USDC_MINT_MAINNET,
} from "../config/constants.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WalletPolicy {
  /** Max USDC per single trade */
  maxTradeSize: number;
  /** Max USDC traded per rolling 24h window */
  dailyVolumeLimit: number;
  /** Max USDC per session/round */
  sessionLimit: number;
  /** Token mint allowlist */
  allowedMints: string[];
  /** Max trades per rolling 1h window */
  maxTradesPerHour: number;
  /** Require get_execution_quote before execute_trade */
  requireQuoteFirst: boolean;
  /** Kill switch — when false, all trades are rejected */
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Default Policy Constants
// ---------------------------------------------------------------------------

/**
 * Maximum USDC amount allowed per single trade.
 *
 * Controls the per-trade ceiling enforced by enforcePolicy(). Any trade exceeding
 * this amount is rejected with "Trade size X USDC exceeds max Y USDC" error.
 *
 * Formula: amount <= DEFAULT_MAX_TRADE_SIZE_USDC
 *
 * Example: 5 USDC limit allows buying/selling up to 5 USDC worth per trade
 *
 * @default 5 - Conservative limit to prevent runaway losses on single trades
 */
const DEFAULT_MAX_TRADE_SIZE_USDC = 5;

/**
 * Maximum USDC trading volume allowed in a rolling 24-hour window.
 *
 * Controls the daily volume ceiling enforced by enforcePolicy(). Tracks all trades
 * in the last 24 hours and rejects new trades if total volume would exceed this limit.
 *
 * Formula: sum(trades_last_24h) + current_trade <= DEFAULT_DAILY_VOLUME_LIMIT_USDC
 *
 * Example: 20 USDC limit allows 4 max-size trades (4 × 5 USDC) per day
 *
 * @default 20 - 4x maxTradeSize to allow multiple trades while preventing excessive activity
 */
const DEFAULT_DAILY_VOLUME_LIMIT_USDC = 20;

/**
 * Maximum USDC amount allowed per trading session/round.
 *
 * Controls the per-session ceiling (currently not enforced in enforcePolicy, but
 * available for future session-based validation logic).
 *
 * Formula: session_volume <= DEFAULT_SESSION_LIMIT_USDC
 *
 * Example: 10 USDC limit allows 2 max-size trades (2 × 5 USDC) per session
 *
 * @default 10 - 2x maxTradeSize to allow some flexibility within a single round
 */
const DEFAULT_SESSION_LIMIT_USDC = 10;

/**
 * Maximum number of trades allowed in a rolling 1-hour window.
 *
 * Controls the hourly rate limit enforced by enforcePolicy(). Tracks trade count
 * (not volume) in the last hour and rejects new trades if count reaches this limit.
 *
 * Formula: count(trades_last_hour) < DEFAULT_MAX_TRADES_PER_HOUR
 *
 * Example: 2 trades/hour prevents high-frequency trading and rate limit abuse
 *
 * @default 2 - Conservative rate limit to prevent thundering herd on Jupiter API
 */
const DEFAULT_MAX_TRADES_PER_HOUR = 2;

// ---------------------------------------------------------------------------
// Default Policy
// ---------------------------------------------------------------------------

const DEFAULT_ALLOWED_MINTS: string[] = [
  USDC_MINT_MAINNET,
  ...XSTOCKS_CATALOG.map((s) => s.mintAddress),
];

export const DEFAULT_POLICY: WalletPolicy = {
  maxTradeSize: DEFAULT_MAX_TRADE_SIZE_USDC,
  dailyVolumeLimit: DEFAULT_DAILY_VOLUME_LIMIT_USDC,
  sessionLimit: DEFAULT_SESSION_LIMIT_USDC,
  allowedMints: DEFAULT_ALLOWED_MINTS,
  maxTradesPerHour: DEFAULT_MAX_TRADES_PER_HOUR,
  requireQuoteFirst: true,
  enabled: true,
};

// ---------------------------------------------------------------------------
// In-memory tracking state
// ---------------------------------------------------------------------------

interface TradeRecord {
  timestamp: number;
  amount: number;
  symbol: string;
}

const agentTradeHistory = new Map<string, TradeRecord[]>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

function getHistory(agentId: string): TradeRecord[] {
  let history = agentTradeHistory.get(agentId);
  if (!history) {
    history = [];
    agentTradeHistory.set(agentId, history);
  }
  return history;
}

function pruneOld(history: TradeRecord[], cutoff: number): TradeRecord[] {
  return history.filter((r) => r.timestamp >= cutoff);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface EnforceResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Check whether a proposed trade is allowed under the agent's policy.
 * Does NOT record the trade — call `recordTrade` after successful execution.
 */
export function enforcePolicy(
  agentId: string,
  symbol: string,
  _side: "buy" | "sell",
  amount: number,
): EnforceResult {
  const policy = getAgentPolicy(agentId);

  // Kill switch
  if (!policy.enabled) {
    return { allowed: false, reason: "Trading is disabled (kill switch)" };
  }

  // Allowlist check — look up mint for the symbol
  const token = XSTOCKS_CATALOG.find((t) => t.symbol === symbol);
  const mint = token?.mintAddress;
  if (mint && !policy.allowedMints.includes(mint)) {
    return {
      allowed: false,
      reason: `Mint ${mint} for ${symbol} is not in the allowlist`,
    };
  }

  // Max trade size
  if (amount > policy.maxTradeSize) {
    return {
      allowed: false,
      reason: `Trade size ${amount} USDC exceeds max ${policy.maxTradeSize} USDC`,
    };
  }

  const now = Date.now();
  const history = getHistory(agentId);

  // Daily volume (rolling 24h)
  const recentDay = pruneOld(history, now - ONE_DAY_MS);
  const dailyVolume = recentDay.reduce((sum, r) => sum + r.amount, 0);
  if (dailyVolume + amount > policy.dailyVolumeLimit) {
    return {
      allowed: false,
      reason: `Daily volume ${dailyVolume + amount} USDC would exceed limit ${policy.dailyVolumeLimit} USDC`,
    };
  }

  // Hourly rate limit
  const recentHour = pruneOld(history, now - ONE_HOUR_MS);
  if (recentHour.length >= policy.maxTradesPerHour) {
    return {
      allowed: false,
      reason: `Hourly trade count ${recentHour.length} has reached limit ${policy.maxTradesPerHour}`,
    };
  }

  return { allowed: true };
}

/**
 * Record a completed trade in the agent's history.
 */
export function recordTrade(
  agentId: string,
  symbol: string,
  amount: number,
): void {
  const history = getHistory(agentId);
  history.push({ timestamp: Date.now(), amount, symbol });

  // Prune entries older than 24h to bound memory
  const cutoff = Date.now() - ONE_DAY_MS;
  const pruned = pruneOld(history, cutoff);
  agentTradeHistory.set(agentId, pruned);
}

/**
 * Get the policy for an agent (currently always DEFAULT_POLICY).
 */
export function getAgentPolicy(_agentId: string): WalletPolicy {
  return DEFAULT_POLICY;
}

/**
 * Get trade stats for an agent (volume, rate, etc.).
 */
export function getAgentTradeStats(agentId: string): {
  dailyVolumeUsed: number;
  dailyVolumeLimit: number;
  tradesLastHour: number;
  maxTradesPerHour: number;
  tradesLast24h: number;
} {
  const policy = getAgentPolicy(agentId);
  const now = Date.now();
  const history = getHistory(agentId);

  const recentDay = pruneOld(history, now - ONE_DAY_MS);
  const recentHour = pruneOld(history, now - ONE_HOUR_MS);

  return {
    dailyVolumeUsed: recentDay.reduce((sum, r) => sum + r.amount, 0),
    dailyVolumeLimit: policy.dailyVolumeLimit,
    tradesLastHour: recentHour.length,
    maxTradesPerHour: policy.maxTradesPerHour,
    tradesLast24h: recentDay.length,
  };
}
