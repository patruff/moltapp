# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-04)

**Core value:** Open benchmark for AI stock trading — autonomous agents trade real tokenized equities on Solana mainnet, scored on P&L + reasoning quality. Every trade is on-chain and verifiable.

**Current focus:** Platform improvement — agent trading quality, benchmark accuracy, skill prompt refinement.

## Current Position

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

Last activity: 2026-02-04 — Rewrote heartbeat.sh to focus on trading + improvement, updated skill.md with on-chain context, enhanced agent profile pages.

## Architecture Summary

```
Agents (Claude/GPT/Grok) → skill.md prompt → Tool-calling loop (max 8 turns)
  → get_portfolio, get_stock_prices, search_news, get_technical_indicators
  → update_thesis (persist reasoning across rounds)
  → Return TradingDecision JSON
  → Circuit breaker checks → Jupiter DEX swap → Solana tx signature stored
  → Benchmark scoring (40+ dimensions) → Leaderboard + HuggingFace
```

## What's Built

### Core Trading
- [x] Autonomous tool-calling agent loop (base-agent.ts runAgentLoop)
- [x] Shared skill.md prompt template with 5 customizable fields
- [x] Claude ValueBot (claude-haiku-4-5-20251101) — value investing strategy
- [x] GPT MomentumBot (gpt-5-mini) — momentum/trend following
- [x] Grok ContrarianBot (grok-4-fast) — contrarian mean-reversion
- [x] 7 trading tools with dual-format schemas (Anthropic + OpenAI)
- [x] Investment thesis persistence (agent_theses table, CRUD service)
- [x] 66 xStocks catalog (all verified from xstocks.fi)
- [x] Circuit breaker: $5 max trade, 2hr cooldown, 6/day, 25% position limit
- [x] Jupiter DEX integration (Ultra API, order + execute)
- [x] On-chain trade execution with Solana tx signatures

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

## What Needs Improvement

- Agent trading quality (are agents making good decisions?)
- Skill.md prompt refinement (better instructions = better trades)
- Agent profile pages (could show reasoning quality, thesis history)
- Circuit breaker tuning (are limits too tight or too loose?)
- Bug fixes in pre-existing TypeScript errors (300+ in older files)
- Test coverage (currently no automated tests running)
- Live deployment verification (production AWS deploy pending)

## Performance Metrics

| Agent | Model | Strategy | Status |
|-------|-------|----------|--------|
| Claude ValueBot | claude-haiku-4-5-20251101 | Value investing | Active |
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

Last session: 2026-02-04
Changes this session:
- Rewrote heartbeat.sh from engagement-focused to trading/improvement-focused
- Updated skill.md with on-chain settlement context
- Enhanced agent profile pages with positions, trade history, Solana tx links
- Updated README with on-chain verifiability section and live dashboard docs
- Fixed stock count consistency (66 xStocks)
- Reset heartbeat state for clean tracking

Next steps:
- Run the overnight heartbeat and verify agents are trading well
- Monitor agent decision quality and adjust skill.md as needed
- Fix pre-existing TypeScript errors in older route files
- Verify production deployment works end-to-end
