-- A site QR permits a narrowly scoped photo post without a profile or PIN.
-- Guests are explicitly identified; never borrow an employee/subcontractor ID.
alter table public.daily_logs
  add column is_site_guest boolean not null default false,
  add column site_guest_name text;

alter table public.daily_logs drop constraint daily_logs_author_or_sub_check;
alter table public.daily_logs add constraint daily_logs_author_or_sub_check
  check (author_id is not null or subcontractor_id is not null or is_site_guest);

alter table public.daily_logs add constraint daily_logs_site_guest_shape
  check (
    (not is_site_guest and site_guest_name is null)
    or (
      is_site_guest
      and author_id is null and subcontractor_id is null
      and kind = 'post' and status = 'completed'
      and project_id is not null
      and ended_at is not null and ended_at = started_at
      and cardinality(photo_storage_paths) > 0
      and schedule_phase_id is null and master_phase_id is null
      and estimate_line_item_id is null and line_item_source is null
      and not line_item_needs_review and line_item_note is null
      and not report_required and report_submitted_at is null
      and daily_report_id is null and report_progress is null
      and not auto_clocked_out
      and (site_guest_name is null or (char_length(btrim(site_guest_name)) between 1 and 120))
    )
  );

-- RLS remains enabled; no anonymous table/storage grant or public write policy.
-- Only the server's code-validated service route may create guest attribution.
-- Existing authorized edit/photo/hide actions use their checked admin client.
create policy "Guest photo creation requires site service"
  on public.daily_logs as restrictive for insert to authenticated
  with check (not is_site_guest);
create policy "Guest photo updates require site service"
  on public.daily_logs as restrictive for update to authenticated
  using (not is_site_guest) with check (not is_site_guest);

create index daily_logs_guest_project_created_idx
  on public.daily_logs(project_id, created_at desc) where is_site_guest;

-- Serialize the final insert per project, so concurrent public submissions
-- cannot race past the hourly cap. A retry still reaches its existing PK.
create function public.limit_site_guest_photo_posts()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if not new.is_site_guest then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('site-guest:' || new.project_id::text, 0));
  if exists(select 1 from public.daily_logs where id = new.id) then return new; end if;
  if (select count(*) from public.daily_logs
      where is_site_guest and project_id = new.project_id
        and created_at >= now() - interval '1 hour') >= 60 then
    raise exception 'site_guest_hourly_limit' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.limit_site_guest_photo_posts() from public, anon, authenticated;
create trigger limit_site_guest_photo_posts before insert on public.daily_logs
  for each row execute function public.limit_site_guest_photo_posts();

-- A guest photo is not a crew task or a labor-allocation exception. Preserve
-- the existing task stamping exactly for employee and subcontractor rows.
create or replace function public.stamp_active_task_on_post()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  active_task record;
  active_count integer;
begin
  if new.is_site_guest or new.subcontractor_id is not null or new.project_id is null
    or new.report_required or new.status <> 'completed'
    or new.ended_at is distinct from new.started_at then
    return new;
  end if;

  if new.schedule_phase_id is null and new.estimate_line_item_id is null then
    select count(*) into active_count from public.daily_logs d
      where d.author_id = new.author_id and d.project_id = new.project_id
        and d.status = 'in_progress' and d.ended_at is null
        and d.started_at <= new.started_at;
    if active_count = 1 then
      select d.schedule_phase_id,
        coalesce(d.estimate_line_item_id, p.estimate_line_item_id) as line_id
        into active_task
        from public.daily_logs d
        left join public.schedule_phases p on p.id = d.schedule_phase_id
          and p.project_id = new.project_id
        where d.author_id = new.author_id and d.project_id = new.project_id
          and d.status = 'in_progress' and d.ended_at is null
          and d.started_at <= new.started_at;
      new.schedule_phase_id := active_task.schedule_phase_id;
      new.estimate_line_item_id := active_task.line_id;
    end if;
  end if;
  if new.estimate_line_item_id is null then
    new.line_item_needs_review := true;
  end if;
  return new;
end;
$$;
revoke all on function public.stamp_active_task_on_post() from public, anon, authenticated;
