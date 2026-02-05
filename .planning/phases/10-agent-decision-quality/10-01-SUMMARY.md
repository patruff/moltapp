---
phase: 10-agent-decision-quality
plan: 01
subsystem: quality-analysis
tags: [tool-use, quality, metrics, database-schema, analyzer]

dependency_graph:
  requires: []
  provides: [tool-use-quality-analyzer, decision-quality-schema]
  affects: [10-02-decision-aggregator, 10-03-quality-dashboard]

tech_stack:
  added: []
  patterns: [in-memory-cache, sequence-validation, grade-computation]

key_files:
  created:
    - src/services/tool-use-quality-analyzer.ts
    - src/db/schema/decision-quality.ts
  modified:
    - src/db/schema/index.ts

decisions:
  - id: tool-sequence-rules
    choice: "Portfolio first, theses early, prices before trading"
    rationale: "Matches skill.md guidance for agent tool-calling patterns"
  - id: violation-severity
    choice: "3-level severity (low/medium/high)"
    rationale: "Allows weighted scoring - missing prices before trading is worse than late thesis call"
  - id: grade-thresholds
    choice: "A+ >= 0.95, A >= 0.9, etc."
    rationale: "Matches existing calibration analyzer grading for consistency"

metrics:
  duration: "15 minutes"
  completed: "2026-02-05"
---

# Phase 10 Plan 01: Tool Use Quality Analyzer Summary

**One-liner:** Tool sequence validation service and decision quality snapshot schema for measuring agent tool-calling correctness.

## What Was Built

### 1. Decision Quality Snapshots Schema (`src/db/schema/decision-quality.ts`)

New database table for storing periodic quality metric snapshots:

| Field | Type | Purpose |
|-------|------|---------|
| id | text (PK) | Format: `quality_{agentId}_{timestamp}` |
| agentId | text (FK) | Agent being measured |
| snapshotAt | timestamp | When snapshot was taken |
| compositeScore | real | Weighted average of all metrics (0-1) |
| calibrationEce | real | ECE from confidence-calibration-analyzer |
| integrityScore | real | From reasoning-integrity-engine |
| accountabilityScore | real | From decision-accountability-tracker |
| memoryScore | real | From cross-session-memory-analyzer |
| toolUseScore | real | From tool-use-quality-analyzer |
| toolSequenceViolations | jsonb[] | Array of violation strings |
| grade | text | A+ through F |

Index on (agentId, snapshotAt) for efficient trend queries.

### 2. Tool Use Quality Analyzer (`src/services/tool-use-quality-analyzer.ts`)

New service with 335 lines that validates agent tool-calling patterns:

**Exported Functions:**
- `analyzeToolUseQuality(agentId, lookbackHours?)` - Main analysis function
- `validateToolSequence(toolTrace, action, symbol)` - Validate single tool trace
- `computeToolUseGrade(score)` - Convert numeric score to letter grade

**Exported Types:**
- `ToolUseQualityReport` - Complete quality report interface
- `ToolSequenceViolation` - Violation type and severity
- `ToolCall` - Single tool call from trace

**Violation Types Detected:**

| Type | Severity | Description |
|------|----------|-------------|
| missing_portfolio | medium | First call was not get_portfolio |
| missing_theses | medium/low | get_active_theses not called or called late |
| trade_without_prices | high | BUY/SELL without get_stock_prices |
| buy_without_thesis | medium | BUY without update_thesis |
| sell_without_close_thesis | medium | SELL without close_thesis |
| redundant_call | low | Consecutive identical tool calls |

**Quality Metrics:**
- `correctnessScore` (0-1): Fraction of sequences with no violations
- `argumentQuality` (0-1): Correct input parameters
- `sequenceAdherence` (0-1): Weighted by violation severity
- `redundantCalls`: Count of wasted tool calls

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                  analyzeToolUseQuality(agentId)                 │
├─────────────────────────────────────────────────────────────────┤
│  1. Query tradeJustifications.toolTrace (last 72 hours)         │
│  2. For each justification:                                      │
│     └─ validateToolSequence(toolTrace, action, symbol)           │
│        ├─ Check: get_portfolio first                             │
│        ├─ Check: get_active_theses in first 3 calls              │
│        ├─ Check: get_stock_prices before buy/sell                │
│        ├─ Check: update_thesis on buy                            │
│        ├─ Check: close_thesis on sell                            │
│        └─ Check: no redundant consecutive calls                  │
│  3. Aggregate violations, compute scores                         │
│  4. Return ToolUseQualityReport with grade                       │
└─────────────────────────────────────────────────────────────────┘
```

## Deviations from Plan

None - plan executed exactly as written.

## Commits

| Hash | Type | Description |
|------|------|-------------|
| 9f2af34 | feat | Add decision quality snapshots schema |
| 780f7ee | feat | Add tool use quality analyzer service |

## Testing Notes

- TypeScript compilation: 0 errors
- Schema exported from `src/db/schema/index.ts`
- Service exports verified: `analyzeToolUseQuality`, `validateToolSequence`, `ToolUseQualityReport`

## Next Phase Readiness

**Provides for Plan 10-02 (Decision Aggregator):**
- `toolUseScore` metric ready to be aggregated with other quality scores
- `decisionQualitySnapshots` table ready for storing periodic snapshots
- Grade computation function (`computeToolUseGrade`) reusable

**Integration Points:**
- Call `analyzeToolUseQuality(agentId)` to get tool use metrics
- Store results in `decisionQualitySnapshots.toolUseScore`
- Combine with ECE, integrity, accountability, memory scores for composite

**No blockers for next plan.**
