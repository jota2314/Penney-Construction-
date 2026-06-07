---
description: Save this session's work to Jorge's persistent Claude memory in Supabase
argument-hint: [optional note on what to emphasize]
---

Write what we did this session to my persistent memory in Supabase (project
`kozgjatzmllhvqwqbzzy`) using the Supabase MCP `execute_sql` tool.

**Before writing, show me a short bullet list of exactly what you're about to save and
let me confirm or adjust.** Then write it and tell me what landed.

What to save:

1. **A journal entry for today** — one row in `claude_journal`:
   `insert into claude_journal (area, summary, details, session_id) values ('<estimate|app|admin|mcp|other>', '<one-line: what we did>', '<details: decisions made, next steps>', '<session id if known>');`

2. **Durable facts / decisions / preferences / gotchas / open todos** — upsert into
   `claude_memory` (update existing rows, don't pile on near-duplicates):
   ```sql
   insert into claude_memory (category, title, body, tags, priority) values (…)
   on conflict (lower(title)) where status = 'active'
     do update set body = excluded.body, category = excluded.category,
                   tags = excluded.tags, priority = excluded.priority, updated_at = now();
   ```
   Categories: `preference | project_context | workflow | decision | contact | gotcha | todo | note`.
   Priority: higher = surfaced first on the next `/load-memory`.

3. **Archive anything we finished** this session instead of leaving it open:
   `update claude_memory set status = 'archived', updated_at = now() where lower(title) = lower('<title>');`

Keep it tight and high-signal. Emphasis for this save (if any): $ARGUMENTS
