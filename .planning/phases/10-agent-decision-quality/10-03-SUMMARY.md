---
phase: 10-agent-decision-quality
plan: 03
subsystem: ui
tags: [dashboard, quality-metrics, visualization, hono, jsx]

dependency_graph:
  requires:
    - phase: 10-02
      provides: [decision-quality-dashboard-service, DecisionQualityReport-type]
  provides:
    - /decision-quality route with unified quality dashboard
    - Per-agent quality cards showing all 5 dimensions
    - Model name display for each agent
    - Aggregate quality metrics summary
    - Link from homepage to quality dashboard
  affects: [agent-profile-pages, decision-quality-improvements]

tech_stack:
  added: []
  patterns: [parallel-data-loading, conditional-rendering, responsive-grid]

key_files:
  created: []
  modified:
    - src/routes/pages.tsx

decisions:
  - id: model-display-position
    choice: "Display model name below agent name in monospace font"
    rationale: "User requested model details visible; monospace maintains technical aesthetic"
  - id: grade-badge-colors
    choice: "A/A+ green, B blue, C yellow, D/F red"
    rationale: "Consistent with existing grade displays in calibration analyzer"
  - id: score-bar-colors
    choice: "80%+ green, 60%+ blue, 40%+ yellow, below red"
    rationale: "Progressive color scale for quick visual assessment"

metrics:
  duration: "12 minutes"
  completed: "2026-02-05"
---

# Phase 10 Plan 03: Decision Quality Dashboard Route Summary

**New /decision-quality route showing unified quality metrics for all agents with model names, composite scores, 5-dimension breakdowns, and strengths/weaknesses.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-02-05T13:10:XX Z
- **Completed:** 2026-02-05T13:22:XX Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- Created /decision-quality route with responsive dashboard layout
- Displays aggregate metrics: average quality score, best/worst dimensions
- Per-agent quality cards showing:
  - Agent name and model (claude-opus-4-5-20251101, gpt-4o-mini, grok-beta)
  - Composite score with progress bar
  - All 5 quality dimensions with individual score bars
  - Strengths and weaknesses lists
  - Grade badge (A+ through F)
- Added "Decision Quality" link to homepage header

## Task Commits

1. **Task 1: Add decision quality dashboard route** - `79da2d9` (feat)
   - Full /decision-quality route implementation
   - Summary cards for aggregate metrics
   - Per-agent quality cards with 5 dimensions
   - Homepage link addition

2. **Task 2: Human verification checkpoint** - user feedback incorporated
   - User requested: "We should be giving model details on the website"
   - Added model name display to each agent card - `06e8e01` (feat)
   - Model displayed below agent name in monospace font

## Files Modified

- `src/routes/pages.tsx` (~200 lines added)
  - Lines 1380-1640: New /decision-quality route
  - Lines 1493-1522: Agent cards with model display
  - Lines 272-277: Homepage link to decision quality

## UI Components Added

1. **Summary Cards Row** (3 cards)
   - Average Quality Score across all agents
   - Best Performing Dimension (highest avg)
   - Needs Improvement (lowest avg)

2. **Per-Agent Quality Card**
   - Header: Agent name link + grade badge (A+ through F)
   - Model name in gray monospace text
   - Composite score bar (0-100%)
   - 5 dimension score bars:
     - Calibration (1 - ECE)
     - Integrity
     - Accountability
     - Memory
     - Tool Use
   - Strengths list (green text)
   - Weaknesses list (red text)
   - Link to full agent profile

## Decisions Made

1. **Model name display** - Added per user feedback, shows exact model ID (e.g., claude-opus-4-5-20251101)
2. **Responsive grid** - 1 column mobile, 2 columns md, 3 columns lg
3. **Score bar colors** - Progressive: green (80%+), blue (60%+), yellow (40%+), red (below)
4. **Grade badge colors** - Matches existing patterns: A/A+ green, B blue, C yellow, D/F red

## Deviations from Plan

### User-Requested Enhancement

**1. Added model display per user feedback**
- **Found during:** Task 2 checkpoint
- **Issue:** User wanted to see which model (claude-opus-4-5, gpt-4o-mini, grok-beta) each agent uses
- **Fix:** Added `getAgentConfig(report.agentId)?.model` lookup and display below agent name
- **Files modified:** src/routes/pages.tsx
- **Committed in:** 06e8e01

---

**Total deviations:** 1 user-requested enhancement
**Impact on plan:** Improved dashboard per user feedback. No scope creep - enhancement within plan scope.

## Issues Encountered

None - route implemented cleanly using existing patterns from /economics dashboard.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**Phase 10 Complete:**
- Tool use quality analyzer service (10-01)
- Decision quality dashboard service (10-02)
- Decision quality dashboard route (10-03)

**All quality metrics now visible at /decision-quality.**

**Potential future enhancements:**
- Add quality metrics to individual agent profile pages
- Integrate with heartbeat to auto-generate quality snapshots after trading rounds
- Add historical trend charts for quality dimensions

---
*Phase: 10-agent-decision-quality*
*Completed: 2026-02-05*
