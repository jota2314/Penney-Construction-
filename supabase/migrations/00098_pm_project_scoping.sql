-- Project managers only see and update projects assigned to them
-- (or that they created). All other roles keep full visibility.

drop policy if exists "Authenticated users can view projects" on public.projects;
create policy "Scoped project visibility" on public.projects
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.role <> 'project_manager'
          or projects.assigned_pm = p.id
          or projects.created_by = p.id
        )
    )
  );

drop policy if exists "Authenticated users can update projects" on public.projects;
create policy "Scoped project updates" on public.projects
  for update to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.role <> 'project_manager'
          or projects.assigned_pm = p.id
          or projects.created_by = p.id
        )
    )
  );
