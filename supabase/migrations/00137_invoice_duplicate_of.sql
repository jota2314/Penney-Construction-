-- When the office files a bill that looks like one already in the books,
-- the commit route flags it with a text reason only. The reviewer then has
-- to go hunting for the other row to decide. Keep the pointer so the review
-- queue can show both bills side by side (receipt, invoice #, date, job).

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS duplicate_of_id uuid REFERENCES invoices(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_duplicate_of_id
  ON invoices (duplicate_of_id)
  WHERE duplicate_of_id IS NOT NULL;
