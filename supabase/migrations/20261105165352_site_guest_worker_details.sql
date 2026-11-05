-- Keep QR-submitted worker details on the same daily-log row as the photos.
-- Nullable columns preserve existing photo posts; new submissions are required
-- to supply a name, trade and work description by the code-validated route.
alter table public.daily_logs
  add column site_guest_trade text,
  add column site_guest_company text;

alter table public.daily_logs add constraint daily_logs_site_guest_worker_details
  check (
    (is_site_guest or (site_guest_trade is null and site_guest_company is null))
    and (site_guest_trade is null or (btrim(site_guest_trade) <> '' and char_length(site_guest_trade) <= 80))
    and (site_guest_company is null or (btrim(site_guest_company) <> '' and char_length(site_guest_company) <= 100))
  );

-- Existing guest-only shape, code-validated inserts, RLS, and hourly caps stay
-- in place. A supplied worker name/trade does not become a staff identity.
