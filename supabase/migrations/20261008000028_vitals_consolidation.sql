-- Phase 3 of nursing module completion plan: unify vitals onto nursing_vitals as the canonical
-- table. A DB trigger mirrors every insert into ipd_vitals so its ~8 existing readers
-- (IPDOverviewTab, IPDWorkspace print-summary, ADRDetectorPanel, IOChartTab, WardNursingBoard,
-- NursingPage stats query, acuityStaffing.ts) keep working unmodified — same mechanism as
-- Phase 2's nursing_mar -> mar_records mirror.

-- 1. nursing_vitals gains the one field it was missing vs ipd_vitals.
ALTER TABLE public.nursing_vitals ADD COLUMN IF NOT EXISTS grbs integer;

-- 2. Mirror trigger. hospital_id/admission_id/recorded_by are NOT NULL on ipd_vitals but
--    nullable on nursing_vitals — if a source row is missing any of them (shouldn't happen via
--    any current app write path, but the schema technically allows it), skip the mirror rather
--    than raising, so a nursing_vitals insert can never be blocked by this trigger.
CREATE OR REPLACE FUNCTION public.mirror_nursing_vitals_to_ipd_vitals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.hospital_id IS NULL OR NEW.admission_id IS NULL OR NEW.recorded_by IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.ipd_vitals (
    hospital_id, admission_id, recorded_by,
    bp_systolic, bp_diastolic, pulse, temperature, spo2, respiratory_rate,
    grbs, urine_output_ml, pain_score, news2_score, recorded_at
  ) VALUES (
    NEW.hospital_id, NEW.admission_id, NEW.recorded_by,
    NEW.bp_systolic, NEW.bp_diastolic, NEW.pulse, NEW.temperature, NEW.spo2, NEW.respiratory_rate,
    NEW.grbs, NEW.urine_output_ml, NEW.pain_score,
    CASE WHEN NEW.news2_score IS NULL THEN NULL ELSE round(NEW.news2_score)::integer END,
    NEW.recorded_at
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mirror_nursing_vitals_to_ipd_vitals ON public.nursing_vitals;
CREATE TRIGGER trg_mirror_nursing_vitals_to_ipd_vitals
  AFTER INSERT ON public.nursing_vitals
  FOR EACH ROW EXECUTE FUNCTION public.mirror_nursing_vitals_to_ipd_vitals();
