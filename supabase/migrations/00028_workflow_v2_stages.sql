-- Workflow V2: 13-stage pipeline
-- Lead Intake → Schedule Confirmation → Walkthrough → Estimating → Owner Review
-- → Client Review → Permit & Deposit → Job Package → PM Handoff
-- → Construction → Rough Inspection → Final Inspection → Audit

-- New stages
ALTER TYPE workflow_stage ADD VALUE IF NOT EXISTS 'schedule_confirmation';
ALTER TYPE workflow_stage ADD VALUE IF NOT EXISTS 'owner_review';
ALTER TYPE workflow_stage ADD VALUE IF NOT EXISTS 'permit_deposit';
ALTER TYPE workflow_stage ADD VALUE IF NOT EXISTS 'pm_handoff';
ALTER TYPE workflow_stage ADD VALUE IF NOT EXISTS 'construction_started';
ALTER TYPE workflow_stage ADD VALUE IF NOT EXISTS 'rough_inspection';
ALTER TYPE workflow_stage ADD VALUE IF NOT EXISTS 'final_inspection';
ALTER TYPE workflow_stage ADD VALUE IF NOT EXISTS 'audit';

-- New action types
ALTER TYPE workflow_action_type ADD VALUE IF NOT EXISTS 'schedule_confirmed';
ALTER TYPE workflow_action_type ADD VALUE IF NOT EXISTS 'schedule_rescheduled';
ALTER TYPE workflow_action_type ADD VALUE IF NOT EXISTS 'owner_approved';
ALTER TYPE workflow_action_type ADD VALUE IF NOT EXISTS 'permit_requested';
ALTER TYPE workflow_action_type ADD VALUE IF NOT EXISTS 'permit_pulled';
ALTER TYPE workflow_action_type ADD VALUE IF NOT EXISTS 'inspection_passed';
