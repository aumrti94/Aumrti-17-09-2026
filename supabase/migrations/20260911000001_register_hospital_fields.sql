-- Registration data-capture fields for the /register self-signup flow.
-- The wizard collects City and a granular Hospital Category, but the hospitals
-- table previously had no column for either, so the values were silently dropped.
-- These columns are descriptive/segmentation metadata (no PHI).

-- City / District (collected in Step 3 — Hospital Details)
ALTER TABLE public.hospitals ADD COLUMN IF NOT EXISTS city text;

-- Exact hospital category label as selected at signup
-- (Private / Government / Trust-NGO / Corporate / Nursing Home / Clinic /
--  Specialty Center / Dental Clinic / AYUSH Center / Other).
-- The existing `type` enum (general/specialty/clinic/nursing_home) is kept for
-- backward compatibility; hospital_category preserves the un-collapsed value for
-- GTM segmentation and onboarding module presets.
ALTER TABLE public.hospitals ADD COLUMN IF NOT EXISTS hospital_category text;

COMMENT ON COLUMN public.hospitals.city IS 'City / District captured at registration (Step 3).';
COMMENT ON COLUMN public.hospitals.hospital_category IS 'Granular hospital category label selected at signup; preserves the value before it is collapsed into the type enum.';
