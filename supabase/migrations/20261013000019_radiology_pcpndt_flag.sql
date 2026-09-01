-- BUG-P4-003 — a statutory trigger must not depend on a substring of a free-text label.
--
-- ROOT CAUSE. Whether a scan required a PCPNDT Form F was decided by
--
--     study.modalityType === "usg" && study.name.toLowerCase().includes("obstetric")
--
-- so a clinically obstetric study a hospital had named "USG Pregnancy Profile", "Anomaly Scan"
-- or "TIFFA" produced no Form F. Under the PCPNDT Act the Form F is mandatory for EVERY
-- obstetric ultrasound; its absence is a criminal exposure, and it must not hinge on the words
-- a particular hospital happened to type into its catalogue.
--
-- This adds an explicit, configurable flag on the study master. src/lib/pcpndt.ts treats it as
-- authoritative and keeps a broadened keyword fallback for catalogues that predate it.
--
-- Locked by TC-P4G-016 / TC-P4G-017 / TC-P4G-018, with TC-P4G-019 guarding false positives.

ALTER TABLE public.radiology_study_master
  ADD COLUMN IF NOT EXISTS requires_form_f boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.radiology_study_master.requires_form_f IS
  'PCPNDT: this study is a regulated obstetric ultrasound and every order for it must raise a '
  'Form F. Set per hospital in Settings → Radiology. Authoritative over any name heuristic.';

-- Backfill existing catalogues. Deliberately broader than the old "obstetric" substring — the
-- naming variants below are the ones actually in use across Indian radiology catalogues, and a
-- Form F raised in error can be voided by the radiologist whereas a missing one cannot be
-- retrofitted. Only ultrasound modalities are touched.
UPDATE public.radiology_study_master
SET requires_form_f = true
WHERE requires_form_f = false
  AND lower(coalesce(modality_type, '')) ~ '(usg|ultrasound|ultrasonography|sonography|doppler)'
  AND lower(coalesce(study_name, '')) ~ (
        'obstetric|pregnan|ante[ -]?natal|foetal|fetal|anomaly scan|tiffa|nuchal|'
     || 'growth scan|biophysical profile|early preg|dating scan|level (ii|2)|gestation'
  );

CREATE INDEX IF NOT EXISTS idx_radiology_study_master_form_f
  ON public.radiology_study_master (hospital_id)
  WHERE requires_form_f;
