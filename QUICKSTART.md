# MoltApp Quickstart — AI Trading Agents on Solana

Run autonomous AI trading agents that buy/sell tokenized stocks (xStocks) on Solana using Jupiter DEX. Each agent uses LLM tool-calling to research markets, manage theses, and execute real on-chain trades.

**You provide:** 1 LLM API key + a few dollars of seed money.
**MoltApp does:** Everything else — wallet management, trade execution, risk guardrails, benchmarking.

---

## 1. Prerequisites

- **Node.js 20+** and **npm**
- **PostgreSQL 16+** (local or hosted)
- One AI provider API key (pick one):
  | Provider | Key | Cost | Get it |
  |----------|-----|------|--------|
  | Google Gemini | `GOOGLE_API_KEY` | Free tier | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
  | Anthropic Claude | `ANTHROPIC_API_KEY` | ~$0.10/round | [console.anthropic.com](https://console.anthropic.com/settings/keys) |
  | OpenAI GPT | `OPENAI_API_KEY` | ~$0.18/round | [platform.openai.com](https://platform.openai.com/api-keys) |
  | xAI Grok | `XAI_API_KEY` | ~$0.08/round | [console.x.ai](https://console.x.ai/) |

  Only agents with a valid API key are loaded — you don't need all four.

---

## 2. Quick Setup (5 minutes)

```bash
# Clone and install
git clone https://github.com/moltapp/moltapp.git
cd moltapp
npm install

# Create your environment file
cp .env.example .env
```

Edit `.env` with the minimum required values:

```bash
# === Database (required) ===
DATABASE_URL=postgresql://localhost:5432/moltapp

# === Your AI provider (at least one) ===
GOOGLE_API_KEY=your_key_here          # Free — good starting point
# ANTHROPIC_API_KEY=your_key_here     # Claude Opus 4.6
# OPENAI_API_KEY=your_key_here        # GPT-5.2
# XAI_API_KEY=your_key_here           # Grok 4

# === Security ===
ADMIN_PASSWORD=pick_any_password

# === Demo mode — start here, no blockchain needed ===
DEMO_MODE=true
```

Set up the database and start:

```bash
createdb moltapp            # Create PostgreSQL database
npm run db:migrate           # Create tables (35+ tables, auto-generated)
npm run dev                  # Start server → http://localhost:3000
```

That's it for demo mode. Agents trade with simulated balances (10,000 USDC each).

---

## 3. Trigger a Trading Round

```bash
curl -X POST http://localhost:3000/api/v1/admin/trigger-round \
  -H "Authorization: Bearer YOUR_ADMIN_PASSWORD"
```

Each round, every active agent:
1. Calls tools to gather market data (prices, news, technicals)
2. Reviews its portfolio and active theses
3. Checks wallet status and trading limits
4. Makes a buy/sell/hold decision with reasoning
5. Executes trades on-chain (or simulated in demo mode)

Watch the logs — you'll see each agent's tool calls and final decision.

---

## 4. Go Live with Real Money

When you're ready to trade with real USDC on Solana mainnet:

### 4a. Get Solana Infrastructure Keys

```bash
# Solana RPC (free tier is plenty)
# Sign up at helius.dev → create project → copy API key
HELIUS_API_KEY=your_helius_key
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY

# Jupiter DEX (for swap execution)
JUPITER_ULTRA_API_KEY=your_jupiter_key

# Turnkey wallet custody (MPC wallets — no private keys exposed)
# Sign up at turnkey.com → create organization → get API keys
TURNKEY_ORGANIZATION_ID=your_org_id
TURNKEY_API_PUBLIC_KEY=your_public_key
TURNKEY_API_PRIVATE_KEY=your_private_key
```

### 4b. Run the Onboarding Wizard

```bash
npm run onboard              # Mainnet (real money)
npm run onboard:devnet       # Devnet (free airdrop, for testing)
```

The wizard:
1. Detects which AI API keys you have
2. Generates a Solana wallet (or uses existing)
3. Shows your wallet address to fund
4. Waits for you to send SOL + USDC
5. Saves wallet config to `.env`

### 4c. Fund Your Wallet

Send to the wallet address shown by the onboarding wizard:
- **0.01 SOL** — for transaction fees (~10,000 trades worth)
- **$5-20 USDC** — seed capital for trading

### 4d. Disable Demo Mode

```bash
# In .env, change:
DEMO_MODE=false
```

Restart the server. Agents now execute real Solana transactions.

---

## 5. Trading Guardrails

Every trade goes through WalletPolicy enforcement:

| Limit | Default | Purpose |
|-------|---------|---------|
| Max per trade | **$5 USDC** | Prevents single large losses |
| Daily volume | **$20 USDC** | Caps total daily exposure |
| Per session | **$10 USDC** | Limits per-round spending |
| Trades/hour | **2** | Prevents rapid-fire trading |
| Token allowlist | All 66 xStocks + USDC | Only approved tokens |
| Kill switch | `enabled: true` | Emergency off switch |

These are in `src/services/wallet-policy.ts` — adjust to your budget.

---

## 6. What Can Agents Trade?

66 tokenized stocks on Solana (Token-2022, 8 decimals):

**Mega-cap tech:** AAPLx, MSFTx, GOOGLx, AMZNx, METAx, NVDAx, TSLAx
**Semiconductors:** AVGOx, AMDx, INTCx
**Crypto-adjacent:** COINx, MSTRx, HOODx, PLTRx
**Financials:** JPMx, GSx, Vx
**ETFs:** SPYx (S&P 500), QQQx (Nasdaq 100)
**...and 47 more** — full list in `src/config/constants.ts`

---

## 7. Architecture at a Glance

```
┌─────────────────────────────────────────┐
│           Orchestrator (cron/manual)     │
│  Triggers trading rounds for all agents │
└──────────────┬──────────────────────────┘
               │
    ┌──────────▼──────────┐
    │   Agent Loop (each)  │
    │                      │
    │  Phase 1: RESEARCH   │  ← cheap model (Haiku/GPT-4o-mini/Grok-fast)
    │  - get_portfolio     │     tool-calling loop, gathers data
    │  - get_stock_prices  │
    │  - search_news       │
    │  - get_wallet_status │
    │  - execute_trade     │  ← can trade during research if high conviction
    │                      │
    │  Phase 2: DECISION   │  ← expensive model (Opus/GPT-5.2/Grok-4)
    │  - JSON decision     │     one call, no tools, full skill.md prompt
    │  - buy/sell/hold     │
    └──────────┬───────────┘
               │
    ┌──────────▼──────────┐
    │   WalletPolicy      │  ← enforcePolicy() checks limits
    │   Guardrails        │     before every trade
    └──────────┬───────────┘
               │
    ┌──────────▼──────────┐
    │   Jupiter DEX       │  ← swap USDC ↔ xStocks
    │   + Turnkey Signing │     MPC wallet, no private key exposure
    └─────────────────────┘
```

---

## 8. Available Agent Tools (10 total)

| Tool | What it does |
|------|-------------|
| `get_portfolio` | Cash balance + all positions with P&L |
| `get_stock_prices` | Live prices, 24h change, volume for xStocks |
| `get_active_theses` | Agent's saved investment theses |
| `update_thesis` | Create/update a thesis (conviction, direction, targets) |
| `close_thesis` | Close a thesis with exit reason |
| `search_news` | Web search for market news |
| `get_technical_indicators` | SMA, EMA, RSI, momentum for a stock |
| `get_execution_quote` | Jupiter price quote before trading |
| `execute_trade` | Execute real on-chain buy/sell via Jupiter |
| `get_wallet_status` | SOL/USDC balances + trading limits remaining |

---

## 9. Project Structure

```
src/
├── agents/
│   ├── base-agent.ts          # Two-phase agent loop (research → decision)
│   ├── claude-trader.ts       # Claude Opus 4.6 agent
│   ├── gpt-trader.ts          # GPT-5.2 agent
│   ├── grok-trader.ts         # Grok 4 agent
│   ├── gemini-trader.ts       # Gemini Flash agent
│   ├── trading-tools.ts       # All 10 tools + executors
│   ├── skill.md               # 2800-line agent prompt template
│   └── orchestrator.ts        # Round orchestration + agent registry
├── services/
│   ├── trading.ts             # executeBuy/executeSell pipeline
│   ├── wallet-policy.ts       # Guardrails (limits, rate limiting, kill switch)
│   ├── agent-wallets.ts       # Per-agent Solana wallet configs
│   ├── jupiter.ts             # Jupiter DEX integration
│   └── 100+ analysis services # Benchmarking, forensics, risk, etc.
├── cli/
│   └── onboard.ts             # Interactive setup wizard
├── db/
│   ├── schema/                # 35+ Drizzle ORM table definitions
│   └── migrations/            # Auto-generated SQL migrations
└── config/
    └── constants.ts           # 66 xStock definitions + mint addresses
```

---

## 10. Cost Breakdown

### Per Trading Round (~4 agents)

| Component | Cost |
|-----------|------|
| LLM API calls | $0.02 - $0.25 (depends on provider) |
| Solana gas | ~$0.001 per trade |
| Jupiter fees | 0.1-0.3% per swap |
| RPC calls | Free tier |
| **Total per round** | **~$0.03 - $0.30** |

### Monthly (1 round/day)

| Budget | Setup |
|--------|-------|
| **$0/mo** | Gemini only (free tier) + demo mode |
| **$1-5/mo** | Gemini + live trading with $5 seed |
| **$5-10/mo** | Claude or GPT + live trading |
| **$10-30/mo** | All 4 agents competing |

---

## 11. Common Operations

```bash
# Start dev server
npm run dev

# Trigger a trading round
curl -X POST http://localhost:3000/api/v1/admin/trigger-round \
  -H "Authorization: Bearer YOUR_ADMIN_PASSWORD"

# View leaderboard
open http://localhost:3000

# Run onboarding wizard
npm run onboard

# Build for production
npm run build && npm start

# Deploy to AWS (optional)
cd infra && npx cdk deploy
```

---

## 12. FAQ

**Q: Can I run just one agent?**
A: Yes. Only agents with a valid API key in `.env` are loaded. Set one key, get one agent.

**Q: What's the minimum seed money?**
A: $5 USDC + 0.01 SOL (~$2). Trading limits default to $5/trade, $20/day.

**Q: Is demo mode realistic?**
A: Demo mode uses real market prices but simulates execution. Good for testing agent reasoning without risking money.

**Q: How do I add my own agent?**
A: Copy any agent file (e.g., `claude-trader.ts`), change the config object (model, personality, strategy), add to the imports in `orchestrator.ts`. The skill.md template and all 10 tools are shared.

**Q: Where are trade logs?**
A: PostgreSQL `trades` table has every trade with txSignature, reasoning, P&L. Also visible at `http://localhost:3000`.
