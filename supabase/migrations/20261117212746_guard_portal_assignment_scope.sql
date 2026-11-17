-- A roster scope is published as an instruction from the office. The
-- existing roster policies also serve scheduling, QR and award workflows.
-- Only changes to a published instruction or its destination require office
-- authority here. The signed work-order lock remains a separate trigger.
create or replace function public.guard_portal_assignment_scope()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.scope_summary is null then return new; end if;
  elsif tg_op = 'DELETE' then
    if old.scope_summary is null then return old; end if;
  else
    if new.scope_summary is not distinct from old.scope_summary
       and (new.scope_summary is null or (
         new.project_id = old.project_id and new.subcontractor_id = old.subcontractor_id
         and ((old.status is not distinct from 'active') = (new.status is not distinct from 'active'))
       )) then return new; end if;
  end if;

  if current_user not in ('service_role', 'postgres', 'supabase_admin') and not exists (
    select 1 from public.profiles p where p.id = (select auth.uid())
      and p.role::text in ('owner', 'precon_manager', 'project_manager', 'office_admin')
  ) then
    raise exception 'An office role is required to change a published sub assignment' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if char_length(new.scope_summary) > 4000 then
    raise exception 'A sub assignment may contain up to 4000 characters' using errcode = '22001';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_portal_assignment_scope() from public, anon, authenticated;
create trigger guard_portal_assignment_scope before insert or update or delete on public.project_subcontractors
for each row execute function public.guard_portal_assignment_scope();
