-- Per-project contract terms rendered after the standard Terms & Conditions
-- in /api/generate-contract. Condo jobs (Weidlein 7 Hamilton, 9/10/26) ask for
-- clauses the standard contract does not carry: permit close-out confirmation,
-- COI naming the owner + condo association as additional insureds, protection
-- and indemnification, condominium working-hours/notice rules. Stored as a JSON
-- array of {title, body} so the PDF numbers them as continuation terms.
alter table public.projects
  add column if not exists contract_additional_terms jsonb not null default '[]'::jsonb;

comment on column public.projects.contract_additional_terms is
  'Array of {title, body} clauses appended to the standard Terms & Conditions on the contract PDF. Empty array = standard contract only.';
