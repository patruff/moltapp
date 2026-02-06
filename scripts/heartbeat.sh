#!/bin/bash
# MoltApp Code Improvement Heartbeat
#
# Runs every 30 minutes — focused on code quality and platform improvement:
# 1. Checks TypeScript health
# 2. Checks agent health (are agent configs valid, can they be instantiated)
# 3. Launches an autonomous improvement session (bug fixes, testing, skill.md, agent quality)
# 4. Pushes changes to GitHub
#
# This heartbeat does NOT run trading rounds.
# Trading happens separately via `npx tsx scripts/heartbeat.ts --once`.
#
# Usage:
#   ./scripts/heartbeat.sh              # Single run
#   ./scripts/install-heartbeat.sh      # Install as launchd service
#
# What this does NOT do:
# - Trading rounds (decouple trading from code improvement)
# - Forum engagement / social media posting
# - Voting on other projects
# - AI-generated content for marketing
# - Creating new benchmark dashboard versions

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_FILE="$SCRIPT_DIR/heartbeat.log"
STATE_FILE="$SCRIPT_DIR/heartbeat-state.json"
BUILD_PID_FILE="$SCRIPT_DIR/heartbeat-build.pid"

# --- Load environment ---
if [ -f "$PROJECT_DIR/.env" ]; then
    set -a
    source "$PROJECT_DIR/.env"
    set +a
fi

# --- Logging ---
log() {
    local msg="[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
    echo "$msg" >> "$LOG_FILE"
    echo "$msg"
}

log_error() {
    log "ERROR: $*"
}

# --- State management ---
init_state() {
    # Ensure state file has correct schema (reset if missing or stale format)
    local needs_reset=false
    if [ ! -f "$STATE_FILE" ]; then
        needs_reset=true
    elif ! jq -e '.improvement_sessions_launched' "$STATE_FILE" > /dev/null 2>&1; then
        needs_reset=true
    fi

    if [ "$needs_reset" = true ]; then
        cat > "$STATE_FILE" << 'STATEEOF'
{
    "heartbeat_count": 0,
    "improvement_sessions_launched": 0,
    "last_improvement_session": "",
    "ts_errors_last_check": 0
}
STATEEOF
    fi
}

get_state() {
    jq -r ".$1 // empty" "$STATE_FILE" 2>/dev/null
}

set_state() {
    local key="$1" value="$2"
    local tmp=$(mktemp)
    jq ".$key = $value" "$STATE_FILE" > "$tmp" && mv "$tmp" "$STATE_FILE"
}

increment_state() {
    local key="$1"
    local current=$(get_state "$key")
    current=${current:-0}
    set_state "$key" "$((current + 1))"
}

# ============================================================
# TASK 1: TypeScript Health Check
# ============================================================

check_typescript() {
    log "Running TypeScript check..."
    local ts_errors
    ts_errors=$(cd "$PROJECT_DIR" && npx tsc --noEmit 2>&1 | grep -c "error TS" || true)

    set_state "ts_errors_last_check" "$ts_errors"

    if [ "$ts_errors" -gt 0 ]; then
        log "  $ts_errors TypeScript errors detected"
    else
        log "  TypeScript: clean"
    fi
}

# ============================================================
# TASK 2: Check Agent Health
# ============================================================

check_agent_health() {
    log "Checking agent health..."

    local agents_output
    agents_output=$(cd "$PROJECT_DIR" && npx tsx -e "
        import { readFileSync } from 'fs';
        import { resolve } from 'path';
        try {
            for (const line of readFileSync(resolve(process.cwd(), '.env'), 'utf-8').split('\n')) {
                const t = line.trim();
                if (!t || t.startsWith('#')) continue;
                const eq = t.indexOf('=');
                if (eq === -1) continue;
                if (!process.env[t.slice(0, eq).trim()]) process.env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
            }
        } catch {}
        const { getAgentConfigs, getAgentPortfolio } = await import('./src/agents/orchestrator.ts');
        const configs = getAgentConfigs();
        for (const c of configs) {
            try {
                const p = await getAgentPortfolio(c.agentId);
                console.log(JSON.stringify({
                    agent: c.agentId,
                    name: c.name,
                    cash: p.cashBalance.toFixed(2),
                    positions: p.positions.length,
                    totalValue: p.totalValue.toFixed(2),
                    pnl: p.totalPnlPercent.toFixed(2)
                }));
            } catch (e) {
                console.log(JSON.stringify({ agent: c.agentId, error: e.message }));
            }
        }
        process.exit(0);
    " 2>/dev/null)

    if [ -n "$agents_output" ]; then
        echo "$agents_output" | while IFS= read -r line; do
            local agent=$(echo "$line" | jq -r '.agent // empty' 2>/dev/null)
            local error=$(echo "$line" | jq -r '.error // empty' 2>/dev/null)
            if [ -n "$error" ]; then
                log_error "  Agent $agent: $error"
            else
                local name=$(echo "$line" | jq -r '.name' 2>/dev/null)
                local cash=$(echo "$line" | jq -r '.cash' 2>/dev/null)
                local positions=$(echo "$line" | jq -r '.positions' 2>/dev/null)
                local totalValue=$(echo "$line" | jq -r '.totalValue' 2>/dev/null)
                local pnl=$(echo "$line" | jq -r '.pnl' 2>/dev/null)
                log "  $name: \$$totalValue (${pnl}% PnL) | ${positions} positions | \$$cash cash"
            fi
        done
    else
        log "  Could not fetch agent health data"
    fi
}

# ============================================================
# TASK 3: Launch Autonomous Improvement Session
# ============================================================

launch_improvement_session() {
    # Check if a build is already running
    if [ -f "$BUILD_PID_FILE" ]; then
        local pid=$(cat "$BUILD_PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            log "Improvement session already running (PID: $pid), skipping"
            return
        else
            log "Previous session (PID: $pid) has ended"
            rm -f "$BUILD_PID_FILE"
        fi
    fi

    log "Launching autonomous improvement session..."

    local ts_errors=$(get_state "ts_errors_last_check")
    ts_errors=${ts_errors:-0}

    cat > "$SCRIPT_DIR/run-build.sh" << BUILDSCRIPT
#!/bin/bash
set -uo pipefail

SCRIPT_DIR="\$(cd "\$(dirname "\$0")" && pwd)"
PROJECT_DIR="\$(dirname "\$SCRIPT_DIR")"
BUILD_LOG="\$SCRIPT_DIR/build.log"

# Extract OAuth token from .env (don't source entire file — has unquoted &)
if [ -f "\$PROJECT_DIR/.env" ]; then
    OAUTH_TOKEN=\$(grep '^ANTHROPIC_OAUTH_TOKEN=' "\$PROJECT_DIR/.env" | cut -d= -f2-)
fi

cd "\$PROJECT_DIR"
echo "=== IMPROVEMENT SESSION START: \$(date -u) ===" >> "\$BUILD_LOG"

# Use OAuth token for Claude CLI authentication (works headless/nohup)
unset ANTHROPIC_API_KEY
export CLAUDE_CODE_OAUTH_TOKEN="\$OAUTH_TOKEN"

claude -p "You are the MoltApp code improvement agent. Your job is to make the codebase cleaner and features work better.

## What MoltApp Is
MoltApp is an open benchmark for AI stock trading on Solana. Three AI agents (Claude ValueBot, GPT MomentumBot, Grok ContrarianBot) trade real tokenized equities (xStocks) via Jupiter DEX. Each agent uses a shared skill.md prompt template with customizable strategy fields, and calls 7 tools autonomously in a multi-turn loop to research and decide trades.

## Current TypeScript Errors: ${ts_errors}

## What To Work On (PICK ONE per session — depth over breadth)
1. **Fix TypeScript errors** — Run \\\`npx tsc --noEmit\\\` and fix errors in files we own (src/agents/, src/services/, src/routes/). These are pre-existing errors, not new ones. Focus on the EASIEST ones first.
2. **Improve skill.md** — Read src/agents/skill.md and make the prompt clearer: better tool usage examples, clearer decision criteria, better strategy guidance so agents make smarter trades
3. **Test API endpoints** — Check /api/v1/agents, /api/v1/agents/:id/portfolio, /api/v1/agents/:id/trades work correctly. Fix any broken endpoints.
4. **Improve agent profile pages** — Read src/routes/pages.tsx and improve the /agent/:id page: better layout, more useful data display, thesis history
5. **Fix the leaderboard** — Ensure the main page (/) loads correctly and shows all agents with accurate portfolio values and P&L
6. **Clean up dead code** — Remove unused imports, dead variables, commented-out code in files you're already editing

## STRICT RULES
- ONLY modify files you've read first
- ALWAYS run \\\`npx tsc --noEmit\\\` before committing to verify no NEW errors
- Commit with clear, descriptive messages
- Push to GitHub after meaningful work
- Focus on ONE area per session — depth over breadth
- Do NOT create new benchmark versions (v37, v38, etc.) — we already have too many
- Do NOT create new files unless absolutely necessary — prefer editing existing ones
- Do NOT write forum posts or marketing content
- Do NOT add unnecessary abstractions or over-engineer
- Do NOT touch eval.yaml, sync-to-hf.ts, or benchmark engine files
- Do NOT add new routes to app.ts
- Keep changes small and focused" \\
    --dangerously-skip-permissions \\
    --max-budget-usd 1.50 \\
    --model sonnet \\
    >> "\$BUILD_LOG" 2>&1

echo "=== IMPROVEMENT SESSION END: \$(date -u) ===" >> "\$BUILD_LOG"
BUILDSCRIPT
    chmod +x "$SCRIPT_DIR/run-build.sh"

    # Launch fully detached
    nohup bash "$SCRIPT_DIR/run-build.sh" < /dev/null > /dev/null 2>&1 &
    local new_pid=$!
    disown $new_pid 2>/dev/null
    echo "$new_pid" > "$BUILD_PID_FILE"
    log "Improvement session launched (PID: $new_pid)"
    increment_state "improvement_sessions_launched"
    set_state "last_improvement_session" "\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\""
}

# ============================================================
# TASK 4: Push Changes
# ============================================================

push_changes() {
    cd "$PROJECT_DIR"

    if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
        log "Pushing git changes..."
        git add -A
        git commit -m "heartbeat: code improvement cycle #$(get_state 'heartbeat_count')" 2>/dev/null || true
        git push origin main 2>/dev/null && log "Pushed to GitHub" || log_error "Failed to push"
    fi
}

# ============================================================
# MAIN
# ============================================================

main() {
    log "============================================================"
    log "HEARTBEAT START — $(date -u)"
    log "============================================================"

    init_state
    increment_state "heartbeat_count"
    local count=$(get_state "heartbeat_count")
    log "Heartbeat #$count"

    # 1. TypeScript health check
    check_typescript

    # 2. Check agent health (portfolio values, positions, cash)
    check_agent_health

    # 3. Launch improvement session (if none running)
    launch_improvement_session

    # 4. Push any state changes
    push_changes

    log "HEARTBEAT COMPLETE — $(date -u)"
    log "============================================================"
    log ""
}

main "$@"
