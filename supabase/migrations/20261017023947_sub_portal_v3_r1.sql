-- Sub portal v3, round 1: the foundation every R1 workstream builds on (W0).
--
-- PLAN-sub-portal-v3 §6.1, with the 10/16 addendum: Penney has no lawyer, so
-- the agreement templates carry "[FILL IN: ...]" blanks and Ryan alone
-- approves them. A template can't be approved while any "[FILL IN" remains.
--
-- Written, not applied. Apply it live, then read back pg_constraint,
-- pg_trigger, pg_proc, storage.buckets, the three template seeds and the two
-- settings (repo migrations do not equal live).
--
-- Checked against the LIVE database with SELECTs before writing (10/16 night):
--   * app_notifications_source_type_check had 16 values. All 16 are restated
--     below plus sub_field, sub_invoice, sub_agreement, sub_digest.
--   * app_notifications_kind_check allows mention, comment, post, invoice, sms,
--     call, help, material. NOT widened: sub notices use 'post' (field
--     activity, agreements, digest) and 'invoice' (sub bills), the same kinds
--     notifyOfficeOfSub and the bill notices already use.
--   * profiles.role is text, checked to owner / precon_manager /
--     project_manager / office_admin / field. The new tables are readable by
--     the four office roles only; field crew never see them.
--   * project_subcontractors = id, project_id, subcontractor_id,
--     contract_amount (not null), notes, created_at, updated_at, with
--     unique (project_id, subcontractor_id) and only the set_updated_at
--     trigger. None of the new columns below exist yet on any table.
--   * app_settings = id, key (unique), value text not null, created_at,
--     updated_at. Nicole (nsmith@) is profile ea4226a6-6ba0-46e6-b9df-42684319f1fa.
--   * field-captures allows 10 MB (PDF + images); sub-documents did not exist.
--   * project_subcontractors RLS lets ANY signed-in user insert, update and
--     delete (USING true). That's why the contract lock below is a trigger on
--     insert, update AND delete, not an app-side check.
--
-- Safe to re-run: IF NOT EXISTS, ON CONFLICT DO NOTHING, CREATE OR REPLACE,
-- and DROP ... IF EXISTS before every policy, trigger and restated constraint.
-- Section 6 refuses to run if live has gained a notification type this file
-- doesn't list, instead of silently dropping it.

-- ───────────────────────── 1. Site visits ─────────────────────────
-- Presence, not payroll. No GPS. One row per sub per job per ET day (per
-- worker from R2). A QR scan, a post and a clock-in all land here through
-- sub_record_visit, so "on site today" never depends on which one he used.
create table if not exists public.sub_site_visits (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  subcontractor_id uuid not null references public.subcontractors(id) on delete cascade,
  worker_id uuid,                                    -- FK to sub_portal_workers in R2
  visit_date date not null,                          -- America/New_York day, set by the RPC
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  first_source text not null check (first_source in ('qr','post','clock','office')),
  scans int not null default 0 check (scans >= 0),
  posts int not null default 0 check (posts >= 0),
  photos int not null default 0 check (photos >= 0),
  -- The company login (worker_id null) still gets exactly one row a day.
  constraint sub_site_visits_day_key
    unique nulls not distinct (project_id, subcontractor_id, visit_date, worker_id)
);
create index if not exists sub_site_visits_date_idx on public.sub_site_visits (visit_date);
create index if not exists sub_site_visits_sub_idx on public.sub_site_visits (subcontractor_id, visit_date desc);
alter table public.sub_site_visits enable row level security;

-- Upsert today's visit and say whether it was the FIRST touch today (true =
-- row inserted), which is what decides the one push per sub per job per day.
-- SECURITY INVOKER and callable by the service role only: the portal routes
-- call it after resolveSubAccess has validated the sub.
create or replace function public.sub_record_visit(
  p_project uuid, p_sub uuid, p_worker uuid, p_source text,
  p_scans int default 0, p_posts int default 0, p_photos int default 0)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare v_first boolean;
begin
  insert into public.sub_site_visits as v
         (project_id, subcontractor_id, worker_id, visit_date, first_source, scans, posts, photos)
  values (p_project, p_sub, p_worker, (now() at time zone 'America/New_York')::date, p_source,
          greatest(coalesce(p_scans, 0), 0), greatest(coalesce(p_posts, 0), 0),
          greatest(coalesce(p_photos, 0), 0))
  on conflict (project_id, subcontractor_id, visit_date, worker_id)
  do update set last_seen_at = now(),
                scans  = v.scans  + excluded.scans,
                posts  = v.posts  + excluded.posts,
                photos = v.photos + excluded.photos
  returning (xmax = 0) into v_first;
  return v_first;
end $$;
revoke execute on function public.sub_record_visit(uuid, uuid, uuid, text, int, int, int) from public, anon, authenticated;
grant execute on function public.sub_record_visit(uuid, uuid, uuid, text, int, int, int) to service_role;

-- ───────────────────────── 2. Hide from homeowner ─────────────────────────
-- Sub photos are shared with the homeowner by default; the office can hide a
-- post's photos (W10). Sub posts use a phone-generated daily_logs.id for
-- idempotency, so no new key column.
alter table public.daily_logs
  add column if not exists client_hidden_at timestamptz,
  add column if not exists client_hidden_by uuid references public.profiles(id) on delete set null;

-- ───────────────────────── 3. Sub bills handed to the Command Center ─────────────────────────
-- A bill the sub sent from the portal, waiting for the reviewer to file it
-- through the existing BillDrop flow. Nothing here writes `invoices`.
-- "Filed" is worked out when read: an invoices.attachment_storage_path equal
-- to storage_path. No trigger on invoices.
create table if not exists public.sub_bill_submissions (
  id uuid primary key default gen_random_uuid(),
  subcontractor_id uuid not null references public.subcontractors(id),
  project_id uuid references public.projects(id) on delete set null,
  reviewer_profile_id uuid not null references public.profiles(id),
  storage_path text not null unique,                 -- '{reviewer}/{uuid}-{sub}-{name}' in field-captures
  original_name text,
  mime text,
  size_bytes int check (size_bytes <= 10485760),     -- the field-captures bucket cap
  ai_read jsonb,                                     -- what the extraction read off the file
  sub_stated_number text,                            -- typed by the sub when he tapped Fix
  sub_stated_amount numeric(12,2),
  sub_note text,
  received_week date not null                        -- ET Monday ("bill date = week received")
    check (extract(isodow from received_week) = 1),
  status text not null default 'sent' check (status in ('sent','returned')),
  returned_reason text,
  returned_by uuid references public.profiles(id),
  returned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sub_bill_submissions_queue_idx on public.sub_bill_submissions (status, received_week);
create index if not exists sub_bill_submissions_sub_idx on public.sub_bill_submissions (subcontractor_id, created_at desc);
create index if not exists sub_bill_submissions_project_idx on public.sub_bill_submissions (project_id);
alter table public.sub_bill_submissions enable row level security;
drop trigger if exists sub_bill_submissions_updated_at on public.sub_bill_submissions;
create trigger sub_bill_submissions_updated_at before update on public.sub_bill_submissions
  for each row execute function public.handle_updated_at();

-- ───────────────────────── 4. Directory, invites, signs, job links ─────────────────────────
-- "Also called" names the office types in by hand. Nothing is seeded by SQL.
alter table public.subcontractors
  add column if not exists aliases text[] not null default '{}',
  add column if not exists portal_excluded_at timestamptz;   -- hidden from the rollout list
alter table public.sub_portal_access
  add column if not exists invite_channel text check (invite_channel in ('text','email','copy','qr'));
alter table public.projects
  add column if not exists site_sign_posted_at timestamptz,
  add column if not exists site_sign_posted_by uuid references public.profiles(id) on delete set null;
-- 'visit_only' = he scanned in on a job he had no award on; never an amount.
alter table public.project_subcontractors
  add column if not exists status text not null default 'active'
    check (status in ('active','visit_only','done','removed'));

-- ───────────────────────── 5. Contracts mechanism ─────────────────────────
-- Private bucket for agreement PDFs (signed snapshots, paper scans) and R2
-- papers. No storage policies: only the service role reads or writes it.
-- HEIF as well as HEIC: some iPhones label a scan of a paper-signed copy that way.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sub-documents', 'sub-documents', false, 20971520,
        array['application/pdf','image/jpeg','image/png','image/heic','image/heif','image/webp'])
on conflict (id) do nothing;

-- The legal text. Claude drafts it (W9); business numbers Ryan decides are
-- "[FILL IN: ...]" blanks. Approval needs Ryan (app gate), a provenance line,
-- the approver and time, real sections (a master or work order can't be
-- approved empty), and no blank left anywhere in the text. Once approved the
-- text is frozen (trigger below): a change is a new version, so a signed
-- agreement always points at the exact words that were approved.
create table if not exists public.sub_agreement_templates (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('master','work_order','change_order')),
  version int not null,
  title text not null,
  source_pdf_path text,                              -- optional reviewed PDF in sub-documents
  sections jsonb not null default '[]'::jsonb,       -- [{title, body}]
  acceptance_text text not null default '[FILL IN: acceptance statement]',
  esign_consent_text text not null default '[FILL IN: e-sign consent]',
  provenance text,                                   -- "Reviewed and approved by {name} on {date}", set by Approve
  status text not null default 'draft' check (status in ('draft','approved','retired')),
  test_only boolean not null default false,          -- usable only with a TEST sub
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kind, version),
  constraint sub_agreement_templates_sections_array check (jsonb_typeof(sections) = 'array'),
  constraint approved_needs_review check (
    status <> 'approved' or (
      nullif(btrim(provenance), '') is not null
      and approved_by is not null
      and approved_at is not null
      -- A sub change order may carry only its acceptance + consent text.
      and (kind = 'change_order'
           or case when jsonb_typeof(sections) = 'array' then jsonb_array_length(sections) else 0 end > 0)
      and position('[FILL IN' in coalesce(acceptance_text, '') || coalesce(esign_consent_text, '')
                                 || coalesce(sections::text, '')) = 0
    )
  )
);
alter table public.sub_agreement_templates enable row level security;
drop trigger if exists sub_agreement_templates_updated_at on public.sub_agreement_templates;
create trigger sub_agreement_templates_updated_at before update on public.sub_agreement_templates
  for each row execute function public.handle_updated_at();

-- Approved (or retired) text never changes in place. The only move allowed is
-- approved → retired. Deleting stays possible (the TEST template is deleted
-- after the §8 walk; one that any agreement points at can't be, by its FK).
create or replace function public.guard_approved_sub_template() returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if old.status in ('approved', 'retired') and (
       new.kind is distinct from old.kind
       or new.version is distinct from old.version
       or new.title is distinct from old.title
       or new.sections is distinct from old.sections
       or new.acceptance_text is distinct from old.acceptance_text
       or new.esign_consent_text is distinct from old.esign_consent_text
       or new.source_pdf_path is distinct from old.source_pdf_path
       or new.provenance is distinct from old.provenance
       or new.approved_by is distinct from old.approved_by
       or new.approved_at is distinct from old.approved_at
       or new.test_only is distinct from old.test_only
       or (new.status is distinct from old.status
           and not (old.status = 'approved' and new.status = 'retired'))) then
    raise exception 'An approved template can''t be changed; make a new version'
      using hint = 'sub_template_frozen';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_approved_sub_template on public.sub_agreement_templates;
create trigger trg_guard_approved_sub_template before update on public.sub_agreement_templates
  for each row execute function public.guard_approved_sub_template();

-- Three empty drafts, one per agreement kind (sub_agreements.template_id is
-- required, so an SCO needs its own). The drafted text arrives later from W9;
-- Send stays locked until Ryan approves them in the app.
insert into public.sub_agreement_templates (kind, version, title) values
  ('master', 1, 'Master subcontract agreement'),
  ('work_order', 1, 'Work order'),
  ('change_order', 1, 'Sub change order')
on conflict (kind, version) do nothing;

-- One row per agreement: the yearly master, a job's work order, or a sub
-- change order against a work order. Writes go through the service role.
create table if not exists public.sub_agreements (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,                       -- MSA-MGL-2026 / WO-046-01 / SCO-046-01-1
  kind text not null check (kind in ('master','work_order','change_order')),
  subcontractor_id uuid not null references public.subcontractors(id),
  project_id uuid references public.projects(id),
  master_id uuid references public.sub_agreements(id),   -- the MSA a work order sits under
  parent_id uuid references public.sub_agreements(id),   -- the work order an SCO changes
  template_id uuid not null references public.sub_agreement_templates(id),
  scope_text text,
  exclusions_text text,
  price_basis text check (price_basis in ('lump_sum','unit','time_and_material')),
  price numeric(12,2),
  unit_rate numeric(12,2),                           -- unit price, or the T&M rate
  unit_label text,                                   -- "sq ft", "hour"
  not_to_exceed numeric(12,2),
  draws jsonb not null default '[]'::jsonb,          -- [{label, amount, percent, when}]
  start_date date,
  end_date date,
  schedule_phase_ids uuid[] not null default '{}',
  quote_request_ids uuid[] not null default '{}',
  estimate_line_item_ids uuid[] not null default '{}',
  additional_terms jsonb not null default '[]'::jsonb,  -- owner / association flow-downs
  status text not null default 'draft'
    check (status in ('draft','sent','viewed','signed','void','superseded')),
  penney_signer_id uuid references public.profiles(id),
  penney_signed_name text,
  penney_signed_title text,
  penney_signed_at timestamptz,
  sent_at timestamptz,
  first_viewed_at timestamptz,
  view_count int not null default 0,
  sub_signed_name text,
  sub_signed_at timestamptz,
  sub_signed_ip text,
  sub_signed_ua text,
  sub_signed_access_id uuid references public.sub_portal_access(id),
  sub_signed_worker_id uuid,                         -- FK to sub_portal_workers in R2
  sub_signed_phone text,
  esign_consent_at timestamptz,
  signed_on_paper boolean not null default false,
  pdf_sha256 text,                                   -- hash of the exact PDF shown and signed
  signed_pdf_path text,                              -- sub-documents/agreements/{id}/signed.pdf
  void_reason text,
  voided_by uuid references public.profiles(id),
  voided_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- T&M goes out only with a rate and a not-to-exceed (the Send gate, held here too).
  constraint sub_agreements_tm_terms check (
    price_basis is distinct from 'time_and_material'
    or status in ('draft','void')
    or (unit_rate is not null and not_to_exceed is not null)
  ),
  -- A work order or SCO goes out only with an amount: a price basis, and a
  -- price unless it's T&M (whose amount is the not-to-exceed, checked above).
  -- Otherwise sync_sub_contract would lock contract_amount at $0.00.
  constraint sub_agreements_priced check (
    kind = 'master'
    or status in ('draft','void')
    or (price_basis is not null and (price_basis = 'time_and_material' or price is not null))
  ),
  -- A signed agreement carries both signatures, unless it was signed on paper.
  constraint sub_agreements_signed_record check (
    status <> 'signed'
    or signed_on_paper
    or (penney_signed_at is not null and sub_signed_at is not null and sub_signed_name is not null)
  )
);
create index if not exists sub_agreements_sub_idx on public.sub_agreements (subcontractor_id, status);
create index if not exists sub_agreements_project_idx on public.sub_agreements (project_id, subcontractor_id);
alter table public.sub_agreements enable row level security;
drop trigger if exists sub_agreements_updated_at on public.sub_agreements;
create trigger sub_agreements_updated_at before update on public.sub_agreements
  for each row execute function public.handle_updated_at();

-- pre_lock_amount / pre_lock_status hold what the row said before the FIRST
-- signed work order locked it (the quote award, a 'visit_only' link), so
-- voiding the only signed work order puts the row back exactly as it was
-- instead of leaving the voided price or $0.00.
alter table public.project_subcontractors
  add column if not exists agreement_id uuid references public.sub_agreements(id),
  add column if not exists contract_locked_at timestamptz,
  add column if not exists scope_summary text,
  add column if not exists pre_lock_amount numeric(12,2),
  add column if not exists pre_lock_status text
    check (pre_lock_status in ('active','visit_only','done','removed'));

-- A signed work order freezes the row. Only sync_sub_contract (the amendment
-- path, after a signing, a signed SCO or a void) may lock, move or unlock it;
-- it runs with app.sub_contract_sync = 'on' for its own transaction only.
-- While locked: no change to the amount, the lock, the agreement link, the
-- status (which would hide a signed contract from Weekly Close), the pre-lock
-- values or the job/sub, and no delete (delete + re-insert would get round
-- the freeze; RLS lets any signed-in user delete here). Notes and
-- scope_summary stay editable. Nobody but the sync may lock a row by hand.
-- Callers (awardQuote, awardBid, upsertContractAmount) catch hint
-- 'sub_contract_locked'; the message names the work order
-- ("Locked by WO-046-01; use a sub change order"), and so does DETAIL.
create or replace function public.guard_locked_sub_contract() returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare v_number text;
begin
  if coalesce(current_setting('app.sub_contract_sync', true), '') = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.contract_locked_at is not null or new.agreement_id is not null then
      raise exception 'Only a signed work order locks a sub contract'
        using hint = 'sub_contract_sync_only';
    end if;
    return new;
  end if;

  if old.contract_locked_at is null then
    if tg_op = 'DELETE' then return old; end if;
    if new.contract_locked_at is not null or new.agreement_id is distinct from old.agreement_id then
      raise exception 'Only a signed work order locks a sub contract'
        using hint = 'sub_contract_sync_only';
    end if;
    return new;
  end if;

  -- Locked from here on.
  if tg_op = 'UPDATE'
     and new.project_id = old.project_id
     and new.subcontractor_id = old.subcontractor_id
     and new.contract_amount is not distinct from old.contract_amount
     and new.contract_locked_at is not distinct from old.contract_locked_at
     and new.agreement_id is not distinct from old.agreement_id
     and new.status is not distinct from old.status
     and new.pre_lock_amount is not distinct from old.pre_lock_amount
     and new.pre_lock_status is not distinct from old.pre_lock_status then
    return new;
  end if;

  -- The number is readable to office roles and the service role (RLS); a
  -- field user just gets the generic wording.
  select a.number into v_number from public.sub_agreements a where a.id = old.agreement_id;
  raise exception 'Locked by %; use a sub change order', coalesce(v_number, 'a signed work order')
    using hint = 'sub_contract_locked', detail = coalesce(v_number, '');
end $$;
drop trigger if exists trg_guard_locked_sub_contract on public.project_subcontractors;
create trigger trg_guard_locked_sub_contract before insert or update or delete on public.project_subcontractors
  for each row execute function public.guard_locked_sub_contract();

-- Make project_subcontractors match the signed paper. Service role only.
-- Call it after every signing (portal or paper) and after voiding or
-- superseding an agreement that WAS signed; voiding a draft or sent one
-- changes nothing, so it's safe but pointless there.
--
--  * Something signed: contract_amount = Σ signed work orders + SCOs on this
--    job (the price, or the not-to-exceed for T&M), status 'active', linked
--    to the newest signed one, locked (the first lock time is kept). On the
--    first lock the row's old amount and status are saved; a row the sync
--    had to create saves $0.00 / 'removed'.
--  * Nothing signed any more: a locked row is unlocked and put back to the
--    saved amount and status. An unlocked or missing row is left alone: no
--    insert, no $0.00, no status change.
-- Returns the row's contract_amount afterwards, or null when there is no row.
create or replace function public.sync_sub_contract(p_project uuid, p_sub uuid) returns numeric
language plpgsql
security invoker
set search_path = public
as $$
declare v_total numeric(12,2); v_latest uuid; v_amount numeric(12,2);
begin
  -- One sync per sub per job at a time, so two overlapping signings or voids
  -- (a WO and an SCO, a sign and a paper upload) can't write a stale total.
  perform pg_advisory_xact_lock(hashtextextended(p_project::text || ':' || p_sub::text, 0));

  select coalesce(sum(case when a.price_basis = 'time_and_material' then a.not_to_exceed else a.price end), 0),
         (array_agg(a.id order by a.sub_signed_at desc nulls last, a.created_at desc))[1]
    into v_total, v_latest
    from public.sub_agreements a
   where a.project_id = p_project and a.subcontractor_id = p_sub
     and a.kind in ('work_order','change_order') and a.status = 'signed';

  perform set_config('app.sub_contract_sync', 'on', true);
  if v_latest is null then
    update public.project_subcontractors
       set contract_amount = coalesce(pre_lock_amount, contract_amount),
           status = coalesce(pre_lock_status, status),
           agreement_id = null,
           contract_locked_at = null,
           pre_lock_amount = null,
           pre_lock_status = null
     where project_id = p_project and subcontractor_id = p_sub
       and contract_locked_at is not null;
  else
    insert into public.project_subcontractors as ps
           (project_id, subcontractor_id, contract_amount, status, agreement_id, contract_locked_at,
            pre_lock_amount, pre_lock_status)
    values (p_project, p_sub, v_total, 'active', v_latest, now(), 0, 'removed')
    on conflict (project_id, subcontractor_id) do update
       set contract_amount = excluded.contract_amount,
           status = 'active',
           agreement_id = excluded.agreement_id,
           contract_locked_at = coalesce(ps.contract_locked_at, excluded.contract_locked_at),
           pre_lock_amount = case when ps.contract_locked_at is null then ps.contract_amount else ps.pre_lock_amount end,
           pre_lock_status = case when ps.contract_locked_at is null then ps.status else ps.pre_lock_status end;
  end if;
  perform set_config('app.sub_contract_sync', 'off', true);

  select ps.contract_amount into v_amount
    from public.project_subcontractors ps
   where ps.project_id = p_project and ps.subcontractor_id = p_sub;
  return v_amount;
end $$;
revoke execute on function public.sync_sub_contract(uuid, uuid) from public, anon, authenticated;
grant execute on function public.sync_sub_contract(uuid, uuid) to service_role;

-- ───────────────────────── 6. Notification types ─────────────────────────
-- Restate ALL 16 live values plus the four new ones (the 00131 lesson: a
-- dropped value makes the bell silently lose rows). Other sessions keep
-- applying migrations, so before dropping anything this reads the LIVE check
-- and stops the migration if it allows a value missing from the list below
-- (add it here, then re-run). One list, used for both the guard and the check.
do $$
declare
  v_keep text[] := array[
    'company_post','daily_log','project_update','feed_comment','field_invoice','client_payment',
    'bill_pay_approval','phone_line','contract_signed','spend_help','sub_schedule','material_return',
    'material_order','material_order_ready','material_order_rejected','sub_signup',
    'sub_field','sub_invoice','sub_agreement','sub_digest'];
  v_def text;
  v_missing text[];
begin
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = 'public.app_notifications'::regclass
     and c.conname = 'app_notifications_source_type_check';

  -- Every quoted literal in the definition. Live today it reads
  -- ARRAY['company_post'::text, ...]; after this file it reads
  -- '{company_post,...}'::text[], so array literals are split too.
  select array_agg(distinct t.v order by t.v) into v_missing
    from regexp_matches(coalesce(v_def, ''), '''([^'']*)''', 'g') as m,
         unnest(string_to_array(btrim(m[1], '{}'), ',')) as u(raw),
         btrim(u.raw, '" ') as t(v)
   where t.v <> '' and not (t.v = any (v_keep));
  if v_missing is not null then
    raise exception 'app_notifications_source_type_check allows % live, which this migration would drop',
      array_to_string(v_missing, ', ')
      using hint = 'Add the value(s) to v_keep in section 6, then re-run.';
  end if;

  alter table public.app_notifications drop constraint if exists app_notifications_source_type_check;
  execute format(
    'alter table public.app_notifications add constraint app_notifications_source_type_check
       check (source_type = any (%L::text[]))', v_keep);
end $$;

-- ───────────────────────── 7. Settings ─────────────────────────
-- Nicole files sub bills (decision 4). Looked up by email so a re-run on
-- another database never points at a stranger; an existing value is kept.
insert into public.app_settings (key, value)
select 'sub_bill_reviewer_profile_id', p.id::text
  from public.profiles p
 where lower(p.email) = 'nsmith@penneyconstructioninc.com'
 limit 1
on conflict (key) do nothing;
-- The 60-second how-to video. Blank hides every "Watch how" link.
insert into public.app_settings (key, value) values ('sub_portal_loom_url', '')
on conflict (key) do nothing;

-- ───────────────────────── 8. Office-only reads ─────────────────────────
-- Office roles may read the new tables; field crew and anon may not. There
-- are no insert/update/delete policies: every write goes through the service
-- role in the portal and office routes.
drop policy if exists sub_site_visits_office_read on public.sub_site_visits;
create policy sub_site_visits_office_read on public.sub_site_visits for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid())
                 and p.role in ('owner','precon_manager','project_manager','office_admin')));

drop policy if exists sub_bill_submissions_office_read on public.sub_bill_submissions;
create policy sub_bill_submissions_office_read on public.sub_bill_submissions for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid())
                 and p.role in ('owner','precon_manager','project_manager','office_admin')));

drop policy if exists sub_agreement_templates_office_read on public.sub_agreement_templates;
create policy sub_agreement_templates_office_read on public.sub_agreement_templates for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid())
                 and p.role in ('owner','precon_manager','project_manager','office_admin')));

drop policy if exists sub_agreements_office_read on public.sub_agreements;
create policy sub_agreements_office_read on public.sub_agreements for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid())
                 and p.role in ('owner','precon_manager','project_manager','office_admin')));
