-- Applied live 2026-07-28 under the label `00100_eos_function_hardening`.
-- Filed here as 00110 because 00100 was already taken
-- (00100_backfill_confirm_live_schedule).
--
-- Clears the two Supabase security-advisor warnings that
-- 00108/00109 introduced.

-- Advisor: eos_touch_updated_at had a role-mutable search_path.
create or replace function eos_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- Advisor: eos_is_member() was reachable as a SECURITY DEFINER function by
-- the `anon` role via /rest/v1/rpc/. Supabase's default grants hand EXECUTE
-- to anon, and REVOKE ... FROM PUBLIC does not undo an explicit role grant.
-- `authenticated` must keep EXECUTE — RLS policy expressions are evaluated
-- as the querying role, so the policies call this themselves.
revoke execute on function public.eos_is_member() from anon;
