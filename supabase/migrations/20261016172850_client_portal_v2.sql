-- Client portal v2: staged selection sheets, portal documents, per-row
-- visibility on client_selections.
--
-- Everything new is STAGED by default: a row with published_at = NULL is
-- visible only in the staff preview (/projects/[id]/portal-preview). It
-- reaches the client's /portal/[token] page only after someone presses
-- Publish in the project's Portal tab. Same security model as 00083: the
-- public portal never touches the anon key; /api/portal* reads with the
-- service role after validating the token, and RLS here is
-- authenticated-only so the admin app works normally.

-- ---------------------------------------------------------------------------
-- client_selections: per-row client visibility. Existing rows stay visible
-- (default true) so live portals don't change; a row can be hidden when its
-- wording is internal or it's superseded by a published selection sheet.
-- ---------------------------------------------------------------------------
ALTER TABLE client_selections
  ADD COLUMN IF NOT EXISTS client_visible boolean NOT NULL DEFAULT true;

-- ---------------------------------------------------------------------------
-- client_selection_sheets: one row per revision of a fixture/finish
-- selection sheet (e.g. "Fixture + Finish Selections R3"). Carries the PDF
-- plus the structured items below, so the portal can show product cards and
-- the client can open the same PDF.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_selection_sheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  title text NOT NULL,
  revision text,
  sheet_date date,
  -- One or two client-facing sentences shown above the items.
  intro text,

  -- The sheet PDF in storage (private bucket; the portal signs it).
  pdf_bucket text,
  pdf_path text,
  pdf_filename text,

  -- What the team chooses to show the client.
  show_prices boolean NOT NULL DEFAULT false,
  show_allowances boolean NOT NULL DEFAULT false,

  -- Allowance check rows: [{ name, allowance, selected, status }]
  -- selected = null means pending. Client-facing numbers only.
  allowances jsonb NOT NULL DEFAULT '[]'::jsonb,
  allowance_note text,

  -- Client-facing note blocks: [{ title, body }]
  notes jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- NULL = staged (staff preview only). Set = live on the client portal.
  published_at timestamptz,
  published_by uuid REFERENCES auth.users(id),

  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_selection_sheets_project
  ON client_selection_sheets (project_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- client_selection_items: the products on a sheet.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_selection_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id uuid NOT NULL REFERENCES client_selection_sheets(id) ON DELETE CASCADE,

  section text,
  sort_order integer NOT NULL DEFAULT 0,

  -- selected = client's pick · proposed = Penney's proposal · pending = still
  -- open (or price pending) · reused = existing item reused · ordered /
  -- installed for later in the job.
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('selected', 'proposed', 'pending', 'reused', 'ordered', 'installed')),
  -- Optional wording for the status chip, e.g. "Selected Oct 16", "Price pending".
  status_label text,

  name text NOT NULL,
  brand_model text,
  details text,

  image_bucket text,
  image_path text,
  product_url text,
  link_label text,

  quantity text,
  unit_price text,
  ext_price numeric(12, 2),
  price_note text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_selection_items_sheet
  ON client_selection_items (sheet_id, sort_order);

-- ---------------------------------------------------------------------------
-- client_portal_documents: files the team chooses to put on the portal
-- (design presentation, drawings, permits…). Contract, change orders,
-- invoices and selection-sheet PDFs come from their own tables.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_portal_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  kind text NOT NULL DEFAULT 'other'
    CHECK (kind IN ('design', 'selections', 'drawing', 'permit', 'contract', 'change_order', 'invoice', 'other')),
  title text NOT NULL,
  subtitle text,

  storage_bucket text NOT NULL,
  storage_path text NOT NULL,
  filename text,
  project_file_id uuid REFERENCES project_files(id) ON DELETE SET NULL,

  sort_order integer NOT NULL DEFAULT 0,

  published_at timestamptz,
  published_by uuid REFERENCES auth.users(id),

  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portal_documents_project
  ON client_portal_documents (project_id, sort_order);

-- ---------------------------------------------------------------------------
-- RLS: authenticated-only, same shape as client_portal_access /
-- client_selections. No anon policy: the public portal reads through the
-- service role after validating its token.
-- ---------------------------------------------------------------------------
ALTER TABLE client_selection_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_selection_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_portal_documents ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['client_selection_sheets', 'client_selection_items', 'client_portal_documents'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Authenticated read" ON %I', t);
    EXECUTE format('CREATE POLICY "Authenticated read" ON %I FOR SELECT TO authenticated USING (true)', t);
    EXECUTE format('DROP POLICY IF EXISTS "Authenticated insert" ON %I', t);
    EXECUTE format('CREATE POLICY "Authenticated insert" ON %I FOR INSERT TO authenticated WITH CHECK (true)', t);
    EXECUTE format('DROP POLICY IF EXISTS "Authenticated update" ON %I', t);
    EXECUTE format('CREATE POLICY "Authenticated update" ON %I FOR UPDATE TO authenticated USING (true) WITH CHECK (true)', t);
    EXECUTE format('DROP POLICY IF EXISTS "Authenticated delete" ON %I', t);
    EXECUTE format('CREATE POLICY "Authenticated delete" ON %I FOR DELETE TO authenticated USING (true)', t);
  END LOOP;
END $$;
