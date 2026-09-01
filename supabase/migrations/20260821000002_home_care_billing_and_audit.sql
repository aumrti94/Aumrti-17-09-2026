-- Home Care — billing idempotency columns + audit trail.
--
-- HomeCareVisitTab calls autoChargeService({ sourceTable: "home_care_visits" }).
-- autoChargeService's duplicate guard reads sourceTable.billing_status, and on
-- success writes back billing_status / bill_id / billed_at. home_care_visits
-- (20260509100005_nabh_home_care.sql) has none of those columns, so:
--   · the guard's SELECT errors and is swallowed → guard never fires
--   · the write-back UPDATE errors and is swallowed → nothing is ever marked billed
-- idx_bill_line_items_dedupe is NOT unique, so there is no DB-level backstop
-- either. Recording a visit twice double-bills the patient.
--
-- These columns match the convention used by every other auto-billed source
-- table. Purely additive: nullable / defaulted, no behaviour change to rows
-- that already exist.

ALTER TABLE public.home_care_visits
  ADD COLUMN IF NOT EXISTS billing_status text NOT NULL DEFAULT 'unbilled',
  ADD COLUMN IF NOT EXISTS bill_id        uuid,
  ADD COLUMN IF NOT EXISTS billed_at      timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'home_care_visits_billing_status_check'
      AND conrelid = 'public.home_care_visits'::regclass
  ) THEN
    ALTER TABLE public.home_care_visits
      ADD CONSTRAINT home_care_visits_billing_status_check
      CHECK (billing_status IN ('unbilled', 'billed', 'waived'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'home_care_visits_bill_id_fkey'
      AND conrelid = 'public.home_care_visits'::regclass
  ) THEN
    ALTER TABLE public.home_care_visits
      ADD CONSTRAINT home_care_visits_bill_id_fkey
      FOREIGN KEY (bill_id) REFERENCES public.bills(id) NOT VALID;
  END IF;
END $$;

-- Feeds the revenue-leakage dashboard: completed visits never billed
CREATE INDEX IF NOT EXISTS idx_home_care_visits_billing
  ON public.home_care_visits(hospital_id, billing_status)
  WHERE status = 'completed';

-- ── Home care plan audit trail ───────────────────────────────────────────────
-- created_by exists but was never populated correctly (the app wrote the auth
-- user id, violating home_care_plans_created_by_fkey). updated_at is missing
-- entirely, so plan edits are untraceable — a NABH AAC.12 evidence gap.
ALTER TABLE public.home_care_plans
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Links a plan back to the admission it was discharged from, for the
-- Discharge → Home Care handoff. The column already exists but was never
-- constrained or indexed.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'home_care_plans_admission_id_fkey'
      AND conrelid = 'public.home_care_plans'::regclass
  ) THEN
    ALTER TABLE public.home_care_plans
      ADD CONSTRAINT home_care_plans_admission_id_fkey
      FOREIGN KEY (admission_id) REFERENCES public.admissions(id) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_home_care_plans_admission
  ON public.home_care_plans(admission_id) WHERE admission_id IS NOT NULL;

-- ── bills.bill_type — allow the two values these modules actually write ──────
--
-- autoChargeService's standalone branch derives bill_type as
--   serviceModule.toLowerCase().replace("_", "")
-- so Home Care produces 'homecare' and chronic care produces 'chroniccare'.
-- Neither is in bills_bill_type_check (20260520000002). Home Care visits pass
-- no admissionId/encounterId, so they ALWAYS take the standalone branch: the
-- bills INSERT has been failing the CHECK, autoChargeService then throws on
-- nb!.id, and HomeCareVisitTab's .catch(() => {}) swallows it. Every home care
-- visit recorded to date produced zero revenue, silently.
--
-- Permissive change only — adds values, removes none.
DO $$
BEGIN
  ALTER TABLE public.bills DROP CONSTRAINT IF EXISTS bills_bill_type_check;
  ALTER TABLE public.bills
    ADD CONSTRAINT bills_bill_type_check
    CHECK (bill_type IN (
      'opd', 'ipd', 'emergency', 'daycare', 'package',
      'lab', 'radiology', 'pharmacy', 'dialysis', 'ot',
      'blood_bank', 'vaccination', 'dental', 'physiotherapy',
      'nursing', 'telemedicine', 'ivf', 'ayush', 'retail',
      'homecare',      -- NEW: MODULE_HOME_CARE standalone bills
      'chroniccare'    -- NEW: MODULE_CHRONIC_CARE review bills
    ));
END $$;

-- NOTE for @ravi: the same mismatch almost certainly affects other modules whose
-- standalone bill_type is likewise absent from this list (mortuary, dietetics,
-- ambulance, ed, oncology, mentalhealth). Deliberately NOT changed here — out of
-- scope for this pass. Raise as a separate billing-leakage ticket.

-- Validate what can be validated; leave orphans reported rather than blocking.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conrelid::regclass AS tbl, conname
    FROM pg_constraint
    WHERE contype = 'f' AND NOT convalidated
      AND conrelid IN (
        'public.home_care_visits'::regclass,
        'public.home_care_plans'::regclass
      )
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', c.tbl, c.conname);
    EXCEPTION WHEN foreign_key_violation THEN
      RAISE WARNING 'Constraint % on % left NOT VALID — orphan rows exist.', c.conname, c.tbl;
    END;
  END LOOP;
END $$;
