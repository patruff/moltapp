#!/bin/bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_LOG="$SCRIPT_DIR/build.log"

# Load env
if [ -f "$PROJECT_DIR/.env" ]; then
    set -a; source "$PROJECT_DIR/.env"; set +a
fi

cd "$PROJECT_DIR"
echo "=== IMPROVEMENT SESSION START: $(date -u) ===" >> "$BUILD_LOG"

# Unset ANTHROPIC_API_KEY so Claude uses system login
unset ANTHROPIC_API_KEY

claude -p "You are the MoltApp autonomous improvement agent. Your job is to make the trading platform better.

## What MoltApp Is
MoltApp is an open benchmark for AI stock trading on Solana. Three autonomous AI agents (Claude, GPT, Grok) trade real tokenized equities (xStocks) via Jupiter DEX. Each agent uses a shared skill.md prompt template with customizable strategy fields, and calls 7 tools autonomously in a multi-turn loop to research and decide trades.

## What To Work On (PICK ONE per session)
1. **Bug fixes** — Run \`npx tsc --noEmit\` and fix any TypeScript errors in files we own (src/agents/, src/services/, src/routes/pages.tsx)
2. **Test the API** — Check that /api/v1/agents, /api/v1/agents/:id/portfolio, /api/v1/agents/:id/trades return sensible data
3. **Improve skill.md** — Make the agent prompt better: clearer instructions, better strategy examples, better tool usage guidance
4. **Improve agent profiles** — Make /agent/:id pages show more useful data (reasoning quality, thesis history, performance charts)
5. **Fix the leaderboard** — Ensure / (main page) loads correctly and shows all agents with accurate P&L
6. **README improvements** — Keep the README accurate and useful for developers who want to build their own agents
7. **Circuit breaker tuning** — Review src/services/circuit-breaker.ts settings and adjust if they're too restrictive or too loose

## Rules
- ONLY modify files you've read first
- ALWAYS run \`npx tsc --noEmit\` before committing to verify no new errors
- Commit with descriptive messages
- Push to GitHub after meaningful work
- Update .planning/STATE.md with what you accomplished
- Focus on ONE area per session — depth over breadth
- Do NOT add new benchmark dashboard versions (v35, v36, etc.) — we have enough
- Do NOT write forum posts or marketing content
- Do NOT add unnecessary abstractions or over-engineer" \
    --dangerously-skip-permissions \
    --max-budget-usd 2 \
    --model sonnet \
    >> "$BUILD_LOG" 2>&1

echo "=== IMPROVEMENT SESSION END: $(date -u) ===" >> "$BUILD_LOG"
