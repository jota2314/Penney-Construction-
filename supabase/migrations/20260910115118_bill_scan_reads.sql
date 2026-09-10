-- Non-financial, immutable checkpoints. Only the authenticated server routes
-- may create them, after checking the effective user's upload path.
create table public.bill_scan_reads (
  storage_path text primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  result jsonb not null,
  created_at timestamptz not null default now(),
  constraint bill_scan_read_owner_path check (split_part(storage_path, '/', 1) = owner_id::text),
  constraint bill_scan_read_result_path check ((result->'scan'->>'storagePath' = storage_path) is true)
);
create index bill_scan_reads_owner_id_idx on public.bill_scan_reads(owner_id);
alter table public.bill_scan_reads enable row level security;
revoke all on table public.bill_scan_reads from public, anon, authenticated, service_role;
grant select, insert on table public.bill_scan_reads to service_role;
comment on table public.bill_scan_reads is 'Saved AI invoice reads, never bills, payments or ledger entries. Allocation retries reuse these checkpoints.';
