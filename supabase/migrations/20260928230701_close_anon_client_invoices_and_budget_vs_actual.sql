-- Close two anon-key data exposures (found 2026-09-28).
--
-- 1. client_invoices_public_read_by_token (from 00089) let the anon role
--    SELECT every client invoice that has an approval_token (all of them),
--    tokens included. 00090 dropped it but was never applied live. No page
--    reads client_invoices as anon: /approve, /portal and /contract all go
--    through service-role API routes.
drop policy if exists client_invoices_public_read_by_token on public.client_invoices;
revoke all on public.client_invoices from anon;

-- 2. budget_vs_actual lost security_invoker in a later recreate, so it ran
--    as its owner and bypassed RLS on estimate_line_items / estimates /
--    invoices. Keep the current live definition; only flip the option.
--    Authenticated readers are unaffected (their policies on the base
--    tables are USING (true)).
alter view public.budget_vs_actual set (security_invoker = on);
revoke all on public.budget_vs_actual from anon;
