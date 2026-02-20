/**
 * Benchmark Integrity Prover
 *
 * Cryptographic proof system ensuring MoltApp benchmark data hasn't been
 * tampered with. Uses SHA-256 Merkle trees to create verifiable proofs
 * of every trade justification.
 *
 * This is critical for benchmark credibility — anyone can verify that
 * the published dataset matches what was actually produced during trading.
 *
 * Features:
 * - Merkle tree construction from trade justifications
 * - Individual trade inclusion proofs
 * - Round-level integrity hashes
 * - Dataset fingerprinting for HuggingFace
 * - Temporal chain linking (each proof references previous)
 * - Verification API for external auditors
 */

import { createHash } from "crypto";
import { HASH_DISPLAY_LENGTH } from "../config/constants.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MerkleProof {
  /** The leaf hash being proved */
  leafHash: string;
  /** Sibling hashes needed to reconstruct root */
  siblings: { hash: string; position: "left" | "right" }[];
  /** The Merkle root this proof verifies against */
  root: string;
  /** Index of the leaf in the tree */
  leafIndex: number;
  /** Total number of leaves */
  totalLeaves: number;
}

export interface IntegrityRecord {
  /** Record being proved */
  recordId: string;
  /** SHA-256 hash of the record content */
  contentHash: string;
  /** When the hash was computed */
  timestamp: string;
  /** Agent that produced this record */
  agentId: string;
}

export interface RoundIntegrityProof {
  /** Round identifier */
  roundId: string;
  /** Merkle root of all justifications in this round */
  merkleRoot: string;
  /** Number of justifications in this round */
  leafCount: number;
  /** Individual record hashes */
  records: IntegrityRecord[];
  /** Timestamp of proof generation */
  proofTimestamp: string;
  /** Hash of previous round's proof (chain linking) */
  previousProofHash: string | null;
}

export interface DatasetFingerprint {
  /** SHA-256 of the complete JSONL dataset */
  datasetHash: string;
  /** Merkle root of all records */
  merkleRoot: string;
  /** Total number of records */
  totalRecords: number;
  /** When the fingerprint was generated */
  generatedAt: string;
  /** Benchmark version */
  version: string;
  /** Agent IDs included */
  agents: string[];
  /** Time range covered */
  timeRange: { from: string; to: string };
}

// ---------------------------------------------------------------------------
// In-Memory State
// ---------------------------------------------------------------------------

const roundProofs: Map<string, RoundIntegrityProof> = new Map();
let lastProofHash: string | null = null;
const MAX_PROOFS = 500;

// ---------------------------------------------------------------------------
// Hash Functions
// ---------------------------------------------------------------------------

/**
 * SHA-256 hash of a string.
 */
function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Hash two values together for Merkle tree construction.
 */
function hashPair(left: string, right: string): string {
  // Sort to ensure consistent ordering
  const combined = left < right ? left + right : right + left;
  return sha256(combined);
}

/**
 * Hash a trade justification record for inclusion in the Merkle tree.
 */
export function hashJustification(record: {
  agentId: string;
  action: string;
  symbol: string;
  reasoning: string;
  confidence: number;
  timestamp: string;
}): string {
  const canonical = JSON.stringify({
    a: record.agentId,
    action: record.action,
    s: record.symbol,
    r: record.reasoning,
    c: record.confidence,
    t: record.timestamp,
  });
  return sha256(canonical);
}

// ---------------------------------------------------------------------------
// Merkle Tree
// ---------------------------------------------------------------------------

/**
 * Build a Merkle tree from an array of leaf hashes.
 * Returns the root hash and all intermediate nodes.
 */
export function buildMerkleTree(leafHashes: string[]): {
  root: string;
  levels: string[][];
} {
  if (leafHashes.length === 0) {
    return { root: sha256("empty"), levels: [] };
  }

  if (leafHashes.length === 1) {
    return { root: leafHashes[0], levels: [leafHashes] };
  }

  const levels: string[][] = [[...leafHashes]];

  // Pad to even number if needed
  let currentLevel = [...leafHashes];
  if (currentLevel.length % 2 !== 0) {
    currentLevel.push(currentLevel[currentLevel.length - 1]);
  }

  while (currentLevel.length > 1) {
    const nextLevel: string[] = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      nextLevel.push(hashPair(currentLevel[i], currentLevel[i + 1]));
    }
    levels.push(nextLevel);
    currentLevel = nextLevel;
    if (currentLevel.length > 1 && currentLevel.length % 2 !== 0) {
      currentLevel.push(currentLevel[currentLevel.length - 1]);
    }
  }

  return { root: currentLevel[0], levels };
}

/**
 * Generate a Merkle proof for a specific leaf.
 */
export function generateMerkleProof(
  leafHashes: string[],
  leafIndex: number,
): MerkleProof | null {
  if (leafIndex < 0 || leafIndex >= leafHashes.length) return null;

  const { root, levels } = buildMerkleTree(leafHashes);
  const siblings: { hash: string; position: "left" | "right" }[] = [];

  let idx = leafIndex;
  for (let level = 0; level < levels.length - 1; level++) {
    const currentLevel = levels[level];
    // Pad to even
    const padded = [...currentLevel];
    if (padded.length % 2 !== 0) {
      padded.push(padded[padded.length - 1]);
    }

    const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
    if (siblingIdx < padded.length) {
      siblings.push({
        hash: padded[siblingIdx],
        position: idx % 2 === 0 ? "right" : "left",
      });
    }

    idx = Math.floor(idx / 2);
  }

  return {
    leafHash: leafHashes[leafIndex],
    siblings,
    root,
    leafIndex,
    totalLeaves: leafHashes.length,
  };
}

/**
 * Verify a Merkle proof against a known root.
 */
export function verifyMerkleProof(proof: MerkleProof): boolean {
  let currentHash = proof.leafHash;

  for (const sibling of proof.siblings) {
    if (sibling.position === "right") {
      currentHash = hashPair(currentHash, sibling.hash);
    } else {
      currentHash = hashPair(sibling.hash, currentHash);
    }
  }

  return currentHash === proof.root;
}

// ---------------------------------------------------------------------------
// Round Integrity
// ---------------------------------------------------------------------------

/**
 * Create an integrity proof for a trading round.
 */
export function createRoundProof(
  roundId: string,
  justifications: {
    agentId: string;
    action: string;
    symbol: string;
    reasoning: string;
    confidence: number;
    timestamp: string;
  }[],
): RoundIntegrityProof {
  const records: IntegrityRecord[] = justifications.map((j) => ({
    recordId: `${roundId}_${j.agentId}`,
    contentHash: hashJustification(j),
    timestamp: j.timestamp,
    agentId: j.agentId,
  }));

  const leafHashes = records.map((r) => r.contentHash);
  const { root } = buildMerkleTree(leafHashes);

  const proof: RoundIntegrityProof = {
    roundId,
    merkleRoot: root,
    leafCount: records.length,
    records,
    proofTimestamp: new Date().toISOString(),
    previousProofHash: lastProofHash,
  };

  // Update chain
  lastProofHash = sha256(JSON.stringify({
    roundId: proof.roundId,
    merkleRoot: proof.merkleRoot,
    previous: proof.previousProofHash,
  }));

  // Store
  roundProofs.set(roundId, proof);
  if (roundProofs.size > MAX_PROOFS) {
    const oldest = roundProofs.keys().next().value;
    if (oldest) roundProofs.delete(oldest);
  }

  return proof;
}

/**
 * Get a round integrity proof.
 */
export function getRoundProof(roundId: string): RoundIntegrityProof | null {
  return roundProofs.get(roundId) ?? null;
}

/**
 * Get all round proofs (for audit trail).
 */
export function getAllRoundProofs(): RoundIntegrityProof[] {
  return Array.from(roundProofs.values());
}

/**
 * Verify a round proof's internal consistency.
 */
export function verifyRoundProof(proof: RoundIntegrityProof): {
  valid: boolean;
  checks: { name: string; passed: boolean; detail: string }[];
} {
  const checks: { name: string; passed: boolean; detail: string }[] = [];

  // Check 1: Merkle root matches records
  const leafHashes = proof.records.map((r) => r.contentHash);
  const { root } = buildMerkleTree(leafHashes);
  const rootValid = root === proof.merkleRoot;
  checks.push({
    name: "merkle_root",
    passed: rootValid,
    detail: rootValid ? "Merkle root matches records" : `Expected ${root}, got ${proof.merkleRoot}`,
  });

  // Check 2: Leaf count matches
  const countValid = proof.records.length === proof.leafCount;
  checks.push({
    name: "leaf_count",
    passed: countValid,
    detail: countValid ? `${proof.leafCount} records` : `Claimed ${proof.leafCount}, found ${proof.records.length}`,
  });

  // Check 3: Chain link (if previous exists)
  if (proof.previousProofHash !== null) {
    const prevProof = findPreviousProof(proof.roundId);
    if (prevProof) {
      const expectedPrevHash = sha256(JSON.stringify({
        roundId: prevProof.roundId,
        merkleRoot: prevProof.merkleRoot,
        previous: prevProof.previousProofHash,
      }));
      const chainValid = expectedPrevHash === proof.previousProofHash;
      checks.push({
        name: "chain_link",
        passed: chainValid,
        detail: chainValid ? "Chain link valid" : "Chain link broken",
      });
    } else {
      checks.push({
        name: "chain_link",
        passed: true,
        detail: "Previous proof not in memory (cannot verify chain)",
      });
    }
  } else {
    checks.push({
      name: "chain_link",
      passed: true,
      detail: "First proof in chain (no previous)",
    });
  }

  return {
    valid: checks.every((c) => c.passed),
    checks,
  };
}

function findPreviousProof(currentRoundId: string): RoundIntegrityProof | null {
  const proofs = Array.from(roundProofs.values());
  const currentIdx = proofs.findIndex((p) => p.roundId === currentRoundId);
  if (currentIdx <= 0) return null;
  return proofs[currentIdx - 1];
}

// ---------------------------------------------------------------------------
// Dataset Fingerprinting
// ---------------------------------------------------------------------------

/**
 * Generate a fingerprint for a complete dataset export.
 * Used to verify HuggingFace dataset integrity.
 */
export function fingerprintDataset(
  jsonlContent: string,
  records: { agentId: string; timestamp: string }[],
  version: string,
): DatasetFingerprint {
  const datasetHash = sha256(jsonlContent);
  const leafHashes = records.map((r) => sha256(`${r.agentId}:${r.timestamp}`));
  const { root } = buildMerkleTree(leafHashes);

  const agents = [...new Set(records.map((r) => r.agentId))];
  const timestamps = records.map((r) => r.timestamp).sort();

  return {
    datasetHash,
    merkleRoot: root,
    totalRecords: records.length,
    generatedAt: new Date().toISOString(),
    version,
    agents,
    timeRange: {
      from: timestamps[0] ?? "",
      to: timestamps[timestamps.length - 1] ?? "",
    },
  };
}

/**
 * Verify a dataset matches a known fingerprint.
 */
export function verifyDatasetFingerprint(
  jsonlContent: string,
  fingerprint: DatasetFingerprint,
): { valid: boolean; reason: string } {
  const computedHash = sha256(jsonlContent);
  if (computedHash !== fingerprint.datasetHash) {
    return {
      valid: false,
      reason: `Dataset hash mismatch: computed ${computedHash.slice(0, HASH_DISPLAY_LENGTH)}..., expected ${fingerprint.datasetHash.slice(0, HASH_DISPLAY_LENGTH)}...`,
    };
  }
  return { valid: true, reason: "Dataset hash matches fingerprint" };
}
