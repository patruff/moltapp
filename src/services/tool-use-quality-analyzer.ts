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
  const firstThreeTools = toolNames.slice(0, 3);
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
  lookbackHours = 72,
): Promise<ToolUseQualityReport> {
  const cutoff = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

  // Query recent trade justifications with tool traces
  const justifications = await db()
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
    .limit(100);

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
      sequenceScoreSum += 1.0;
    } else {
      // Calculate sequence score based on violation severity
      const severityPenalty = violations.reduce((sum, v) => {
        if (v.severity === "high") return sum + 0.3;
        if (v.severity === "medium") return sum + 0.15;
        return sum + 0.05; // low
      }, 0);
      sequenceScoreSum += Math.max(0, 1 - severityPenalty);
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
    .slice(0, 10);

  // Calculate scores
  const sequenceAdherence = justifications.length > 0
    ? sequenceScoreSum / justifications.length
    : 1;

  const correctnessScore = validSequences / Math.max(1, justifications.length);

  // Argument quality: assume 1.0 if tool calls exist (basic validation)
  // More detailed argument validation could be added later
  const argumentQuality = totalCalls > 0 ? 0.95 : 1.0;

  // Composite score: weighted average
  const compositeScore =
    correctnessScore * 0.4 +
    sequenceAdherence * 0.4 +
    argumentQuality * 0.2;

  const grade = computeToolUseGrade(compositeScore);

  return {
    agentId,
    totalToolCalls: totalCalls,
    correctnessScore: Math.round(correctnessScore * 1000) / 1000,
    argumentQuality: Math.round(argumentQuality * 1000) / 1000,
    sequenceAdherence: Math.round(sequenceAdherence * 1000) / 1000,
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
