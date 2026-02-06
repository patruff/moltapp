/**
 * Decision Quality Dashboard
 *
 * Unified aggregation service that consolidates all existing quality services
 * into a single comprehensive DecisionQualityReport. This fills the gap
 * identified in research: MoltApp has 5+ quality services but no single view.
 *
 * Orchestrates:
 * - confidence-calibration-analyzer (ECE, calibration grade)
 * - reasoning-integrity-engine (flip-flops, contradictions)
 * - decision-accountability-tracker (claim accuracy)
 * - cross-session-memory-analyzer (learning trends)
 * - tool-use-quality-analyzer (tool correctness)
 *
 * Produces composite scores with weighted dimensions for holistic quality assessment.
 */

import { eq, desc } from "drizzle-orm";
import { db } from "../db/index.ts";
import { agents, decisionQualitySnapshots } from "../db/schema/index.ts";
import { computeGrade } from "../lib/grade-calculator.ts";
import { round3 } from "../lib/math-utils.ts";
import { nowISO } from "../lib/format-utils.ts";

// Quality service imports
import { analyzeCalibration } from "./confidence-calibration-analyzer.ts";
import { analyzeIntegrity } from "./reasoning-integrity-engine.ts";
import { getAccountabilityProfile } from "./decision-accountability-tracker.ts";
import { getAgentMemoryProfile } from "./cross-session-memory-analyzer.ts";
import { analyzeToolUseQuality } from "./tool-use-quality-analyzer.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Comprehensive decision quality report aggregating all quality dimensions.
 */
export interface DecisionQualityReport {
  agentId: string;
  timestamp: string;

  /** From confidence-calibration-analyzer */
  calibration: {
    ece: number;
    grade: string;
    overconfidenceRatio: number;
  };

  /** From reasoning-integrity-engine */
  integrity: {
    integrityScore: number;
    flipFlops: number;
    contradictions: number;
  };

  /** From decision-accountability-tracker */
  accountability: {
    accountabilityScore: number;
    accuracyRate: number;
    totalClaims: number;
  };

  /** From cross-session-memory-analyzer */
  memory: {
    memoryScore: number;
    trend: "improving" | "stable" | "declining";
  };

  /** From tool-use-quality-analyzer */
  toolUse: {
    correctnessScore: number;
    sequenceAdherence: number;
    violations: string[];
  };

  /** Weighted composite score (0-1) */
  compositeScore: number;

  /** Letter grade: A+ through F */
  grade: string;

  /** Top 2 strongest dimensions */
  strengths: string[];

  /** Top 2 weakest dimensions */
  weaknesses: string[];
}

// ---------------------------------------------------------------------------
// Weight Configuration
// ---------------------------------------------------------------------------

/**
 * Dimension weights for composite score calculation.
 * Based on research identifying which dimensions most impact decision quality.
 */
const DIMENSION_WEIGHTS = {
  calibration: 0.20, // ECE inverted (lower ECE = higher score)
  integrity: 0.20,
  accountability: 0.20,
  memory: 0.15,
  toolUse: 0.25, // Highest weight - tool correctness is critical
};

// ---------------------------------------------------------------------------
// Grade Computation
// ---------------------------------------------------------------------------

// Note: computeGrade() now imported from ../lib/grade-calculator.ts

// ---------------------------------------------------------------------------
// Main Report Generation
// ---------------------------------------------------------------------------

/**
 * Generate a comprehensive decision quality report for an agent.
 *
 * Calls all 5 quality services in parallel and computes:
 * - Weighted composite score
 * - Letter grade
 * - Top strengths and weaknesses
 *
 * Handles missing data gracefully by using default score of 0.5.
 */
export async function generateDecisionQualityReport(
  agentId: string,
): Promise<DecisionQualityReport> {
  const timestamp = nowISO();

  // Call all services in parallel
  const [calibrationResult, integrityResult, accountabilityResult, memoryResult, toolUseResult] =
    await Promise.all([
      Promise.resolve(analyzeCalibration(agentId)).catch((err) => {
        console.warn(`[DecisionQualityDashboard] Calibration analysis failed for ${agentId}:`, err);
        return null;
      }),
      Promise.resolve(analyzeIntegrity(agentId)).catch((err) => {
        console.warn(`[DecisionQualityDashboard] Integrity analysis failed for ${agentId}:`, err);
        return null;
      }),
      Promise.resolve(getAccountabilityProfile(agentId)).catch((err) => {
        console.warn(`[DecisionQualityDashboard] Accountability analysis failed for ${agentId}:`, err);
        return null;
      }),
      Promise.resolve(getAgentMemoryProfile(agentId)).catch((err) => {
        console.warn(`[DecisionQualityDashboard] Memory analysis failed for ${agentId}:`, err);
        return null;
      }),
      analyzeToolUseQuality(agentId).catch((err) => {
        console.warn(`[DecisionQualityDashboard] Tool use analysis failed for ${agentId}:`, err);
        return null;
      }),
    ]);

  // Extract scores with defaults for missing data
  const calibration = {
    ece: calibrationResult?.ece ?? 0.5,
    grade: calibrationResult?.grade ?? "N/A",
    overconfidenceRatio: calibrationResult?.overconfidenceRatio ?? 0,
  };

  const integrity = {
    integrityScore: integrityResult?.integrityScore ?? 0.5,
    flipFlops: integrityResult?.summary?.flipFlops ?? 0,
    contradictions: integrityResult?.summary?.contradictions ?? 0,
  };

  const accountability = {
    accountabilityScore: accountabilityResult?.accountabilityScore ?? 0.5,
    accuracyRate: accountabilityResult?.accuracyRate ?? 0,
    totalClaims: accountabilityResult?.totalClaims ?? 0,
  };

  const memory = {
    memoryScore: memoryResult?.memoryScore ?? 0.5,
    trend: memoryResult?.trend ?? ("stable" as const),
  };

  const toolUse = {
    correctnessScore: toolUseResult?.correctnessScore ?? 0.5,
    sequenceAdherence: toolUseResult?.sequenceAdherence ?? 0.5,
    violations: toolUseResult?.violations?.map((v) => v.description) ?? [],
  };

  // Calculate dimension scores for composite
  // For calibration: lower ECE is better, so invert: 1 - ECE
  const calibrationScore = 1 - calibration.ece;
  const integrityScore = integrity.integrityScore;
  const accountabilityScore = accountability.accountabilityScore;
  const memoryScore = memory.memoryScore;
  const toolUseScore = (toolUse.correctnessScore + toolUse.sequenceAdherence) / 2;

  // Compute weighted composite score
  const compositeScore =
    calibrationScore * DIMENSION_WEIGHTS.calibration +
    integrityScore * DIMENSION_WEIGHTS.integrity +
    accountabilityScore * DIMENSION_WEIGHTS.accountability +
    memoryScore * DIMENSION_WEIGHTS.memory +
    toolUseScore * DIMENSION_WEIGHTS.toolUse;

  // Round to 3 decimal places
  const roundedComposite = round3(compositeScore);

  // Compute grade
  const grade = computeGrade(roundedComposite);

  // Identify strengths and weaknesses
  const dimensionScores = [
    { name: "Calibration", score: calibrationScore },
    { name: "Integrity", score: integrityScore },
    { name: "Accountability", score: accountabilityScore },
    { name: "Memory", score: memoryScore },
    { name: "Tool Use", score: toolUseScore },
  ];

  // Sort by score descending for strengths
  const sorted = [...dimensionScores].sort((a, b) => b.score - a.score);
  const strengths = sorted.slice(0, 2).map((d) => `${d.name} (${(d.score * 100).toFixed(0)}%)`);
  const weaknesses = sorted.slice(-2).reverse().map((d) => `${d.name} (${(d.score * 100).toFixed(0)}%)`);

  return {
    agentId,
    timestamp,
    calibration,
    integrity,
    accountability,
    memory,
    toolUse,
    compositeScore: roundedComposite,
    grade,
    strengths,
    weaknesses,
  };
}

// ---------------------------------------------------------------------------
// Snapshot Storage
// ---------------------------------------------------------------------------

/**
 * Store a quality snapshot in the database for trend analysis.
 */
export async function storeQualitySnapshot(
  report: DecisionQualityReport,
): Promise<void> {
  const id = `quality_${report.agentId}_${Date.now()}`;

  await db().insert(decisionQualitySnapshots).values({
    id,
    agentId: report.agentId,
    snapshotAt: new Date(report.timestamp),
    compositeScore: report.compositeScore,
    calibrationEce: report.calibration.ece,
    integrityScore: report.integrity.integrityScore,
    accountabilityScore: report.accountability.accountabilityScore,
    memoryScore: report.memory.memoryScore,
    toolUseScore: (report.toolUse.correctnessScore + report.toolUse.sequenceAdherence) / 2,
    toolSequenceViolations: report.toolUse.violations,
    grade: report.grade,
  });
}

/**
 * Get the most recent quality snapshot for an agent.
 * Returns null if no snapshots exist.
 */
export async function getLatestQualitySnapshot(
  agentId: string,
): Promise<DecisionQualityReport | null> {
  const rows = await db()
    .select()
    .from(decisionQualitySnapshots)
    .where(eq(decisionQualitySnapshots.agentId, agentId))
    .orderBy(desc(decisionQualitySnapshots.snapshotAt))
    .limit(1);

  if (rows.length === 0) {
    return null;
  }

  const row = rows[0];

  // Reconstruct DecisionQualityReport from snapshot
  // Note: Some detailed fields aren't stored in snapshot, so we use defaults
  return {
    agentId: row.agentId,
    timestamp: row.snapshotAt.toISOString(),
    calibration: {
      ece: row.calibrationEce ?? 0.5,
      grade: row.grade ?? "N/A",
      overconfidenceRatio: 0, // Not stored in snapshot
    },
    integrity: {
      integrityScore: row.integrityScore ?? 0.5,
      flipFlops: 0, // Not stored in snapshot
      contradictions: 0, // Not stored in snapshot
    },
    accountability: {
      accountabilityScore: row.accountabilityScore ?? 0.5,
      accuracyRate: 0, // Not stored in snapshot
      totalClaims: 0, // Not stored in snapshot
    },
    memory: {
      memoryScore: row.memoryScore ?? 0.5,
      trend: "stable", // Not stored in snapshot
    },
    toolUse: {
      correctnessScore: row.toolUseScore ?? 0.5,
      sequenceAdherence: row.toolUseScore ?? 0.5, // Same value, not stored separately
      violations: (row.toolSequenceViolations as string[]) ?? [],
    },
    compositeScore: row.compositeScore ?? 0.5,
    grade: row.grade ?? "N/A",
    strengths: [], // Not stored in snapshot
    weaknesses: [], // Not stored in snapshot
  };
}

// ---------------------------------------------------------------------------
// Batch Operations
// ---------------------------------------------------------------------------

/**
 * Generate and store quality reports for all active agents.
 * Call this from heartbeat after trading rounds complete.
 */
export async function generateAllQualityReports(): Promise<{
  generated: number;
  agents: string[];
}> {
  // Get list of active agents from agents table
  const activeAgents = await db()
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.isActive, true));

  const agentIds = activeAgents.map((a: { id: string }) => a.id);
  const results: string[] = [];

  for (const agentId of agentIds) {
    try {
      const report = await generateDecisionQualityReport(agentId);
      await storeQualitySnapshot(report);
      results.push(agentId);
    } catch (err) {
      console.warn(`[DecisionQualityDashboard] Failed to generate quality report for ${agentId}:`, err);
    }
  }

  return { generated: results.length, agents: results };
}
