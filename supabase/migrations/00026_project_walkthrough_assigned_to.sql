-- Track who is assigned to do the walkthrough
alter table projects
  add column walkthrough_assigned_to uuid references public.profiles(id) on delete set null;
