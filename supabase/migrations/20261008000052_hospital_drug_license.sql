-- Pharmacy gap-fill plan, Phase 13 — no hospital-level drug license (Form 20B/21B,
-- required under the Drugs and Cosmetics Act to legally operate a pharmacy) was
-- tracked anywhere. Follows the same registration/license-pair convention already
-- used for nabl_accreditation_number/nabl_valid_upto.
ALTER TABLE public.hospitals
  ADD COLUMN IF NOT EXISTS drug_license_number text,
  ADD COLUMN IF NOT EXISTS drug_license_valid_upto date;
