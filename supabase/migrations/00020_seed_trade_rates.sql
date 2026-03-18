DO $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id FROM public.profiles LIMIT 1;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No user found to seed data'; END IF;

  INSERT INTO public.trade_rates (trade_name, description, unit_type, avg_cost, avg_price, data_sources, last_updated_from, created_by) VALUES
    ('Demolition', 'Interior gut demo including haul-off and dumpster', 'sqft', 3.50, 5.00, ARRAY['manual'], 'seed', v_user_id),
    ('Framing', 'Wall framing, headers, blocking, backing, Simpson ties', 'sqft', 12.00, 16.00, ARRAY['manual'], 'seed', v_user_id),
    ('Structural Steel / Beams', 'LVL/steel beams, posts, engineered lumber', 'linear_ft', 85.00, 120.00, ARRAY['manual'], 'seed', v_user_id),
    ('Roofing', 'Architectural shingles, underlayment, flashing, ridge vent', 'sqft', 5.50, 7.50, ARRAY['manual'], 'seed', v_user_id),
    ('Siding', 'Vinyl or fiber cement siding, trim, housewrap', 'sqft', 6.00, 9.00, ARRAY['manual'], 'seed', v_user_id),
    ('Windows', 'Mid-grade double-hung, supply and install', 'each', 600.00, 900.00, ARRAY['manual'], 'seed', v_user_id),
    ('Exterior Doors', 'Entry door with hardware, supply and install', 'each', 1500.00, 2200.00, ARRAY['manual'], 'seed', v_user_id),
    ('Interior Doors', 'Pre-hung interior door with casing and hardware', 'each', 350.00, 525.00, ARRAY['manual'], 'seed', v_user_id),
    ('Plumbing Rough-In', 'Supply, drain/waste/vent, shut-offs per fixture point', 'each', 1200.00, 1600.00, ARRAY['manual'], 'seed', v_user_id),
    ('Plumbing Fixtures', 'Supply and install per fixture (faucet, toilet, etc.)', 'each', 800.00, 1100.00, ARRAY['manual'], 'seed', v_user_id),
    ('Electrical Rough-In', 'Per outlet, switch, or junction box', 'each', 150.00, 200.00, ARRAY['manual'], 'seed', v_user_id),
    ('Electrical Panel', '200A panel upgrade or new subpanel', 'each', 2500.00, 3500.00, ARRAY['manual'], 'seed', v_user_id),
    ('Light Fixtures', 'Supply and install per fixture (recessed, pendant, etc.)', 'each', 175.00, 275.00, ARRAY['manual'], 'seed', v_user_id),
    ('HVAC', 'Forced air, ductwork, registers', 'sqft', 12.00, 16.00, ARRAY['manual'], 'seed', v_user_id),
    ('Insulation (Batt)', 'R-13/R-19 fiberglass batt in walls', 'sqft', 1.50, 2.25, ARRAY['manual'], 'seed', v_user_id),
    ('Insulation (Spray Foam)', 'Closed-cell spray foam', 'sqft', 3.00, 4.50, ARRAY['manual'], 'seed', v_user_id),
    ('Drywall', 'Hang, tape, mud, sand, prime — level 4 finish', 'sqft', 3.50, 5.00, ARRAY['manual'], 'seed', v_user_id),
    ('Interior Painting', 'Walls and ceilings, 2 coats, primer included', 'sqft', 2.00, 3.00, ARRAY['manual'], 'seed', v_user_id),
    ('Exterior Painting', 'Prep, prime, 2 coats on siding/trim', 'sqft', 3.00, 4.50, ARRAY['manual'], 'seed', v_user_id),
    ('Tile', 'Floor or wall tile, mortar bed, grout, caulk, edge trim', 'sqft', 12.00, 18.00, ARRAY['manual'], 'seed', v_user_id),
    ('Hardwood Flooring', 'Solid or engineered hardwood, install and finish', 'sqft', 8.00, 12.00, ARRAY['manual'], 'seed', v_user_id),
    ('LVP / Vinyl Flooring', 'Luxury vinyl plank, supply and install', 'sqft', 4.00, 6.50, ARRAY['manual'], 'seed', v_user_id),
    ('Carpet', 'Mid-grade carpet with pad, supply and install', 'sqft', 3.50, 5.50, ARRAY['manual'], 'seed', v_user_id),
    ('Cabinetry (Kitchen)', 'Mid-grade cabinets, delivery and install', 'linear_ft', 250.00, 350.00, ARRAY['manual'], 'seed', v_user_id),
    ('Cabinetry (Bathroom)', 'Vanity cabinet, delivery and install', 'each', 800.00, 1200.00, ARRAY['manual'], 'seed', v_user_id),
    ('Countertops (Quartz)', 'Quartz slab, fabrication and install', 'sqft', 65.00, 90.00, ARRAY['manual'], 'seed', v_user_id),
    ('Countertops (Granite)', 'Granite slab, fabrication and install', 'sqft', 55.00, 80.00, ARRAY['manual'], 'seed', v_user_id),
    ('Countertops (Laminate)', 'Laminate countertop, fabrication and install', 'sqft', 25.00, 40.00, ARRAY['manual'], 'seed', v_user_id),
    ('Trim & Millwork', 'Baseboard, casing, crown molding — supply and install', 'linear_ft', 5.00, 8.00, ARRAY['manual'], 'seed', v_user_id),
    ('Concrete / Flatwork', '4-inch slab, formed and finished', 'sqft', 8.00, 12.00, ARRAY['manual'], 'seed', v_user_id),
    ('Foundation', 'Poured concrete wall, formed and finished', 'linear_ft', 150.00, 200.00, ARRAY['manual'], 'seed', v_user_id),
    ('Excavation / Sitework', 'Machine excavation, grading, backfill', 'sqft', 3.00, 5.00, ARRAY['manual'], 'seed', v_user_id),
    ('Waterproofing', 'Foundation or shower waterproofing membrane', 'sqft', 4.00, 6.00, ARRAY['manual'], 'seed', v_user_id),
    ('Permits & Engineering', 'Building permit, structural engineering plans', 'lump_sum', 2000.00, 2500.00, ARRAY['manual'], 'seed', v_user_id),
    ('Dumpster / Hauling', 'Per 20-yard dumpster load', 'each', 450.00, 600.00, ARRAY['manual'], 'seed', v_user_id),
    ('Final Cleaning', 'Post-construction detail clean', 'lump_sum', 500.00, 750.00, ARRAY['manual'], 'seed', v_user_id),
    ('Appliances', 'Mid-grade kitchen appliance package, delivery', 'lump_sum', 4000.00, 5000.00, ARRAY['manual'], 'seed', v_user_id),
    ('Temporary Protection', 'Floor protection, dust barriers, HEPA', 'lump_sum', 300.00, 500.00, ARRAY['manual'], 'seed', v_user_id)
  ON CONFLICT (trade_name, unit_type) DO NOTHING;
END $$;
