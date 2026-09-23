-- Online surveys: build a questionnaire in the app, share a public link,
-- collect responses. First uses: post-project client satisfaction,
-- pre-construction intake questionnaires, subcontractor feedback.
--
-- Questions live as JSONB on the survey ({id, type, label, required,
-- options, help_text}) and answers as JSONB keyed by question id on the
-- response. The public form runs through /api/survey/[token] with the
-- service role, so anon never needs a grant on either table.

create table if not exists public.surveys (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  status text not null default 'draft' check (status in ('draft', 'active', 'closed')),
  public_token uuid not null unique default gen_random_uuid(),
  questions jsonb not null default '[]'::jsonb,
  thank_you_message text,
  collect_contact boolean not null default true,
  project_id uuid references public.projects(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  sent_count integer not null default 0,
  last_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists surveys_status_idx on public.surveys(status);
create index if not exists surveys_project_idx on public.surveys(project_id);

create table if not exists public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.surveys(id) on delete cascade,
  respondent_name text,
  respondent_email text,
  answers jsonb not null default '{}'::jsonb,
  submitted_at timestamptz not null default now(),
  user_agent text
);

create index if not exists survey_responses_survey_idx
  on public.survey_responses(survey_id, submitted_at desc);

alter table public.surveys enable row level security;
alter table public.survey_responses enable row level security;

-- Same single-company posture as the rest of the app: any signed-in user
-- can manage surveys and read results. Public submissions go through the
-- service role in /api/survey/[token], never through anon.
create policy "surveys_all_authenticated"
  on public.surveys for all
  to authenticated
  using (true)
  with check (true);

create policy "survey_responses_select_authenticated"
  on public.survey_responses for select
  to authenticated
  using (true);

create policy "survey_responses_delete_authenticated"
  on public.survey_responses for delete
  to authenticated
  using (true);

comment on table public.surveys is 'Online survey definitions. questions = JSON array of {id, type, label, required, options, help_text}.';
comment on table public.survey_responses is 'One row per submitted public survey form. answers = JSON object keyed by question id.';
