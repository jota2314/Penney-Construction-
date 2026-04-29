-- Wire bids to the estimate-line-item spine
-- Today: bids and quotes float free of line items even though the schema half-supports it.
-- This migration: add the FK to subcontractor_bids, add award columns to line items,
-- backfill from existing bid_packages, and create the inbound-email matching index.

-- 1. subcontractor_bids gets an estimate_line_item_id (per-bid, not per-package)
ALTER TABLE public.subcontractor_bids
  ADD COLUMN IF NOT EXISTS estimate_line_item_id uuid REFERENCES public.estimate_line_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sub_bids_line_item ON public.subcontractor_bids(estimate_line_item_id);
CREATE INDEX IF NOT EXISTS idx_sub_bids_gmail ON public.subcontractor_bids(gmail_message_id) WHERE gmail_message_id IS NOT NULL;

-- 2. estimate_line_items carries the awarded outcome (the spine reads, not the bid table)
ALTER TABLE public.estimate_line_items
  ADD COLUMN IF NOT EXISTS awarded_bid_id uuid REFERENCES public.subcontractor_bids(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS awarded_subcontractor_id uuid REFERENCES public.subcontractors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS awarded_cost numeric,
  ADD COLUMN IF NOT EXISTS awarded_at timestamptz;

-- 3. Backfill: copy bid_packages.estimate_line_item_id down to its child subcontractor_bids
UPDATE public.subcontractor_bids sb
SET estimate_line_item_id = bp.estimate_line_item_id
FROM public.bid_packages bp
WHERE sb.bid_package_id = bp.id
  AND bp.estimate_line_item_id IS NOT NULL
  AND sb.estimate_line_item_id IS NULL;

-- 4. Backfill: for already-awarded bids, mirror the result onto the line item
UPDATE public.estimate_line_items eli
SET
  awarded_bid_id = sb.id,
  awarded_subcontractor_id = sb.subcontractor_id,
  awarded_cost = sb.amount,
  awarded_at = COALESCE(sb.submitted_at, sb.sent_at, NOW())
FROM public.subcontractor_bids sb
WHERE sb.estimate_line_item_id = eli.id
  AND sb.is_selected = true
  AND sb.status = 'accepted'
  AND eli.awarded_bid_id IS NULL;
