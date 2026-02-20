/**
 * Trade Forensic Ledger (v17)
 *
 * An immutable, append-only ledger that records every trade decision with
 * cryptographic sealing. Unlike the basic trade_justifications table, the
 * forensic ledger captures:
 *
 * 1. Full reasoning provenance (pre-commit hash, market snapshot hash)
 * 2. Cross-agent corroboration (witnesses)
 * 3. Post-trade outcome resolution with PnL attribution
 * 4. Reasoning quality decomposition (which parts of the reasoning were correct?)
 * 5. Temporal chain integrity (each entry links to previous)
 *
 * This is the foundation for benchmark reproducibility — any researcher
 * can replay the ledger and verify every score from raw data.
 */

import { createHash } from "crypto";
import { ID_RANDOM_START, ID_RANDOM_LENGTH_STANDARD } from "../config/constants.ts";
import { averageByKey, countByCondition } from "../lib/math-utils.js";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Maximum number of entries retained in the forensic ledger.
 * When exceeded, oldest entries are evicted (FIFO eviction).
 *
 * 5,000 entries ≈ 1,667 rounds of 3-agent trading (Claude, GPT, Grok).
 * At 3 rounds/hour, this represents ~555 hours (~23 days) of trading history.
 *
 * Tuning: Increase to 10,000 for longer retention (46 days), decrease to 2,500 for memory-constrained environments.
 */
const MAX_LEDGER_SIZE = 5000;

/**
 * Default limit for ledger query results.
 * Prevents overwhelming API responses when querying large ledgers.
 *
 * 50 entries = ~16-17 rounds of 3-agent trading.
 *
 * Tuning: Increase to 100 for researcher exports, decrease to 20 for UI pagination.
 */
const DEFAULT_QUERY_LIMIT = 50;

/**
 * Benchmark version stamped on all ledger entries.
 * Used for forensic reproducibility — researchers can filter by version.
 *
 * Current: v17 (forensic ledger with cryptographic sealing + outcome resolution).
 *
 * Update: Increment when ledger schema changes (e.g., v18 for new quality metrics).
 */
const BENCHMARK_VERSION = "v17";

/**
 * Fallback sequence number when ledger is empty.
 * Used in getLedgerStats() for lastSequence initialization.
 *
 * -1 indicates "no entries exist" (sequence numbers start at 0).
 */
const EMPTY_LEDGER_SEQUENCE = -1;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LedgerEntry {
  /** Unique entry ID */
  entryId: string;
  /** Sequence number in the ledger */
  sequenceNumber: number;
  /** Hash of previous entry (chain integrity) */
  previousHash: string;
  /** Hash of this entry (SHA-256) */
  entryHash: string;

  // --- Trade data ---
  agentId: string;
  roundId: string;
  action: string;
  symbol: string;
  quantity: number;
  reasoning: string;
  confidence: number;
  intent: string;
  sources: string[];
  predictedOutcome: string | null;

  // --- Market context at time of trade ---
  marketSnapshotHash: string;
  priceAtTrade: number | null;

  // --- Quality scores at time of trade ---
  coherenceScore: number;
  hallucinationFlags: string[];
  disciplinePass: boolean;
  depthScore: number;
  forensicScore: number;
  efficiencyScore: number;

  // --- Outcome (filled later) ---
  outcomeResolved: boolean;
  outcomeCorrect: boolean | null;
  pnlPercent: number | null;
  outcomeTimestamp: string | null;

  // --- Witness data ---
  witnesses: string[]; // Other agent IDs that traded in the same round

  // --- Metadata ---
  timestamp: string;
  benchmarkVersion: string;
}

export interface LedgerStats {
  totalEntries: number;
  chainIntact: boolean;
  agentBreakdown: Record<string, {
    entries: number;
    avgCoherence: number;
    avgDepth: number;
    hallucinationRate: number;
    outcomeResolvedRate: number;
    outcomeAccuracyRate: number;
  }>;
  lastEntryHash: string;
  lastSequence: number;
  oldestEntry: string | null;
  newestEntry: string | null;
}

export interface LedgerQuery {
  agentId?: string;
  symbol?: string;
  roundId?: string;
  action?: string;
  minCoherence?: number;
  maxHallucinations?: number;
  outcomeResolved?: boolean;
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// Ledger state
// ---------------------------------------------------------------------------

const ledger: LedgerEntry[] = [];

// ---------------------------------------------------------------------------
// Hash helpers
// ---------------------------------------------------------------------------

function hashEntry(entry: Omit<LedgerEntry, "entryHash">): string {
  const data = JSON.stringify({
    entryId: entry.entryId,
    sequenceNumber: entry.sequenceNumber,
    previousHash: entry.previousHash,
    agentId: entry.agentId,
    roundId: entry.roundId,
    action: entry.action,
    symbol: entry.symbol,
    reasoning: entry.reasoning,
    confidence: entry.confidence,
    timestamp: entry.timestamp,
  });
  return createHash("sha256").update(data).digest("hex");
}

function hashMarketSnapshot(prices: Record<string, number>): string {
  const sorted = Object.entries(prices).sort(([a], [b]) => a.localeCompare(b));
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

/**
 * Append a new entry to the forensic ledger.
 * Returns the entry with its computed hash.
 */
export function appendToLedger(params: {
  agentId: string;
  roundId: string;
  action: string;
  symbol: string;
  quantity: number;
  reasoning: string;
  confidence: number;
  intent: string;
  sources: string[];
  predictedOutcome: string | null;
  marketPrices: Record<string, number>;
  coherenceScore: number;
  hallucinationFlags: string[];
  disciplinePass: boolean;
  depthScore: number;
  forensicScore: number;
  efficiencyScore: number;
  witnesses: string[];
}): LedgerEntry {
  const sequenceNumber = ledger.length;
  const previousHash = ledger.length > 0 ? ledger[ledger.length - 1].entryHash : "genesis";
  const entryId = `le_${Date.now()}_${Math.random().toString(36).slice(ID_RANDOM_START, ID_RANDOM_START + ID_RANDOM_LENGTH_STANDARD)}`;

  const priceAtTrade = params.marketPrices[params.symbol] ??
    params.marketPrices[params.symbol.toLowerCase()] ?? null;

  const entry: Omit<LedgerEntry, "entryHash"> = {
    entryId,
    sequenceNumber,
    previousHash,
    agentId: params.agentId,
    roundId: params.roundId,
    action: params.action,
    symbol: params.symbol,
    quantity: params.quantity,
    reasoning: params.reasoning,
    confidence: params.confidence,
    intent: params.intent,
    sources: params.sources,
    predictedOutcome: params.predictedOutcome,
    marketSnapshotHash: hashMarketSnapshot(params.marketPrices),
    priceAtTrade,
    coherenceScore: params.coherenceScore,
    hallucinationFlags: params.hallucinationFlags,
    disciplinePass: params.disciplinePass,
    depthScore: params.depthScore,
    forensicScore: params.forensicScore,
    efficiencyScore: params.efficiencyScore,
    outcomeResolved: false,
    outcomeCorrect: null,
    pnlPercent: null,
    outcomeTimestamp: null,
    witnesses: params.witnesses,
    timestamp: new Date().toISOString(),
    benchmarkVersion: BENCHMARK_VERSION,
  };

  const entryHash = hashEntry(entry);
  const fullEntry: LedgerEntry = { ...entry, entryHash };

  ledger.push(fullEntry);

  // Evict oldest if over size limit
  if (ledger.length > MAX_LEDGER_SIZE) {
    ledger.splice(0, ledger.length - MAX_LEDGER_SIZE);
  }

  return fullEntry;
}

/**
 * Resolve an outcome for a ledger entry (fills in PnL and correctness).
 */
export function resolveLedgerOutcome(
  entryId: string,
  pnlPercent: number,
  outcomeCorrect: boolean,
): boolean {
  const entry = ledger.find((e) => e.entryId === entryId);
  if (!entry || entry.outcomeResolved) return false;

  entry.outcomeResolved = true;
  entry.outcomeCorrect = outcomeCorrect;
  entry.pnlPercent = pnlPercent;
  entry.outcomeTimestamp = new Date().toISOString();
  return true;
}

/**
 * Query the ledger with filters.
 */
export function queryLedger(query: LedgerQuery): { entries: LedgerEntry[]; total: number } {
  let filtered = [...ledger];

  if (query.agentId) filtered = filtered.filter((e) => e.agentId === query.agentId);
  if (query.symbol) filtered = filtered.filter((e) => e.symbol.toLowerCase() === query.symbol!.toLowerCase());
  if (query.roundId) filtered = filtered.filter((e) => e.roundId === query.roundId);
  if (query.action) filtered = filtered.filter((e) => e.action === query.action);
  if (query.minCoherence !== undefined) filtered = filtered.filter((e) => e.coherenceScore >= query.minCoherence!);
  if (query.maxHallucinations !== undefined) filtered = filtered.filter((e) => e.hallucinationFlags.length <= query.maxHallucinations!);
  if (query.outcomeResolved !== undefined) filtered = filtered.filter((e) => e.outcomeResolved === query.outcomeResolved);

  // Sort newest first
  filtered.sort((a, b) => b.sequenceNumber - a.sequenceNumber);

  const total = filtered.length;
  const offset = query.offset ?? 0;
  const limit = query.limit ?? DEFAULT_QUERY_LIMIT;
  const entries = filtered.slice(offset, offset + limit);

  return { entries, total };
}

/**
 * Verify the integrity of the ledger chain.
 */
export function verifyLedgerIntegrity(): {
  intact: boolean;
  brokenAt: number | null;
  totalChecked: number;
  genesisHash: string;
  latestHash: string;
} {
  if (ledger.length === 0) {
    return { intact: true, brokenAt: null, totalChecked: 0, genesisHash: "empty", latestHash: "empty" };
  }

  // Verify each entry's hash matches its data
  for (let i = 0; i < ledger.length; i++) {
    const entry = ledger[i];
    const { entryHash, ...rest } = entry;
    const computed = hashEntry(rest);
    if (computed !== entryHash) {
      return {
        intact: false,
        brokenAt: i,
        totalChecked: i + 1,
        genesisHash: ledger[0].entryHash,
        latestHash: ledger[ledger.length - 1].entryHash,
      };
    }

    // Verify chain link
    if (i > 0 && entry.previousHash !== ledger[i - 1].entryHash) {
      return {
        intact: false,
        brokenAt: i,
        totalChecked: i + 1,
        genesisHash: ledger[0].entryHash,
        latestHash: ledger[ledger.length - 1].entryHash,
      };
    }
  }

  return {
    intact: true,
    brokenAt: null,
    totalChecked: ledger.length,
    genesisHash: ledger[0].entryHash,
    latestHash: ledger[ledger.length - 1].entryHash,
  };
}

/**
 * Get aggregate ledger statistics.
 */
export function getLedgerStats(): LedgerStats {
  const agentBreakdown: LedgerStats["agentBreakdown"] = {};

  for (const entry of ledger) {
    if (!agentBreakdown[entry.agentId]) {
      agentBreakdown[entry.agentId] = {
        entries: 0,
        avgCoherence: 0,
        avgDepth: 0,
        hallucinationRate: 0,
        outcomeResolvedRate: 0,
        outcomeAccuracyRate: 0,
      };
    }
    agentBreakdown[entry.agentId].entries++;
  }

  // Compute averages
  for (const [agentId, stats] of Object.entries(agentBreakdown)) {
    const agentEntries = ledger.filter((e) => e.agentId === agentId);
    stats.avgCoherence = averageByKey(agentEntries, 'coherenceScore');
    stats.avgDepth = averageByKey(agentEntries, 'depthScore');
    stats.hallucinationRate = countByCondition(agentEntries, (e: LedgerEntry) => e.hallucinationFlags.length > 0) / agentEntries.length;
    const resolved = agentEntries.filter((e) => e.outcomeResolved);
    stats.outcomeResolvedRate = resolved.length / agentEntries.length;
    stats.outcomeAccuracyRate = resolved.length > 0
      ? countByCondition(resolved, (e: LedgerEntry) => e.outcomeCorrect === true) / resolved.length
      : 0;
  }

  const integrity = verifyLedgerIntegrity();

  return {
    totalEntries: ledger.length,
    chainIntact: integrity.intact,
    agentBreakdown,
    lastEntryHash: ledger.length > 0 ? ledger[ledger.length - 1].entryHash : "empty",
    lastSequence: ledger.length > 0 ? ledger[ledger.length - 1].sequenceNumber : EMPTY_LEDGER_SEQUENCE,
    oldestEntry: ledger.length > 0 ? ledger[0].timestamp : null,
    newestEntry: ledger.length > 0 ? ledger[ledger.length - 1].timestamp : null,
  };
}

/**
 * Export ledger as JSONL for researchers.
 */
export function exportLedgerJsonl(agentId?: string): string {
  const filtered = agentId ? ledger.filter((e) => e.agentId === agentId) : ledger;
  return filtered.map((e) => JSON.stringify(e)).join("\n");
}
