-- Google access is explicitly assigned by the office. Directory addresses
-- are not automatically invitations and may be shared by multiple records.
alter table public.sub_portal_access
  add column if not exists google_email text,
  add column if not exists google_subject text;

alter table public.sub_portal_access
  add constraint sub_portal_google_email_normalized check (
    google_email is null or (
      google_email = lower(btrim(google_email)) and
      length(google_email) between 3 and 254 and
      google_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
  ),
  add constraint sub_portal_google_subject_requires_email check (
    google_subject is null or (google_email is not null and length(btrim(google_subject)) > 0)
  );

create unique index sub_portal_google_email_unique
  on public.sub_portal_access (google_email) where google_email is not null;
create unique index sub_portal_google_subject_unique
  on public.sub_portal_access (google_subject) where google_subject is not null;

comment on column public.sub_portal_access.google_email is
  'Google email explicitly invited by office staff; never inferred from the subcontractor directory.';
comment on column public.sub_portal_access.google_subject is
  'Verified Google subject bound on first login. Cleared only by office email reassignment.';

-- Uses existing RLS. No anonymous or authenticated write privileges added.
