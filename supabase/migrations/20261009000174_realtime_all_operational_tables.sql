-- App-wide live data updates: enable Supabase Realtime on the operational /
-- transactional tables that back live UI lists and dashboards, so a change made by
-- one user (or a background job) propagates to every other open screen within ~1s
-- without a hard refresh. The client wires these via the shared useRealtimeRefetch hook.
--
-- Prior to this, only 20 tables were in the supabase_realtime publication, so most
-- operational tables (bills, payments, patients, prescriptions, pharmacy, etc.) could
-- never fire a realtime event, and several screens subscribed to tables that were not
-- published (their realtime code was silently dead).
--
-- Design notes:
--  * REPLICA IDENTITY FULL is set on each table so realtime row filters can match on
--    hospital_id (not the primary key) for UPDATE/DELETE — consistent with migration
--    20261008000128. This increases WAL volume on writes; acceptable for a
--    single-hospital-per-tenant HMS.
--  * Master data, append-only *_log/*_audit tables, and platform-global config are
--    intentionally excluded — they change rarely and are covered by the client's
--    tab-focus/reconnect refetch fallback.
--  * Fully idempotent and self-healing: each name is only touched if it is an ordinary
--    table (relkind='r', so views like ipd_advance_balances are skipped), it exists, and
--    it is not already in the publication. Unknown/renamed tables are silently skipped.

DO $$
DECLARE
  t text;
  tbls text[] := ARRAY[
    -- Billing & money
    'bills','bill_line_items','bill_items','bill_payments','bill_amendments',
    'bill_discount_approvals','discount_approvals','advance_receipts','refund_payables',
    'ipd_advances','credit_notes','credit_note_items','daily_cash_closure',
    'payment_links','emi_installments','emi_plans','service_charges',
    -- Patients / OPD / IPD / appointments
    'patients','opd_visits','opd_tokens','opd_encounters','opd_diagnoses','appointments',
    'admissions','bed_reservations','beds','ipd_medications','ipd_nursing_notes','ipd_vitals',
    'patient_vitals','medical_records','patient_documents','care_plans','care_plan_tasks',
    'ward_round_notes','admission_estimates','admission_day_care_procedures','daycare_chairs',
    -- Pharmacy
    'prescriptions','prescription_history','pharmacy_dispensing','pharmacy_dispenses',
    'pharmacy_dispensing_items','pharmacy_stock_alerts','drug_batches','ndps_register',
    'ndps_pending_dispenses','pharmacy_supplier_returns','pharmacy_waste_disposal',
    -- Lab / pathology
    'lab_orders','lab_order_items','lab_results','lab_samples','lab_qc_entries',
    'lab_analyzer_messages','pathology_cases','external_lab_referrals',
    -- Radiology
    'radiology_orders','radiology_reports','dicom_files',
    -- Nursing / clinical
    'nursing_vitals','nursing_mar','nursing_handovers','nursing_procedures',
    'nursing_care_plans','nursing_fluid_outputs','clinical_alerts','sepsis_alerts',
    'io_balance_records','icu_flowsheet_entries','icu_daily_goals','ward_acuity_snapshots',
    'fall_risk_assessments','braden_scale_assessments','wound_assessments','restraint_records',
    'mar_double_checks','high_alert_double_checks',
    -- Emergency / ambulance / MCI
    'ed_visits','ed_medications','ed_charge_items','ed_handover_notes','mci_events',
    'mci_triage_patients','code_blue_events','ambulance_dispatches','ambulance_vehicles',
    -- OT / anaesthesia
    'ot_schedules','ot_cases','ot_checklists','ot_consumables','ot_implants',
    'ot_instrument_counts','ot_team_members','ot_rooms','anaesthesia_records',
    'pacu_assessments','sterilization_cycles','set_issues',
    -- Insurance / PMJAY / TPA
    'insurance_pre_auth','insurance_claims','insurance_intimations','insurance_automation_log',
    'insurance_enhancement_requests','pre_auth_requests','pmjay_claims','govt_scheme_claims',
    'tpa_queries','tpa_disputes','tpa_dispute_communications','hcx_submissions',
    'denial_logs','reconciliation_discrepancies',
    -- Inbox / notifications / telemed
    'inbox_messages','teleconsult_sessions','portal_chat_messages','queue_state',
    -- Blood bank / dialysis / vaccination
    'blood_units','blood_requests','blood_issues','cross_match_records',
    'dialysis_sessions','dialysis_patients','dialysis_machines',
    'vaccination_records','vaccine_stock','vaccine_camps',
    -- Dietetics / physio / therapy
    'diet_orders','meal_deliveries','physio_sessions','physio_referrals',
    'therapy_sessions','therapy_plans',
    -- Inventory / procurement
    'inventory_stock','stock_transactions','store_stock','store_stock_movements',
    'store_indents','store_indent_items','department_indents','indent_items',
    'purchase_orders','po_items','purchase_indents','purchase_requisitions',
    'grn_records','grn_items','stock_counts','stock_count_items','inventory_anomalies',
    -- HR
    'staff_attendance','leave_requests','duty_roster','shift_swap_requests',
    'overtime_requests','attendance_regularization_requests','payroll_runs','payslips',
    -- Accounts / finance
    'journal_entries','journal_entry_lines','bank_transactions','expense_records',
    'accounting_posting_failures','fixed_assets',
    -- Quality / safety / committees / mortuary / CRM
    'incident_reports','safety_events','capa_actions','committee_action_items',
    'mortuary_admissions','body_releases','grievances','feedback_records',
    'patient_feedback','online_reviews','nps_responses',
    -- Cross-cutting
    'notification_preferences','product_modes'
  ];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    -- Only ordinary, existing tables in public (skips views and unknown names).
    IF EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t AND c.relkind = 'r'
    ) THEN
      EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);

      IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      END IF;
    END IF;
  END LOOP;
END $$;
