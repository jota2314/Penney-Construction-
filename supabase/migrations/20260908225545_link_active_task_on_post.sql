-- Preserve task attribution for photo-only posts, including older clients.
-- This is separate from completing the day's required written report.
create or replace function public.stamp_active_task_on_post()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  active_task record;
  active_count integer;
begin
  if new.subcontractor_id is not null or new.project_id is null
    or new.report_required or new.status <> 'completed'
    or new.ended_at is distinct from new.started_at then
    return new;
  end if;

  -- Do not overwrite an explicitly selected task or an existing allocation.
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
create trigger stamp_active_task_on_post before insert on public.daily_logs
for each row execute function public.stamp_active_task_on_post();
