alter table public.job_review_evidence add column priority integer not null default 2 check (priority between 1 and 3);
alter table public.job_review_evidence add column supersedes_id uuid references public.job_review_evidence(id);
create unique index job_review_evidence_one_successor on public.job_review_evidence(supersedes_id) where supersedes_id is not null;
