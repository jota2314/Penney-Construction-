-- Two-way sub scheduling.
--
-- A sub can now answer a phase the office put him on (confirm / can't make
-- it) and put his own dates on the calendar from the portal. The office is
-- notified either way (app_notifications source_type 'sub_schedule').

alter table public.schedule_phases
  add column if not exists sub_response text
    check (sub_response in ('confirmed', 'declined')),
  add column if not exists sub_responded_at timestamptz,
  add column if not exists sub_response_note text,
  -- Set when the SUB created the phase from his portal. created_by still
  -- points at an office profile (it is NOT NULL and subs have no profile).
  add column if not exists created_by_sub_id uuid references public.subcontractors(id);

create index if not exists schedule_phases_created_by_sub_id_idx
  on public.schedule_phases (created_by_sub_id)
  where created_by_sub_id is not null;

-- Widen the notification source_type check to include sub schedule events.
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.app_notifications'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%source_type%'
  loop
    execute format('alter table public.app_notifications drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.app_notifications
  add constraint app_notifications_source_type_check
  check (source_type = any (array[
    'company_post', 'daily_log', 'project_update', 'feed_comment',
    'field_invoice', 'client_payment', 'bill_pay_approval', 'phone_line',
    'contract_signed', 'spend_help', 'sub_schedule'
  ]));
