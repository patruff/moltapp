#!/bin/bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_LOG="$SCRIPT_DIR/build.log"

# Extract OAuth token from .env (don't source entire file — has unquoted &)
if [ -f "$PROJECT_DIR/.env" ]; then
    OAUTH_TOKEN=$(grep '^ANTHROPIC_OAUTH_TOKEN=' "$PROJECT_DIR/.env" | cut -d= -f2-)
fi

cd "$PROJECT_DIR"
echo "=== IMPROVEMENT SESSION START: $(date -u) ===" >> "$BUILD_LOG"

# Use OAuth token for Claude CLI authentication (works headless/nohup)
unset ANTHROPIC_API_KEY
export CLAUDE_CODE_OAUTH_TOKEN="$OAUTH_TOKEN"

claude -p "You are the MoltApp code improvement agent. Your job is to make the codebase cleaner and features work better.

## What MoltApp Is
MoltApp is an open benchmark for AI stock trading on Solana. Three AI agents (Claude ValueBot, GPT MomentumBot, Grok ContrarianBot) trade real tokenized equities (xStocks) via Jupiter DEX. Each agent uses a shared skill.md prompt template with customizable strategy fields, and calls 7 tools autonomously in a multi-turn loop to research and decide trades.

## Current TypeScript Errors: 119

## What To Work On (PICK ONE per session — depth over breadth)
1. **Fix TypeScript errors** — Run \`npx tsc --noEmit\` and fix errors in files we own (src/agents/, src/services/, src/routes/). These are pre-existing errors, not new ones. Focus on the EASIEST ones first.
2. **Improve skill.md** — Read src/agents/skill.md and make the prompt clearer: better tool usage examples, clearer decision criteria, better strategy guidance so agents make smarter trades
3. **Test API endpoints** — Check /api/v1/agents, /api/v1/agents/:id/portfolio, /api/v1/agents/:id/trades work correctly. Fix any broken endpoints.
4. **Improve agent profile pages** — Read src/routes/pages.tsx and improve the /agent/:id page: better layout, more useful data display, thesis history
5. **Fix the leaderboard** — Ensure the main page (/) loads correctly and shows all agents with accurate portfolio values and P&L
6. **Clean up dead code** — Remove unused imports, dead variables, commented-out code in files you're already editing

## STRICT RULES
- ONLY modify files you've read first
- ALWAYS run \`npx tsc --noEmit\` before committing to verify no NEW errors
- Commit with clear, descriptive messages
- Push to GitHub after meaningful work
- Focus on ONE area per session — depth over breadth
- Do NOT create new benchmark versions (v37, v38, etc.) — we already have too many
- Do NOT create new files unless absolutely necessary — prefer editing existing ones
- Do NOT write forum posts or marketing content
- Do NOT add unnecessary abstractions or over-engineer
- Do NOT touch eval.yaml, sync-to-hf.ts, or benchmark engine files
- Do NOT add new routes to app.ts
- Keep changes small and focused" \
    --dangerously-skip-permissions \
    --max-budget-usd 1.50 \
    --model sonnet \
    >> "$BUILD_LOG" 2>&1

echo "=== IMPROVEMENT SESSION END: $(date -u) ===" >> "$BUILD_LOG"
