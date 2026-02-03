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

claude -p "You are the MoltApp autonomous builder for the Colosseum Agent Hackathon (\$100k prize, deadline Feb 12 2026). Ship 500+ lines of PRODUCTION code. This session focuses on making MoltApp an industry-standard AI TRADING BENCHMARK.

Project: /Users/patruff/moltapp — competitive stock trading platform. AI agents trade REAL tokenized stocks on Solana.
Domain: www.patgpt.us

## First: Read current state
- Read src/app.ts, package.json
- git log --oneline -15 to see what exists
- ls src/routes/ src/services/ src/agents/ src/db/schema/ to see all files
- Read infra/lib/moltapp-stack.ts for CDK

## FOCUS: Benchmark & Reasoning Transparency

### PRIORITY 1: Trade Reasoning Schema
Update the trade system so every trade REQUIRES reasoning data:

Create/update src/db/schema/trade-reasoning.ts:
\`\`\`typescript
export const tradeJustifications = pgTable('trade_justifications', {
  id: text('id').primaryKey(),
  tradeId: text('trade_id').references(() => trades.id),
  agentId: text('agent_id').references(() => agents.id),
  reasoning: text('reasoning').notNull(),           // Step-by-step logic
  confidence: real('confidence').notNull(),          // 0.0 to 1.0
  sources: jsonb('sources').\$type<string[]>(),      // What data agent read
  intent: text('intent').notNull(),                  // 'momentum' | 'mean_reversion' | 'value' | 'hedge' | 'contrarian'
  predictedOutcome: text('predicted_outcome'),       // What agent expects
  actualOutcome: text('actual_outcome'),             // Filled later
  coherenceScore: real('coherence_score'),           // Did reasoning match action?
  hallucinationFlags: jsonb('hallucination_flags').\$type<string[]>(), // Fact-check failures
  timestamp: timestamp('timestamp').defaultNow(),
});
\`\`\`

### PRIORITY 2: Zod Validation for Reasoning-Required Trades
Update trading endpoints: agents MUST provide reasoning to trade.

Create src/schemas/trade-reasoning.ts:
\`\`\`typescript
import { z } from 'zod';
export const tradeWithReasoningSchema = z.object({
  symbol: z.string(),
  side: z.enum(['buy', 'sell']),
  quantity: z.number().positive(),
  reasoning: z.string().min(20, 'Reasoning must explain your logic'),
  confidence: z.number().min(0).max(1),
  sources: z.array(z.string()).min(1, 'Must cite at least one data source'),
  intent: z.enum(['momentum', 'mean_reversion', 'value', 'hedge', 'contrarian', 'arbitrage']),
  predictedOutcome: z.string().optional(),
});
\`\`\`

### PRIORITY 3: Coherence Analyzer
Create src/services/coherence-analyzer.ts:
- analyzeCoherence(reasoning, action, marketData): score 0-1
  - Does the reasoning support the action? (bullish text + buy = coherent)
  - Use simple NLP: detect sentiment in reasoning, compare to action
- detectHallucinations(reasoning, realPrices): string[]
  - Check if agent claims prices that don't match reality
  - Flag made-up ticker symbols, impossible price claims
- checkInstructionDiscipline(trade, agentConfig): boolean
  - Did agent respect max trade size, position limits?

### PRIORITY 4: HuggingFace Benchmark Integration
Create scripts/sync-to-hf.ts:
\`\`\`typescript
import { uploadFile } from '@huggingface/hub';
// Fetch all trades with justifications from DB
// Format as benchmark dataset: { agent, trade, reasoning, coherence, metrics }
// Upload to patruff/molt-benchmark on HF
// Include eval.yaml for benchmark recognition
\`\`\`

Create eval.yaml in project root:
\`\`\`yaml
benchmark: moltapp-v1
metadata:
  name: 'MoltApp: Agentic Stock Trading Benchmark'
  description: 'Live evaluation of AI agents trading tokenized real-world stocks on Solana.'
  domain: finance
  task: agentic-trading
  website: 'https://www.patgpt.us'
metrics:
  - name: pnl_percent
    type: reward
    description: 'ROI since round start'
  - name: sharpe_ratio
    type: risk_adjustment
    description: 'Risk-adjusted return'
  - name: reasoning_coherence
    type: qualitative
    description: 'Does reasoning match trade action?'
  - name: hallucination_rate
    type: safety
    description: 'Rate of factually incorrect claims in reasoning'
  - name: instruction_discipline
    type: reliability
    description: 'Compliance with trading rules and limits'
\`\`\`

### PRIORITY 5: Brain Feed API
Create src/routes/brain-feed.ts:
- GET /api/v1/brain-feed — live stream of agent reasoning
  - Returns recent trades with full reasoning, confidence, coherence scores
  - Pagination support
  - Filter by agent, intent, confidence level
- GET /api/v1/brain-feed/:agentId — specific agent's thought process
- GET /api/v1/brain-feed/highlights — most interesting/controversial trades
  - Low coherence = interesting (agent contradicted itself)
  - High confidence + wrong = interesting

### PRIORITY 6: Benchmark Dashboard Route
Update the landing page or create new route:
- GET /benchmark — HTML page showing:
  - Live leaderboard with P&L + Sharpe + Coherence scores
  - Brain feed ticker showing latest agent reasoning
  - HuggingFace badge linking to dataset
  - Metric explanations for each pillar
  - 'Official AI Finance Benchmark' branding

### PRIORITY 7: Update Agent Trading Logic
Update src/agents/ to require reasoning in all trades:
- Each agent (claude-trader, gpt-trader, grok-trader) must return:
  { action, symbol, quantity, reasoning, confidence, sources, intent }
- The orchestrator validates reasoning before executing
- Bad reasoning = trade rejected and logged

## After ALL coding:
1. npx tsc --noEmit — MUST pass. Fix ALL errors.
2. npm install any needed deps
3. Run drizzle-kit generate if schema changed
4. git add all changed files
5. git commit -m 'feat: [description]'
6. git push origin main

## Rules:
- 500+ lines minimum.
- Every trade needs reasoning. No black-box trades.
- Make it a REAL benchmark, not just a leaderboard." \
    --dangerously-skip-permissions \
    >> "$BUILD_LOG" 2>&1

echo "=== BUILD SESSION END: $(date -u) ===" >> "$BUILD_LOG"
