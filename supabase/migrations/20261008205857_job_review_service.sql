-- Shared review inventory and audit continuity. Business data is read-only here.
create table public.job_review_runs (
 id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id), actor_id uuid not null references public.profiles(id),
 checked_at timestamptz not null default now(), engine_version text not null, fingerprint text not null,
 source_register jsonb not null, snapshot jsonb not null, result jsonb not null
);
create index job_review_runs_latest on public.job_review_runs(project_id, checked_at desc);
create table public.job_review_evidence (
 id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id), actor_id uuid not null references public.profiles(id),
 title text not null, action text not null, classification text not null check (classification in ('allocation_question','verified_cost','question')),
 line_id uuid references public.estimate_line_items(id), refs jsonb not null, reviewed_at timestamptz not null default now(), resolved boolean not null default false
);
create index job_review_evidence_project on public.job_review_evidence(project_id);
create table public.job_review_corrections (
 id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id), actor_id uuid not null references public.profiles(id),
 kind text not null check (kind in ('invoice_allocation','labor_allocation')), record_id uuid not null, target_line_id uuid not null references public.estimate_line_items(id),
 reason text not null, evidence_refs jsonb not null, expected_record jsonb not null, expected_target jsonb not null, expected_sources text not null,
 preview jsonb, created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '15 minutes',
 applied_at timestamptz, before_record jsonb, after_record jsonb
);
create index job_review_corrections_project on public.job_review_corrections(project_id,created_at desc);
alter table public.job_review_runs enable row level security;
alter table public.job_review_evidence enable row level security;
alter table public.job_review_corrections enable row level security;
revoke all on public.job_review_runs, public.job_review_evidence, public.job_review_corrections from public,anon,authenticated;
grant all on public.job_review_runs, public.job_review_evidence, public.job_review_corrections to service_role;

create function public.job_review_require_actor(p_actor_id uuid) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if auth.role() is distinct from 'service_role' or not exists (select 1 from public.profiles where id=p_actor_id and role::text in ('owner','office_admin','precon_manager')) then
  raise exception 'Office review access required' using errcode='42501';
 end if;
end; $$;
revoke all on function public.job_review_require_actor(uuid) from public,anon,authenticated;
grant execute on function public.job_review_require_actor(uuid) to service_role;

create function public.job_review_snapshot(p_actor_id uuid,p_project_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare v_records jsonb;
begin
 perform public.job_review_require_actor(p_actor_id);
 if not exists(select 1 from public.projects where id=p_project_id) then raise exception 'Project not found'; end if;
 with job_days as (
  select distinct l.author_id,(l.started_at at time zone 'America/New_York')::date work_date from public.daily_logs l
  left join public.schedule_phases p on p.id=l.schedule_phase_id
  where coalesce(l.project_id,p.project_id)=p_project_id and l.kind is distinct from 'post' and l.author_id is not null
 ), document_refs as (
  select coalesce(storage_bucket,'project-files') bucket,storage_path path from public.project_files where project_id=p_project_id
  union select 'email-attachments',attachment_storage_path from public.invoices where project_id=p_project_id
  union select 'email-attachments',attachment_storage_path from public.quote_requests where project_id=p_project_id
  union select 'daily-log-photos',jsonb_array_elements_text(coalesce(to_jsonb(photo_storage_paths),'[]')) from public.daily_logs where project_id=p_project_id
  union select 'project-files',contract_signed_pdf_path from public.projects where id=p_project_id
 ), inventories as (select 'projects' as source, coalesce(jsonb_agg(r order by r->>'id'),'[]'::jsonb) as records from (select to_jsonb(t) as r from public.projects t where id=p_project_id) s
union all
select 'invoices' as source, coalesce(jsonb_agg(r order by r->>'id'),'[]'::jsonb) as records from (select to_jsonb(t) as r from public.invoices t where project_id=p_project_id) s
union all
select 'daily_logs' as source, coalesce(jsonb_agg(r order by r->>'id'),'[]'::jsonb) as records from (select to_jsonb(t) as r from public.daily_logs t where t.project_id=p_project_id or (t.project_id is null and t.schedule_phase_id in (select id from public.schedule_phases where project_id=p_project_id))) s
union all
select 'field_report_notes' as source, coalesce(jsonb_agg(r order by r->>'id'),'[]'::jsonb) as records from (select to_jsonb(t) as r from public.field_report_notes t where project_id=p_project_id) s
union all
select 'field_report_photos' as source, coalesce(jsonb_agg(r order by r->>'id'),'[]'::jsonb) as records from (select to_jsonb(t) as r from public.field_report_photos t where project_id=p_project_id) s
union all
select 'schedule_phases' as source, coalesce(jsonb_agg(r order by r->>'id'),'[]'::jsonb) as records from (select to_jsonb(t) as r from public.schedule_phases t where project_id=p_project_id) s
union all
select 'project_inspections' as source, coalesce(jsonb_agg(r order by r->>'id'),'[]'::jsonb) as records from (select to_jsonb(t) as r from public.project_inspections t where project_id=p_project_id) s
union all
select 'project_trade_budgets' as source, coalesce(jsonb_agg(r order by r->>'id'),'[]'::jsonb) as records from (select to_jsonb(t) as r from public.project_trade_budgets t where project_id=p_project_id) s
union all
select 'time_entries' as source, coalesce(jsonb_agg(r order by r->>'id'),'[]'::jsonb) as records from (select to_jsonb(t) as r from public.time_entries t where project_id=p_project_id) s
union all
select 'job_ledger_entries' as source, coalesce(jsonb_agg(r order by r->>'id'),'[]'::jsonb) as records from (select to_jsonb(t) as r from public.job_ledger_entries t where project_id=p_project_id) s
union all
select 'project_subcontractors' as source, coalesce(jsonb_agg(r order by r->>'id'),'[]'::jsonb) as records from (select to_jsonb(t) as r from public.project_subcontractors t where project_id=p_project_id) s
union all
select 'material_orders' as source, coalesce(jsonb_agg(r order by r->>'id'),'[]'::jsonb) as records from (select to_jsonb(t) as r from public.material_orders t where project_id=p_project_id) s
union all
select 'material_returns' as source, coalesce(jsonb_agg(r order by r->>'id'),'[]'::jsonb) as records from (select to_jsonb(t) as r from public.material_returns t where project_id=p_project_id) s
union all
select 'change_orders' as source, coalesce(jsonb_agg(r order by r->>'id'),'[]'::jsonb) as records from (select to_jsonb(t) as r from public.change_orders t where project_id=p_project_id) s
union all
select 'project_payment_milestones' as source, coalesce(jsonb_agg(r order by r->>'id'),'[]'::jsonb) as records from (select to_jsonb(t) as r from public.project_payment_milestones t where project_id=p_project_id) s
union all
select 'payments_received' as source, coalesce(jsonb_agg(r order by r->>'id'),'[]'::jsonb) as records from (select to_jsonb(t) as r from public.payments_received t where project_id=p_project_id) s
union all
select 'todos' as source, coalesce(jsonb_agg(r order by r->>'id'),'[]'::jsonb) as records from (select to_jsonb(t) as r from public.todos t where project_id=p_project_id) s
union all
select 'project_updates' as source, coalesce(jsonb_agg(r order by r->>'id'),'[]'::jsonb) as records from (select to_jsonb(t) as r from public.project_updates t where project_id=p_project_id) s
union all
select 'estimates' as source, coalesce(jsonb_agg(r order by r->>'id'),'[]'::jsonb) as records from (select to_jsonb(t) as r from public.estimates t where project_id=p_project_id) s
union all
select 'project_files' as source, coalesce(jsonb_agg(r order by r->>'id'),'[]'::jsonb) as records from (select to_jsonb(t) as r from public.project_files t where project_id=p_project_id) s
union all
select 'email_logs' as source, coalesce(jsonb_agg(r order by r->>'id'),'[]'::jsonb) as records from (select to_jsonb(t) as r from public.email_logs t where project_id=p_project_id) s
union all
select 'client_invoices' as source, coalesce(jsonb_agg(r order by r->>'id'),'[]'::jsonb) as records from (select to_jsonb(t) as r from public.client_invoices t where project_id=p_project_id) s
union all
select 'bank_transactions' as source, coalesce(jsonb_agg(r order by r->>'id'),'[]'::jsonb) as records from (select to_jsonb(t) as r from public.bank_transactions t where project_id=p_project_id) s
union all
select 'lines' as source, coalesce(jsonb_agg(r order by r->>'id'),'[]'::jsonb) as records from (select to_jsonb(t) as r from public.estimate_line_items t where estimate_id in (select id from public.estimates where project_id=p_project_id)) s
union all
select 'quotes' as source, coalesce(jsonb_agg(r order by r->>'id'),'[]'::jsonb) as records from (select to_jsonb(t) as r from public.quote_requests t where project_id=p_project_id) s
union all
select 'all_day_shifts' as source, coalesce(jsonb_agg(r order by r->>'id'),'[]'::jsonb) as records from (select to_jsonb(t) || jsonb_build_object('project_id',coalesce(t.project_id,p.project_id)) as r from public.daily_logs t left join public.schedule_phases p on p.id=t.schedule_phase_id where t.kind is distinct from 'post' and exists (select 1 from job_days d where d.author_id=t.author_id and d.work_date=(t.started_at at time zone 'America/New_York')::date)) s
union all
select 'employees' as source, coalesce(jsonb_agg(r order by r->>'id'),'[]'::jsonb) as records from (select jsonb_build_object('id',t.id,'profile_id',t.profile_id,'hourly_rate',t.hourly_rate,'first_name',t.first_name,'last_name',t.last_name) as r from public.employees t where profile_id in (select author_id from job_days)) s
union all
select 'rates' as source, coalesce(jsonb_agg(r order by r->>'id'),'[]'::jsonb) as records from (select to_jsonb(t) as r from public.employee_rate_changes t where employee_id in (select id from public.employees where profile_id in (select author_id from job_days))) s
union all
select 'breaks' as source, coalesce(jsonb_agg(r order by r->>'id'),'[]'::jsonb) as records from (select to_jsonb(t) as r from public.payroll_adjustments t where exists (select 1 from job_days d where d.author_id=t.profile_id and d.work_date=t.work_date)) s
union all
select 'emails' as source, coalesce(jsonb_agg(r order by r->>'id'),'[]'::jsonb) as records from (select to_jsonb(t) as r from public.inbox_emails t where project_id=p_project_id or matched_project_id=p_project_id) s
union all
select 'billing_history' as source, coalesce(jsonb_agg(r order by r->>'id'),'[]'::jsonb) as records from (select x as r from jsonb_array_elements(public.mcp_get_client_billing(p_actor_id,p_project_id)->'history') x) s
union all
select 'storage_objects' as source, coalesce(jsonb_agg(r order by r->>'id'),'[]'::jsonb) as records from (select jsonb_build_object('id',r.bucket||'/'||r.path,'bucket',r.bucket,'path',r.path,'version',o.version,'etag',o.metadata->>'eTag','size',o.metadata->>'size','updated_at',o.updated_at,'available',o.id is not null) as r from document_refs r left join storage.objects o on o.bucket_id=r.bucket and o.name=r.path where r.path is not null) s)
 select jsonb_object_agg(source,records) into v_records from inventories;
 return jsonb_build_object('as_of',statement_timestamp(),'records',v_records);
end; $$;
revoke all on function public.job_review_snapshot(uuid,uuid) from public,anon,authenticated;
grant execute on function public.job_review_snapshot(uuid,uuid) to service_role;

create function public.job_review_preview(p_actor_id uuid,p_project_id uuid,p_kind text,p_record_id uuid,p_target_line_id uuid,p_reason text,p_evidence_refs jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_record jsonb; v_target jsonb; v_sources text; v_id uuid;
begin
 perform public.job_review_require_actor(p_actor_id);
 if length(btrim(p_reason))<8 or length(p_reason)>2000 or jsonb_typeof(p_evidence_refs) is distinct from 'array' or jsonb_array_length(p_evidence_refs)=0 then raise exception 'Source evidence and a specific correction reason are required'; end if;
 if p_kind='invoice_allocation' then
  select to_jsonb(i) into v_record from public.invoices i where id=p_record_id and project_id=p_project_id and duplicate_of_id is null;
 elsif p_kind='labor_allocation' then
  select to_jsonb(l) into v_record from public.daily_logs l left join public.schedule_phases p on p.id=l.schedule_phase_id
   where l.id=p_record_id and coalesce(l.project_id,p.project_id)=p_project_id and l.author_id is not null and l.kind is distinct from 'post' and l.ended_at is not null;
 else raise exception 'Unsupported correction'; end if;
 if v_record is null then raise exception 'Record not found, duplicate, or live shift'; end if;
 select to_jsonb(l) into v_target from public.estimate_line_items l join public.estimates e on e.id=l.estimate_id
  where l.id=p_target_line_id and e.project_id=p_project_id and l.estimate_id=public.current_estimate_id(p_project_id) and not coalesce(l.is_section_header,false);
 if v_target is null then raise exception 'Choose a cost line on this job current estimate'; end if;
 if v_record->>'estimate_line_item_id'=p_target_line_id::text then raise exception 'Already assigned to that line'; end if;
 if p_kind='labor_allocation' and (coalesce((v_target->>'is_locked')::boolean,false) or exists(select 1 from public.estimate_line_items where id=(v_record->>'estimate_line_item_id')::uuid and is_locked)) then raise exception 'Reopen the labor closeout in the app before reallocating locked hours'; end if;
 select md5((public.job_review_snapshot(p_actor_id,p_project_id)->'records')::text) into v_sources;
 insert into public.job_review_corrections(project_id,actor_id,kind,record_id,target_line_id,reason,evidence_refs,expected_record,expected_target,expected_sources)
 values(p_project_id,p_actor_id,p_kind,p_record_id,p_target_line_id,p_reason,p_evidence_refs,v_record,v_target,v_sources) returning id into v_id;
 return jsonb_build_object('id',v_id,'record',v_record,'target',v_target);
end; $$;
revoke all on function public.job_review_preview(uuid,uuid,text,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.job_review_preview(uuid,uuid,text,uuid,uuid,text,jsonb) to service_role;

create function public.job_review_apply(p_actor_id uuid,p_project_id uuid,p_preview_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.job_review_corrections; v_before jsonb; v_after jsonb; v_target jsonb; v_prior_sub text;
begin
 perform public.job_review_require_actor(p_actor_id);
 select * into c from public.job_review_corrections where id=p_preview_id and actor_id=p_actor_id and project_id=p_project_id for update;
 if not found then raise exception 'Correction preview not found for this account/job'; end if;
 if c.applied_at is not null then return jsonb_build_object('id',c.id,'applied_at',c.applied_at,'already_applied',true); end if;
 if c.expires_at<now() or c.preview is null then raise exception 'Correction preview expired or incomplete; preview again'; end if;
 perform id from public.projects where id=p_project_id for update;
 if c.kind='invoice_allocation' then
  select to_jsonb(i) into v_before from public.invoices i where id=c.record_id for update;
 else
  select to_jsonb(l) into v_before from public.daily_logs l where id=c.record_id for update;
 end if;
 perform id from public.estimate_line_items where id in (c.target_line_id,(v_before->>'estimate_line_item_id')::uuid) order by id for update;
 select to_jsonb(l) into v_target from public.estimate_line_items l where id=c.target_line_id;
 if v_before is distinct from c.expected_record or v_target is distinct from c.expected_target or
  md5((public.job_review_snapshot(p_actor_id,p_project_id)->'records')::text) is distinct from c.expected_sources then
  raise exception 'Records or source documents changed; review a fresh preview';
 end if;
 if c.kind='invoice_allocation' then
  -- Reuse the existing Command Center/Weekly Close review workflow, including
  -- closed-line snapshot maintenance. Only the allocation can be changed here.
  v_prior_sub:=current_setting('request.jwt.claim.sub',true);
  perform set_config('request.jwt.claim.sub',p_actor_id::text,true);
  perform public.confirm_spend_review(array[c.record_id],jsonb_build_object('estimate_line_item_id',c.target_line_id));
  perform set_config('request.jwt.claim.sub',coalesce(v_prior_sub,''),true);
  select to_jsonb(i) into v_after from public.invoices i where id=c.record_id;
  if v_before->'amount' is distinct from v_after->'amount' or v_before->'paid_amount' is distinct from v_after->'paid_amount' or v_before->'project_id' is distinct from v_after->'project_id' then raise exception 'Correction changed money or job unexpectedly'; end if;
 else
  update public.daily_logs set estimate_line_item_id=c.target_line_id,line_item_source='manual',line_item_needs_review=false,line_item_note=c.reason where id=c.record_id;
  select to_jsonb(l) into v_after from public.daily_logs l where id=c.record_id;
  if v_before->'started_at' is distinct from v_after->'started_at' or v_before->'ended_at' is distinct from v_after->'ended_at' or v_before->'author_id' is distinct from v_after->'author_id' then raise exception 'Correction changed shift hours unexpectedly'; end if;
 end if;
 update public.job_review_corrections set applied_at=now(),before_record=v_before,after_record=v_after where id=c.id;
 return jsonb_build_object('id',c.id,'applied_at',now(),'already_applied',false);
end; $$;
revoke all on function public.job_review_apply(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.job_review_apply(uuid,uuid,uuid) to service_role;
