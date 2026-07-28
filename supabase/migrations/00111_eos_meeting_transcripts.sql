-- Applied live 2026-07-28.
--
-- Live transcription for the Level 10. The team talks, the AI files it.
-- One row per (meeting, agenda section): the accumulated transcript plus the
-- last set of AI proposals, so a page reload mid-meeting loses nothing and
-- the allocation can be re-run without re-recording.
create table eos_meeting_transcripts (
  id           uuid primary key default gen_random_uuid(),
  meeting_id   uuid not null references eos_meetings(id) on delete cascade,
  section_key  text not null,
  transcript   text not null default '',
  -- Whatever the allocator last returned, shape depends on the section.
  proposals    jsonb,
  proposed_at  timestamptz,
  applied_at   timestamptz,
  created_by   uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (meeting_id, section_key)
);
create index eos_meeting_transcripts_meeting_idx
  on eos_meeting_transcripts(meeting_id);

create trigger eos_meeting_transcripts_touch
  before update on eos_meeting_transcripts
  for each row execute function eos_touch_updated_at();

alter table eos_meeting_transcripts enable row level security;
create policy eos_member_all on eos_meeting_transcripts
  for all to authenticated
  using (public.eos_is_member())
  with check (public.eos_is_member());
