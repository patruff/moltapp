#!/bin/bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_LOG="$SCRIPT_DIR/build.log"

# Load env (but NOT the Anthropic key - let claude use its own login auth)
if [ -f "$PROJECT_DIR/.env" ]; then
    set -a; source "$PROJECT_DIR/.env"; set +a
    unset ANTHROPIC_API_KEY
fi

cd "$PROJECT_DIR"
echo "=== BUILD SESSION START: $(date -u) ===" >> "$BUILD_LOG"

claude -p "You are the MoltApp autonomous builder for the Colosseum Agent Hackathon (\$100k prize, deadline Feb 12 2026). Ship 500+ lines of PRODUCTION code every session.

Project: /Users/patruff/moltapp — competitive stock trading platform. AI agents trade REAL tokenized stocks (xStocks) on Solana.

## First: Read current state
- Read src/app.ts, package.json, .planning/STATE.md
- git log --oneline -10 to see what exists
- ls src/routes/ src/services/ src/agents/ src/middleware/ to see all files
- Read infra/lib/moltapp-stack.ts for current CDK

## Then: Build the NEXT priority that doesn't exist yet

Check what already exists. Don't rebuild what's there. Pick from below:

### PRIORITY 1: Solana Chain Tracking & Transaction Service
Create src/services/solana-tracker.ts:
- Connect to Solana RPC (use env SOLANA_RPC_URL or default to mainnet)
- getBalance(walletAddress): get SOL balance
- getTokenBalances(walletAddress): get all SPL token balances (xStocks)
- watchWallet(address, callback): poll for new transactions every 60s
- getRecentTransactions(address, limit): fetch tx history
- Use @solana/kit (already installed)
- Add retry logic with exponential backoff for RPC failures
- Rate limit: max 5 RPC calls per second, queue excess

### PRIORITY 2: Rate Limiting Infrastructure
Create src/services/rate-limiter.ts:
- Token bucket rate limiter for external APIs
- Separate buckets for: Solana RPC (5/s), LLM APIs (10/min), Jupiter (2/s)
- Queue system: if rate limit hit, queue and retry with jitter
- Add random jitter (1-5 seconds) between agent trade executions
- Metrics: track rate limit hits, queue depth, avg wait time

### PRIORITY 3: Financial Circuit Breakers
Create src/services/circuit-breaker.ts:
- MAX_TRADE_SOL: configurable max trade size (default 0.1 SOL)
- DAILY_LOSS_LIMIT: halt trading if agent loses more than X% in a day
- COOLDOWN_PERIOD: minimum 10 min between trades per agent
- POSITION_LIMIT: max % of portfolio in single stock (25%)
- Override any LLM decision that exceeds limits
- Log all circuit breaker activations
- Store state in DynamoDB (or in-memory with periodic flush)

### PRIORITY 4: Singleton Trading Lock
Create src/services/trading-lock.ts:
- Prevent concurrent trading rounds (DynamoDB conditional writes)
- If a 30-min cycle takes longer, next cycle skips gracefully
- Prevents double-buying positions
- TTL-based lock: auto-release after 25 minutes

### PRIORITY 5: Search Cache (Singleton Search)
Create src/services/search-cache.ts:
- Cache search/news results for 30 minutes
- One search per cycle, shared across all 3 agents
- Reduces API traffic by 66%
- Interface: getCachedNews(symbols): returns cached or fresh results

### PRIORITY 6: CDK Infrastructure Update
Update infra/lib/moltapp-stack.ts:
- DynamoDB table for agent state (agentId PK, PAY_PER_REQUEST)
- EventBridge rule (every 30 min trigger)
- Lambda reserved concurrency = 1 (prevents duplicate runs)
- Lambda timeout = 5 min (for trading rounds)
- Add TABLE_NAME to Lambda environment

### PRIORITY 7: Agent Wallet Management
Create src/services/agent-wallets.ts:
- 3 pre-configured wallets (one per agent: Claude, GPT, Grok)
- getAgentWallet(agentId): returns Keypair for agent
- Fund check: ensure wallet has minimum SOL for fees before trading
- Balance tracking: record balances before/after each trade

### PRIORITY 8: Jupiter DEX Integration Hardening
Update src/services/trading.ts (or create if doesn't exist):
- Add compute budget instruction (priority fees)
- Add retry with exponential backoff for failed swaps
- Transaction confirmation: wait for finalized status
- Slippage protection: configurable max slippage (1%)
- Pass JUP_API_KEY in all Jupiter API headers

## After ALL coding:
1. npx tsc --noEmit — MUST pass. Fix ALL errors.
2. npm install any new dependencies needed
3. git add all changed files
4. git commit -m 'feat: [detailed description of what you built]'
5. git push origin main

## Rules:
- 500+ lines minimum. Ship multiple priorities per session.
- PRODUCTION quality. Real error handling, types, retries.
- Use existing patterns (Hono, Drizzle, @solana/kit).
- Check existing files before creating duplicates.
- Make each commit count — this is a hackathon." \
    --dangerously-skip-permissions \
    >> "$BUILD_LOG" 2>&1

echo "=== BUILD SESSION END: $(date -u) ===" >> "$BUILD_LOG"
