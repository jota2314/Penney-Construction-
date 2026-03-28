-- ============================================================
-- Penney Construction — Seed Real Project Data
-- Run this in Supabase SQL Editor
-- ============================================================

-- First, get the user ID for Jorge (the logged-in user)
-- We'll use a variable approach
DO $$
DECLARE
  jorge_id uuid;
BEGIN
  -- Get Jorge's profile ID
  SELECT id INTO jorge_id FROM profiles LIMIT 1;

  -- If no profile found, skip
  IF jorge_id IS NULL THEN
    RAISE NOTICE 'No profile found. Make sure you are logged in first.';
    RETURN;
  END IF;

  -- ── CUSTOMERS ──────────────────────────────────────
  INSERT INTO customers (first_name, last_name, address, city, state, created_by) VALUES
    ('Paul', 'Gouthro', '14 Cameron Rd', 'Lynn', 'MA', jorge_id),
    ('Eric', 'Pedersen', '57 Locksley Rd', 'Lynnfield', 'MA', jorge_id),
    ('Jessica', 'Schenkel', '74 Cavendish Circle', 'Salem', 'MA', jorge_id),
    ('Barbara', 'Welles Iler', '11 Cherry St', 'Wenham', 'MA', jorge_id),
    ('Leslie', 'Colten', '15 Robinson Rd', 'Beverly', 'MA', jorge_id),
    ('Kristen', 'Danaher', '44 William Fairfield', 'Wenham', 'MA', jorge_id),
    ('Julee', 'Haley', '80 Bridge St', 'S. Hamilton', 'MA', jorge_id),
    ('John', 'Ouellette', '13 Stewart Ln', 'Beverly', 'MA', jorge_id),
    ('Sonia', 'Friedman', '208 Church St', 'West Roxbury', 'MA', jorge_id),
    ('Pam', 'Sullivan', NULL, NULL, 'MA', jorge_id),
    ('Diana', 'Lapointe', NULL, NULL, 'MA', jorge_id),
    ('Michael', 'Sutcliffe', NULL, NULL, 'MA', jorge_id)
  ON CONFLICT DO NOTHING;

  -- ── PROJECTS ──────────────────────────────────────
  INSERT INTO projects (project_number, name, address, city, state, project_type, status, phase, description, created_by) VALUES
    ('P-001', 'Gouthro Addition', '14 Cameron Rd', 'Lynn', 'MA', 'addition', 'in_progress', 'pre_start', 'Addition project — lumber order pending, Steve Black pricing in', jorge_id),
    ('P-002', 'Pedersen / Locksley', '57 Locksley Rd', 'Lynnfield', 'MA', 'remodel', 'estimating', 'preconstruction', 'Preconstruction — 6 garage door quotes sent, awaiting responses', jorge_id),
    ('P-003', 'Schenkel Kitchen', '74 Cavendish Circle', 'Salem', 'MA', 'kitchen', 'contracted', 'pre_start', 'Kitchen remodel — starting Monday, PM handoff complete, Howie has the package', jorge_id),
    ('P-004', 'Welles Iler', '11 Cherry St', 'Wenham', 'MA', 'remodel', 'in_progress', 'rough_in', 'Rough-in phase — MTP re-pricing sconce add-on, awaiting revised number', jorge_id),
    ('P-005', 'Colten Kitchen Bath', '15 Robinson Rd', 'Beverly', 'MA', 'kitchen', 'in_progress', 'finishing', 'Kitchen & bath remodel — finishing phase', jorge_id),
    ('P-006', 'Danaher 2nd Floor', '44 William Fairfield', 'Wenham', 'MA', 'addition', 'estimating', 'preconstruction', '2nd floor addition project', jorge_id),
    ('P-007', 'Haley / Hamilton', '80 Bridge St', 'S. Hamilton', 'MA', 'remodel', 'estimating', 'preconstruction', 'Remodel project in Hamilton', jorge_id),
    ('P-008', 'Ouellette / Stewart', '13 Stewart Ln', 'Beverly', 'MA', 'remodel', 'estimating', 'preconstruction', 'Remodel project in Beverly', jorge_id),
    ('P-009', 'Friedman', '208 Church St', 'West Roxbury', 'MA', 'remodel', 'estimating', 'preconstruction', 'Remodel project in West Roxbury', jorge_id),
    ('P-010', 'Sullivan Bathroom', NULL, NULL, 'MA', 'bathroom', 'lead', 'preconstruction', 'Bathroom project — TBD', jorge_id),
    ('P-011', 'Lapointe', NULL, NULL, 'MA', 'remodel', 'in_progress', 'finishing', 'Active — change order phase', jorge_id),
    ('P-012', 'Sutcliffe', NULL, NULL, 'MA', 'remodel', 'in_progress', 'finishing', 'Active project', jorge_id)
  ON CONFLICT DO NOTHING;

  -- ── Link customers to projects ──────────────────────────
  UPDATE projects SET customer_id = (SELECT id FROM customers WHERE last_name = 'Gouthro' LIMIT 1) WHERE name = 'Gouthro Addition';
  UPDATE projects SET customer_id = (SELECT id FROM customers WHERE last_name = 'Pedersen' LIMIT 1) WHERE name = 'Pedersen / Locksley';
  UPDATE projects SET customer_id = (SELECT id FROM customers WHERE last_name = 'Schenkel' LIMIT 1) WHERE name = 'Schenkel Kitchen';
  UPDATE projects SET customer_id = (SELECT id FROM customers WHERE last_name = 'Welles Iler' LIMIT 1) WHERE name = 'Welles Iler';
  UPDATE projects SET customer_id = (SELECT id FROM customers WHERE last_name = 'Colten' LIMIT 1) WHERE name = 'Colten Kitchen Bath';
  UPDATE projects SET customer_id = (SELECT id FROM customers WHERE last_name = 'Danaher' LIMIT 1) WHERE name = 'Danaher 2nd Floor';
  UPDATE projects SET customer_id = (SELECT id FROM customers WHERE last_name = 'Haley' LIMIT 1) WHERE name = 'Haley / Hamilton';
  UPDATE projects SET customer_id = (SELECT id FROM customers WHERE last_name = 'Ouellette' LIMIT 1) WHERE name = 'Ouellette / Stewart';
  UPDATE projects SET customer_id = (SELECT id FROM customers WHERE last_name = 'Friedman' LIMIT 1) WHERE name = 'Friedman';
  UPDATE projects SET customer_id = (SELECT id FROM customers WHERE last_name = 'Sullivan' LIMIT 1) WHERE name = 'Sullivan Bathroom';
  UPDATE projects SET customer_id = (SELECT id FROM customers WHERE last_name = 'Lapointe' LIMIT 1) WHERE name = 'Lapointe';
  UPDATE projects SET customer_id = (SELECT id FROM customers WHERE last_name = 'Sutcliffe' LIMIT 1) WHERE name = 'Sutcliffe';

  -- ── Set progress on projects ──────────────────────────
  UPDATE projects SET progress = 40 WHERE name = 'Gouthro Addition';
  UPDATE projects SET progress = 25 WHERE name = 'Pedersen / Locksley';
  UPDATE projects SET progress = 45 WHERE name = 'Schenkel Kitchen';
  UPDATE projects SET progress = 65 WHERE name = 'Welles Iler';
  UPDATE projects SET progress = 80 WHERE name = 'Colten Kitchen Bath';
  UPDATE projects SET progress = 15 WHERE name = 'Danaher 2nd Floor';
  UPDATE projects SET progress = 20 WHERE name = 'Haley / Hamilton';
  UPDATE projects SET progress = 15 WHERE name = 'Ouellette / Stewart';
  UPDATE projects SET progress = 15 WHERE name = 'Friedman';
  UPDATE projects SET progress = 5 WHERE name = 'Sullivan Bathroom';
  UPDATE projects SET progress = 85 WHERE name = 'Lapointe';
  UPDATE projects SET progress = 80 WHERE name = 'Sutcliffe';

  -- ── Set next actions ──────────────────────────────────
  UPDATE projects SET next_action = 'Lumber order pending — Steve Black pricing in' WHERE name = 'Gouthro Addition';
  UPDATE projects SET next_action = '6 garage door quotes sent — awaiting responses' WHERE name = 'Pedersen / Locksley';
  UPDATE projects SET next_action = 'PM handoff complete — Howie has the package' WHERE name = 'Schenkel Kitchen';
  UPDATE projects SET next_action = 'MTP re-pricing sconce add-on — awaiting revised number' WHERE name = 'Welles Iler';
  UPDATE projects SET next_action = 'Change order phase' WHERE name = 'Lapointe';

  RAISE NOTICE 'Seed data inserted successfully!';
END $$;
