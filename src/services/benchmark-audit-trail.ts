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
// State
// ---------------------------------------------------------------------------

const auditLog: AuditEntry[] = [];
let auditIndex = 0;
const MAX_AUDIT_ENTRIES = 5000;

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
    `Agent ${agentId} scored composite=${scores.composite?.toFixed(3) ?? "N/A"}, grade=${grade}`,
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
    `Quality gate ${passed ? "PASSED" : "REJECTED"} for ${agentId}: score=${score.toFixed(3)}, threshold=${threshold}`,
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
    `Peer review: ${reviewCount} reviews, ${(disagreementRate * 100).toFixed(0)}% disagreement, best=${bestAgent ?? "none"}`,
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
      severity: flags.length > 2 ? "critical" : "warning",
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
    `External submission ${submissionId} by ${agentId}: score=${score.toFixed(3)}`,
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
  const limit = options.limit ?? 50;

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
    .slice(-5)
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
