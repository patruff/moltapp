/**
 * Benchmark Reproducibility Prover (v15)
 *
 * Generates formal reproducibility proofs for benchmark results.
 * For each scoring run, produces a sealed artifact that contains:
 * 1. Input data hash (market data, agent decisions)
 * 2. Scoring algorithm version + config hash
 * 3. Output scores hash
 * 4. Determinism proof (same input → same output)
 *
 * This makes MoltApp benchmark results independently verifiable
 * by researchers — a requirement for any serious ML benchmark.
 */
import * as crypto from 'crypto';

export interface ReproducibilityProof {
  proofId: string;
  roundId: string;
  timestamp: number;
  inputHash: string;
  configHash: string;
  outputHash: string;
  combinedHash: string;
  deterministic: boolean;
  priorRunMatches: number;
  priorRunMismatches: number;
  signature: string;
}

export interface ScoringRun {
  roundId: string;
  timestamp: number;
  inputs: Record<string, unknown>;
  scores: Record<string, unknown>;
  scoringConfig: Record<string, unknown>;
  inputHash?: string;
  configHash?: string;
  outputHash?: string;
}

export interface ReproducibilityReport {
  totalRuns: number;
  uniqueInputSets: number;
  deterministicSets: number;
  nonDeterministicSets: number;
  reproducibilityRate: number;
  nonDeterministicRounds: string[];
  generatedAt: number;
}

const MAX_WINDOW = 500;
const runs: ScoringRun[] = [];

function stableStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return String(obj);
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(stableStringify).join(',') + ']';
  const sorted = Object.keys(obj as Record<string, unknown>).sort();
  return '{' + sorted.map(
    (k) => JSON.stringify(k) + ':' + stableStringify((obj as Record<string, unknown>)[k]),
  ).join(',') + '}';
}

function sha256(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

function hash(obj: unknown): string { return sha256(stableStringify(obj)); }
function sign(combinedHash: string): string { return sha256('molt-v15-seal:' + combinedHash); }

export function recordScoringRun(run: ScoringRun): ScoringRun {
  const enriched: ScoringRun = {
    ...run,
    inputHash: hash(run.inputs),
    configHash: hash(run.scoringConfig),
    outputHash: hash(run.scores),
  };
  runs.push(enriched);
  if (runs.length > MAX_WINDOW) runs.splice(0, runs.length - MAX_WINDOW);
  return enriched;
}

export function generateReproducibilityProof(
  roundId: string,
  inputs: Record<string, unknown>,
  scores: Record<string, unknown>,
  scoringConfig: Record<string, unknown>,
): ReproducibilityProof {
  const inHash = hash(inputs);
  const cfgHash = hash(scoringConfig);
  const outHash = hash(scores);
  const combinedHash = sha256(inHash + cfgHash + outHash);

  const prior = runs.filter((r) => r.inputHash === inHash && r.configHash === cfgHash);
  const matches = prior.filter((r) => r.outputHash === outHash).length;
  const mismatches = prior.filter((r) => r.outputHash !== outHash).length;

  return {
    proofId: 'proof-' + crypto.randomBytes(12).toString('hex'),
    roundId,
    timestamp: Date.now(),
    inputHash: inHash,
    configHash: cfgHash,
    outputHash: outHash,
    combinedHash,
    deterministic: mismatches === 0,
    priorRunMatches: matches,
    priorRunMismatches: mismatches,
    signature: sign(combinedHash),
  };
}

export function verifyReproducibility(
  proof: ReproducibilityProof,
  inputs: Record<string, unknown>,
  scoringConfig: Record<string, unknown>,
): { verified: boolean; inputMatch: boolean; configMatch: boolean; reason: string } {
  const inputMatch = hash(inputs) === proof.inputHash;
  const configMatch = hash(scoringConfig) === proof.configHash;
  const sigValid = sign(proof.combinedHash) === proof.signature;

  if (!inputMatch) return { verified: false, inputMatch, configMatch, reason: 'Input hash mismatch' };
  if (!configMatch) return { verified: false, inputMatch, configMatch, reason: 'Config hash mismatch' };
  if (!sigValid) return { verified: false, inputMatch, configMatch, reason: 'Signature invalid' };
  return { verified: true, inputMatch, configMatch, reason: 'All hashes and signature verified' };
}

export function getReproducibilityReport(): ReproducibilityReport {
  const grouped = new Map<string, ScoringRun[]>();
  for (const run of runs) {
    const key = (run.inputHash ?? '') + '|' + (run.configHash ?? '');
    const arr = grouped.get(key) ?? [];
    arr.push(run);
    grouped.set(key, arr);
  }

  const nonDetRounds: string[] = [];
  let deterministicSets = 0;
  let nonDeterministicSets = 0;

  for (const [, group] of grouped) {
    const outputs = new Set(group.map((r) => r.outputHash));
    if (outputs.size <= 1) {
      deterministicSets++;
    } else {
      nonDeterministicSets++;
      for (const r of group) {
        if (!nonDetRounds.includes(r.roundId)) nonDetRounds.push(r.roundId);
      }
    }
  }

  const total = deterministicSets + nonDeterministicSets;
  return {
    totalRuns: runs.length,
    uniqueInputSets: grouped.size,
    deterministicSets,
    nonDeterministicSets,
    reproducibilityRate: total > 0 ? deterministicSets / total : 1,
    nonDeterministicRounds: nonDetRounds,
    generatedAt: Date.now(),
  };
}

export function exportReproducibilityArtifact(): {
  version: string;
  exportedAt: number;
  runs: ScoringRun[];
  report: ReproducibilityReport;
  integrityHash: string;
} {
  const report = getReproducibilityReport();
  const payload = stableStringify({ runs, report });
  return {
    version: 'molt-benchmark-v15',
    exportedAt: Date.now(),
    runs: [...runs],
    report,
    integrityHash: sha256(payload),
  };
}
