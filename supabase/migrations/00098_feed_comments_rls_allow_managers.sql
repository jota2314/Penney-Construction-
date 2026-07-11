-- Allow managers/owners/admins to insert and delete feed_comments with any
-- author_id, mirroring 00069 for daily_logs. This makes impersonation work
-- (comments posted while "Viewing as" a teammate were rejected by RLS because
-- author_id was the impersonated profile while auth.uid() stayed the real
-- user). Non-manager roles are still constrained to their own author_id.

drop policy if exists "Users can create their own feed comments" on feed_comments;
drop policy if exists "Users can delete their own feed comments" on feed_comments;

create policy "Insert feed comments (own or as manager)"
  on feed_comments for insert to authenticated
  with check (
    author_id = auth.uid()
    or exists (
      select 1 from profiles
      where id = auth.uid()
        and role in ('owner', 'precon_manager', 'office_admin', 'project_manager')
    )
  );

create policy "Delete feed comments (own or as manager)"
  on feed_comments for delete to authenticated
  using (
    author_id = auth.uid()
    or exists (
      select 1 from profiles
      where id = auth.uid()
        and role in ('owner', 'precon_manager', 'office_admin', 'project_manager')
    )
  );
