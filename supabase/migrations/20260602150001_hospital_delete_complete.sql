-- ============================================================
-- COMPLETE HOSPITAL DELETION — purge_hospital() function
-- Migration: 20260602_hospital_delete_complete.sql
--
-- Phase 1: Explicit grandchild deletes (belt-and-suspenders).
-- Phase 1b: Dynamic grandchild discovery — finds ALL tables that
--            reference a hospital-owned table and deletes their rows.
--            Runs entirely inside PL/pgSQL so no HTTP timeout.
-- Phase 2: Dynamic 2-pass loop over every table with hospital_id.
-- Phase 3: DELETE FROM hospitals — must succeed.
-- ============================================================

CREATE OR REPLACE FUNCTION public.purge_hospital(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _rec  record;
  _i    int;
BEGIN

  -- ── Phase 1: Explicit grandchild deletes ─────────────────────────
  -- Belt-and-suspenders: explicit known grandchild tables deleted
  -- before the dynamic phases to ensure ordering is right.

  BEGIN DELETE FROM ot_team_members
    WHERE ot_schedule_id IN (SELECT id FROM ot_schedules WHERE hospital_id = p_id);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM ot_checklist_items
    WHERE checklist_id IN (SELECT id FROM ot_checklists WHERE hospital_id = p_id);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM pharmacy_dispensing_items
    WHERE dispensing_id IN (SELECT id FROM pharmacy_dispensing WHERE hospital_id = p_id);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM po_items
    WHERE po_id IN (SELECT id FROM purchase_orders WHERE hospital_id = p_id);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM grn_items
    WHERE grn_id IN (SELECT id FROM grn_records WHERE hospital_id = p_id);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM indent_items
    WHERE indent_id IN (SELECT id FROM department_indents WHERE hospital_id = p_id);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM lab_order_items
    WHERE order_id IN (SELECT id FROM lab_orders WHERE hospital_id = p_id);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM lab_samples
    WHERE order_id IN (SELECT id FROM lab_orders WHERE hospital_id = p_id);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM lab_results
    WHERE order_id IN (SELECT id FROM lab_orders WHERE hospital_id = p_id);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM bill_line_items
    WHERE bill_id IN (SELECT id FROM bills WHERE hospital_id = p_id);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM bill_payments
    WHERE bill_id IN (SELECT id FROM bills WHERE hospital_id = p_id);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM ward_round_notes
    WHERE admission_id IN (SELECT id FROM admissions WHERE hospital_id = p_id);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM ipd_vitals
    WHERE admission_id IN (SELECT id FROM admissions WHERE hospital_id = p_id);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM ipd_medications
    WHERE admission_id IN (SELECT id FROM admissions WHERE hospital_id = p_id);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM ipd_nursing_notes
    WHERE admission_id IN (SELECT id FROM admissions WHERE hospital_id = p_id);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM ipd_diet_orders
    WHERE admission_id IN (SELECT id FROM admissions WHERE hospital_id = p_id);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM ipd_physiotherapy
    WHERE admission_id IN (SELECT id FROM admissions WHERE hospital_id = p_id);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM prescription_items
    WHERE prescription_id IN (SELECT id FROM prescriptions WHERE hospital_id = p_id);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM radiology_report_items
    WHERE report_id IN (SELECT id FROM radiology_reports WHERE hospital_id = p_id);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM insurance_claim_items
    WHERE claim_id IN (SELECT id FROM insurance_claims WHERE hospital_id = p_id);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM payroll_deductions
    WHERE payroll_run_id IN (SELECT id FROM payroll_runs WHERE hospital_id = p_id);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM payroll_allowances
    WHERE payroll_run_id IN (SELECT id FROM payroll_runs WHERE hospital_id = p_id);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM asset_maintenance_logs
    WHERE asset_id IN (SELECT id FROM assets WHERE hospital_id = p_id);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM committee_meeting_minutes
    WHERE meeting_id IN (SELECT id FROM committee_meetings WHERE hospital_id = p_id);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM audit_findings
    WHERE audit_id IN (SELECT id FROM audit_records WHERE hospital_id = p_id);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM capa_actions
    WHERE capa_id IN (SELECT id FROM capa_records WHERE hospital_id = p_id);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM opd_encounter_vitals
    WHERE encounter_id IN (SELECT id FROM opd_encounters WHERE hospital_id = p_id);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM opd_encounter_complaints
    WHERE encounter_id IN (SELECT id FROM opd_encounters WHERE hospital_id = p_id);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM opd_encounter_diagnoses
    WHERE encounter_id IN (SELECT id FROM opd_encounters WHERE hospital_id = p_id);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  -- ── Phase 1b: Dynamic grandchild discovery ───────────────────────
  -- Queries information_schema to find ALL tables that:
  --   a) reference a hospital-owned table (parent has hospital_id)
  --   b) do NOT themselves have a hospital_id column
  -- Then deletes each by joining through the parent's id.
  -- Handles any grandchild tables not in Phase 1's explicit list.
  FOR _rec IN
    SELECT DISTINCT
      tc.table_name    AS child_table,
      kcu.column_name  AS fk_col,
      kcu2.table_name  AS parent_table,
      kcu2.column_name AS parent_pk
    FROM information_schema.table_constraints       tc
    JOIN information_schema.key_column_usage        kcu
      ON  tc.constraint_name = kcu.constraint_name
      AND tc.table_schema    = kcu.table_schema
    JOIN information_schema.referential_constraints rc
      ON  tc.constraint_name = rc.constraint_name
      AND tc.table_schema    = rc.constraint_schema
    JOIN information_schema.key_column_usage        kcu2
      ON  rc.unique_constraint_name = kcu2.constraint_name
    WHERE tc.table_schema    = 'public'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND EXISTS (
        SELECT 1
        FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.table_name   = kcu2.table_name
          AND c.column_name  = 'hospital_id'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.table_name   = tc.table_name
          AND c.column_name  = 'hospital_id'
      )
      AND kcu2.table_name != 'hospitals'
    ORDER BY tc.table_name
  LOOP
    BEGIN
      EXECUTE format(
        'DELETE FROM %I WHERE %I IN (SELECT %I FROM %I WHERE hospital_id = $1)',
        _rec.child_table, _rec.fk_col, _rec.parent_pk, _rec.parent_table
      ) USING p_id;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;

  -- ── Phase 2: Dynamic 2-pass loop — ALL tables with hospital_id ───
  -- Two passes handle any remaining FK depth.
  FOR _i IN 1..2 LOOP
    FOR _rec IN
      SELECT table_name
      FROM information_schema.columns
      WHERE column_name  = 'hospital_id'
        AND table_schema = 'public'
        AND table_name  != 'hospitals'
      ORDER BY table_name
    LOOP
      BEGIN
        EXECUTE format('DELETE FROM %I WHERE hospital_id = $1', _rec.table_name)
          USING p_id;
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END LOOP;
  END LOOP;

  -- ── Phase 3: Hospital row — NOT wrapped, must succeed ────────────
  DELETE FROM hospitals WHERE id = p_id;

  RAISE NOTICE 'Hospital % fully purged.', p_id;
END;
$$;

-- Only the service_role (edge function) may call this.
REVOKE ALL    ON FUNCTION public.purge_hospital(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_hospital(uuid) TO service_role;
