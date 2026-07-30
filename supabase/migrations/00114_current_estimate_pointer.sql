-- One answer to "which estimate is the real one" (see 00113 for the bug class
-- this ends). Applied to production 2026-07-30 as
-- current_estimate_pointer_and_option_flag + get_project_financials_shared_resolver.
--
--   1. projects.contract_estimate_id — stamped when a contract goes out or is
--      approved-as-contract. For a contracted job this is THE estimate, and a
--      draft revision created later can no longer hijack the contract page.
--   2. estimates.is_option — marks parallel alternates (Callanan A/B/C) that
--      must NOT be auto-superseded when a sibling revision is approved.
--   3. current_estimate_id(project) — the single resolver every reader uses:
--      contract pointer if set, else highest non-superseded version, else
--      highest version. Matches resolveContractTotal's historical pick, so
--      behavior is unchanged until pointers/superseded statuses exist.

alter table public.projects
  add column if not exists contract_estimate_id uuid references public.estimates(id);

comment on column public.projects.contract_estimate_id is
  'The estimate the contract was built from. Stamped by send-contract, approve-as-contract, and contract lock. Deleting that estimate is deliberately blocked by the FK.';

alter table public.estimates
  add column if not exists is_option boolean not null default false;

comment on column public.estimates.is_option is
  'True = parallel alternate (option A/B/C), never auto-superseded by a sibling revision. False = revision; approving/sending it supersedes lower non-option versions.';

create or replace function public.current_estimate_id(p_project_id uuid)
returns uuid
language sql
stable
as $$
  select coalesce(
    (select p.contract_estimate_id from public.projects p where p.id = p_project_id),
    (select e.id from public.estimates e
       where e.project_id = p_project_id
         and e.status not in ('superseded', 'rejected')
       order by e.version desc, e.created_at desc
       limit 1),
    (select e.id from public.estimates e
       where e.project_id = p_project_id
       order by e.version desc, e.created_at desc
       limit 1)
  )
$$;

-- Both budget views and get_project_financials were rewired to
-- current_estimate_id() in the same production migration; their latest full
-- definitions live in 00115 (views) and the function body below is unchanged
-- except the picker line.
--
-- get_project_financials: the only change is
--   v_estimate_id := public.current_estimate_id(p_project_id);
-- replacing its own copy of the highest-non-superseded-version query.
