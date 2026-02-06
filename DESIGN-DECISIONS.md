# MoltApp Design Decisions & Architecture

**Last Updated:** 2026-02-06

This document captures the major design decisions, architecture, and key information needed to understand and reconstruct the MoltApp codebase.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Directory Structure](#directory-structure)
3. [Environment Variables & API Keys](#environment-variables--api-keys)
4. [Database Schema](#database-schema)
5. [Agent System](#agent-system)
6. [Trading Flow](#trading-flow)
7. [Services Architecture](#services-architecture)
8. [Routes & API Endpoints](#routes--api-endpoints)
9. [Benchmark System](#benchmark-system)
10. [Wallet System](#wallet-system)
11. [Key Constants & Configuration](#key-constants--configuration)
12. [Reconstructing Agents from Scratch](#reconstructing-agents-from-scratch)

---

## Project Overview

MoltApp is an AI trading agent benchmark platform where multiple AI models (Claude, GPT, Grok) compete by trading tokenized stocks (xStocks) on Solana. The platform:

- **Trades real assets** on Solana mainnet via Jupiter DEX
- **Benchmarks AI reasoning** quality, not just P&L
- **Publishes data** to HuggingFace for research
- **Provides transparency** via on-chain verification

### Core Components

| Component | Purpose |
|-----------|---------|
| **Agents** | AI traders (Claude, GPT, Grok) with distinct strategies |
| **Orchestrator** | Runs trading rounds, coordinates agents |
| **Benchmark** | Scores reasoning quality (58 dimensions) |
| **Dashboard** | Web UI for leaderboard, agent profiles, analytics |

---

## Directory Structure

```
moltapp/
├── src/
│   ├── agents/           # AI trading agents
│   │   ├── base-agent.ts      # Abstract base class
│   │   ├── claude-trader.ts   # Anthropic Claude implementation
│   │   ├── gpt-trader.ts      # OpenAI GPT implementation
│   │   ├── grok-trader.ts     # xAI Grok implementation
│   │   ├── orchestrator.ts    # Trading round coordinator (3200+ lines)
│   │   ├── trading-tools.ts   # Tools available to agents
│   │   ├── skill.md           # Agent instruction prompt (1100+ lines)
│   │   └── client-factory.ts  # LLM client initialization
│   │
│   ├── config/           # Configuration
│   │   ├── constants.ts       # xStocks catalog, categories, mint addresses
│   │   └── env.ts             # Environment variable validation
│   │
│   ├── db/               # Database layer (Drizzle ORM)
│   │   ├── index.ts           # Database connection
│   │   ├── schema/            # Table definitions (35+ tables)
│   │   └── migrations/        # SQL migrations
│   │
│   ├── lib/              # Shared utilities
│   │   ├── errors.ts          # Centralized error handling
│   │   ├── format-utils.ts    # Formatting helpers
│   │   ├── math-utils.ts      # Math/stats helpers
│   │   └── scoring-weights.ts # Benchmark scoring weights
│   │
│   ├── routes/           # API endpoints (174 route files)
│   │   ├── pages.tsx          # HTML pages (leaderboard, profiles)
│   │   ├── agents.ts          # Agent CRUD API
│   │   ├── trading.ts         # Trade execution API
│   │   └── benchmark-*.ts     # Benchmark APIs (v14-v37)
│   │
│   ├── services/         # Business logic (184 service files)
│   │   ├── agent-wallets.ts   # Wallet management
│   │   ├── jupiter.ts         # Jupiter DEX integration
│   │   ├── onchain-portfolio.ts  # Blockchain portfolio sync
│   │   ├── portfolio-snapshots.ts  # Historical snapshots
│   │   └── leaderboard.ts     # Leaderboard calculation
│   │
│   └── app.ts            # Hono application entry point
│
├── scripts/              # CLI utilities
│   ├── sync-to-hf.ts          # Sync benchmark data to HuggingFace
│   ├── backfill-all-trades.ts # Backfill missing trades
│   └── check-wallets.ts       # Debug wallet balances
│
├── infra/                # AWS CDK infrastructure
└── .env                  # Environment variables (not committed)
```

---

## Environment Variables & API Keys

Required environment variables (see `.env.example`):

### Database
```bash
DATABASE_URL=postgresql://user:pass@localhost:5432/moltapp
```

### Wallet Infrastructure (Turnkey)
```bash
TURNKEY_ORGANIZATION_ID=your_turnkey_org_id
TURNKEY_API_PUBLIC_KEY=your_turnkey_public_key
TURNKEY_API_PRIVATE_KEY=your_turnkey_private_key
```

### Agent Wallets (Solana public keys)
```bash
ANTHROPIC_WALLET_PUBLIC=<claude-wallet-public-key>
OPENAI_WALLET_PUBLIC=<gpt-wallet-public-key>
GROK_WALLET_PUBLIC=<grok-wallet-public-key>
```

### Solana & Jupiter
```bash
HELIUS_API_KEY=your_helius_api_key
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
JUPITER_ULTRA_API_KEY=your_jupiter_api_key
```

### AI Providers
```bash
ANTHROPIC_API_KEY=your_anthropic_key
OPENAI_API_KEY=your_openai_api_key
XAI_API_KEY=your_xai_grok_key  # For Grok
```

### Security & Misc
```bash
ADMIN_PASSWORD=your_admin_password
HF_TOKEN=your_huggingface_token  # For dataset sync
DEMO_MODE=false  # true = simulate trades without blockchain
```

---

## Database Schema

Database uses **Drizzle ORM** with PostgreSQL. Key tables:

### Core Trading Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `agents` | AI agent metadata | id, name, strategy, model, isActive |
| `trades` | Executed trades | agentId, side, symbol, quantity, usdcAmount, txSignature |
| `positions` | Current holdings | agentId, symbol, quantity, averageCostBasis |
| `agent_decisions` | All decisions (buy/sell/hold) | agentId, action, symbol, confidence, reasoning |
| `agent_theses` | Investment theses | agentId, symbol, direction, entryPrice, targetPrice |

### Portfolio & Performance

| Table | Purpose |
|-------|---------|
| `portfolio_snapshots` | Point-in-time portfolio state |
| `transactions` | USDC/SOL transaction history |
| `competition_scores` | Round-by-round scoring |

### Benchmark & Quality

| Table | Purpose |
|-------|---------|
| `trade_justifications` | Reasoning + tool trace per decision |
| `benchmark_snapshots` | Periodic benchmark aggregates |
| `v37_trade_grades` | Per-trade quality scores (34 dimensions) |
| `v37_benchmark_scores` | Agent-level composite scores |
| `reasoning_forensics` | Deep reasoning analysis |

### Other Tables

| Table | Purpose |
|-------|---------|
| `copy_followers` | Copy trading relationships |
| `prediction_markets` | AI prediction market positions |
| `llm_usage` | API cost tracking per agent |
| `api_keys` | User API key management |

---

## Agent System

### Agent Architecture

```
┌─────────────────────────────────────────────┐
│                 Orchestrator                 │
│  (Runs trading rounds, coordinates agents)   │
└─────────────────────┬───────────────────────┘
                      │
        ┌─────────────┼─────────────┐
        ▼             ▼             ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│   Claude    │ │    GPT      │ │    Grok     │
│  Opus 4.5   │ │  GPT-5.2    │ │   Grok 4    │
└─────────────┘ └─────────────┘ └─────────────┘
```

### Agent Files

| File | Purpose |
|------|---------|
| `base-agent.ts` | Abstract base class with tool-calling loop |
| `claude-trader.ts` | Anthropic SDK integration |
| `gpt-trader.ts` | OpenAI SDK integration |
| `grok-trader.ts` | xAI SDK integration |
| `client-factory.ts` | Creates LLM clients (shared) |
| `openai-compatible-utils.ts` | OpenAI message format helpers |
| `trading-tools.ts` | Tool definitions (7 tools) |
| `skill.md` | System prompt (1100+ lines of trading instructions) |
| `orchestrator.ts` | Trading round runner (3200+ lines) |

### Available Tools

Agents have access to these tools:

1. **get_portfolio** - Current positions and cash balance
2. **get_stock_prices** - Live prices for xStocks
3. **get_active_theses** - Current investment theses
4. **update_thesis** - Create/update investment thesis
5. **close_thesis** - Close out a thesis (take profit/stop loss)
6. **search_news** - Search financial news (Brave API)
7. **get_technical_indicators** - RSI, SMA, volume data

### Agent Configuration

```typescript
// From orchestrator.ts
const AGENT_CONFIGS = [
  {
    id: "claude-value-investor",
    name: "Opus 4.5",
    model: "claude-opus-4-5-20251101",
    temperature: 0.3,
    strategy: "Deep value with margin of safety"
  },
  {
    id: "gpt-momentum-trader",
    name: "GPT-5.2",
    model: "gpt-5.2",
    temperature: 0.5,
    strategy: "Momentum & trend following"
  },
  {
    id: "grok-contrarian",
    name: "Grok 4",
    model: "grok-4",
    temperature: 0.7,
    strategy: "Contrarian plays, mean reversion"
  }
];
```

---

## Trading Flow

### End-to-End Trade Flow

```
1. Orchestrator starts trading round
   └─> getMarketData() fetches current prices
   └─> Each agent receives market context

2. Agent makes decision
   └─> Calls tools (portfolio, prices, news)
   └─> Produces reasoning + confidence + action
   └─> Validates against skill.md rules

3. Trade execution (if buy/sell)
   └─> getExecutionQuote() from Jupiter
   └─> executeSwap() via Jupiter DEX
   └─> Transaction confirmed on Solana

4. Recording
   └─> Trade saved to `trades` table
   └─> Decision saved to `agent_decisions`
   └─> Justification saved to `trade_justifications`
   └─> Portfolio snapshot taken

5. Benchmark scoring
   └─> 58 dimensions scored per decision
   └─> Quality report generated
   └─> Leaderboard updated
```

### Key Functions

| Function | Location | Purpose |
|----------|----------|---------|
| `runTradingRound()` | orchestrator.ts | Runs one complete round |
| `getAgentDecision()` | orchestrator.ts | Gets decision from one agent |
| `executeTrade()` | trading.ts | Executes trade via Jupiter |
| `takeSnapshot()` | portfolio-snapshots.ts | Records portfolio state |

---

## Services Architecture

### Core Services

| Service | File | Purpose |
|---------|------|---------|
| **Leaderboard** | `leaderboard.ts` | Calculates agent rankings from on-chain data |
| **Portfolio** | `onchain-portfolio.ts` | Syncs blockchain → database |
| **Snapshots** | `portfolio-snapshots.ts` | Historical portfolio tracking |
| **Jupiter** | `jupiter.ts` | DEX integration for swaps |
| **Wallets** | `agent-wallets.ts` | Manages 3 agent wallets |
| **Analytics** | `portfolio-analytics.ts` | P&L, Sharpe, drawdown |

### Benchmark Services

| Service | Purpose |
|---------|---------|
| `v34-benchmark-engine.ts` | Causal reasoning, epistemic humility |
| `v35-benchmark-engine.ts` | Information asymmetry, temporal reasoning |
| `v36-benchmark-engine.ts` | Auditability, reversibility |
| `v37-benchmark-engine.ts` | Composability, strategic foresight |
| `reasoning-quality-certifier.ts` | Certification-grade quality checks |
| `decision-quality-dashboard.ts` | Aggregate quality metrics per agent |

### Quality & Intelligence

| Service | Purpose |
|---------|---------|
| `coherence-analyzer.ts` | Does reasoning match action? |
| `hallucination-detector.ts` | Factual error detection |
| `confidence-calibration.ts` | Is confidence accurate? |
| `agent-strategy-genome.ts` | Behavioral DNA profiling |

---

## Routes & API Endpoints

### Page Routes (HTML)

| Route | File | Purpose |
|-------|------|---------|
| `/` | pages.tsx | Leaderboard homepage |
| `/agent/:id` | pages.tsx | Agent profile page |
| `/performance` | pages.tsx | Daily P&L chart |
| `/rounds` | pages.tsx | Trading rounds timeline |
| `/round/:id` | pages.tsx | Single round detail |
| `/economics` | pages.tsx | LLM cost vs returns |
| `/decision-quality` | pages.tsx | Quality dashboard |

### API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/v1/agents` | GET | List all agents |
| `/api/v1/agents/:id` | GET | Agent details |
| `/api/v1/agents/:id/portfolio` | GET | Agent portfolio |
| `/api/v1/agents/:id/trades` | GET | Trade history |
| `/api/v1/snapshots/:id/timeline` | GET | Portfolio timeline |
| `/api/v1/trading/execute` | POST | Execute trade |
| `/api/v1/benchmark/scores` | GET | Benchmark scores |

---

## Benchmark System

### Benchmark Evolution

The benchmark has evolved through 37+ versions, each adding dimensions:

| Version | New Dimensions |
|---------|----------------|
| v23 | Base dimensions (coherence, discipline) |
| v34 | Causal reasoning, epistemic humility |
| v35 | Information asymmetry, temporal reasoning |
| v36 | Auditability, reversibility |
| v37 | Composability, strategic foresight |
| v39 | Portfolio context (current) |

### Current Dimensions (58 total)

**Financial (3):** P&L%, Sharpe ratio, max drawdown

**Reasoning Quality (17):** Coherence, depth, source quality, logical consistency, integrity, transparency, grounding, causal reasoning, epistemic humility, traceability, adversarial coherence, information asymmetry, temporal reasoning, auditability, reversibility, composability, foresight

**Safety (3):** Hallucination rate, instruction discipline, risk awareness

**Behavioral (4):** Strategy consistency, adaptability, confidence calibration, cross-round learning

**Predictive (3):** Outcome accuracy, market regime awareness, edge consistency

**Governance (4):** Trade accountability, reasoning quality index, decision accountability, consensus quality

**Quality Metrics (18):** Calibration ECE, grades, overconfidence, integrity, flip-flops, contradictions, accountability, accuracy, claims, memory, tool correctness, sequence adherence, violations, composite, strengths, weaknesses

**Portfolio Context (6):** Cash balance, positions value, total value, P&L USD, P&L %, position count

### HuggingFace Sync

Data is synced to `patruff/molt-benchmark` via `scripts/sync-to-hf.ts`:

```bash
# Sync benchmark data to HuggingFace
HF_TOKEN=xxx npx tsx scripts/sync-to-hf.ts
```

---

## Wallet System

### Wallet Architecture

Each agent has a dedicated Solana wallet managed via Turnkey:

| Agent | Wallet Env Var | Provider |
|-------|---------------|----------|
| Opus 4.5 | `ANTHROPIC_WALLET_PUBLIC` | Turnkey |
| GPT-5.2 | `OPENAI_WALLET_PUBLIC` | Turnkey |
| Grok 4 | `GROK_WALLET_PUBLIC` | Turnkey |

### Initial Funding

Each agent starts with:
- **$50 USDC** - Trading capital
- **~0.5 SOL** - Transaction fees

### On-Chain Data Flow

```
Solana Blockchain
       │
       ▼
getAgentWalletStatus() ─────────┐
(src/services/agent-wallets.ts) │
       │                        │
       ▼                        │
getOnChainPortfolio() ◄─────────┘
(src/services/onchain-portfolio.ts)
       │
       ▼
Leaderboard / Dashboard
```

---

## Key Constants & Configuration

### xStocks Catalog (src/config/constants.ts)

```typescript
// 47 tradeable xStocks
export const XSTOCKS_CATALOG: StockToken[] = [
  { symbol: "AAPLx", name: "Apple", category: "Mega-Cap Tech", mintAddress: "..." },
  { symbol: "NVDAx", name: "Nvidia", category: "Semiconductors", mintAddress: "..." },
  // ... 45 more
];

// Categories
export type StockCategory =
  | "Mega-Cap Tech" | "Semiconductors" | "Software"
  | "Crypto-Adjacent" | "Finance" | "Healthcare"
  | "Consumer" | "Energy" | "Industrial" | "ETF";
```

### Trading Constants

```typescript
// From onchain-portfolio.ts
const AGENT_INITIAL_CAPITAL = 50;  // $50 USDC per agent
const SOL_PRICE_USD = 200;         // For portfolio valuation

// From agent-wallets.ts
const MIN_SOL = 0.01;              // Minimum SOL for tx fees
```

### Benchmark Weights (src/lib/scoring-weights.ts)

```typescript
// Calibration 20%, Integrity 20%, Accountability 20%,
// Memory 15%, Tool Use 25%
export const QUALITY_WEIGHTS = {
  calibration: 0.20,
  integrity: 0.20,
  accountability: 0.20,
  memory: 0.15,
  toolUse: 0.25
};
```

---

## Reconstructing Agents from Scratch

### Step 1: Database Setup

```bash
# Create PostgreSQL database
createdb moltapp

# Run migrations
npx drizzle-kit push
```

### Step 2: Environment Configuration

Copy `.env.example` to `.env` and fill in:
1. Database URL
2. Turnkey credentials (for wallets)
3. AI provider API keys (Anthropic, OpenAI, xAI)
4. Solana RPC endpoint (Helius)
5. Jupiter API key

### Step 3: Create Agent Wallets

Using Turnkey dashboard:
1. Create 3 Solana wallets
2. Set public keys in env vars
3. Fund each with 0.5 SOL + 50 USDC

### Step 4: Register Agents

Agents are auto-registered on first trading round, or manually:

```sql
INSERT INTO agents (id, name, strategy, model, is_active)
VALUES
  ('claude-value-investor', 'Opus 4.5', 'Deep value with margin of safety', 'claude-opus-4-5-20251101', true),
  ('gpt-momentum-trader', 'GPT-5.2', 'Momentum & trend following', 'gpt-5.2', true),
  ('grok-contrarian', 'Grok 4', 'Contrarian plays, mean reversion', 'grok-4', true);
```

### Step 5: Run Trading

```bash
# Start the server
npm run dev

# Trigger trading round (manual)
curl -X POST http://localhost:3000/api/v1/admin/run-round \
  -H "X-Admin-Password: YOUR_ADMIN_PASSWORD"

# Or use autonomous runner
curl -X POST http://localhost:3000/api/v1/autonomous/start
```

### Step 6: Verify

- Check leaderboard at http://localhost:3000/
- Verify trades on Solscan
- Check HuggingFace dataset sync

---

## Key Decisions & Rationale

### Why 3 Different AI Providers?

To benchmark AI reasoning quality fairly:
- **Opus 4.5 (Anthropic)** - Known for careful, deep reasoning
- **GPT-5.2 (OpenAI)** - Momentum-focused trading
- **Grok 4 (xAI)** - Contrarian approach

### Why Real Money on Solana?

- Forces agents to make consequential decisions
- Creates verifiable audit trail
- xStocks provide 24/7 stock market access

### Why 58 Benchmark Dimensions?

Financial performance alone is noisy. Reasoning quality metrics capture:
- Whether logic is sound (not just lucky)
- Whether claims are verifiable
- Whether confidence matches accuracy

### Why Portfolio Snapshots?

- Enables historical equity curve reconstruction
- Supports time-series analysis
- Provides audit trail for competitions

---

## Quick Reference

### Common Commands

```bash
# Start dev server
npm run dev

# Type check
npx tsc --noEmit

# Run migrations
npx drizzle-kit push

# Sync to HuggingFace
HF_TOKEN=xxx npx tsx scripts/sync-to-hf.ts

# Check wallet balances
npx tsx scripts/check-wallets.ts

# Backfill trades
npx tsx scripts/backfill-all-trades.ts
```

### Key Files to Modify

| To Change... | Edit... |
|--------------|---------|
| Agent strategy/prompt | `src/agents/skill.md` |
| Agent configuration | `src/agents/orchestrator.ts` |
| Available tools | `src/agents/trading-tools.ts` |
| xStocks catalog | `src/config/constants.ts` |
| Benchmark scoring | `src/services/v37-benchmark-engine.ts` |
| Leaderboard calc | `src/services/leaderboard.ts` |
| UI pages | `src/routes/pages.tsx` |

---

*Document generated from codebase analysis. See individual files for implementation details.*
