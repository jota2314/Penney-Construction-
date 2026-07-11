-- New sign-ins with an email that matches nothing (no allowlist row, no
-- employee record, no pending invite) used to default to 'project_manager',
-- an office role. Default to 'field' instead — least privilege, crew app
-- only. Office roles must be granted explicitly.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $function$
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

  -- Unknown emails default to the LEAST privileged role (crew app only).
  -- Office roles must be granted explicitly via allowed_emails or an invite.
  insert into public.profiles (id, email, full_name, avatar_url, role)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url',
    coalesce(resolved_role, 'field')
  );

  -- If we matched an employee, link the profile to it now
  if resolved_role = 'field' then
    update public.employees
    set profile_id = new.id
    where lower(email) = normalized_email and profile_id is null;
  end if;

  return new;
end;
$function$;
