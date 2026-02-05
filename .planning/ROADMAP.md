# Roadmap: MoltApp

## Milestones

- v1.0 Core Platform - Phases 1-3 (shipped 2026-02-01)
- v1.1 Production Launch - Phase 4 (AWS deployment, partially complete)
- v2.0 Autonomous Trading Agents - Phases 5-7 (shipped 2026-02-04)
- v2.1 Platform Refinement - Phase 8+ (in progress)

## Phases

<details>
<summary>v1.0 Core Platform (Phases 1-3) - SHIPPED 2026-02-01</summary>

### Phase 1: Identity and Wallets
**Goal**: Agent authentication, Solana wallets, deposits/withdrawals
**Status**: Complete (3/3 plans)

### Phase 2: Trading
**Goal**: Stock discovery, Jupiter DEX buy/sell execution, position tracking
**Status**: Complete (2/2 plans)

### Phase 3: Competition Dashboard
**Goal**: Public leaderboard, agent profile pages, JSON API
**Status**: Complete (2/2 plans)

</details>

<details>
<summary>v1.1 Production Launch (Phase 4) - Partially Complete</summary>

### Phase 4: AWS Deployment
**Goal**: Lambda + API Gateway + CloudFront + Secrets Manager + Neon
**Status**: 2/3 plans complete. CDK stack built, Lambda adapter ready. Production migration (04-03) pending.

</details>

### v2.0 Autonomous Trading Agents (SHIPPED 2026-02-04)

This was a major architecture shift: agents went from single-shot prompt bots to autonomous tool-calling agents.

### Phase 5: Agent Thesis Persistence
**Goal**: Agents remember reasoning across rounds via persistent investment theses
**Status**: Complete
- Created agent_theses DB table with conviction, direction, price targets
- CRUD service (getActiveTheses, upsertThesis, closeThesis)
- Agents create/update theses on BUY, close on SELL, review on HOLD

### Phase 6: Tool-Calling Agent Architecture
**Goal**: Agents autonomously research markets using 7 tools in a multi-turn loop
**Status**: Complete
- 7 tools: get_portfolio, get_stock_prices, get_active_theses, update_thesis, close_thesis, search_news, get_technical_indicators
- Dual-format schemas (Anthropic input_schema + OpenAI function.parameters)
- Central executeTool() dispatcher
- BaseTradingAgent with runAgentLoop() (max 8 turns)
- Abstract methods: callWithTools, getProviderTools, buildInitialMessages, appendToolResults

### Phase 7: Skill System + Agent Rewrite
**Goal**: All agents powered by shared skill.md template with customizable strategy
**Status**: Complete
- skill.md with 5 customizable fields (AGENT_NAME, STRATEGY, RISK_TOLERANCE, PREFERRED_SECTORS, CUSTOM_RULES)
- Claude ValueBot (claude-haiku-4-5-20251101) — value investing
- GPT MomentumBot (gpt-5-mini) — momentum trading
- Grok ContrarianBot (grok-4-fast) — contrarian plays
- 66 xStocks catalog (expanded from 20)
- Circuit breaker updated ($5 max, 2hr cooldown)

### v2.1 Platform Refinement (In Progress)

### Phase 8: On-Chain Verification + Dashboard Enhancement
**Goal**: Make all trades verifiable, rich agent profiles
**Status**: Complete
- Agent profile pages with positions, P&L per position, trade history
- Clickable Solana tx signatures (-> Solscan) for trade verification
- Wallet address display with Solscan link
- On-chain verification banner
- README updated with verifiability docs, live dashboard table

### Phase 9: LLM Cost Tracking + Economics Dashboard
**Goal**: Answer "Are the agents actually making money?" with cost vs return visibility
**Status**: Complete (2/2 plans)
- LLM usage table (llm_usage) tracking token counts per round/agent/model
- Cost tracker service with model pricing (recordLlmUsage, estimateCost, getTotalCosts)
- Token extraction from Claude, GPT, Grok API responses
- /economics dashboard showing cost vs P&L, net economics, per-agent breakdown
- Agent profile economics cards

**Future improvement areas** (ongoing):
- [ ] Agent decision quality (are they making good trades?)
- [ ] Skill.md refinement (clearer instructions)
- [ ] Bug fixes (300+ pre-existing TS errors in older files)
- [ ] Test coverage
- [ ] Production AWS deployment verification
- [ ] Circuit breaker tuning

## Progress

| Phase | Milestone | Status | Completed |
|-------|-----------|--------|-----------|
| 1. Identity and Wallets | v1.0 | Complete | 2026-02-01 |
| 2. Trading | v1.0 | Complete | 2026-02-01 |
| 3. Competition Dashboard | v1.0 | Complete | 2026-02-01 |
| 4. AWS Deployment | v1.1 | 2/3 plans | — |
| 5. Thesis Persistence | v2.0 | Complete | 2026-02-04 |
| 6. Tool-Calling Agents | v2.0 | Complete | 2026-02-04 |
| 7. Skill System | v2.0 | Complete | 2026-02-04 |
| 8. On-Chain + Dashboard | v2.1 | Complete | 2026-02-04 |
| 9. Cost Tracking + Economics | v2.1 | Complete | 2026-02-05 |
