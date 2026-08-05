-- Subcontractor portal: PIN + link access for subs (John, Chuck, ...) who
-- have no Penney Google account. Mirrors client_portal_access (00083): the
-- token is the credential, served by a service-role API; additionally a sub
-- can sign in at /sub with phone + 4-digit PIN, which sets the token cookie.
create table if not exists sub_portal_access (
  id uuid primary key default gen_random_uuid(),
  subcontractor_id uuid not null references subcontractors(id) on delete cascade,
  token uuid not null default gen_random_uuid(),
  -- Login identity: digits-only phone (leading 1 stripped), unique per sub.
  phone_login text,
  -- sha256("{token}:{pin}") — never the raw PIN.
  pin_hash text,
  enabled boolean not null default true,
  -- Brute-force guard for the 4-digit PIN.
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  last_viewed_at timestamptz,
  view_count integer not null default 0,
  link_sent_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists sub_portal_access_sub_idx on sub_portal_access(subcontractor_id);
create unique index if not exists sub_portal_access_token_idx on sub_portal_access(token);
create index if not exists sub_portal_access_phone_idx on sub_portal_access(phone_login);

alter table sub_portal_access enable row level security;

-- Office users can see portal status in the subs directory; all writes go
-- through server actions / the public API with the service role (PIN hashing
-- and login-throttle bookkeeping must never run client-side).
create policy "sub_portal_access_select_authenticated"
  on sub_portal_access for select
  to authenticated
  using (true);
