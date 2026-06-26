-- QuickBooks → app reconciliation: import QB Invoices (client AR) into
-- client_invoices and match already-made payments to them, routed to projects.
--
-- Context: Penney is consolidating onto QuickBooks (retiring the Drive ledgers).
-- A year of invoices + payments is being backfilled into QB. We pull QB Invoices
-- into client_invoices, route each to its project via the QB Customer:Job, and
-- reconcile payments against them. These columns make that import idempotent
-- (dedup on quickbooks_id) and give the matcher a stable anchor (the QB
-- customer/job id) instead of fragile name matching.

-- Dedup + provenance on client_invoices, plus the QB transaction date (QB
-- Invoices carry TxnDate; client_invoices only had due_date/created_at, which
-- the payment matcher needs for date-proximity scoring).
ALTER TABLE public.client_invoices ADD COLUMN IF NOT EXISTS quickbooks_id text UNIQUE;
ALTER TABLE public.client_invoices ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual';
ALTER TABLE public.client_invoices ADD COLUMN IF NOT EXISTS invoice_date date;

-- Stable QB anchors so re-syncs match exactly (no name-guessing after the first
-- pass). A QB "Customer:Job" maps to one project; the parent customer maps to a
-- customers row.
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS quickbooks_customer_id text;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS quickbooks_id text;

CREATE INDEX IF NOT EXISTS projects_quickbooks_customer_id_idx
  ON public.projects (quickbooks_customer_id);
CREATE INDEX IF NOT EXISTS customers_quickbooks_id_idx
  ON public.customers (quickbooks_id);
