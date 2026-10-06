-- One email delivered to several team mailboxes is stored ONCE in inbox_emails
-- (rfc822_message_id unique index, migration 00082). Each mailbox's copy has
-- its own Gmail message id, though, and sync only knew the first one — so
-- every other mailbox re-fetched the message from Gmail on every run, found
-- the rfc822 duplicate, and threw it away. Those wasted calls filled each
-- mailbox's per-run limit and ran the fetch-emails cron into its 60 s kill.
--
-- This table remembers each extra copy: sync skips it without a Gmail call,
-- and it records which teammates' mailboxes the email reached (the per-person
-- inbox views need that; inbox_emails.mailbox_ids was never written).

create table if not exists public.inbox_email_mailbox_copies (
  gmail_message_id text primary key,
  inbox_email_id uuid not null references public.inbox_emails(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists inbox_email_mailbox_copies_email_idx
  on public.inbox_email_mailbox_copies (inbox_email_id);
create index if not exists inbox_email_mailbox_copies_profile_idx
  on public.inbox_email_mailbox_copies (profile_id);

alter table public.inbox_email_mailbox_copies enable row level security;

-- Signed-in staff (manual Fetch button) can read and add copies; the cron and
-- Gmail push webhook use the service role. No anon access.
drop policy if exists "Staff read mailbox copies" on public.inbox_email_mailbox_copies;
create policy "Staff read mailbox copies"
  on public.inbox_email_mailbox_copies for select to authenticated using (true);

drop policy if exists "Staff add mailbox copies" on public.inbox_email_mailbox_copies;
create policy "Staff add mailbox copies"
  on public.inbox_email_mailbox_copies for insert to authenticated with check (true);

-- Sync stops paging at the first fully stored page only when the mailbox is
-- caught up. Runs drain newest-first, so a run that hits its limit, defers or
-- fails a message, or runs out of time leaves older unstored mail below stored
-- pages; it sets gmail_sync_backlog and later runs page through until one
-- comes up clean. Mail moved into the inbox later (rescued from Spam) keeps
-- its old date, so a full scan still runs at least hourly (gmail_full_scan_at).
-- Backlog defaults to true so every mailbox starts with one full scan.
alter table public.profiles
  add column if not exists gmail_sync_backlog boolean not null default true,
  add column if not exists gmail_full_scan_at timestamptz;
