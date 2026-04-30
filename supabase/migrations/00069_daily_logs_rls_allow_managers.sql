-- Allow managers/owners/admins to insert and update daily_logs with any author_id.
-- This makes impersonation work (manager acts as a crew member) and also lets a
-- manager file a log on behalf of a worker. Field workers are still constrained
-- to their own author_id.

drop policy if exists "Authors can insert their own daily logs" on daily_logs;
drop policy if exists "Authors can update their own daily logs" on daily_logs;

create policy "Insert daily logs (own or as manager)"
  on daily_logs for insert to authenticated
  with check (
    author_id = auth.uid()
    or exists (
      select 1 from profiles
      where id = auth.uid()
        and role in ('owner', 'precon_manager', 'office_admin', 'project_manager')
    )
  );

create policy "Update daily logs (own or as manager)"
  on daily_logs for update to authenticated
  using (
    author_id = auth.uid()
    or exists (
      select 1 from profiles
      where id = auth.uid()
        and role in ('owner', 'precon_manager', 'office_admin', 'project_manager')
    )
  )
  with check (
    author_id = auth.uid()
    or exists (
      select 1 from profiles
      where id = auth.uid()
        and role in ('owner', 'precon_manager', 'office_admin', 'project_manager')
    )
  );
