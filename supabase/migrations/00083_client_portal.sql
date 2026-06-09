-- Client Portal
-- A per-project, magic-link client portal. The homeowner opens a tokenized URL
-- (/portal/[token]) and sees a read-only view of their project: schedule
-- milestones, financials (contract + draws, invoices/payment requests, change
-- orders), and a Selections section where they pick finishes from options Jorge
-- loads. All client communication stays in email — no in-app messaging.
--
-- Security model mirrors /approve/[token]: the public portal pages NEVER touch
-- Supabase with the anon key. All reads/writes go through /api/portal*, which
-- uses the service-role client and validates the token server-side. RLS is
-- enabled with authenticated-only policies so the admin app works normally;
-- the service role bypasses RLS for the public surface.

-- ---------------------------------------------------------------------------
-- client_portal_access: one tokenized portal per project
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_portal_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- The magic-link secret. Sent to the client's email; never guessable.
  token uuid NOT NULL DEFAULT gen_random_uuid(),

  -- Who this portal belongs to (for display + the email send).
  client_name text,
  client_email text,

  -- Flip to false to instantly revoke access without deleting the row.
  enabled boolean NOT NULL DEFAULT true,

  -- View tracking, same pattern as change_orders.
  last_viewed_at timestamptz,
  view_count integer NOT NULL DEFAULT 0,
  link_sent_at timestamptz,

  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One portal per project; token must be unique for lookups.
CREATE UNIQUE INDEX IF NOT EXISTS idx_portal_access_project ON client_portal_access (project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_portal_access_token ON client_portal_access (token);

ALTER TABLE client_portal_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read portal access" ON client_portal_access;
CREATE POLICY "Authenticated read portal access"
  ON client_portal_access FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated insert portal access" ON client_portal_access;
CREATE POLICY "Authenticated insert portal access"
  ON client_portal_access FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated update portal access" ON client_portal_access;
CREATE POLICY "Authenticated update portal access"
  ON client_portal_access FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated delete portal access" ON client_portal_access;
CREATE POLICY "Authenticated delete portal access"
  ON client_portal_access FOR DELETE TO authenticated USING (true);

-- ---------------------------------------------------------------------------
-- client_selections: finish/material selections the client makes
-- ---------------------------------------------------------------------------
-- One row per selectable item (e.g. "Flooring", "Kitchen Plumbing Fixtures",
-- "Backsplash Tile"). Jorge loads `options`; the client picks one in the portal
-- and the row flips to 'selected'. Doubles as Jorge's "waiting on client" list.
CREATE TABLE IF NOT EXISTS client_selections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- Display name of the selection, e.g. "Backsplash Tile".
  category text NOT NULL,
  -- Optional instructions/notes shown to the client.
  description text,

  -- 'pending' = client still needs to choose. 'selected' = locked in.
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'selected')),

  -- Allowance budgeted for this selection (optional). Lets the client see the
  -- cost impact of upgrades. Client-facing, so this is the allowance only —
  -- never internal cost. Optionally tied to an estimate allowance line.
  allowance_amount numeric,
  estimate_line_item_id uuid REFERENCES estimate_line_items(id) ON DELETE SET NULL,

  -- Choices Jorge loads. Array of:
  --   { id, label, description, image_url, price_delta }
  -- price_delta is the +/- vs. the allowance, shown to the client.
  options jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- What the client picked.
  selected_option_id text,
  selected_value text,
  selected_at timestamptz,
  selected_by text,         -- typically the client name

  sort_order integer NOT NULL DEFAULT 0,

  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_selections_project ON client_selections (project_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_client_selections_pending ON client_selections (project_id) WHERE status = 'pending';

ALTER TABLE client_selections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read selections" ON client_selections;
CREATE POLICY "Authenticated read selections"
  ON client_selections FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated insert selections" ON client_selections;
CREATE POLICY "Authenticated insert selections"
  ON client_selections FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated update selections" ON client_selections;
CREATE POLICY "Authenticated update selections"
  ON client_selections FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated delete selections" ON client_selections;
CREATE POLICY "Authenticated delete selections"
  ON client_selections FOR DELETE TO authenticated USING (true);
