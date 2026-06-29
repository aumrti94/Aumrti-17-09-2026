-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: day_care_admission_type
-- Purpose  : First-class Day Care admission type — same-day constraint, procedure
--            master, insurance pre-auth care_type, PMJAY care_type, and
--            hospital_packages care_type column.
-- Idempotent: IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Same-day discharge constraint for day care admissions ─────────────────
-- Fires on every UPDATE of admissions; blocks discharge on a different date.

CREATE OR REPLACE FUNCTION public.enforce_daycare_same_day()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.admission_type = 'daycare'
     AND NEW.discharged_at IS NOT NULL
     AND (NEW.discharged_at AT TIME ZONE 'Asia/Kolkata')::date
       != (NEW.admitted_at  AT TIME ZONE 'Asia/Kolkata')::date
  THEN
    RAISE EXCEPTION
      'Day care patients must be discharged on the same calendar day (IST). '
      'Admitted: %. Attempted discharge: %.',
      (NEW.admitted_at AT TIME ZONE 'Asia/Kolkata')::date,
      (NEW.discharged_at AT TIME ZONE 'Asia/Kolkata')::date;
  END IF;
  RETURN NEW;
END;$$;

DROP TRIGGER IF EXISTS trg_enforce_daycare_same_day ON public.admissions;
CREATE TRIGGER trg_enforce_daycare_same_day
  BEFORE UPDATE ON public.admissions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_daycare_same_day();

-- ── 2. day_care_procedures master table ──────────────────────────────────────
-- Catalogue of approved day care procedures (different from full-IPD procedure
-- lists). Used in the Day Care admission form and PMJAY claim mapping.

CREATE TABLE IF NOT EXISTS public.day_care_procedures (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id      uuid          NOT NULL REFERENCES public.hospitals(id),
  procedure_name   text          NOT NULL,
  procedure_code   text,
  specialty        text,
  duration_minutes int           NOT NULL DEFAULT 60,
  standard_rate    numeric(12,2) NOT NULL DEFAULT 0,
  pmjay_code       text,         -- mapped PMJAY package code for day care
  pre_auth_required boolean      NOT NULL DEFAULT true,
  is_active        boolean       NOT NULL DEFAULT true,
  created_at       timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_day_care_procedures_hospital
  ON public.day_care_procedures (hospital_id, is_active);

ALTER TABLE public.day_care_procedures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "day_care_procedures_select" ON public.day_care_procedures;
DROP POLICY IF EXISTS "day_care_procedures_all"    ON public.day_care_procedures;

CREATE POLICY "day_care_procedures_select" ON public.day_care_procedures
  FOR SELECT TO authenticated USING (hospital_id = public.get_user_hospital_id());
CREATE POLICY "day_care_procedures_all" ON public.day_care_procedures
  FOR ALL TO authenticated
  USING  (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- ── 3. care_type on insurance_pre_auth ───────────────────────────────────────
-- Distinguishes between inpatient and day care pre-auth forms.
-- TPA / PMJAY day care claim forms differ from inpatient forms.

ALTER TABLE public.insurance_pre_auth
  ADD COLUMN IF NOT EXISTS care_type text NOT NULL DEFAULT 'inpatient'
    CHECK (care_type IN ('inpatient', 'day_care'));

-- ── 4. care_type on pmjay_claims ─────────────────────────────────────────────
-- PMJAY has separate package codes for day care. Tracking care_type enables
-- the correct claim form and rate selection.

ALTER TABLE public.pmjay_claims
  ADD COLUMN IF NOT EXISTS care_type text NOT NULL DEFAULT 'inpatient'
    CHECK (care_type IN ('inpatient', 'day_care'));

-- ── 5. care_type on hospital_packages ────────────────────────────────────────
-- Allows hospitals to define separate package rates for day care procedures
-- (e.g., cataract day care ≠ cataract inpatient package).

ALTER TABLE public.hospital_packages
  ADD COLUMN IF NOT EXISTS care_type text NOT NULL DEFAULT 'inpatient'
    CHECK (care_type IN ('inpatient', 'day_care'));

-- ── 6. Back-fill: auto-set care_type on pre-auth and claims from admissions ──
-- When a pre-auth or claim is linked to a daycare admission, default care_type.

CREATE OR REPLACE FUNCTION public.sync_care_type_from_admission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_adm_type text;
BEGIN
  IF NEW.admission_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT admission_type INTO v_adm_type
  FROM public.admissions WHERE id = NEW.admission_id;
  IF v_adm_type = 'daycare' THEN
    NEW.care_type := 'day_care';
  END IF;
  RETURN NEW;
END;$$;

DROP TRIGGER IF EXISTS trg_sync_pre_auth_care_type ON public.insurance_pre_auth;
CREATE TRIGGER trg_sync_pre_auth_care_type
  BEFORE INSERT ON public.insurance_pre_auth
  FOR EACH ROW EXECUTE FUNCTION public.sync_care_type_from_admission();

DROP TRIGGER IF EXISTS trg_sync_pmjay_care_type ON public.pmjay_claims;
CREATE TRIGGER trg_sync_pmjay_care_type
  BEFORE INSERT ON public.pmjay_claims
  FOR EACH ROW EXECUTE FUNCTION public.sync_care_type_from_admission();

-- ── 7. day_care_procedure_id on admissions ───────────────────────────────────
-- Links a day care admission to the specific procedure being performed.

ALTER TABLE public.admissions
  ADD COLUMN IF NOT EXISTS day_care_procedure_id uuid
    REFERENCES public.day_care_procedures(id);

-- ── 8. Intimation deadline adjustment for day care ───────────────────────────
-- Day care intimation deadline: 2 hours before procedure (same-day).
-- Extend the existing fn_insurance_auto_intimate to handle 'daycare' type.

CREATE OR REPLACE FUNCTION public.fn_insurance_auto_intimate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_deadline    timestamptz;
  v_payer_type  text;
BEGIN
  -- Skip self-pay admissions
  IF NEW.insurance_type IS NULL OR NEW.insurance_type = 'self_pay' THEN
    RETURN NEW;
  END IF;

  -- Deadline per admission type
  IF NEW.admission_type = 'emergency' THEN
    v_deadline := now() + INTERVAL '48 hours';
  ELSIF NEW.admission_type = 'daycare' THEN
    v_deadline := now() + INTERVAL '2 hours';   -- same-day; must intimate before procedure
  ELSE
    v_deadline := now() + INTERVAL '24 hours';
  END IF;

  v_payer_type := COALESCE(NEW.insurance_type, 'insurance');

  INSERT INTO public.insurance_intimations (
    hospital_id, admission_id, patient_id,
    payer_type, admission_type,
    status, intimation_deadline
  ) VALUES (
    NEW.hospital_id, NEW.id, NEW.patient_id,
    v_payer_type, NEW.admission_type,
    'pending', v_deadline
  ) ON CONFLICT DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;  -- never block admission creation
END;$$;
-- Note: the trigger trg_insurance_auto_intimate already exists on admissions;
-- replacing the function is sufficient to update its behaviour.
