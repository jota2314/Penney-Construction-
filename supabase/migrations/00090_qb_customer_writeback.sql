-- QuickBooks write-back, automation #1: link app customers to QuickBooks customers.
-- Mirrors the quickbooks_id convention added for vendors/invoices/payments in
-- 00053_quickbooks_integration.sql, and seeds the settings keys the write path needs.

-- Link column + sync timestamp on customers.
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS quickbooks_id text;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS qb_synced_at timestamptz;

-- One app customer ↔ one QB customer. Partial index so multiple un-synced
-- (NULL) customers are still allowed.
CREATE UNIQUE INDEX IF NOT EXISTS customers_quickbooks_id_key
  ON public.customers (quickbooks_id)
  WHERE quickbooks_id IS NOT NULL;

-- Settings the QB write path reads:
--  - quickbooks_environment: "sandbox" | "production" (default production)
--  - quickbooks_service_key: shared secret for headless triggers (MCP/cron).
--    Leave blank until a key is generated; a blank value rejects all service-key calls.
--  - quickbooks_sandbox_*: optional Intuit Development (sandbox) OAuth creds;
--    fall back to the production keys when blank.
INSERT INTO public.app_settings (key, value) VALUES
  ('quickbooks_environment', 'production'),
  ('quickbooks_service_key', ''),
  ('quickbooks_sandbox_client_id', ''),
  ('quickbooks_sandbox_client_secret', ''),
  ('quickbooks_sandbox_redirect_uri', '')
ON CONFLICT (key) DO NOTHING;
