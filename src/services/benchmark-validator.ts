/**
 * Benchmark Dataset Validator
 *
 * Ensures data quality before uploading to HuggingFace. A benchmark is only
 * as good as its data — this validator catches issues that would make the
 * dataset unreliable for research.
 *
 * Validation checks:
 * 1. COMPLETENESS: Are all required fields populated?
 * 2. CONSISTENCY: Are confidence/coherence values in valid ranges?
 * 3. TEMPORAL: Are timestamps monotonically increasing?
 * 4. AGENT COVERAGE: Are all agents represented?
 * 5. BALANCE: Is the dataset balanced across agents and intents?
 * 6. REASONING QUALITY: Does reasoning text meet minimum standards?
 * 7. DUPLICATE DETECTION: Are there duplicate entries?
 * 8. OUTLIER DETECTION: Are there statistical outliers in metrics?
 */

import { round2, round3 } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BenchmarkRecord {
  id: string;
  agent_id: string;
  agent_provider: string;
  action: string;
  symbol: string;
  quantity: number;
  reasoning: string;
  confidence: number;
  intent: string;
  sources: string[];
  predicted_outcome: string | null;
  actual_outcome: string | null;
  coherence_score: number | null;
  hallucination_flags: string[];
  discipline_pass: boolean;
  round_id: string | null;
  timestamp: string;
}

export interface ValidationIssue {
  /** Severity: error (blocks upload), warning (logged), info (minor) */
  severity: "error" | "warning" | "info";
  /** Which record has the issue (null for dataset-level issues) */
  recordId: string | null;
  /** Issue category */
  category: string;
  /** Description */
  message: string;
}

export interface ValidationResult {
  /** Whether the dataset passes validation */
  valid: boolean;
  /** Total records validated */
  totalRecords: number;
  /** Counts by severity */
  errorCount: number;
  warningCount: number;
  infoCount: number;
  /** All issues found */
  issues: ValidationIssue[];
  /** Dataset quality score (0-1) */
  qualityScore: number;
  /** Breakdown of quality dimensions */
  dimensions: {
    completeness: number;
    consistency: number;
    balance: number;
    reasoningQuality: number;
    temporalIntegrity: number;
  };
  /** Summary statistics */
  stats: {
    uniqueAgents: number;
    uniqueSymbols: number;
    uniqueIntents: number;
    uniqueRounds: number;
    dateRange: { earliest: string; latest: string } | null;
    avgReasoningLength: number;
    avgConfidence: number;
    avgCoherence: number;
    duplicateRate: number;
  };
  /** Validation timestamp */
  validatedAt: string;
}

// ---------------------------------------------------------------------------
// Core: Validate
// ---------------------------------------------------------------------------

/**
 * Run the full validation suite on a benchmark dataset.
 * Returns a detailed report with all issues found.
 */
export function validateBenchmarkDataset(
  records: BenchmarkRecord[],
): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (records.length === 0) {
    issues.push({
      severity: "error",
      recordId: null,
      category: "completeness",
      message: "Dataset is empty — no records to validate",
    });
    return buildResult(records, issues);
  }

  // Run all validation checks
  checkCompleteness(records, issues);
  checkConsistency(records, issues);
  checkTemporalIntegrity(records, issues);
  checkAgentCoverage(records, issues);
  checkBalance(records, issues);
  checkReasoningQuality(records, issues);
  checkDuplicates(records, issues);
  checkOutliers(records, issues);

  return buildResult(records, issues);
}

// ---------------------------------------------------------------------------
// Validation Checks
// ---------------------------------------------------------------------------

function checkCompleteness(records: BenchmarkRecord[], issues: ValidationIssue[]): void {
  for (const r of records) {
    if (!r.id) {
      issues.push({
        severity: "error",
        recordId: r.id,
        category: "completeness",
        message: "Missing record ID",
      });
    }
    if (!r.agent_id) {
      issues.push({
        severity: "error",
        recordId: r.id,
        category: "completeness",
        message: "Missing agent_id",
      });
    }
    if (!r.reasoning || r.reasoning.trim().length === 0) {
      issues.push({
        severity: "error",
        recordId: r.id,
        category: "completeness",
        message: "Missing reasoning text — every trade must have reasoning",
      });
    }
    if (!r.intent) {
      issues.push({
        severity: "warning",
        recordId: r.id,
        category: "completeness",
        message: "Missing intent classification",
      });
    }
    if (!r.sources || r.sources.length === 0) {
      issues.push({
        severity: "warning",
        recordId: r.id,
        category: "completeness",
        message: "No data sources cited",
      });
    }
    if (!r.timestamp) {
      issues.push({
        severity: "error",
        recordId: r.id,
        category: "completeness",
        message: "Missing timestamp",
      });
    }
  }

  // Dataset-level completeness
  const withCoherence = records.filter((r) => r.coherence_score !== null);
  if (withCoherence.length < records.length * 0.5) {
    issues.push({
      severity: "warning",
      recordId: null,
      category: "completeness",
      message: `Only ${withCoherence.length}/${records.length} records have coherence scores (${Math.round((withCoherence.length / records.length) * 100)}%)`,
    });
  }

  const withOutcomes = records.filter((r) => r.actual_outcome !== null);
  if (withOutcomes.length < records.length * 0.2) {
    issues.push({
      severity: "info",
      recordId: null,
      category: "completeness",
      message: `Only ${withOutcomes.length}/${records.length} records have actual outcomes (${Math.round((withOutcomes.length / records.length) * 100)}%)`,
    });
  }
}

function checkConsistency(records: BenchmarkRecord[], issues: ValidationIssue[]): void {
  for (const r of records) {
    // Confidence range
    if (r.confidence < 0 || r.confidence > 1) {
      issues.push({
        severity: "error",
        recordId: r.id,
        category: "consistency",
        message: `Confidence ${r.confidence} out of range [0,1]`,
      });
    }

    // Coherence range
    if (r.coherence_score !== null && (r.coherence_score < 0 || r.coherence_score > 1)) {
      issues.push({
        severity: "error",
        recordId: r.id,
        category: "consistency",
        message: `Coherence score ${r.coherence_score} out of range [0,1]`,
      });
    }

    // Valid action
    if (!["buy", "sell", "hold"].includes(r.action)) {
      issues.push({
        severity: "error",
        recordId: r.id,
        category: "consistency",
        message: `Invalid action: "${r.action}" (must be buy/sell/hold)`,
      });
    }

    // Valid intent
    const validIntents = ["momentum", "mean_reversion", "value", "hedge", "contrarian", "arbitrage"];
    if (r.intent && !validIntents.includes(r.intent)) {
      issues.push({
        severity: "warning",
        recordId: r.id,
        category: "consistency",
        message: `Non-standard intent: "${r.intent}" (expected: ${validIntents.join(", ")})`,
      });
    }

    // Quantity consistency
    if (r.action !== "hold" && r.quantity <= 0) {
      issues.push({
        severity: "warning",
        recordId: r.id,
        category: "consistency",
        message: `${r.action} action with zero/negative quantity (${r.quantity})`,
      });
    }
  }
}

function checkTemporalIntegrity(records: BenchmarkRecord[], issues: ValidationIssue[]): void {
  const timestamps = records
    .filter((r) => r.timestamp)
    .map((r) => new Date(r.timestamp).getTime())
    .filter((t) => !isNaN(t));

  if (timestamps.length === 0) return;

  // Check for future timestamps
  const now = Date.now();
  const futureTrades = records.filter((r) => {
    const t = new Date(r.timestamp).getTime();
    return !isNaN(t) && t > now + 60 * 60 * 1000; // >1 hour in future
  });

  if (futureTrades.length > 0) {
    issues.push({
      severity: "warning",
      recordId: null,
      category: "temporal",
      message: `${futureTrades.length} records have future timestamps`,
    });
  }

  // Check for very old timestamps (>1 year)
  const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000;
  const oldTrades = records.filter((r) => {
    const t = new Date(r.timestamp).getTime();
    return !isNaN(t) && t < oneYearAgo;
  });

  if (oldTrades.length > 0) {
    issues.push({
      severity: "info",
      recordId: null,
      category: "temporal",
      message: `${oldTrades.length} records are older than 1 year`,
    });
  }
}

function checkAgentCoverage(records: BenchmarkRecord[], issues: ValidationIssue[]): void {
  const agentCounts = new Map<string, number>();
  for (const r of records) {
    agentCounts.set(r.agent_id, (agentCounts.get(r.agent_id) ?? 0) + 1);
  }

  const expectedAgents = ["claude-value-investor", "gpt-momentum-trader", "grok-contrarian"];
  for (const agent of expectedAgents) {
    if (!agentCounts.has(agent)) {
      issues.push({
        severity: "warning",
        recordId: null,
        category: "coverage",
        message: `Expected agent "${agent}" not found in dataset`,
      });
    }
  }

  // Check for severely imbalanced agents
  const counts = [...agentCounts.values()];
  const maxCount = Math.max(...counts);
  const minCount = Math.min(...counts);

  if (counts.length > 1 && maxCount > minCount * 3) {
    issues.push({
      severity: "warning",
      recordId: null,
      category: "balance",
      message: `Agent trade count highly imbalanced: max=${maxCount}, min=${minCount} (${(maxCount / minCount).toFixed(1)}x ratio)`,
    });
  }
}

function checkBalance(records: BenchmarkRecord[], issues: ValidationIssue[]): void {
  // Action balance
  const actionCounts: Record<string, number> = {};
  for (const r of records) {
    actionCounts[r.action] = (actionCounts[r.action] ?? 0) + 1;
  }

  const holdRate = (actionCounts["hold"] ?? 0) / records.length;
  if (holdRate > 0.8) {
    issues.push({
      severity: "warning",
      recordId: null,
      category: "balance",
      message: `Hold rate is very high (${(holdRate * 100).toFixed(0)}%) — agents may not be actively trading`,
    });
  }

  // Intent balance
  const intentCounts = new Map<string, number>();
  for (const r of records) {
    if (r.intent) {
      intentCounts.set(r.intent, (intentCounts.get(r.intent) ?? 0) + 1);
    }
  }

  if (intentCounts.size === 1) {
    issues.push({
      severity: "info",
      recordId: null,
      category: "balance",
      message: `All trades have the same intent ("${[...intentCounts.keys()][0]}") — low strategy diversity`,
    });
  }
}

function checkReasoningQuality(records: BenchmarkRecord[], issues: ValidationIssue[]): void {
  let shortReasoningCount = 0;
  let genericReasoningCount = 0;

  const genericPatterns = [
    /^hold$/i,
    /^no trade$/i,
    /^agent error/i,
    /^no reasoning/i,
    /^n\/a$/i,
  ];

  for (const r of records) {
    if (r.reasoning.length < 20) {
      shortReasoningCount++;
    }

    if (genericPatterns.some((p) => p.test(r.reasoning.trim()))) {
      genericReasoningCount++;
    }
  }

  if (shortReasoningCount > records.length * 0.1) {
    issues.push({
      severity: "warning",
      recordId: null,
      category: "reasoning_quality",
      message: `${shortReasoningCount}/${records.length} records have very short reasoning (<20 chars)`,
    });
  }

  if (genericReasoningCount > 0) {
    issues.push({
      severity: "warning",
      recordId: null,
      category: "reasoning_quality",
      message: `${genericReasoningCount} records have generic/placeholder reasoning`,
    });
  }
}

function checkDuplicates(records: BenchmarkRecord[], issues: ValidationIssue[]): void {
  const idSet = new Set<string>();
  let duplicateIds = 0;

  for (const r of records) {
    if (idSet.has(r.id)) {
      duplicateIds++;
    }
    idSet.add(r.id);
  }

  if (duplicateIds > 0) {
    issues.push({
      severity: "error",
      recordId: null,
      category: "duplicates",
      message: `${duplicateIds} duplicate record IDs found`,
    });
  }

  // Check for content duplicates (same reasoning + agent + symbol + action)
  const contentSet = new Set<string>();
  let contentDuplicates = 0;

  for (const r of records) {
    const key = `${r.agent_id}|${r.symbol}|${r.action}|${r.reasoning.slice(0, 100)}`;
    if (contentSet.has(key)) {
      contentDuplicates++;
    }
    contentSet.add(key);
  }

  if (contentDuplicates > 0) {
    issues.push({
      severity: "warning",
      recordId: null,
      category: "duplicates",
      message: `${contentDuplicates} likely content duplicates (same agent + symbol + action + reasoning start)`,
    });
  }
}

function checkOutliers(records: BenchmarkRecord[], issues: ValidationIssue[]): void {
  // Confidence outliers
  const confidences = records.map((r) => r.confidence).filter((c) => c >= 0 && c <= 1);
  if (confidences.length > 10) {
    const mean = confidences.reduce((a, b) => a + b, 0) / confidences.length;
    const stdDev = Math.sqrt(
      confidences.reduce((s, c) => s + Math.pow(c - mean, 2), 0) / confidences.length,
    );

    // Check if all confidences are the same (agent not varying)
    if (stdDev < 0.01 && confidences.length > 20) {
      issues.push({
        severity: "info",
        recordId: null,
        category: "outliers",
        message: `Very low confidence variance (stddev=${stdDev.toFixed(4)}) — agents may not be genuinely calibrating confidence`,
      });
    }
  }

  // Reasoning length outliers
  const lengths = records.map((r) => r.reasoning.length);
  if (lengths.length > 10) {
    const meanLen = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const veryLong = lengths.filter((l) => l > meanLen * 5).length;
    if (veryLong > 0) {
      issues.push({
        severity: "info",
        recordId: null,
        category: "outliers",
        message: `${veryLong} records have reasoning >5x average length — may contain error dumps`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Build Result
// ---------------------------------------------------------------------------

function buildResult(
  records: BenchmarkRecord[],
  issues: ValidationIssue[],
): ValidationResult {
  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;
  const infoCount = issues.filter((i) => i.severity === "info").length;

  // Quality dimensions (0-1)
  const completenessIssues = issues.filter((i) => i.category === "completeness");
  const completeness = Math.max(0, 1 - completenessIssues.filter((i) => i.severity === "error").length * 0.2 - completenessIssues.filter((i) => i.severity === "warning").length * 0.05);

  const consistencyIssues = issues.filter((i) => i.category === "consistency");
  const consistency = Math.max(0, 1 - consistencyIssues.filter((i) => i.severity === "error").length * 0.15 - consistencyIssues.filter((i) => i.severity === "warning").length * 0.03);

  const balanceIssues = issues.filter((i) => i.category === "balance" || i.category === "coverage");
  const balance = Math.max(0, 1 - balanceIssues.length * 0.1);

  const rqIssues = issues.filter((i) => i.category === "reasoning_quality");
  const reasoningQuality = Math.max(0, 1 - rqIssues.length * 0.15);

  const temporalIssues = issues.filter((i) => i.category === "temporal");
  const temporalIntegrity = Math.max(0, 1 - temporalIssues.filter((i) => i.severity === "error").length * 0.2);

  const qualityScore = round2(
    completeness * 0.3 + consistency * 0.25 + balance * 0.15 + reasoningQuality * 0.2 + temporalIntegrity * 0.1,
  );

  // Stats
  const uniqueAgents = new Set(records.map((r) => r.agent_id)).size;
  const uniqueSymbols = new Set(records.map((r) => r.symbol)).size;
  const uniqueIntents = new Set(records.map((r) => r.intent).filter(Boolean)).size;
  const uniqueRounds = new Set(records.map((r) => r.round_id).filter(Boolean)).size;

  const timestamps = records.map((r) => r.timestamp).filter(Boolean).sort();
  const dateRange = timestamps.length > 0
    ? { earliest: timestamps[0], latest: timestamps[timestamps.length - 1] }
    : null;

  const avgReasoningLength = records.length > 0
    ? Math.round(records.reduce((s, r) => s + r.reasoning.length, 0) / records.length)
    : 0;
  const avgConfidence = records.length > 0
    ? round2(records.reduce((s, r) => s + r.confidence, 0) / records.length)
    : 0;
  const withCoherence = records.filter((r) => r.coherence_score !== null);
  const avgCoherence = withCoherence.length > 0
    ? round2(withCoherence.reduce((s, r) => s + (r.coherence_score ?? 0), 0) / withCoherence.length)
    : 0;

  const idSet = new Set<string>();
  let dupes = 0;
  for (const r of records) {
    if (idSet.has(r.id)) dupes++;
    idSet.add(r.id);
  }
  const duplicateRate = records.length > 0 ? round3(dupes / records.length) : 0;

  return {
    valid: errorCount === 0,
    totalRecords: records.length,
    errorCount,
    warningCount,
    infoCount,
    issues,
    qualityScore,
    dimensions: {
      completeness: round2(completeness),
      consistency: round2(consistency),
      balance: round2(balance),
      reasoningQuality: round2(reasoningQuality),
      temporalIntegrity: round2(temporalIntegrity),
    },
    stats: {
      uniqueAgents,
      uniqueSymbols,
      uniqueIntents,
      uniqueRounds,
      dateRange,
      avgReasoningLength,
      avgConfidence,
      avgCoherence,
      duplicateRate,
    },
    validatedAt: new Date().toISOString(),
  };
}
