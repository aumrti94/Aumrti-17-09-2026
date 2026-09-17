-- Phase 8B (docs/testing/PHASE_8_STATUS.md §4) — neonatal screening gaps.
--
-- WHY. Three findings from that audit:
-- 1. tsh_done/g6pd_done/hearing_screen have no per-test timestamp, so "was this drawn in the
--    24-48h window" can never be computed, even retroactively.
-- 2. CCHD (critical congenital heart disease) screening is named twice in the product's own
--    module catalogue (src/lib/modules.ts) and page copy, but has no field, column, or logic
--    anywhere.
-- 3. ROP (retinopathy of prematurity) has zero references anywhere in the codebase, despite
--    being a standard NICU screening requirement for low-birth-weight/preterm infants.
--
-- Both CCHD and ROP are added as structured MANUAL capture only — a clinician performs the
-- standard protocol (pulse-oximetry pre/post-ductal reading; fundus exam) using their own
-- equipment and judgement, and the system records the result, exactly like the pre-existing
-- hearing_screen field. rop_eligible is a deterministic, publicly-standard threshold rule
-- (birth weight <= 2000g OR gestational age <= 34 weeks), computed the same way the existing
-- Bhutani-zone calculator already is in NeonatalSheet.tsx. No automated diagnosis or
-- risk-scoring model is introduced here.

ALTER TABLE public.neonatal_records
  ADD COLUMN IF NOT EXISTS tsh_done_at timestamptz,
  ADD COLUMN IF NOT EXISTS g6pd_done_at timestamptz,
  ADD COLUMN IF NOT EXISTS hearing_screen_at timestamptz,
  ADD COLUMN IF NOT EXISTS gestational_age_at_birth_weeks numeric(3,1),
  ADD COLUMN IF NOT EXISTS cchd_screening_done boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS cchd_pre_ductal_spo2 numeric(4,1),
  ADD COLUMN IF NOT EXISTS cchd_post_ductal_spo2 numeric(4,1),
  ADD COLUMN IF NOT EXISTS cchd_result text,
  ADD COLUMN IF NOT EXISTS cchd_done_at timestamptz,
  ADD COLUMN IF NOT EXISTS rop_eligible boolean,
  ADD COLUMN IF NOT EXISTS rop_first_screen_due_date date,
  ADD COLUMN IF NOT EXISTS rop_screening_done boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS rop_screening_date date,
  ADD COLUMN IF NOT EXISTS rop_result text,
  ADD COLUMN IF NOT EXISTS rop_followup_due_date date;

CREATE OR REPLACE FUNCTION public.validate_neonatal_record()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.apgar_1min IS NOT NULL AND (NEW.apgar_1min < 0 OR NEW.apgar_1min > 10) THEN
    RAISE EXCEPTION 'apgar_1min must be 0-10';
  END IF;
  IF NEW.apgar_5min IS NOT NULL AND (NEW.apgar_5min < 0 OR NEW.apgar_5min > 10) THEN
    RAISE EXCEPTION 'apgar_5min must be 0-10';
  END IF;
  IF NEW.hearing_screen IS NOT NULL AND NEW.hearing_screen NOT IN ('pass','refer','not_done') THEN
    RAISE EXCEPTION 'Invalid hearing_screen: %', NEW.hearing_screen;
  END IF;
  IF NEW.cchd_result IS NOT NULL AND NEW.cchd_result NOT IN ('pass','refer','not_done') THEN
    RAISE EXCEPTION 'Invalid cchd_result: %', NEW.cchd_result;
  END IF;
  RETURN NEW;
END;
$$;
-- trg_validate_neonatal_record already points at this function (20260328143309) — no re-attach needed.
