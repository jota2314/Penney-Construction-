-- QuickBooks integration: add source tracking columns for dedup on sync

-- Track QB IDs on invoices so re-sync doesn't create duplicates
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS quickbooks_id text UNIQUE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual';

-- Track QB IDs on payments received
ALTER TABLE payments_received ADD COLUMN IF NOT EXISTS quickbooks_id text UNIQUE;
ALTER TABLE payments_received ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual';

-- Track QB IDs on subcontractors/vendors
ALTER TABLE subcontractors ADD COLUMN IF NOT EXISTS quickbooks_id text UNIQUE;

-- Store QB connection info (realm_id, tokens) in app_settings
-- Tokens go here instead of cookies so server-side sync works
INSERT INTO app_settings (key, value) VALUES ('quickbooks_realm_id', '') ON CONFLICT (key) DO NOTHING;
INSERT INTO app_settings (key, value) VALUES ('quickbooks_access_token', '') ON CONFLICT (key) DO NOTHING;
INSERT INTO app_settings (key, value) VALUES ('quickbooks_refresh_token', '') ON CONFLICT (key) DO NOTHING;
INSERT INTO app_settings (key, value) VALUES ('quickbooks_token_expires_at', '') ON CONFLICT (key) DO NOTHING;
INSERT INTO app_settings (key, value) VALUES ('quickbooks_last_sync', '') ON CONFLICT (key) DO NOTHING;
