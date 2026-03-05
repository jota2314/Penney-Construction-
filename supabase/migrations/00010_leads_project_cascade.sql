-- Fix: deleting a project was blocked by leads_project_id_fkey (no ON DELETE action).
-- Set to CASCADE so deleting a project also removes the lead→project link.
alter table public.leads
  drop constraint leads_project_id_fkey,
  add constraint leads_project_id_fkey
    foreign key (project_id) references public.projects(id) on delete set null;
