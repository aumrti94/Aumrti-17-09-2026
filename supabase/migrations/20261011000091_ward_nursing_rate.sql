-- Per-ward nursing charge (₹/day).
--
-- Nursing is priced by ward class in every real Indian tariff (General / Semi-private /
-- Private / ICU each carry their own nursing rate), so it belongs next to the ward's
-- rate_per_day rather than in a single hospital-wide default.
--
-- DEFAULT 0 means OFF. Under CGHS 2025 Annexure-III nursing care is bundled into the
-- ward charge and "not payable separately or billable to the patient", and IRDAI's
-- non-payable list treats a separate nursing charge as part of room rent. So a hospital
-- must opt in per ward; nothing is billed until someone sets a rate.
ALTER TABLE public.wards
  ADD COLUMN IF NOT EXISTS nursing_rate_per_day numeric(10,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.wards.nursing_rate_per_day IS
  'Per-day nursing charge for this ward. 0 = nursing is included in the room rate (CGHS/ESI/TPA rule) and no separate line is billed.';
