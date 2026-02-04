/**
 * Benchmark Integrity Verifier
 *
 * Creates cryptographic proof chains for trade justifications to ensure
 * benchmark data has not been tampered with. Makes MoltApp's benchmark
 * trustworthy for academic research and third-party audits.
 *
 * Separate from trade-proof.ts (which proves on-chain execution). This
 * service proves the *reasoning data* shipped to HuggingFace was not
 * altered after the fact.
 */

import { createHash } from "crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JustificationData {
  id: string;
  agentId: string;
  action: string;
  symbol: string;
  reasoning: string;
  confidence: number;
  timestamp: string;
}

/** Input format — id is auto-assigned if omitted */
export type JustificationInput = Omit<JustificationData, "id"> & { id?: string };

export interface IntegrityProof {
  roundId: string;
  merkleRoot: string;
  justificationHashes: { id: string; hash: string }[];
  agentIds: string[];
  timestamp: string;
  proofVersion: string;
}

export interface VerificationResult {
  valid: boolean;
  merkleRootMatch: boolean;
  individualHashesValid: boolean;
  details: { step: string; passed: boolean }[];
  verifiedAt: string;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const PROOF_VERSION = "1.0.0";
const MAX_AUDIT_TRAIL = 500;

/** Ordered audit trail of integrity proofs */
const auditTrail: IntegrityProof[] = [];

/** Intermediate Merkle nodes cached by root hash */
const merkleNodeCache = new Map<string, string[][]>();

// ---------------------------------------------------------------------------
// Core Functions
// ---------------------------------------------------------------------------

/**
 * SHA-256 hash of justification data using deterministic JSON (sorted keys).
 * Same justification always produces the same hash regardless of property order.
 */
export function hashJustification(justification: JustificationData): string {
  const canonical = JSON.stringify(justification, Object.keys(justification).sort());
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Build a Merkle tree from justification hashes and return the root.
 * Stores intermediate levels in cache for future inclusion-proof generation.
 * Odd leaf counts are padded by duplicating the last leaf.
 */
export function buildMerkleRoot(hashes: string[]): string {
  if (hashes.length === 0) return createHash("sha256").update("empty").digest("hex");
  if (hashes.length === 1) return hashes[0];

  const levels: string[][] = [];
  let level = [...hashes];
  if (level.length % 2 !== 0) level.push(level[level.length - 1]);
  levels.push(level);

  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(createHash("sha256").update(level[i] + level[i + 1]).digest("hex"));
    }
    if (next.length > 1 && next.length % 2 !== 0) next.push(next[next.length - 1]);
    levels.push(next);
    level = next;
  }

  merkleNodeCache.set(level[0], levels);
  return level[0];
}

/**
 * Retrieve the integrity proof for a previously-recorded trading round.
 * Returns null if the round has not been recorded.
 */
export function generateIntegrityProof(roundId: string): IntegrityProof | null {
  return auditTrail.find((p) => p.roundId === roundId) ?? null;
}

/**
 * Independently verify an integrity proof by recomputing all hashes.
 *
 * Steps: structural validation, hash format check, Merkle root
 * recomputation, agent ID presence, and version format.
 */
export function verifyIntegrityProof(proof: IntegrityProof): VerificationResult {
  const details: { step: string; passed: boolean }[] = [];

  // Step 1: Structural validation
  const structureOk =
    typeof proof.roundId === "string" &&
    typeof proof.merkleRoot === "string" &&
    Array.isArray(proof.justificationHashes) &&
    Array.isArray(proof.agentIds) &&
    typeof proof.timestamp === "string" &&
    typeof proof.proofVersion === "string";
  details.push({ step: "Structural validation", passed: structureOk });

  if (!structureOk) {
    return { valid: false, merkleRootMatch: false, individualHashesValid: false, details, verifiedAt: new Date().toISOString() };
  }

  // Step 2: Hash format (64-char lowercase hex)
  const hex64 = /^[a-f0-9]{64}$/;
  const hashesValid = proof.justificationHashes.every(
    (jh) => hex64.test(jh.hash) && typeof jh.id === "string" && jh.id.length > 0,
  );
  details.push({ step: "Individual hash format validation", passed: hashesValid });

  // Step 3: Recompute Merkle root
  const recomputed = buildMerkleRoot(proof.justificationHashes.map((jh) => jh.hash));
  const rootMatch = recomputed === proof.merkleRoot;
  details.push({ step: "Merkle root recomputation", passed: rootMatch });

  // Step 4: Agent IDs present
  const agentsOk = proof.agentIds.length > 0;
  details.push({ step: "Agent ID presence check", passed: agentsOk });

  // Step 5: Version format
  const versionOk = /^\d+\.\d+\.\d+$/.test(proof.proofVersion);
  details.push({ step: "Proof version format", passed: versionOk });

  const valid = structureOk && hashesValid && rootMatch && agentsOk && versionOk;
  return { valid, merkleRootMatch: rootMatch, individualHashesValid: hashesValid, details, verifiedAt: new Date().toISOString() };
}

/**
 * Record a round's justifications and store the integrity proof.
 * Called by the orchestrator after each round. Auto-assigns IDs to
 * justifications that lack them.
 */
export function recordRoundForIntegrity(roundId: string, justifications: JustificationInput[]): void {
  let counter = 0;
  const full: JustificationData[] = justifications.map((j) => ({
    id: j.id ?? `${roundId}-j${++counter}`,
    agentId: j.agentId,
    action: j.action,
    symbol: j.symbol,
    reasoning: j.reasoning,
    confidence: j.confidence,
    timestamp: j.timestamp,
  }));

  const jhPairs = full.map((j) => ({ id: j.id, hash: hashJustification(j) }));
  const merkleRoot = buildMerkleRoot(jhPairs.map((jh) => jh.hash));
  const agentIds = [...new Set(full.map((j) => j.agentId))];

  const proof: IntegrityProof = {
    roundId,
    merkleRoot,
    justificationHashes: jhPairs,
    agentIds,
    timestamp: new Date().toISOString(),
    proofVersion: PROOF_VERSION,
  };

  auditTrail.push(proof);
  while (auditTrail.length > MAX_AUDIT_TRAIL) auditTrail.shift();
}

/**
 * Retrieve recent integrity proofs from the audit trail.
 * Returns chronological order (oldest first). Defaults to all.
 */
export function getAuditTrail(limit?: number): IntegrityProof[] {
  if (limit === undefined || limit >= auditTrail.length) return [...auditTrail];
  return auditTrail.slice(-limit);
}
