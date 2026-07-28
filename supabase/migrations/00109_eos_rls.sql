-- Applied live 2026-07-28 under the label `00099_eos_rls`.
-- Filed here as 00109 because 00099 was already taken (00099_project_meetings).
--
-- EOS is leadership-only. Unlike most of this app's policies
-- (USING (true) = any signed-in user), these actually gate:
-- the Rocks and Scorecard carry revenue, margin and cash numbers
-- that field crew should not see.
--
-- SECURITY DEFINER so the eos_team_members policy can consult
-- eos_team_members without recursing on itself.
create or replace function public.eos_is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from eos_team_members m where m.profile_id = auth.uid()
  );
$$;

revoke all on function public.eos_is_member() from public;
grant execute on function public.eos_is_member() to authenticated;

do $$
declare t text;
begin
  foreach t in array array[
    'eos_teams','eos_team_members','eos_seats','eos_rocks',
    'eos_rock_milestones','eos_measurables','eos_scores','eos_issues',
    'eos_todos','eos_meetings','eos_meeting_attendees','eos_headlines',
    'eos_vto'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy eos_member_all on %I for all to authenticated
         using (public.eos_is_member())
         with check (public.eos_is_member())', t);
  end loop;
end $$;
