-- Per-project card counters for the /projects list.
--
-- The page used to pull raw rows for each of these and count them in JS:
--   inbox_emails (last 7d)  -> ~1,141 rows
--   quote_requests (last 7d)
--   todos (open)
--   walkthroughs (all)
-- PostgREST caps .select() at 1000 rows, so the email heat score was silently
-- truncated — the busiest projects were undercounted. Aggregating in Postgres
-- fixes the correctness bug and collapses four queries into one small result
-- set (one row per project instead of thousands).
--
-- security invoker so RLS still applies exactly as it did for the direct
-- table reads this replaces.

create or replace function public.project_card_stats(since timestamptz)
returns table (
  project_id uuid,
  email_count bigint,
  quote_count bigint,
  open_todo_count bigint,
  walkthrough_count bigint,
  walkthrough_latest timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    p.id as project_id,
    coalesce(e.c, 0) as email_count,
    coalesce(q.c, 0) as quote_count,
    coalesce(t.c, 0) as open_todo_count,
    coalesce(w.c, 0) as walkthrough_count,
    w.latest as walkthrough_latest
  from projects p
  left join (
    select project_id, count(*) c
    from inbox_emails
    where project_id is not null and date >= since
    group by project_id
  ) e on e.project_id = p.id
  left join (
    select project_id, count(*) c
    from quote_requests
    where project_id is not null and created_at >= since
    group by project_id
  ) q on q.project_id = p.id
  left join (
    select project_id, count(*) c
    from todos
    where project_id is not null and status = 'open'
    group by project_id
  ) t on t.project_id = p.id
  left join (
    select project_id, count(*) c, max(visited_at) latest
    from walkthroughs
    where project_id is not null
    group by project_id
  ) w on w.project_id = p.id;
$$;

grant execute on function public.project_card_stats(timestamptz) to authenticated;
