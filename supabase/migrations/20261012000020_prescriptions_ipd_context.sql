-- prescriptions: allow an IPD (admission-scoped) prescription alongside the OPD one.
--
-- WHY. OPD persists the doctor's Rx & Orders selections to `prescriptions` on a 2s debounce,
-- and that row is the ONLY thing the Lab / Radiology / Pharmacy modules read in order to
-- pre-select the prescribed items for direct billing. IPD could never write such a row —
-- encounter_id is NOT NULL with an FK to opd_encounters — so an admitted patient's orders
-- reached no downstream module and the ward draft was lost on every tab switch.
--
-- The table now carries exactly one context: an OPD encounter OR an admission.

ALTER TABLE public.prescriptions ALTER COLUMN encounter_id DROP NOT NULL;

ALTER TABLE public.prescriptions
  ADD COLUMN IF NOT EXISTS admission_id uuid REFERENCES public.admissions(id);

-- Exactly one context. This is what keeps an IPD row invisible to the OPD queries (which all
-- filter on encounter_id) and vice versa, so neither side can silently pick up the other's
-- prescriptions.
ALTER TABLE public.prescriptions
  DROP CONSTRAINT IF EXISTS prescriptions_one_context;
ALTER TABLE public.prescriptions
  ADD CONSTRAINT prescriptions_one_context CHECK (
    (encounter_id IS NOT NULL AND admission_id IS NULL)
    OR (encounter_id IS NULL AND admission_id IS NOT NULL)
  );

-- Draft vs committed.
--
-- This deliberately does NOT reuse is_signed. PrescriptionQueue builds the IP pharmacy
-- worklist from `prescriptions WHERE is_signed = true`, and OPD sets is_signed purely from
-- `drugs.length > 0` — so reusing it would put every half-typed IPD draft in front of a
-- pharmacist the moment the doctor picked a first drug.
ALTER TABLE public.prescriptions
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft';

ALTER TABLE public.prescriptions
  DROP CONSTRAINT IF EXISTS prescriptions_status_check;
ALTER TABLE public.prescriptions
  ADD CONSTRAINT prescriptions_status_check CHECK (status IN ('draft', 'committed'));

-- Existing rows predate the concept and are all finished consultations. Defaulting them to
-- 'draft' would be a behaviour change; mark them committed so nothing moves.
UPDATE public.prescriptions SET status = 'committed' WHERE status = 'draft';

-- One live prescription per admission. Makes the ward draft an upsert target and lets the
-- reload use .maybeSingle() without risking a multi-row throw.
--
-- Deliberately NOT a partial index (`WHERE admission_id IS NOT NULL`). ON CONFLICT can only
-- infer a partial index when the statement repeats its predicate, which PostgREST's upsert
-- cannot express — the save would fail with "no unique or exclusion constraint matching the
-- ON CONFLICT specification". A plain unique index is safe here because Postgres treats NULLs
-- as distinct, so the OPD rows (admission_id IS NULL) are unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS prescriptions_admission_uniq
  ON public.prescriptions (admission_id);

CREATE INDEX IF NOT EXISTS idx_prescriptions_hospital_admission
  ON public.prescriptions (hospital_id, admission_id)
  WHERE admission_id IS NOT NULL;

-- Existing installs may already hold more than one prescription per admission only if this
-- feature ran before the index existed; there is no such state today (IPD never wrote the
-- table), so the unique index is safe to create without a dedupe pass.

-- RLS needs no change: both existing policies are scoped on hospital_id alone and say nothing
-- about encounter_id or admission_id.
