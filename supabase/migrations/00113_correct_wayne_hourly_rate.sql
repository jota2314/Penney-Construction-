-- Correct Wayne Dobrosielski's hourly rate: 55.00 -> 45.00
-- The original seed in 00062_team_directory.sql had the wrong figure.
-- Applied live on 2026-07-28.

UPDATE public.employees
SET hourly_rate = 45.00
WHERE lower(email) = 'wdobrosielski@penneyconstructioninc.com'
  AND hourly_rate = 55.00;
