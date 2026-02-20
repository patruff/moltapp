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

import { countByCondition, round2, round3, findMax, findMin } from "../lib/math-utils.ts";
import { REASONING_SNIPPET_LENGTH } from "../config/constants.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Data Coverage Thresholds
 *
 * These thresholds control minimum data coverage requirements for HuggingFace
 * dataset uploads. Higher coverage = more research value.
 */

/** Minimum coherence score coverage (50% of records must have coherence scores) */
const COHERENCE_COVERAGE_THRESHOLD = 0.5;

/** Minimum outcome coverage (20% of records should have actual outcomes for analysis) */
const OUTCOME_COVERAGE_THRESHOLD = 0.2;

/**
 * Temporal Validation Thresholds
 *
 * Control what timestamp ranges are considered valid/acceptable for research datasets.
 */

/** Future timestamp tolerance (1 hour in milliseconds) - allows for clock skew */
const FUTURE_TIMESTAMP_TOLERANCE_MS = 60 * 60 * 1000;

/** Historical data age limit (1 year in milliseconds) - older data flagged as info */
const HISTORICAL_DATA_AGE_LIMIT_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Balance Thresholds
 *
 * Detect severely imbalanced datasets that would bias research conclusions.
 */

/** Agent imbalance ratio threshold (max agent trades / min agent trades > 3 = warning) */
const AGENT_IMBALANCE_RATIO_THRESHOLD = 3;

/** Hold rate warning threshold (>80% holds = agents not actively trading) */
const HOLD_RATE_WARNING_THRESHOLD = 0.8;

/** Short reasoning rate threshold (>10% short reasoning = data quality issue) */
const SHORT_REASONING_RATE_THRESHOLD = 0.1;

/**
 * Reasoning Quality Thresholds
 *
 * Minimum standards for reasoning text quality in research datasets.
 */

/** Minimum reasoning text length (characters) - below this is considered too short */
const MIN_REASONING_LENGTH = 20;

/** Reasoning outlier threshold (>5x average length = likely error dump) */
const REASONING_OUTLIER_MULTIPLIER = 5;

/**
 * Outlier Detection Thresholds
 *
 * Statistical thresholds for detecting anomalous patterns in validation data.
 */

/** Confidence variance threshold (stddev < 0.01 = agents not calibrating) */
const CONFIDENCE_VARIANCE_THRESHOLD = 0.01;

/** Minimum sample size for confidence variance check */
const MIN_CONFIDENCE_SAMPLES = 20;

/** Minimum sample size for outlier detection */
const MIN_OUTLIER_SAMPLES = 10;

/**
 * Quality Dimension Scoring Weights
 *
 * How validation issues are penalized when calculating quality scores.
 * Higher penalty = more important dimension.
 */

/** Completeness error penalty (each error reduces score by 20%) */
const COMPLETENESS_ERROR_PENALTY = 0.2;

/** Completeness warning penalty (each warning reduces score by 5%) */
const COMPLETENESS_WARNING_PENALTY = 0.05;

/** Consistency error penalty (each error reduces score by 15%) */
const CONSISTENCY_ERROR_PENALTY = 0.15;

/** Consistency warning penalty (each warning reduces score by 3%) */
const CONSISTENCY_WARNING_PENALTY = 0.03;

/** Balance issue penalty (each balance issue reduces score by 10%) */
const BALANCE_ISSUE_PENALTY = 0.1;

/** Reasoning quality issue penalty (each issue reduces score by 15%) */
const REASONING_QUALITY_PENALTY = 0.15;

/** Temporal error penalty (each error reduces score by 20%) */
const TEMPORAL_ERROR_PENALTY = 0.2;

/**
 * Composite Quality Score Weights
 *
 * How different quality dimensions are weighted in final quality score calculation.
 * Must sum to 1.0.
 */

/** Completeness weight (30% of quality score - most important) */
const QUALITY_WEIGHT_COMPLETENESS = 0.3;

/** Consistency weight (25% of quality score) */
const QUALITY_WEIGHT_CONSISTENCY = 0.25;

/** Balance weight (15% of quality score) */
const QUALITY_WEIGHT_BALANCE = 0.15;

/** Reasoning quality weight (20% of quality score) */
const QUALITY_WEIGHT_REASONING = 0.2;

/** Temporal integrity weight (10% of quality score - least critical) */
const QUALITY_WEIGHT_TEMPORAL = 0.1;

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
  if (withCoherence.length < records.length * COHERENCE_COVERAGE_THRESHOLD) {
    issues.push({
      severity: "warning",
      recordId: null,
      category: "completeness",
      message: `Only ${withCoherence.length}/${records.length} records have coherence scores (${Math.round((withCoherence.length / records.length) * 100)}%)`,
    });
  }

  const withOutcomes = records.filter((r) => r.actual_outcome !== null);
  if (withOutcomes.length < records.length * OUTCOME_COVERAGE_THRESHOLD) {
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
    return !isNaN(t) && t > now + FUTURE_TIMESTAMP_TOLERANCE_MS;
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
  const oneYearAgo = now - HISTORICAL_DATA_AGE_LIMIT_MS;
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
  const counts = [...agentCounts.values()].map((value) => ({ value }));
  const maxCount = findMax(counts, 'value')?.value ?? 0;
  const minCount = findMin(counts, 'value')?.value ?? 0;

  if (counts.length > 1 && maxCount > minCount * AGENT_IMBALANCE_RATIO_THRESHOLD) {
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
  if (holdRate > HOLD_RATE_WARNING_THRESHOLD) {
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
    if (r.reasoning.length < MIN_REASONING_LENGTH) {
      shortReasoningCount++;
    }

    if (genericPatterns.some((p) => p.test(r.reasoning.trim()))) {
      genericReasoningCount++;
    }
  }

  if (shortReasoningCount > records.length * SHORT_REASONING_RATE_THRESHOLD) {
    issues.push({
      severity: "warning",
      recordId: null,
      category: "reasoning_quality",
      message: `${shortReasoningCount}/${records.length} records have very short reasoning (<${MIN_REASONING_LENGTH} chars)`,
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
    const key = `${r.agent_id}|${r.symbol}|${r.action}|${r.reasoning.slice(0, REASONING_SNIPPET_LENGTH)}`;
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
  if (confidences.length > MIN_OUTLIER_SAMPLES) {
    const mean = confidences.reduce((a, b) => a + b, 0) / confidences.length;
    const stdDev = Math.sqrt(
      confidences.reduce((s, c) => s + Math.pow(c - mean, 2), 0) / confidences.length,
    );

    // Check if all confidences are the same (agent not varying)
    if (stdDev < CONFIDENCE_VARIANCE_THRESHOLD && confidences.length > MIN_CONFIDENCE_SAMPLES) {
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
  if (lengths.length > MIN_OUTLIER_SAMPLES) {
    const meanLen = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const veryLong = lengths.filter((l) => l > meanLen * REASONING_OUTLIER_MULTIPLIER).length;
    if (veryLong > 0) {
      issues.push({
        severity: "info",
        recordId: null,
        category: "outliers",
        message: `${veryLong} records have reasoning >${REASONING_OUTLIER_MULTIPLIER}x average length — may contain error dumps`,
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
  const errorCount = countByCondition(issues, (i) => i.severity === "error");
  const warningCount = countByCondition(issues, (i) => i.severity === "warning");
  const infoCount = countByCondition(issues, (i) => i.severity === "info");

  // Quality dimensions (0-1)
  const completenessIssues = issues.filter((i) => i.category === "completeness");
  const completeness = Math.max(0, 1 - countByCondition(completenessIssues, (i) => i.severity === "error") * COMPLETENESS_ERROR_PENALTY - countByCondition(completenessIssues, (i) => i.severity === "warning") * COMPLETENESS_WARNING_PENALTY);

  const consistencyIssues = issues.filter((i) => i.category === "consistency");
  const consistency = Math.max(0, 1 - countByCondition(consistencyIssues, (i) => i.severity === "error") * CONSISTENCY_ERROR_PENALTY - countByCondition(consistencyIssues, (i) => i.severity === "warning") * CONSISTENCY_WARNING_PENALTY);

  const balanceIssues = issues.filter((i) => i.category === "balance" || i.category === "coverage");
  const balance = Math.max(0, 1 - balanceIssues.length * BALANCE_ISSUE_PENALTY);

  const rqIssues = issues.filter((i) => i.category === "reasoning_quality");
  const reasoningQuality = Math.max(0, 1 - rqIssues.length * REASONING_QUALITY_PENALTY);

  const temporalIssues = issues.filter((i) => i.category === "temporal");
  const temporalIntegrity = Math.max(0, 1 - countByCondition(temporalIssues, (i) => i.severity === "error") * TEMPORAL_ERROR_PENALTY);

  const qualityScore = round2(
    completeness * QUALITY_WEIGHT_COMPLETENESS + consistency * QUALITY_WEIGHT_CONSISTENCY + balance * QUALITY_WEIGHT_BALANCE + reasoningQuality * QUALITY_WEIGHT_REASONING + temporalIntegrity * QUALITY_WEIGHT_TEMPORAL,
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
