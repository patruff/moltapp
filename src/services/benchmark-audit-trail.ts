/**
 * Benchmark Audit Trail
 *
 * Immutable, append-only log of every significant benchmark event.
 * This provides complete transparency into how MoltApp's benchmark
 * operates — every score change, methodology update, and data export
 * is recorded with timestamps and context.
 *
 * Categories:
 * - SCORING: When agents receive scores, grade changes
 * - DATA: Dataset exports, imports, synchronization
 * - GOVERNANCE: Methodology changes, weight updates
 * - INTEGRITY: Chain verification results, proof generation
 * - AGENT: Agent registration, deactivation, config changes
 * - QUALITY: Quality gate activations, threshold changes
 * - REVIEW: Peer reviews, manual audits
 *
 * The audit trail is queryable by category, agent, and time range.
 * It's included in dataset exports for full reproducibility.
 */

import { ID_RANDOM_START, ID_RANDOM_LENGTH_SHORT, ID_RANDOM_LENGTH_STANDARD, ID_RANDOM_LENGTH_LONG } from "../config/constants.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuditCategory =
  | "scoring"
  | "data"
  | "governance"
  | "integrity"
  | "agent"
  | "quality"
  | "review"
  | "system";

export type AuditSeverity = "info" | "warning" | "critical";

export interface AuditEntry {
  /** Unique entry ID */
  id: string;
  /** Sequential index */
  index: number;
  /** Category of the event */
  category: AuditCategory;
  /** Severity level */
  severity: AuditSeverity;
  /** Human-readable description */
  description: string;
  /** Event-specific structured data */
  data: Record<string, unknown>;
  /** Agent involved (if applicable) */
  agentId: string | null;
  /** Round involved (if applicable) */
  roundId: string | null;
  /** Who/what initiated the event */
  initiator: string;
  /** ISO timestamp */
  timestamp: string;
  /** Tags for filtering */
  tags: string[];
}

export interface AuditQueryOptions {
  category?: AuditCategory;
  severity?: AuditSeverity;
  agentId?: string;
  roundId?: string;
  tag?: string;
  fromTimestamp?: string;
  toTimestamp?: string;
  limit?: number;
  offset?: number;
}

export interface AuditSummary {
  totalEntries: number;
  categoryCounts: Record<string, number>;
  severityCounts: Record<string, number>;
  recentCritical: AuditEntry[];
  oldestEntry: string | null;
  newestEntry: string | null;
  agentsAudited: string[];
}

// ---------------------------------------------------------------------------
// Audit Trail Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Maximum entries retained in the in-memory audit log.
 * When exceeded, oldest entries are trimmed to this limit.
 * 5 000 entries covers roughly a week of continuous trading at
 * several rounds per hour before trimming begins.
 */
const MAX_AUDIT_ENTRIES = 5000;

/**
 * Default page size for queryAudit() when the caller omits `limit`.
 * Balances API response size with useful context — 50 entries spans
 * roughly one trading day of events per agent.
 */
const DEFAULT_QUERY_LIMIT = 50;

/**
 * Number of recent "critical" entries shown in getAuditSummary().
 * Keeps the summary payload small while surfacing the most actionable alerts.
 * Example: 5 critical entries = last ~5 hallucination or chain-integrity events.
 */
const RECENT_CRITICAL_DISPLAY_LIMIT = 5;

/**
 * Minimum hallucination flag count that escalates severity from "warning" to "critical".
 * A single or pair of flags is a warning; 3+ flags indicates a systematic problem.
 * Formula: flags.length > HALLUCINATION_CRITICAL_FLAG_THRESHOLD → severity = "critical"
 * Example: 2 flags = warning, 3 flags = critical.
 */
const HALLUCINATION_CRITICAL_FLAG_THRESHOLD = 2;

/**
 * Decimal places used when formatting composite/quality scores in audit log messages.
 * 3 decimal places (e.g. 0.847) gives enough precision to distinguish close scores
 * without creating noise in human-readable descriptions.
 * Formula: score.toFixed(SCORE_DISPLAY_DECIMALS) → "0.847"
 */
const SCORE_DISPLAY_DECIMALS = 3;

/**
 * Multiplier for converting a decimal rate (0–1) to a percentage integer (0–100).
 * Used when formatting disagreement rates and pass rates in audit descriptions.
 * Formula: Math.round(rate × PERCENT_MULTIPLIER) → integer percent
 * Example: 0.333 × 100 = 33.3 → toFixed(0) → "33%"
 */
const PERCENT_MULTIPLIER = 100;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const auditLog: AuditEntry[] = [];
let auditIndex = 0;

// ---------------------------------------------------------------------------
// Core Operations
// ---------------------------------------------------------------------------

function generateId(): string {
  return `audit_${Date.now()}_${Math.random().toString(36).slice(ID_RANDOM_START, ID_RANDOM_START + ID_RANDOM_LENGTH_STANDARD)}`;
}

/**
 * Append an entry to the audit trail.
 */
export function recordAudit(
  category: AuditCategory,
  description: string,
  data: Record<string, unknown> = {},
  options: {
    severity?: AuditSeverity;
    agentId?: string | null;
    roundId?: string | null;
    initiator?: string;
    tags?: string[];
  } = {},
): AuditEntry {
  const entry: AuditEntry = {
    id: generateId(),
    index: auditIndex++,
    category,
    severity: options.severity ?? "info",
    description,
    data,
    agentId: options.agentId ?? null,
    roundId: options.roundId ?? null,
    initiator: options.initiator ?? "system",
    timestamp: new Date().toISOString(),
    tags: options.tags ?? [],
  };

  auditLog.push(entry);

  // Trim if needed
  if (auditLog.length > MAX_AUDIT_ENTRIES) {
    auditLog.splice(0, auditLog.length - MAX_AUDIT_ENTRIES);
  }

  return entry;
}

// ---------------------------------------------------------------------------
// Specialized Recording Functions
// ---------------------------------------------------------------------------

/**
 * Record a scoring event.
 */
export function auditScoring(
  agentId: string,
  scores: Record<string, number>,
  grade: string,
  roundId?: string,
): AuditEntry {
  return recordAudit(
    "scoring",
    `Agent ${agentId} scored composite=${scores.composite?.toFixed(SCORE_DISPLAY_DECIMALS) ?? "N/A"}, grade=${grade}`,
    { scores, grade },
    { agentId, roundId, tags: ["composite-score", `grade-${grade}`] },
  );
}

/**
 * Record a dataset export.
 */
export function auditDataExport(
  format: string,
  recordCount: number,
  destination: string,
  fingerprint: string,
): AuditEntry {
  return recordAudit(
    "data",
    `Dataset exported: ${recordCount} records in ${format} to ${destination}`,
    { format, recordCount, destination, fingerprint },
    { tags: ["export", format] },
  );
}

/**
 * Record a methodology change.
 */
export function auditMethodologyChange(
  oldVersion: string,
  newVersion: string,
  changes: string[],
  changedBy: string,
): AuditEntry {
  return recordAudit(
    "governance",
    `Methodology updated: v${oldVersion} → v${newVersion} (${changes.length} changes)`,
    { oldVersion, newVersion, changes },
    { severity: "warning", initiator: changedBy, tags: ["methodology-change"] },
  );
}

/**
 * Record a quality gate activation.
 */
export function auditQualityGate(
  agentId: string,
  passed: boolean,
  score: number,
  threshold: number,
  rejectionReasons?: string[],
): AuditEntry {
  return recordAudit(
    "quality",
    `Quality gate ${passed ? "PASSED" : "REJECTED"} for ${agentId}: score=${score.toFixed(SCORE_DISPLAY_DECIMALS)}, threshold=${threshold}`,
    { passed, score, threshold, rejectionReasons },
    {
      agentId,
      severity: passed ? "info" : "warning",
      tags: [passed ? "gate-pass" : "gate-reject"],
    },
  );
}

/**
 * Record an integrity verification.
 */
export function auditIntegrityCheck(
  roundId: string,
  valid: boolean,
  details: Record<string, boolean>,
): AuditEntry {
  return recordAudit(
    "integrity",
    `Integrity check for round ${roundId}: ${valid ? "VALID" : "FAILED"}`,
    { valid, details },
    {
      roundId,
      severity: valid ? "info" : "critical",
      tags: ["integrity-check"],
    },
  );
}

/**
 * Record a peer review.
 */
export function auditPeerReview(
  roundId: string,
  reviewCount: number,
  bestAgent: string | null,
  disagreementRate: number,
): AuditEntry {
  return recordAudit(
    "review",
    `Peer review: ${reviewCount} reviews, ${(disagreementRate * PERCENT_MULTIPLIER).toFixed(0)}% disagreement, best=${bestAgent ?? "none"}`,
    { reviewCount, bestAgent, disagreementRate },
    { roundId, tags: ["peer-review"] },
  );
}

/**
 * Record a hallucination detection event.
 */
export function auditHallucination(
  agentId: string,
  symbol: string,
  flags: string[],
  roundId?: string,
): AuditEntry {
  return recordAudit(
    "quality",
    `Hallucination detected: ${agentId} on ${symbol} — ${flags.length} flags`,
    { symbol, flags, flagCount: flags.length },
    {
      agentId,
      roundId,
      severity: flags.length > HALLUCINATION_CRITICAL_FLAG_THRESHOLD ? "critical" : "warning",
      tags: ["hallucination"],
    },
  );
}

/**
 * Record an external agent submission.
 */
export function auditExternalSubmission(
  submissionId: string,
  agentId: string,
  score: number,
): AuditEntry {
  return recordAudit(
    "agent",
    `External submission ${submissionId} by ${agentId}: score=${score.toFixed(SCORE_DISPLAY_DECIMALS)}`,
    { submissionId, score },
    { agentId, tags: ["external-submission"] },
  );
}

// ---------------------------------------------------------------------------
// Query Functions
// ---------------------------------------------------------------------------

/**
 * Query the audit trail with filters.
 */
export function queryAudit(options: AuditQueryOptions = {}): {
  entries: AuditEntry[];
  total: number;
} {
  let filtered = auditLog;

  if (options.category) {
    filtered = filtered.filter((e) => e.category === options.category);
  }
  if (options.severity) {
    filtered = filtered.filter((e) => e.severity === options.severity);
  }
  if (options.agentId) {
    filtered = filtered.filter((e) => e.agentId === options.agentId);
  }
  if (options.roundId) {
    filtered = filtered.filter((e) => e.roundId === options.roundId);
  }
  if (options.tag) {
    filtered = filtered.filter((e) => e.tags.includes(options.tag!));
  }
  if (options.fromTimestamp) {
    filtered = filtered.filter((e) => e.timestamp >= options.fromTimestamp!);
  }
  if (options.toTimestamp) {
    filtered = filtered.filter((e) => e.timestamp <= options.toTimestamp!);
  }

  const total = filtered.length;
  const offset = options.offset ?? 0;
  const limit = options.limit ?? DEFAULT_QUERY_LIMIT;

  // Return newest first
  const entries = filtered.slice().reverse().slice(offset, offset + limit);

  return { entries, total };
}

/**
 * Get a summary of the audit trail.
 */
export function getAuditSummary(): AuditSummary {
  const categoryCounts: Record<string, number> = {};
  const severityCounts: Record<string, number> = {};
  const agentSet = new Set<string>();

  for (const entry of auditLog) {
    categoryCounts[entry.category] =
      (categoryCounts[entry.category] ?? 0) + 1;
    severityCounts[entry.severity] =
      (severityCounts[entry.severity] ?? 0) + 1;
    if (entry.agentId) agentSet.add(entry.agentId);
  }

  const recentCritical = auditLog
    .filter((e) => e.severity === "critical")
    .slice(-RECENT_CRITICAL_DISPLAY_LIMIT)
    .reverse();

  return {
    totalEntries: auditLog.length,
    categoryCounts,
    severityCounts,
    recentCritical,
    oldestEntry: auditLog[0]?.timestamp ?? null,
    newestEntry: auditLog[auditLog.length - 1]?.timestamp ?? null,
    agentsAudited: Array.from(agentSet),
  };
}

/**
 * Export audit trail for inclusion in dataset.
 */
export function exportAuditTrail(limit?: number): AuditEntry[] {
  if (limit) {
    return auditLog.slice(-limit);
  }
  return [...auditLog];
}
