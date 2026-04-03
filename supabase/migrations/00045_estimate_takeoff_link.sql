-- Link takeoff measurements to estimate line items
-- Also add a "needs_sub_quote" flag and source tracking

-- Add source column to track where line items came from
ALTER TABLE estimate_line_items
  ADD COLUMN IF NOT EXISTS takeoff_measurement_id uuid REFERENCES takeoff_measurements(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS trade text,
  ADD COLUMN IF NOT EXISTS needs_sub_quote boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'ai', 'takeoff'));
