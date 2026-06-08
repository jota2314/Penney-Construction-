-- 00083_security_rls_lockdown.sql
-- Closes data-exposure holes flagged by the Supabase security advisor.
--
-- 1) mcp_oauth_* tables were reachable through the public PostgREST API with
--    RLS disabled. mcp_oauth_refresh_tokens even exposed a `token` column to
--    anyone holding the anon key. These tables are only ever touched by the
--    MCP OAuth server (service role / direct connection, which bypasses RLS),
--    never by the browser. Enabling RLS with no policies blocks anon +
--    authenticated while leaving the service role unaffected.
ALTER TABLE public.mcp_oauth_clients        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_oauth_auth_codes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_oauth_refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_oauth_pending_authz  ENABLE ROW LEVEL SECURITY;

-- 2) email_drafts was readable via the API with RLS disabled. In the app it is
--    read/written by signed-in users through the server client (authenticated
--    role) and by the auto-triage job (service role, bypasses RLS). Allow
--    authenticated, block anon — matching the app's existing posture.
ALTER TABLE public.email_drafts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "email_drafts authenticated full access" ON public.email_drafts;
CREATE POLICY "email_drafts authenticated full access" ON public.email_drafts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 3) Reporting/dashboard views were defined SECURITY DEFINER, which runs with
--    the view owner's privileges and bypasses the querying user's RLS. Flip
--    them to security_invoker so they respect it. All underlying tables grant
--    SELECT to authenticated, so dashboards keep working; anonymous access is
--    closed. (No redefinition needed — this only changes the property.)
ALTER VIEW public.v_weekly_cashflow        SET (security_invoker = on);
ALTER VIEW public.budget_vs_actual         SET (security_invoker = on);
ALTER VIEW public.agent_crew_status        SET (security_invoker = on);
ALTER VIEW public.v_ceo_dashboard_ytd      SET (security_invoker = on);
ALTER VIEW public.job_ledger_summary       SET (security_invoker = on);
ALTER VIEW public.overhead_calc            SET (security_invoker = on);
ALTER VIEW public.v_project_budget_actual  SET (security_invoker = on);
ALTER VIEW public.v_spending_by_category   SET (security_invoker = on);
ALTER VIEW public.v_project_spending       SET (security_invoker = on);
