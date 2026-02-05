---
phase: 09-ongoing-improvement
plan: 01
subsystem: agents
tags: [llm, token-tracking, cost-estimation, anthropic, openai, xai]

# Dependency graph
requires:
  - phase: 08-heartbeat (implied)
    provides: Agent tool-calling loop infrastructure
provides:
  - LLM token usage tracking from all API calls (Claude, GPT, Grok)
  - Cost estimation service with model pricing
  - llm_usage database table for economic analysis
affects:
  - 09-02 (data analysis/visualization)
  - future profitability dashboards
  - agent economic viability reporting

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Token usage extraction pattern for Anthropic API (input_tokens, output_tokens)
    - Token usage extraction pattern for OpenAI API (prompt_tokens, completion_tokens)
    - Per-round usage accumulation in tool-calling loop

key-files:
  created:
    - src/db/schema/llm-usage.ts
    - src/services/llm-cost-tracker.ts
  modified:
    - src/db/schema/index.ts
    - src/agents/base-agent.ts
    - src/agents/claude-trader.ts
    - src/agents/openai-compatible-utils.ts

key-decisions:
  - "Usage field added as optional to AgentTurn for backward compatibility"
  - "recordUsage helper function encapsulates async recording with error handling"
  - "Model pricing stored in cost tracker service, not database (simpler updates)"

patterns-established:
  - "AgentTurn.usage optional field pattern for token tracking"
  - "Per-turn accumulation with single end-of-loop recording"

# Metrics
duration: 12min
completed: 2026-02-05
---

# Phase 9 Plan 01: LLM Token Usage Tracking Summary

**Token usage extraction from Claude/GPT/Grok agents with per-round recording to llm_usage table for economic viability analysis**

## Performance

- **Duration:** 12 min
- **Started:** 2026-02-05T10:00:21Z
- **Completed:** 2026-02-05T10:12:30Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments
- Added `usage` field to `AgentTurn` interface for token tracking
- Implemented usage extraction from Anthropic API (`input_tokens`, `output_tokens`)
- Implemented usage extraction from OpenAI-compatible APIs (`prompt_tokens`, `completion_tokens`)
- Integrated usage accumulation and recording into base-agent `runAgentLoop`
- Pushed schema to database (llm_usage table created)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create LLM Usage Schema and Cost Tracker Service** - `3869bd5` (prior heartbeat session)
   - Schema and service were already created in a previous heartbeat cycle

2. **Task 2: Add Usage Field to AgentTurn and Capture in Agents** - `22533a6` (feat)
   - Modified base-agent.ts, claude-trader.ts, openai-compatible-utils.ts

3. **Task 3: Run Database Migration** - N/A (database operation, no code change)
   - Successfully pushed schema with `npx drizzle-kit push`

## Files Created/Modified
- `src/db/schema/llm-usage.ts` - LLM usage table schema (created prior session)
- `src/db/schema/index.ts` - Added llm-usage export (created prior session)
- `src/services/llm-cost-tracker.ts` - Cost estimation and recording service (created prior session)
- `src/agents/base-agent.ts` - Added usage field to AgentTurn, import recordLlmUsage, accumulation logic, and recording before returns
- `src/agents/claude-trader.ts` - Extract response.usage from Anthropic response
- `src/agents/openai-compatible-utils.ts` - Extract response.usage from OpenAI response

## Decisions Made
- **Backward compatibility**: Made `usage` field optional on AgentTurn interface so existing code doesn't break
- **Error handling**: Used `.catch()` pattern for recording to avoid failing the trading decision if DB write fails
- **Centralized recording**: All recording goes through single `recordUsage` helper to ensure consistent error handling

## Deviations from Plan

### Task 1 Already Complete
- **Found during:** Initial execution
- **Issue:** Schema and service files already existed from prior heartbeat session
- **Resolution:** Verified existing implementation matched plan requirements, proceeded to Task 2
- **Impact:** None - work was already done correctly

---

**Total deviations:** 1 minor (Task 1 already complete)
**Impact on plan:** No negative impact - prior session had already implemented the schema and service

## Issues Encountered
- Database migration took ~2 minutes to complete (normal for a database with many tables)
- All TypeScript compilation passed cleanly

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Token usage now captured from every LLM API call
- Data available in llm_usage table for analysis
- Ready for 09-02: Cost analysis and visualization features

---
*Phase: 09-ongoing-improvement*
*Completed: 2026-02-05*
