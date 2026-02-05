---
phase: 10-agent-decision-quality
plan: 02
subsystem: quality-analysis
tags: [aggregation, quality-dashboard, composite-score, weighted-metrics]

dependency_graph:
  requires:
    - phase: 10-01
      provides: [tool-use-quality-analyzer, decision-quality-schema]
  provides:
    - Unified decision quality dashboard service
    - DecisionQualityReport type aggregating all 5 quality dimensions
    - generateDecisionQualityReport for single agent analysis
    - generateAllQualityReports for batch processing
    - storeQualitySnapshot for persistence
    - getLatestQualitySnapshot for retrieval
  affects: [10-03-quality-api-route, heartbeat-integration]

tech_stack:
  added: []
  patterns: [parallel-service-aggregation, weighted-composite-scoring, graceful-degradation]

key_files:
  created:
    - src/services/decision-quality-dashboard.ts
  modified: []

decisions:
  - id: dimension-weights
    choice: "calibration 20%, integrity 20%, accountability 20%, memory 15%, tool-use 25%"
    rationale: "Tool use weighted highest as correct tool patterns are critical for quality decisions"
  - id: calibration-inversion
    choice: "Score = 1 - ECE (since lower ECE is better)"
    rationale: "Makes calibration score directionally consistent with other dimensions"
  - id: graceful-defaults
    choice: "Use 0.5 default score when service returns no data"
    rationale: "New agents with no history should get neutral score, not fail"

metrics:
  duration: "8 minutes"
  completed: "2026-02-05"
---

# Phase 10 Plan 02: Decision Quality Dashboard Summary

**Unified quality aggregation service consolidating 5 quality analyzers into weighted composite scores with persistence.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-02-05T12:53:23Z
- **Completed:** 2026-02-05T13:01:XX Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Created unified decision quality dashboard aggregating all 5 quality services
- Implemented parallel service calls with graceful error handling
- Added weighted composite scoring with research-backed weights
- Implemented snapshot storage and retrieval for trend analysis
- Added batch function for heartbeat integration

## Task Commits

Both tasks were implemented in a single file creation:

1. **Task 1: Create decision quality dashboard service** - `ffba898` (feat)
   - Created full service with all exports
   - Imports from all 5 quality services
   - Implements composite scoring with weights
2. **Task 2: Add batch function** - `ffba898` (feat)
   - `generateAllQualityReports` included in same commit
   - Queries active agents and generates reports for each

## Files Created

- `src/services/decision-quality-dashboard.ts` (364 lines)
  - Unified quality aggregation service
  - Imports: confidence-calibration-analyzer, reasoning-integrity-engine,
    decision-accountability-tracker, cross-session-memory-analyzer,
    tool-use-quality-analyzer
  - Exports: DecisionQualityReport, generateDecisionQualityReport,
    storeQualitySnapshot, getLatestQualitySnapshot, generateAllQualityReports

## Key Interfaces

```typescript
interface DecisionQualityReport {
  agentId: string;
  timestamp: string;
  calibration: { ece, grade, overconfidenceRatio };
  integrity: { integrityScore, flipFlops, contradictions };
  accountability: { accountabilityScore, accuracyRate, totalClaims };
  memory: { memoryScore, trend };
  toolUse: { correctnessScore, sequenceAdherence, violations };
  compositeScore: number;  // Weighted average (0-1)
  grade: string;           // A+ through F
  strengths: string[];     // Top 2 dimensions
  weaknesses: string[];    // Bottom 2 dimensions
}
```

## Weight Configuration

| Dimension | Weight | Rationale |
|-----------|--------|-----------|
| Calibration | 0.20 | Confidence accuracy matters |
| Integrity | 0.20 | Consistency in reasoning |
| Accountability | 0.20 | Claim accuracy tracking |
| Memory | 0.15 | Learning from mistakes |
| Tool Use | 0.25 | Highest - correct tool patterns critical |

## Decisions Made

1. **Tool use weighted highest (25%)** - Correct tool-calling patterns directly impact decision quality
2. **Calibration score inverted** - `1 - ECE` makes direction consistent with other scores
3. **Graceful defaults (0.5)** - New agents get neutral scores rather than failures
4. **Parallel service calls** - All 5 services called with Promise.all for performance
5. **Grade thresholds consistent** - Same A+ through F scale as tool-use-quality-analyzer

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Minor TypeScript implicit any fix required for `activeAgents.map((a) => a.id)` - added explicit type annotation `(a: { id: string }) => a.id`.

## Next Phase Readiness

**Provides for Plan 10-03 (Quality API Route):**
- Full `DecisionQualityReport` interface ready for serialization
- `generateDecisionQualityReport(agentId)` ready to be called from API
- `getLatestQualitySnapshot(agentId)` for cached report retrieval
- `generateAllQualityReports()` for heartbeat integration

**Integration Points:**
- API route can call `generateDecisionQualityReport` for on-demand reports
- Heartbeat can call `generateAllQualityReports` after trading rounds
- Dashboard can call `getLatestQualitySnapshot` for cached data

**No blockers for next plan.**

---
*Phase: 10-agent-decision-quality*
*Completed: 2026-02-05*
