-- Add 'approved' status to quote_requests for the quote → bill flow
-- Approved quotes are committed expenses (ready for QuickBooks sync)
ALTER TABLE quote_requests DROP CONSTRAINT IF EXISTS quote_requests_status_check;
ALTER TABLE quote_requests ADD CONSTRAINT quote_requests_status_check
  CHECK (status IN ('just_sent', 'awaiting_reply', 'received', 'in_progress', 'accepted', 'declined', 'approved'));
