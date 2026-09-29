-- How-To Guides (Ryan's 9/27 request): one easy-to-find place in the app
-- where the office and the PMs open every training guide — the White
-- kitchen drawing email, chasing a payment, the PM daily checklist, the job
-- binder, auditing a job with AI.
--
-- One row per guide; the PDF lives in the private how-to-guides bucket.
-- Every signed-in user can read. Only the editors in
-- can_edit_how_to_guides() — Jorge (both logins) and Ryan — can add,
-- replace or remove a guide. Keep that list in step with
-- GUIDE_EDITOR_EMAILS in src/lib/auth/role-access.ts; the app check only
-- decides whether the buttons show, this function is the real gate.
--
-- There is no DELETE policy on the table: removing a guide archives it
-- (is_archived) so a guide pulled by mistake can be brought back.

create table if not exists public.how_to_guides (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) > 0),
  summary text,
  category text not null,
  author text,
  file_path text not null,
  file_name text,
  file_size bigint,
  sort_order integer not null default 0,
  is_archived boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.how_to_guides is
  'Training guides shown on /guides. file_path is a path in the how-to-guides storage bucket.';

create index if not exists how_to_guides_active_idx
  on public.how_to_guides (category, sort_order)
  where not is_archived;

create or replace function public.can_edit_how_to_guides()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and lower(p.email) in (
         'jbetancur@penneyconstructioninc.com',
         'jorgebetancurfx@gmail.com',
         'rpenney@penneyconstructioninc.com'
       )
  );
$function$;

revoke all on function public.can_edit_how_to_guides() from public, anon;
grant execute on function public.can_edit_how_to_guides() to authenticated, service_role;

alter table public.how_to_guides enable row level security;

drop policy if exists "Signed-in staff can read guides" on public.how_to_guides;
drop policy if exists "Guide editors can add guides" on public.how_to_guides;
drop policy if exists "Guide editors can change guides" on public.how_to_guides;

create policy "Signed-in staff can read guides"
  on public.how_to_guides for select to authenticated
  using (true);

create policy "Guide editors can add guides"
  on public.how_to_guides for insert to authenticated
  with check (public.can_edit_how_to_guides());

create policy "Guide editors can change guides"
  on public.how_to_guides for update to authenticated
  using (public.can_edit_how_to_guides())
  with check (public.can_edit_how_to_guides());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'how-to-guides',
  'how-to-guides',
  false,
  52428800,
  array['application/pdf']
)
on conflict (id) do nothing;

drop policy if exists "Staff can view how-to guides" on storage.objects;
drop policy if exists "Guide editors can upload how-to guides" on storage.objects;
drop policy if exists "Guide editors can update how-to guides" on storage.objects;
drop policy if exists "Guide editors can delete how-to guides" on storage.objects;

create policy "Staff can view how-to guides"
  on storage.objects for select to authenticated
  using (bucket_id = 'how-to-guides');

create policy "Guide editors can upload how-to guides"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'how-to-guides' and public.can_edit_how_to_guides());

create policy "Guide editors can update how-to guides"
  on storage.objects for update to authenticated
  using (bucket_id = 'how-to-guides' and public.can_edit_how_to_guides())
  with check (bucket_id = 'how-to-guides' and public.can_edit_how_to_guides());

-- Only used to clean up an upload whose save failed; replaced PDFs are kept.
create policy "Guide editors can delete how-to guides"
  on storage.objects for delete to authenticated
  using (bucket_id = 'how-to-guides' and public.can_edit_how_to_guides());
