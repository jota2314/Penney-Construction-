-- 00126: Budget line close-out and lock.
--
-- When a budget line is finished and paid in full, it gets CLOSED: the
-- realized direct margin (client price - linked invoices - clocked crew
-- labor) is snapshotted onto the line, and the line is LOCKED so no further
-- cost can post to it.
--
-- The lock is enforced HERE, not in the UI. Cost gets coded to a line from
-- roughly 37 call sites (inbox router, field capture, chat handler,
-- split-invoice, auto-link, scan-quote, bids, daily-log routing) plus ad-hoc
-- SQL run straight against the DB. A UI-only guard leaks on day one, the same
-- way SQL-inserted change orders skipped their budget line and duplicate
-- supplier invoices slipped past the router.
--
-- Scope of the lock (Jorge, 8/21/26): COST POSTINGS ONLY. Price, markup,
-- scope text and description stay editable on a locked line. Anyone with
-- budget access can lock and unlock -- Howie, Nicole and Bill included.

alter table estimate_line_items
  add column if not exists is_locked boolean not null default false,
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid references profiles(id) on delete set null,
  add column if not exists closed_price numeric,
  add column if not exists closed_invoice_cost numeric,
  add column if not exists closed_labor_cost numeric,
  add column if not exists closed_margin numeric;

create index if not exists idx_estimate_line_items_locked
  on estimate_line_items(id) where is_locked;

-- ── Guard: vendor/sub invoices ────────────────────────────────────────────
--
-- Blocks posting cost onto a locked line, and blocks pulling cost back off
-- one (removing money changes the closed margin just as much as adding it).
-- Housekeeping updates on an already-attached invoice -- payment status,
-- QuickBooks ids, review flags, Drive urls -- stay allowed, otherwise closing
-- a line would break QBO sync and mark-paid on every invoice under it.

create or replace function public.guard_locked_line_item_invoice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidates uuid[];
  v_desc text;
begin
  if tg_op = 'INSERT' then
    v_candidates := array[new.estimate_line_item_id];
  elsif new.estimate_line_item_id is distinct from old.estimate_line_item_id then
    -- moving on to a line, or off of one: both ends matter
    v_candidates := array[new.estimate_line_item_id, old.estimate_line_item_id];
  elsif new.amount is distinct from old.amount then
    v_candidates := array[new.estimate_line_item_id];
  else
    return new;
  end if;

  select description into v_desc
  from estimate_line_items
  where id = any(v_candidates)
    and is_locked
  limit 1;

  if v_desc is not null then
    raise exception
      'Budget line "%" is closed and locked. Unlock it on the project Budget page before posting cost to it.',
      v_desc
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_locked_line_item_invoice on invoices;
create trigger trg_guard_locked_line_item_invoice
  before insert or update on invoices
  for each row execute function public.guard_locked_line_item_invoice();

-- ── Guard: crew labor ─────────────────────────────────────────────────────
--
-- Clocked labor reaches a line through schedule_phases.estimate_line_item_id,
-- so pointing a new or existing phase at a locked line is also a cost posting.
--
-- KNOWN GAP: hours keep accruing on a phase that was ALREADY linked when the
-- line was closed. Close a line only once its crew work is done, or unlink the
-- phase first. Blocking clock-ins would strand guys in the field, which is a
-- worse failure than a late hour landing on a closed line.

create or replace function public.guard_locked_line_item_phase()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidates uuid[];
  v_desc text;
begin
  if tg_op = 'INSERT' then
    v_candidates := array[new.estimate_line_item_id];
  elsif new.estimate_line_item_id is distinct from old.estimate_line_item_id then
    v_candidates := array[new.estimate_line_item_id, old.estimate_line_item_id];
  else
    return new;
  end if;

  select description into v_desc
  from estimate_line_items
  where id = any(v_candidates)
    and is_locked
  limit 1;

  if v_desc is not null then
    raise exception
      'Budget line "%" is closed and locked. Unlock it on the project Budget page before scheduling labor against it.',
      v_desc
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_locked_line_item_phase on schedule_phases;
create trigger trg_guard_locked_line_item_phase
  before insert or update on schedule_phases
  for each row execute function public.guard_locked_line_item_phase();
