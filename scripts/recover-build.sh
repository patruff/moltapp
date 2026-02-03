#!/bin/bash
# Recovery script: called by heartbeat when builds are stale (no commits in 30 min)
# Fixes TS errors, commits partial work, and relaunches a fresh build
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_LOG="$SCRIPT_DIR/build.log"

cd "$PROJECT_DIR"
echo "=== RECOVERY START: $(date -u) ===" >> "$BUILD_LOG"

# Kill any stale build processes
pkill -f "run-build.sh" 2>/dev/null
sleep 2

# Check if there are uncommitted changes worth saving
CHANGED=$(git status --short | grep -v "scripts/" | wc -l | tr -d ' ')
echo "Recovery: found $CHANGED changed files" >> "$BUILD_LOG"

if [ "$CHANGED" -gt 0 ]; then
    # Try to fix TypeScript errors
    echo "Recovery: checking TypeScript build..." >> "$BUILD_LOG"
    TSC_OUTPUT=$(npx tsc --noEmit 2>&1)
    TSC_EXIT=$?

    if [ "$TSC_EXIT" -ne 0 ]; then
        echo "Recovery: TS errors found, attempting auto-fix..." >> "$BUILD_LOG"

        # Load env for claude (but not ANTHROPIC_API_KEY)
        if [ -f "$PROJECT_DIR/.env" ]; then
            set -a; source "$PROJECT_DIR/.env"; set +a
            unset ANTHROPIC_API_KEY
        fi

        # Use claude to fix TS errors (short focused session)
        claude -p "Fix all TypeScript compilation errors in /Users/patruff/moltapp. Run 'npx tsc --noEmit' to see them, then fix each error. Current errors: $TSC_OUTPUT. Only fix errors, don't add features. After fixing, verify with npx tsc --noEmit." \
            --dangerously-skip-permissions 2>&1 | tail -20 >> "$BUILD_LOG"
    fi

    # Check again after fix attempt
    if npx tsc --noEmit 2>/dev/null; then
        echo "Recovery: TypeScript builds clean, committing..." >> "$BUILD_LOG"
        git add -A
        git commit -m "feat: recovered partial build — $(git diff --cached --stat | tail -1)" 2>/dev/null
        git push origin main 2>/dev/null
        echo "Recovery: committed and pushed" >> "$BUILD_LOG"
    else
        echo "Recovery: TS still broken, stashing changes" >> "$BUILD_LOG"
        git stash 2>/dev/null
    fi
else
    echo "Recovery: no uncommitted changes" >> "$BUILD_LOG"
fi

echo "=== RECOVERY END: $(date -u) ===" >> "$BUILD_LOG"

# Relaunch a fresh build
echo "Recovery: launching fresh build..." >> "$BUILD_LOG"
nohup bash "$SCRIPT_DIR/run-build.sh" < /dev/null > /dev/null 2>&1 &
echo "Recovery: new build PID $!" >> "$BUILD_LOG"
