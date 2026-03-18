-- Add referral tracking to projects for CRM intake
alter table projects
  add column referral_source text,
  add column referral_detail text;
