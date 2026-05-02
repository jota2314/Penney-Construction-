-- Generic AI-proposed decisions queue.
-- The AI writes a row here instead of mutating the target table directly.
-- The user reviews on /command-center as a swipe card, approves or rejects,
-- and approval runs the handler in lib/actions/decisions.ts which performs
-- the actual DB write (insert phase, set line_item_id on quote, etc.).

CREATE TABLE IF NOT EXISTS decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which role owns this decision. Today the precon_manager sees all of them;
  -- later we filter by role.
  role text NOT NULL,

  -- Discriminator for the approve handler.
  -- 'add_schedule_phase' | 'link_quote_to_line' | 'link_invoice_to_line'
  decision_type text NOT NULL,

  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,

  -- For the swipe card UI.
  title text NOT NULL,
  context text,
  payload jsonb NOT NULL,
  options jsonb,

  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),

  proposed_by uuid REFERENCES auth.users(id),
  decided_by uuid REFERENCES auth.users(id),
  decided_at timestamptz,
  decision_note text,

  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_decisions_pending ON decisions (role, created_at DESC) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_decisions_project ON decisions (project_id);

ALTER TABLE decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read decisions" ON decisions;
CREATE POLICY "Authenticated users can read decisions"
  ON decisions FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert decisions" ON decisions;
CREATE POLICY "Authenticated users can insert decisions"
  ON decisions FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can update decisions" ON decisions;
CREATE POLICY "Authenticated users can update decisions"
  ON decisions FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
