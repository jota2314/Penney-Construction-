-- Twilio phone line: SMS + call log for the dedicated field number.
-- Only numbers on the allowlist (TWILIO_ALLOWED_NUMBERS / app_settings
-- twilio_allowed_numbers) get through; everything else is logged and ignored.

create table if not exists sms_messages (
  id uuid primary key default gen_random_uuid(),
  -- Twilio MessageSid. Unique so webhook retries can't double-insert.
  twilio_sid text unique,
  direction text not null check (direction in ('inbound', 'outbound')),
  from_number text not null,
  to_number text not null,
  body text not null default '',
  -- inbound: received | ignored; outbound: sent | failed
  status text not null default 'received',
  error_message text,
  -- Who this number resolved to at write time ('employee' | 'subcontractor').
  contact_kind text,
  contact_id uuid,
  contact_name text,
  sent_by_profile_id uuid references profiles(id),
  is_allowed boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists sms_messages_created_idx on sms_messages (created_at desc);
create index if not exists sms_messages_from_idx on sms_messages (from_number);

create table if not exists phone_calls (
  id uuid primary key default gen_random_uuid(),
  -- Twilio CallSid. Unique so webhook retries can't double-insert.
  twilio_call_sid text unique,
  direction text not null default 'inbound' check (direction in ('inbound', 'outbound')),
  from_number text not null,
  to_number text not null,
  -- received | forwarded | voicemail | rejected
  status text not null default 'received',
  duration_seconds integer,
  recording_sid text,
  recording_url text,
  recording_duration integer,
  transcript text,
  contact_kind text,
  contact_id uuid,
  contact_name text,
  is_allowed boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists phone_calls_created_idx on phone_calls (created_at desc);

alter table sms_messages enable row level security;
alter table phone_calls enable row level security;

-- House posture: any signed-in teammate can read; all writes go through the
-- service role (webhooks + server actions), so no insert/update policies.
drop policy if exists "sms_messages_select_authenticated" on sms_messages;
create policy "sms_messages_select_authenticated" on sms_messages
  for select to authenticated using (true);

drop policy if exists "phone_calls_select_authenticated" on phone_calls;
create policy "phone_calls_select_authenticated" on phone_calls
  for select to authenticated using (true);

-- Widen notification checks for phone-line pings.
alter table app_notifications drop constraint if exists app_notifications_kind_check;
alter table app_notifications add constraint app_notifications_kind_check
  check (kind in ('mention', 'comment', 'post', 'invoice', 'sms', 'call'));

alter table app_notifications drop constraint if exists app_notifications_source_type_check;
alter table app_notifications add constraint app_notifications_source_type_check
  check (source_type in (
    'company_post', 'daily_log', 'project_update', 'feed_comment',
    'field_invoice', 'client_payment', 'bill_pay_approval', 'phone_line'
  ));
