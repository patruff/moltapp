# Phase 9: Ongoing Improvement - Research

**Researched:** 2026-02-05
**Domain:** AI Trading Benchmark Observability and Cost Tracking
**Confidence:** HIGH (based on direct codebase analysis)

## Summary

This research answers the core question: **"Are the agents actually making money?"**

MoltApp has extensive P&L tracking infrastructure already in place, but lacks LLM cost visibility. The codebase has:
- Strong P&L tracking: `portfolio_snapshots`, `trades`, `positions`, `benchmark_snapshots` tables
- Good decision visibility: `trade_justifications` with full reasoning, tool traces, confidence scores
- Thesis accountability: `agent_theses` with entry/target prices, exit outcome badges (added Session 38)
- Recent UI additions: `/rounds` timeline, `/round/:id` detail pages (Session 37)

**Key gap:** LLM API costs are NOT tracked anywhere. Token usage data is returned by both Anthropic and OpenAI APIs but is completely ignored in the codebase. This makes it impossible to answer "Is the benchmark economically viable?"

**Primary recommendation:** Add LLM cost tracking by capturing token usage from API responses, then build a cost vs return dashboard to show profitability.

## Current State Analysis

### What Exists (HIGH confidence - verified in codebase)

#### 1. P&L Tracking
| Component | Location | Data Captured |
|-----------|----------|---------------|
| `portfolio_snapshots` | `src/db/schema/portfolio-snapshots.ts` | Cash, positions value, total value, P&L, P&L % per round |
| `trades` | `src/db/schema/trades.ts` | Every executed trade with price, quantity, tx signature |
| `positions` | `src/db/schema/positions.ts` | Current holdings, average cost basis |
| `benchmark_snapshots` | `src/db/schema/trade-reasoning.ts` | Period aggregates (P&L %, Sharpe, win rate) |

#### 2. Decision Visibility
| Component | Location | Data Captured |
|-----------|----------|---------------|
| `trade_justifications` | `src/db/schema/trade-reasoning.ts` | Full reasoning, confidence, tool trace, sources, coherence score |
| `agent_decisions` | `src/db/schema/agent-decisions.ts` | Action, symbol, quantity, reasoning, model used |
| `/rounds` UI | `src/routes/pages.tsx:817-927` | Last 20 rounds grouped by roundId, truncated reasoning |
| `/round/:id` UI | `src/routes/pages.tsx:933-1137` | Full reasoning, tool trace, benchmark scores |

#### 3. Thesis Accountability
| Component | Location | Data Captured |
|-----------|----------|---------------|
| `agent_theses` | `src/db/schema/agent-theses.ts` | Symbol, thesis text, conviction, direction, entry/target price, status |
| Exit badges | `src/routes/pages.tsx:572-661` | TARGET_HIT, STOPPED_OUT, PROFITABLE, LOSS with P&L % |
| Win rate | `src/routes/pages.tsx:504-559` | Calculated from closed theses with trade data |

#### 4. Performance Metrics
| Service | Location | Metrics |
|---------|----------|---------|
| `performance-tracker.ts` | `src/services/` | Sharpe, Sortino, Calmar, max drawdown, win rate, volatility |
| `portfolio-snapshots.ts` | `src/services/` | Equity curve, drawdown analysis, timeline |
| `leaderboard.ts` | `src/services/` | Ranked comparison across all agents |

### What's Missing (HIGH confidence)

#### 1. LLM Cost Tracking (CRITICAL GAP)
**Current state:** Zero cost tracking exists.

In `claude-trader.ts:113-120`:
```typescript
const response = await client.messages.create({
  model: this.config.model,
  max_tokens: 16000,
  // ...
});
// response.usage contains input_tokens, output_tokens - IGNORED
```

In `openai-compatible-utils.ts:135`:
```typescript
const response = await client.chat.completions.create(requestParams);
return parseOpenAIResponse(response);
// response.usage contains prompt_tokens, completion_tokens - IGNORED
```

**Impact:** Cannot answer:
- How much does each trading round cost?
- What's the cost per agent per decision?
- Is the total LLM spend profitable vs P&L generated?

#### 2. Cost vs Return Dashboard
No dashboard shows LLM spend vs trading returns. The existing `/rounds` UI shows decisions but not costs.

#### 3. Trade Audit Trail (Partial)
The decision -> trade -> outcome chain exists but requires manual SQL joins:
- `trade_justifications.tradeId` links to `trades.id`
- `trades.txSignature` proves execution
- No single view shows: "Decision made -> Trade executed -> Outcome measured"

## Gaps for "Are Agents Making Money?"

| Question | Current Answer | Gap |
|----------|---------------|-----|
| What's total P&L? | YES - `portfolio_snapshots.totalPnl` | None |
| What's LLM cost? | NO | No token tracking |
| Cost vs Return? | NO | Need cost + P&L comparison |
| Per-round visibility? | PARTIAL - `/rounds` shows decisions | Missing cost per round |
| Per-agent breakdown? | YES - agent profile pages | Missing cost per agent |
| Thesis success rate? | YES - win rate badge | None |
| Why did agent decide? | YES - full reasoning in `/round/:id` | None |

## Recommended Improvements (Prioritized)

### Priority 1: LLM Cost Tracking (HIGH impact, MEDIUM effort)

**What:** Capture token usage from API responses, store in DB, display costs.

**Schema addition:**
```typescript
// New table: llm_usage
export const llmUsage = pgTable("llm_usage", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  roundId: text("round_id").notNull(),
  agentId: text("agent_id").notNull(),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull(),
  outputTokens: integer("output_tokens").notNull(),
  totalTokens: integer("total_tokens").notNull(),
  estimatedCostUsd: numeric("estimated_cost_usd", { precision: 10, scale: 6 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

**Files to modify:**
- `src/agents/claude-trader.ts` - Extract `response.usage` after API call
- `src/agents/openai-compatible-utils.ts` - Extract usage from response
- `src/agents/base-agent.ts` - Add usage to `AgentTurn` type
- New: `src/services/llm-cost-tracker.ts` - Cost calculation and storage

**Cost estimation formulas (as of Feb 2026):**
- Claude Opus 4.5: $15/M input, $75/M output
- GPT-5.2: $10/M input, $30/M output
- Grok-3: $5/M input, $15/M output

### Priority 2: Cost vs Return Dashboard (HIGH impact, LOW effort)

**What:** New `/economics` page showing:
- Total LLM spend (cumulative and per-round)
- Total trading P&L
- Net economic result (P&L minus costs)
- Per-agent breakdown
- Time-series chart of cost vs return

**Implementation:**
- Add route to `src/routes/pages.tsx`
- Query `llm_usage` aggregated by agent
- Query `portfolio_snapshots` for P&L
- Simple table + chart showing profitability

### Priority 3: Decision Audit Trail View (MEDIUM impact, LOW effort)

**What:** Single-page view showing decision -> trade -> outcome for any round.

**Current flow requires manual joins:**
```sql
-- Need to trace manually:
SELECT tj.*, t.*, ps.*
FROM trade_justifications tj
LEFT JOIN trades t ON tj.trade_id = t.id
LEFT JOIN portfolio_snapshots ps ON ps.round_id = tj.round_id
WHERE tj.round_id = 'round_xxx';
```

**Enhancement:** Add to `/round/:id` page:
- Show linked trade execution (if any)
- Show portfolio delta from that round
- Show outcome (profit/loss on that trade)

### Priority 4: Aggregate Metrics Summary (LOW impact, LOW effort)

**What:** Homepage KPI cards showing:
- Total P&L across all agents
- Best/worst performing agent
- Total trading rounds completed
- Average confidence vs actual outcome

**Implementation:**
- Add summary section to `src/routes/pages.tsx` homepage
- Query `benchmark_snapshots` for aggregate metrics

## Implementation Notes

### Key Files

| Purpose | File | Notes |
|---------|------|-------|
| Main UI | `src/routes/pages.tsx` | Add new routes here |
| Agent decisions | `src/agents/orchestrator.ts` | Where token usage would be captured |
| Claude API | `src/agents/claude-trader.ts` | `response.usage` ignored |
| OpenAI API | `src/agents/openai-compatible-utils.ts` | `response.usage` ignored |
| P&L queries | `src/services/performance-tracker.ts` | Existing metric computation |
| Snapshots | `src/services/portfolio-snapshots.ts` | Historical P&L data |

### Patterns to Follow

**Existing pattern for DB tables:**
```typescript
// Schema in src/db/schema/*.ts
export const newTable = pgTable("new_table", { ... });

// Export in src/db/schema/index.ts
export * from "./new-table.ts";
```

**Existing pattern for services:**
```typescript
// Service in src/services/*.ts
export async function getMetrics() { ... }
export function computeSomething() { ... }
```

**Existing UI pattern:**
```typescript
// Route in src/routes/pages.tsx
pages.get("/new-page", async (c) => {
  const data = await fetchData();
  return c.render(<Component data={data} />, { title: "Page Title - MoltApp" });
});
```

### API Response Structures

**Anthropic (Claude) - response.usage:**
```typescript
{
  input_tokens: number;
  output_tokens: number;
}
```

**OpenAI (GPT/Grok) - response.usage:**
```typescript
{
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}
```

## Common Pitfalls

### Pitfall 1: Cost Estimation Drift
**What goes wrong:** Hardcoded token prices become stale as providers change pricing.
**Prevention:** Store raw token counts, calculate costs at display time with configurable rates. Include `pricing_version` field.

### Pitfall 2: Missing Rounds
**What goes wrong:** Round fails before recording, data gap in timeline.
**Prevention:** Record LLM usage immediately after API call, before any downstream processing. Use try/catch with fallback logging.

### Pitfall 3: Multi-Turn Token Accumulation
**What goes wrong:** Agent tool-calling loop makes multiple API calls per decision, only last call's usage captured.
**Prevention:** Accumulate usage across all turns in the agent's analyze() loop, store total.

## Code Examples

### Capturing Claude Token Usage
```typescript
// In claude-trader.ts callWithTools()
const response = await client.messages.create({ ... });

// Extract usage
const usage = {
  inputTokens: response.usage?.input_tokens ?? 0,
  outputTokens: response.usage?.output_tokens ?? 0,
};

return {
  toolCalls,
  textResponse,
  stopReason,
  usage, // New field
};
```

### Capturing OpenAI Token Usage
```typescript
// In openai-compatible-utils.ts parseOpenAIResponse()
export function parseOpenAIResponse(response: ChatCompletion): AgentTurn {
  // ... existing parsing ...

  return {
    toolCalls,
    textResponse: msg.content ?? null,
    stopReason,
    usage: response.usage ? {
      inputTokens: response.usage.prompt_tokens,
      outputTokens: response.usage.completion_tokens,
    } : undefined,
  };
}
```

### Cost Calculation Helper
```typescript
// In new src/services/llm-cost-tracker.ts
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4-5-20251101": { input: 15, output: 75 }, // per million tokens
  "gpt-5.2-mini": { input: 10, output: 30 },
  "grok-3-beta": { input: 5, output: 15 },
};

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model] ?? { input: 10, output: 30 }; // fallback
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}
```

## Open Questions

1. **Historical Backfill**
   - What we know: No historical token usage data exists
   - What's unclear: Should we estimate historical costs based on reasoning length?
   - Recommendation: Start tracking now, don't backfill (inaccurate estimation)

2. **Extended Thinking Costs**
   - What we know: Claude Opus 4.5 uses extended thinking (temperature=1)
   - What's unclear: Does extended thinking change token billing?
   - Recommendation: Verify with Anthropic docs before finalizing cost model

3. **Tool Result Tokens**
   - What we know: Tool results are sent back as user messages
   - What's unclear: Are tool result tokens billed as input tokens?
   - Recommendation: Yes, treat tool results as input tokens (standard billing)

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis of `/Users/patruff/moltapp/src/`
- `src/db/schema/*.ts` - All table definitions verified
- `src/routes/pages.tsx` - UI structure confirmed
- `src/agents/*.ts` - Agent implementation reviewed

### Model Pricing (MEDIUM confidence)
- Based on Claude Code training data (May 2025)
- Prices may have changed - verify with official pricing pages before implementation

## Metadata

**Confidence breakdown:**
- Current state analysis: HIGH - Direct code verification
- Gap analysis: HIGH - Explicit search for missing features
- Implementation approach: HIGH - Follows existing patterns
- Cost pricing: MEDIUM - May need verification

**Research date:** 2026-02-05
**Valid until:** 14 days (fast-moving domain, pricing may change)
