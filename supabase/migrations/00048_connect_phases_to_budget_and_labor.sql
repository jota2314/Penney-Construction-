-- Connect schedule phases to estimate line items (phase = when a budget line happens)
ALTER TABLE schedule_phases
  ADD COLUMN estimate_line_item_id uuid REFERENCES estimate_line_items(id) ON DELETE SET NULL;

CREATE INDEX idx_schedule_phases_estimate_line ON schedule_phases(estimate_line_item_id);

-- Connect time entries to schedule phases (crew logs time against a phase)
ALTER TABLE time_entries
  ADD COLUMN schedule_phase_id uuid REFERENCES schedule_phases(id) ON DELETE SET NULL;

CREATE INDEX idx_time_entries_schedule_phase ON time_entries(schedule_phase_id);

-- Also add trade to time_entries for simpler rollups when phase isn't set
ALTER TABLE time_entries
  ADD COLUMN trade text;
