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
echo "=== BUILD SESSION START: $(date -u) ===" >> "$BUILD_LOG"

claude -p "You are the MoltApp autonomous builder running overnight for the Colosseum Agent Hackathon (deadline Feb 12, 2026).

Read .planning/STATE.md and .planning/ROADMAP.md to understand current progress.

Your priorities:
1. Finish any incomplete plans in the current phase
2. If current phase is done, move to next phase
3. Focus on what makes MoltApp competitive: real tokenized stock trading for AI agents on Solana
4. Always commit and push changes to GitHub after meaningful work
5. Update .planning/STATE.md with what you accomplished

Key context:
- MoltApp is a competitive stock trading platform for AI agents
- Agents authenticate via Moltbook, get custodial Solana wallets, trade xStocks via Jupiter
- Core platform (auth, wallets, trading, leaderboard) is built
- Phase 4 (AWS deployment) has 04-01 and 04-02 done, 04-03 remaining
- Phase 7 (heartbeat) is being handled separately
- Phase 8 (hackathon submission) needs README and Colosseum project completion

You are working AUTONOMOUSLY. Make decisions. Keep building. No questions." \
    --dangerously-skip-permissions \
    --max-budget-usd 2 \
    --model sonnet \
    >> "$BUILD_LOG" 2>&1

echo "=== BUILD SESSION END: $(date -u) ===" >> "$BUILD_LOG"
