-- Link walkthroughs to meetings so the address flows automatically
alter table walkthroughs
  add column meeting_id uuid references meetings(id) on delete set null;

-- Index for fast lookup
create index idx_walkthroughs_meeting_id on walkthroughs(meeting_id);
