-- ============================================================
-- Command Center Tables
-- Tracks quotes, follow-ups, client updates, and email activity
-- ============================================================

-- Quote request status
create type quote_request_status as enum (
  'just_sent',
  'awaiting_reply',
  'received',
  'in_progress',
  'accepted',
  'declined'
);

-- Follow-up status & priority
create type follow_up_status as enum ('open', 'done', 'snoozed');
create type follow_up_priority as enum ('low', 'medium', 'high', 'urgent');

-- Client update status
create type client_update_status as enum ('pending', 'sent', 'skipped');

-- Email tracking
create type email_direction as enum ('inbound', 'outbound');
create type email_category as enum ('client_update', 'sub_outreach', 'internal', 'quote', 'follow_up', 'other');

-- Project phase (construction stage)
create type project_phase as enum ('preconstruction', 'pre_start', 'rough_in', 'finishing', 'punch_list', 'complete');

-- ── Quote Requests ──────────────────────────────────────
create table quote_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete set null,
  subcontractor_id uuid references subcontractors(id) on delete set null,
  subcontractor_name text not null,
  project_name text not null,
  trade text,
  scope_description text,
  amount numeric(12,2),
  status quote_request_status not null default 'just_sent',
  sent_at timestamptz not null default now(),
  received_at timestamptz,
  notes text,
  gmail_message_id text,
  created_by uuid not null references profiles(id) on delete cascade,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── Follow-ups ──────────────────────────────────────
create table follow_ups (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete set null,
  project_name text,
  contact_name text not null,
  contact_type text not null default 'subcontractor',
  description text not null,
  status follow_up_status not null default 'open',
  priority follow_up_priority not null default 'medium',
  due_date timestamptz,
  completed_at timestamptz,
  gmail_draft_id text,
  created_by uuid not null references profiles(id) on delete cascade,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── Client Updates ──────────────────────────────────────
create table client_updates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete set null,
  client_name text not null,
  client_email text,
  week_start date not null default (date_trunc('week', current_date))::date,
  status client_update_status not null default 'pending',
  sent_at timestamptz,
  summary text,
  gmail_message_id text,
  created_by uuid not null references profiles(id) on delete cascade,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── Email Log ──────────────────────────────────────
create table email_logs (
  id uuid primary key default gen_random_uuid(),
  gmail_message_id text,
  subject text not null,
  from_email text not null,
  to_email text not null,
  direction email_direction not null default 'outbound',
  category email_category not null default 'other',
  project_id uuid references projects(id) on delete set null,
  sent_at timestamptz not null default now(),
  created_at timestamptz default now()
);

-- ── Add phase column to projects ──────────────────────────
alter table projects add column if not exists phase project_phase default 'preconstruction';
alter table projects add column if not exists next_action text;
alter table projects add column if not exists progress integer default 0;

-- ── Indexes ──────────────────────────────────────────────────
create index idx_quote_requests_project on quote_requests(project_id);
create index idx_quote_requests_status on quote_requests(status);
create index idx_follow_ups_project on follow_ups(project_id);
create index idx_follow_ups_status on follow_ups(status);
create index idx_client_updates_week on client_updates(week_start);
create index idx_client_updates_status on client_updates(status);
create index idx_email_logs_sent_at on email_logs(sent_at);
create index idx_email_logs_category on email_logs(category);

-- ── RLS Policies ─────────────────────────────────────────────
alter table quote_requests enable row level security;
alter table follow_ups enable row level security;
alter table client_updates enable row level security;
alter table email_logs enable row level security;

create policy "Authenticated users can manage quote_requests"
  on quote_requests for all to authenticated using (true) with check (true);

create policy "Authenticated users can manage follow_ups"
  on follow_ups for all to authenticated using (true) with check (true);

create policy "Authenticated users can manage client_updates"
  on client_updates for all to authenticated using (true) with check (true);

create policy "Authenticated users can manage email_logs"
  on email_logs for all to authenticated using (true) with check (true);
