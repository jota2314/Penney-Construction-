-- Make the auto-profile trigger consult allowed_emails / employees so field
-- workers don't get stamped as project_manager on first sign-in.
create or replace function public.handle_new_user()
returns trigger as $$
declare
  resolved_role text;
  normalized_email text := lower(trim(new.email));
begin
  -- Priority 1: explicit allowlist entry
  select role into resolved_role
  from public.allowed_emails
  where lower(email) = normalized_email
  limit 1;

  -- Priority 2: existing employee record (pre-created field worker, no allowlist row)
  if resolved_role is null then
    if exists (
      select 1 from public.employees where lower(email) = normalized_email
    ) then
      resolved_role := 'field';
    end if;
  end if;

  -- Priority 3: pending office invite
  if resolved_role is null then
    select role into resolved_role
    from public.team_invites
    where lower(email) = normalized_email
    limit 1;
  end if;

  -- Fallback to the column default if nothing matched
  insert into public.profiles (id, email, full_name, avatar_url, role)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url',
    coalesce(resolved_role, 'project_manager')
  );

  -- If we matched an employee, link the profile to it now
  if resolved_role = 'field' then
    update public.employees
    set profile_id = new.id
    where lower(email) = normalized_email and profile_id is null;
  end if;

  return new;
end;
$$ language plpgsql security definer;
