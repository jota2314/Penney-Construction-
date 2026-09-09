-- Allow a written daily report without requiring or inventing task completion.
-- Existing structured reports and quick-update exclusion remain supported.
create or replace function public.valid_daily_report_progress(p jsonb)
returns boolean language sql immutable security invoker set search_path = '' as $$
  select coalesce(p = '{"mode":"narrative"}'::jsonb, false) or coalesce(jsonb_typeof(p)='object'
    and p->>'status' in ('remaining','finished')
    and jsonb_typeof(p->'remaining')='string'
    and jsonb_typeof(p->'timeNeeded')='string'
    and jsonb_typeof(p->'blockers')='string'
    and length(btrim(p->>'blockers')) between 1 and 1500
    and length(p->>'remaining') <= 1500 and length(p->>'timeNeeded') <= 200
    and (p->>'status'='finished' or
      (length(btrim(p->>'remaining'))>0 and length(btrim(p->>'timeNeeded'))>0)),false);
$$;
revoke all on function public.valid_daily_report_progress(jsonb) from public,anon;
grant execute on function public.valid_daily_report_progress(jsonb) to authenticated;
