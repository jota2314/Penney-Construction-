-- Applied live 2026-07-28 under the label `00098_eos_core_schema`.
-- Filed here as 00108 because 00098 was already taken in this folder
-- (00098_feed_comments_rls_allow_managers / 00098_project_card_stats).
--
-- ============================================================
-- EOS (Entrepreneurial Operating System) module
-- Level 10 Meetings, Rocks, Scorecard, Issues, To-Dos,
-- Accountability Chart, V/TO.
-- Replaces the Success.co trial as the source of truth.
-- ============================================================

create type eos_rock_status      as enum ('on_track','off_track','complete','incomplete');
create type eos_rock_type        as enum ('company','individual');
create type eos_issue_status     as enum ('open','solved','dropped');
create type eos_issue_term       as enum ('short_term','long_term');
create type eos_todo_status      as enum ('open','done','dropped');
create type eos_meeting_status   as enum ('scheduled','in_progress','completed','cancelled');
create type eos_unit             as enum ('number','currency','percentage','yes_no','duration');
create type eos_cadence          as enum ('weekly','monthly','quarterly');
create type eos_headline_kind    as enum ('customer','employee');

-- ── Teams ────────────────────────────────────────────────────
create table eos_teams (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  is_leadership boolean not null default false,
  -- 0 = Sunday .. 6 = Saturday; when the L10 recurs
  meeting_day   smallint check (meeting_day between 0 and 6),
  meeting_time  time,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table eos_team_members (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references eos_teams(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  seat_label text,
  is_leader  boolean not null default false,
  created_at timestamptz not null default now(),
  unique (team_id, profile_id)
);
create index eos_team_members_profile_idx on eos_team_members(profile_id);

-- ── Accountability Chart ─────────────────────────────────────
create table eos_seats (
  id                uuid primary key default gen_random_uuid(),
  team_id           uuid references eos_teams(id) on delete set null,
  parent_id         uuid references eos_seats(id) on delete cascade,
  name              text not null,
  holder_profile_id uuid references profiles(id) on delete set null,
  -- for seats held by someone without an app login
  holder_name       text,
  roles             text[] not null default '{}',
  sort_order        integer not null default 0,
  external_ref      text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index eos_seats_parent_idx on eos_seats(parent_id);

-- ── Rocks (quarterly priorities) ─────────────────────────────
create table eos_rocks (
  id               uuid primary key default gen_random_uuid(),
  team_id          uuid not null references eos_teams(id) on delete cascade,
  title            text not null,
  description      text,
  owner_profile_id uuid references profiles(id) on delete set null,
  type             eos_rock_type   not null default 'company',
  -- free text so it survives any fiscal convention, e.g. 'Q3 2026'
  quarter          text not null,
  due_date         date,
  status           eos_rock_status not null default 'on_track',
  completed_at     timestamptz,
  sort_order       integer not null default 0,
  external_ref     text,
  created_by       uuid references profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index eos_rocks_team_quarter_idx on eos_rocks(team_id, quarter);

create table eos_rock_milestones (
  id           uuid primary key default gen_random_uuid(),
  rock_id      uuid not null references eos_rocks(id) on delete cascade,
  title        text not null,
  due_date     date,
  is_done      boolean not null default false,
  completed_at timestamptz,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now()
);
create index eos_rock_milestones_rock_idx on eos_rock_milestones(rock_id);

-- ── Scorecard ────────────────────────────────────────────────
create table eos_measurables (
  id               uuid primary key default gen_random_uuid(),
  team_id          uuid not null references eos_teams(id) on delete cascade,
  name             text not null,
  description      text,
  owner_profile_id uuid references profiles(id) on delete set null,
  unit             eos_unit    not null default 'number',
  -- NULLABLE on purpose: Success.co forced NOT NULL, so every
  -- "goal TBD at L10" measurable rendered as a literal 0 goal.
  goal_target      numeric,
  comparison       text not null default '>=' check (comparison in ('>=','<=','=','>','<')),
  cadence          eos_cadence not null default 'weekly',
  is_active        boolean not null default true,
  sort_order       integer not null default 0,
  external_ref     text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index eos_measurables_team_idx on eos_measurables(team_id) where is_active;

create table eos_scores (
  id            uuid primary key default gen_random_uuid(),
  measurable_id uuid not null references eos_measurables(id) on delete cascade,
  -- always the SUNDAY that ends the scorecard week
  week_ending   date not null,
  value         numeric,
  note          text,
  entered_by    uuid references profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (measurable_id, week_ending)
);
create index eos_scores_week_idx on eos_scores(week_ending desc);

-- ── Issues (the IDS list) ────────────────────────────────────
create table eos_issues (
  id               uuid primary key default gen_random_uuid(),
  team_id          uuid not null references eos_teams(id) on delete cascade,
  title            text not null,
  description      text,
  owner_profile_id uuid references profiles(id) on delete set null,
  term             eos_issue_term   not null default 'short_term',
  status           eos_issue_status not null default 'open',
  -- 1/2/3 = the top three voted for IDS this meeting
  priority         smallint check (priority between 1 and 3),
  solution         text,
  solved_at        timestamptz,
  meeting_id       uuid,
  -- where it came from: an off-track measurable, a rock, a headline…
  source           text not null default 'manual',
  source_ref       uuid,
  created_by       uuid references profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index eos_issues_team_status_idx on eos_issues(team_id, status);

-- ── To-Dos (7-day action items) ──────────────────────────────
create table eos_todos (
  id               uuid primary key default gen_random_uuid(),
  team_id          uuid not null references eos_teams(id) on delete cascade,
  title            text not null,
  description      text,
  owner_profile_id uuid references profiles(id) on delete set null,
  due_date         date,
  status           eos_todo_status not null default 'open',
  completed_at     timestamptz,
  meeting_id       uuid,
  created_by       uuid references profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index eos_todos_team_status_idx on eos_todos(team_id, status);

-- ── Level 10 Meetings ────────────────────────────────────────
create table eos_meetings (
  id                uuid primary key default gen_random_uuid(),
  team_id           uuid not null references eos_teams(id) on delete cascade,
  meeting_date      date not null,
  status            eos_meeting_status not null default 'scheduled',
  started_at        timestamptz,
  ended_at          timestamptz,
  -- agenda section key currently on screen, e.g. 'ids'
  current_section   text,
  section_started_at timestamptz,
  -- [{ key, started_at, ended_at }] — actual time spent per section
  section_log       jsonb not null default '[]'::jsonb,
  cascading_message text,
  notes             text,
  avg_rating        numeric(3,1),
  created_by        uuid references profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (team_id, meeting_date)
);
create index eos_meetings_team_date_idx on eos_meetings(team_id, meeting_date desc);

alter table eos_issues add constraint eos_issues_meeting_fkey
  foreign key (meeting_id) references eos_meetings(id) on delete set null;
alter table eos_todos  add constraint eos_todos_meeting_fkey
  foreign key (meeting_id) references eos_meetings(id) on delete set null;

create table eos_meeting_attendees (
  id            uuid primary key default gen_random_uuid(),
  meeting_id    uuid not null references eos_meetings(id) on delete cascade,
  profile_id    uuid not null references profiles(id) on delete cascade,
  is_present    boolean not null default true,
  -- Segue: personal + business best of the last 7 days
  personal_best text,
  business_best text,
  -- Conclude: 1-10 rating of the meeting
  rating        smallint check (rating between 1 and 10),
  created_at    timestamptz not null default now(),
  unique (meeting_id, profile_id)
);

create table eos_headlines (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references eos_teams(id) on delete cascade,
  meeting_id uuid references eos_meetings(id) on delete set null,
  kind       eos_headline_kind not null,
  body       text not null,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index eos_headlines_meeting_idx on eos_headlines(meeting_id);

-- ── V/TO (Vision / Traction Organizer) ───────────────────────
-- One row per team. Stays mostly empty until Vision Building
-- Day 1 (2026-08-13) — that session is what produces it.
create table eos_vto (
  id                    uuid primary key default gen_random_uuid(),
  team_id               uuid not null unique references eos_teams(id) on delete cascade,
  -- [{ title, description }]
  core_values           jsonb not null default '[]'::jsonb,
  purpose               text,
  niche                 text,
  ten_year_target       text,
  target_market         text,
  -- [string]
  three_uniques         jsonb not null default '[]'::jsonb,
  proven_process        text,
  guarantee             text,
  three_year_date       date,
  three_year_revenue    numeric,
  three_year_profit     numeric,
  three_year_measurables text,
  three_year_picture    jsonb not null default '[]'::jsonb,
  one_year_date         date,
  one_year_revenue      numeric,
  one_year_profit       numeric,
  one_year_measurables  text,
  one_year_goals        jsonb not null default '[]'::jsonb,
  updated_by            uuid references profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ── updated_at triggers ──────────────────────────────────────
create or replace function eos_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'eos_teams','eos_seats','eos_rocks','eos_measurables','eos_scores',
    'eos_issues','eos_todos','eos_meetings','eos_vto'
  ] loop
    execute format(
      'create trigger %I_touch before update on %I
         for each row execute function eos_touch_updated_at()', t, t);
  end loop;
end $$;
