-- ============================================
-- Penney Construction - Seed Cost Code Categories
-- 22 Residential Construction Categories
-- ============================================

insert into public.cost_code_categories (code, name, description, sort_order) values
  ('01', 'General Conditions', 'Permits, insurance, dumpsters, temp facilities, project management', 1),
  ('02', 'Site Work', 'Excavation, grading, site prep, landscaping repair', 2),
  ('03', 'Concrete & Foundation', 'Footings, slabs, foundation walls, flatwork', 3),
  ('04', 'Masonry', 'Brick, block, stone, veneer', 4),
  ('05', 'Structural Steel & Metals', 'Steel beams, columns, lintels, misc metals', 5),
  ('06', 'Rough Carpentry', 'Framing, sheathing, blocking, subflooring', 6),
  ('07', 'Finish Carpentry & Millwork', 'Trim, molding, built-ins, stairs, railings', 7),
  ('08', 'Roofing', 'Shingles, underlayment, flashing, gutters', 8),
  ('09', 'Exterior', 'Siding, soffit, fascia, exterior trim, wrap', 9),
  ('10', 'Windows & Doors', 'Windows, exterior doors, interior doors, hardware', 10),
  ('11', 'Insulation', 'Batt, blown, spray foam, rigid board', 11),
  ('12', 'Drywall', 'Hanging, taping, finishing, texturing', 12),
  ('13', 'Painting & Finishes', 'Interior paint, exterior paint, stain, wallpaper', 13),
  ('14', 'Flooring', 'Hardwood, tile, carpet, LVP, underlayment', 14),
  ('15', 'Cabinetry & Countertops', 'Kitchen cabinets, bath vanities, countertops', 15),
  ('16', 'Plumbing', 'Rough-in, fixtures, water heater, gas lines', 16),
  ('17', 'HVAC', 'Ductwork, equipment, controls, ventilation', 17),
  ('18', 'Electrical', 'Rough-in, panel, fixtures, low voltage', 18),
  ('19', 'Appliances', 'Kitchen appliances, laundry, specialty', 19),
  ('20', 'Tile & Stone', 'Shower tile, backsplash, floor tile, stone work', 20),
  ('21', 'Specialties', 'Mirrors, shower doors, fireplace, closet systems', 21),
  ('22', 'Cleanup & Punch', 'Construction cleaning, punch list, final detail', 22);
