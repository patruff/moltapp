# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-04)

**Core value:** Open benchmark for AI stock trading — autonomous agents trade real tokenized equities on Solana mainnet, scored on P&L + reasoning quality. Every trade is on-chain and verifiable.

**Current focus:** Platform improvement — agent trading quality, benchmark accuracy, skill prompt refinement.

## Current Position

Phase: 09-ongoing-improvement
Plan: 01 of 2 (LLM Token Usage Tracking) - COMPLETE
Status: Ready for plan 02

Progress: [========--] 50% (plan 01 complete)

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
- **NEW: LLM token usage tracking with cost estimation (llm_usage table)**

Last activity: 2026-02-05 — Completed 09-01-PLAN.md (LLM token usage tracking)

## Architecture Summary

```
Agents (Claude/GPT/Grok) → skill.md prompt → Tool-calling loop (max 15 turns)
  → get_portfolio, get_stock_prices, search_news, get_technical_indicators
  → update_thesis (persist reasoning across rounds)
  → Return TradingDecision JSON
  → Circuit breaker checks → Jupiter DEX swap → Solana tx signature stored
  → Benchmark scoring (40+ dimensions) → Leaderboard + HuggingFace
  → **LLM usage recorded to llm_usage table with cost estimation**
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
- [x] **LLM token usage tracking (llm_usage table, llm-cost-tracker service)**

### Dashboard & API
- [x] Leaderboard page (/) — agents ranked by P&L %
- [x] Agent profile page (/agent/:id) — positions, trade history, Solana tx links, wallet address
- [x] Agent API — /api/v1/agents, /api/v1/agents/:id, /api/v1/agents/:id/portfolio, /api/v1/agents/:id/trades
- [x] Benchmark submission API — external agents can submit trades for scoring
- [x] Brain feed — live agent reasoning stream
- [x] 40+ benchmark scoring dimensions

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
| 2026-02-05 | Usage field optional on AgentTurn | Backward compatibility with existing code |
| 2026-02-05 | Model pricing in service not DB | Simpler to update pricing without migrations |
| 2026-02-05 | recordUsage with .catch() pattern | Don't fail trading if DB write fails |

## What Needs Improvement

- Agent trading quality (are agents making good decisions?)
- Skill.md prompt refinement (better instructions = better trades)
- Agent profile pages (could show reasoning quality, thesis history)
- Circuit breaker tuning (are limits too tight or too loose?)
- Bug fixes in pre-existing TypeScript errors (300+ in older files)
- Test coverage (currently no automated tests running)
- Live deployment verification (production AWS deploy pending)
- **Cost analysis visualization (09-02-PLAN.md ready)**

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
Stopped at: Completed 09-01-PLAN.md (LLM token usage tracking)
Resume file: .planning/phases/09-ongoing-improvement/09-02-PLAN.md

Changes this session:
- Added usage field to AgentTurn interface
- Implemented usage extraction from Anthropic API
- Implemented usage extraction from OpenAI-compatible APIs
- Integrated usage recording into runAgentLoop
- Pushed llm_usage schema to database

Next steps:
- Execute 09-02-PLAN.md (cost analysis and visualization)
- Monitor token usage data being collected
- Run trading rounds to accumulate usage data
