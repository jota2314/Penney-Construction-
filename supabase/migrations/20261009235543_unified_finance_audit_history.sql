-- Audit history is append-only. No financial ledger or project status is edited.
create table public.project_finance_records (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id),
  actor_id uuid not null references public.profiles(id),
  actor_name text not null,
  kind text not null check (kind in ('forecast','final','reopen')),
  created_at timestamptz not null default clock_timestamp(),
  closed_on date,
  review_id uuid references public.job_review_runs(id),
  previous_id uuid references public.project_finance_records(id),
  payload jsonb not null check (jsonb_typeof(payload)='object'),
  check ((kind='final' and closed_on is not null and review_id is not null) or (kind<>'final' and closed_on is null))
);
create index project_finance_records_history on public.project_finance_records(project_id,created_at desc);
create index project_finance_records_closed on public.project_finance_records(closed_on) where kind='final';
create unique index project_finance_records_run on public.project_finance_records(project_id,kind,review_id) where review_id is not null;
alter table public.project_finance_records enable row level security;
revoke all on public.project_finance_records from anon, authenticated, service_role;
grant select on public.project_finance_records to authenticated;
grant select,insert on public.project_finance_records to service_role;
create policy finance_office_read on public.project_finance_records for select to authenticated
using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role::text in ('owner','precon_manager','office_admin')));

create function public.protect_project_finance_history() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'Saved finance history is immutable. Reopen the audit to append a revision.'; end;
$$;
revoke all on function public.protect_project_finance_history() from public,anon,authenticated;
create trigger protect_project_finance_history before update or delete on public.project_finance_records
for each row execute function public.protect_project_finance_history();

-- Invoker security, callable only by the authenticated application server.
-- The actor is rechecked in the database; no client can manufacture a snapshot.
create function public.append_project_finance_record(
 p_actor uuid,p_project uuid,p_kind text,p_run uuid,p_expected_head uuid,
 p_closed_on date,p_payload jsonb,p_evidence jsonb
) returns uuid language plpgsql set search_path='' as $$
declare v_actor text; v_head public.project_finance_records; v_run public.job_review_runs;
 v_snapshot jsonb; v_evidence jsonb; v_id uuid;
begin
 perform public.job_review_require_actor(p_actor);
 select full_name into v_actor from public.profiles where id=p_actor and role::text in ('owner','precon_manager');
 if not found then raise exception 'Owner or preconstruction manager approval required'; end if;
 if p_kind not in ('forecast','final','reopen') or length(trim(coalesce(p_payload->>'note','')))<20 then raise exception 'Audit type and supporting explanation required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_project::text,0));
 select * into v_head from public.project_finance_records where project_id=p_project and kind<>'forecast' order by created_at desc,id desc limit 1;
 if v_head.id is distinct from p_expected_head then raise exception 'Audit history changed. Reload before saving.'; end if;
 if p_kind='reopen' then
   if v_head.kind is distinct from 'final' then raise exception 'There is no final audit to reopen'; end if;
 else
   if v_head.kind='final' then raise exception 'Reopen the final audit first'; end if;
   select * into v_run from public.job_review_runs where id=p_run and project_id=p_project and actor_id=p_actor;
   if not found or v_run.checked_at<statement_timestamp()-interval '30 minutes' then raise exception 'Refresh the audit preview'; end if;
   v_snapshot:=public.job_review_snapshot(p_actor,p_project);
   if v_snapshot->'records' is distinct from v_run.snapshot->'records' then raise exception 'Source records changed. Refresh the audit preview.'; end if;
   select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]') into v_evidence from public.job_review_evidence e where e.project_id=p_project;
   if v_evidence is distinct from p_evidence then raise exception 'Audit evidence changed. Refresh the audit preview.'; end if;
   if (p_payload->'cost') is distinct from (v_run.result->'money'->'recorded_cost') or (p_payload->'contract') is distinct from (v_run.result->'money'->'contract') then raise exception 'P&L does not match the saved review'; end if;
   if p_kind='final' then
     if p_closed_on is null or p_closed_on>(statement_timestamp() at time zone 'America/New_York')::date then raise exception 'A valid closing date is required'; end if;
     if not exists(select 1 from public.project_files where id=(p_payload->>'report_file_id')::uuid and project_id=p_project) then raise exception 'Final report must belong to this project'; end if;
     if p_payload->>'attestation' is null or p_payload->'contract'='null'::jsonb then raise exception 'Final audit verification required'; end if;
   end if;
 end if;
 insert into public.project_finance_records(project_id,actor_id,actor_name,kind,closed_on,review_id,previous_id,payload)
 values(p_project,p_actor,coalesce(v_actor,'Office reviewer'),p_kind,case when p_kind='final' then p_closed_on end,p_run,v_head.id,p_payload) returning id into v_id;
 return v_id;
end;
$$;
revoke all on function public.append_project_finance_record(uuid,uuid,text,uuid,uuid,date,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.append_project_finance_record(uuid,uuid,text,uuid,uuid,date,jsonb,jsonb) to service_role;
