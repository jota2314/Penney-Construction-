-- ============================================
-- Penney Construction - Row Level Security
-- ============================================
-- Small team (3 users): all authenticated users can read everything.
-- Write access varies by table. Cost codes/templates restricted to owner + precon_manager.

-- Enable RLS on all tables
alter table public.profiles enable row level security;
alter table public.customers enable row level security;
alter table public.projects enable row level security;
alter table public.cost_code_categories enable row level security;
alter table public.cost_codes enable row level security;
alter table public.estimates enable row level security;
alter table public.estimate_line_items enable row level security;
alter table public.budget_templates enable row level security;
alter table public.budget_template_items enable row level security;
alter table public.subcontractors enable row level security;
alter table public.bid_packages enable row level security;
alter table public.subcontractor_bids enable row level security;
alter table public.proposals enable row level security;
alter table public.activity_log enable row level security;

-- ============================================
-- Profiles
-- ============================================
create policy "Users can view all profiles"
  on public.profiles for select
  to authenticated
  using (true);

create policy "Users can update own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id);

-- ============================================
-- Customers
-- ============================================
create policy "Authenticated users can view customers"
  on public.customers for select
  to authenticated
  using (true);

create policy "Authenticated users can create customers"
  on public.customers for insert
  to authenticated
  with check (auth.uid() = created_by);

create policy "Authenticated users can update customers"
  on public.customers for update
  to authenticated
  using (true);

-- ============================================
-- Projects
-- ============================================
create policy "Authenticated users can view projects"
  on public.projects for select
  to authenticated
  using (true);

create policy "Authenticated users can create projects"
  on public.projects for insert
  to authenticated
  with check (auth.uid() = created_by);

create policy "Authenticated users can update projects"
  on public.projects for update
  to authenticated
  using (true);

-- ============================================
-- Cost Code Categories (read: all, write: owner + precon_manager)
-- ============================================
create policy "Authenticated users can view categories"
  on public.cost_code_categories for select
  to authenticated
  using (true);

create policy "Owner and precon can manage categories"
  on public.cost_code_categories for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('owner', 'precon_manager')
    )
  );

-- ============================================
-- Cost Codes (read: all, write: owner + precon_manager)
-- ============================================
create policy "Authenticated users can view cost codes"
  on public.cost_codes for select
  to authenticated
  using (true);

create policy "Owner and precon can manage cost codes"
  on public.cost_codes for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('owner', 'precon_manager')
    )
  );

-- ============================================
-- Estimates
-- ============================================
create policy "Authenticated users can view estimates"
  on public.estimates for select
  to authenticated
  using (true);

create policy "Authenticated users can create estimates"
  on public.estimates for insert
  to authenticated
  with check (auth.uid() = created_by);

create policy "Authenticated users can update estimates"
  on public.estimates for update
  to authenticated
  using (true);

-- ============================================
-- Estimate Line Items
-- ============================================
create policy "Authenticated users can view line items"
  on public.estimate_line_items for select
  to authenticated
  using (true);

create policy "Authenticated users can manage line items"
  on public.estimate_line_items for all
  to authenticated
  using (true);

-- ============================================
-- Budget Templates (read: all, write: owner + precon_manager)
-- ============================================
create policy "Authenticated users can view templates"
  on public.budget_templates for select
  to authenticated
  using (true);

create policy "Owner and precon can manage templates"
  on public.budget_templates for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('owner', 'precon_manager')
    )
  );

-- ============================================
-- Budget Template Items
-- ============================================
create policy "Authenticated users can view template items"
  on public.budget_template_items for select
  to authenticated
  using (true);

create policy "Owner and precon can manage template items"
  on public.budget_template_items for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('owner', 'precon_manager')
    )
  );

-- ============================================
-- Subcontractors
-- ============================================
create policy "Authenticated users can view subcontractors"
  on public.subcontractors for select
  to authenticated
  using (true);

create policy "Authenticated users can create subcontractors"
  on public.subcontractors for insert
  to authenticated
  with check (auth.uid() = created_by);

create policy "Authenticated users can update subcontractors"
  on public.subcontractors for update
  to authenticated
  using (true);

-- ============================================
-- Bid Packages
-- ============================================
create policy "Authenticated users can view bid packages"
  on public.bid_packages for select
  to authenticated
  using (true);

create policy "Authenticated users can create bid packages"
  on public.bid_packages for insert
  to authenticated
  with check (auth.uid() = created_by);

create policy "Authenticated users can update bid packages"
  on public.bid_packages for update
  to authenticated
  using (true);

-- ============================================
-- Subcontractor Bids
-- ============================================
create policy "Authenticated users can view bids"
  on public.subcontractor_bids for select
  to authenticated
  using (true);

create policy "Authenticated users can manage bids"
  on public.subcontractor_bids for all
  to authenticated
  using (true);

-- ============================================
-- Proposals
-- ============================================
create policy "Authenticated users can view proposals"
  on public.proposals for select
  to authenticated
  using (true);

create policy "Authenticated users can create proposals"
  on public.proposals for insert
  to authenticated
  with check (auth.uid() = created_by);

create policy "Authenticated users can update proposals"
  on public.proposals for update
  to authenticated
  using (true);

-- ============================================
-- Activity Log
-- ============================================
create policy "Authenticated users can view activity log"
  on public.activity_log for select
  to authenticated
  using (true);

create policy "Authenticated users can create log entries"
  on public.activity_log for insert
  to authenticated
  with check (auth.uid() = user_id);
