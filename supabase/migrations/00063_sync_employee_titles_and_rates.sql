-- ══════════════════════════════════════════════════
-- Migration 00063: Sync employee titles, rates, phone, and Dylan's email
-- ══════════════════════════════════════════════════
-- Phase H of 00062 used `WHERE NOT EXISTS` guards, so existing employee
-- rows kept their old titles/rates. These updates align them with the
-- intended seed values. Idempotent — safe to re-run.
--
-- Already applied manually against prod via MCP — this file exists so the
-- local migration history matches.

UPDATE public.employees
  SET title = 'Field Lead', hourly_rate = 62.00
  WHERE lower(email) = 'hclick@penneyconstructioninc.com';

UPDATE public.employees
  SET title = 'Lead Carpenter', hourly_rate = 55.00
  WHERE lower(email) = 'wdobrosielski@penneyconstructioninc.com';

UPDATE public.employees
  SET hourly_rate = 38.00, phone = '7819220556'
  WHERE lower(email) = 'sriley@penneyconstructioninc.com';

UPDATE public.employees
  SET title = 'Runner'
  WHERE lower(email) = 'mclick@penneyconstructioninc.com';

UPDATE public.employees
  SET title = 'Laborer', hourly_rate = 22.00
  WHERE lower(email) = 'apaulino@penneyconstructioninc.com';

UPDATE public.employees
  SET title = 'Laborer', hourly_rate = 25.00
  WHERE lower(email) = 'dwieselquist@me.com';
