-- ══════════════════════════════════════════════════
-- Migration 00011: Subcontractors + Employees + Schedule
-- Fully idempotent — safe to re-run after partial failures
-- ══════════════════════════════════════════════════


-- ── Phase A: Subcontractors delete policy + seed ──

DROP POLICY IF EXISTS "Users can delete own subcontractors" ON subcontractors;

CREATE POLICY "Users can delete own subcontractors"
  ON subcontractors FOR DELETE
  USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'owner'
    )
  );

-- Seed subcontractors (skip if already seeded)
INSERT INTO subcontractors (company_name, contact_name, email, phone, address, city, state, zip, trades, license_number, insurance_expiry, rating, notes, is_active, created_by)
SELECT v.company_name, v.contact_name, v.email, v.phone, v.address, v.city, v.state, v.zip, v.trades, v.license_number, v.insurance_expiry::date, v.rating, v.notes, v.is_active, (SELECT id FROM profiles LIMIT 1)
FROM (VALUES
  ('Lone Star Electric', 'Mike Hernandez', 'mike@lonestarelectric.com', '(512) 555-0101', '4520 Industrial Blvd', 'Austin', 'TX', '78745', ARRAY['Electrical'], 'TECL-28451', '2027-03-15', 5, 'Reliable, great communication. Preferred electrical sub.', true),
  ('Hill Country Plumbing', 'Sarah Chen', 'sarah@hcplumbing.com', '(512) 555-0102', '890 Commerce Dr', 'Round Rock', 'TX', '78664', ARRAY['Plumbing'], 'M-41892', '2026-11-30', 4, 'Good quality work, sometimes slow to start.', true),
  ('Central TX Framing', 'Jose Ramirez', 'jose@ctxframing.com', '(512) 555-0103', '2100 Woodward St', 'Cedar Park', 'TX', '78613', ARRAY['Framing', 'Carpentry'], NULL, '2027-01-20', 5, 'Fast and accurate framing crew. 6-man team.', true),
  ('BlueBonnet HVAC', 'Tommy Wilson', 'tommy@bluebonnethvac.com', '(512) 555-0104', '1560 Airport Blvd', 'Austin', 'TX', '78702', ARRAY['HVAC'], 'TACLA-67230', '2026-09-01', 4, 'Handles residential and light commercial.', true),
  ('Premier Painting Co', 'David Park', 'david@premierpaint.com', '(512) 555-0105', '780 S Lamar Blvd', 'Austin', 'TX', '78704', ARRAY['Painting', 'Drywall'], NULL, '2027-06-15', 3, 'Decent work but needs supervision on detail work.', true),
  ('Foundation Masters TX', 'Angela Brooks', 'angela@foundationmasters.com', '(210) 555-0106', '3300 Stone Oak Pkwy', 'San Antonio', 'TX', '78258', ARRAY['Concrete', 'Foundation'], 'LIC-55210', '2027-02-28', 5, 'Best foundation sub in Central TX. Worth the drive.', true),
  ('Texas Tile & Stone', 'Mark Sullivan', 'mark@txtile.com', '(512) 555-0107', '620 E 6th St', 'Austin', 'TX', '78701', ARRAY['Tile', 'Flooring'], NULL, '2026-12-15', 4, 'Great tile work. Also does hardwood and LVP.', true),
  ('Apex Roofing Solutions', 'Brandon Keith', 'brandon@apexroofing.com', '(512) 555-0108', '1400 N I-35', 'Georgetown', 'TX', '78626', ARRAY['Roofing'], 'LIC-88901', '2025-08-01', 2, 'Insurance expired — do not use until renewed.', false)
) AS v(company_name, contact_name, email, phone, address, city, state, zip, trades, license_number, insurance_expiry, rating, notes, is_active)
WHERE NOT EXISTS (SELECT 1 FROM subcontractors WHERE subcontractors.company_name = v.company_name);


-- ── Phase B: Employees table + RLS + seed ──

DO $$ BEGIN
  CREATE TYPE employee_status AS ENUM ('active', 'inactive');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS employees (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text,
  phone text,
  title text,
  status employee_status NOT NULL DEFAULT 'active',
  hourly_rate numeric(10,2),
  hire_date date,
  emergency_contact_name text,
  emergency_contact_phone text,
  notes text,
  created_by uuid REFERENCES auth.users(id) NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read employees" ON employees;
CREATE POLICY "Authenticated users can read employees"
  ON employees FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can insert employees" ON employees;
CREATE POLICY "Authenticated users can insert employees"
  ON employees FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can update employees" ON employees;
CREATE POLICY "Authenticated users can update employees"
  ON employees FOR UPDATE
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Users can delete own employees" ON employees;
CREATE POLICY "Users can delete own employees"
  ON employees FOR DELETE
  USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'owner'
    )
  );

DROP TRIGGER IF EXISTS set_employees_updated_at ON employees;
CREATE TRIGGER set_employees_updated_at
  BEFORE UPDATE ON employees
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Seed employees (skip if already seeded)
INSERT INTO employees (first_name, last_name, email, phone, title, status, hourly_rate, hire_date, emergency_contact_name, emergency_contact_phone, notes, created_by)
SELECT v.first_name, v.last_name, v.email, v.phone, v.title, v.status::employee_status, v.hourly_rate, v.hire_date::date, v.ec_name, v.ec_phone, v.notes, (SELECT id FROM profiles LIMIT 1)
FROM (VALUES
  ('James', 'Penney', 'james@penneyconstruction.com', '(512) 555-1001', 'Superintendent', 'active', 45.00, '2020-01-15', 'Laura Penney', '(512) 555-9001', 'Company superintendent. Oversees all active projects.'),
  ('Carlos', 'Rivera', 'carlos@penneyconstruction.com', '(512) 555-1002', 'Foreman', 'active', 38.00, '2021-03-01', 'Maria Rivera', '(512) 555-9002', 'Lead foreman. Great with crew management.'),
  ('Tyler', 'Brooks', NULL, '(512) 555-1003', 'Lead Carpenter', 'active', 35.00, '2021-06-15', 'Amy Brooks', '(512) 555-9003', 'Experienced finish carpenter. 10+ years.'),
  ('Marcus', 'Johnson', NULL, '(512) 555-1004', 'Carpenter', 'active', 28.00, '2022-09-01', 'Diane Johnson', '(512) 555-9004', 'Solid rough and finish carpentry skills.'),
  ('Kevin', 'Tran', NULL, '(512) 555-1005', 'Apprentice', 'active', 20.00, '2024-01-10', 'Lisa Tran', '(512) 555-9005', 'First-year apprentice. Eager learner.'),
  ('Derek', 'Simmons', NULL, '(512) 555-1006', 'Laborer', 'active', 18.00, '2023-05-20', 'Pat Simmons', '(512) 555-9006', 'General labor and site cleanup.'),
  ('Ryan', 'Mitchell', NULL, '(512) 555-1007', 'Carpenter', 'inactive', 30.00, '2022-02-01', 'Sue Mitchell', '(512) 555-9007', 'Left company Aug 2025. Good worker — rehire eligible.')
) AS v(first_name, last_name, email, phone, title, status, hourly_rate, hire_date, ec_name, ec_phone, notes)
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE employees.first_name = v.first_name AND employees.last_name = v.last_name);


-- ── Phase C: Schedule Phases table + RLS ──

DO $$ BEGIN
  CREATE TYPE schedule_phase_status AS ENUM ('not_started', 'in_progress', 'completed', 'on_hold');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS schedule_phases (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  description text,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status schedule_phase_status NOT NULL DEFAULT 'not_started',
  sort_order integer NOT NULL DEFAULT 0,
  assigned_employee_ids uuid[] DEFAULT '{}',
  assigned_sub_ids uuid[] DEFAULT '{}',
  color text DEFAULT '#3b82f6',
  notes text,
  created_by uuid REFERENCES auth.users(id) NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT end_after_start CHECK (end_date >= start_date)
);

ALTER TABLE schedule_phases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read schedule_phases" ON schedule_phases;
CREATE POLICY "Authenticated users can read schedule_phases"
  ON schedule_phases FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can insert schedule_phases" ON schedule_phases;
CREATE POLICY "Authenticated users can insert schedule_phases"
  ON schedule_phases FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can update schedule_phases" ON schedule_phases;
CREATE POLICY "Authenticated users can update schedule_phases"
  ON schedule_phases FOR UPDATE
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can delete schedule_phases" ON schedule_phases;
CREATE POLICY "Authenticated users can delete schedule_phases"
  ON schedule_phases FOR DELETE
  USING (auth.role() = 'authenticated');

DROP TRIGGER IF EXISTS set_schedule_phases_updated_at ON schedule_phases;
CREATE TRIGGER set_schedule_phases_updated_at
  BEFORE UPDATE ON schedule_phases
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();
