-- Jorge (11/22): team calls and texts go through Quo (formerly OpenPhone) and
-- land on the job. Quo's webhook (/api/quo/webhook) writes into the same two
-- tables the Twilio field line created, so one Phone screen can read both
-- providers. Additive only; both tables were empty when this was written.

-- ------------------------------------------------------------------- texts
alter table public.sms_messages
  add column if not exists provider text not null default 'twilio',
  -- The provider's own id for the message (Quo: AC...). With provider it is
  -- the key webhook retries and status updates land on.
  add column if not exists external_id text,
  add column if not exists project_id uuid references public.projects(id) on delete set null,
  -- How project_id was chosen: single_open | single | ambiguous | none | manual.
  add column if not exists project_match text,
  -- Every recipient of a group text (to_number keeps the first).
  add column if not exists recipients text[] not null default '{}',
  -- [{ type, url }] for MMS.
  add column if not exists media jsonb not null default '[]'::jsonb,
  add column if not exists conversation_id text,
  -- Which of our numbers it was on (Quo phoneNumberId, PN...).
  add column if not exists line_id text,
  -- The Quo user on our side (US...).
  add column if not exists external_user_id text,
  add column if not exists external_url text,
  -- When it happened at the provider (created_at is when we stored it).
  add column if not exists occurred_at timestamptz;

alter table public.sms_messages drop constraint if exists sms_messages_provider_check;
alter table public.sms_messages add constraint sms_messages_provider_check
  check (provider in ('twilio', 'quo'));

alter table public.sms_messages drop constraint if exists sms_messages_project_match_check;
alter table public.sms_messages add constraint sms_messages_project_match_check
  check (project_match is null or project_match in ('single_open', 'single', 'ambiguous', 'none', 'manual'));

-- A plain (not partial) unique index so PostgREST upserts can target it.
-- Twilio rows leave external_id null, and nulls never collide.
create unique index if not exists sms_messages_provider_external_key
  on public.sms_messages (provider, external_id);
create index if not exists sms_messages_project_idx
  on public.sms_messages (project_id, created_at desc) where project_id is not null;
create index if not exists sms_messages_contact_idx
  on public.sms_messages (contact_kind, contact_id) where contact_id is not null;

comment on column public.sms_messages.contact_kind is
  'employee | customer | subcontractor: who the outside number resolved to at write time.';

-- ------------------------------------------------------------------- calls
alter table public.phone_calls
  add column if not exists provider text not null default 'twilio',
  add column if not exists external_id text,
  add column if not exists project_id uuid references public.projects(id) on delete set null,
  add column if not exists project_match text,
  add column if not exists conversation_id text,
  add column if not exists line_id text,
  add column if not exists external_user_id text,
  add column if not exists external_url text,
  add column if not exists occurred_at timestamptz,
  add column if not exists answered_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists has_voicemail boolean not null default false,
  -- Every recording segment Quo reports (a paused call has several);
  -- recording_url keeps the first.
  add column if not exists recordings jsonb not null default '[]'::jsonb,
  -- Quo's AI call summary and follow-ups, one bullet per element.
  add column if not exists summary text[] not null default '{}',
  add column if not exists next_steps text[] not null default '{}',
  -- [{ userId, identifier, content, start, end }]; transcript keeps the
  -- flattened "speaker: words" text.
  add column if not exists transcript_segments jsonb not null default '[]'::jsonb;

alter table public.phone_calls drop constraint if exists phone_calls_provider_check;
alter table public.phone_calls add constraint phone_calls_provider_check
  check (provider in ('twilio', 'quo'));

alter table public.phone_calls drop constraint if exists phone_calls_project_match_check;
alter table public.phone_calls add constraint phone_calls_project_match_check
  check (project_match is null or project_match in ('single_open', 'single', 'ambiguous', 'none', 'manual'));

create unique index if not exists phone_calls_provider_external_key
  on public.phone_calls (provider, external_id);
create index if not exists phone_calls_project_idx
  on public.phone_calls (project_id, created_at desc) where project_id is not null;
create index if not exists phone_calls_contact_idx
  on public.phone_calls (contact_kind, contact_id) where contact_id is not null;

comment on column public.phone_calls.contact_kind is
  'employee | customer | subcontractor: who the outside number resolved to at write time.';

-- RLS is unchanged from the Twilio migration: any signed-in teammate can
-- read, and every write goes through the service role (the webhook).
