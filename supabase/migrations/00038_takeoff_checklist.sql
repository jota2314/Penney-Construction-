ALTER TABLE takeoff_measurements DROP CONSTRAINT IF EXISTS takeoff_measurements_measurement_type_check;
ALTER TABLE takeoff_measurements ADD CONSTRAINT takeoff_measurements_measurement_type_check
  CHECK (measurement_type IN ('linear', 'area', 'count', 'checklist'));
