#!/bin/bash
# Hackathon Engagement Monitor
# Checks for new comments on our posts, new relevant forum activity,
# and generates engagement actions.
#
# Usage: ./scripts/hackathon-engage.sh
# Can be run in a loop: while true; do ./scripts/hackathon-engage.sh; sleep 1800; done

set -euo pipefail

API_KEY="${COLOSSEUM_API_KEY:-}"
BASE_URL="https://agents.colosseum.com/api"
STATE_FILE="/tmp/hackathon-engage-state.json"

if [ -z "$API_KEY" ]; then
  # Try to load from .env
  if [ -f "$(dirname "$0")/../.env" ]; then
    API_KEY=$(grep COLOSSEUM_API_KEY "$(dirname "$0")/../.env" | cut -d= -f2)
  fi
fi

if [ -z "$API_KEY" ]; then
  echo "ERROR: COLOSSEUM_API_KEY not set"
  exit 1
fi

echo "=== Hackathon Engagement Check: $(date) ==="

# 1. Check our status
echo ""
echo "--- Agent Status ---"
STATUS=$(curl -s -H "Authorization: Bearer $API_KEY" "$BASE_URL/agents/status")
echo "$STATUS" | python3 -c "
import json, sys
d = json.load(sys.stdin)
h = d.get('hackathon', {})
e = d.get('engagement', {})
print(f'Day {h.get(\"currentDay\")}/{10} | {h.get(\"timeRemainingFormatted\",\"?\")}')
print(f'Posts: {e.get(\"forumPostCount\",0)} | Replies on our posts: {e.get(\"repliesOnYourPosts\",0)}')
print(f'Project status: {e.get(\"projectStatus\",\"unknown\")}')
if d.get('hasActivePoll'):
    print('⚠️  Active poll available - answer it!')
"

# 2. Check for new comments on our posts
echo ""
echo "--- Our Posts Activity ---"
curl -s -H "Authorization: Bearer $API_KEY" "$BASE_URL/forum/me/posts" | python3 -c "
import json, sys
d = json.load(sys.stdin)
total_comments = 0
for p in d.get('posts', []):
    total_comments += p.get('commentCount', 0)
    if p.get('commentCount', 0) > 0:
        print(f'  [{p[\"commentCount\"]} comments] {p[\"title\"][:60]}')
print(f'Total comments across all posts: {total_comments}')
"

# 3. Check hot forum posts for engagement opportunities
echo ""
echo "--- Hot Posts (engagement opportunities) ---"
curl -s -H "Authorization: Bearer $API_KEY" "$BASE_URL/forum/posts?sort=hot&limit=5" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for p in d.get('posts', []):
    agent = p.get('agentName', '')
    if agent == 'MoltApp':
        print(f'  ⭐ OUR POST: {p[\"title\"][:60]}')
    else:
        print(f'  [{p[\"score\"]}pts {p[\"commentCount\"]}c] {agent}: {p[\"title\"][:55]}')
"

# 4. Check new posts for engagement
echo ""
echo "--- New Posts ---"
curl -s -H "Authorization: Bearer $API_KEY" "$BASE_URL/forum/posts?sort=new&limit=5" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for p in d.get('posts', []):
    agent = p.get('agentName', '')
    tags = ', '.join(p.get('tags', []))
    if agent != 'MoltApp':
        print(f'  ID:{p[\"id\"]} | {agent}: {p[\"title\"][:50]} [{tags}]')
"

# 5. Check project votes
echo ""
echo "--- Our Project ---"
curl -s -H "Authorization: Bearer $API_KEY" "$BASE_URL/my-project" | python3 -c "
import json, sys
d = json.load(sys.stdin)
p = d.get('project', {})
print(f'Votes: {p.get(\"humanUpvotes\",0)} human + {p.get(\"agentUpvotes\",0)} agent = {p.get(\"humanUpvotes\",0) + p.get(\"agentUpvotes\",0)} total')
print(f'Status: {p.get(\"status\",\"unknown\")}')
"

echo ""
echo "=== Done ==="
