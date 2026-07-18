-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: daycare_procedures_service_catalog
-- Purpose  : Mirror day_care_procedures into service_master.
--
--            20261008000136 (Phase 2 of the service catalog unification) trigger-mirrors
--            every module-owned price table into service_master — lab tests, panels,
--            radiology studies, packages, wards, specialized services — and MISSED
--            day_care_procedures, the one remaining master with a standard_rate.
--
--            Consequence today: a day care procedure configured in Settings cannot be
--            found by the Billing line-item picker, which searches service_master only.
--            The ₹47,000 Cataract is configured, displayed at admission, and unbillable.
--
-- GST      : item_type 'procedure' resolves to GST_RATE_RULES.procedure = 0, which is
--            correct — healthcare procedures are GST-exempt (Notification 12/2017-CT(Rate)).
--            Deliberately NO gst_percent/hsn_code column is added to day_care_procedures:
--            GST here is a matter of law, not hospital-configurable pricing, exactly as
--            reasoned for room charges in ipdBilling.ts. A per-procedure GST field would
--            let a hospital tax an exempt supply.
--
-- Safety   : idx_service_master_doctor_unique is WHERE doctor_id IS NOT NULL, so N mirrored
--            rows with doctor_id NULL cannot collide — lab_test_master already mirrors N
--            rows at item_type='lab' the same way.
--
-- Idempotent: CREATE OR REPLACE + DROP TRIGGER IF EXISTS; the backfill upserts.
-- Additive  : No column added or dropped; the mirror is derived data.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sync_day_care_procedure_to_catalog()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM deactivate_service_catalog_mirror(OLD.hospital_id, 'day_care_procedures', OLD.id);
    RETURN OLD;
  END IF;
  PERFORM upsert_service_catalog_mirror(
    NEW.hospital_id, 'day_care_procedures', NEW.id,
    NEW.procedure_name, 'day_care', 'procedure',
    NEW.standard_rate, COALESCE(NEW.is_active, true)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_day_care_procedure_to_catalog ON public.day_care_procedures;
CREATE TRIGGER trg_sync_day_care_procedure_to_catalog
  AFTER INSERT OR UPDATE OR DELETE ON public.day_care_procedures
  FOR EACH ROW EXECUTE FUNCTION public.sync_day_care_procedure_to_catalog();

-- ── Backfill every procedure configured before this trigger existed ──────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT hospital_id, id, procedure_name, standard_rate, is_active
    FROM day_care_procedures
  LOOP
    PERFORM upsert_service_catalog_mirror(
      r.hospital_id, 'day_care_procedures', r.id,
      r.procedure_name, 'day_care', 'procedure',
      r.standard_rate, COALESCE(r.is_active, true)
    );
  END LOOP;
END $$;
