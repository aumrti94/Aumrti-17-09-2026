-- ============================================================================
-- Day care admissions: no bed required
-- ----------------------------------------------------------------------------
-- Day Care Admission (src/components/ipd/DayCareAdmissionModal.tsx) has NEVER
-- been able to admit anyone: admissions.bed_id and ward_id are NOT NULL with no
-- default, and that modal supplies neither. Every attempt died on
--   null value in column "bed_id" of relation "admissions"
-- Confirmed by replaying the modal's exact INSERT against the live database, and
-- by there being zero admission_type='daycare' rows in existence.
--
-- A bed is genuinely not part of the day-care flow, and the app already agrees:
--   - the modal has no bed picker (unlike AdmitPatientModal, which does)
--   - DayCarePage selects no bed/ward columns and shows no bed
--   - IPDPage narrows its board to currently-OCCUPIED beds, so a bed-less
--     day-care admission cannot leak onto the inpatient bed map
-- The NOT NULL was an inpatient-era assumption that day care was never exempted
-- from, not a deliberate rule.
--
-- Rather than dropping the guarantee for everyone, the columns become nullable
-- and a CHECK re-imposes them for every admission type EXCEPT daycare — so a
-- real inpatient admission still cannot be created without a bed.
--
-- Idempotent. No existing row changes: every current admission has both set, so
-- the new constraint is already satisfied.
-- ============================================================================

ALTER TABLE public.admissions ALTER COLUMN bed_id  DROP NOT NULL;
ALTER TABLE public.admissions ALTER COLUMN ward_id DROP NOT NULL;

-- COALESCE guards the NULL-admission_type case: a bare `admission_type =
-- 'daycare'` would evaluate to NULL there, and a CHECK passes on NULL — which
-- would silently let a bed-less inpatient admission through.
ALTER TABLE public.admissions
  DROP CONSTRAINT IF EXISTS admissions_bed_required_unless_daycare;

ALTER TABLE public.admissions
  ADD CONSTRAINT admissions_bed_required_unless_daycare
  CHECK (
    COALESCE(admission_type, '') = 'daycare'
    OR (bed_id IS NOT NULL AND ward_id IS NOT NULL)
  );

COMMENT ON CONSTRAINT admissions_bed_required_unless_daycare ON public.admissions IS
  'Inpatient admissions must occupy a bed; day-care admissions are same-day and hold none.';
