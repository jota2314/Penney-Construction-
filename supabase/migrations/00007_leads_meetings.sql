-- ============================================================
-- 00007: Leads & Meetings (CRM Pipeline)
-- ============================================================

-- 1. Leads table
create sequence public.lead_number_seq start with 1;

create table public.leads (
  id uuid default gen_random_uuid() primary key,
  lead_number text not null unique default (
    'LD-' || extract(year from now())::text || '-' || lpad(nextval('lead_number_seq')::text, 3, '0')
  ),
  first_name text not null,
  last_name text not null,
  phone text,
  email text,
  address text,
  city text,
  state text,
  zip text,
  project_type text check (project_type in ('remodel', 'addition', 'kitchen', 'bathroom', 'new_construction', 'other')),
  description text,
  referral_source text check (referral_source in ('facebook', 'google', 'referral', 'website', 'other')),
  referral_detail text,
  budget_min numeric(12,2),
  budget_max numeric(12,2),
  urgency text default 'unknown' check (urgency in ('asap', 'within_month', 'within_3_months', 'flexible', 'unknown')),
  timeline_notes text,
  status text not null default 'new' check (status in ('new', 'contacted', 'meeting_scheduled', 'meeting_complete', 'converted', 'lost')),
  lost_reason text,
  customer_id uuid references public.customers(id),
  project_id uuid references public.projects(id),
  created_by uuid references public.profiles(id) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_leads_status on public.leads(status);

-- 2. Meetings table
create table public.meetings (
  id uuid default gen_random_uuid() primary key,
  lead_id uuid not null references public.leads(id) on delete cascade,
  scheduled_at timestamptz not null,
  completed_at timestamptz,
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled')),
  address text,
  city text,
  state text,
  zip text,
  summary text,
  created_by uuid references public.profiles(id) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_meetings_lead_id on public.meetings(lead_id);
create index idx_meetings_scheduled_at on public.meetings(scheduled_at);
create index idx_meetings_status on public.meetings(status);

-- 3. Meeting notes
create table public.meeting_notes (
  id uuid default gen_random_uuid() primary key,
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  content text not null,
  source text not null default 'typed' check (source in ('typed', 'voice')),
  sort_order integer not null default 0,
  created_by uuid references public.profiles(id) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_meeting_notes_meeting_id on public.meeting_notes(meeting_id);

-- 4. Meeting files (photos)
create table public.meeting_files (
  id uuid default gen_random_uuid() primary key,
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  file_size integer not null,
  mime_type text not null,
  caption text,
  uploaded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index idx_meeting_files_meeting_id on public.meeting_files(meeting_id);

-- 5. Lead files (photos sent during initial call)
create table public.lead_files (
  id uuid default gen_random_uuid() primary key,
  lead_id uuid not null references public.leads(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  file_size integer not null,
  mime_type text not null,
  uploaded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index idx_lead_files_lead_id on public.lead_files(lead_id);

-- 6. RLS policies (all authenticated users can do everything)
alter table public.leads enable row level security;
alter table public.meetings enable row level security;
alter table public.meeting_notes enable row level security;
alter table public.meeting_files enable row level security;
alter table public.lead_files enable row level security;

-- Leads
create policy "Authenticated users can view leads"
  on public.leads for select to authenticated using (true);
create policy "Authenticated users can insert leads"
  on public.leads for insert to authenticated with check (true);
create policy "Authenticated users can update leads"
  on public.leads for update to authenticated using (true);
create policy "Authenticated users can delete leads"
  on public.leads for delete to authenticated using (true);

-- Meetings
create policy "Authenticated users can view meetings"
  on public.meetings for select to authenticated using (true);
create policy "Authenticated users can insert meetings"
  on public.meetings for insert to authenticated with check (true);
create policy "Authenticated users can update meetings"
  on public.meetings for update to authenticated using (true);
create policy "Authenticated users can delete meetings"
  on public.meetings for delete to authenticated using (true);

-- Meeting notes
create policy "Authenticated users can view meeting notes"
  on public.meeting_notes for select to authenticated using (true);
create policy "Authenticated users can insert meeting notes"
  on public.meeting_notes for insert to authenticated with check (true);
create policy "Authenticated users can update meeting notes"
  on public.meeting_notes for update to authenticated using (true);
create policy "Authenticated users can delete meeting notes"
  on public.meeting_notes for delete to authenticated using (true);

-- Meeting files
create policy "Authenticated users can view meeting files"
  on public.meeting_files for select to authenticated using (true);
create policy "Authenticated users can insert meeting files"
  on public.meeting_files for insert to authenticated with check (true);
create policy "Authenticated users can delete meeting files"
  on public.meeting_files for delete to authenticated using (true);

-- Lead files
create policy "Authenticated users can view lead files"
  on public.lead_files for select to authenticated using (true);
create policy "Authenticated users can insert lead files"
  on public.lead_files for insert to authenticated with check (true);
create policy "Authenticated users can delete lead files"
  on public.lead_files for delete to authenticated using (true);
