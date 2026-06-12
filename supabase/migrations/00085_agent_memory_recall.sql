-- 00085_agent_memory_recall.sql
-- Wires agent_memory for shared recall: dedup guard, recall/touch RPCs, weekly decay.
-- Design: agent-memory-design.md (2026-06-09)
-- Applied to prod via MCP apply_migration on 2026-06-09.

create extension if not exists pg_cron;

-- 1. Dedup guard: one active memory per (scope-key, title)
create unique index if not exists idx_agent_memory_title_dedup
  on agent_memory (coalesce(project_id::text, agent_key, scope), lower(title))
  where is_active = true;

-- 2. Recall RPC: pinned first, then scoped trigram matches, then recent high-relevance
create or replace function recall_memory(
  p_query text default null,
  p_project_id uuid default null,
  p_agent_key text default null,
  p_limit int default 8
) returns table (id uuid, type text, title text, content text, pinned boolean, score real)
language sql stable as $$
  with candidates as (
    select m.*,
      ( (case when m.pinned then 100 else 0 end)
      + (case when p_project_id is not null and m.project_id = p_project_id then 40 else 0 end)
      + (case when p_agent_key is not null and m.agent_key = p_agent_key then 30 else 0 end)
      + (case when m.scope = 'global' then 10 else 0 end)
      + coalesce(m.relevance_score, 0)
      + least(m.hit_count, 20)
      + (case when p_query is not null
              then greatest(similarity(m.content, p_query), similarity(m.title, p_query)) * 60
              else 0 end)
      - (case when m.last_used_at < now() - interval '60 days' then 15 else 0 end)
      )::real as score
    from agent_memory m
    where m.is_active = true
      and (m.scope = 'global'
           or (p_project_id is not null and m.project_id = p_project_id)
           or (p_agent_key is not null and m.agent_key = p_agent_key))
  )
  select id, type, title, content, pinned, score
  from candidates
  where pinned or score > 15
  order by score desc
  limit p_limit;
$$;

-- 3. Touch: recall callers bump usage stats (fire-and-forget)
create or replace function touch_memory(p_ids uuid[]) returns void
language sql as $$
  update agent_memory
  set hit_count = hit_count + 1, last_used_at = now()
  where id = any(p_ids);
$$;

-- 4. Weekly decay (Sun 03:00 UTC): soft-retire untouched, unpinned memories
select cron.schedule('agent-memory-decay', '0 3 * * 0', $cron$
  update agent_memory set is_active = false
  where is_active = true and pinned = false
    and coalesce(last_used_at, created_at) < now() - interval '120 days'
    and hit_count < 3;
$cron$);
