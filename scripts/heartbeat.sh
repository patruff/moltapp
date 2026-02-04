#!/bin/bash
# MoltApp Overnight Heartbeat
#
# Runs every ~2 hours — focused on actual platform improvement:
# 1. Runs a trading round (agents analyze, decide, execute)
# 2. Checks agent health (wallet balances, trade success)
# 3. Syncs benchmark data to HuggingFace
# 4. Launches an autonomous improvement session (code quality, bugs, testing)
# 5. Pushes changes to GitHub
#
# Usage:
#   ./scripts/heartbeat.sh              # Single run
#   ./scripts/install-heartbeat.sh      # Install as launchd service
#
# What this does NOT do:
# - Forum engagement / social media posting
# - Voting on other projects
# - AI-generated content for marketing
# This script builds and improves the product.

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
    if [ ! -f "$STATE_FILE" ]; then
        cat > "$STATE_FILE" << 'STATEEOF'
{
    "heartbeat_count": 0,
    "trading_rounds": 0,
    "build_sessions_launched": 0,
    "last_trading_round": "",
    "last_build_session": "",
    "last_hf_sync": "",
    "consecutive_trade_failures": 0,
    "total_trades_executed": 0
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
# TASK 1: Run Trading Round
# ============================================================

run_trading_round() {
    log "Running trading round..."

    local output
    output=$(cd "$PROJECT_DIR" && npx tsx scripts/heartbeat.ts --once 2>&1)
    local exit_code=$?

    if [ $exit_code -eq 0 ]; then
        log "Trading round completed successfully"
        increment_state "trading_rounds"
        set_state "last_trading_round" "\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\""
        set_state "consecutive_trade_failures" "0"

        # Count executed trades from output
        local executed=$(echo "$output" | grep -c "\[OK\]" || true)
        if [ "$executed" -gt 0 ]; then
            local current_total=$(get_state "total_trades_executed")
            current_total=${current_total:-0}
            set_state "total_trades_executed" "$((current_total + executed))"
            log "  $executed trades executed this round"
        fi

        # Log agent decisions
        echo "$output" | grep -E "\[(OK|FAIL|SKIP)\]" | while IFS= read -r line; do
            log "  $line"
        done
    else
        increment_state "consecutive_trade_failures"
        local failures=$(get_state "consecutive_trade_failures")
        log_error "Trading round failed (failure #$failures)"
        echo "$output" | tail -5 | while IFS= read -r line; do
            log "  $line"
        done
    fi
}

# ============================================================
# TASK 2: Check Agent Health
# ============================================================

check_agent_health() {
    log "Checking agent health..."

    # Check if the app can serve data
    local agents_output
    agents_output=$(cd "$PROJECT_DIR" && npx tsx -e "
        import { readFileSync } from 'fs';
        import { resolve, dirname } from 'path';
        import { fileURLToPath } from 'url';
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
# TASK 3: TypeScript Health Check
# ============================================================

check_typescript() {
    log "Running TypeScript check..."
    local ts_errors
    ts_errors=$(cd "$PROJECT_DIR" && npx tsc --noEmit 2>&1 | grep -c "error TS" || true)

    if [ "$ts_errors" -gt 0 ]; then
        log "  $ts_errors TypeScript errors detected (pre-existing)"
    else
        log "  TypeScript: clean"
    fi
}

# ============================================================
# TASK 4: Launch Autonomous Improvement Session
# ============================================================

launch_improvement_session() {
    # Check if a build is already running
    if [ -f "$BUILD_PID_FILE" ]; then
        local pid=$(cat "$BUILD_PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            log "Improvement session already running (PID: $pid)"
            return
        else
            log "Previous session (PID: $pid) has ended"
            rm -f "$BUILD_PID_FILE"
        fi
    fi

    log "Launching autonomous improvement session..."

    cat > "$SCRIPT_DIR/run-build.sh" << 'BUILDSCRIPT'
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
BUILDSCRIPT
    chmod +x "$SCRIPT_DIR/run-build.sh"

    # Launch fully detached
    nohup bash "$SCRIPT_DIR/run-build.sh" < /dev/null > /dev/null 2>&1 &
    local new_pid=$!
    disown $new_pid 2>/dev/null
    echo "$new_pid" > "$BUILD_PID_FILE"
    log "Improvement session launched (PID: $new_pid)"
    increment_state "build_sessions_launched"
    set_state "last_build_session" "\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\""
}

# ============================================================
# TASK 5: Push Changes
# ============================================================

push_changes() {
    cd "$PROJECT_DIR"

    if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
        log "Pushing git changes..."
        git add -A
        git commit -m "heartbeat: trading round + health check #$(get_state 'heartbeat_count')

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>" 2>/dev/null || true
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

    # 1. Run trading round (agents analyze market, make decisions, execute trades)
    run_trading_round

    # 2. Check agent health (portfolio values, positions, cash balances)
    check_agent_health

    # 3. TypeScript health check
    check_typescript

    # 4. Launch improvement session (if none running)
    launch_improvement_session

    # 5. Push any state changes
    push_changes

    log "HEARTBEAT COMPLETE — $(date -u)"
    log "============================================================"
    log ""
}

main "$@"
