/**
 * Position Reconciler
 *
 * Compares database-tracked positions against actual on-chain Solana
 * wallet balances. This is critical for production integrity — it detects
 * discrepancies between what MoltApp thinks agents own vs. what's
 * actually in their wallets on-chain.
 *
 * Use cases:
 * - Post-trade verification: confirm chain reflects expected positions
 * - Periodic health checks: detect drift from failed/stuck transactions
 * - Audit trail: prove positions match chain state
 * - Dashboard: show verification status for each position
 *
 * Discrepancy types:
 * - PHANTOM: DB says agent owns tokens, chain says 0
 * - EXCESS: Chain has more tokens than DB tracks
 * - DEFICIT: Chain has fewer tokens than DB tracks
 * - MATCH: DB and chain agree (within tolerance)
 */

import { db } from "../db/index.ts";
import { positions } from "../db/schema/positions.ts";
import { eq } from "drizzle-orm";
import { getWalletBalances, type TokenBalance } from "./solana-tracker.ts";
import { XSTOCKS_CATALOG, TOKEN_2022_PROGRAM_ADDRESS } from "../config/constants.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DiscrepancyType = "MATCH" | "PHANTOM" | "EXCESS" | "DEFICIT";

export interface PositionReconciliation {
  agentId: string;
  walletAddress: string;
  symbol: string;
  mintAddress: string;
  /** Quantity tracked in MoltApp database */
  dbQuantity: number;
  /** Quantity found on-chain in wallet */
  chainQuantity: number;
  /** Absolute difference */
  difference: number;
  /** Percentage difference from DB quantity */
  differencePercent: number;
  /** Classification of the discrepancy */
  discrepancy: DiscrepancyType;
  /** Is this within acceptable tolerance? */
  withinTolerance: boolean;
  /** On-chain token account address (if exists) */
  tokenAccount: string | null;
  verifiedAt: string;
}

export interface ReconciliationReport {
  agentId: string;
  walletAddress: string;
  /** Individual position reconciliations */
  positions: PositionReconciliation[];
  /** SOL balance on-chain */
  solBalance: number;
  /** Summary stats */
  summary: {
    totalPositions: number;
    matched: number;
    phantoms: number;
    excesses: number;
    deficits: number;
    overallStatus: "healthy" | "warning" | "critical";
  };
  /** Time taken to reconcile */
  durationMs: number;
  reconciledAt: string;
}

export interface ReconcilerStats {
  totalReconciliations: number;
  totalPositionsChecked: number;
  discrepanciesFound: number;
  lastReconciliationAt: string | null;
  agentReports: Record<string, {
    lastStatus: "healthy" | "warning" | "critical";
    lastCheckedAt: string;
    discrepancies: number;
  }>;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Tolerance for floating-point rounding differences.
 * xStocks have 9 decimals, so we allow 0.000001 variance (1e-6).
 */
const QUANTITY_TOLERANCE = 0.000001;

/**
 * Percentage threshold for warning vs critical.
 * > 1% difference = warning, > 5% = critical.
 */
const WARNING_THRESHOLD_PERCENT = 1;
const CRITICAL_THRESHOLD_PERCENT = 5;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let totalReconciliations = 0;
let totalPositionsChecked = 0;
let discrepanciesFound = 0;
let lastReconciliationAt: string | null = null;

const agentReports: Record<string, {
  lastStatus: "healthy" | "warning" | "critical";
  lastCheckedAt: string;
  discrepancies: number;
}> = {};

// ---------------------------------------------------------------------------
// Core Reconciliation
// ---------------------------------------------------------------------------

/**
 * Reconcile a single agent's DB positions against on-chain balances.
 *
 * @param agentId - The agent to reconcile
 * @param walletAddress - The agent's Solana wallet address
 * @returns Full reconciliation report
 */
export async function reconcileAgent(
  agentId: string,
  walletAddress: string,
): Promise<ReconciliationReport> {
  const startTime = Date.now();
  const reconciliations: PositionReconciliation[] = [];

  // Step 1: Fetch DB positions for this agent
  const dbPositions = await db
    .select()
    .from(positions)
    .where(eq(positions.agentId, agentId));

  // Step 2: Fetch on-chain balances
  let chainBalances: { solBalance: number; tokens: TokenBalance[] };
  try {
    const walletData = await getWalletBalances(walletAddress);
    chainBalances = {
      solBalance: walletData.solBalance,
      tokens: walletData.tokens,
    };
  } catch (err) {
    console.error(
      `[Reconciler] Failed to fetch chain balances for ${agentId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    // Return a report with all positions marked as unverifiable
    return {
      agentId,
      walletAddress,
      positions: dbPositions.map((p: any) => ({
        agentId,
        walletAddress,
        symbol: p.symbol,
        mintAddress: p.mintAddress,
        dbQuantity: parseFloat(p.quantity),
        chainQuantity: 0,
        difference: parseFloat(p.quantity),
        differencePercent: 100,
        discrepancy: "PHANTOM" as const,
        withinTolerance: false,
        tokenAccount: null,
        verifiedAt: new Date().toISOString(),
      })),
      solBalance: 0,
      summary: {
        totalPositions: dbPositions.length,
        matched: 0,
        phantoms: dbPositions.length,
        excesses: 0,
        deficits: 0,
        overallStatus: "critical",
      },
      durationMs: Date.now() - startTime,
      reconciledAt: new Date().toISOString(),
    };
  }

  // Build a map of chain balances by mint address
  const chainBalanceMap = new Map<string, TokenBalance>();
  for (const token of chainBalances.tokens) {
    chainBalanceMap.set(token.mintAddress, token);
  }

  // Step 3: Reconcile each DB position against chain
  for (const dbPos of dbPositions) {
    const dbQty = parseFloat(dbPos.quantity);
    const chainToken = chainBalanceMap.get(dbPos.mintAddress);
    const chainQty = chainToken?.amount ?? 0;

    const difference = Math.abs(dbQty - chainQty);
    const differencePercent = dbQty > 0 ? (difference / dbQty) * 100 : chainQty > 0 ? 100 : 0;

    let discrepancy: DiscrepancyType;
    if (difference <= QUANTITY_TOLERANCE) {
      discrepancy = "MATCH";
    } else if (dbQty > 0 && chainQty === 0) {
      discrepancy = "PHANTOM";
    } else if (chainQty > dbQty) {
      discrepancy = "EXCESS";
    } else {
      discrepancy = "DEFICIT";
    }

    const withinTolerance =
      discrepancy === "MATCH" || differencePercent <= WARNING_THRESHOLD_PERCENT;

    reconciliations.push({
      agentId,
      walletAddress,
      symbol: dbPos.symbol,
      mintAddress: dbPos.mintAddress,
      dbQuantity: dbQty,
      chainQuantity: chainQty,
      difference,
      differencePercent: Math.round(differencePercent * 100) / 100,
      discrepancy,
      withinTolerance,
      tokenAccount: chainToken?.tokenAccount ?? null,
      verifiedAt: new Date().toISOString(),
    });

    // Remove from chain map (to detect excess tokens not in DB)
    chainBalanceMap.delete(dbPos.mintAddress);
  }

  // Step 4: Check for tokens on-chain that aren't tracked in DB
  // (These would be EXCESS — chain has tokens DB doesn't know about)
  for (const [mintAddress, chainToken] of chainBalanceMap) {
    // Only flag xStocks tokens, not random SPL tokens
    const stock = XSTOCKS_CATALOG.find((s) => s.mintAddress === mintAddress);
    if (!stock) continue;

    if (chainToken.amount > QUANTITY_TOLERANCE) {
      reconciliations.push({
        agentId,
        walletAddress,
        symbol: stock.symbol,
        mintAddress,
        dbQuantity: 0,
        chainQuantity: chainToken.amount,
        difference: chainToken.amount,
        differencePercent: 100,
        discrepancy: "EXCESS",
        withinTolerance: false,
        tokenAccount: chainToken.tokenAccount,
        verifiedAt: new Date().toISOString(),
      });
    }
  }

  // Step 5: Compute summary
  const matched = reconciliations.filter((r) => r.discrepancy === "MATCH").length;
  const phantoms = reconciliations.filter((r) => r.discrepancy === "PHANTOM").length;
  const excesses = reconciliations.filter((r) => r.discrepancy === "EXCESS").length;
  const deficits = reconciliations.filter((r) => r.discrepancy === "DEFICIT").length;

  let overallStatus: "healthy" | "warning" | "critical" = "healthy";
  if (phantoms > 0 || deficits > 0) {
    const maxDiffPercent = Math.max(
      ...reconciliations.map((r) => r.differencePercent),
      0,
    );
    if (maxDiffPercent >= CRITICAL_THRESHOLD_PERCENT || phantoms > 0) {
      overallStatus = "critical";
    } else if (maxDiffPercent >= WARNING_THRESHOLD_PERCENT) {
      overallStatus = "warning";
    }
  }

  // Track stats
  totalReconciliations++;
  totalPositionsChecked += reconciliations.length;
  discrepanciesFound += phantoms + excesses + deficits;
  lastReconciliationAt = new Date().toISOString();

  agentReports[agentId] = {
    lastStatus: overallStatus,
    lastCheckedAt: lastReconciliationAt,
    discrepancies: phantoms + excesses + deficits,
  };

  const report: ReconciliationReport = {
    agentId,
    walletAddress,
    positions: reconciliations,
    solBalance: chainBalances.solBalance,
    summary: {
      totalPositions: reconciliations.length,
      matched,
      phantoms,
      excesses,
      deficits,
      overallStatus,
    },
    durationMs: Date.now() - startTime,
    reconciledAt: new Date().toISOString(),
  };

  console.log(
    `[Reconciler] ${agentId}: ${matched} matched, ${phantoms} phantoms, ` +
    `${excesses} excesses, ${deficits} deficits — ${overallStatus} (${report.durationMs}ms)`,
  );

  return report;
}

/**
 * Reconcile all agents' positions.
 * Requires a map of agentId -> walletAddress.
 */
export async function reconcileAllAgents(
  agentWallets: Map<string, string>,
): Promise<ReconciliationReport[]> {
  const reports: ReconciliationReport[] = [];

  // Run reconciliation sequentially to avoid RPC rate limits
  for (const [agentId, walletAddress] of agentWallets) {
    try {
      const report = await reconcileAgent(agentId, walletAddress);
      reports.push(report);
    } catch (err) {
      console.error(
        `[Reconciler] Failed to reconcile ${agentId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Small delay between agents to respect RPC rate limits
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return reports;
}

/**
 * Quick position check — verify a single position after a trade.
 * Returns true if chain balance matches expected quantity (within tolerance).
 */
export async function verifyPosition(
  walletAddress: string,
  mintAddress: string,
  expectedQuantity: number,
): Promise<{ verified: boolean; chainQuantity: number; difference: number }> {
  try {
    const walletData = await getWalletBalances(walletAddress);
    const chainToken = walletData.tokens.find((t) => t.mintAddress === mintAddress);
    const chainQty = chainToken?.amount ?? 0;
    const difference = Math.abs(expectedQuantity - chainQty);

    return {
      verified: difference <= QUANTITY_TOLERANCE,
      chainQuantity: chainQty,
      difference,
    };
  } catch (err) {
    console.error(
      `[Reconciler] Position verification failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return {
      verified: false,
      chainQuantity: 0,
      difference: expectedQuantity,
    };
  }
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

/**
 * Get reconciler statistics for the dashboard.
 */
export function getReconcilerStats(): ReconcilerStats {
  return {
    totalReconciliations,
    totalPositionsChecked,
    discrepanciesFound,
    lastReconciliationAt,
    agentReports: { ...agentReports },
  };
}

/**
 * Reset reconciler statistics (admin use).
 */
export function resetReconcilerStats(): void {
  totalReconciliations = 0;
  totalPositionsChecked = 0;
  discrepanciesFound = 0;
  lastReconciliationAt = null;
  Object.keys(agentReports).forEach((k) => delete agentReports[k]);
}
