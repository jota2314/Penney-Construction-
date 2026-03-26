-- New timestamp columns for workflow V2 stages
ALTER TABLE workflow_instances
  ADD COLUMN IF NOT EXISTS schedule_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS owner_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS permit_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS permit_pulled_at timestamptz,
  ADD COLUMN IF NOT EXISTS pm_handoff_at timestamptz,
  ADD COLUMN IF NOT EXISTS construction_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS rough_inspection_at timestamptz,
  ADD COLUMN IF NOT EXISTS final_inspection_at timestamptz,
  ADD COLUMN IF NOT EXISTS audit_at timestamptz,
  ADD COLUMN IF NOT EXISTS estimate_sheet_linked_at timestamptz,
  ADD COLUMN IF NOT EXISTS client_approval_token text;

-- Migrate old stages
UPDATE workflow_instances SET current_stage = 'permit_deposit' WHERE current_stage = 'admin_deposit';
UPDATE workflow_instances SET current_stage = 'pm_handoff' WHERE current_stage = 'project_management';
