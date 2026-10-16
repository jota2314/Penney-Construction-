-- Selections log: one row per product per job, the single record every
-- selections surface reads (team table, sheet revisions, portal, allowance
-- check) and every writer updates the same way (app, Penney MCP from any
-- Claude session, later the email suggestions).
--
-- Ladder: proposed -> selected (client picked) -> priced (firm vendor price)
-- -> ordered -> delivered -> installed. Side states: reused, owner_supplied,
-- removed. "Price pending" is a flag, not a step.
--
-- The rules that keep it honest live in the database so no writer can skip
-- them: a price needs its source, reference and date; "selected" and beyond
-- need the client source; "priced" needs a vendor quote or paid invoice;
-- "ordered" and beyond need an order reference. Every change is written to
-- selection_item_events (who, when, what, from which source).
--
-- Client-facing sheets stay frozen revisions: publishing copies log rows into
-- client_selection_items (log_item_id links them back). Nothing in this
-- migration is visible to a client.

CREATE TABLE IF NOT EXISTS selection_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  section text,
  sort_order integer NOT NULL DEFAULT 0,

  name text NOT NULL,
  brand_model text,
  details text,
  image_bucket text,
  image_path text,
  product_url text,
  link_label text,

  stage text NOT NULL DEFAULT 'proposed'
    CHECK (stage IN ('proposed', 'selected', 'priced', 'ordered', 'delivered', 'installed', 'reused', 'owner_supplied', 'removed')),
  -- Who picked it and where that is recorded ("Lauren email 10/16, inbox 1a1453…").
  selected_source text,

  quantity numeric(12, 3),
  unit text,
  quantity_note text,

  unit_price numeric(12, 2),
  ext_price numeric(12, 2),
  price_source text CHECK (price_source IN ('vendor_quote', 'paid_invoice', 'retail_check', 'list_price')),
  price_ref text,
  price_date date,
  price_note text,
  price_pending boolean NOT NULL DEFAULT false,
  taxable boolean NOT NULL DEFAULT true,

  -- Which contract allowance it draws from (markup comes from that line).
  allowance_line_id uuid REFERENCES estimate_line_items(id) ON DELETE SET NULL,
  allowance_group text,

  vendor text,
  order_ref text,
  ordered_at date,
  delivered_at date,
  installed_at date,

  created_by text,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT selection_price_needs_source CHECK (
    (unit_price IS NULL AND ext_price IS NULL)
    OR (price_source IS NOT NULL AND price_ref IS NOT NULL AND price_date IS NOT NULL)
  ),
  CONSTRAINT selection_selected_needs_client_source CHECK (
    stage NOT IN ('selected', 'priced', 'ordered', 'delivered', 'installed') OR selected_source IS NOT NULL
  ),
  CONSTRAINT selection_priced_needs_firm_price CHECK (
    stage <> 'priced' OR (ext_price IS NOT NULL AND price_source IN ('vendor_quote', 'paid_invoice'))
  ),
  CONSTRAINT selection_ordered_needs_order_ref CHECK (
    stage NOT IN ('ordered', 'delivered', 'installed') OR order_ref IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_selection_items_project ON selection_items (project_id, sort_order);

CREATE TABLE IF NOT EXISTS selection_item_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES selection_items(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL,
  actor_profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  action text NOT NULL,          -- created | updated | stage | client_tap | seeded
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,  -- { field: [old, new] }
  source text,                   -- email id, quote ref, "chat", "portal"
  note text
);

CREATE INDEX IF NOT EXISTS idx_selection_item_events_item ON selection_item_events (item_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_selection_item_events_project ON selection_item_events (project_id, at DESC);

-- Sheet snapshot rows point back at the log row they were copied from.
ALTER TABLE client_selection_items
  ADD COLUMN IF NOT EXISTS log_item_id uuid REFERENCES selection_items(id) ON DELETE SET NULL;

ALTER TABLE selection_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE selection_item_events ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['selection_items', 'selection_item_events'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Authenticated read" ON %I', t);
    EXECUTE format('CREATE POLICY "Authenticated read" ON %I FOR SELECT TO authenticated USING (true)', t);
    EXECUTE format('DROP POLICY IF EXISTS "Authenticated insert" ON %I', t);
    EXECUTE format('CREATE POLICY "Authenticated insert" ON %I FOR INSERT TO authenticated WITH CHECK (true)', t);
    EXECUTE format('DROP POLICY IF EXISTS "Authenticated update" ON %I', t);
    EXECUTE format('CREATE POLICY "Authenticated update" ON %I FOR UPDATE TO authenticated USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;
-- No delete policy: rows are never erased from the app; "removed" is a stage.
