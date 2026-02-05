---
phase: 09-ongoing-improvement
plan: 02
subsystem: ui
tags: [economics, cost-tracking, dashboard, llm-costs, roi]

# Dependency graph
requires:
  - phase: 09-01
    provides: LLM token usage tracking infrastructure (llm_usage table, llm-cost-tracker service)
provides:
  - /economics dashboard showing LLM cost vs trading P&L
  - Per-agent cost breakdown with ROI calculation
  - Economics summary card on agent profile pages
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Dashboard cards with summary metrics (4-column grid)
    - Conditional rendering for data-dependent UI sections

key-files:
  created: []
  modified:
    - src/routes/pages.tsx

key-decisions:
  - "Used getAgentConfig for model lookup since LeaderboardEntry lacks model field"
  - "Conditional render economics card only when totalTokens > 0"
  - "Added getAgentCosts to parallel Promise.all fetch for performance"

patterns-established:
  - "Economics/cost visualization pattern with LLM cost tracker integration"
  - "ROI calculation: (Trading P&L / LLM Cost) x 100"

# Metrics
duration: 3min
completed: 2026-02-05
---

# Phase 09 Plan 02: Economics Dashboard Summary

**Created /economics dashboard showing LLM cost vs trading returns with per-agent ROI breakdown, plus economics card on agent profiles**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-05T10:08:15Z
- **Completed:** 2026-02-05T10:11:06Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- Created `/economics` route with summary cards (Total LLM Cost, Trading P&L, Net Economics, ROI)
- Added per-agent breakdown table showing cost, tokens, P&L, and net economics per agent
- Added economics summary card to agent profile pages (shows when agent has usage data)
- Added "View Economics" button to homepage header

## Task Commits

Each task was committed atomically:

1. **Task 1: Add Economics Dashboard Route** - `ba69ad3` (feat)
2. **Task 2: Add Economics Summary to Agent Profile** - `e56c39a` (feat)

## Files Created/Modified

- `src/routes/pages.tsx` - Added imports for getTotalCosts and getAgentCosts, homepage link, /economics route (160+ lines), agent profile economics card

## Decisions Made

- **Used getAgentConfig for model lookup:** LeaderboardEntry interface doesn't have a model field, so we fetch agent config to get the model name for display in the economics table.
- **Conditional rendering:** Economics card only shows on agent profile when `totalTokens > 0`, preventing empty state display for agents without tracked usage.
- **Parallel fetch:** Added getAgentCosts to the existing Promise.all in agent profile route for optimal performance (no sequential API calls).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed model property access on LeaderboardEntry**
- **Found during:** Task 1 (Economics dashboard route)
- **Issue:** Plan template referenced `agent.model` but LeaderboardEntry type doesn't have a model field
- **Fix:** Used `getAgentConfig(agent.agentId)?.model` to fetch model from config
- **Files modified:** src/routes/pages.tsx
- **Verification:** TypeScript compilation passes
- **Committed in:** ba69ad3 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Minor type fix, no scope change.

## Issues Encountered

None - both tasks executed smoothly after the type fix.

## User Setup Required

None - no external service configuration required. The dashboard uses existing LLM usage data from the database.

## Next Phase Readiness

- Economics dashboard fully functional and accessible
- Ready for production use once trading rounds generate LLM usage data
- Future enhancements could include:
  - Historical cost charts
  - Cost per trade metrics
  - Model efficiency comparisons

---
*Phase: 09-ongoing-improvement*
*Completed: 2026-02-05*
