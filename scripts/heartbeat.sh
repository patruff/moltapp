#!/bin/bash
# MoltApp Colosseum Heartbeat Agent
# Runs every ~30 minutes — fully autonomous, no human interaction
#
# What it does each run:
# 1. Checks skill.md version for updates
# 2. Checks agent status on Colosseum
# 3. Monitors leaderboard position
# 4. Posts forum updates (1-2 per day, rate-limited)
# 5. Replies to comments on our posts
# 6. Votes/comments on other projects
# 7. Launches Claude Code build sessions if none running
# 8. Updates project description with progress
# 9. Pushes git changes
#
# Usage: ./scripts/heartbeat.sh
# Install: ./scripts/install-heartbeat.sh

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

API_BASE="https://agents.colosseum.com/api"
SKILL_URL="https://colosseum.com/skill.md"

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
    "skill_version": "",
    "last_forum_post_time": 0,
    "last_comment_check_time": 0,
    "last_vote_time": 0,
    "forum_posts_today": 0,
    "forum_posts_date": "",
    "voted_projects": [],
    "voted_posts": [],
    "replied_comments": [],
    "leaderboard_rank": 0,
    "leaderboard_votes": 0,
    "heartbeat_count": 0,
    "build_sessions_launched": 0
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

# --- API helpers ---
colosseum_get() {
    local endpoint="$1"
    curl -s -H "Authorization: Bearer $COLOSSEUM_API_KEY" \
         -H "Content-Type: application/json" \
         "$API_BASE$endpoint"
}

colosseum_post() {
    local endpoint="$1" data="$2"
    curl -s -X POST \
         -H "Authorization: Bearer $COLOSSEUM_API_KEY" \
         -H "Content-Type: application/json" \
         -d "$data" \
         "$API_BASE$endpoint"
}

colosseum_put() {
    local endpoint="$1" data="$2"
    curl -s -X PUT \
         -H "Authorization: Bearer $COLOSSEUM_API_KEY" \
         -H "Content-Type: application/json" \
         -d "$data" \
         "$API_BASE$endpoint"
}

# --- OpenAI for content generation ---
generate_content() {
    local system_prompt="$1"
    local user_prompt="$2"
    local max_tokens="${3:-500}"

    # Escape for JSON
    local sys_escaped=$(echo "$system_prompt" | jq -Rs .)
    local usr_escaped=$(echo "$user_prompt" | jq -Rs .)

    local response
    response=$(curl -s https://api.openai.com/v1/chat/completions \
        -H "Authorization: Bearer $OPENAI_API_KEY" \
        -H "Content-Type: application/json" \
        -d "{
            \"model\": \"gpt-4o-mini\",
            \"messages\": [
                {\"role\": \"system\", \"content\": $sys_escaped},
                {\"role\": \"user\", \"content\": $usr_escaped}
            ],
            \"max_tokens\": $max_tokens,
            \"temperature\": 0.8
        }" 2>/dev/null)

    local content
    content=$(echo "$response" | jq -r '.choices[0].message.content // "Failed to generate content"' 2>/dev/null)

    # Strip markdown code fences if present (OpenAI often wraps JSON in ```json...```)
    content=$(echo "$content" | sed 's/^```json//; s/^```//; s/```$//' | sed '/^$/d')

    echo "$content"
}

# ============================================================
# HEARTBEAT TASKS
# ============================================================

# 1. Check skill.md version
check_skill_version() {
    log "Checking skill.md version..."
    local version
    version=$(curl -s "$SKILL_URL" | head -10 | grep -o 'version: [0-9.]*' | head -1 | awk '{print $2}')

    local stored_version=$(get_state "skill_version")

    if [ -n "$version" ] && [ "$version" != "$stored_version" ]; then
        log "Skill version changed: $stored_version -> $version"
        set_state "skill_version" "\"$version\""

        if [ -n "$stored_version" ]; then
            log "IMPORTANT: Skill version updated! May need to fetch new endpoints."
        fi
    else
        log "Skill version: $version (unchanged)"
    fi
}

# 2. Check agent status
check_agent_status() {
    log "Checking agent status..."
    local status
    status=$(colosseum_get "/agents/status")

    local claim_status=$(echo "$status" | jq -r '.status // "unknown"' 2>/dev/null)
    local forum_posts=$(echo "$status" | jq -r '.engagement.forumPostCount // 0' 2>/dev/null)
    local replies=$(echo "$status" | jq -r '.engagement.repliesOnYourPosts // 0' 2>/dev/null)
    local project_status=$(echo "$status" | jq -r '.engagement.projectStatus // "none"' 2>/dev/null)

    log "Claim: $claim_status | Posts: $forum_posts | Replies: $replies | Project: $project_status"

    local next_steps=$(echo "$status" | jq -r '.nextSteps // [] | .[]' 2>/dev/null)
    if [ -n "$next_steps" ]; then
        echo "$next_steps" | while IFS= read -r step; do
            log "  Next: $step"
        done
    fi
}

# 3. Monitor leaderboard
check_leaderboard() {
    log "Checking leaderboard..."
    local leaderboard
    leaderboard=$(colosseum_get "/hackathons/1/leaderboard" 2>/dev/null || colosseum_get "/leaderboard" 2>/dev/null)

    if [ -z "$leaderboard" ] || [ "$leaderboard" = "null" ]; then
        log "Could not fetch leaderboard"
        return
    fi

    # Find our position (API uses .entries[].rank and .entries[].project)
    local our_entry=$(echo "$leaderboard" | jq -r '.entries // [] | .[] | select(.project.name == "MoltApp" or .project.slug == "moltapp")' 2>/dev/null)
    local our_rank=$(echo "$our_entry" | jq -r '.rank // empty' 2>/dev/null)
    local our_votes=$(echo "$our_entry" | jq -r '.project.humanUpvotes // 0' 2>/dev/null)
    local total_projects=$(echo "$leaderboard" | jq -r '.entries // [] | length' 2>/dev/null)

    local prev_rank=$(get_state "leaderboard_rank")
    local prev_votes=$(get_state "leaderboard_votes")

    if [ -n "$our_rank" ] && [ "$our_rank" != "null" ] && [ "$our_rank" != "" ]; then
        log "Leaderboard: Rank #$our_rank of $total_projects | Votes: $our_votes (was: $prev_votes)"
        set_state "leaderboard_rank" "$our_rank"
        set_state "leaderboard_votes" "${our_votes:-0}"

        if [ -n "$prev_rank" ] && [ "$prev_rank" != "0" ] && [ "$our_rank" -lt "$prev_rank" ]; then
            log "RANK UP! #$prev_rank -> #$our_rank"
        elif [ -n "$prev_rank" ] && [ "$prev_rank" != "0" ] && [ "$our_rank" -gt "$prev_rank" ]; then
            log "Rank dropped: #$prev_rank -> #$our_rank"
        fi
    else
        log "MoltApp not found on leaderboard yet (may need to submit project first)"
    fi

    # Log top 5
    local top5=$(echo "$leaderboard" | jq -r '.entries // [] | .[0:5] | .[] | "#\(.rank) \(.project.name): \(.project.humanUpvotes // 0)h/\(.project.agentUpvotes // 0)a votes"' 2>/dev/null)
    if [ -n "$top5" ]; then
        log "Top 5:"
        echo "$top5" | while IFS= read -r line; do
            log "  $line"
        done
    fi
}

# 4. Post forum updates (1-2 per day)
post_forum_update() {
    local today=$(date -u +%Y-%m-%d)
    local posts_date=$(get_state "forum_posts_date")
    local posts_today=$(get_state "forum_posts_today")

    # Reset counter if new day
    if [ "$posts_date" != "$today" ]; then
        set_state "forum_posts_date" "\"$today\""
        set_state "forum_posts_today" "0"
        posts_today=0
    fi

    # Max 2 posts per day
    if [ "${posts_today:-0}" -ge 2 ]; then
        log "Already posted $posts_today times today, skipping forum post"
        return
    fi

    # Check time since last post (at least 6 hours between posts)
    local last_post_time=$(get_state "last_forum_post_time")
    local now=$(date +%s)
    local min_interval=21600  # 6 hours in seconds

    if [ -n "$last_post_time" ] && [ "$last_post_time" != "0" ]; then
        local elapsed=$((now - last_post_time))
        if [ "$elapsed" -lt "$min_interval" ]; then
            log "Last post was $(( elapsed / 3600 ))h ago, waiting for 6h interval"
            return
        fi
    fi

    log "Generating forum progress update..."

    # Get current project state for context
    local state_summary=""
    if [ -f "$PROJECT_DIR/.planning/STATE.md" ]; then
        state_summary=$(head -30 "$PROJECT_DIR/.planning/STATE.md")
    fi

    local recent_commits=$(cd "$PROJECT_DIR" && git log --oneline -5 2>/dev/null || echo "no recent commits")
    local heartbeat_count=$(get_state "heartbeat_count")

    local content
    content=$(generate_content \
        "You are MoltApp, an AI agent competing in the Colosseum Agent Hackathon on Solana. You're a competitive stock trading platform where AI agents trade real tokenized stocks (AAPL, TSLA, NVDA etc.) via xStocks/Jupiter. Write forum posts that are genuine, technical, and engaging. Never use hashtags. Keep it concise (3-8 paragraphs). Use markdown. Don't be salesy — share real technical progress." \
        "Write a progress update for the Colosseum hackathon forum. Here's what's happened recently:

Recent commits: $recent_commits

Project state: $state_summary

Heartbeat cycle: #$heartbeat_count

Write a post with a catchy title and body. Focus on what we've built, technical details, or interesting challenges. Vary the topic — sometimes talk about architecture, sometimes about features, sometimes about what makes MoltApp unique (real stocks not crypto, platform for agents not a single agent). Return as JSON: {\"title\": \"...\", \"body\": \"...\"}")

    # Parse the generated content
    local title=$(echo "$content" | jq -r '.title // empty' 2>/dev/null)
    local body=$(echo "$content" | jq -r '.body // empty' 2>/dev/null)

    if [ -z "$title" ] || [ -z "$body" ]; then
        log "Failed to generate post content, skipping"
        return
    fi

    # Post to forum
    local post_data
    post_data=$(jq -n --arg t "$title" --arg b "$body" '{title: $t, body: $b, tags: ["progress-update", "trading"]}')

    local result
    result=$(colosseum_post "/forum/posts" "$post_data")

    local post_id=$(echo "$result" | jq -r '.post.id // empty' 2>/dev/null)
    if [ -n "$post_id" ]; then
        log "Posted forum update: '$title' (ID: $post_id)"
        set_state "last_forum_post_time" "$now"
        increment_state "forum_posts_today"
    else
        log_error "Failed to post forum update: $result"
    fi
}

# 5. Reply to comments on our posts
reply_to_comments() {
    log "Checking for comments on our posts..."

    # Get our posts via authenticated endpoint
    local our_posts
    our_posts=$(colosseum_get "/forum/me/posts" | jq -r '.posts // [] | .[] | .id' 2>/dev/null)

    if [ -z "$our_posts" ]; then
        log "No posts found to check comments on"
        return
    fi

    local replied_comments=$(jq -r '.replied_comments // [] | .[]' "$STATE_FILE" 2>/dev/null)

    echo "$our_posts" | while IFS= read -r post_id; do
        [ -z "$post_id" ] && continue

        local comments
        comments=$(colosseum_get "/forum/posts/$post_id/comments")

        local comment_ids=$(echo "$comments" | jq -r '.comments // [] | .[] | select(.agentName != "MoltApp") | .id' 2>/dev/null)

        echo "$comment_ids" | while IFS= read -r comment_id; do
            [ -z "$comment_id" ] && continue

            # Skip if already replied
            if echo "$replied_comments" | grep -q "^${comment_id}$"; then
                continue
            fi

            local comment_body=$(echo "$comments" | jq -r ".comments // [] | .[] | select(.id == $comment_id) | .body" 2>/dev/null)
            local comment_author=$(echo "$comments" | jq -r ".comments // [] | .[] | select(.id == $comment_id) | .agentName" 2>/dev/null)

            if [ -n "$comment_body" ]; then
                log "Replying to comment #$comment_id by $comment_author"

                local reply
                reply=$(generate_content \
                    "You are MoltApp, an AI agent in the Colosseum hackathon. You build a stock trading platform for AI agents on Solana. Be friendly, helpful, technical when appropriate. Keep replies concise (1-3 paragraphs). If they're asking a question, answer it. If they're giving feedback, acknowledge it." \
                    "Reply to this comment on our forum post. Comment by $comment_author: $comment_body" \
                    300)

                if [ -n "$reply" ] && [ "$reply" != "Failed to generate content" ]; then
                    local reply_data
                    reply_data=$(jq -n --arg b "$reply" '{body: $b}')

                    local result
                    result=$(colosseum_post "/forum/posts/$post_id/comments" "$reply_data")

                    if echo "$result" | jq -e '.comment.id' > /dev/null 2>&1; then
                        log "Replied to comment #$comment_id"
                        # Track replied comment
                        local tmp=$(mktemp)
                        jq ".replied_comments += [$comment_id]" "$STATE_FILE" > "$tmp" && mv "$tmp" "$STATE_FILE"
                    else
                        log_error "Failed to reply: $result"
                    fi
                fi
            fi
        done
    done
}

# 6. Vote and comment on other projects
engage_other_projects() {
    log "Engaging with other projects..."

    local now=$(date +%s)
    local last_vote_time=$(get_state "last_vote_time")

    # Don't vote too frequently (at least 1 hour between voting sessions)
    if [ -n "$last_vote_time" ] && [ "$last_vote_time" != "0" ]; then
        local elapsed=$((now - last_vote_time))
        if [ "$elapsed" -lt 3600 ]; then
            log "Voted recently, skipping engagement"
            return
        fi
    fi

    # Get projects
    local projects
    projects=$(colosseum_get "/projects")

    local project_ids=$(echo "$projects" | jq -r '.projects // [] | .[] | select(.slug != "moltapp") | .id' 2>/dev/null)
    local voted_projects=$(jq -r '.voted_projects // [] | .[]' "$STATE_FILE" 2>/dev/null)

    local voted_count=0
    local max_votes_per_session=3

    echo "$project_ids" | while IFS= read -r pid; do
        [ -z "$pid" ] && continue
        [ "$voted_count" -ge "$max_votes_per_session" ] && break

        # Skip if already voted
        if echo "$voted_projects" | grep -q "^${pid}$"; then
            continue
        fi

        local project_name=$(echo "$projects" | jq -r ".projects[] | select(.id == $pid) | .name" 2>/dev/null)
        local project_desc=$(echo "$projects" | jq -r ".projects[] | select(.id == $pid) | .description" 2>/dev/null)

        # Vote on the project
        local vote_result
        vote_result=$(colosseum_post "/projects/$pid/vote" '{"vote": "up"}')

        if echo "$vote_result" | jq -e '.success // .vote' > /dev/null 2>&1; then
            log "Upvoted project: $project_name (ID: $pid)"
            local tmp=$(mktemp)
            jq ".voted_projects += [$pid]" "$STATE_FILE" > "$tmp" && mv "$tmp" "$STATE_FILE"
            voted_count=$((voted_count + 1))
        else
            log "Vote result for $project_name: $vote_result"
        fi
    done

    set_state "last_vote_time" "$now"

    # Comment on a forum post from another agent (pick one we haven't engaged with)
    local other_posts
    other_posts=$(colosseum_get "/forum/posts" | jq -r '.posts // [] | .[] | select(.agentName != "MoltApp") | .id' 2>/dev/null | head -5)

    local voted_posts=$(jq -r '.voted_posts // [] | .[]' "$STATE_FILE" 2>/dev/null)

    echo "$other_posts" | head -2 | while IFS= read -r fpid; do
        [ -z "$fpid" ] && continue

        if echo "$voted_posts" | grep -q "^${fpid}$"; then
            continue
        fi

        local post_title=$(colosseum_get "/forum/posts" | jq -r ".posts[] | select(.id == $fpid) | .title" 2>/dev/null)
        local post_body=$(colosseum_get "/forum/posts" | jq -r ".posts[] | select(.id == $fpid) | .body" 2>/dev/null | head -500)
        local post_author=$(colosseum_get "/forum/posts" | jq -r ".posts[] | select(.id == $fpid) | .agentName" 2>/dev/null)

        # Upvote the post
        colosseum_post "/forum/posts/$fpid/vote" '{"vote": "up"}' > /dev/null 2>&1

        # Generate a thoughtful comment
        local comment
        comment=$(generate_content \
            "You are MoltApp, an AI agent in the Colosseum hackathon. You build a stock trading platform for AI agents on Solana. Be genuinely interested in other projects. Ask a real question or share a relevant technical insight. Keep it to 1-2 paragraphs. Don't mention your own project unless directly relevant." \
            "Write a comment on this forum post by $post_author titled '$post_title': $post_body" \
            200)

        if [ -n "$comment" ] && [ "$comment" != "Failed to generate content" ]; then
            local comment_data
            comment_data=$(jq -n --arg b "$comment" '{body: $b}')

            colosseum_post "/forum/posts/$fpid/comments" "$comment_data" > /dev/null 2>&1
            log "Commented on post '$post_title' by $post_author"

            local tmp=$(mktemp)
            jq ".voted_posts += [$fpid]" "$STATE_FILE" > "$tmp" && mv "$tmp" "$STATE_FILE"
        fi

        break  # Only comment on one post per heartbeat
    done
}

# 7. Launch autonomous build session
launch_build_session() {
    # Check if a build is already running
    if [ -f "$BUILD_PID_FILE" ]; then
        local pid=$(cat "$BUILD_PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            log "Build session already running (PID: $pid)"
            return
        else
            log "Previous build session (PID: $pid) has ended"
            rm -f "$BUILD_PID_FILE"
        fi
    fi

    log "Launching autonomous build session..."

    # Determine what to build next by reading state
    local build_prompt="You are the MoltApp autonomous builder running overnight for the Colosseum Agent Hackathon (deadline Feb 12, 2026).

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

You are working AUTONOMOUSLY. Make decisions. Keep building. No questions."

    # Write prompt to file to avoid shell escaping issues
    echo "$build_prompt" > "$SCRIPT_DIR/build-prompt.txt"

    # Launch build in background with proper output capture
    (
        cd "$PROJECT_DIR"
        echo "=== BUILD SESSION START: $(date -u) ==="
        cat "$SCRIPT_DIR/build-prompt.txt" | claude -p --dangerously-skip-permissions --max-budget-usd 2 --model sonnet 2>&1
        echo "=== BUILD SESSION END: $(date -u) ==="
    ) >> "$SCRIPT_DIR/build.log" 2>&1 &
    local new_pid=$!
    echo "$new_pid" > "$BUILD_PID_FILE"
    log "Build session launched (PID: $new_pid)"
    increment_state "build_sessions_launched"
}

# 8. Update project description
update_project_description() {
    log "Updating project description..."

    local recent_commits=$(cd "$PROJECT_DIR" && git log --oneline -3 2>/dev/null | tr '\n' '; ')
    local heartbeat_count=$(get_state "heartbeat_count")
    local rank=$(get_state "leaderboard_rank")

    # Only update every few heartbeats to avoid rate limits
    if [ $((heartbeat_count % 4)) -ne 0 ]; then
        log "Skipping project update (every 4th heartbeat)"
        return
    fi

    local description="Competitive stock trading platform where AI agents trade real tokenized stocks on Solana. Agents authenticate via Moltbook identity, receive custodial wallets with Turnkey HSM security, and trade xStocks tokenized equities (AAPL, TSLA, NVDA) through Jupiter DEX aggregation. Public leaderboard tracks agent performance with P&L metrics. Real money, real stocks, real competition.

Built with Hono, Drizzle ORM, @solana/kit, TypeScript ESM. Deploying to AWS Lambda + Neon PostgreSQL.

Autonomous heartbeat agent running 24/7 — building, engaging, competing. Heartbeat #${heartbeat_count}."

    local update_data
    update_data=$(jq -n --arg d "$description" '{description: $d}')

    colosseum_put "/my-project" "$update_data" > /dev/null 2>&1
    log "Project description updated"
}

# 9. Push git changes
push_changes() {
    cd "$PROJECT_DIR"

    if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
        log "Pushing git changes..."
        git add -A
        git commit -m "heartbeat: autonomous update #$(get_state 'heartbeat_count')

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>" 2>/dev/null || true
        git push origin main 2>/dev/null && log "Pushed to GitHub" || log_error "Failed to push"
    fi
}

# ============================================================
# MAIN HEARTBEAT LOOP
# ============================================================

main() {
    log "============================================================"
    log "HEARTBEAT START — $(date -u)"
    log "============================================================"

    init_state
    increment_state "heartbeat_count"
    local count=$(get_state "heartbeat_count")
    log "Heartbeat #$count"

    # Always run these
    check_skill_version
    check_agent_status
    check_leaderboard

    # Forum engagement (smart rate limiting)
    post_forum_update
    reply_to_comments

    # Engage with community (every other heartbeat)
    if [ $((count % 2)) -eq 0 ]; then
        engage_other_projects
    fi

    # Build (check/launch every heartbeat)
    launch_build_session

    # Update project (every 4th heartbeat ~2 hours)
    update_project_description

    # Push any changes
    push_changes

    log "HEARTBEAT COMPLETE — $(date -u)"
    log "============================================================"
    log ""
}

# Run
main "$@"
