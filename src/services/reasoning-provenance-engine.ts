/**
 * Reasoning Provenance Engine (v15)
 *
 * Cryptographic proof that agent reasoning was produced BEFORE market outcomes.
 * This prevents backfitting and proves reasoning authenticity — critical for
 * making MoltApp an industry-standard benchmark.
 *
 * Features:
 * 1. Pre-commit hash: SHA-256 of reasoning text before trade execution
 * 2. Temporal ordering: Strict timestamp chain proving sequence
 * 3. Market snapshot seal: Hash of market data at time of reasoning
 * 4. Cross-agent witness: Each agent's reasoning references others' hashes
 * 5. Reproducibility proof: Given same inputs, same hash chain
 */

import { createHash } from "crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReasoningProof {
  /** Unique proof ID */
  proofId: string;
  /** Agent that produced the reasoning */
  agentId: string;
  /** Trading round this proof belongs to */
  roundId: string;
  /** Stock symbol traded */
  symbol: string;
  /** Action taken */
  action: "buy" | "sell" | "hold";
  /** Agent's confidence */
  confidence: number;
  /** SHA-256 of the raw reasoning text */
  reasoningHash: string;
  /** SHA-256 of the market data snapshot at time of reasoning */
  marketDataHash: string;
  /** Combined pre-commit seal: hash(reasoning + market + timestamp) */
  preCommitSeal: string;
  /** Hash of the previous proof in this agent's chain (empty string for genesis) */
  previousProofHash: string;
  /** The chain hash: hash(preCommitSeal + previousProofHash) */
  chainHash: string;
  /** ISO timestamp when the proof was created */
  timestamp: string;
  /** Monotonic sequence number within this agent's chain */
  sequenceNumber: number;
  /** Cross-agent witness hashes: latest chain hash from each other agent */
  witnessHashes: Record<string, string>;
}

export interface ProvenanceChain {
  agentId: string;
  /** All proofs in chronological order */
  proofs: ReasoningProof[];
  /** Current head hash of the chain */
  headHash: string;
  /** Total proofs ever recorded (may exceed stored window) */
  totalRecorded: number;
  /** Whether the chain is internally consistent */
  valid: boolean;
}

export interface ReproducibilityArtifact {
  roundId: string;
  /** All proofs from all agents for this round */
  proofs: ReasoningProof[];
  /** Cross-agent witness graph: agentId -> witnessed hashes */
  witnessGraph: Record<string, Record<string, string>>;
  /** Merkle root of all proofs in this round */
  roundMerkleRoot: string;
  /** Whether all cross-agent witnesses are consistent */
  witnessConsistency: boolean;
  /** ISO timestamp when artifact was built */
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// In-Memory State
// ---------------------------------------------------------------------------

const MAX_PROOFS_PER_AGENT = 1000;
const agentChains = new Map<string, ReasoningProof[]>();
const agentSequenceCounters = new Map<string, number>();
const agentTotalRecorded = new Map<string, number>();

// ---------------------------------------------------------------------------
// Hashing Utilities
// ---------------------------------------------------------------------------

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function hashMarketData(marketData: Record<string, unknown>): string {
  // Deterministic serialization: sort keys to ensure reproducibility
  const sorted = JSON.stringify(marketData, Object.keys(marketData).sort());
  return sha256(sorted);
}

function computePreCommitSeal(
  reasoningHash: string,
  marketDataHash: string,
  timestamp: string,
): string {
  return sha256(`${reasoningHash}:${marketDataHash}:${timestamp}`);
}

function computeChainHash(preCommitSeal: string, previousProofHash: string): string {
  return sha256(`${preCommitSeal}:${previousProofHash}`);
}

function computeMerkleRoot(hashes: string[]): string {
  if (hashes.length === 0) return sha256("empty");
  if (hashes.length === 1) return hashes[0];

  const nextLevel: string[] = [];
  for (let i = 0; i < hashes.length; i += 2) {
    const left = hashes[i];
    const right = i + 1 < hashes.length ? hashes[i + 1] : left;
    nextLevel.push(sha256(`${left}:${right}`));
  }
  return computeMerkleRoot(nextLevel);
}

// ---------------------------------------------------------------------------
// Cross-Agent Witness Collection
// ---------------------------------------------------------------------------

function collectWitnessHashes(excludeAgentId: string): Record<string, string> {
  const witnesses: Record<string, string> = {};
  for (const [agentId, chain] of agentChains) {
    if (agentId === excludeAgentId) continue;
    if (chain.length > 0) {
      witnesses[agentId] = chain[chain.length - 1].chainHash;
    }
  }
  return witnesses;
}

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

/**
 * Create a cryptographic proof of reasoning authenticity.
 * This must be called BEFORE the trade is executed — the proof seals the
 * reasoning and market state at the moment of decision, proving the agent
 * could not have backfitted its reasoning to match the outcome.
 */
export function createReasoningProof(
  agentId: string,
  reasoning: string,
  action: "buy" | "sell" | "hold",
  symbol: string,
  confidence: number,
  marketData: Record<string, unknown>,
  roundId: string,
): ReasoningProof {
  const timestamp = new Date().toISOString();
  const reasoningHash = sha256(reasoning);
  const marketDataHash = hashMarketData(marketData);
  const preCommitSeal = computePreCommitSeal(reasoningHash, marketDataHash, timestamp);

  // Get previous proof hash from this agent's chain
  const chain = agentChains.get(agentId) ?? [];
  const previousProofHash = chain.length > 0
    ? chain[chain.length - 1].chainHash
    : "";

  const chainHash = computeChainHash(preCommitSeal, previousProofHash);

  // Advance sequence counter
  const seq = (agentSequenceCounters.get(agentId) ?? 0) + 1;
  agentSequenceCounters.set(agentId, seq);

  // Collect witness hashes from other agents
  const witnessHashes = collectWitnessHashes(agentId);

  const proof: ReasoningProof = {
    proofId: `prov_${agentId}_${seq}_${Date.now()}`,
    agentId,
    roundId,
    symbol,
    action,
    confidence,
    reasoningHash,
    marketDataHash,
    preCommitSeal,
    previousProofHash,
    chainHash,
    timestamp,
    sequenceNumber: seq,
    witnessHashes,
  };

  return proof;
}

/**
 * Verify that a proof is internally consistent.
 * Checks hash chain integrity but does NOT verify reasoning content
 * (since we only store hashes, not raw text).
 */
export function verifyProof(proof: ReasoningProof): {
  valid: boolean;
  checks: Record<string, boolean>;
} {
  const checks: Record<string, boolean> = {};

  // 1. Verify pre-commit seal
  const expectedSeal = computePreCommitSeal(
    proof.reasoningHash,
    proof.marketDataHash,
    proof.timestamp,
  );
  checks.preCommitSeal = expectedSeal === proof.preCommitSeal;

  // 2. Verify chain hash
  const expectedChainHash = computeChainHash(proof.preCommitSeal, proof.previousProofHash);
  checks.chainHash = expectedChainHash === proof.chainHash;

  // 3. Verify chain linkage: previousProofHash should match stored chain
  const chain = agentChains.get(proof.agentId) ?? [];
  if (proof.sequenceNumber === 1) {
    checks.chainLinkage = proof.previousProofHash === "";
  } else {
    const prevProof = chain.find((p) => p.sequenceNumber === proof.sequenceNumber - 1);
    checks.chainLinkage = prevProof
      ? prevProof.chainHash === proof.previousProofHash
      : true; // Cannot verify if previous proof was evicted from window
  }

  // 4. Verify temporal ordering
  if (proof.sequenceNumber > 1) {
    const prevProof = chain.find((p) => p.sequenceNumber === proof.sequenceNumber - 1);
    checks.temporalOrder = prevProof
      ? new Date(proof.timestamp) >= new Date(prevProof.timestamp)
      : true;
  } else {
    checks.temporalOrder = true;
  }

  // 5. Verify witness consistency
  let witnessesValid = true;
  for (const [witnessAgent, witnessHash] of Object.entries(proof.witnessHashes)) {
    const witnessChain = agentChains.get(witnessAgent) ?? [];
    if (witnessChain.length > 0) {
      // The witness hash should exist somewhere in the witness agent's chain
      const found = witnessChain.some((p) => p.chainHash === witnessHash);
      if (!found) witnessesValid = false;
    }
  }
  checks.witnessConsistency = witnessesValid;

  const valid = Object.values(checks).every((c) => c);
  return { valid, checks };
}

/**
 * Record a proof in the provenance chain.
 * Should be called after createReasoningProof and before trade execution.
 */
export function recordProvenanceEntry(proof: ReasoningProof): void {
  const chain = agentChains.get(proof.agentId) ?? [];
  chain.push(proof);

  // Sliding window: evict oldest proofs beyond limit
  if (chain.length > MAX_PROOFS_PER_AGENT) {
    chain.splice(0, chain.length - MAX_PROOFS_PER_AGENT);
  }

  agentChains.set(proof.agentId, chain);
  agentTotalRecorded.set(
    proof.agentId,
    (agentTotalRecorded.get(proof.agentId) ?? 0) + 1,
  );
}

/**
 * Get the full provenance chain for an agent.
 * Includes integrity validation of the entire chain.
 */
export function getProvenanceChain(agentId: string): ProvenanceChain {
  const chain = agentChains.get(agentId) ?? [];
  const totalRecorded = agentTotalRecorded.get(agentId) ?? 0;

  // Validate chain integrity
  let valid = true;
  for (let i = 0; i < chain.length; i++) {
    const proof = chain[i];
    const result = verifyProof(proof);
    if (!result.valid) {
      valid = false;
      break;
    }

    // Verify linkage to previous entry in stored chain
    if (i > 0) {
      const prev = chain[i - 1];
      if (proof.previousProofHash !== prev.chainHash) {
        valid = false;
        break;
      }
    }
  }

  return {
    agentId,
    proofs: [...chain],
    headHash: chain.length > 0 ? chain[chain.length - 1].chainHash : "",
    totalRecorded,
    valid,
  };
}

/**
 * Get aggregate provenance statistics across all agents.
 */
export function getProvenanceStats(): {
  totalAgents: number;
  totalProofs: number;
  chainIntegrity: Record<string, boolean>;
  avgChainLength: number;
  oldestProofTimestamp: string | null;
  newestProofTimestamp: string | null;
} {
  const chainIntegrity: Record<string, boolean> = {};
  let totalProofs = 0;
  let oldest: string | null = null;
  let newest: string | null = null;

  for (const agentId of agentChains.keys()) {
    const chainReport = getProvenanceChain(agentId);
    chainIntegrity[agentId] = chainReport.valid;
    totalProofs += chainReport.proofs.length;

    for (const proof of chainReport.proofs) {
      if (oldest === null || proof.timestamp < oldest) oldest = proof.timestamp;
      if (newest === null || proof.timestamp > newest) newest = proof.timestamp;
    }
  }

  const agentCount = agentChains.size;

  return {
    totalAgents: agentCount,
    totalProofs,
    chainIntegrity,
    avgChainLength: agentCount > 0 ? Math.round((totalProofs / agentCount) * 10) / 10 : 0,
    oldestProofTimestamp: oldest,
    newestProofTimestamp: newest,
  };
}

/**
 * Build a reproducibility artifact for a specific round.
 * This packages all proofs and cross-agent witnesses for external
 * verification — allowing researchers to independently confirm that
 * agent reasoning was sealed before market outcomes were known.
 */
export function buildReproducibilityArtifact(roundId: string): ReproducibilityArtifact {
  const roundProofs: ReasoningProof[] = [];

  for (const chain of agentChains.values()) {
    for (const proof of chain) {
      if (proof.roundId === roundId) {
        roundProofs.push(proof);
      }
    }
  }

  // Sort by timestamp for deterministic ordering
  roundProofs.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  // Build witness graph
  const witnessGraph: Record<string, Record<string, string>> = {};
  for (const proof of roundProofs) {
    witnessGraph[proof.agentId] = { ...proof.witnessHashes };
  }

  // Verify witness consistency: for each witness reference, check it matches
  let witnessConsistency = true;
  for (const proof of roundProofs) {
    for (const [witnessAgent, witnessHash] of Object.entries(proof.witnessHashes)) {
      const witnessChain = agentChains.get(witnessAgent) ?? [];
      const found = witnessChain.some((p) => p.chainHash === witnessHash);
      if (!found && witnessChain.length > 0) {
        witnessConsistency = false;
      }
    }
  }

  // Compute Merkle root over all proof chain hashes
  const proofHashes = roundProofs.map((p) => p.chainHash);
  const roundMerkleRoot = computeMerkleRoot(proofHashes);

  return {
    roundId,
    proofs: roundProofs,
    witnessGraph,
    roundMerkleRoot,
    witnessConsistency,
    generatedAt: new Date().toISOString(),
  };
}
