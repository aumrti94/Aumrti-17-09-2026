-- ============================================================
-- ONE-TIME CLEANUP Part 1: Explicit grandchild orphan deletes
-- (No information_schema joins — runs fast, no timeout risk)
-- ============================================================

DO $$
BEGIN

  BEGIN DELETE FROM ot_team_members
    WHERE ot_schedule_id IN (
      SELECT id FROM ot_schedules WHERE hospital_id NOT IN (SELECT id FROM hospitals));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM ot_checklist_items
    WHERE checklist_id IN (
      SELECT id FROM ot_checklists WHERE hospital_id NOT IN (SELECT id FROM hospitals));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM pharmacy_dispensing_items
    WHERE dispensing_id IN (
      SELECT id FROM pharmacy_dispensing WHERE hospital_id NOT IN (SELECT id FROM hospitals));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM po_items
    WHERE po_id IN (
      SELECT id FROM purchase_orders WHERE hospital_id NOT IN (SELECT id FROM hospitals));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM grn_items
    WHERE grn_id IN (
      SELECT id FROM grn_records WHERE hospital_id NOT IN (SELECT id FROM hospitals));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM indent_items
    WHERE indent_id IN (
      SELECT id FROM department_indents WHERE hospital_id NOT IN (SELECT id FROM hospitals));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM lab_order_items
    WHERE order_id IN (
      SELECT id FROM lab_orders WHERE hospital_id NOT IN (SELECT id FROM hospitals));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM lab_samples
    WHERE order_id IN (
      SELECT id FROM lab_orders WHERE hospital_id NOT IN (SELECT id FROM hospitals));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM lab_results
    WHERE order_id IN (
      SELECT id FROM lab_orders WHERE hospital_id NOT IN (SELECT id FROM hospitals));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM bill_line_items
    WHERE bill_id IN (
      SELECT id FROM bills WHERE hospital_id NOT IN (SELECT id FROM hospitals));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM bill_payments
    WHERE bill_id IN (
      SELECT id FROM bills WHERE hospital_id NOT IN (SELECT id FROM hospitals));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM ward_round_notes
    WHERE admission_id IN (
      SELECT id FROM admissions WHERE hospital_id NOT IN (SELECT id FROM hospitals));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM ipd_vitals
    WHERE admission_id IN (
      SELECT id FROM admissions WHERE hospital_id NOT IN (SELECT id FROM hospitals));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM ipd_medications
    WHERE admission_id IN (
      SELECT id FROM admissions WHERE hospital_id NOT IN (SELECT id FROM hospitals));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM ipd_nursing_notes
    WHERE admission_id IN (
      SELECT id FROM admissions WHERE hospital_id NOT IN (SELECT id FROM hospitals));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM ipd_diet_orders
    WHERE admission_id IN (
      SELECT id FROM admissions WHERE hospital_id NOT IN (SELECT id FROM hospitals));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM ipd_physiotherapy
    WHERE admission_id IN (
      SELECT id FROM admissions WHERE hospital_id NOT IN (SELECT id FROM hospitals));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM prescription_items
    WHERE prescription_id IN (
      SELECT id FROM prescriptions WHERE hospital_id NOT IN (SELECT id FROM hospitals));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM radiology_report_items
    WHERE report_id IN (
      SELECT id FROM radiology_reports WHERE hospital_id NOT IN (SELECT id FROM hospitals));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM insurance_claim_items
    WHERE claim_id IN (
      SELECT id FROM insurance_claims WHERE hospital_id NOT IN (SELECT id FROM hospitals));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM payroll_deductions
    WHERE payroll_run_id IN (
      SELECT id FROM payroll_runs WHERE hospital_id NOT IN (SELECT id FROM hospitals));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM payroll_allowances
    WHERE payroll_run_id IN (
      SELECT id FROM payroll_runs WHERE hospital_id NOT IN (SELECT id FROM hospitals));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM asset_maintenance_logs
    WHERE asset_id IN (
      SELECT id FROM assets WHERE hospital_id NOT IN (SELECT id FROM hospitals));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM committee_meeting_minutes
    WHERE meeting_id IN (
      SELECT id FROM committee_meetings WHERE hospital_id NOT IN (SELECT id FROM hospitals));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM audit_findings
    WHERE audit_id IN (
      SELECT id FROM audit_records WHERE hospital_id NOT IN (SELECT id FROM hospitals));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM capa_actions
    WHERE capa_id IN (
      SELECT id FROM capa_records WHERE hospital_id NOT IN (SELECT id FROM hospitals));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM opd_encounter_vitals
    WHERE encounter_id IN (
      SELECT id FROM opd_encounters WHERE hospital_id NOT IN (SELECT id FROM hospitals));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM opd_encounter_complaints
    WHERE encounter_id IN (
      SELECT id FROM opd_encounters WHERE hospital_id NOT IN (SELECT id FROM hospitals));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN DELETE FROM opd_encounter_diagnoses
    WHERE encounter_id IN (
      SELECT id FROM opd_encounters WHERE hospital_id NOT IN (SELECT id FROM hospitals));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RAISE NOTICE 'Part 1 complete: explicit grandchild orphans removed.';
END;
$$;
