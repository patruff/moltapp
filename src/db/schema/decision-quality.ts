/**
 * Decision Quality Schema
 *
 * Tracks composite decision quality metrics for AI trading agents.
 * Stores periodic snapshots aggregating calibration, integrity,
 * accountability, memory, and tool use quality scores for trend analysis.
 */

import {
  pgTable,
  text,
  real,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { agents } from "./agents.ts";

/**
 * Decision quality snapshots — periodic aggregation of quality metrics
 * from multiple analyzers into a single composite assessment.
 *
 * Aggregates data from:
 * - confidence-calibration-analyzer (ECE score)
 * - reasoning-integrity-engine (flip-flop detection)
 * - decision-accountability-tracker (claim tracking)
 * - cross-session-memory-analyzer (learning detection)
 * - tool-use-quality-analyzer (tool correctness)
 */
export const decisionQualitySnapshots = pgTable(
  "decision_quality_snapshots",
  {
    /** Unique ID: quality_{agentId}_{timestamp} */
    id: text("id").primaryKey(),

    /** Agent being measured */
    agentId: text("agent_id")
      .references(() => agents.id)
      .notNull(),

    /** When the snapshot was taken */
    snapshotAt: timestamp("snapshot_at").notNull(),

    /** Composite quality score: weighted average of all metrics (0-1 scale) */
    compositeScore: real("composite_score"),

    /** Expected Calibration Error from confidence-calibration-analyzer (lower is better) */
    calibrationEce: real("calibration_ece"),

    /** Reasoning integrity score from reasoning-integrity-engine (0-1 scale) */
    integrityScore: real("integrity_score"),

    /** Accountability score from decision-accountability-tracker (0-1 scale) */
    accountabilityScore: real("accountability_score"),

    /** Memory/learning score from cross-session-memory-analyzer (0-1 scale) */
    memoryScore: real("memory_score"),

    /** Tool use quality score from tool-use-quality-analyzer (0-1 scale) */
    toolUseScore: real("tool_use_score"),

    /** Array of tool sequence violation descriptions */
    toolSequenceViolations: jsonb("tool_sequence_violations").$type<string[]>(),

    /** Letter grade: A+ through F */
    grade: text("grade"),

    /** When the snapshot was created */
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    /** Index for efficient queries by agent + time */
    index("idx_quality_agent_snapshot").on(table.agentId, table.snapshotAt),
  ],
);
