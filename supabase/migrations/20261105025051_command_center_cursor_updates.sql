-- Read only the next page's lightweight keys. Hydration and photo signing happen
-- separately, so a long history does not become a large initial payload.
create index if not exists daily_logs_feed_cursor_idx
  on public.daily_logs (started_at desc, (id::text) collate "C" desc)
  where status = 'in_progress'
    or btrim(coalesce(text, ''), E' \t\n\r\f\013') <> ''
    or cardinality(photo_storage_paths) > 0;

create index if not exists company_feed_posts_cursor_idx
  on public.company_feed_posts (created_at desc, (id::text) collate "C" desc);

-- A group's earliest member is its representative. These two indexes allow
-- seeking by date and checking for an earlier member without a full GROUP BY.
create index if not exists todos_punch_feed_cursor_idx
  on public.todos (
    (coalesce(created_at, '1970-01-01 00:00:00+00'::timestamptz)) desc,
    (coalesce(punch_session_id::text, 'solo-' || id::text)) collate "C" desc
  ) where category = 'punch_list';

create index if not exists todos_punch_feed_members_idx
  on public.todos (punch_session_id,
    (coalesce(created_at, '1970-01-01 00:00:00+00'::timestamptz)), id)
  where category = 'punch_list';

create or replace function public.command_center_update_keys(
  p_before_at timestamptz default null,
  p_before_source text default null,
  p_before_id text default null,
  p_limit integer default 21
)
returns table (source text, source_id text, occurred_at text)
language plpgsql stable security invoker
set search_path = ''
as $$
declare
  page_limit integer := least(greatest(coalesce(p_limit, 21), 1), 21);
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if (p_before_at is null) <> (p_before_source is null)
    or (p_before_at is null) <> (p_before_id is null)
    or (p_before_source is not null and p_before_source not in ('daily_log', 'company_post', 'punch_group')) then
    raise exception 'Invalid updates cursor' using errcode = '22023';
  end if;

  return query
  with candidates as (
    (select 'daily_log'::text as src, d.id::text collate "C" as sid, d.started_at as ts
      from public.daily_logs d
      where (d.status = 'in_progress'
        or btrim(coalesce(d.text, ''), E' \t\n\r\f\013') <> ''
        or cardinality(d.photo_storage_paths) > 0)
        and d.started_at <= coalesce(p_before_at, 'infinity'::timestamptz)
        and (p_before_at is null or (d.started_at, 'daily_log'::text collate "C", d.id::text collate "C")
          < (p_before_at, p_before_source collate "C", p_before_id collate "C"))
      order by d.started_at desc, d.id::text collate "C" desc
      limit page_limit)
    union all
    (select 'company_post'::text, p.id::text collate "C", p.created_at
      from public.company_feed_posts p
      where p.created_at <= coalesce(p_before_at, 'infinity'::timestamptz)
        and (p_before_at is null or (p.created_at, 'company_post'::text collate "C", p.id::text collate "C")
          < (p_before_at, p_before_source collate "C", p_before_id collate "C"))
      order by p.created_at desc, p.id::text collate "C" desc
      limit page_limit)
    union all
    (select 'punch_group'::text,
        coalesce(t.punch_session_id::text, 'solo-' || t.id::text) collate "C",
        coalesce(t.created_at, '1970-01-01 00:00:00+00'::timestamptz)
      from public.todos t
      where t.category = 'punch_list'
        and coalesce(t.created_at, '1970-01-01 00:00:00+00'::timestamptz) <= coalesce(p_before_at, 'infinity'::timestamptz)
        and (p_before_at is null or
          (coalesce(t.created_at, '1970-01-01 00:00:00+00'::timestamptz), 'punch_group'::text collate "C",
            coalesce(t.punch_session_id::text, 'solo-' || t.id::text) collate "C")
          < (p_before_at, p_before_source collate "C", p_before_id collate "C"))
        and (t.punch_session_id is null or not exists (
          select 1 from public.todos earlier
          where earlier.category = 'punch_list' and earlier.punch_session_id = t.punch_session_id
            and (coalesce(earlier.created_at, '1970-01-01 00:00:00+00'::timestamptz), earlier.id)
              < (coalesce(t.created_at, '1970-01-01 00:00:00+00'::timestamptz), t.id)
        ))
      order by coalesce(t.created_at, '1970-01-01 00:00:00+00'::timestamptz) desc,
        coalesce(t.punch_session_id::text, 'solo-' || t.id::text) collate "C" desc
      limit page_limit)
  )
  select c.src, c.sid,
    -- Keep microseconds intact across JSON/JavaScript so ties cannot skip posts.
    to_char(c.ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  from candidates c
  order by c.ts desc, c.src collate "C" desc, c.sid collate "C" desc
  limit page_limit;
end;
$$;

revoke all on function public.command_center_update_keys(timestamptz, text, text, integer) from public, anon;
grant execute on function public.command_center_update_keys(timestamptz, text, text, integer) to authenticated;
