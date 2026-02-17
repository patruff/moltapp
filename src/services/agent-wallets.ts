/**
 * Agent Wallet Management
 *
 * Manages the pre-configured agent wallets (Claude, GPT, Grok, Gemini).
 * Each agent has a dedicated Solana wallet for trading xStocks.
 *
 * Features:
 * - Pre-configured wallet addresses per agent
 * - Minimum SOL balance check before trading
 * - Balance tracking (before/after each trade)
 * - Wallet status reporting
 * - Integration with Solana tracker for on-chain data
 */

import {
  getBalance,
  getTokenBalances,
  type TokenBalance,
} from "./solana-tracker.ts";
import { XSTOCKS_CATALOG } from "../config/constants.ts";
import { errorMessage } from "../lib/errors.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentWalletConfig {
  agentId: string;
  agentName: string;
  /** Solana public key (base58) */
  publicKey: string;
  /** Provider for this agent's LLM */
  provider: "anthropic" | "openai" | "xai" | "google";
}

export interface AgentWalletStatus {
  agentId: string;
  agentName: string;
  publicKey: string;
  solBalance: number;
  solBalanceLamports: bigint;
  hasMinimumSol: boolean;
  tokenBalances: TokenBalance[];
  /** xStocks holdings only (filtered from all tokens) */
  xStockHoldings: Array<{
    symbol: string;
    name: string;
    mintAddress: string;
    amount: number;
    rawAmount: string;
  }>;
  lastCheckedAt: string;
}

export interface BalanceSnapshot {
  agentId: string;
  timestamp: string;
  solBalance: number;
  tokenBalances: Array<{
    mintAddress: string;
    amount: number;
  }>;
  context: string;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Minimum SOL required for transaction fees (0.01 SOL = 10M lamports) */
const MIN_SOL_LAMPORTS = 10_000_000n;
const MIN_SOL = 0.01;

/**
 * Solana system program address used as a placeholder wallet address.
 *
 * This is the well-known Solana System Program public key (all 1s in base58).
 * Used when no real wallet address is configured via environment variables.
 *
 * Checks against this value are used to skip on-chain RPC queries when running
 * without real wallets (e.g., local development, paper trading mode, CI).
 *
 * To configure real wallets, set the corresponding environment variables:
 * - ANTHROPIC_WALLET_PUBLIC (Claude ValueBot)
 * - OPENAI_WALLET_PUBLIC (GPT MomentumBot)
 * - GROK_WALLET_PUBLIC (Grok ContrarianBot)
 * - GEMINI_WALLET_PUBLIC or ONBOARD_WALLET_PUBLIC (Gemini AnalystBot)
 */
const PLACEHOLDER_WALLET_ADDRESS = "11111111111111111111111111111111";

/**
 * Agent wallet configurations.
 *
 * In production, these wallet addresses are set via environment variables.
 * Each agent gets its own Turnkey-managed wallet.
 */
const AGENT_WALLET_CONFIGS: AgentWalletConfig[] = [
  {
    agentId: "claude-value-investor",
    agentName: "Claude ValueBot",
    publicKey:
      process.env.ANTHROPIC_WALLET_PUBLIC ||
      PLACEHOLDER_WALLET_ADDRESS, // Placeholder
    provider: "anthropic",
  },
  {
    agentId: "gpt-momentum-trader",
    agentName: "GPT MomentumBot",
    publicKey:
      process.env.OPENAI_WALLET_PUBLIC ||
      PLACEHOLDER_WALLET_ADDRESS, // Placeholder
    provider: "openai",
  },
  {
    agentId: "grok-contrarian",
    agentName: "Grok ContrarianBot",
    publicKey:
      process.env.GROK_WALLET_PUBLIC ||
      PLACEHOLDER_WALLET_ADDRESS, // Placeholder
    provider: "xai",
  },
  {
    agentId: "gemini-analyst",
    agentName: "Gemini AnalystBot",
    publicKey:
      process.env.GEMINI_WALLET_PUBLIC ||
      process.env.ONBOARD_WALLET_PUBLIC ||
      PLACEHOLDER_WALLET_ADDRESS, // Placeholder
    provider: "google",
  },
];

// ---------------------------------------------------------------------------
// Balance Snapshot History
// ---------------------------------------------------------------------------

const snapshotHistory: BalanceSnapshot[] = [];

/**
 * Maximum number of balance snapshots to retain in memory.
 *
 * Snapshots are recorded before and after each trade to track balance changes.
 * Older entries are evicted when this limit is reached.
 *
 * Tuning impact: Increase for longer balance history (higher memory usage),
 * decrease for less memory consumption.
 */
const MAX_SNAPSHOTS = 500;

/**
 * Default number of snapshots returned by getBalanceSnapshots (per-agent).
 *
 * When no limit is specified, returns this many of the most recent snapshots
 * for an individual agent's trade history.
 *
 * Tuning impact: Increase to show more trade history, decrease to reduce
 * response payload size.
 */
const DEFAULT_AGENT_SNAPSHOT_LIMIT = 20;

/**
 * Default number of snapshots returned by getAllBalanceSnapshots (all agents).
 *
 * When no limit is specified, returns this many of the most recent snapshots
 * across all agents combined.
 *
 * Tuning impact: Increase for broader cross-agent visibility, decrease for
 * smaller API response payloads.
 */
const DEFAULT_ALL_SNAPSHOTS_LIMIT = 50;

// ---------------------------------------------------------------------------
// Known xStocks mint addresses (for filtering)
// ---------------------------------------------------------------------------

const xStockMints = new Set(XSTOCKS_CATALOG.map((s) => s.mintAddress));
const xStockByMint = new Map(
  XSTOCKS_CATALOG.map((s) => [s.mintAddress, s]),
);

// ---------------------------------------------------------------------------
// Core Functions
// ---------------------------------------------------------------------------

/**
 * Get the wallet configuration for an agent.
 */
export function getAgentWallet(
  agentId: string,
): AgentWalletConfig | null {
  return (
    AGENT_WALLET_CONFIGS.find((w) => w.agentId === agentId) ?? null
  );
}

/**
 * Get all agent wallet configurations.
 */
export function getAllAgentWallets(): AgentWalletConfig[] {
  return [...AGENT_WALLET_CONFIGS];
}

/**
 * Check if an agent's wallet has sufficient SOL for transaction fees.
 */
export async function checkMinimumSol(
  agentId: string,
): Promise<{ hasMinimum: boolean; balance: number; required: number }> {
  const wallet = getAgentWallet(agentId);
  if (!wallet) {
    throw new Error(
      `agent_wallet_not_found: no wallet configured for ${agentId}`,
    );
  }

  // Skip check for placeholder addresses
  if (wallet.publicKey === PLACEHOLDER_WALLET_ADDRESS) {
    return { hasMinimum: true, balance: 0, required: MIN_SOL };
  }

  const { sol, lamports } = await getBalance(wallet.publicKey);

  return {
    hasMinimum: lamports >= MIN_SOL_LAMPORTS,
    balance: sol,
    required: MIN_SOL,
  };
}

/**
 * Get comprehensive wallet status for an agent, including SOL balance
 * and all token holdings (with xStocks filtered out).
 */
export async function getAgentWalletStatus(
  agentId: string,
): Promise<AgentWalletStatus> {
  const wallet = getAgentWallet(agentId);
  if (!wallet) {
    throw new Error(
      `agent_wallet_not_found: no wallet configured for ${agentId}`,
    );
  }

  // Skip on-chain queries for placeholder addresses
  if (wallet.publicKey === PLACEHOLDER_WALLET_ADDRESS) {
    return {
      agentId: wallet.agentId,
      agentName: wallet.agentName,
      publicKey: wallet.publicKey,
      solBalance: 0,
      solBalanceLamports: 0n,
      hasMinimumSol: false,
      tokenBalances: [],
      xStockHoldings: [],
      lastCheckedAt: new Date().toISOString(),
    };
  }

  const [solResult, tokens] = await Promise.all([
    getBalance(wallet.publicKey),
    getTokenBalances(wallet.publicKey),
  ]);

  // Filter for xStocks
  const xStockHoldings = tokens
    .filter((t) => xStockMints.has(t.mintAddress))
    .map((t) => {
      const stockInfo = xStockByMint.get(t.mintAddress);
      return {
        symbol: stockInfo?.symbol ?? "UNKNOWN",
        name: stockInfo?.name ?? "Unknown Token",
        mintAddress: t.mintAddress,
        amount: t.amount,
        rawAmount: t.rawAmount,
      };
    });

  return {
    agentId: wallet.agentId,
    agentName: wallet.agentName,
    publicKey: wallet.publicKey,
    solBalance: solResult.sol,
    solBalanceLamports: solResult.lamports,
    hasMinimumSol: solResult.lamports >= MIN_SOL_LAMPORTS,
    tokenBalances: tokens,
    xStockHoldings,
    lastCheckedAt: new Date().toISOString(),
  };
}

/**
 * Get wallet status for all 3 agents.
 */
export async function getAllAgentWalletStatuses(): Promise<
  AgentWalletStatus[]
> {
  const results = await Promise.allSettled(
    AGENT_WALLET_CONFIGS.map((w) => getAgentWalletStatus(w.agentId)),
  );

  return results
    .filter(
      (r): r is PromiseFulfilledResult<AgentWalletStatus> =>
        r.status === "fulfilled",
    )
    .map((r) => r.value);
}

// ---------------------------------------------------------------------------
// Balance Snapshots
// ---------------------------------------------------------------------------

/**
 * Record a balance snapshot for an agent (before/after trades).
 */
export async function recordBalanceSnapshot(
  agentId: string,
  context: string,
): Promise<BalanceSnapshot> {
  const wallet = getAgentWallet(agentId);
  if (!wallet) {
    throw new Error(
      `agent_wallet_not_found: no wallet configured for ${agentId}`,
    );
  }

  let solBalance = 0;
  let tokenBalances: Array<{ mintAddress: string; amount: number }> = [];

  // Skip on-chain queries for placeholder addresses
  if (wallet.publicKey !== PLACEHOLDER_WALLET_ADDRESS) {
    const [solResult, tokens] = await Promise.all([
      getBalance(wallet.publicKey),
      getTokenBalances(wallet.publicKey),
    ]);

    solBalance = solResult.sol;
    tokenBalances = tokens.map((t) => ({
      mintAddress: t.mintAddress,
      amount: t.amount,
    }));
  }

  const snapshot: BalanceSnapshot = {
    agentId,
    timestamp: new Date().toISOString(),
    solBalance,
    tokenBalances,
    context,
  };

  snapshotHistory.push(snapshot);

  // Keep history bounded
  if (snapshotHistory.length > MAX_SNAPSHOTS) {
    snapshotHistory.splice(0, snapshotHistory.length - MAX_SNAPSHOTS);
  }

  console.log(
    `[AgentWallets] Snapshot recorded for ${agentId}: ${context} — ${solBalance.toFixed(4)} SOL, ${tokenBalances.length} tokens`,
  );

  return snapshot;
}

/**
 * Get balance snapshot history for an agent.
 */
export function getBalanceSnapshots(
  agentId: string,
  limit = DEFAULT_AGENT_SNAPSHOT_LIMIT,
): BalanceSnapshot[] {
  return snapshotHistory
    .filter((s) => s.agentId === agentId)
    .slice(-limit);
}

/**
 * Get all balance snapshots.
 */
export function getAllBalanceSnapshots(limit = DEFAULT_ALL_SNAPSHOTS_LIMIT): BalanceSnapshot[] {
  return snapshotHistory.slice(-limit);
}

// ---------------------------------------------------------------------------
// Fund Check (Pre-Trade)
// ---------------------------------------------------------------------------

/**
 * Pre-trade fund check for an agent.
 *
 * Verifies:
 * 1. Wallet is configured
 * 2. Wallet has minimum SOL for fees
 * 3. Returns current balances for the trading service
 */
export async function preTradeFundCheck(agentId: string): Promise<{
  ready: boolean;
  reason: string | null;
  solBalance: number;
  publicKey: string;
}> {
  const wallet = getAgentWallet(agentId);
  if (!wallet) {
    return {
      ready: false,
      reason: `No wallet configured for agent ${agentId}`,
      solBalance: 0,
      publicKey: "",
    };
  }

  // Placeholder check
  if (wallet.publicKey === PLACEHOLDER_WALLET_ADDRESS) {
    return {
      ready: false,
      reason: `Wallet for ${agentId} is a placeholder. Set ${wallet.agentName.toUpperCase().replace(/\s/g, "_")}_WALLET_ADDRESS env var.`,
      solBalance: 0,
      publicKey: wallet.publicKey,
    };
  }

  try {
    const { sol, lamports } = await getBalance(wallet.publicKey);

    if (lamports < MIN_SOL_LAMPORTS) {
      return {
        ready: false,
        reason: `Insufficient SOL for fees: ${sol.toFixed(4)} SOL (need ${MIN_SOL} SOL)`,
        solBalance: sol,
        publicKey: wallet.publicKey,
      };
    }

    return {
      ready: true,
      reason: null,
      solBalance: sol,
      publicKey: wallet.publicKey,
    };
  } catch (err) {
    return {
      ready: false,
      reason: `Failed to check balance: ${errorMessage(err)}`,
      solBalance: 0,
      publicKey: wallet.publicKey,
    };
  }
}
