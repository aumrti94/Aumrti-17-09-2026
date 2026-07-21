-- ============================================================================
-- Day care: MULTIPLE procedures per booking
--
-- Until now a day care booking could hold exactly one procedure:
-- admissions.day_care_procedure_id is a single FK (20260518000011 §7). That is
-- wrong for real day care work — a cataract list routinely bundles a second
-- procedure, and bilateral cases are one procedure done twice. The estimate,
-- the deposit bar and the bill all read that single column, so the second
-- procedure was invisible to every money path: booked, performed, never billed.
--
-- This adds a junction table so a booking carries N procedures, each with its
-- own quantity and the rate FROZEN at booking time.
--
-- Why freeze the rate: day_care_procedures.standard_rate is a live price master
-- that Settings can edit at any moment. If the estimate is given at ₹47,000 and
-- someone re-prices the procedure before the patient is admitted, the bill must
-- still be the ₹47,000 the patient was quoted and paid a deposit against.
--
-- admissions.day_care_procedure_id is DELIBERATELY KEPT and continues to hold
-- the primary (first) procedure. The board query, the service-catalog mirror
-- (20261008000139) and the PMJAY/pre-auth mapping all read it; breaking it to
-- normalise would be a much wider blast radius than this feature deserves.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.admission_day_care_procedures (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id    uuid          NOT NULL REFERENCES public.hospitals(id),
  admission_id   uuid          NOT NULL REFERENCES public.admissions(id) ON DELETE CASCADE,
  procedure_id   uuid          NOT NULL REFERENCES public.day_care_procedures(id),
  -- Bilateral cataract = one procedure, quantity 2. Not two rows.
  quantity       int           NOT NULL DEFAULT 1 CHECK (quantity > 0),
  -- Rate at the moment of booking — see header. NOT a live read of the master.
  rate           numeric(12,2) NOT NULL DEFAULT 0 CHECK (rate >= 0),
  created_at     timestamptz   NOT NULL DEFAULT now()
);

-- One row per procedure per booking; repeats are expressed as quantity. Without
-- this, a double-submit of the booking form silently doubles the estimate.
CREATE UNIQUE INDEX IF NOT EXISTS uq_admission_day_care_procedure
  ON public.admission_day_care_procedures (admission_id, procedure_id);

CREATE INDEX IF NOT EXISTS idx_admission_day_care_procedures_admission
  ON public.admission_day_care_procedures (admission_id);

COMMENT ON TABLE public.admission_day_care_procedures IS
  'Procedures booked on a day care admission. One row per distinct procedure; '
  'repeats use quantity. rate is frozen at booking so a later price change '
  'cannot move a bill the patient was already quoted and deposited against.';

ALTER TABLE public.admission_day_care_procedures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admission_day_care_procedures_select" ON public.admission_day_care_procedures;
DROP POLICY IF EXISTS "admission_day_care_procedures_all"    ON public.admission_day_care_procedures;

CREATE POLICY "admission_day_care_procedures_select" ON public.admission_day_care_procedures
  FOR SELECT TO authenticated USING (hospital_id = public.get_user_hospital_id());
CREATE POLICY "admission_day_care_procedures_all" ON public.admission_day_care_procedures
  FOR ALL TO authenticated
  USING      (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- ── Backfill existing single-procedure bookings ─────────────────────────────
-- Every historical day care admission becomes a one-row booking, so the new
-- read path ("sum the junction rows") returns the same money it always did and
-- no old booking reads as ₹0. Rate is taken from the master because that is the
-- only rate that ever existed for these rows.
INSERT INTO public.admission_day_care_procedures (hospital_id, admission_id, procedure_id, quantity, rate)
SELECT a.hospital_id, a.id, a.day_care_procedure_id, 1, COALESCE(p.standard_rate, 0)
FROM public.admissions a
JOIN public.day_care_procedures p ON p.id = a.day_care_procedure_id
WHERE a.admission_type = 'daycare'
  AND a.day_care_procedure_id IS NOT NULL
ON CONFLICT (admission_id, procedure_id) DO NOTHING;
