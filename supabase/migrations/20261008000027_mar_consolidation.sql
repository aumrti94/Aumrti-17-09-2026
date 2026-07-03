-- Phase 2 of nursing module completion plan: unify MAR onto nursing_mar as the canonical table.
-- mar_records becomes a DB-trigger-derived, guaranteed-non-drifting audit mirror instead of a
-- second manual insert from application code. med_admin_records is deprecated in place (comment
-- only — not dropped, per "preserve existing functionality").

-- 1. mar_records gains an explicit omission_reason column (previously jammed into `notes`) and a
--    link back to the nursing_mar row that produced each audit entry.
ALTER TABLE public.mar_records
  ADD COLUMN IF NOT EXISTS omission_reason text,
  ADD COLUMN IF NOT EXISTS source_mar_id uuid REFERENCES public.nursing_mar(id);

-- 2. Trigger: every meaningful state transition on nursing_mar (insert of a real outcome, or a
--    later update of outcome/administered_at — e.g. a Kardex-generated "pending" placeholder
--    being marked given) appends one audit row to mar_records. Placeholder "pending" rows
--    (created by "Generate Today's MAR") are NOT mirrored — nothing clinical has happened yet.
CREATE OR REPLACE FUNCTION public.mirror_nursing_mar_to_mar_records()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_patient_id uuid;
  v_drug_name text;
  v_dose text;
  v_route text;
BEGIN
  IF NEW.outcome IS NULL OR NEW.outcome = 'pending' THEN
    RETURN NEW;
  END IF;

  SELECT patient_id INTO v_patient_id FROM public.admissions WHERE id = NEW.admission_id;
  SELECT drug_name, dose, route INTO v_drug_name, v_dose, v_route
    FROM public.ipd_medications WHERE id = NEW.medication_id;

  INSERT INTO public.mar_records (
    hospital_id, admission_id, patient_id, drug_name, dose, route,
    scheduled_time, administered_at, administered_by, status, notes,
    omission_reason, source_mar_id
  ) VALUES (
    NEW.hospital_id, NEW.admission_id, v_patient_id, COALESCE(v_drug_name, ''), v_dose, v_route,
    (NEW.scheduled_date + NEW.scheduled_time)::timestamptz, NEW.administered_at, NEW.administered_by,
    NEW.outcome, NEW.omission_reason, NEW.omission_reason, NEW.id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mirror_nursing_mar_to_mar_records ON public.nursing_mar;
CREATE TRIGGER trg_mirror_nursing_mar_to_mar_records
  AFTER INSERT OR UPDATE OF outcome, administered_at ON public.nursing_mar
  FOR EACH ROW EXECUTE FUNCTION public.mirror_nursing_mar_to_mar_records();

-- 3. Link the high-alert double-check audit trail to the real dose it verifies. Safe now that
--    Phase 1 guarantees mar_id is populated going forward; existing legacy null rows are
--    grandfathered since the column stays nullable.
ALTER TABLE public.mar_double_checks
  ADD CONSTRAINT mar_double_checks_mar_id_fkey FOREIGN KEY (mar_id) REFERENCES public.nursing_mar(id);

-- 4. med_admin_records is superseded — mark it, don't drop it (something outside this repo could
--    still read it directly via the Supabase client).
COMMENT ON TABLE public.med_admin_records IS
  'Deprecated as of 2026-07 — superseded by nursing_mar (see nursing module completion plan, '
  'Phase 2). Kept for compatibility; no longer read or written by application code.';
