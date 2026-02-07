/**
 * Tool Use Quality Analyzer
 *
 * Analyzes whether AI trading agents use their tools correctly:
 * - Proper tool sequence (portfolio first, prices before trading)
 * - Correct argument usage (valid symbols, proper parameters)
 * - Thesis management (update on buy, close on sell)
 * - No redundant calls (avoid wasting tokens)
 *
 * This fills a critical gap in the quality measurement system.
 * Existing services measure confidence calibration and reasoning integrity,
 * but NOT whether agents follow correct tool-calling patterns.
 */

import { desc, eq, and, gte } from "drizzle-orm";
import { db } from "../db/index.ts";
import { tradeJustifications } from "../db/schema/index.ts";
import { computeGrade } from "../lib/grade-calculator.ts";
import { round3 } from "../lib/math-utils.ts";

// ---------------------------------------------------------------------------
// Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Tool Sequence Validation Parameters
 *
 * Controls which tool usage patterns are considered correct and
 * how violations are scored in quality assessment.
 */

/**
 * Maximum position in tool sequence to check for early tool calls.
 * get_active_theses should appear within first 3 calls to establish context.
 */
const SEQUENCE_EARLY_TOOLS_MAX_POSITION = 3;

/**
 * Tool Sequence Violation Severity Penalties
 *
 * These penalties are subtracted from the 1.0 perfect sequence score
 * for each violation type detected. Multiple violations accumulate.
 */

/**
 * Penalty for high-severity violations (trading without prices).
 * Example: Agent decides to BUY without calling get_stock_prices first.
 * Max penalty: 0.3 per violation.
 */
const SEVERITY_PENALTY_HIGH = 0.3;

/**
 * Penalty for medium-severity violations (missing portfolio, missing theses, buy without thesis).
 * Example: Agent takes action without calling get_portfolio first.
 * Max penalty: 0.15 per violation.
 */
const SEVERITY_PENALTY_MEDIUM = 0.15;

/**
 * Penalty for low-severity violations (redundant calls, late theses check).
 * Example: Agent calls get_stock_prices twice consecutively with same arguments.
 * Max penalty: 0.05 per violation.
 */
const SEVERITY_PENALTY_LOW = 0.05;

/**
 * Analysis Query Parameters
 *
 * Controls data retrieval and reporting limits for quality analysis.
 */

/**
 * Default lookback period for tool use analysis.
 * 72 hours = 3 days of trading rounds (sufficient to detect patterns).
 */
const ANALYSIS_LOOKBACK_HOURS_DEFAULT = 72;

/**
 * Milliseconds per hour conversion constant.
 * Used for calculating lookback cutoff timestamp.
 */
const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

/**
 * Maximum trade justifications to analyze per agent query.
 * Limits database query size to prevent performance degradation.
 * 100 justifications ≈ 2-3 weeks of trading at 5-7 rounds/day.
 */
const ANALYSIS_MAX_JUSTIFICATIONS = 100;

/**
 * Maximum unique violations to include in quality report.
 * Prevents report bloat from repeated violation patterns.
 * Returns top 10 most recent unique violations by description.
 */
const REPORT_MAX_VIOLATIONS = 10;

/**
 * Tool Sequence Scoring Parameters
 *
 * Weights and baseline values for calculating composite quality scores.
 */

/**
 * Perfect sequence score baseline.
 * Starting score before any violations are detected.
 */
const SEQUENCE_SCORE_PERFECT = 1.0;

/**
 * Argument quality baseline when tool calls exist.
 * 0.95 = assume mostly correct arguments (detailed validation not yet implemented).
 * Lower than 1.0 to acknowledge potential argument errors.
 */
const ARGUMENT_QUALITY_BASELINE = 0.95;

/**
 * Argument quality for agents with no tool calls.
 * 1.0 = no violations possible if no tools used.
 */
const ARGUMENT_QUALITY_NO_CALLS = 1.0;

/**
 * Composite Quality Score Weights
 *
 * Controls relative importance of different quality dimensions
 * in final tool use grade calculation.
 */

/**
 * Weight for correctness score (valid sequences without violations).
 * 40% of composite score — HIGHEST weight.
 * Measures whether agent follows required tool patterns.
 */
const COMPOSITE_WEIGHT_CORRECTNESS = 0.4;

/**
 * Weight for sequence adherence score (severity-adjusted compliance).
 * 40% of composite score — HIGHEST weight.
 * Measures how closely agent follows expected tool ordering.
 */
const COMPOSITE_WEIGHT_SEQUENCE = 0.4;

/**
 * Weight for argument quality score.
 * 20% of composite score — lowest weight.
 * Currently uses baseline; detailed validation not yet implemented.
 */
const COMPOSITE_WEIGHT_ARGUMENTS = 0.2;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single tool call from the agent's tool trace.
 */
export interface ToolCall {
  turn: number;
  tool: string;
  arguments: Record<string, string | number | boolean | string[]>;
  result: string;
  timestamp: string;
}

/**
 * A violation of expected tool sequence or usage patterns.
 */
export interface ToolSequenceViolation {
  type:
    | "missing_portfolio"
    | "missing_theses"
    | "trade_without_prices"
    | "buy_without_thesis"
    | "sell_without_close_thesis"
    | "redundant_call";
  description: string;
  severity: "low" | "medium" | "high";
}

/**
 * Complete quality report for an agent's tool usage.
 */
export interface ToolUseQualityReport {
  agentId: string;
  totalToolCalls: number;
  /** 0-1: proper tool use */
  correctnessScore: number;
  /** 0-1: correct input parameters */
  argumentQuality: number;
  /** 0-1: followed required order */
  sequenceAdherence: number;
  /** unnecessary repeated calls */
  redundantCalls: number;
  violations: ToolSequenceViolation[];
  /** A+ through F */
  grade: string;
  analyzedAt: string;
}

// ---------------------------------------------------------------------------
// Tool Sequence Validation
// ---------------------------------------------------------------------------

/**
 * Validate a single tool trace for correct sequence and usage patterns.
 *
 * Expected patterns:
 * 1. get_portfolio should be first call (know your positions)
 * 2. get_active_theses should be early (first 3 calls, know your investment theses)
 * 3. get_stock_prices called before any buy/sell action
 * 4. update_thesis called if action is buy (document reasoning)
 * 5. close_thesis called if action is sell (close out position reasoning)
 * 6. No redundant consecutive identical calls
 */
export function validateToolSequence(
  toolTrace: ToolCall[],
  action: string,
  symbol: string,
): { valid: boolean; violations: ToolSequenceViolation[] } {
  const violations: ToolSequenceViolation[] = [];

  if (!toolTrace || toolTrace.length === 0) {
    return { valid: true, violations: [] };
  }

  const toolNames = toolTrace.map((t) => t.tool);
  const toolSet = new Set(toolNames);

  // Check 1: get_portfolio should be first call
  if (toolNames[0] !== "get_portfolio") {
    violations.push({
      type: "missing_portfolio",
      description: `First call was '${toolNames[0]}' instead of 'get_portfolio'. Agent should know positions before deciding.`,
      severity: "medium",
    });
  }

  // Check 2: get_active_theses should be in first 3 calls
  const firstThreeTools = toolNames.slice(0, SEQUENCE_EARLY_TOOLS_MAX_POSITION);
  if (!firstThreeTools.includes("get_active_theses") && toolSet.has("get_active_theses")) {
    violations.push({
      type: "missing_theses",
      description: "get_active_theses called late in sequence. Agent should review theses early.",
      severity: "low",
    });
  } else if (!toolSet.has("get_active_theses")) {
    violations.push({
      type: "missing_theses",
      description: "get_active_theses never called. Agent should review existing investment theses.",
      severity: "medium",
    });
  }

  // Check 3: get_stock_prices should be called before buy/sell action
  if (action === "buy" || action === "sell") {
    if (!toolSet.has("get_stock_prices")) {
      violations.push({
        type: "trade_without_prices",
        description: `${action.toUpperCase()} action taken without calling get_stock_prices first.`,
        severity: "high",
      });
    }
  }

  // Check 4: update_thesis should be called on buy
  if (action === "buy") {
    if (!toolSet.has("update_thesis")) {
      violations.push({
        type: "buy_without_thesis",
        description: "BUY action taken without calling update_thesis. Agent should document investment reasoning.",
        severity: "medium",
      });
    }
  }

  // Check 5: close_thesis should be called on sell
  if (action === "sell") {
    if (!toolSet.has("close_thesis")) {
      violations.push({
        type: "sell_without_close_thesis",
        description: "SELL action taken without calling close_thesis. Agent should close investment thesis.",
        severity: "medium",
      });
    }
  }

  // Check 6: No redundant consecutive identical calls
  let redundantCount = 0;
  for (let i = 1; i < toolTrace.length; i++) {
    const prev = toolTrace[i - 1];
    const curr = toolTrace[i];
    if (
      prev.tool === curr.tool &&
      JSON.stringify(prev.arguments) === JSON.stringify(curr.arguments)
    ) {
      redundantCount++;
      if (redundantCount === 1) {
        // Only add one violation for redundant calls
        violations.push({
          type: "redundant_call",
          description: `Redundant consecutive call to '${curr.tool}' with same arguments.`,
          severity: "low",
        });
      }
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

// ---------------------------------------------------------------------------
// Grade Computation
// ---------------------------------------------------------------------------

/**
 * Compute a letter grade from a numeric score (0-1).
 * Wrapper for shared computeGrade utility.
 */
export function computeToolUseGrade(score: number): string {
  return computeGrade(score);
}

// ---------------------------------------------------------------------------
// Main Analysis Function
// ---------------------------------------------------------------------------

/**
 * Analyze tool use quality for an agent over a time period.
 *
 * Queries tradeJustifications for the agent's recent tool traces
 * and validates each trace for correct patterns.
 *
 * @param agentId - The agent to analyze
 * @param lookbackHours - How far back to analyze (default: 72 hours)
 */
export async function analyzeToolUseQuality(
  agentId: string,
  lookbackHours = ANALYSIS_LOOKBACK_HOURS_DEFAULT,
): Promise<ToolUseQualityReport> {
  const cutoff = new Date(Date.now() - lookbackHours * MILLISECONDS_PER_HOUR);

  // Query recent trade justifications with tool traces
  const justifications = await db
    .select({
      id: tradeJustifications.id,
      action: tradeJustifications.action,
      symbol: tradeJustifications.symbol,
      toolTrace: tradeJustifications.toolTrace,
    })
    .from(tradeJustifications)
    .where(
      and(
        eq(tradeJustifications.agentId, agentId),
        gte(tradeJustifications.timestamp, cutoff),
      ),
    )
    .orderBy(desc(tradeJustifications.timestamp))
    .limit(ANALYSIS_MAX_JUSTIFICATIONS);

  if (justifications.length === 0) {
    return emptyReport(agentId);
  }

  // Analyze each justification's tool trace
  let totalCalls = 0;
  let totalViolations: ToolSequenceViolation[] = [];
  let validSequences = 0;
  let redundantCalls = 0;
  let sequenceScoreSum = 0;

  for (const j of justifications) {
    const toolTrace = (j.toolTrace ?? []) as ToolCall[];
    totalCalls += toolTrace.length;

    const { valid, violations } = validateToolSequence(
      toolTrace,
      j.action,
      j.symbol,
    );

    if (valid) {
      validSequences++;
      sequenceScoreSum += SEQUENCE_SCORE_PERFECT;
    } else {
      // Calculate sequence score based on violation severity
      const severityPenalty = violations.reduce((sum, v) => {
        if (v.severity === "high") return sum + SEVERITY_PENALTY_HIGH;
        if (v.severity === "medium") return sum + SEVERITY_PENALTY_MEDIUM;
        return sum + SEVERITY_PENALTY_LOW; // low
      }, 0);
      sequenceScoreSum += Math.max(0, SEQUENCE_SCORE_PERFECT - severityPenalty);
    }

    // Count redundant calls
    const redundant = violations.filter((v) => v.type === "redundant_call");
    redundantCalls += redundant.length;

    // Accumulate violations (limit to 10 most recent for report)
    totalViolations.push(...violations);
  }

  // Keep only unique violations by description
  const uniqueViolations = totalViolations
    .filter((v, i, arr) => arr.findIndex((x) => x.description === v.description) === i)
    .slice(0, REPORT_MAX_VIOLATIONS);

  // Calculate scores
  const sequenceAdherence = justifications.length > 0
    ? sequenceScoreSum / justifications.length
    : 1;

  const correctnessScore = validSequences / Math.max(1, justifications.length);

  // Argument quality: assume baseline if tool calls exist (basic validation)
  // More detailed argument validation could be added later
  const argumentQuality = totalCalls > 0 ? ARGUMENT_QUALITY_BASELINE : ARGUMENT_QUALITY_NO_CALLS;

  // Composite score: weighted average
  const compositeScore =
    correctnessScore * COMPOSITE_WEIGHT_CORRECTNESS +
    sequenceAdherence * COMPOSITE_WEIGHT_SEQUENCE +
    argumentQuality * COMPOSITE_WEIGHT_ARGUMENTS;

  const grade = computeToolUseGrade(compositeScore);

  return {
    agentId,
    totalToolCalls: totalCalls,
    correctnessScore: round3(correctnessScore),
    argumentQuality: round3(argumentQuality),
    sequenceAdherence: round3(sequenceAdherence),
    redundantCalls,
    violations: uniqueViolations,
    grade,
    analyzedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyReport(agentId: string): ToolUseQualityReport {
  return {
    agentId,
    totalToolCalls: 0,
    correctnessScore: 1,
    argumentQuality: 1,
    sequenceAdherence: 1,
    redundantCalls: 0,
    violations: [],
    grade: "N/A",
    analyzedAt: new Date().toISOString(),
  };
}
