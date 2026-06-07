#!/bin/bash
# ============================================================
# SessionStart hook — load Claude's persistent memory
# ============================================================
# Claude Code on the web starts every session in a fresh, empty
# container. This hook injects a directive (as SessionStart
# additionalContext) telling Claude to load Jorge's working memory
# from Supabase on turn one, so it already knows what's going on.
#
# Two modes, chosen automatically:
#   1. If Supabase REST creds are present in the env
#      (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY or SUPABASE_KEY),
#      the hook fetches the memory itself and injects the actual
#      content — Claude knows before it even responds.
#   2. Otherwise (the default today — no secrets in the container),
#      it injects an instruction telling Claude to read the memory
#      via the connected Supabase MCP.
#
# Either way it never blocks or errors the session: any failure
# falls back to the MCP directive.
set -uo pipefail

PROJECT_REF="kozgjatzmllhvqwqbzzy"
SUPA_URL="${SUPABASE_URL:-https://${PROJECT_REF}.supabase.co}"
SUPA_KEY="${SUPABASE_SERVICE_ROLE_KEY:-${SUPABASE_KEY:-}}"

# The fallback directive: have Claude load memory through the Supabase MCP.
read -r -d '' DIRECTIVE <<EOF
## 📓 Persistent Claude Memory — load it now

You have a durable, cross-session memory in Supabase (project ${PROJECT_REF}).
Before responding, load it via the **Supabase MCP** \`execute_sql\` tool so you
know what Jorge has been working on (estimates, app features, admin) and which
threads are open:

  select category, title, body, tags, priority
  from claude_memory where status = 'active'
  order by priority desc, updated_at desc;

  select to_char(entry_date,'YYYY-MM-DD') as day, area, summary, details
  from claude_journal order by entry_date desc, created_at desc limit 15;

When Jorge says "save" / "remember", or when meaningful work wraps up, write
back with \`execute_sql\`: add a \`claude_journal\` row for today and upsert any
durable facts into \`claude_memory\`. See CLAUDE.md → "Claude Memory Protocol".
EOF

CONTEXT="$DIRECTIVE"

# Mode 1: creds present → fetch the memory directly and inject it.
if [ -n "$SUPA_KEY" ]; then
  MEM=$(curl -s --max-time 8 \
    "${SUPA_URL}/rest/v1/claude_memory?select=category,title,body,priority&status=eq.active&order=priority.desc,updated_at.desc" \
    -H "apikey: ${SUPA_KEY}" -H "Authorization: Bearer ${SUPA_KEY}" 2>/dev/null || true)
  JRN=$(curl -s --max-time 8 \
    "${SUPA_URL}/rest/v1/claude_journal?select=entry_date,area,summary&order=entry_date.desc&limit=15" \
    -H "apikey: ${SUPA_KEY}" -H "Authorization: Bearer ${SUPA_KEY}" 2>/dev/null || true)

  if [ -n "$MEM" ] && [ "${MEM:0:1}" = "[" ]; then
    FACTS=$(printf '%s' "$MEM"  | jq -r '.[] | "- [\(.category)] \(.title): \(.body)"' 2>/dev/null || true)
    LOG=$(printf '%s'   "$JRN"  | jq -r '.[] | "- \(.entry_date) (\(.area)): \(.summary)"' 2>/dev/null || true)
    CONTEXT=$(printf '## 📓 Persistent Claude Memory (loaded from Supabase)\n\n### What you know\n%s\n\n### Recent sessions\n%s\n\nWhen Jorge says "save"/"remember" or work wraps up, write back to claude_memory / claude_journal via the Supabase MCP. See CLAUDE.md → "Claude Memory Protocol".' \
      "${FACTS:-(none yet)}" "${LOG:-(none yet)}")
  fi
fi

# Emit as SessionStart additionalContext (jq handles JSON escaping).
jq -n --arg ctx "$CONTEXT" \
  '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $ctx}}'
