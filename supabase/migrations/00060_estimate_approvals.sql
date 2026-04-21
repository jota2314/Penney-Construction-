-- Proposal approval workflow.
-- Jorge builds the estimate, submits it to Ryan for review, Ryan leaves
-- notes and approves or requests changes. Only approved estimates can be
-- sent to the client as a proposal — enforced in the send_email guard.

ALTER TABLE estimates
  ADD COLUMN approval_status text NOT NULL DEFAULT 'draft'
    CHECK (approval_status IN ('draft', 'pending_review', 'approved', 'changes_requested')),
  ADD COLUMN approval_notes text,
  ADD COLUMN submitted_for_review_at timestamptz,
  ADD COLUMN submitted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN reviewed_at timestamptz;

CREATE INDEX idx_estimates_approval_status ON estimates(approval_status);

-- Full audit trail — multiple submit → review rounds are common when Ryan
-- asks for changes and Jorge resubmits. Keep every round's notes.
CREATE TABLE estimate_approvals (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  estimate_id uuid NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email text,
  action text NOT NULL CHECK (action IN ('submitted', 'approved', 'changes_requested')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_estimate_approvals_estimate ON estimate_approvals(estimate_id, created_at DESC);

ALTER TABLE estimate_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "estimate_approvals_read"
  ON estimate_approvals FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "estimate_approvals_write"
  ON estimate_approvals FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);
