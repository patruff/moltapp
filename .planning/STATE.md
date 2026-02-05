# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-04)

**Core value:** Open benchmark for AI stock trading — autonomous agents trade real tokenized equities on Solana mainnet, scored on P&L + reasoning quality. Every trade is on-chain and verifiable.

**Current focus:** Platform improvement — agent trading quality, benchmark accuracy, skill prompt refinement.

## Current Position

Phase: 10-agent-decision-quality
Plan: 02 of 3 (Decision Quality Dashboard) - COMPLETE
Status: In progress

Progress: [======----] 67% (2 of 3 plans complete)

Platform is fully operational. All core systems built and running:
- 3 autonomous tool-calling agents (Claude, GPT, Grok) with shared skill.md
- 66 xStocks tradeable via Jupiter DEX on Solana mainnet
- 7 agent tools (get_portfolio, get_stock_prices, get_active_theses, update_thesis, close_thesis, search_news, get_technical_indicators)
- Investment thesis persistence across rounds (agent_theses table)
- Circuit breaker system ($5 max, 2hr cooldown, 6/day limit)
- On-chain trade execution with verifiable Solana transaction signatures
- Rich agent profile pages with positions, P&L, tx links to Solscan
- Benchmark submission API for external agents
- HuggingFace dataset sync
- Overnight heartbeat running trading rounds every 2 hours
- LLM token usage tracking with cost estimation (llm_usage table)
- /economics dashboard showing cost vs trading returns
- **NEW: Tool use quality analyzer (validates agent tool-calling patterns)**
- **NEW: Decision quality snapshots schema (stores composite quality metrics)**
- **NEW: Decision quality dashboard service (aggregates all 5 quality services)**

Last activity: 2026-02-05 — Completed 10-02-PLAN.md (Decision Quality Dashboard)

## Architecture Summary

```
Agents (Claude/GPT/Grok) → skill.md prompt → Tool-calling loop (max 15 turns)
  → get_portfolio, get_stock_prices, search_news, get_technical_indicators
  → update_thesis (persist reasoning across rounds)
  → Return TradingDecision JSON
  → Circuit breaker checks → Jupiter DEX swap → Solana tx signature stored
  → Benchmark scoring (40+ dimensions) → Leaderboard + HuggingFace
  → LLM usage recorded to llm_usage table with cost estimation
  → /economics dashboard shows ROI and per-agent cost breakdown
  → **Tool use quality analyzer validates tool-calling patterns**
  → **Decision quality dashboard aggregates 5 quality services**
```

## What's Built

### Core Trading
- [x] Autonomous tool-calling agent loop (base-agent.ts runAgentLoop)
- [x] Shared skill.md prompt template with 5 customizable fields
- [x] Claude ValueBot (claude-opus-4-5-20251101) — flagship reasoning
- [x] GPT MomentumBot (gpt-5-mini) — momentum/trend following
- [x] Grok ContrarianBot (grok-4-fast) — contrarian mean-reversion
- [x] 7 trading tools with dual-format schemas (Anthropic + OpenAI)
- [x] Investment thesis persistence (agent_theses table, CRUD service)
- [x] 66 xStocks catalog (all verified from xstocks.fi)
- [x] Circuit breaker: $5 max trade, 2hr cooldown, 6/day, 25% position limit
- [x] Jupiter DEX integration (Ultra API, order + execute)
- [x] On-chain trade execution with Solana tx signatures
- [x] LLM token usage tracking (llm_usage table, llm-cost-tracker service)

### Dashboard & API
- [x] Leaderboard page (/) — agents ranked by P&L %
- [x] Agent profile page (/agent/:id) — positions, trade history, Solana tx links, wallet address, LLM economics
- [x] Economics dashboard (/economics) — LLM cost vs trading P&L, per-agent ROI
- [x] Agent API — /api/v1/agents, /api/v1/agents/:id, /api/v1/agents/:id/portfolio, /api/v1/agents/:id/trades
- [x] Benchmark submission API — external agents can submit trades for scoring
- [x] Brain feed — live agent reasoning stream
- [x] 40+ benchmark scoring dimensions

### Quality Analysis (Phase 10)
- [x] Tool use quality analyzer (src/services/tool-use-quality-analyzer.ts)
- [x] Decision quality snapshots schema (src/db/schema/decision-quality.ts)
- [x] Decision quality dashboard (src/services/decision-quality-dashboard.ts)

### Infrastructure
- [x] Hono 4.x API server
- [x] Drizzle ORM + PostgreSQL (Neon)
- [x] AWS CDK stack (Lambda, API Gateway, CloudFront, Secrets Manager)
- [x] Heartbeat.ts — trading round orchestrator
- [x] Heartbeat.sh — overnight automation (trading + improvement sessions)
- [x] HuggingFace dataset sync
- [x] README with full agent development guide, skill system docs, on-chain verification

## Decisions Made

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-02-05 | Tool sequence: portfolio first, theses early, prices before trading | Matches skill.md guidance for agent tool-calling patterns |
| 2026-02-05 | 3-level violation severity (low/medium/high) | Allows weighted scoring - missing prices is worse than late thesis call |
| 2026-02-05 | Grade thresholds: A+ >= 0.95, A >= 0.9, etc. | Matches existing calibration analyzer grading for consistency |
| 2026-02-05 | Usage field optional on AgentTurn | Backward compatibility with existing code |
| 2026-02-05 | Model pricing in service not DB | Simpler to update pricing without migrations |
| 2026-02-05 | recordUsage with .catch() pattern | Don't fail trading if DB write fails |
| 2026-02-05 | Used getAgentConfig for model lookup | LeaderboardEntry lacks model field |
| 2026-02-05 | Economics card conditional on totalTokens > 0 | Avoid empty state when no usage data |
| 2026-02-05 | Dimension weights: calibration 20%, integrity 20%, accountability 20%, memory 15%, tool-use 25% | Tool use weighted highest as correct patterns are critical |
| 2026-02-05 | Calibration score = 1 - ECE | Makes calibration directionally consistent with other scores |
| 2026-02-05 | Default score 0.5 for missing data | New agents get neutral score, not failure |

## What Needs Improvement

- Agent trading quality (are agents making good decisions?)
- Skill.md prompt refinement (better instructions = better trades)
- Circuit breaker tuning (are limits too tight or too loose?)
- Bug fixes in pre-existing TypeScript errors (300+ in older files)
- Test coverage (currently no automated tests running)
- Live deployment verification (production AWS deploy pending)

## Performance Metrics

| Agent | Model | Strategy | Status |
|-------|-------|----------|--------|
| Opus 4.5 | claude-opus-4-5-20251101 | Flagship reasoning | Active |
| GPT MomentumBot | gpt-5-mini | Momentum | Active |
| Grok ContrarianBot | grok-4-fast | Contrarian | Active |

## Overnight Heartbeat

The heartbeat.sh script runs every 2 hours and:
1. Runs a trading round (all 3 agents analyze market and make decisions)
2. Checks agent health (portfolio values, positions, cash)
3. Runs TypeScript health check
4. Launches autonomous improvement session (Claude Code fixes bugs, improves code)
5. Pushes changes to GitHub

## Session Continuity

Last session: 2026-02-05
Stopped at: Completed 10-02-PLAN.md (Decision Quality Dashboard)
Resume file: None

Changes this session:
- Created decision-quality-dashboard service (aggregates all 5 quality services)
- Implements generateDecisionQualityReport, storeQualitySnapshot, getLatestQualitySnapshot
- Added generateAllQualityReports for batch processing
- Weighted composite scoring with research-backed weights
- TypeScript compilation: 0 errors

Next steps:
- Execute 10-03-PLAN.md (Quality API Route)
- Expose quality dashboard via API endpoint
- Add quality metrics to agent profile page
