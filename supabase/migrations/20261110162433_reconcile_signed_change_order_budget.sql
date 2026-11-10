-- Explicit reconciliation of one tracking line to one already-signed CO.
-- No backfill: preview and exact version guards are required for every repair.
create table public.change_order_budget_reconciliations (
  id uuid primary key,
  project_id uuid not null references public.projects(id),
  change_order_id uuid not null references public.change_orders(id),
  line_id uuid not null references public.estimate_line_items(id),
  actor_id uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  reason text not null,
  evidence_refs text[] not null,
  expected_change_order_fingerprint text not null,
  expected_line_fingerprint text not null,
  source_change_order jsonb not null,
  before_line jsonb not null,
  after_line jsonb not null
);
create index change_order_budget_reconciliations_project on public.change_order_budget_reconciliations(project_id, created_at desc);
alter table public.change_order_budget_reconciliations enable row level security;
revoke all on public.change_order_budget_reconciliations from public, anon, authenticated, service_role;
grant select, insert on public.change_order_budget_reconciliations to service_role;

create function public.protect_change_order_budget_reconciliation() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'Saved change order budget reconciliation is immutable.';
end;
$$;
revoke all on function public.protect_change_order_budget_reconciliation() from public, anon, authenticated;
create trigger protect_change_order_budget_reconciliation before update or delete
on public.change_order_budget_reconciliations for each row execute function public.protect_change_order_budget_reconciliation();

create function public.reconcile_signed_change_order_budget(
  p_actor_id uuid, p_project_id uuid, p_change_order_id uuid, p_line_id uuid,
  p_apply boolean default false, p_request_id uuid default null,
  p_expected_change_order_fingerprint text default null, p_expected_line_fingerprint text default null,
  p_reason text default null, p_evidence_refs text[] default null
) returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare
  v_project public.projects%rowtype;
  v_co public.change_orders%rowtype;
  v_line public.estimate_line_items%rowtype;
  v_prior public.change_order_budget_reconciliations%rowtype;
  v_count integer;
  v_co_json jsonb;
  v_before jsonb;
  v_after jsonb;
  v_contract jsonb;
  v_contract_after jsonb;
  v_patch jsonb;
  v_result jsonb;
  v_co_fingerprint text;
  v_line_fingerprint text;
  v_markup numeric;
begin
  perform public.job_review_require_actor(p_actor_id);
  if p_apply is null then raise exception 'Explicit preview or apply required'; end if;
  if p_project_id is null or p_change_order_id is null or p_line_id is null then
    raise exception 'Exact project, change order and budget line required';
  end if;
  -- Share the final-audit lock so a close cannot freeze the old budget while
  -- this transaction is reconciling it. Forecasts do not reopen final audits.
  perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,0));
  -- This lock also serializes retries and protects the signed contract while
  -- the existing estimate-rollup triggers update their derived totals.
  select * into v_project from public.projects where id=p_project_id for update;
  if not found then raise exception 'Project not found'; end if;
  if p_apply and p_request_id is not null then
    select * into v_prior from public.change_order_budget_reconciliations where id=p_request_id;
    if found then
      if v_prior.actor_id is distinct from p_actor_id or v_prior.project_id is distinct from p_project_id
        or v_prior.change_order_id is distinct from p_change_order_id or v_prior.line_id is distinct from p_line_id
        or v_prior.expected_change_order_fingerprint is distinct from p_expected_change_order_fingerprint
        or v_prior.expected_line_fingerprint is distinct from p_expected_line_fingerprint
        or v_prior.reason is distinct from btrim(p_reason) or v_prior.evidence_refs is distinct from p_evidence_refs then
        raise exception 'Request ID already used for a different reconciliation';
      end if;
      return jsonb_build_object('applied',true,'already_applied',true,'audit_id',v_prior.id,
        'project_id',p_project_id,'change_order_id',p_change_order_id,'line_id',p_line_id,
        'before_line',v_prior.before_line,'after_line',v_prior.after_line);
    end if;
  end if;
  if v_project.contract_locked_at is null or v_project.contract_locked_amount is null then
    raise exception 'The signed contract must be locked before reconciling a CO budget';
  end if;
  if (select r.kind from public.project_finance_records r where r.project_id=p_project_id and r.kind<>'forecast'
      order by r.created_at desc, r.id desc limit 1)='final' then
    raise exception 'Reopen the final financial audit before changing its budget';
  end if;
  v_contract := jsonb_build_object('contract_value',v_project.contract_value,
    'contract_locked_amount',v_project.contract_locked_amount,'contract_locked_at',v_project.contract_locked_at,
    'contract_signed_pdf_path',v_project.contract_signed_pdf_path);
  select * into v_co from public.change_orders where id=p_change_order_id and project_id=p_project_id for update;
  if not found then raise exception 'Change order does not belong to this project'; end if;
  if v_co.status is distinct from 'approved' or (v_co.client_signed_at is null and nullif(v_co.client_signature,'') is null) then
    raise exception 'Only an approved, client-signed change order can be reconciled';
  end if;
  if v_co.cost_impact is null or v_co.price_impact is null
    or abs(v_co.cost_impact)>10000000 or abs(v_co.price_impact)>10000000
    or v_co.cost_impact <> round(v_co.cost_impact,2) or v_co.price_impact <> round(v_co.price_impact,2)
    or v_co.cost_impact::text in ('NaN','Infinity','-Infinity') or v_co.price_impact::text in ('NaN','Infinity','-Infinity') then
    raise exception 'The signed CO must have valid cost and price amounts';
  end if;
  if v_co.estimate_id is null or v_co.estimate_id is distinct from public.current_estimate_id(p_project_id) then
    raise exception 'The CO must belong to the current contract estimate';
  end if;
  perform id from public.estimates where id=v_co.estimate_id and project_id=p_project_id for update;
  if not found then raise exception 'Contract estimate not found'; end if;
  -- FOR UPDATE on the CO also blocks concurrent FK-linked line insertion.
  select count(*) into v_count from public.estimate_line_items where change_order_id=p_change_order_id;
  if v_count<>1 then raise exception 'Expected exactly one linked CO budget line'; end if;
  select * into v_line from public.estimate_line_items
    where id=p_line_id and change_order_id=p_change_order_id and estimate_id=v_co.estimate_id for update;
  if not found then raise exception 'Exact linked budget line not found on this estimate'; end if;
  if v_line.quantity is distinct from 1::numeric or coalesce(v_line.is_section_header,false) then
    raise exception 'Reconciliation requires one lump-sum cost line with quantity 1';
  end if;
  if v_line.is_locked then raise exception 'Reopen the locked budget line before reconciling'; end if;
  v_co_json := to_jsonb(v_co);
  v_before := to_jsonb(v_line);
  v_co_fingerprint := md5(v_co_json::text);
  v_line_fingerprint := md5(v_before::text);
  v_markup := case when v_co.cost_impact>0 then round((v_co.price_impact/v_co.cost_impact-1)*100) else 0 end;
  v_patch := jsonb_build_object('description',v_co.title,'cost',v_co.cost_impact,'total_cost',v_co.cost_impact,
    'unit_cost',v_co.cost_impact,'client_price',v_co.price_impact,'total_price',v_co.price_impact,
    'profit',v_co.price_impact-v_co.cost_impact,'markup_pct',v_markup,'markup_percentage',v_markup,
    'notes',format('Budget reconciled to signed CO #%s. Original tracking notes and inspected source references are retained in the reconciliation audit.',v_co.change_order_number));
  v_result := jsonb_build_object('applied',false,'project_id',p_project_id,'change_order_id',p_change_order_id,
    'line_id',p_line_id,'change_order_number',v_co.change_order_number,'title',v_co.title,
    'client_signed_at',v_co.client_signed_at,'expected_change_order_fingerprint',v_co_fingerprint,
    'expected_line_fingerprint',v_line_fingerprint,'before_line',v_before,'proposed_line',v_before||v_patch,
    'signed_change_order_unchanged',true,'contract_unchanged',true);
  if not p_apply then return v_result; end if;
  if p_request_id is null or length(btrim(coalesce(p_reason,'')))<20 or length(p_reason)>2000
    or coalesce(cardinality(p_evidence_refs),0) not between 1 and 20
    or exists(select 1 from unnest(p_evidence_refs) r where r is null or length(btrim(r))<5 or length(r)>1000) then
    raise exception 'Request ID, reconciliation reason and inspected evidence references required';
  end if;
  if v_co_fingerprint is distinct from p_expected_change_order_fingerprint
    or v_line_fingerprint is distinct from p_expected_line_fingerprint then
    raise exception 'The CO or budget line changed after preview; inspect and preview again' using errcode='40001';
  end if;
  update public.estimate_line_items set
    description=v_co.title, cost=v_co.cost_impact, total_cost=v_co.cost_impact, unit_cost=v_co.cost_impact,
    client_price=v_co.price_impact, total_price=v_co.price_impact, profit=v_co.price_impact-v_co.cost_impact,
    markup_pct=v_markup, markup_percentage=v_markup,
    notes=v_patch->>'notes'
  where id=p_line_id returning to_jsonb(estimate_line_items) into v_after;
  -- Fail the entire transaction if any existing trigger altered signed terms.
  if (select to_jsonb(c) from public.change_orders c where id=p_change_order_id) is distinct from v_co_json then
    raise exception 'Signed change order changed during reconciliation';
  end if;
  select jsonb_build_object('contract_value',p.contract_value,'contract_locked_amount',p.contract_locked_amount,
    'contract_locked_at',p.contract_locked_at,'contract_signed_pdf_path',p.contract_signed_pdf_path)
    into v_contract_after from public.projects p where id=p_project_id;
  if v_contract_after is distinct from v_contract then raise exception 'Signed contract changed during reconciliation'; end if;
  insert into public.change_order_budget_reconciliations(id,project_id,change_order_id,line_id,actor_id,reason,evidence_refs,
    expected_change_order_fingerprint,expected_line_fingerprint,source_change_order,before_line,after_line)
  values(p_request_id,p_project_id,p_change_order_id,p_line_id,p_actor_id,btrim(p_reason),p_evidence_refs,
    v_co_fingerprint,v_line_fingerprint,v_co_json,v_before,v_after);
  return v_result||jsonb_build_object('applied',true,'already_applied',false,'audit_id',p_request_id,'after_line',v_after);
end;
$$;
revoke all on function public.reconcile_signed_change_order_budget(uuid,uuid,uuid,uuid,boolean,uuid,text,text,text,text[]) from public, anon, authenticated;
grant execute on function public.reconcile_signed_change_order_budget(uuid,uuid,uuid,uuid,boolean,uuid,text,text,text,text[]) to service_role;
