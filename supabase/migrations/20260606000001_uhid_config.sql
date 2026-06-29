-- UHID Configuration per hospital
-- Allows each hospital to define their own UHID prefix and date format.
-- Examples:
--   BH-20260606-0001  (prefix=BH, date_format=YYYYMMDD)
--   NIMR-2026-0001    (prefix=NIMR, date_format=YYYY)
--   GH-0001           (prefix=GH, date_format=NONE)

ALTER TABLE hospitals
  ADD COLUMN IF NOT EXISTS uhid_prefix       text    NOT NULL DEFAULT 'UHID',
  ADD COLUMN IF NOT EXISTS uhid_date_format  text    NOT NULL DEFAULT 'YYYYMMDD';
-- uhid_date_format values: 'YYYYMMDD' | 'YYYY' | 'NONE'
