/**
 * Benchmark Provenance Chain
 *
 * Creates a tamper-evident chain of custody for all benchmark data.
 * Every dataset export, scoring event, and methodology change is
 * recorded with SHA-256 hashes forming an append-only chain.
 *
 * This is critical for benchmark credibility — auditors can verify
 * that results weren't retroactively altered.
 *
 * Chain structure:
 *   Genesis Block → Round Proof → Scoring Event → Dataset Export → ...
 *   Each block references the previous block's hash.
 *
 * Features:
 * - Append-only provenance chain with SHA-256 linking
 * - Dataset export fingerprinting
 * - Scoring methodology version tracking
 * - Agent enrollment/removal audit
 * - Round-level integrity proofs integrated into chain
 * - Chain verification (full and partial)
 * - Export provenance certificate for HuggingFace
 */

import { createHash } from "crypto";
import { ID_RANDOM_START, ID_RANDOM_LENGTH_LONG } from "../config/constants.ts";
import { round2, round3 } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProvenanceEventType =
  | "genesis"
  | "round_completed"
  | "scoring_applied"
  | "dataset_exported"
  | "methodology_changed"
  | "agent_enrolled"
  | "agent_removed"
  | "quality_gate_updated"
  | "manual_audit"
  | "external_submission";

export interface ProvenanceBlock {
  /** Block index in the chain */
  index: number;
  /** SHA-256 hash of this block's content */
  hash: string;
  /** SHA-256 hash of the previous block */
  previousHash: string;
  /** Event type */
  eventType: ProvenanceEventType;
  /** ISO timestamp */
  timestamp: string;
  /** Event-specific payload */
  payload: Record<string, unknown>;
  /** Who initiated this event */
  initiator: string;
  /** Nonce for uniqueness */
  nonce: string;
}

export interface ProvenanceCertificate {
  /** Certificate version */
  version: string;
  /** Chain length at time of generation */
  chainLength: number;
  /** Hash of the latest block */
  latestBlockHash: string;
  /** Hash of the genesis block */
  genesisHash: string;
  /** Dataset fingerprint (SHA-256 of JSONL content) */
  datasetFingerprint: string;
  /** Number of rounds covered */
  roundsCovered: number;
  /** Number of agents in the dataset */
  agentCount: number;
  /** Time range */
  timeRange: { from: string; to: string };
  /** Methodology version active at export */
  methodologyVersion: string;
  /** Certificate hash (signs itself) */
  certificateHash: string;
  /** ISO timestamp of generation */
  generatedAt: string;
}

export interface ChainVerificationResult {
  /** Whether the chain is valid */
  valid: boolean;
  /** Number of blocks verified */
  blocksVerified: number;
  /** Index of first broken link (null if chain is intact) */
  brokenAt: number | null;
  /** Verification details */
  checks: {
    genesisValid: boolean;
    hashChainIntact: boolean;
    noGaps: boolean;
    chronological: boolean;
  };
  /** Verification timestamp */
  verifiedAt: string;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const chain: ProvenanceBlock[] = [];
const MAX_CHAIN_LENGTH = 10000;
let methodologyVersion = "5.0.0";

// ---------------------------------------------------------------------------
// Hash Functions
// ---------------------------------------------------------------------------

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

function computeBlockHash(block: Omit<ProvenanceBlock, "hash">): string {
  const canonical = JSON.stringify({
    index: block.index,
    previousHash: block.previousHash,
    eventType: block.eventType,
    timestamp: block.timestamp,
    payload: block.payload,
    initiator: block.initiator,
    nonce: block.nonce,
  });
  return sha256(canonical);
}

function generateNonce(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(ID_RANDOM_START, ID_RANDOM_START + ID_RANDOM_LENGTH_LONG)}`;
}

// ---------------------------------------------------------------------------
// Chain Operations
// ---------------------------------------------------------------------------

/**
 * Initialize the provenance chain with a genesis block.
 * Called once at application startup.
 */
export function initializeChain(): ProvenanceBlock {
  if (chain.length > 0) return chain[0];

  const genesis: Omit<ProvenanceBlock, "hash"> = {
    index: 0,
    previousHash: "0".repeat(64),
    eventType: "genesis",
    timestamp: new Date().toISOString(),
    payload: {
      benchmark: "moltapp",
      version: methodologyVersion,
      agents: [
        "claude-value-investor",
        "gpt-momentum-trader",
        "grok-contrarian",
      ],
      description:
        "MoltApp Agentic Stock Trading Benchmark — provenance chain initialized",
    },
    initiator: "system",
    nonce: generateNonce(),
  };

  const block: ProvenanceBlock = {
    ...genesis,
    hash: computeBlockHash(genesis),
  };

  chain.push(block);
  return block;
}

/**
 * Append a new event to the provenance chain.
 */
export function appendToChain(
  eventType: ProvenanceEventType,
  payload: Record<string, unknown>,
  initiator = "system",
): ProvenanceBlock {
  if (chain.length === 0) {
    initializeChain();
  }

  const previousBlock = chain[chain.length - 1];

  const partial: Omit<ProvenanceBlock, "hash"> = {
    index: previousBlock.index + 1,
    previousHash: previousBlock.hash,
    eventType,
    timestamp: new Date().toISOString(),
    payload,
    initiator,
    nonce: generateNonce(),
  };

  const block: ProvenanceBlock = {
    ...partial,
    hash: computeBlockHash(partial),
  };

  chain.push(block);

  // Trim if too long (keep genesis + recent)
  if (chain.length > MAX_CHAIN_LENGTH) {
    const genesis = chain[0];
    const recent = chain.slice(-MAX_CHAIN_LENGTH + 1);
    chain.length = 0;
    chain.push(genesis, ...recent);
  }

  return block;
}

// ---------------------------------------------------------------------------
// Event Recording Helpers
// ---------------------------------------------------------------------------

/**
 * Record a completed trading round in the provenance chain.
 */
export function recordRoundProvenance(roundId: string, results: {
  agentCount: number;
  tradeCount: number;
  avgCoherence: number;
  hallucinationCount: number;
  tradingMode: string;
}): ProvenanceBlock {
  return appendToChain("round_completed", {
    roundId,
    agentCount: results.agentCount,
    tradeCount: results.tradeCount,
    avgCoherence: round3(results.avgCoherence),
    hallucinationCount: results.hallucinationCount,
    tradingMode: results.tradingMode,
  });
}

/**
 * Record a scoring event (benchmark scores were computed).
 */
export function recordScoringProvenance(agentId: string, scores: {
  composite: number;
  coherence: number;
  hallucinationRate: number;
  discipline: number;
  pnl: number;
  sharpe: number;
}): ProvenanceBlock {
  return appendToChain("scoring_applied", {
    agentId,
    composite: round3(scores.composite),
    coherence: round3(scores.coherence),
    hallucinationRate: round3(scores.hallucinationRate),
    discipline: round3(scores.discipline),
    pnl: round2(scores.pnl),
    sharpe: round3(scores.sharpe),
    methodologyVersion,
  });
}

/**
 * Record a dataset export event.
 */
export function recordDatasetExport(exportInfo: {
  format: "jsonl" | "csv" | "parquet";
  recordCount: number;
  datasetHash: string;
  destination: string;
}): ProvenanceBlock {
  return appendToChain("dataset_exported", {
    format: exportInfo.format,
    recordCount: exportInfo.recordCount,
    datasetHash: exportInfo.datasetHash,
    destination: exportInfo.destination,
    methodologyVersion,
  });
}

/**
 * Record a methodology version change.
 */
export function recordMethodologyChange(
  newVersion: string,
  changes: string[],
  changedBy: string,
): ProvenanceBlock {
  const oldVersion = methodologyVersion;
  methodologyVersion = newVersion;

  return appendToChain(
    "methodology_changed",
    {
      oldVersion,
      newVersion,
      changes,
    },
    changedBy,
  );
}

/**
 * Record an agent enrollment.
 */
export function recordAgentEnrollment(agentId: string, metadata: {
  provider: string;
  model: string;
  style: string;
}): ProvenanceBlock {
  return appendToChain("agent_enrolled", {
    agentId,
    provider: metadata.provider,
    model: metadata.model,
    style: metadata.style,
  });
}

/**
 * Record an external submission scored.
 */
export function recordExternalSubmission(submissionId: string, agentId: string, score: number): ProvenanceBlock {
  return appendToChain("external_submission", {
    submissionId,
    agentId,
    compositeScore: round3(score),
  });
}

// ---------------------------------------------------------------------------
// Chain Verification
// ---------------------------------------------------------------------------

/**
 * Verify the integrity of the entire provenance chain.
 */
export function verifyChain(): ChainVerificationResult {
  if (chain.length === 0) {
    return {
      valid: false,
      blocksVerified: 0,
      brokenAt: null,
      checks: {
        genesisValid: false,
        hashChainIntact: false,
        noGaps: false,
        chronological: false,
      },
      verifiedAt: new Date().toISOString(),
    };
  }

  // Check 1: Genesis block
  const genesis = chain[0];
  const genesisValid =
    genesis.index === 0 &&
    genesis.previousHash === "0".repeat(64) &&
    genesis.eventType === "genesis";

  // Check 2: Hash chain integrity
  let hashChainIntact = true;
  let brokenAt: number | null = null;

  for (let i = 0; i < chain.length; i++) {
    const block = chain[i];

    // Verify block's own hash
    const { hash: _hash, ...rest } = block;
    const expectedHash = computeBlockHash(rest);
    if (expectedHash !== block.hash) {
      hashChainIntact = false;
      brokenAt = i;
      break;
    }

    // Verify chain link (except genesis)
    if (i > 0 && block.previousHash !== chain[i - 1].hash) {
      hashChainIntact = false;
      brokenAt = i;
      break;
    }
  }

  // Check 3: No gaps in indices
  let noGaps = true;
  for (let i = 0; i < chain.length; i++) {
    if (chain[i].index !== (i === 0 ? 0 : chain[i - 1].index + 1)) {
      // Allow gaps from trimming, but first block after genesis must be sequential
      if (i === 1) {
        noGaps = true; // Trimmed chain is OK
      } else {
        noGaps = false;
      }
    }
  }

  // Check 4: Chronological order
  let chronological = true;
  for (let i = 1; i < chain.length; i++) {
    if (chain[i].timestamp < chain[i - 1].timestamp) {
      chronological = false;
      break;
    }
  }

  return {
    valid: genesisValid && hashChainIntact && chronological,
    blocksVerified: chain.length,
    brokenAt,
    checks: {
      genesisValid,
      hashChainIntact,
      noGaps,
      chronological,
    },
    verifiedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Certificate Generation
// ---------------------------------------------------------------------------

/**
 * Generate a provenance certificate for a dataset export.
 * This certificate can be included in HuggingFace dataset metadata.
 */
export function generateCertificate(
  datasetFingerprint: string,
  roundsCovered: number,
  agentCount: number,
  timeRange: { from: string; to: string },
): ProvenanceCertificate {
  const latestBlock = chain[chain.length - 1];
  const genesisBlock = chain[0];

  const certData = {
    version: "1.0.0",
    chainLength: chain.length,
    latestBlockHash: latestBlock?.hash ?? "none",
    genesisHash: genesisBlock?.hash ?? "none",
    datasetFingerprint,
    roundsCovered,
    agentCount,
    timeRange,
    methodologyVersion,
    generatedAt: new Date().toISOString(),
  };

  const certificateHash = sha256(JSON.stringify(certData));

  return {
    ...certData,
    certificateHash,
  };
}

// ---------------------------------------------------------------------------
// Query Functions
// ---------------------------------------------------------------------------

/**
 * Get the current chain length.
 */
export function getChainLength(): number {
  return chain.length;
}

/**
 * Get the latest N blocks from the chain.
 */
export function getRecentBlocks(limit = 20): ProvenanceBlock[] {
  return chain.slice(-limit).reverse();
}

/**
 * Get blocks filtered by event type.
 */
export function getBlocksByType(
  eventType: ProvenanceEventType,
  limit = 50,
): ProvenanceBlock[] {
  return chain
    .filter((b) => b.eventType === eventType)
    .slice(-limit)
    .reverse();
}

/**
 * Get the full chain summary.
 */
export function getChainSummary(): {
  chainLength: number;
  genesisTimestamp: string | null;
  latestTimestamp: string | null;
  latestHash: string | null;
  methodologyVersion: string;
  eventCounts: Record<string, number>;
} {
  const eventCounts: Record<string, number> = {};
  for (const block of chain) {
    eventCounts[block.eventType] = (eventCounts[block.eventType] ?? 0) + 1;
  }

  return {
    chainLength: chain.length,
    genesisTimestamp: chain[0]?.timestamp ?? null,
    latestTimestamp: chain[chain.length - 1]?.timestamp ?? null,
    latestHash: chain[chain.length - 1]?.hash ?? null,
    methodologyVersion,
    eventCounts,
  };
}

/**
 * Get current methodology version.
 */
export function getMethodologyVersion(): string {
  return methodologyVersion;
}

// Initialize on import
initializeChain();
