-- Track when the walkthrough/meeting is scheduled for a lead
alter table projects
  add column walkthrough_scheduled_at timestamptz;
