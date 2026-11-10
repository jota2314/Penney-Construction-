-- read_memory searches returned only pinned rules (MCP smoke test 11/10/2026).
-- Pinned memories score +100, more than any query match can earn, and with 36
-- pinned rows every search filled its limit before a single real match: a
-- project memory written a minute earlier never came back even at limit 20.
--
-- With a query, rank by what matches it: text similarity, then the asked-for
-- project or agent. Pinned rules still come back when they match. Without a
-- query (start_agent_run loading a run's memories) nothing changes: pinned
-- first, then project/agent/global as before.
create or replace function public.recall_memory(
  p_query text default null, p_project_id uuid default null, p_agent_key text default null, p_limit integer default 8
) returns table(id uuid, type text, title text, content text, pinned boolean, score real)
language sql
stable
as $function$
  with candidates as (
    select m.*,
      (case when p_query is not null
            then greatest(similarity(m.content, p_query), similarity(m.title, p_query))
            else 0 end)::real as sim,
      (p_project_id is not null and m.project_id = p_project_id) as project_match,
      (p_agent_key is not null and m.agent_key = p_agent_key) as agent_match
    from agent_memory m
    where m.is_active = true
      and (m.scope = 'global'
           or (p_project_id is not null and m.project_id = p_project_id)
           or (p_agent_key is not null and m.agent_key = p_agent_key))
  ), scored as (
    select c.*,
      ( (case when c.pinned then 100 else 0 end)
      + (case when c.project_match then 40 else 0 end)
      + (case when c.agent_match then 30 else 0 end)
      + (case when c.scope = 'global' then 10 else 0 end)
      + coalesce(c.relevance_score, 0)
      + least(c.hit_count, 20)
      + c.sim * 60
      - (case when c.last_used_at < now() - interval '60 days' then 15 else 0 end)
      )::real as base_score,
      ( c.sim * 100
      + (case when c.project_match then 40 else 0 end)
      + (case when c.agent_match then 30 else 0 end)
      + (case when c.pinned then 5 else 0 end)
      + least(c.hit_count, 20) * 0.25
      )::real as query_score
    from candidates c
  )
  select s.id, s.type, s.title, s.content, s.pinned,
         (case when p_query is null then s.base_score else s.query_score end)::real as score
  from scored s
  where (p_query is null and (s.pinned or s.base_score > 15))
     or (p_query is not null and (s.sim >= 0.1 or s.project_match or s.agent_match))
  order by (case when p_query is null then s.base_score else s.query_score end) desc
  limit p_limit;
$function$;
