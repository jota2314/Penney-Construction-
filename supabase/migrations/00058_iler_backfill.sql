-- 00058_iler_backfill.sql
-- Backfill Iler Remodel (project_id = 28662be6-9631-4bdd-8668-a26dee0015fd)
-- with corrected base budgets, 17 change orders, and invoice linkage.
--
-- Run AFTER 00057_change_order_tracking.sql.
-- Idempotent: skips CO creation if change_orders already exist for this project.

DO $$
DECLARE
  v_project_id  UUID := '28662be6-9631-4bdd-8668-a26dee0015fd';
  v_estimate_id UUID;
  v_co_count    INT;
  v_co_id       UUID;
  v_li_id       UUID;
BEGIN

  -- ── Find the Iler estimate ──
  SELECT id INTO v_estimate_id
    FROM estimates
   WHERE project_id = v_project_id
   ORDER BY version DESC
   LIMIT 1;

  IF v_estimate_id IS NULL THEN
    RAISE EXCEPTION 'No estimate found for Iler project %', v_project_id;
  END IF;

  -- ════════════════════════════════════════════════════════
  -- PART 2: Adjust Iler base budgets to proposal prices
  -- ════════════════════════════════════════════════════════

  UPDATE estimate_line_items SET total_cost = 6200.00
   WHERE estimate_id = v_estimate_id AND sort_order = 1 AND description ILIKE '%Administration%';

  UPDATE estimate_line_items SET total_cost = 2500.00
   WHERE estimate_id = v_estimate_id AND sort_order = 2 AND description ILIKE '%Protection%';

  UPDATE estimate_line_items SET total_cost = 450.00
   WHERE estimate_id = v_estimate_id AND sort_order = 3 AND description ILIKE '%Cleaning%';

  UPDATE estimate_line_items SET total_cost = 3600.00
   WHERE estimate_id = v_estimate_id AND sort_order = 4 AND description ILIKE '%Dumpster%';

  UPDATE estimate_line_items SET total_cost = 800.00
   WHERE estimate_id = v_estimate_id AND sort_order = 5 AND description ILIKE '%Portable%Bathroom%';

  UPDATE estimate_line_items SET total_cost = 11950.00
   WHERE estimate_id = v_estimate_id AND sort_order = 6 AND description ILIKE '%Demolition%';

  UPDATE estimate_line_items SET total_cost = 2000.00
   WHERE estimate_id = v_estimate_id AND sort_order = 7 AND description ILIKE '%Concrete%';

  UPDATE estimate_line_items SET total_cost = 5000.00
   WHERE estimate_id = v_estimate_id AND sort_order = 8 AND description ILIKE '%Garage%Door%';

  UPDATE estimate_line_items SET total_cost = 19950.00
   WHERE estimate_id = v_estimate_id AND sort_order = 9 AND description ILIKE '%Framing%';

  UPDATE estimate_line_items SET total_cost = 41440.00
   WHERE estimate_id = v_estimate_id AND sort_order = 10 AND description ILIKE '%Plumbing%';

  UPDATE estimate_line_items SET total_cost = 42780.00
   WHERE estimate_id = v_estimate_id AND sort_order = 11 AND description ILIKE '%HVAC%';

  UPDATE estimate_line_items SET total_cost = 32700.00
   WHERE estimate_id = v_estimate_id AND sort_order = 12 AND description ILIKE '%Electrical%';

  UPDATE estimate_line_items SET total_cost = 8200.00
   WHERE estimate_id = v_estimate_id AND sort_order = 13 AND description ILIKE '%Insulation%';

  UPDATE estimate_line_items SET total_cost = 7788.70
   WHERE estimate_id = v_estimate_id AND sort_order = 14 AND description ILIKE '%Front%Door%';

  UPDATE estimate_line_items SET total_cost = 13500.00
   WHERE estimate_id = v_estimate_id AND sort_order = 15 AND description ILIKE '%Blueboard%';

  UPDATE estimate_line_items SET total_cost = 9360.00
   WHERE estimate_id = v_estimate_id AND sort_order = 16 AND description ILIKE '%Hardwood%Floor%';

  UPDATE estimate_line_items SET total_cost = 3650.00
   WHERE estimate_id = v_estimate_id AND sort_order = 17 AND description ILIKE '%Tile%';

  UPDATE estimate_line_items SET total_cost = 3600.00
   WHERE estimate_id = v_estimate_id AND sort_order = 18 AND description ILIKE '%Kitchen%Install%';

  UPDATE estimate_line_items SET total_cost = 19200.00
   WHERE estimate_id = v_estimate_id AND sort_order = 19 AND description ILIKE '%Finish%Work%';

  UPDATE estimate_line_items SET total_cost = 3200.00
   WHERE estimate_id = v_estimate_id AND sort_order = 20 AND description ILIKE '%Deck%';

  UPDATE estimate_line_items SET total_cost = 6500.00
   WHERE estimate_id = v_estimate_id AND sort_order = 21 AND description ILIKE '%Pergola%';

  UPDATE estimate_line_items SET total_cost = 6380.00
   WHERE estimate_id = v_estimate_id AND sort_order = 22 AND description ILIKE '%LVP%';

  RAISE NOTICE 'Updated 22 Iler base budget rows to proposal prices.';

  -- ════════════════════════════════════════════════════════
  -- PART 3: Insert 17 change orders + matching line items
  -- ════════════════════════════════════════════════════════

  SELECT COUNT(*) INTO v_co_count
    FROM change_orders
   WHERE project_id = v_project_id;

  IF v_co_count > 0 THEN
    RAISE NOTICE 'Iler already has % change orders — skipping CO insert.', v_co_count;
  ELSE

    -- CO 1: Patio French Door
    INSERT INTO change_orders (project_id, estimate_id, change_order_number, title, description, status, cost_impact, price_impact, approved_at)
    VALUES (v_project_id, v_estimate_id, 1, 'Patio French Door', 'Install new 110" patio door', 'approved', 6800, 6800, NOW())
    RETURNING id INTO v_co_id;
    INSERT INTO estimate_line_items (estimate_id, description, trade, total_cost, total_price, quantity, unit, unit_cost, sort_order, change_order_id, is_visible_on_proposal, source)
    VALUES (v_estimate_id, 'Patio French Door', 'Carpentry', 6800, 6800, 1, 'LS', 6800, 101, v_co_id, false, 'manual');

    -- CO 2: Structural Beams (4)
    INSERT INTO change_orders (project_id, estimate_id, change_order_number, title, description, status, cost_impact, price_impact, approved_at)
    VALUES (v_project_id, v_estimate_id, 2, 'Structural Beams (4)', 'Furnish & install 4 structural beams', 'approved', 6200, 6200, NOW())
    RETURNING id INTO v_co_id;
    INSERT INTO estimate_line_items (estimate_id, description, trade, total_cost, total_price, quantity, unit, unit_cost, sort_order, change_order_id, is_visible_on_proposal, source)
    VALUES (v_estimate_id, 'Structural Beams (4)', 'Framing', 6200, 6200, 1, 'LS', 6200, 102, v_co_id, false, 'manual');

    -- CO 3: LVL Header Pack
    INSERT INTO change_orders (project_id, estimate_id, change_order_number, title, description, status, cost_impact, price_impact, approved_at)
    VALUES (v_project_id, v_estimate_id, 3, 'LVL Header Pack', 'Provide & install double 2x12 LVL headers', 'approved', 3620, 3620, NOW())
    RETURNING id INTO v_co_id;
    INSERT INTO estimate_line_items (estimate_id, description, trade, total_cost, total_price, quantity, unit, unit_cost, sort_order, change_order_id, is_visible_on_proposal, source)
    VALUES (v_estimate_id, 'LVL Header Pack', 'Framing', 3620, 3620, 1, 'LS', 3620, 103, v_co_id, false, 'manual');

    -- CO 4: Plumbing Extra
    INSERT INTO change_orders (project_id, estimate_id, change_order_number, title, description, status, cost_impact, price_impact, approved_at)
    VALUES (v_project_id, v_estimate_id, 4, 'Plumbing Extra', 'Added plumbing labor/materials', 'approved', 975, 975, NOW())
    RETURNING id INTO v_co_id;
    INSERT INTO estimate_line_items (estimate_id, description, trade, total_cost, total_price, quantity, unit, unit_cost, sort_order, change_order_id, is_visible_on_proposal, source)
    VALUES (v_estimate_id, 'Plumbing Extra', 'Plumbing', 975, 975, 1, 'LS', 975, 104, v_co_id, false, 'manual');

    -- CO 5: Kitchen Windows (4 Harvey)
    INSERT INTO change_orders (project_id, estimate_id, change_order_number, title, description, status, cost_impact, price_impact, approved_at)
    VALUES (v_project_id, v_estimate_id, 5, 'Kitchen Windows (4 Harvey)', 'Provide & install 4 Harvey windows', 'approved', 4352, 4352, NOW())
    RETURNING id INTO v_co_id;
    INSERT INTO estimate_line_items (estimate_id, description, trade, total_cost, total_price, quantity, unit, unit_cost, sort_order, change_order_id, is_visible_on_proposal, source)
    VALUES (v_estimate_id, 'Kitchen Windows (4 Harvey)', 'Windows', 4352, 4352, 1, 'LS', 4352, 105, v_co_id, false, 'manual');

    -- CO 6: Concrete Cut — Basement Door
    INSERT INTO change_orders (project_id, estimate_id, change_order_number, title, description, status, cost_impact, price_impact, approved_at)
    VALUES (v_project_id, v_estimate_id, 6, 'Concrete Cut — Basement Door', 'Cut concrete for basement door', 'approved', 1300, 1300, NOW())
    RETURNING id INTO v_co_id;
    INSERT INTO estimate_line_items (estimate_id, description, trade, total_cost, total_price, quantity, unit, unit_cost, sort_order, change_order_id, is_visible_on_proposal, source)
    VALUES (v_estimate_id, 'Concrete Cut — Basement Door', 'Concrete', 1300, 1300, 1, 'LS', 1300, 106, v_co_id, false, 'manual');

    -- CO 7: Basement Door
    INSERT INTO change_orders (project_id, estimate_id, change_order_number, title, description, status, cost_impact, price_impact, approved_at)
    VALUES (v_project_id, v_estimate_id, 7, 'Basement Door', 'Custom-sized basement door + install', 'approved', 1455, 1455, NOW())
    RETURNING id INTO v_co_id;
    INSERT INTO estimate_line_items (estimate_id, description, trade, total_cost, total_price, quantity, unit, unit_cost, sort_order, change_order_id, is_visible_on_proposal, source)
    VALUES (v_estimate_id, 'Basement Door', 'Carpentry', 1455, 1455, 1, 'LS', 1455, 107, v_co_id, false, 'manual');

    -- CO 8: Make-up Air / Hood Exhaust
    INSERT INTO change_orders (project_id, estimate_id, change_order_number, title, description, status, cost_impact, price_impact, approved_at)
    VALUES (v_project_id, v_estimate_id, 8, 'Make-up Air / Hood Exhaust', 'Hood exhaust + make-up air', 'approved', 2210, 2210, NOW())
    RETURNING id INTO v_co_id;
    INSERT INTO estimate_line_items (estimate_id, description, trade, total_cost, total_price, quantity, unit, unit_cost, sort_order, change_order_id, is_visible_on_proposal, source)
    VALUES (v_estimate_id, 'Make-up Air / Hood Exhaust', 'HVAC', 2210, 2210, 1, 'LS', 2210, 108, v_co_id, false, 'manual');

    -- CO 9: Basement Windows
    INSERT INTO change_orders (project_id, estimate_id, change_order_number, title, description, status, cost_impact, price_impact, approved_at)
    VALUES (v_project_id, v_estimate_id, 9, 'Basement Windows', 'Replace basement windows', 'approved', 1350, 1350, NOW())
    RETURNING id INTO v_co_id;
    INSERT INTO estimate_line_items (estimate_id, description, trade, total_cost, total_price, quantity, unit, unit_cost, sort_order, change_order_id, is_visible_on_proposal, source)
    VALUES (v_estimate_id, 'Basement Windows', 'Windows', 1350, 1350, 1, 'LS', 1350, 109, v_co_id, false, 'manual');

    -- CO 10: 2nd Floor Subpanel
    INSERT INTO change_orders (project_id, estimate_id, change_order_number, title, description, status, cost_impact, price_impact, approved_at)
    VALUES (v_project_id, v_estimate_id, 10, '2nd Floor Subpanel', 'Wire 2nd floor subpanel', 'approved', 1950, 1950, NOW())
    RETURNING id INTO v_co_id;
    INSERT INTO estimate_line_items (estimate_id, description, trade, total_cost, total_price, quantity, unit, unit_cost, sort_order, change_order_id, is_visible_on_proposal, source)
    VALUES (v_estimate_id, '2nd Floor Subpanel', 'Electrical', 1950, 1950, 1, 'LS', 1950, 110, v_co_id, false, 'manual');

    -- CO 11: Basement Fireplace
    INSERT INTO change_orders (project_id, estimate_id, change_order_number, title, description, status, cost_impact, price_impact, approved_at)
    VALUES (v_project_id, v_estimate_id, 11, 'Basement Fireplace', 'Remove existing brick, frame around', 'approved', 2300, 2300, NOW())
    RETURNING id INTO v_co_id;
    INSERT INTO estimate_line_items (estimate_id, description, trade, total_cost, total_price, quantity, unit, unit_cost, sort_order, change_order_id, is_visible_on_proposal, source)
    VALUES (v_estimate_id, 'Basement Fireplace', 'Masonry', 2300, 2300, 1, 'LS', 2300, 111, v_co_id, false, 'manual');

    -- CO 12: Baseboard Patch & Paint (draft)
    INSERT INTO change_orders (project_id, estimate_id, change_order_number, title, description, status, cost_impact, price_impact)
    VALUES (v_project_id, v_estimate_id, 12, 'Baseboard Patch & Paint', 'Remove 600 LF baseboard, patch, repaint', 'draft', 800, 800)
    RETURNING id INTO v_co_id;
    INSERT INTO estimate_line_items (estimate_id, description, trade, total_cost, total_price, quantity, unit, unit_cost, sort_order, change_order_id, is_visible_on_proposal, source)
    VALUES (v_estimate_id, 'Baseboard Patch & Paint', 'Finish', 800, 800, 1, 'LS', 800, 112, v_co_id, false, 'manual');

    -- CO 13: Wet Bar Shift
    INSERT INTO change_orders (project_id, estimate_id, change_order_number, title, description, status, cost_impact, price_impact, approved_at)
    VALUES (v_project_id, v_estimate_id, 13, 'Wet Bar Shift', 'Move plumbing rough + adjust framing', 'approved', 2300, 2300, NOW())
    RETURNING id INTO v_co_id;
    INSERT INTO estimate_line_items (estimate_id, description, trade, total_cost, total_price, quantity, unit, unit_cost, sort_order, change_order_id, is_visible_on_proposal, source)
    VALUES (v_estimate_id, 'Wet Bar Shift', 'Plumbing', 2300, 2300, 1, 'LS', 2300, 113, v_co_id, false, 'manual');

    -- CO 14: 2nd Floor Bathroom — Plumbing
    INSERT INTO change_orders (project_id, estimate_id, change_order_number, title, description, status, cost_impact, price_impact, approved_at)
    VALUES (v_project_id, v_estimate_id, 14, '2nd Floor Bathroom — Plumbing', 'Update 2nd floor bath plumbing', 'approved', 6325, 6325, NOW())
    RETURNING id INTO v_co_id;
    INSERT INTO estimate_line_items (estimate_id, description, trade, total_cost, total_price, quantity, unit, unit_cost, sort_order, change_order_id, is_visible_on_proposal, source)
    VALUES (v_estimate_id, '2nd Floor Bathroom — Plumbing', 'Plumbing', 6325, 6325, 1, 'LS', 6325, 114, v_co_id, false, 'manual');

    -- CO 15: 2nd Floor Bathroom — Demolition
    INSERT INTO change_orders (project_id, estimate_id, change_order_number, title, description, status, cost_impact, price_impact, approved_at)
    VALUES (v_project_id, v_estimate_id, 15, '2nd Floor Bathroom — Demolition', 'Demo 2nd floor bath', 'approved', 3000, 3000, NOW())
    RETURNING id INTO v_co_id;
    INSERT INTO estimate_line_items (estimate_id, description, trade, total_cost, total_price, quantity, unit, unit_cost, sort_order, change_order_id, is_visible_on_proposal, source)
    VALUES (v_estimate_id, '2nd Floor Bathroom — Demolition', 'Demo', 3000, 3000, 1, 'LS', 3000, 115, v_co_id, false, 'manual');

    -- CO 16: Basement Door Step
    INSERT INTO change_orders (project_id, estimate_id, change_order_number, title, description, status, cost_impact, price_impact, approved_at)
    VALUES (v_project_id, v_estimate_id, 16, 'Basement Door Step', 'Frame new basement step to code', 'approved', 95, 95, NOW())
    RETURNING id INTO v_co_id;
    INSERT INTO estimate_line_items (estimate_id, description, trade, total_cost, total_price, quantity, unit, unit_cost, sort_order, change_order_id, is_visible_on_proposal, source)
    VALUES (v_estimate_id, 'Basement Door Step', 'Framing', 95, 95, 1, 'LS', 95, 116, v_co_id, false, 'manual');

    -- CO 17: Roof Leak — Siding Cut (draft/TBD, $0)
    INSERT INTO change_orders (project_id, estimate_id, change_order_number, title, description, status, cost_impact, price_impact)
    VALUES (v_project_id, v_estimate_id, 17, 'Roof Leak — Siding Cut', 'Steven cut siding 1 course for roof repair', 'draft', 0, 0)
    RETURNING id INTO v_co_id;
    INSERT INTO estimate_line_items (estimate_id, description, trade, total_cost, total_price, quantity, unit, unit_cost, sort_order, change_order_id, is_visible_on_proposal, source)
    VALUES (v_estimate_id, 'Roof Leak — Siding Cut', 'Siding', 0, 0, 1, 'LS', 0, 117, v_co_id, false, 'manual');

    RAISE NOTICE 'Inserted 17 change orders with matching estimate line items.';

  END IF;

  -- ════════════════════════════════════════════════════════
  -- PART 4: Link existing invoices to change orders
  -- ════════════════════════════════════════════════════════

  -- CO 11 — Basement Fireplace: Goodwin Masonry $5,200
  SELECT co.id INTO v_co_id
    FROM change_orders co
   WHERE co.project_id = v_project_id AND co.change_order_number = 11;

  IF v_co_id IS NOT NULL THEN
    SELECT li.id INTO v_li_id
      FROM estimate_line_items li
     WHERE li.change_order_id = v_co_id
     LIMIT 1;

    UPDATE invoices
       SET change_order_id = v_co_id,
           estimate_line_item_id = COALESCE(v_li_id, estimate_line_item_id)
     WHERE project_id = v_project_id
       AND vendor_name = 'Goodwin Masonry, LLC'
       AND amount = 5200.00;
    RAISE NOTICE 'Linked Goodwin Masonry $5,200 → CO 11 (Basement Fireplace). NOTE: invoice $5,200 > budget $2,300 — over budget.';
  END IF;

  -- CO 1 — Patio French Door: Building Center of Essex $5,130.01 (Andersen patio doors)
  SELECT co.id INTO v_co_id
    FROM change_orders co
   WHERE co.project_id = v_project_id AND co.change_order_number = 1;

  IF v_co_id IS NOT NULL THEN
    SELECT li.id INTO v_li_id
      FROM estimate_line_items li
     WHERE li.change_order_id = v_co_id
     LIMIT 1;

    UPDATE invoices
       SET change_order_id = v_co_id,
           estimate_line_item_id = COALESCE(v_li_id, estimate_line_item_id)
     WHERE project_id = v_project_id
       AND vendor_name = 'Building Center of Essex'
       AND amount = 5130.01;
    RAISE NOTICE 'Linked Building Center of Essex $5,130.01 → CO 1 (Patio French Door).';
  END IF;

  -- CO 7 — Basement Door: Building Center of Essex $1,140.53 (Brosco ext door, 3/13)
  SELECT co.id INTO v_co_id
    FROM change_orders co
   WHERE co.project_id = v_project_id AND co.change_order_number = 7;

  IF v_co_id IS NOT NULL THEN
    SELECT li.id INTO v_li_id
      FROM estimate_line_items li
     WHERE li.change_order_id = v_co_id
     LIMIT 1;

    UPDATE invoices
       SET change_order_id = v_co_id,
           estimate_line_item_id = COALESCE(v_li_id, estimate_line_item_id)
     WHERE project_id = v_project_id
       AND vendor_name = 'Building Center of Essex'
       AND amount = 1140.53;
    RAISE NOTICE 'Linked Building Center of Essex $1,140.53 → CO 7 (Basement Door).';
  END IF;

  RAISE NOTICE 'Iler backfill complete.';

END $$;
