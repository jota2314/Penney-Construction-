---
description: Load Jorge's persistent Claude memory from Supabase and brief me on where we left off
---

Read my persistent memory from Supabase (project `kozgjatzmllhvqwqbzzy`) using the
Supabase MCP `execute_sql` tool, then give me a tight "where we left off" briefing.

Run these two queries:

1. `select category, title, body, tags, priority from claude_memory where status = 'active' order by priority desc, updated_at desc;`
2. `select to_char(entry_date,'YYYY-MM-DD') as day, area, summary, details from claude_journal order by entry_date desc, created_at desc limit 15;`

Then summarize for me — don't dump raw rows:
- **Open todos**, highest priority first (these are the things on my plate)
- **Recent sessions** — what got worked on lately
- **Preferences / gotchas** worth keeping in mind this session

If any todo looks like it might already be done, ask whether I want to archive it.
