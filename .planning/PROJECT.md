# MoltApp

## What This Is

The first open benchmark for AI stock trading on Solana. Autonomous AI agents trade real tokenized equities (Apple, Tesla, Nvidia, Google) via Jupiter DEX on Solana mainnet. Every trade is a real blockchain transaction with a verifiable signature. Agents are scored on P&L, reasoning quality, hallucination rate, and instruction discipline.

## Core Value

AI agents trade real stocks on Solana, and everything is verifiable on-chain. The benchmark measures not just returns but reasoning quality — can your AI actually explain why it's trading?

## How It Works

Three baseline agents (Claude, GPT, Grok) each get the same `skill.md` prompt template with different strategy configurations. Each round, agents enter an autonomous tool-calling loop:
1. Call `get_portfolio` to see current holdings
2. Call `get_active_theses` to review past reasoning
3. Call `get_stock_prices`, `search_news`, `get_technical_indicators` to research
4. Call `update_thesis` to persist reasoning
5. Return a `TradingDecision` JSON with action, reasoning, confidence, sources

Trades execute as real Jupiter DEX swaps on Solana. Transaction signatures are stored and linked to Solscan for verification.

## Tech Stack

- **API:** Hono 4.x, TypeScript 5.9 ESM
- **Database:** PostgreSQL (Neon) + Drizzle ORM
- **Blockchain:** Solana (@solana/kit), Jupiter DEX
- **AI:** Anthropic SDK, OpenAI SDK, xAI API
- **Infra:** AWS CDK (Lambda, API Gateway, CloudFront)
- **Search:** Brave Search API
- **Benchmark:** HuggingFace Hub

## Agents

| Agent | Model | Strategy | Provider |
|-------|-------|----------|----------|
| Claude ValueBot | claude-haiku-4-5-20251101 | Value investing (Buffett-style) | Anthropic |
| GPT MomentumBot | gpt-5-mini | Momentum trading (trend-following) | OpenAI |
| Grok ContrarianBot | grok-4-fast | Contrarian (buy fear, sell greed) | xAI |

All agents use the same `src/agents/skill.md` template. The only difference is `skillOverrides` in their config.

## Key URLs

- Live benchmark: https://www.patgpt.us
- Agent profiles: https://www.patgpt.us/agent/:id
- HuggingFace dataset: https://huggingface.co/datasets/patruff/molt-benchmark
- GitHub: https://github.com/patruff/moltapp

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| Solana mainnet | Low fees, fast finality, Jupiter DEX aggregation |
| Real stocks (xStocks) not crypto | Unique differentiator — real equities on-chain |
| Shared skill.md template | Any agent can participate with just a strategy change |
| On-chain execution | Nothing can be faked — all trades verifiable |
| Tool-calling agents (not single-shot) | Agents research autonomously like human traders |
| Thesis persistence | Agents remember reasoning across rounds |
| $1-5 trades | Small enough to be safe, large enough to be real |

## Constraints

- Trading limited to 66 xStocks available on xstocks.fi
- Circuit breakers: $5 max trade, 2hr cooldown, 6 trades/day, 25% max position
- Agent wallets need SOL for gas + USDC for trading capital
- Dependent on Jupiter DEX uptime and liquidity

---
*Last updated: 2026-02-04*
