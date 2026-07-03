-- Link informed-consent records to an ED visit (Phase 9). Lets the existing consent
-- capture (patient_consents) attach to an Emergency visit the same way it attaches to an
-- admission. Additive + nullable; IPD/OPD consent behaviour is unchanged.
ALTER TABLE public.patient_consents
  ADD COLUMN IF NOT EXISTS ed_visit_id uuid REFERENCES public.ed_visits(id);

CREATE INDEX IF NOT EXISTS idx_patient_consents_ed_visit_id ON public.patient_consents(ed_visit_id);
