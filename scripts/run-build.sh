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

claude -p "You are the MoltApp autonomous builder for the Colosseum Agent Hackathon (\$100k prize, deadline Feb 12 2026). Ship MASSIVE features. 500+ lines minimum. This is a \$100k hackathon — go big.

Project: /Users/patruff/moltapp — a competitive stock trading platform where AI agents trade REAL tokenized stocks on Solana.

## First: Read current state
- Read .planning/STATE.md, .planning/ROADMAP.md, src/app.ts, package.json
- git log --oneline -10 to see recent work
- Read src/routes/ directory to see existing endpoints
- Read infra/lib/moltapp-stack.ts to see current CDK infrastructure

## PHASE 1: 3 AI Trading Agents (If not already built)

Build the core LLM trading logic. 3 agents compete 24/7:

### src/agents/base-agent.ts — Abstract base class
- Interface: TradingAgent { agentId, name, model, analyze(marketData): TradingDecision }
- TradingDecision: { action: 'buy'|'sell'|'hold', symbol, quantity, reasoning, confidence }
- MarketData type: { symbol, price, change24h, volume, news? }

### src/agents/claude-trader.ts — Anthropic Claude agent
- Uses Anthropic SDK (@anthropic-ai/sdk) to call Claude
- System prompt: expert stock analyst, conservative, value investing
- Analyzes price data + news, returns structured trade decision
- Has its own wallet address

### src/agents/gpt-trader.ts — OpenAI GPT agent
- Uses OpenAI SDK to call GPT-4o
- System prompt: aggressive growth trader, momentum based
- Different trading personality from Claude
- Has its own wallet address

### src/agents/grok-trader.ts — Grok agent
- Uses OpenAI-compatible API for Grok (xAI)
- System prompt: contrarian trader, looks for undervalued plays
- Different personality again
- Has its own wallet address

### src/agents/orchestrator.ts — Runs all 3 agents
- getMarketData(symbols): fetches current xStock prices
- runTradingRound(): calls all 3 agents in parallel, executes their decisions
- recordDecisions(): stores each agent's reasoning + trade in DB
- Handles errors gracefully (if one agent fails, others still trade)

### src/routes/agents.ts — Agent API endpoints
- GET /api/v1/agents — list all 3 AI agents with stats
- GET /api/v1/agents/:agentId — profile, win rate, P&L, current holdings
- GET /api/v1/agents/:agentId/trades — trade history with reasoning
- GET /api/v1/agents/:agentId/portfolio — current positions

## PHASE 2: Social Trading Features (If not already built)

### src/routes/feed.ts — Activity Feed
- GET /api/v1/feed — public feed of all recent trades
- GET /api/v1/feed/:agentId — specific agent's activity
- Each entry: { agentId, agentName, symbol, side, quantity, price, reasoning, timestamp, pnl }
- Pagination: ?limit=20&offset=0

### src/routes/comments.ts — Trade Discussion
- POST /api/v1/trades/:tradeId/comments — comment on a trade
- GET /api/v1/trades/:tradeId/comments — get comments
- POST /api/v1/trades/:tradeId/react — { reaction: 'bullish' | 'bearish' }
- GET /api/v1/trades/:tradeId/reactions — reaction counts

## PHASE 3: Infrastructure Upgrade (CDK)

Update infra/lib/moltapp-stack.ts:

### DynamoDB Table for Agent State
- Partition key: agentId (string)
- Store: last_trade_timestamp, current_holdings, performance_metrics, sentiment
- PAY_PER_REQUEST billing
- Grant Lambda read/write

### EventBridge Rule — Trigger trading every 30 min
- Cron: minute 0,30
- Target: Lambda function
- Payload: { trigger: 'scheduled-trading' }

### Lambda Environment Updates
- TABLE_NAME: DynamoDB table name
- Add longer timeout (5 min) for trading rounds

### Step Functions (if time allows)
- State machine: Search → Parallel(3 agents) → Execute Trades → Record Results
- Error handling with retries

## PHASE 4: Database Schema

### src/db/schema/ — Add tables for:
- agent_decisions: { id, agentId, symbol, action, quantity, reasoning, confidence, timestamp }
- trade_comments: { id, tradeId, authorId, content, timestamp }
- trade_reactions: { id, tradeId, agentId, reaction, timestamp }

Run drizzle migrations after schema changes.

## PHASE 5: x402 Agent-to-Agent Payments (If time allows)
- POST /api/v1/payments/tip — tip another agent for good calls
- GET /api/v1/agents/:agentId/earnings — tips received

## After ALL coding:
1. npx tsc --noEmit — MUST pass. Fix any issues.
2. Install new dependencies if needed (npm install @anthropic-ai/sdk openai)
3. git add all changed/new files
4. git commit with detailed message
5. git push origin main

## Rules:
- PRODUCTION QUALITY. Types, validation, error handling.
- 500+ lines minimum. Ship multiple features per session.
- Use existing Hono patterns from codebase.
- Check what already exists before building (don't duplicate).
- Make it IMPRESSIVE." \
    --dangerously-skip-permissions \
    >> "$BUILD_LOG" 2>&1

echo "=== BUILD SESSION END: $(date -u) ===" >> "$BUILD_LOG"
