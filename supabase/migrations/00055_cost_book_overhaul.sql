-- Cost Book Overhaul: Add granular pricing from real Penney Construction project data
-- Sources: 16 project budgets, 147 invoices, 43 quotes, BCE Quote #10325 (April 2026)
-- All sell prices use 30% markup (confirmed via Weidlein + Schenkel BT sheets)

-- 1. Add new columns
ALTER TABLE public.trade_rates ADD COLUMN IF NOT EXISTS min_price numeric(10,2);
ALTER TABLE public.trade_rates ADD COLUMN IF NOT EXISTS max_price numeric(10,2);
ALTER TABLE public.trade_rates ADD COLUMN IF NOT EXISTS trade_category text;
ALTER TABLE public.trade_rates ADD COLUMN IF NOT EXISTS subcategory text;
ALTER TABLE public.trade_rates ADD COLUMN IF NOT EXISTS scope_includes text;

-- 2. Update unique constraint to include subcategory
ALTER TABLE public.trade_rates DROP CONSTRAINT IF EXISTS trade_rates_trade_name_unit_type_project_type_key;
ALTER TABLE public.trade_rates ADD CONSTRAINT trade_rates_name_unit_subcat_projtype_key
  UNIQUE NULLS NOT DISTINCT (trade_name, unit_type, subcategory, project_type);

-- 3. Create indexes for grouped queries
CREATE INDEX IF NOT EXISTS idx_trade_rates_category ON public.trade_rates(trade_category);
CREATE INDEX IF NOT EXISTS idx_trade_rates_cat_subcat ON public.trade_rates(trade_category, subcategory);

-- 4. Deactivate old generic entries (will be replaced by granular ones)
UPDATE public.trade_rates SET is_active = false WHERE is_active = true;

-- 5. Insert real cost book entries
DO $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id FROM auth.users LIMIT 1;

  -- ==================== PLUMBING ====================
  INSERT INTO public.trade_rates (trade_name, trade_category, subcategory, description, unit_type, avg_cost, avg_price, min_cost, max_cost, min_price, max_price, scope_includes, data_sources, last_updated_from, sample_count, created_by) VALUES
  ('Tub-to-Shower Conversion', 'Plumbing', 'Per Room', 'Convert existing tub to shower, minimal drain work', 'each', 1731, 2250, 1385, 2308, 1800, 3000, 'Minimal drain relocation, new shower valve + trim, remove tub, patch. Does NOT include tile.', ARRAY['genzale'], 'seed', 1, v_user_id),
  ('Half Bath Rough & Finish', 'Plumbing', 'Per Room', 'Toilet + lav, new supply/waste, fixtures', 'each', 3462, 4500, 2692, 4385, 3500, 5700, 'New supply + waste lines for toilet and lav, shut-offs, fixture set, testing. Fixtures by owner.', ARRAY['danaher','various'], 'seed', 3, v_user_id),
  ('Full Bath Remodel Plumbing', 'Plumbing', 'Per Room', 'Full rough-in, tub/shower, lav, toilet, heat tie-in', 'each', 5769, 7500, 3800, 7500, 4940, 9750, 'Complete rough-in (supply + waste), tub/shower valve, lav, toilet, baseboard heat tie-in. Fixtures by owner.', ARRAY['weidlein','sutcliffe','danaher'], 'seed', 3, v_user_id),
  ('Kitchen Plumbing Re-rough', 'Plumbing', 'Per Room', 'Re-rough kitchen, move gas pipe, install sink/DW/disposal', 'each', 3173, 4125, 2800, 4231, 3640, 5500, 'Relocate drain, extend supply, gas pipe move, install sink + dishwasher + disposal hookups.', ARRAY['schenkel','burns'], 'seed', 2, v_user_id),
  ('Laundry Hookups', 'Plumbing', 'Per Room', 'Washer hookup, supply + drain', 'each', 923, 1200, 615, 1385, 800, 1800, 'Hot/cold supply, drain with standpipe, shut-offs.', ARRAY['pedersen'], 'seed', 1, v_user_id),
  ('Change 1 Sink to 2', 'Plumbing', 'Modifications', 'Add second sink, extend supply/waste', 'each', 1538, 2000, 1154, 2154, 1500, 2800, 'Extend supply lines, add second drain, shut-offs for second sink.', ARRAY['danaher'], 'seed', 1, v_user_id),
  ('Move Gas Pipe', 'Plumbing', 'Modifications', 'Relocate gas line for new layout', 'each', 923, 1200, 615, 1385, 800, 1800, 'Disconnect, reroute, reconnect gas line. Pressure test.', ARRAY['schenkel'], 'seed', 1, v_user_id),
  ('Kick Space Heater 6000 BTU', 'Plumbing', 'Heating', 'Supply + install kick heater', 'each', 1923, 2500, 1523, 2692, 1980, 3500, 'Furnish and install 6000 BTU kick space heater, piping, controls.', ARRAY['schenkel','disalvo'], 'seed', 2, v_user_id),
  ('Replace Baseboard Heat Section', 'Plumbing', 'Heating', 'Remove old, install new baseboard heat', 'each', 1385, 1800, 923, 1923, 1200, 2500, 'Remove existing baseboard section, install new, bleed and test.', ARRAY['danaher'], 'seed', 1, v_user_id),
  ('50-Gal Electric Water Heater', 'Plumbing', 'Equipment', 'Supply + install, piping', 'each', 1692, 2200, 1308, 2154, 1700, 2800, 'Furnish 50-gal electric HWH, connect supply/waste, electrical by others.', ARRAY['iler'], 'seed', 1, v_user_id),
  ('Ejector Pump', 'Plumbing', 'Equipment', 'Below-grade waste ejection', 'each', 2308, 3000, 1538, 3077, 2000, 4000, 'Furnish and install sewage ejector pump, pit, check valve, discharge piping.', ARRAY['iler'], 'seed', 1, v_user_id),
  ('Entertainment/Bar Sink', 'Plumbing', 'Per Room', 'Supply + waste + fixture', 'each', 1385, 1800, 923, 1923, 1200, 2500, 'Hot/cold supply, waste line, install bar/entertainment sink.', ARRAY['pedersen','iler'], 'seed', 2, v_user_id),
  ('Kitchen + Bath Plumbing w/ Radiant', 'Plumbing', 'Packages', 'Full kitchen + radiant floor heat piping', 'each', 10423, 13550, 7692, 12308, 10000, 16000, 'Complete kitchen plumbing + radiant floor heat tubing/manifold for kitchen area.', ARRAY['burns'], 'seed', 1, v_user_id),
  ('Full House Plumbing (7+ fixtures)', 'Plumbing', 'Packages', 'Kitchen, powder, hall bath, primary bath, ensuite, laundry', 'each', 31769, 41300, 26923, 36923, 35000, 48000, 'All rough-in and finish plumbing for full house. Multiple bathrooms, kitchen, laundry. Fixtures by owner.', ARRAY['pedersen','iler'], 'seed', 2, v_user_id),

  -- ==================== ELECTRICAL ====================
  ('Bathroom Electrical', 'Electrical', 'Per Room', '2 vanity lights, LED shower, GFCI, Panasonic fan', 'each', 4000, 5200, 3615, 4600, 4700, 5980, 'Vanity lights, LED shower light, GFCI outlets, exhaust fan wiring, switches. Fixtures by owner.', ARRAY['danaher','sutcliffe'], 'seed', 2, v_user_id),
  ('Bathroom Electrical (w/ sub panel)', 'Electrical', 'Per Room', 'Bath electrical + 100-amp sub panel or sauna circuit', 'each', 4600, 5980, 4231, 5385, 5500, 7000, 'All bathroom electrical plus 100-amp sub panel install or dedicated sauna circuit.', ARRAY['sutcliffe'], 'seed', 1, v_user_id),
  ('Kitchen Electrical (basic)', 'Electrical', 'Per Room', 'Recessed lights, undercabinet, all kitchen circuits', 'each', 5000, 6500, 3769, 6500, 4900, 8450, '8 recessed lights, undercabinet lighting, all kitchen circuits (DW, disposal, range, fridge, counter).', ARRAY['burns','schenkel'], 'seed', 2, v_user_id),
  ('Kitchen Electrical (w/ sub panel)', 'Electrical', 'Per Room', 'Kitchen electrical + 100-amp sub panel', 'each', 7000, 9100, 6500, 9231, 8450, 12000, 'All kitchen electrical plus 100-amp sub panel for kitchen load.', ARRAY['schenkel'], 'seed', 1, v_user_id),
  ('Kitchen + Family + Dining', 'Electrical', 'Per Room', 'Multiple rooms, all circuits, no service upgrade', 'each', 12000, 15600, 9231, 13846, 12000, 18000, 'Full electrical for kitchen + adjacent rooms. Recessed, switches, outlets to code, all circuits.', ARRAY['disalvo'], 'seed', 1, v_user_id),
  ('Electrical Service Upgrade 200A', 'Electrical', 'Equipment', 'Panel upgrade only, no room wiring', 'each', 4500, 5850, 3846, 5385, 5000, 7000, 'Replace panel with 200-amp service. Meter socket, main breaker, grounding.', ARRAY['disalvo'], 'seed', 1, v_user_id),
  ('Full House Electrical (w/ 200A)', 'Electrical', 'Packages', '200-amp, 40-circuit, full house wiring, HVAC connections', 'each', 25154, 32700, 21538, 37154, 28000, 48300, '200-amp service, 40-circuit panel, complete house wiring, HVAC unit connections, smoke/CO.', ARRAY['iler','peterson'], 'seed', 2, v_user_id),
  ('Addition Electrical', 'Electrical', 'Packages', 'Full rough + finish for addition', 'each', 11154, 14500, 3000, 13846, 3900, 18000, 'Complete electrical for addition space. Outlets, lights, switches, circuits to code.', ARRAY['disalvo','ouellette'], 'seed', 2, v_user_id),
  ('Heated Floor Mat + Circuit', 'Electrical', 'Specialty', 'Electric heated mat, thermostat, 20-amp dedicated circuit', 'each', 1923, 2500, 1523, 3462, 1980, 4500, 'Supply heated mat, thermostat, 20-amp dedicated GFCI circuit. Mat by WarmlyYours or similar.', ARRAY['schenkel','danaher'], 'seed', 2, v_user_id),
  ('Additional Recessed Light', 'Electrical', 'Per Item', 'Per fixture, wired to existing circuit', 'each', 115, 150, 96, 154, 125, 200, 'One 4" LED recessed light, can, trim, wire to existing circuit.', ARRAY['multiple'], 'seed', 5, v_user_id),
  ('Electrical Rough-In (bath scale)', 'Electrical', 'Per Item', '2 outlets, light rough-in, GFCI', 'each', 450, 585, 346, 615, 450, 800, 'Bathroom-scale: 2 GFCI outlets, vanity light rough-in, exhaust fan rough-in.', ARRAY['schenkel'], 'seed', 1, v_user_id),
  ('Electrical Fixtures Install', 'Electrical', 'Per Item', 'Install mirrors, light fixtures, outlets (fixtures by owner)', 'each', 525, 683, 404, 654, 525, 850, 'Install owner-supplied light fixtures, mirrors, accessories.', ARRAY['schenkel'], 'seed', 1, v_user_id),
  ('Exhaust Fan Wiring', 'Electrical', 'Per Item', 'Wire Panasonic or similar, switch', 'each', 346, 450, 231, 462, 300, 600, 'Wire and connect bath exhaust fan, dedicated switch.', ARRAY['multiple'], 'seed', 3, v_user_id),

  -- ==================== FRAMING ====================
  ('Bathroom Framing', 'Framing', 'Per Room', 'Shower walls, blocking, subfloor repair, custom shower pan', 'each', 1692, 2200, 923, 2154, 1200, 2800, 'Frame shower walls, install blocking for fixtures, repair subfloor as needed, shower pan framing.', ARRAY['sutcliffe','weidlein','danaher'], 'seed', 3, v_user_id),
  ('Kitchen Framing', 'Framing', 'Per Room', 'New opening/header, sister joists, blocking', 'each', 2692, 3500, 1231, 3462, 1600, 4500, 'Frame new window opening with LVL header, sister joists under island, blocking for cabinets.', ARRAY['schenkel','burns'], 'seed', 2, v_user_id),
  ('Flush Steel Beam Install', 'Framing', 'Structural', 'Remove load-bearing wall, install steel beam, finish flush', 'each', 11192, 14550, 7385, 13846, 9600, 18000, 'Temp shoring, remove load-bearing wall, install A36 steel beam flush to ceiling, columns, finish.', ARRAY['pedersen','disalvo'], 'seed', 2, v_user_id),
  ('Framing — Addition (labor)', 'Framing', 'Addition', 'Walls, floor, roof, blocking, sheathing — labor only', 'sqft', 38, 50, 31, 46, 40, 60, 'Frame exterior/interior walls, floor system, roof, all blocking, install sheathing. Labor only.', ARRAY['disalvo','ouellette'], 'seed', 2, v_user_id),
  ('Framing — Addition (material)', 'Framing', 'Addition', 'Lumber package for addition', 'sqft', 27, 35, 19, 35, 25, 45, 'Full lumber package: dimensional lumber, LVLs, sheathing (ZIP/CDX/Advantech), hardware, fasteners.', ARRAY['pedersen'], 'seed', 1, v_user_id),
  ('Window Opening / Header', 'Framing', 'Per Item', 'Frame new opening, install LVL header', 'each', 577, 750, 385, 923, 500, 1200, 'Cut opening, install LVL header, jack/king studs, sill plate.', ARRAY['schenkel','multiple'], 'seed', 3, v_user_id),
  ('Subfloor Repair', 'Framing', 'Per Item', 'Sister joists, replace rotted subfloor', 'each', 615, 800, 308, 1154, 400, 1500, 'Sister damaged joists, remove and replace rotted subfloor sections, blocking.', ARRAY['multiple'], 'seed', 4, v_user_id),
  ('Temp Structural Shoring', 'Framing', 'Structural', 'Temporary support during demo/steel work', 'each', 2923, 3800, 1923, 3846, 2500, 5000, 'Install temporary load-bearing walls/posts during demo and beam install. Remove after.', ARRAY['pedersen'], 'seed', 1, v_user_id),
  ('Front Entry / Porch Framing', 'Framing', 'Specialty', 'Covered entry, composite decking, posts', 'each', 9615, 12500, 5000, 11538, 6500, 15000, 'Frame covered entry or porch structure, posts, composite decking substrate, roof tie-in.', ARRAY['iler','pedersen'], 'seed', 2, v_user_id),
  ('Staircase Framing / Rebuild', 'Framing', 'Specialty', 'Kicks, nosings, balusters, railings, structural', 'each', 6104, 7935, 3077, 7692, 4000, 10000, 'Rebuild staircase: new stringers, treads, risers, nosings, balusters, railings.', ARRAY['schenkel'], 'seed', 1, v_user_id),

  -- ==================== DEMOLITION ====================
  ('Bathroom Gut to Stud', 'Demolition', 'Per Room', 'Strip to stud, remove fixtures/tile/plumbing/ceiling', 'each', 1885, 2450, 1154, 2615, 1500, 3400, 'Remove all finishes to stud: tile, fixtures, vanity, toilet, ceiling. Protect adjacent areas.', ARRAY['weidlein','danaher','genzale'], 'seed', 3, v_user_id),
  ('Kitchen Gut', 'Demolition', 'Per Room', 'Cabinets, counters, backsplash, flooring, fixtures, walls', 'each', 2462, 3200, 1769, 3269, 2300, 4250, 'Remove cabinets, countertops, backsplash, flooring, fixtures. Drywall/plaster removal as needed.', ARRAY['schenkel','burns','disalvo'], 'seed', 3, v_user_id),
  ('Full Floor / Area Demo', 'Demolition', 'Full Project', 'Multiple rooms, structural walls, cut slab/roof', 'each', 8308, 10800, 5000, 13846, 6500, 18000, 'Multi-room demo, structural wall removal prep, slab cutting, roof opening.', ARRAY['haley','pedersen','nelligan'], 'seed', 3, v_user_id),
  ('Siding Removal', 'Demolition', 'Exterior', 'Remove existing siding prep for new', 'each', 3846, 5000, 2308, 5769, 3000, 7500, 'Carefully remove existing siding, prep sheathing for new siding install.', ARRAY['pedersen'], 'seed', 1, v_user_id),
  ('Window Removal (per window)', 'Demolition', 'Per Item', 'Remove existing window, prep opening', 'each', 116, 151, 92, 154, 120, 200, 'Remove existing window, clean opening, prep for new install.', ARRAY['haley'], 'seed', 1, v_user_id),
  ('Basement Demo', 'Demolition', 'Per Room', 'Ceiling water damage, carpet removal', 'each', 569, 740, 385, 923, 500, 1200, 'Remove damaged ceiling, carpet, debris. Prep for rebuild.', ARRAY['schenkel'], 'seed', 1, v_user_id),

  -- ==================== DUMPSTER ====================
  ('30-Yard Dumpster (single pull)', 'Dumpster', 'Per Unit', 'Delivery, pickup, disposal', 'each', 923, 1200, 769, 1231, 1000, 1600, 'One 30-yard dumpster: delivery, pickup, disposal fees.', ARRAY['weidlein','danaher','schenkel'], 'seed', 3, v_user_id),
  ('Dumpster Budget (kitchen/bath project)', 'Dumpster', 'Project Budget', 'Multiple pulls for reno project', 'each', 1231, 1600, 1000, 1692, 1300, 2200, 'Budget for dumpster service through kitchen or bathroom renovation.', ARRAY['disalvo','burns'], 'seed', 2, v_user_id),
  ('Dumpster Budget (large project)', 'Dumpster', 'Project Budget', 'Full project hauling, multiple 30-yard pulls', 'each', 2923, 3800, 1923, 4462, 2500, 5800, 'Full project dumpster budget: multiple pulls, debris from demo through construction.', ARRAY['ouellette','pedersen','gallegos'], 'seed', 3, v_user_id),

  -- ==================== INSULATION ====================
  ('Bathroom Insulation', 'Insulation', 'Per Room', 'Exterior walls + soundproofing', 'each', 923, 1200, 462, 1415, 600, 1840, 'Insulate exterior walls R-15/R-21, soundproof interior walls where needed.', ARRAY['weidlein','danaher','genzale'], 'seed', 3, v_user_id),
  ('Kitchen Insulation', 'Insulation', 'Per Room', 'Back wall R-15', 'each', 923, 1200, 462, 1385, 600, 1800, 'Insulate exposed exterior wall sections R-15.', ARRAY['schenkel','burns'], 'seed', 2, v_user_id),
  ('Addition Insulation (spray foam)', 'Insulation', 'Full Project', 'Exterior walls + ceiling + floor spray foam', 'each', 9231, 12000, 4308, 18385, 5600, 23900, 'Complete spray foam package for addition: walls, ceiling/roof, floor. Includes HERS if required.', ARRAY['disalvo','ouellette','pedersen'], 'seed', 3, v_user_id),
  ('Hybrid Insulation Package', 'Insulation', 'Full Project', 'Spray foam roof R-49 + mineral wool walls + closed cell', 'each', 6308, 8200, 6308, 12308, 8200, 16000, 'Hybrid package: spray foam roof deck R-49, mineral wool exterior walls, closed cell at band joist.', ARRAY['iler'], 'seed', 1, v_user_id),
  ('Firestopping', 'Insulation', 'Per Item', 'Penetrations, code-required', 'each', 923, 1200, 462, 1538, 600, 2000, 'Firestopping at all penetrations per code. Sealant, putty pads, collars.', ARRAY['multiple'], 'seed', 3, v_user_id),

  -- ==================== TILE ====================
  ('Bathroom Tile (floor + shower)', 'Tile', 'Per Room', 'Floor tile, shower floor, shower walls, waterproof', 'each', 2831, 3680, 1308, 3962, 1700, 5150, 'Tile labor: floor, shower floor, shower walls. Includes waterproofing (Kerdi or similar). Tile by owner.', ARRAY['weidlein','genzale','danaher'], 'seed', 3, v_user_id),
  ('Kitchen Backsplash', 'Tile', 'Per Room', 'Tile labor, client supplies tile', 'each', 1346, 1750, 1000, 1769, 1300, 2300, 'Backsplash tile installation. Tile material supplied by owner.', ARRAY['schenkel','pedersen','burns'], 'seed', 3, v_user_id),
  ('Per-Room Tile (Pedersen scale)', 'Tile', 'Per Room', 'Powder room $1K, common/ensuite $2,900, primary $3,900', 'each', 2231, 2900, 769, 3000, 1000, 3900, 'Single room tile package. Price varies by room size and complexity.', ARRAY['pedersen'], 'seed', 1, v_user_id),
  ('Mudroom Tile', 'Tile', 'Per Room', 'Floor tile, labor', 'each', 2231, 2900, 1538, 2808, 2000, 3650, 'Mudroom floor tile installation. Tile by owner.', ARRAY['pedersen','iler'], 'seed', 2, v_user_id),

  -- ==================== BLUEBOARD & PLASTER ====================
  ('Blueboard & Plaster — Bathroom', 'Plaster', 'Per Room', 'Master bathroom walls/ceiling', 'each', 1385, 1800, 923, 2000, 1200, 2600, 'Blueboard hang and 2-coat plaster finish on bathroom walls and ceiling.', ARRAY['genzale','weidlein','danaher'], 'seed', 3, v_user_id),
  ('Blueboard & Plaster — Kitchen', 'Plaster', 'Per Room', '3 walls + smooth ceiling', 'each', 2308, 3000, 1923, 2962, 2500, 3850, 'Blueboard and plaster on kitchen walls (typically 3 walls) + smooth ceiling.', ARRAY['schenkel','burns'], 'seed', 2, v_user_id),
  ('Blueboard & Plaster — Kitchen + Addition', 'Plaster', 'Full Project', 'Patch existing + full addition walls/ceiling', 'each', 8846, 11500, 6615, 10769, 8600, 14000, 'Patch existing plaster at tie-in points + full new blueboard/plaster in addition.', ARRAY['disalvo','ouellette'], 'seed', 2, v_user_id),
  ('Blueboard & Plaster — Full House', 'Plaster', 'Full Project', 'All renovated areas', 'each', 16923, 22000, 10385, 22192, 13500, 28850, 'Complete blueboard and plaster throughout all renovated areas.', ARRAY['iler','nelligan','pedersen'], 'seed', 3, v_user_id),

  -- ==================== PAINTING ====================
  ('Painting — Single Bathroom', 'Painting', 'Per Room', 'Walls, ceiling, trim', 'each', 1154, 1500, 1000, 1385, 1300, 1800, 'Prime and paint: walls, ceiling, trim, door. Prep and patch included.', ARRAY['genzale','sutcliffe','danaher'], 'seed', 3, v_user_id),
  ('Painting — Kitchen + Hall', 'Painting', 'Per Room', 'Kitchen, hallway, patching', 'each', 1692, 2200, 1385, 2500, 1800, 3250, 'Prime and paint kitchen + hallway: walls, ceiling, trim. Patch/prep included.', ARRAY['schenkel','burns'], 'seed', 2, v_user_id),
  ('Painting — Kitchen + Multiple Rooms', 'Painting', 'Multi-Room', 'Kitchen/dining/family or larger scope', 'each', 5462, 7100, 3231, 6538, 4200, 8500, 'Multiple rooms: kitchen, dining, family. Walls, ceilings, trim throughout.', ARRAY['friedman','disalvo','ouellette'], 'seed', 3, v_user_id),
  ('Painting — Full House Interior', 'Painting', 'Full Project', 'Walls, ceilings, trim, doors, all rooms', 'each', 15231, 19800, 9615, 18308, 12500, 23800, 'Complete interior paint package: all walls, ceilings, trim, doors, closets.', ARRAY['nelligan','pedersen','peterson'], 'seed', 3, v_user_id),
  ('Painting — Exterior', 'Painting', 'Exterior', 'Siding + trim', 'each', 7692, 10000, 6154, 9615, 8000, 12500, 'Exterior paint: siding, trim, soffits, fascia. Prep, prime, 2 coats.', ARRAY['nelligan'], 'seed', 1, v_user_id),

  -- ==================== FINISH CARPENTRY ====================
  ('Finish Carpentry — Bathroom (basic)', 'Finish Carpentry', 'Per Room', 'Door, baseboard, vanity install, accessories', 'each', 1385, 1800, 758, 2054, 985, 2670, 'Hang door, install baseboard, set vanity, install accessories (towel bar, TP holder, etc.).', ARRAY['disalvo','weidlein','danaher'], 'seed', 3, v_user_id),
  ('Finish Carpentry — Kitchen', 'Finish Carpentry', 'Per Room', 'Baseboard, window/door trim', 'each', 1423, 1850, 769, 2654, 1000, 3450, 'Baseboard, window trim, door casing throughout kitchen.', ARRAY['schenkel','burns'], 'seed', 2, v_user_id),
  ('Interior Door (supply + hang)', 'Finish Carpentry', 'Per Item', 'Per pre-hung door, installed', 'each', 462, 600, 385, 577, 500, 750, 'Supply and install one pre-hung interior door with casing both sides.', ARRAY['pedersen'], 'seed', 1, v_user_id),
  ('Finish Carpentry — Full House', 'Finish Carpentry', 'Full Project', 'Baseboard/trim, doors, casings, built-ins, closets', 'each', 15923, 20700, 5769, 36577, 7500, 47550, 'Complete finish carpentry: all baseboard, door/window casing, doors, built-ins, closets.', ARRAY['ouellette','iler','peterson'], 'seed', 3, v_user_id),
  ('Exterior AZEK Trim', 'Finish Carpentry', 'Exterior', 'Fascia, soffits, corners, beadboard', 'each', 14346, 18650, 7308, 19231, 9500, 25000, 'PVC exterior trim package: fascia, soffits, corner boards, beadboard panels.', ARRAY['disalvo','pedersen'], 'seed', 2, v_user_id),
  ('Built-Ins (closets/pantry/office)', 'Finish Carpentry', 'Specialty', 'Custom shelving, built-in storage', 'each', 2000, 2600, 1192, 3462, 1550, 4500, 'Custom built-in storage: shelving, adjustable shelves, rods, dividers.', ARRAY['pedersen'], 'seed', 4, v_user_id),

  -- ==================== CONCRETE ====================
  ('Foundation Wall', 'Concrete', 'Per Unit', 'Footings + foundation wall', 'linear_ft', 185, 240, 154, 231, 200, 300, 'Footings and poured foundation wall. Includes forming, rebar, pour, strip.', ARRAY['pedersen','ouellette'], 'seed', 2, v_user_id),
  ('4" Slab on Grade', 'Concrete', 'Per Unit', 'Slab pour, finish', 'sqft', 12, 15, 8, 14, 10, 18, '4" concrete slab: gravel base, vapor barrier, wire mesh, pour, finish.', ARRAY['ouellette','pedersen'], 'seed', 2, v_user_id),
  ('Concrete Cutting (door opening)', 'Concrete', 'Per Item', 'Cut new opening in existing foundation', 'each', 4000, 5200, 1538, 5385, 2000, 7000, 'Saw-cut new door opening in existing concrete/block foundation.', ARRAY['pedersen','iler'], 'seed', 2, v_user_id),
  ('Foundation Tie-In', 'Concrete', 'Per Item', 'Dowel to existing, beam pocket', 'each', 2692, 3500, 1923, 3846, 2500, 5000, 'Dowel new foundation to existing. Includes beam pocket, epoxy anchors.', ARRAY['ouellette'], 'seed', 1, v_user_id),
  ('Crawlspace Foundation Package', 'Concrete', 'Packages', 'Footings + frost wall + slab + entries', 'each', 23077, 30000, 11538, 32731, 15000, 42550, 'Complete foundation: footings, frost walls, interior footings, slab, entry stairs.', ARRAY['disalvo','pedersen','peterson'], 'seed', 3, v_user_id),

  -- ==================== HVAC ====================
  ('Furnace + Condenser (per system)', 'HVAC', 'Equipment', '70k BTU furnace + 3-ton condenser + ductwork', 'each', 16454, 21390, 11538, 21538, 15000, 28000, 'One complete HVAC system: furnace, condenser, refrigerant lines, ductwork, controls.', ARRAY['iler'], 'seed', 1, v_user_id),
  ('Full House HVAC Allowance', 'HVAC', 'Packages', 'Ducted unit(s) + exhaust', 'each', 25054, 32570, 15385, 33615, 20000, 43700, 'Complete HVAC for house: ducted heating/cooling, bathroom exhaust, kitchen hood duct.', ARRAY['nelligan','peterson','pedersen'], 'seed', 3, v_user_id),
  ('HVAC — Extend to Addition', 'HVAC', 'Per Room', 'Extend existing system, new runs', 'each', 9615, 12500, 4692, 13846, 6100, 18000, 'Extend existing HVAC to addition: new ductwork, registers, return air, balance.', ARRAY['essex_county','ouellette'], 'seed', 2, v_user_id),
  ('Bathroom / Kitchen Exhaust', 'HVAC', 'Per Item', 'Ductwork, fan wiring, patch', 'each', 654, 850, 462, 923, 600, 1200, 'Install exhaust duct run, connect to fan, exterior termination, patch.', ARRAY['disalvo','genzale'], 'seed', 2, v_user_id),

  -- ==================== FLOORING ====================
  ('LVP Flooring', 'Flooring', 'Per SF', 'Material $4.50-5/sf + labor $3.50-4/sf + underlayment', 'sqft', 6.54, 8.50, 6.15, 8.35, 8.00, 10.86, 'Furnish and install LVP: material, underlayment, transitions, labor.', ARRAY['schenkel','gouthro','iler'], 'seed', 3, v_user_id),
  ('New Red Oak Hardwood', 'Flooring', 'Per SF', 'Supply + install new hardwood', 'sqft', 11.92, 15.50, 10.00, 13.85, 13.00, 18.00, 'Supply and install new red oak hardwood: acclimate, install, sand, stain, 3 coats poly.', ARRAY['disalvo','nelligan'], 'seed', 2, v_user_id),
  ('Sand / Stain / Poly Existing', 'Flooring', 'Per SF', 'Sand, stain, 3 coats oil poly', 'sqft', 3.00, 3.90, 2.54, 4.00, 3.30, 5.20, 'Sand existing hardwood, apply stain, 3 coats oil-based polyurethane.', ARRAY['iler','burns'], 'seed', 2, v_user_id),
  ('Poly Staircase', 'Flooring', 'Per Item', 'Sand + 3 coats poly on staircase', 'each', 500, 650, 385, 692, 500, 900, 'Sand staircase treads/risers, apply 3 coats polyurethane.', ARRAY['schenkel'], 'seed', 1, v_user_id),
  ('Basement Floor (level/stain)', 'Flooring', 'Per Room', 'Level, skim, stain slab', 'each', 5000, 6500, 3077, 6538, 4000, 8500, 'Level low spots, skim coat, acid stain and seal concrete slab.', ARRAY['marcio','merluzzi'], 'seed', 2, v_user_id),

  -- ==================== CABINETS & COUNTERTOPS ====================
  ('Kitchen Cabinet Install (labor)', 'Cabinets', 'Per Room', 'Install owner-supplied cabinets, level, plumb, fillers', 'each', 4000, 5200, 3231, 4923, 4200, 6400, 'Install owner-supplied cabinets: level, plumb, shim, fasten, fillers, end panels.', ARRAY['schenkel','burns'], 'seed', 2, v_user_id),
  ('Kitchen + Bath Install (full)', 'Cabinets', 'Packages', 'Kitchen 28LF + bath, all labor', 'each', 13846, 18000, 11442, 21346, 14875, 27750, 'Full cabinet install package: kitchen (28+ LF) and bathroom vanities. Level, plumb, hardware.', ARRAY['pedersen','peterson'], 'seed', 2, v_user_id),
  ('Countertop Allowance', 'Cabinets', 'Material', 'Fabrication + install, material varies', 'each', 3077, 4000, 1369, 9231, 1780, 12000, 'Countertop fabrication and installation. Quartz/granite/laminate per owner selection.', ARRAY['burns','nelligan'], 'seed', 2, v_user_id),
  ('Appliance Install', 'Cabinets', 'Per Item', 'Set-in-place, connections to existing rough', 'each', 923, 1200, 385, 1385, 500, 1800, 'Set appliances in place, connect to existing rough (water, gas, electric). Owner supplies appliances.', ARRAY['schenkel','disalvo','burns'], 'seed', 3, v_user_id),

  -- ==================== WINDOWS & DOORS ====================
  ('Window Supply (Harvey vinyl)', 'Windows & Doors', 'Material', 'Standard DH vinyl window', 'each', 692, 900, 462, 1173, 600, 1525, 'Harvey Classic or similar double-hung vinyl window. Price varies by size.', ARRAY['disalvo','pedersen','haley'], 'seed', 3, v_user_id),
  ('Window Install Labor', 'Windows & Doors', 'Labor', 'Remove old, install new, seal, insulate', 'each', 346, 450, 269, 412, 350, 535, 'Remove existing window, install new, foam seal, flash, insulate jambs.', ARRAY['haley','pedersen'], 'seed', 2, v_user_id),
  ('Window Trim (per window)', 'Windows & Doors', 'Labor', 'Interior + exterior trim', 'each', 143, 186, 115, 192, 150, 250, 'Install interior casing and exterior trim around one window.', ARRAY['haley'], 'seed', 1, v_user_id),
  ('Exterior Door (supply + install)', 'Windows & Doors', 'Material', 'Therma-Tru or similar, hardware, weatherstrip', 'each', 1154, 1500, 846, 1923, 1100, 2500, 'Supply and install one exterior door: Therma-Tru fiberglass, hardware, weatherstrip.', ARRAY['pedersen'], 'seed', 1, v_user_id),
  ('Shower Door (glass)', 'Windows & Doors', 'Specialty', 'Glass door + fixed panels, hardware', 'each', 3000, 3900, 2462, 3846, 3200, 5000, 'Custom glass shower enclosure: door + fixed panel(s), chrome or brushed nickel hardware.', ARRAY['gallegos','sutcliffe','pedersen'], 'seed', 3, v_user_id),

  -- ==================== ROOFING & SIDING ====================
  ('Roofing (new shingles)', 'Roofing', 'Per SF', 'Underlayment, flashing, shingles, complete', 'sqft', 6.54, 8.50, 5.38, 8.46, 7.00, 11.00, 'Complete roof: underlayment, ice & water shield, flashing, GAF/CertainTeed shingles, ridge vent.', ARRAY['gallegos','disalvo','pedersen'], 'seed', 3, v_user_id),
  ('Siding (Cedar Impressions)', 'Roofing', 'Per SF', 'Supply + install, weather barrier', 'sqft', 11.54, 15.00, 9.23, 13.85, 12.00, 18.00, 'Cedar Impressions vinyl shingle siding: housewrap, J-channel, starter, corners, install.', ARRAY['pedersen'], 'seed', 1, v_user_id),
  ('Siding (vinyl match existing)', 'Roofing', 'Lump Sum', 'Match existing, addition areas', 'each', 6538, 8500, 2831, 9615, 3680, 12500, 'Match and install vinyl siding on addition or repaired areas.', ARRAY['disalvo','ouellette'], 'seed', 2, v_user_id),
  ('Gutters & Downspouts', 'Roofing', 'Full Project', 'Seamless aluminum gutters, full project', 'each', 2308, 3000, 1538, 2923, 2000, 3800, 'Seamless aluminum gutters and downspouts, full project scope.', ARRAY['nelligan','pedersen'], 'seed', 2, v_user_id),

  -- ==================== ADMIN & GENERAL ====================
  ('Admin & Permits (bathroom)', 'Admin', 'Per Project', 'Permits, scheduling, coordination', 'each', 1615, 2100, 1192, 2077, 1550, 2700, 'Building/plumbing/electrical permits, scheduling, coordination, inspections.', ARRAY['genzale','cleary','weidlein'], 'seed', 3, v_user_id),
  ('Admin & Permits (kitchen)', 'Admin', 'Per Project', 'Permits, scheduling, coordination, inspections', 'each', 2154, 2800, 1385, 2500, 1800, 3250, 'All permits, project scheduling, trade coordination, inspections.', ARRAY['schenkel','burns','disalvo'], 'seed', 3, v_user_id),
  ('Admin & Permits (large project)', 'Admin', 'Per Project', 'Full project management, all permits', 'each', 5231, 6800, 4769, 13846, 6200, 18000, 'Complete project management: all permits, scheduling, trade coordination, daily oversight.', ARRAY['iler','pedersen','nelligan'], 'seed', 3, v_user_id),
  ('Protection (dust/floor/weather)', 'Admin', 'Per Project', 'Zip walls, ramboard, plastic sheeting', 'each', 1077, 1400, 462, 3077, 600, 4000, 'Zip wall dust barriers, Ramboard floor protection, plastic sheeting, cleanup.', ARRAY['danaher','disalvo','nelligan'], 'seed', 3, v_user_id),
  ('Jiffy Jon (portable restroom)', 'Admin', 'Monthly', 'Monthly portable restroom rental', 'each', 308, 400, 258, 385, 335, 500, 'Monthly rental of portable restroom for job site.', ARRAY['weidlein','schenkel'], 'seed', 2, v_user_id),
  ('Final Cleaning', 'Admin', 'Per Project', 'End-of-project clean', 'each', 1154, 1500, 346, 1923, 450, 2500, 'End-of-project cleaning: dust, debris, windows, fixtures, floors.', ARRAY['iler','ouellette','nelligan'], 'seed', 3, v_user_id);

  -- ==================== MATERIALS — LUMBER (BCE Quote #10325, April 2026) ====================
  INSERT INTO public.trade_rates (trade_name, trade_category, subcategory, unit_type, avg_cost, avg_price, scope_includes, data_sources, last_updated_from, sample_count, created_by) VALUES
  ('2x4x8 Spruce Premium', 'Materials — Lumber', 'Dimensional', 'each', 4.56, 5.93, 'Per board. Building Center of Essex pricing April 2026.', ARRAY['bce_quote_10325'], 'seed', 1, v_user_id),
  ('2x4x12 Spruce', 'Materials — Lumber', 'Dimensional', 'each', 7.21, 9.37, NULL, ARRAY['bce_quote_10325'], 'seed', 1, v_user_id),
  ('2x4x16 Spruce', 'Materials — Lumber', 'Dimensional', 'each', 9.47, 12.31, NULL, ARRAY['bce_quote_10325'], 'seed', 1, v_user_id),
  ('2x6x8 Spruce Premium', 'Materials — Lumber', 'Dimensional', 'each', 7.16, 9.31, NULL, ARRAY['bce_quote_10325'], 'seed', 1, v_user_id),
  ('2x6x12 Spruce', 'Materials — Lumber', 'Dimensional', 'each', 10.96, 14.25, NULL, ARRAY['bce_quote_10325'], 'seed', 1, v_user_id),
  ('2x6x16 Spruce', 'Materials — Lumber', 'Dimensional', 'each', 14.83, 19.28, NULL, ARRAY['bce_quote_10325'], 'seed', 1, v_user_id),
  ('2x8x12 Spruce', 'Materials — Lumber', 'Dimensional', 'each', 15.89, 20.66, NULL, ARRAY['bce_quote_10325'], 'seed', 1, v_user_id),
  ('2x8x16 Spruce', 'Materials — Lumber', 'Dimensional', 'each', 21.92, 28.50, NULL, ARRAY['bce_quote_10325'], 'seed', 1, v_user_id),
  ('2x10x12 Spruce', 'Materials — Lumber', 'Dimensional', 'each', 19.86, 25.82, NULL, ARRAY['bce_quote_10325'], 'seed', 1, v_user_id),
  ('2x10x16 Spruce', 'Materials — Lumber', 'Dimensional', 'each', 26.13, 33.97, NULL, ARRAY['bce_quote_10325'], 'seed', 1, v_user_id),
  ('2x10x20 Spruce', 'Materials — Lumber', 'Dimensional', 'each', 33.33, 43.33, NULL, ARRAY['bce_quote_10325'], 'seed', 1, v_user_id),
  ('2x12x12 Spruce', 'Materials — Lumber', 'Dimensional', 'each', 30.41, 39.53, NULL, ARRAY['bce_quote_10325'], 'seed', 1, v_user_id),
  ('2x12x16 Spruce', 'Materials — Lumber', 'Dimensional', 'each', 41.08, 53.40, NULL, ARRAY['bce_quote_10325'], 'seed', 1, v_user_id),
  ('2x12x20 Spruce', 'Materials — Lumber', 'Dimensional', 'each', 66.22, 86.09, NULL, ARRAY['bce_quote_10325'], 'seed', 1, v_user_id),
  ('1-3/4x7-1/4x12 LVL', 'Materials — Lumber', 'Engineered', 'each', 79.44, 103.27, NULL, ARRAY['bce_quote_10325'], 'seed', 1, v_user_id),
  ('1-3/4x9-1/2x24 LVL', 'Materials — Lumber', 'Engineered', 'each', 195.88, 254.64, NULL, ARRAY['bce_quote_10325'], 'seed', 1, v_user_id),
  ('1-3/4x11-7/8x24 LVL', 'Materials — Lumber', 'Engineered', 'each', 241.09, 313.42, NULL, ARRAY['bce_quote_10325'], 'seed', 1, v_user_id),
  ('1-3/4x14x24 LVL', 'Materials — Lumber', 'Engineered', 'each', 315.06, 409.58, NULL, ARRAY['bce_quote_10325'], 'seed', 1, v_user_id),

  -- Sheathing
  ('7/16 ZIP Wall 4x8', 'Materials — Sheathing', 'Wall', 'each', 32.63, 42.42, 'Per sheet.', ARRAY['bce_quote_10325'], 'seed', 1, v_user_id),
  ('1/2 ZIP Wall 4x8', 'Materials — Sheathing', 'Wall', 'each', 36.21, 47.07, NULL, ARRAY['bce_quote_10325'], 'seed', 1, v_user_id),
  ('5/8 ZIP Roof 4x8', 'Materials — Sheathing', 'Roof', 'each', 43.50, 56.55, NULL, ARRAY['bce_quote_10325'], 'seed', 1, v_user_id),
  ('Advantech T&G Subfloor 4x8', 'Materials — Sheathing', 'Floor', 'each', 48.83, 63.48, NULL, ARRAY['bce_quote_10325'], 'seed', 1, v_user_id),
  ('3/8 CDX Fir 4x8', 'Materials — Sheathing', 'General', 'each', 23.78, 30.91, NULL, ARRAY['bce_quote_10325'], 'seed', 1, v_user_id),
  ('1/2 CDX Fir 4x8', 'Materials — Sheathing', 'General', 'each', 28.84, 37.49, NULL, ARRAY['bce_quote_10325'], 'seed', 1, v_user_id),
  ('5/8 CDX 4x8', 'Materials — Sheathing', 'General', 'each', 35.79, 46.53, NULL, ARRAY['bce_quote_10325'], 'seed', 1, v_user_id),

  -- PVC Trim
  ('1x4x18 PVC Trim', 'Materials — Trim', 'PVC', 'each', 41.42, 53.85, 'Per 18'' board.', ARRAY['bce_quote_10325'], 'seed', 1, v_user_id),
  ('1x6x18 PVC Trim', 'Materials — Trim', 'PVC', 'each', 68.56, 89.13, NULL, ARRAY['bce_quote_10325'], 'seed', 1, v_user_id),
  ('1x8x18 PVC Trim', 'Materials — Trim', 'PVC', 'each', 89.29, 116.08, NULL, ARRAY['bce_quote_10325'], 'seed', 1, v_user_id),
  ('1x10x18 PVC Trim', 'Materials — Trim', 'PVC', 'each', 109.13, 141.87, NULL, ARRAY['bce_quote_10325'], 'seed', 1, v_user_id),
  ('1x12x18 PVC Trim', 'Materials — Trim', 'PVC', 'each', 138.56, 180.13, NULL, ARRAY['bce_quote_10325'], 'seed', 1, v_user_id),
  ('PVC Beadboard T&G 1x6x18', 'Materials — Trim', 'PVC', 'each', 96.43, 125.36, NULL, ARRAY['bce_quote_10325'], 'seed', 1, v_user_id),
  ('PVC Premade Corner 1x6x20', 'Materials — Trim', 'PVC', 'each', 257.13, 334.27, NULL, ARRAY['bce_quote_10325'], 'seed', 1, v_user_id),

  -- Primed FJ Pine Trim
  ('1x4x16 Primed FJ Pine', 'Materials — Trim', 'Interior', 'each', 22.44, 29.17, NULL, ARRAY['bce_quote_10325'], 'seed', 1, v_user_id),
  ('1x6x16 Primed FJ Pine', 'Materials — Trim', 'Interior', 'each', 34.48, 44.82, NULL, ARRAY['bce_quote_10325'], 'seed', 1, v_user_id),
  ('1x8x16 Primed FJ Pine', 'Materials — Trim', 'Interior', 'each', 47.48, 61.72, NULL, ARRAY['bce_quote_10325'], 'seed', 1, v_user_id),

  -- Decking
  ('Trex Select 1x5.5x16 Grooved', 'Materials — Decking', 'Composite', 'each', 85.04, 110.55, 'Pebble Grey. Per board.', ARRAY['bce_quote_10325'], 'seed', 1, v_user_id),
  ('Azek Harvest 1x5.5x16', 'Materials — Decking', 'PVC', 'each', 89.86, 116.82, 'Slate Gray square edge. Per board.', ARRAY['bce_quote_10325'], 'seed', 1, v_user_id),
  ('5/4x6 Mahogany Decking', 'Materials — Decking', 'Hardwood', 'linear_ft', 4.39, 5.71, 'Red Balau/Batu. Per LF.', ARRAY['bce_quote_10325'], 'seed', 1, v_user_id),

  -- Siding Materials
  ('EWC Sidewall Select Cape Cod Gray (per SQ)', 'Materials — Siding', 'Cedar Shingle', 'each', 665.80, 865.54, '4 bundles per SQ at 5" exposure. R&R SBC 1-coat gray.', ARRAY['bce_quote_10325'], 'seed', 1, v_user_id),
  ('Red Cedar 18" R&R Primed (per box)', 'Materials — Siding', 'Cedar Shingle', 'each', 570.00, 741.00, '~50SF at 7" exp, ~42SF at 6" exp, ~36SF at 5" exp.', ARRAY['bce_quote_10325'], 'seed', 1, v_user_id),
  ('WRC Raw 1/2x6 Clapboards', 'Materials — Siding', 'Clapboard', 'linear_ft', 3.52, 4.58, 'Western Red Cedar raw clapboards. Per LF.', ARRAY['bce_quote_10325'], 'seed', 1, v_user_id),
  ('HydroGap Drainable Wrap 5x100 (5SQ)', 'Materials — Siding', 'Housewrap', 'each', 178.05, 231.47, '500 SF roll drainable housewrap.', ARRAY['bce_quote_10325'], 'seed', 1, v_user_id),
  ('Tyvek 9x100 Homewrap (9SQ)', 'Materials — Siding', 'Housewrap', 'each', 171.10, 222.43, '900 SF roll.', ARRAY['bce_quote_10325'], 'seed', 1, v_user_id),

  -- PT Lumber
  ('2x4x8 PT #1 GC', 'Materials — Lumber', 'Pressure Treated', 'each', 8.09, 10.52, NULL, ARRAY['bce_quote_10325'], 'seed', 1, v_user_id),
  ('2x4x12 PT #1 GC', 'Materials — Lumber', 'Pressure Treated', 'each', 10.26, 13.34, NULL, ARRAY['bce_quote_10325'], 'seed', 1, v_user_id),
  ('2x6x12 PT #1 GC', 'Materials — Lumber', 'Pressure Treated', 'each', 13.59, 17.67, NULL, ARRAY['bce_quote_10325'], 'seed', 1, v_user_id),
  ('2x8x12 PT #1 GC', 'Materials — Lumber', 'Pressure Treated', 'each', 18.70, 24.31, NULL, ARRAY['bce_quote_10325'], 'seed', 1, v_user_id),
  ('2x10x12 PT #1 GC', 'Materials — Lumber', 'Pressure Treated', 'each', 25.14, 32.68, NULL, ARRAY['bce_quote_10325'], 'seed', 1, v_user_id),
  ('2x12x12 PT #1 GC', 'Materials — Lumber', 'Pressure Treated', 'each', 27.46, 35.70, NULL, ARRAY['bce_quote_10325'], 'seed', 1, v_user_id),
  ('5/4x6x12 PT Premium', 'Materials — Lumber', 'Pressure Treated', 'each', 13.63, 17.72, 'Decking grade PT.', ARRAY['bce_quote_10325'], 'seed', 1, v_user_id);

END $$;
