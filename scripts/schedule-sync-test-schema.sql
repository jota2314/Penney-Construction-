create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.role() returns text language sql as $$select current_setting('request.jwt.claim.role',true)$$;
grant usage on schema public,auth to authenticated,service_role,anon;
grant execute on all functions in schema auth to authenticated,service_role,anon;
create table public.profiles(id uuid primary key,role text not null);
create type public.project_phase as enum ('preconstruction','pre_start','rough_in','finishing','punch_list','complete');
create table public.projects(id uuid primary key,name text,status text,phase public.project_phase default 'preconstruction',progress integer,contract_value numeric);
create table public.estimates(id uuid primary key default gen_random_uuid(),project_id uuid references public.projects(id),status text not null default 'draft');
create type public.schedule_phase_status as enum ('not_started','in_progress','completed','on_hold');
create table public.schedule_phases(
 id uuid primary key default gen_random_uuid(),project_id uuid references public.projects(id),name text not null,
 start_date date not null,end_date date not null,planned_start_date date,planned_end_date date,
 status public.schedule_phase_status not null default 'not_started',phase_scope text not null default 'master',
 event_type text default 'phase',sort_order integer not null default 0,is_confirmed boolean not null default false,
 is_manually_scheduled boolean not null default false,created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.daily_logs(id uuid primary key default gen_random_uuid(),project_id uuid references public.projects(id),schedule_phase_id uuid references public.schedule_phases(id),author_id uuid references public.profiles(id),text text,status text default 'completed',updated_at timestamptz not null default now());
create table public.activity_log(id uuid primary key default gen_random_uuid(),user_id uuid,action text,entity_type text,entity_id uuid,details jsonb,created_at timestamptz default now());
grant select on public.profiles to authenticated,service_role;
grant select,insert,update,delete on public.projects,public.estimates,public.schedule_phases,public.daily_logs to authenticated,service_role;
grant select,insert on public.activity_log to authenticated,service_role;
alter table public.schedule_phases enable row level security;
create policy legacy_schedule_access on public.schedule_phases for all to authenticated using(true) with check(true);
