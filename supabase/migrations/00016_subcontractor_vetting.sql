-- Add vetting status to subcontractors
ALTER TABLE subcontractors
ADD COLUMN vetting_status text NOT NULL DEFAULT 'prospect'
CHECK (vetting_status IN ('prospect', 'references_received', 'approved'));
