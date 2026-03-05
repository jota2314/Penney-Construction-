-- ============================================================
-- 00015: Seed Subcontractors List
-- ============================================================

-- Temp variable for created_by — will be set to the first profile
DO $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id FROM public.profiles ORDER BY created_at LIMIT 1;

  INSERT INTO public.subcontractors (company_name, contact_name, email, phone, address, city, state, zip, trades, license_number, notes, is_active, created_by)
  VALUES
    ('Gustavo Oliveira', 'Gustavo Oliveira', NULL, '978-294-3329', NULL, NULL, NULL, NULL,
     ARRAY['Insulation'],
     NULL, 'Insulation contractor; available for new projects; call/text for pricing', true, v_user_id),

    ('M. Carpenters', 'Lenin Monroy', 'm.mcarpenters504@gmail.com', '857-540-6838', NULL, NULL, NULL, NULL,
     ARRAY['Carpentry'],
     NULL, 'Wants to quote/collaborate', true, v_user_id),

    ('M&M Constructions', 'Marcelo Antenor', NULL, '203-617-7845', NULL, NULL, NULL, NULL,
     ARRAY['Framing', 'Finish Carpentry', 'Basement Finishing', 'Doors', 'Stairs', 'Flooring', 'Remodeling'],
     NULL, NULL, true, v_user_id),

    ('Boston Paint & Power', 'Daniel', NULL, '617-283-3617', NULL, NULL, NULL, NULL,
     ARRAY['Interior Painting', 'Exterior Painting', 'Drywall Repair', 'Plaster Repair', 'Blueboard Repair', 'Finish Carpentry', 'Power Washing', 'Residential Remodeling'],
     NULL, 'Shared via Andrea Muldoon', true, v_user_id),

    ('Topcrete Designs', 'Ryan Devoe', 'ryan@topcretedesigns.com', NULL, NULL, NULL, NULL, NULL,
     ARRAY['Concrete', 'Site Work', 'Foundations', 'Flatwork', 'Epoxy Flooring'],
     NULL, 'Asked to send jobs for bidding', true, v_user_id),

    ('Vokey Construction', NULL, NULL, '360-890-7648', NULL, 'Milford', 'MA', '01757',
     ARRAY['Excavation', 'Site Prep', 'Retaining Walls', 'Patio Construction', 'Grading & Drainage', 'Hardscapes', 'Demolition'],
     NULL, 'Mon–Sun 05:00 AM–08:00 PM; 1-year labor warranty', true, v_user_id),

    ('Jovel Inc.', 'Franklin', 'franklin@jovelinc.com', '781-350-8304', NULL, NULL, NULL, NULL,
     ARRAY['Plumbing', 'HVAC', 'Electrical'],
     NULL, NULL, true, v_user_id),

    ('Maldonado''s Construction Services Inc', 'Gordin Maldonado Rd', NULL, '781-632-3821', NULL, NULL, NULL, NULL,
     ARRAY['Framing', 'Finish Carpentry', 'Metal Work', 'Facades', 'Waterproofing', 'General Construction'],
     NULL, 'Commercial & residential; in business ~7 years', true, v_user_id),

    ('R&V Tile Installation LLC', NULL, 'rvtileinstallation@gmail.com', '774-498-9772', NULL, NULL, NULL, NULL,
     ARRAY['Tile Installation', 'Bathroom Updates', 'Kitchen Updates'],
     NULL, 'Fully insured; free estimates', true, v_user_id),

    ('Felipe Andrade', 'Felipe Andrade', NULL, '774-737-8442', NULL, NULL, NULL, NULL,
     ARRAY['Interior Finish Carpentry', 'Siding', 'Decks'],
     NULL, '10+ years experience', true, v_user_id),

    ('Ben Tucci', 'Ben Tucci', NULL, '978-408-1330', NULL, NULL, NULL, NULL,
     ARRAY['Plumbing', 'Heating', 'Rough Plumbing'],
     NULL, 'Smaller company; specializes in high-end custom builds/remodels', true, v_user_id),

    ('Michael A. Farino Electric', 'Michael A. Farino', 'info@farinoelectric.com', '978-420-6134', NULL, NULL, NULL, NULL,
     ARRAY['Electrical'],
     'MA#12955; NH#16133', 'Free estimates; insured', true, v_user_id),

    ('TCO Inc', NULL, 'tcoexteriors@gmail.com', '857-891-6658', NULL, NULL, NULL, NULL,
     ARRAY['Siding', 'Gutters', 'Windows', 'Doors', 'Roofing'],
     NULL, 'Second number: 321-389-3734', true, v_user_id),

    ('Inline', 'Guilherme Abrantes', NULL, '857-312-8432', NULL, 'Everett', 'MA', NULL,
     ARRAY[]::text[],
     NULL, 'Trade not provided yet; asked for specialty + email', true, v_user_id),

    ('Northern Electrical Services', 'Josh DaSilva', 'Northern.ElectricalMA@gmail.com', '978-804-4625', NULL, NULL, NULL, NULL,
     ARRAY['Electrical'],
     'MA Lic.#23012A; NH Lic.#16155; ME Lic.#MS60022832; VT Lic.#EM-08498', 'Residential & commercial; free estimates; fully licensed & insured; 24-hour services', true, v_user_id),

    ('Lester HVAC LLC', NULL, 'lestermvac28@gmail.com', '781-970-2774', NULL, NULL, NULL, NULL,
     ARRAY['HVAC', 'Heating', 'Ventilation', 'Air Conditioning', 'Refrigeration'],
     NULL, 'North of Boston + parts of NH', true, v_user_id),

    ('Supra Services (WG)', NULL, 'supraserviceswg@gmail.com', '774-615-7325', NULL, NULL, NULL, NULL,
     ARRAY[]::text[],
     NULL, 'Trade not listed on card; second number: 857-928-8075', true, v_user_id),

    ('Randy Marchand', 'Randy Marchand', NULL, '781-475-6931', NULL, NULL, NULL, NULL,
     ARRAY['Demolition', 'Flooring', 'Finish Work', 'Decks', 'Drywall', 'Junk Removal', 'Spray Foam', 'Insulation'],
     NULL, NULL, true, v_user_id),

    ('Royal Home Improvement Inc.', 'Ricardo Royal', 'royalhomeimprovement46@gmail.com', '774-502-8843', NULL, NULL, NULL, NULL,
     ARRAY['Framing', 'Decking', 'Siding', 'Drywall', 'Windows & Door Installation', 'Baseboards & Trim', 'Interior Finish', 'Exterior Finish', 'Painting'],
     NULL, 'Call/text for free estimate', true, v_user_id),

    ('Provencio''s Tile', 'Mario Meire Provêncio', 'mario83provencio@gmail.com', '978-608-3849', NULL, NULL, NULL, NULL,
     ARRAY['Tile', 'Kitchen Tile', 'Bathroom Tile', 'Backsplash', 'Ceramic Tile', 'Glass Tile', 'Commercial Tile', 'Residential Tile'],
     NULL, 'Fully insured; free estimates', true, v_user_id),

    ('Tahir Remodeling & Installation', NULL, NULL, '857-505-8666', NULL, NULL, NULL, NULL,
     ARRAY['Tile', 'Wood Floors', 'Interior Painting', 'Exterior Painting', 'Bathroom Tile', 'Kitchen Tile', 'Stone Driveway'],
     NULL, 'Second number: 857-237-9143', true, v_user_id),

    ('Bella Carpentry', 'Pedro Lucas Braga', 'bellacarpentrycompany@gmail.com', NULL, NULL, NULL, NULL, NULL,
     ARRAY['Framing', 'Siding'],
     NULL, 'Family company; has insurance + tools; wants more jobs to keep crew busy', true, v_user_id),

    ('Porfírio Ribeiro & Filho', 'Jonathan Ribeiro', 'jonathanpofilhomiiguel@gmail.com', '978-401-7337', NULL, 'Marlborough', 'MA', NULL,
     ARRAY['Electrical'],
     NULL, 'Free estimates; email spelling may need confirmation', true, v_user_id),

    ('Jose Guacho', 'Jose Guacho', 'joseguacho45@gmail.com', '978-398-2121', NULL, NULL, NULL, NULL,
     ARRAY[]::text[],
     NULL, 'Said "Full insured"; trade not provided', true, v_user_id),

    ('Espinoza Home Improvement', 'Luis Yunga Espinoza', 'espinozahomeimprovement23@outlook.com', NULL, NULL, NULL, NULL, NULL,
     ARRAY[]::text[],
     NULL, 'Fully insured crew; speaks English & Spanish; trade not provided yet', true, v_user_id),

    ('New England Tree', NULL, 'netreecompany@aol.com', '781-953-2377', NULL, NULL, NULL, NULL,
     ARRAY['Tree Service'],
     NULL, 'Licensed & insured; free estimates', true, v_user_id),

    ('DiModica Property Development', 'Sebastiano DiModica IV', NULL, NULL, NULL, NULL, NULL, NULL,
     ARRAY['Electrical', 'Plumbing', 'HVAC', 'Masonry', 'Framing', 'Asphalt', 'Tree Removal', 'Site Work', 'Excavation'],
     NULL, 'Says ~35 employees; multi-trade services', true, v_user_id),

    ('Arty Gendreau Electric', 'Arty Gendreau', NULL, '978-761-6894', NULL, 'Wilmington', 'MA', NULL,
     ARRAY['Electrical'],
     NULL, 'Small company; in business since 2008; licensed in MA/ME/NH/VT; wants to team up', true, v_user_id),

    ('Ice Rose Hardscape & Construction', 'Barry Nadon III', NULL, '774-200-0387', NULL, NULL, NULL, NULL,
     ARRAY['Excavation', 'Site Work', 'Utilities', 'Demolition', 'Land Clearing', 'Masonry'],
     NULL, 'Services all of Massachusetts', true, v_user_id),

    ('SD Electrical', 'Steven Dong', 'sdelectrical625@gmail.com', '617-257-1147', NULL, NULL, NULL, NULL,
     ARRAY['Electrical'],
     NULL, 'North Shore & surrounding areas', true, v_user_id);

END $$;
