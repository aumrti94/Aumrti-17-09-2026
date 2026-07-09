-- Billing gap-fill plan (Indian workflow fact-check), Phase 19 — hospital_packages has no
-- way to flag a package as linked to a government health scheme (PMJAY, CGHS, ECHS, etc.).
-- Schema-only per user decision: no rate-schedule import, just makes the distinction
-- taggable/reportable for a future package-admin UI. free-text scheme_code (not a CHECK
-- constraint) matching this plan's established convention of avoiding an ever-growing
-- allow-list that falls out of sync as new schemes are added.

ALTER TABLE public.hospital_packages
  ADD COLUMN IF NOT EXISTS scheme_code text,
  ADD COLUMN IF NOT EXISTS is_government_scheme boolean DEFAULT false;
