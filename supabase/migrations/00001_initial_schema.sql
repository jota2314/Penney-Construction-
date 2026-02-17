-- ============================================
-- Penney Construction - Initial Schema
-- ============================================

-- Profiles (extends auth.users)
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text not null,
  full_name text,
  avatar_url text,
  role text not null default 'project_manager' check (role in ('owner', 'precon_manager', 'project_manager')),
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Auto-create profile on user signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Customers
create table public.customers (
  id uuid default gen_random_uuid() primary key,
  first_name text not null,
  last_name text not null,
  email text,
  phone text,
  address text,
  city text,
  state text,
  zip text,
  notes text,
  created_by uuid references public.profiles(id) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Projects
create sequence public.project_number_seq start with 1;

create table public.projects (
  id uuid default gen_random_uuid() primary key,
  project_number text not null unique default (
    'PC-' || extract(year from now())::text || '-' || lpad(nextval('project_number_seq')::text, 3, '0')
  ),
  name text not null,
  customer_id uuid references public.customers(id),
  status text not null default 'lead' check (status in ('lead', 'estimating', 'proposal_sent', 'contracted', 'in_progress', 'completed', 'cancelled')),
  project_type text not null default 'other' check (project_type in ('remodel', 'addition', 'kitchen', 'bathroom', 'new_construction', 'other')),
  description text,
  address text,
  city text,
  state text,
  zip text,
  estimated_start_date date,
  estimated_end_date date,
  actual_start_date date,
  actual_end_date date,
  estimated_value numeric(12,2),
  contract_value numeric(12,2),
  assigned_pm uuid references public.profiles(id),
  assigned_estimator uuid references public.profiles(id),
  notes text,
  created_by uuid references public.profiles(id) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Cost Code Categories
create table public.cost_code_categories (
  id uuid default gen_random_uuid() primary key,
  code text not null unique,
  name text not null,
  description text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- Cost Codes
create table public.cost_codes (
  id uuid default gen_random_uuid() primary key,
  category_id uuid references public.cost_code_categories(id) on delete cascade not null,
  code text not null unique,
  name text not null,
  description text,
  default_unit text,
  default_unit_cost numeric(10,2),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Estimates
create table public.estimates (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references public.projects(id) on delete cascade not null,
  version integer not null default 1,
  name text not null,
  status text not null default 'draft' check (status in ('draft', 'review', 'approved', 'superseded')),
  notes text,
  total_cost numeric(12,2) not null default 0,
  markup_percentage numeric(5,2) not null default 20,
  total_price numeric(12,2) not null default 0,
  created_by uuid references public.profiles(id) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, version)
);

-- Estimate Line Items
create table public.estimate_line_items (
  id uuid default gen_random_uuid() primary key,
  estimate_id uuid references public.estimates(id) on delete cascade not null,
  cost_code_id uuid references public.cost_codes(id),
  description text not null,
  quantity numeric(10,2) not null default 1,
  unit text not null default 'ea',
  unit_cost numeric(10,2) not null default 0,
  total_cost numeric(12,2) not null default 0,
  markup_percentage numeric(5,2) not null default 0,
  total_price numeric(12,2) not null default 0,
  is_visible_on_proposal boolean not null default true,
  proposal_description text,
  sort_order integer not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Budget Templates
create table public.budget_templates (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  description text,
  project_type text check (project_type in ('remodel', 'addition', 'kitchen', 'bathroom', 'new_construction', 'other')),
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Budget Template Items
create table public.budget_template_items (
  id uuid default gen_random_uuid() primary key,
  template_id uuid references public.budget_templates(id) on delete cascade not null,
  cost_code_id uuid references public.cost_codes(id),
  description text not null,
  quantity numeric(10,2) not null default 1,
  unit text not null default 'ea',
  unit_cost numeric(10,2) not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- Subcontractors
create table public.subcontractors (
  id uuid default gen_random_uuid() primary key,
  company_name text not null,
  contact_name text,
  email text,
  phone text,
  address text,
  city text,
  state text,
  zip text,
  trades text[] not null default '{}',
  license_number text,
  insurance_expiry date,
  rating integer check (rating >= 1 and rating <= 5),
  notes text,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Bid Packages
create table public.bid_packages (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references public.projects(id) on delete cascade not null,
  name text not null,
  description text,
  trade text not null,
  scope_of_work text,
  due_date date,
  status text not null default 'draft' check (status in ('draft', 'sent', 'received', 'awarded', 'cancelled')),
  created_by uuid references public.profiles(id) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Subcontractor Bids
create table public.subcontractor_bids (
  id uuid default gen_random_uuid() primary key,
  bid_package_id uuid references public.bid_packages(id) on delete cascade not null,
  subcontractor_id uuid references public.subcontractors(id) not null,
  amount numeric(12,2),
  notes text,
  submitted_at timestamptz,
  status text not null default 'invited' check (status in ('invited', 'submitted', 'accepted', 'rejected')),
  is_selected boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Proposals
create table public.proposals (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references public.projects(id) on delete cascade not null,
  estimate_id uuid references public.estimates(id) not null,
  version integer not null default 1,
  status text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'rejected', 'revised')),
  title text not null,
  introduction text,
  scope_of_work text,
  exclusions text,
  terms text,
  total_price numeric(12,2) not null default 0,
  sent_at timestamptz,
  responded_at timestamptz,
  created_by uuid references public.profiles(id) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Activity Log
create table public.activity_log (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) not null,
  action text not null,
  entity_type text not null,
  entity_id uuid not null,
  details jsonb,
  created_at timestamptz not null default now()
);

-- Updated_at trigger function
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Apply updated_at triggers
create trigger set_updated_at before update on public.profiles
  for each row execute function public.handle_updated_at();
create trigger set_updated_at before update on public.customers
  for each row execute function public.handle_updated_at();
create trigger set_updated_at before update on public.projects
  for each row execute function public.handle_updated_at();
create trigger set_updated_at before update on public.cost_codes
  for each row execute function public.handle_updated_at();
create trigger set_updated_at before update on public.estimates
  for each row execute function public.handle_updated_at();
create trigger set_updated_at before update on public.estimate_line_items
  for each row execute function public.handle_updated_at();
create trigger set_updated_at before update on public.budget_templates
  for each row execute function public.handle_updated_at();
create trigger set_updated_at before update on public.subcontractors
  for each row execute function public.handle_updated_at();
create trigger set_updated_at before update on public.bid_packages
  for each row execute function public.handle_updated_at();
create trigger set_updated_at before update on public.subcontractor_bids
  for each row execute function public.handle_updated_at();
create trigger set_updated_at before update on public.proposals
  for each row execute function public.handle_updated_at();

-- Indexes
create index idx_projects_customer on public.projects(customer_id);
create index idx_projects_status on public.projects(status);
create index idx_projects_assigned_pm on public.projects(assigned_pm);
create index idx_estimates_project on public.estimates(project_id);
create index idx_estimate_line_items_estimate on public.estimate_line_items(estimate_id);
create index idx_estimate_line_items_cost_code on public.estimate_line_items(cost_code_id);
create index idx_cost_codes_category on public.cost_codes(category_id);
create index idx_bid_packages_project on public.bid_packages(project_id);
create index idx_subcontractor_bids_package on public.subcontractor_bids(bid_package_id);
create index idx_subcontractor_bids_sub on public.subcontractor_bids(subcontractor_id);
create index idx_proposals_project on public.proposals(project_id);
create index idx_proposals_estimate on public.proposals(estimate_id);
create index idx_activity_log_user on public.activity_log(user_id);
create index idx_activity_log_entity on public.activity_log(entity_type, entity_id);
