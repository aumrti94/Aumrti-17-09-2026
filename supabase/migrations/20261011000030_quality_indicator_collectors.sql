-- ============================================================================
-- NABH Quality Indicator Engine — 3/7: collectors
-- ============================================================================
-- One function per NABH chapter, each returning (indicator_code, numerator,
-- denominator). The orchestrator UNION ALLs them, applies the definition's
-- multiplier, and upserts into quality_indicators.
--
-- INVARIANT: every query in every collector filters hospital_id = p_hospital_id.
-- These run SECURITY DEFINER (they must read across tables a ward clerk cannot),
-- so that predicate is the only thing standing between tenants. The security
-- test asserts it.
--
-- A NULL denominator means "no exposure in this period" and must produce a NULL
-- value, never a raw count dressed up as a rate.
-- ============================================================================

-- ─── Shared denominators ─────────────────────────────────────────────────────

-- Patient-days as an *exposure* measure: time actually spent in a bed during the
-- window, not a discharge count. Prefers the midnight census (the denominator
-- NABH expects); falls back to clamping each stay to the period.
CREATE OR REPLACE FUNCTION public.qi_patient_days(
  p_hospital_id uuid, p_from timestamptz, p_to timestamptz
) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT NULLIF(SUM(occupied_beds), 0)::numeric
       FROM public.daily_census_snapshots
      WHERE hospital_id = p_hospital_id
        AND snapshot_date >= p_from::date AND snapshot_date < p_to::date),
    (SELECT NULLIF(COALESCE(SUM(
        EXTRACT(epoch FROM (
            LEAST(COALESCE(a.discharged_at, p_to), p_to)
          - GREATEST(a.admitted_at, p_from)
        )) / 86400.0), 0), 0)
       FROM public.admissions a
      WHERE a.hospital_id = p_hospital_id
        AND a.admitted_at IS NOT NULL
        AND a.admitted_at < p_to
        AND COALESCE(a.discharged_at, p_to) > p_from)
  );
$$;

CREATE OR REPLACE FUNCTION public.qi_active_staff(p_hospital_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NULLIF(count(*), 0)::numeric
  FROM public.staff_profiles
  WHERE hospital_id = p_hospital_id AND COALESCE(is_active, true);
$$;

CREATE OR REPLACE FUNCTION public.qi_active_beds(p_hospital_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NULLIF(count(*), 0)::numeric
  FROM public.beds WHERE hospital_id = p_hospital_id AND is_active;
$$;

-- A hospital that has adopted safety_events records the same event in BOTH
-- stores, so counting both double-counts. Pick one source per hospital, once,
-- and reuse it for falls, medication errors and the incident reporting rate.
CREATE OR REPLACE FUNCTION public.qi_safety_source(p_hospital_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public.safety_events WHERE hospital_id = p_hospital_id
  ) THEN 'safety_events' ELSE 'incident_reports' END;
$$;

-- ─── AAC ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.qi_collect_aac(
  p_hospital_id uuid, p_from timestamptz, p_to timestamptz
) RETURNS TABLE(indicator_code text, numerator numeric, denominator numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
WITH tok AS (
  SELECT COALESCE(
           t.wait_minutes,
           EXTRACT(epoch FROM (t.consultation_start_at - t.created_at)) / 60.0
         ) AS wait_min
  FROM public.opd_tokens t
  WHERE t.hospital_id = p_hospital_id
    AND t.visit_date >= p_from::date AND t.visit_date < p_to::date
    AND t.status = 'completed'
    AND COALESCE(t.wait_minutes, EXTRACT(epoch FROM (t.consultation_start_at - t.created_at)) / 60.0) IS NOT NULL
),
disch AS (
  SELECT a.id, a.patient_id, a.admitted_at, a.discharged_at, a.discharge_type,
         a.discharge_summary_done, a.discharge_ordered_at
  FROM public.admissions a
  WHERE a.hospital_id = p_hospital_id
    AND a.discharged_at >= p_from AND a.discharged_at < p_to
),
census AS (
  SELECT SUM(occupied_beds)::numeric AS occ, SUM(total_beds)::numeric AS tot
  FROM public.daily_census_snapshots
  WHERE hospital_id = p_hospital_id
    AND snapshot_date >= p_from::date AND snapshot_date < p_to::date
)
SELECT 'aac.opd_wait_avg_min',
       COALESCE(SUM(GREATEST(wait_min, 0)), 0), NULLIF(count(*), 0)::numeric FROM tok
UNION ALL
SELECT 'aac.opd_wait_gt30_pct',
       count(*) FILTER (WHERE wait_min > 30)::numeric, NULLIF(count(*), 0)::numeric FROM tok
UNION ALL
SELECT 'aac.ip_alos_days',
       COALESCE(SUM(EXTRACT(epoch FROM (discharged_at - admitted_at)) / 86400.0)
                FILTER (WHERE admitted_at IS NOT NULL AND discharged_at > admitted_at), 0),
       NULLIF(count(*) FILTER (WHERE admitted_at IS NOT NULL AND discharged_at > admitted_at), 0)::numeric
FROM disch
UNION ALL
-- Census where available; otherwise occupancy from stay-overlap over active beds.
SELECT 'aac.bed_occupancy_pct',
       COALESCE((SELECT occ FROM census),
                public.qi_patient_days(p_hospital_id, p_from, p_to)),
       COALESCE((SELECT NULLIF(tot, 0) FROM census),
                public.qi_active_beds(p_hospital_id)
                  * GREATEST(EXTRACT(epoch FROM (p_to - p_from)) / 86400.0, 1))
UNION ALL
SELECT 'aac.discharge_tat_hrs',
       COALESCE(SUM(EXTRACT(epoch FROM (discharged_at - discharge_ordered_at)) / 3600.0)
                FILTER (WHERE discharge_ordered_at IS NOT NULL AND discharged_at > discharge_ordered_at), 0),
       NULLIF(count(*) FILTER (WHERE discharge_ordered_at IS NOT NULL AND discharged_at > discharge_ordered_at), 0)::numeric
FROM disch
UNION ALL
SELECT 'aac.discharge_summary_pct',
       count(*) FILTER (WHERE discharge_summary_done)::numeric, NULLIF(count(*), 0)::numeric FROM disch
UNION ALL
SELECT 'aac.lama_dama_pct',
       count(*) FILTER (WHERE lower(COALESCE(discharge_type, '')) IN ('lama','dama','absconded'))::numeric,
       NULLIF(count(*), 0)::numeric FROM disch
UNION ALL
SELECT 'aac.readmit_30d_pct',
       count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM public.admissions r
         WHERE r.hospital_id = p_hospital_id AND r.patient_id = d.patient_id
           AND r.id <> d.id AND r.admitted_at > d.discharged_at
           AND r.admitted_at <= d.discharged_at + interval '30 days'))::numeric,
       NULLIF(count(*), 0)::numeric FROM disch d
UNION ALL
SELECT 'aac.readmit_48h_pct',
       count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM public.admissions r
         WHERE r.hospital_id = p_hospital_id AND r.patient_id = d.patient_id
           AND r.id <> d.id AND r.admitted_at > d.discharged_at
           AND r.admitted_at <= d.discharged_at + interval '48 hours'))::numeric,
       NULLIF(count(*), 0)::numeric FROM disch d;
$$;

-- ─── COP (clinical + OT + blood + nursing) ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.qi_collect_cop(
  p_hospital_id uuid, p_from timestamptz, p_to timestamptz
) RETURNS TABLE(indicator_code text, numerator numeric, denominator numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
WITH disch AS (
  SELECT a.id, a.discharge_type FROM public.admissions a
  WHERE a.hospital_id = p_hospital_id AND a.discharged_at >= p_from AND a.discharged_at < p_to
),
adm AS (
  SELECT a.id, a.patient_id, a.admitted_at FROM public.admissions a
  WHERE a.hospital_id = p_hospital_id AND a.admitted_at >= p_from AND a.admitted_at < p_to
),
ot_done AS (
  SELECT o.id, o.actual_start_time, o.scheduled_date, o.scheduled_start_time, o.patient_id
  FROM public.ot_schedules o
  WHERE o.hospital_id = p_hospital_id AND o.status = 'completed'
    AND o.actual_end_time >= p_from AND o.actual_end_time < p_to
),
ot_sched AS (
  SELECT o.id, o.status FROM public.ot_schedules o
  WHERE o.hospital_id = p_hospital_id
    AND o.scheduled_date >= p_from::date AND o.scheduled_date < p_to::date
),
cb AS (
  SELECT e.rosc_achieved FROM public.code_blue_events e
  WHERE e.hospital_id = p_hospital_id AND NOT e.is_deleted
    AND e.event_datetime >= p_from AND e.event_datetime < p_to
),
pd AS (SELECT public.qi_patient_days(p_hospital_id, p_from, p_to) AS days)
SELECT 'cop.mortality_pct',
       count(*) FILTER (WHERE lower(COALESCE(discharge_type, '')) = 'death')::numeric,
       NULLIF(count(*), 0)::numeric FROM disch
UNION ALL
SELECT 'cop.code_blue_per1000', (SELECT count(*)::numeric FROM cb),
       NULLIF((SELECT count(*) FROM disch), 0)::numeric
UNION ALL
SELECT 'cop.rosc_pct', count(*) FILTER (WHERE rosc_achieved)::numeric,
       NULLIF(count(*), 0)::numeric FROM cb
UNION ALL
SELECT 'cop.who_checklist_pct',
       (SELECT count(*)::numeric FROM public.ot_checklists c
         WHERE c.hospital_id = p_hospital_id AND c.ot_schedule_id IN (SELECT id FROM ot_done)
           AND c.signin_completed_at IS NOT NULL AND c.timeout_completed_at IS NOT NULL
           AND c.signout_completed_at IS NOT NULL),
       NULLIF((SELECT count(*) FROM ot_done), 0)::numeric
UNION ALL
SELECT 'cop.ot_cancellation_pct',
       count(*) FILTER (WHERE status IN ('cancelled','postponed'))::numeric,
       NULLIF(count(*), 0)::numeric FROM ot_sched
UNION ALL
-- scheduled_start_time is a `time`, actual_start_time a `timestamptz`; compose
-- the scheduled instant from scheduled_date before subtracting. Early starts
-- clamp to zero so they cannot offset genuine delays.
SELECT 'cop.ot_start_delay_min',
       COALESCE(SUM(GREATEST(EXTRACT(epoch FROM (
         actual_start_time - (scheduled_date + scheduled_start_time)::timestamptz)) / 60.0, 0)), 0),
       NULLIF(count(*) FILTER (WHERE actual_start_time IS NOT NULL), 0)::numeric
FROM ot_done WHERE actual_start_time IS NOT NULL
UNION ALL
SELECT 'cop.instrument_count_discrepancy_pct',
       count(*) FILTER (WHERE ic.opening_count IS DISTINCT FROM ic.closing_count
                           OR NULLIF(btrim(COALESCE(ic.discrepancy_notes, '')), '') IS NOT NULL)::numeric,
       NULLIF(count(*), 0)::numeric
FROM public.ot_instrument_counts ic
WHERE ic.hospital_id = p_hospital_id AND ic.ot_schedule_id IN (SELECT id FROM ot_done)
UNION ALL
SELECT 'cop.transfusion_reaction_per1000',
       (SELECT count(*)::numeric FROM public.transfusion_reactions tr
         WHERE tr.hospital_id = p_hospital_id
           AND tr.reported_at >= p_from AND tr.reported_at < p_to),
       NULLIF((SELECT count(*) FROM public.blood_issues bi
                WHERE bi.hospital_id = p_hospital_id
                  AND bi.issued_at >= p_from AND bi.issued_at < p_to), 0)::numeric
UNION ALL
SELECT 'cop.blood_return_pct',
       count(*) FILTER (WHERE returned)::numeric, NULLIF(count(*), 0)::numeric
FROM public.blood_issues bi
WHERE bi.hospital_id = p_hospital_id AND bi.issued_at >= p_from AND bi.issued_at < p_to
UNION ALL
-- Hospital-acquired inferred from a >48h gap after admission: wound_assessments
-- has no present-on-admission flag.
SELECT 'cop.pressure_injury_per1000',
       (SELECT count(DISTINCT w.admission_id)::numeric
          FROM public.wound_assessments w
          JOIN public.admissions a2 ON a2.id = w.admission_id
         WHERE w.hospital_id = p_hospital_id
           AND w.assessed_at >= p_from AND w.assessed_at < p_to
           AND (lower(COALESCE(w.wound_type, '')) LIKE '%pressure%'
                OR lower(COALESCE(w.stage, '')) LIKE 'stage%')
           AND a2.admitted_at IS NOT NULL
           AND w.assessed_at > a2.admitted_at + interval '48 hours'),
       (SELECT NULLIF(days, 0) FROM pd)
UNION ALL
SELECT 'cop.braden_24h_pct',
       count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM public.braden_scale_assessments b
         WHERE b.hospital_id = p_hospital_id AND b.admission_id = adm.id
           AND b.assessed_at <= adm.admitted_at + interval '24 hours'))::numeric,
       NULLIF(count(*), 0)::numeric FROM adm
UNION ALL
SELECT 'cop.restraint_per1000',
       (SELECT count(*)::numeric FROM public.restraint_records r
         WHERE r.hospital_id = p_hospital_id
           AND r.applied_at >= p_from AND r.applied_at < p_to),
       (SELECT NULLIF(days, 0) FROM pd)
UNION ALL
SELECT 'cop.pain_reassessed_pct',
       COALESCE(SUM(pain_reassessed_4hourly), 0)::numeric,
       NULLIF(COALESCE(SUM(total_patients_audited), 0), 0)::numeric
FROM public.pain_audit_records pa
WHERE pa.hospital_id = p_hospital_id
  AND pa.audit_date >= p_from::date AND pa.audit_date < p_to::date
UNION ALL
SELECT 'cop.analgesia_30min_pct',
       COALESCE(SUM(analgesic_given_within_30min), 0)::numeric,
       NULLIF(COALESCE(SUM(total_patients_audited), 0), 0)::numeric
FROM public.pain_audit_records pa
WHERE pa.hospital_id = p_hospital_id
  AND pa.audit_date >= p_from::date AND pa.audit_date < p_to::date
UNION ALL
SELECT 'cop.ed_los_min',
       COALESCE(SUM(EXTRACT(epoch FROM (disposition_time - arrival_time)) / 60.0), 0),
       NULLIF(count(*), 0)::numeric
FROM public.ed_visits ev
WHERE ev.hospital_id = p_hospital_id
  AND ev.disposition_time >= p_from AND ev.disposition_time < p_to
  AND ev.disposition_time > ev.arrival_time
UNION ALL
-- No FK links ed_visits to ot_schedules; match on patient within 24h of arrival.
SELECT 'cop.ertos_trauma_min',
       COALESCE(SUM(EXTRACT(epoch FROM (o.actual_start_time - ev.arrival_time)) / 60.0), 0),
       NULLIF(count(*), 0)::numeric
FROM public.ed_visits ev
JOIN LATERAL (
  SELECT o2.actual_start_time FROM public.ot_schedules o2
  WHERE o2.hospital_id = p_hospital_id AND o2.patient_id = ev.patient_id
    AND o2.actual_start_time > ev.arrival_time
    AND o2.actual_start_time <= ev.arrival_time + interval '24 hours'
  ORDER BY o2.actual_start_time LIMIT 1
) o ON true
WHERE ev.hospital_id = p_hospital_id
  AND ev.arrival_time >= p_from AND ev.arrival_time < p_to;
$$;

-- ─── Diagnostics (lab + radiology) ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.qi_collect_lab(
  p_hospital_id uuid, p_from timestamptz, p_to timestamptz
) RETURNS TABLE(indicator_code text, numerator numeric, denominator numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
WITH tat AS (
  SELECT EXTRACT(epoch FROM (li.validated_at - COALESCE(li.sample_collected_at, lo.order_time))) / 3600.0 AS tat_hrs,
         CASE WHEN lower(COALESCE(lo.priority, '')) IN ('stat','urgent','emergency')
              THEN 1.0 ELSE 4.0 END AS threshold_hrs
  FROM public.lab_order_items li
  JOIN public.lab_orders lo ON lo.id = li.lab_order_id
  WHERE li.hospital_id = p_hospital_id
    AND li.validated_at >= p_from AND li.validated_at < p_to
    -- Guard against back-dated collection times producing negative TAT, which
    -- would silently drag the average down.
    AND li.validated_at > COALESCE(li.sample_collected_at, lo.order_time)
)
SELECT 'cop.lab_tat_avg_hrs', COALESCE(SUM(tat_hrs), 0), NULLIF(count(*), 0)::numeric FROM tat
UNION ALL
SELECT 'cop.lab_tat_breach_pct',
       count(*) FILTER (WHERE tat_hrs > threshold_hrs)::numeric,
       NULLIF(count(*), 0)::numeric FROM tat
UNION ALL
SELECT 'cop.lab_critical_ack_pct',
       count(*) FILTER (WHERE li.critical_acknowledged)::numeric, NULLIF(count(*), 0)::numeric
FROM public.lab_order_items li
WHERE li.hospital_id = p_hospital_id AND lower(COALESCE(li.result_flag, '')) = 'critical'
  AND li.result_entered_at >= p_from AND li.result_entered_at < p_to
UNION ALL
SELECT 'cop.lab_sample_reject_pct',
       count(*) FILTER (WHERE NULLIF(btrim(COALESCE(s.rejection_reason, '')), '') IS NOT NULL)::numeric,
       NULLIF(count(*), 0)::numeric
FROM public.lab_samples s
WHERE s.hospital_id = p_hospital_id AND s.collected_at >= p_from AND s.collected_at < p_to
UNION ALL
SELECT 'cop.radiology_tat_hrs',
       COALESCE(SUM(EXTRACT(epoch FROM (rr.validated_at - ro.order_time)) / 3600.0), 0),
       NULLIF(count(*), 0)::numeric
FROM public.radiology_reports rr
JOIN public.radiology_orders ro ON ro.id = rr.order_id
WHERE rr.hospital_id = p_hospital_id
  AND rr.validated_at >= p_from AND rr.validated_at < p_to
  AND rr.validated_at > ro.order_time;
$$;

-- ─── MOM ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.qi_collect_mom(
  p_hospital_id uuid, p_from timestamptz, p_to timestamptz
) RETURNS TABLE(indicator_code text, numerator numeric, denominator numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_src    text := public.qi_safety_source(p_hospital_id);
  v_errors numeric;
  v_doses  numeric;
BEGIN
  IF v_src = 'safety_events' THEN
    SELECT count(*)::numeric INTO v_errors FROM public.safety_events
    WHERE hospital_id = p_hospital_id AND category = 'medication_error'
      AND reported_at >= p_from AND reported_at < p_to;
  ELSE
    SELECT count(*)::numeric INTO v_errors FROM public.incident_reports
    WHERE hospital_id = p_hospital_id AND incident_type = 'medication_error'
      AND incident_date >= p_from::date AND incident_date < p_to::date;
  END IF;

  SELECT COALESCE((SELECT count(*) FROM public.nursing_mar nm
                    WHERE nm.hospital_id = p_hospital_id
                      AND nm.administered_at >= p_from AND nm.administered_at < p_to), 0)
       + COALESCE((SELECT count(*) FROM public.mar_records mr
                    WHERE mr.hospital_id = p_hospital_id
                      AND mr.administered_at >= p_from AND mr.administered_at < p_to), 0)
    INTO v_doses;

  RETURN QUERY SELECT 'mom.med_error_per1000', v_errors, NULLIF(v_doses, 0);

  RETURN QUERY
  SELECT 'mom.mar_compliance_pct',
         count(*) FILTER (WHERE lower(COALESCE(nm.outcome, '')) IN ('administered','given'))::numeric,
         NULLIF(count(*), 0)::numeric
  FROM public.nursing_mar nm
  WHERE nm.hospital_id = p_hospital_id
    AND nm.scheduled_date >= p_from::date AND nm.scheduled_date < p_to::date;

  RETURN QUERY
  SELECT 'mom.high_alert_double_check_pct',
         count(*) FILTER (WHERE h.both_verified)::numeric, NULLIF(count(*), 0)::numeric
  FROM public.high_alert_double_checks h
  WHERE h.hospital_id = p_hospital_id
    AND h.first_check_at >= p_from AND h.first_check_at < p_to;

  RETURN QUERY
  SELECT 'mom.med_recon_admission_pct',
         (SELECT count(DISTINCT m.admission_id)::numeric
            FROM public.med_reconciliation_events m
           WHERE m.hospital_id = p_hospital_id AND m.event_type = 'admission'
             AND m.reconciled_at >= p_from AND m.reconciled_at < p_to),
         NULLIF((SELECT count(*) FROM public.admissions a
                  WHERE a.hospital_id = p_hospital_id
                    AND a.admitted_at >= p_from AND a.admitted_at < p_to), 0)::numeric;

  RETURN QUERY
  SELECT 'mom.med_recon_unresolved_pct',
         COALESCE(SUM(m.unresolved_count), 0)::numeric,
         NULLIF(COALESCE(SUM(m.discrepancy_count), 0), 0)::numeric
  FROM public.med_reconciliation_events m
  WHERE m.hospital_id = p_hospital_id
    AND m.reconciled_at >= p_from AND m.reconciled_at < p_to;

  RETURN QUERY
  SELECT 'mom.antibiotic_justified_pct',
         count(*) FILTER (WHERE aj.approved)::numeric, NULLIF(count(*), 0)::numeric
  FROM public.antibiotic_justifications aj
  WHERE aj.hospital_id = p_hospital_id AND NOT aj.is_deleted
    AND aj.created_at >= p_from AND aj.created_at < p_to;
END $$;

-- ─── PRE (grievances) ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.qi_collect_pre_grievances(
  p_hospital_id uuid, p_from timestamptz, p_to timestamptz
) RETURNS TABLE(indicator_code text, numerator numeric, denominator numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
WITH g AS (
  SELECT gr.created_at, gr.resolved_at, gr.sla_breached,
         COALESCE(gr.tat_hours,
                  EXTRACT(epoch FROM (gr.resolved_at - gr.created_at)) / 3600.0) AS tat_hrs
  FROM public.grievances gr
  WHERE gr.hospital_id = p_hospital_id
    AND gr.created_at >= p_from AND gr.created_at < p_to
)
-- Denominator is complaints RAISED, not resolved: a hospital that never closes
-- anything must not score 100%.
SELECT 'pre.complaint_resolved_7d_pct',
       count(*) FILTER (WHERE resolved_at IS NOT NULL
                          AND resolved_at <= created_at + interval '7 days')::numeric,
       NULLIF(count(*), 0)::numeric FROM g
UNION ALL
SELECT 'pre.complaint_tat_hrs',
       COALESCE(SUM(tat_hrs) FILTER (WHERE resolved_at IS NOT NULL AND tat_hrs >= 0), 0),
       NULLIF(count(*) FILTER (WHERE resolved_at IS NOT NULL AND tat_hrs >= 0), 0)::numeric FROM g
UNION ALL
SELECT 'pre.complaint_sla_breach_pct',
       count(*) FILTER (WHERE sla_breached)::numeric, NULLIF(count(*), 0)::numeric FROM g;
$$;

-- ─── PRE (experience + consent) ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.qi_collect_pre_experience(
  p_hospital_id uuid, p_from timestamptz, p_to timestamptz
) RETURNS TABLE(indicator_code text, numerator numeric, denominator numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
WITH ot_done AS (
  SELECT o.id FROM public.ot_schedules o
  WHERE o.hospital_id = p_hospital_id AND o.status = 'completed'
    AND o.actual_end_time >= p_from AND o.actual_end_time < p_to
),
surveys AS (
  SELECT s.status, s.prem_overall, s.responded_at FROM public.prom_prem_surveys s
  WHERE s.hospital_id = p_hospital_id AND NOT s.is_deleted
    AND s.sent_at >= p_from AND s.sent_at < p_to
)
SELECT 'pre.consent_pct',
       (SELECT count(*)::numeric FROM public.ot_checklists c
         WHERE c.hospital_id = p_hospital_id AND c.ot_schedule_id IN (SELECT id FROM ot_done)
           AND c.signin_consent_signed),
       NULLIF((SELECT count(*) FROM ot_done), 0)::numeric
UNION ALL
SELECT 'pre.prem_satisfaction_pct',
       COALESCE(SUM(prem_overall), 0)::numeric,
       NULLIF(count(*) FILTER (WHERE prem_overall IS NOT NULL) * 5, 0)::numeric FROM surveys
UNION ALL
SELECT 'pre.survey_response_pct',
       count(*) FILTER (WHERE status = 'responded')::numeric,
       NULLIF(count(*), 0)::numeric FROM surveys
UNION ALL
SELECT 'pre.nps',
       (count(*) FILTER (WHERE score >= 9) - count(*) FILTER (WHERE score <= 6))::numeric,
       NULLIF(count(*), 0)::numeric
FROM public.nps_responses n
WHERE n.hospital_id = p_hospital_id AND n.responded_at >= p_from AND n.responded_at < p_to
UNION ALL
SELECT 'pre.csat_pct',
       COALESCE(SUM(f.overall_csat), 0)::numeric,
       NULLIF(count(*) FILTER (WHERE f.overall_csat IS NOT NULL) * 5, 0)::numeric
FROM public.feedback_records f
WHERE f.hospital_id = p_hospital_id AND f.created_at >= p_from AND f.created_at < p_to;
$$;

-- ─── HIC (non-device) ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.qi_collect_hic(
  p_hospital_id uuid, p_from timestamptz, p_to timestamptz
) RETURNS TABLE(indicator_code text, numerator numeric, denominator numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
WITH pd AS (SELECT public.qi_patient_days(p_hospital_id, p_from, p_to) AS days),
staff AS (SELECT public.qi_active_staff(p_hospital_id) AS n),
exposures AS (
  SELECT o.pep_given FROM public.occupational_health_records o
  WHERE o.hospital_id = p_hospital_id
    AND o.record_type IN ('needle_stick','blood_exposure')
    AND o.event_date >= p_from::date AND o.event_date < p_to::date
),
hh AS (
  SELECT COALESCE(h.total_compliant,
           COALESCE(h.m1_before_patient_contact_done,0) + COALESCE(h.m2_before_aseptic_done,0)
         + COALESCE(h.m3_after_body_fluid_done,0) + COALESCE(h.m4_after_patient_contact_done,0)
         + COALESCE(h.m5_after_touching_surroundings_done,0)) AS compliant,
         COALESCE(h.total_opportunities,
           COALESCE(h.m1_before_patient_contact_total,0) + COALESCE(h.m2_before_aseptic_total,0)
         + COALESCE(h.m3_after_body_fluid_total,0) + COALESCE(h.m4_after_patient_contact_total,0)
         + COALESCE(h.m5_after_touching_surroundings_total,0)) AS opportunities
  FROM public.hand_hygiene_audits h
  WHERE h.hospital_id = p_hospital_id
    AND h.audit_date >= p_from::date AND h.audit_date < p_to::date
),
cycles AS (
  SELECT c.bi_result, c.flash_justification FROM public.sterilization_cycles c
  WHERE c.hospital_id = p_hospital_id
    AND c.cycle_start_at >= p_from AND c.cycle_start_at < p_to
)
SELECT 'hic.ssi_pct',
       (SELECT count(*)::numeric FROM public.ipc_infection_events e
         WHERE e.hospital_id = p_hospital_id AND e.infection_type = 'SSI'
           AND e.onset_date >= p_from::date AND e.onset_date < p_to::date),
       NULLIF((SELECT count(*) FROM public.ot_schedules o
                WHERE o.hospital_id = p_hospital_id AND o.status = 'completed'
                  AND o.actual_end_time >= p_from AND o.actual_end_time < p_to), 0)::numeric
UNION ALL
SELECT 'hic.hai_per1000',
       (SELECT count(*)::numeric FROM public.ipc_infection_events e
         WHERE e.hospital_id = p_hospital_id
           AND e.onset_date >= p_from::date AND e.onset_date < p_to::date),
       (SELECT NULLIF(days, 0) FROM pd)
UNION ALL
SELECT 'hic.hand_hygiene_pct',
       COALESCE(SUM(compliant), 0)::numeric, NULLIF(COALESCE(SUM(opportunities), 0), 0)::numeric FROM hh
UNION ALL
SELECT 'hic.bundle_compliance_pct',
       count(*) FILTER (WHERE b.compliance_pct >= 100)::numeric, NULLIF(count(*), 0)::numeric
FROM public.ipc_bundle_checklists b
WHERE b.hospital_id = p_hospital_id
  AND b.checklist_date >= p_from::date AND b.checklist_date < p_to::date
UNION ALL
SELECT 'hic.needle_stick_per1000', (SELECT count(*)::numeric FROM exposures), (SELECT n FROM staff)
UNION ALL
SELECT 'hic.pep_initiation_pct',
       count(*) FILTER (WHERE pep_given)::numeric, NULLIF(count(*), 0)::numeric FROM exposures
UNION ALL
SELECT 'hic.sterilization_bi_pass_pct',
       count(*) FILTER (WHERE lower(COALESCE(bi_result, '')) IN ('pass','passed','negative'))::numeric,
       NULLIF(count(*) FILTER (WHERE bi_result IS NOT NULL), 0)::numeric FROM cycles
UNION ALL
SELECT 'hic.flash_sterilization_pct',
       count(*) FILTER (WHERE NULLIF(btrim(COALESCE(flash_justification, '')), '') IS NOT NULL)::numeric,
       NULLIF(count(*), 0)::numeric FROM cycles
UNION ALL
SELECT 'hic.bmw_kg_per_patient_day',
       (SELECT COALESCE(SUM(w.total_kg), 0)::numeric FROM public.bmw_records w
         WHERE w.hospital_id = p_hospital_id
           AND w.record_date >= p_from::date AND w.record_date < p_to::date),
       (SELECT NULLIF(days, 0) FROM pd);
$$;

-- ─── HIC (device-associated) ─────────────────────────────────────────────────
-- The indicator the metrics registry flags as "not a true rate" today: the raw
-- infection count was never divided by device-days exposure.
CREATE OR REPLACE FUNCTION public.qi_collect_hic_device(
  p_hospital_id uuid, p_from timestamptz, p_to timestamptz
) RETURNS TABLE(indicator_code text, numerator numeric, denominator numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
WITH device_days AS (
  SELECT d.device_type,
         SUM(EXTRACT(epoch FROM (
               LEAST(COALESCE(d.device_removed_at, p_to), p_to)
             - GREATEST(d.device_inserted_at, p_from))) / 86400.0) AS days
  FROM public.ipc_device_usage d
  WHERE d.hospital_id = p_hospital_id
    AND d.device_inserted_at < p_to
    AND COALESCE(d.device_removed_at, p_to) > p_from
  GROUP BY d.device_type
),
events AS (
  SELECT e.infection_type, count(*)::numeric AS n
  FROM public.ipc_infection_events e
  WHERE e.hospital_id = p_hospital_id
    AND e.onset_date >= p_from::date AND e.onset_date < p_to::date
  GROUP BY e.infection_type
),
m(code, infection_type, device_type) AS (VALUES
  ('hic.clabsi_per1000', 'CLABSI', 'central_line'),
  ('hic.cauti_per1000',  'CAUTI',  'urinary_catheter'),
  ('hic.vap_per1000',    'VAP',    'ventilator')
)
SELECT m.code, COALESCE(ev.n, 0),
       -- NULL when the device was never used: yields a NULL value with a note,
       -- not a count masquerading as a per-1000 rate.
       NULLIF(dd.days, 0)
FROM m
LEFT JOIN events      ev ON ev.infection_type = m.infection_type
LEFT JOIN device_days dd ON dd.device_type    = m.device_type;
$$;

-- ─── ROM ─────────────────────────────────────────────────────────────────────
-- committee_meetings and committee_action_items carry no hospital_id; they are
-- scoped through hospital_committees.
CREATE OR REPLACE FUNCTION public.qi_collect_rom(
  p_hospital_id uuid, p_from timestamptz, p_to timestamptz
) RETURNS TABLE(indicator_code text, numerator numeric, denominator numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
WITH meetings AS (
  SELECT cm.id, cm.quorum_met, cm.meeting_date
  FROM public.committee_meetings cm
  JOIN public.hospital_committees hc ON hc.id = cm.committee_id
  WHERE hc.hospital_id = p_hospital_id
),
in_period AS (
  SELECT * FROM meetings
  WHERE meeting_date >= p_from::date AND meeting_date < p_to::date
),
actions AS (
  SELECT ai.status, ai.due_date
  FROM public.committee_action_items ai
  JOIN meetings m ON m.id = ai.meeting_id
  WHERE ai.due_date >= p_from::date AND ai.due_date < p_to::date
)
SELECT 'rom.committee_quorum_pct',
       count(*) FILTER (WHERE quorum_met)::numeric, NULLIF(count(*), 0)::numeric FROM in_period
UNION ALL
SELECT 'rom.committee_action_closure_pct',
       count(*) FILTER (WHERE lower(COALESCE(status, '')) IN ('completed','closed','done'))::numeric,
       NULLIF(count(*), 0)::numeric FROM actions;
$$;

-- ─── FMS ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.qi_collect_fms(
  p_hospital_id uuid, p_from timestamptz, p_to timestamptz
) RETURNS TABLE(indicator_code text, numerator numeric, denominator numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
WITH equip AS (
  SELECT e.id, e.amc_expiry FROM public.equipment_master e
  WHERE e.hospital_id = p_hospital_id AND COALESCE(e.is_active, true)
),
drills AS (
  SELECT d.fire_exits_clear, d.time_to_evacuate_mins FROM public.fire_safety_drills d
  WHERE d.hospital_id = p_hospital_id
    AND d.drill_date >= p_from::date AND d.drill_date < p_to::date
)
SELECT 'fms.pm_ontime_pct',
       count(*) FILTER (WHERE p.done_at IS NOT NULL AND p.done_at <= p.next_due_at)::numeric,
       NULLIF(count(*), 0)::numeric
FROM public.pm_schedules p
WHERE p.hospital_id = p_hospital_id
  AND p.next_due_at >= p_from AND p.next_due_at < p_to
UNION ALL
SELECT 'fms.equipment_downtime_hrs',
       (SELECT COALESCE(SUM(b.downtime_hrs), 0)::numeric FROM public.breakdown_logs b
         WHERE b.hospital_id = p_hospital_id
           AND b.reported_at >= p_from AND b.reported_at < p_to),
       NULLIF((SELECT count(*) FROM equip), 0)::numeric
UNION ALL
SELECT 'fms.calibration_valid_pct',
       (SELECT count(*)::numeric FROM equip e WHERE EXISTS (
          SELECT 1 FROM public.calibration_records c
          WHERE c.hospital_id = p_hospital_id AND c.equipment_id = e.id
            AND c.next_due >= (p_to - interval '1 day')::date)),
       NULLIF((SELECT count(*) FROM equip), 0)::numeric
UNION ALL
SELECT 'fms.fire_drill_count', (SELECT count(*)::numeric FROM drills), 1::numeric
UNION ALL
SELECT 'fms.fire_exits_clear_pct',
       count(*) FILTER (WHERE fire_exits_clear)::numeric, NULLIF(count(*), 0)::numeric FROM drills
UNION ALL
SELECT 'fms.evacuation_time_min',
       COALESCE(SUM(time_to_evacuate_mins), 0)::numeric,
       NULLIF(count(*) FILTER (WHERE time_to_evacuate_mins IS NOT NULL), 0)::numeric FROM drills
UNION ALL
SELECT 'fms.amc_expiring_count',
       (SELECT count(*)::numeric FROM equip
         WHERE amc_expiry IS NOT NULL
           AND amc_expiry >= p_to::date
           AND amc_expiry <= (p_to + interval '30 days')::date), 1::numeric;
$$;

-- ─── HRM ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.qi_collect_hrm(
  p_hospital_id uuid, p_from timestamptz, p_to timestamptz
) RETURNS TABLE(indicator_code text, numerator numeric, denominator numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
WITH staff AS (SELECT public.qi_active_staff(p_hospital_id) AS n),
injuries AS (
  SELECT i.days_lost FROM public.staff_injuries i
  WHERE i.hospital_id = p_hospital_id
    AND i.incident_date >= p_from::date AND i.incident_date < p_to::date
)
SELECT 'hrm.training_hours_per_staff',
       (SELECT COALESCE(SUM(t.hours), 0)::numeric FROM public.staff_training_records t
         WHERE t.hospital_id = p_hospital_id AND t.completed
           AND t.end_date >= p_from::date AND t.end_date < p_to::date),
       (SELECT n FROM staff)
UNION ALL
SELECT 'hrm.mandatory_training_pct',
       (SELECT count(DISTINCT t.user_id)::numeric FROM public.staff_training_records t
         WHERE t.hospital_id = p_hospital_id AND t.completed
           AND t.end_date >= (p_to - interval '12 months')::date AND t.end_date < p_to::date
           AND (lower(COALESCE(t.training_title, '')) ~ '(bls|acls|fire|infection|safety|hand hygiene|bmw)'
             OR lower(COALESCE(t.training_type,  '')) ~ '(mandatory|induction|statutory)')),
       (SELECT n FROM staff)
UNION ALL
SELECT 'hrm.credential_valid_pct',
       count(*) FILTER (WHERE c.verified AND (c.expiry_date IS NULL OR c.expiry_date >= p_to::date))::numeric,
       NULLIF(count(*), 0)::numeric
FROM public.staff_credentials c WHERE c.hospital_id = p_hospital_id
UNION ALL
SELECT 'hrm.attrition_pct',
       (SELECT count(*)::numeric FROM public.staff_exits x
         WHERE x.hospital_id = p_hospital_id
           AND x.last_working_day >= p_from::date AND x.last_working_day < p_to::date),
       (SELECT n FROM staff)
UNION ALL
SELECT 'hrm.staff_injury_per1000', (SELECT count(*)::numeric FROM injuries), (SELECT n FROM staff)
UNION ALL
SELECT 'hrm.injury_days_lost',
       COALESCE(SUM(days_lost), 0)::numeric, NULLIF(count(*), 0)::numeric FROM injuries;
$$;

-- ─── IMS ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.qi_collect_ims(
  p_hospital_id uuid, p_from timestamptz, p_to timestamptz
) RETURNS TABLE(indicator_code text, numerator numeric, denominator numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
WITH disch AS (
  SELECT a.id, a.discharge_summary_done, a.discharge_type FROM public.admissions a
  WHERE a.hospital_id = p_hospital_id AND a.discharged_at >= p_from AND a.discharged_at < p_to
)
SELECT 'ims.record_completeness_pct',
       count(*) FILTER (WHERE d.discharge_summary_done AND EXISTS (
         SELECT 1 FROM public.icd_codings ic
         WHERE ic.hospital_id = p_hospital_id AND ic.visit_id = d.id
           AND ic.primary_icd_code IS NOT NULL))::numeric,
       NULLIF(count(*), 0)::numeric FROM disch d
UNION ALL
-- corrected_code is NOT NULL on this table, so "accurate" means the auditor
-- confirmed the original rather than leaving the correction blank.
SELECT 'ims.coding_accuracy_pct',
       count(*) FILTER (WHERE ca.corrected_code = ca.original_code)::numeric,
       NULLIF(count(*), 0)::numeric
FROM public.coding_audits ca
WHERE ca.hospital_id = p_hospital_id
  AND ca.audit_date >= p_from::date AND ca.audit_date < p_to::date
UNION ALL
SELECT 'ims.mccd_completion_pct',
       (SELECT count(*)::numeric FROM public.mccd_certificates mc
         WHERE mc.hospital_id = p_hospital_id
           AND mc.issued_at >= p_from AND mc.issued_at < p_to),
       NULLIF((SELECT count(*) FROM disch WHERE lower(COALESCE(discharge_type, '')) = 'death'), 0)::numeric;
$$;

-- ─── QPS ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.qi_collect_qps(
  p_hospital_id uuid, p_from timestamptz, p_to timestamptz
) RETURNS TABLE(indicator_code text, numerator numeric, denominator numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
WITH adm AS (
  SELECT a.id, a.admitted_at FROM public.admissions a
  WHERE a.hospital_id = p_hospital_id AND a.admitted_at >= p_from AND a.admitted_at < p_to
),
fra AS (
  -- assessment_date is a `date`, not a timestamp, so the 24-hour window below
  -- is evaluated at day granularity.
  SELECT f.admission_id, f.risk_level, f.fall_precautions_initiated, f.assessment_date
  FROM public.fall_risk_assessments f
  WHERE f.hospital_id = p_hospital_id
    AND f.assessment_date >= p_from::date AND f.assessment_date < p_to::date
),
sev AS (
  SELECT e.id FROM public.safety_events e
  WHERE e.hospital_id = p_hospital_id
    AND e.reported_at >= p_from AND e.reported_at < p_to
    AND (e.event_type = 'sentinel' OR e.severity IN ('severe','death'))
),
capa AS (
  SELECT c.status, c.due_date, c.completed_date FROM public.capa_records c
  WHERE c.hospital_id = p_hospital_id
)
SELECT 'qps.fall_risk_24h_pct',
       count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM fra WHERE fra.admission_id = adm.id
           AND fra.assessment_date <= (adm.admitted_at + interval '24 hours')::date))::numeric,
       NULLIF(count(*), 0)::numeric FROM adm
UNION ALL
SELECT 'qps.high_risk_precautions_pct',
       count(*) FILTER (WHERE fall_precautions_initiated)::numeric,
       NULLIF(count(*) FILTER (WHERE lower(COALESCE(risk_level, '')) = 'high'), 0)::numeric
FROM fra WHERE lower(COALESCE(risk_level, '')) = 'high'
UNION ALL
SELECT 'qps.sentinel_count', (SELECT count(*)::numeric FROM sev), 1::numeric
UNION ALL
SELECT 'qps.rca_completion_pct',
       (SELECT count(*)::numeric FROM sev
         WHERE EXISTS (SELECT 1 FROM public.safety_event_rca r
                        WHERE r.safety_event_id = sev.id AND r.completed_at IS NOT NULL)),
       NULLIF((SELECT count(*) FROM sev), 0)::numeric
UNION ALL
SELECT 'qps.capa_ontime_closure_pct',
       count(*) FILTER (WHERE completed_date IS NOT NULL AND completed_date <= due_date)::numeric,
       NULLIF(count(*), 0)::numeric
FROM capa WHERE due_date >= p_from::date AND due_date < p_to::date
UNION ALL
SELECT 'qps.capa_overdue_pct',
       count(*) FILTER (WHERE lower(COALESCE(status, 'open')) NOT IN ('completed','closed','verified')
                          AND due_date < p_to::date)::numeric,
       NULLIF(count(*) FILTER (WHERE lower(COALESCE(status, 'open')) NOT IN ('completed','closed','verified')), 0)::numeric
FROM capa WHERE due_date IS NOT NULL;
$$;

-- ─── QPS (incident-store dependent) ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.qi_collect_qps_falls(
  p_hospital_id uuid, p_from timestamptz, p_to timestamptz
) RETURNS TABLE(indicator_code text, numerator numeric, denominator numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_src       text    := public.qi_safety_source(p_hospital_id);
  v_falls     numeric;
  v_incidents numeric;
  v_days      numeric := public.qi_patient_days(p_hospital_id, p_from, p_to);
  v_beds      numeric := public.qi_active_beds(p_hospital_id);
BEGIN
  IF v_src = 'safety_events' THEN
    SELECT count(*) FILTER (WHERE category = 'fall')::numeric, count(*)::numeric
      INTO v_falls, v_incidents
    FROM public.safety_events
    WHERE hospital_id = p_hospital_id AND reported_at >= p_from AND reported_at < p_to;
  ELSE
    SELECT count(*) FILTER (WHERE incident_type = 'fall')::numeric, count(*)::numeric
      INTO v_falls, v_incidents
    FROM public.incident_reports
    WHERE hospital_id = p_hospital_id
      AND incident_date >= p_from::date AND incident_date < p_to::date;
  END IF;

  RETURN QUERY SELECT 'qps.fall_per1000',             v_falls,     NULLIF(v_days, 0);
  RETURN QUERY SELECT 'qps.incident_report_per100beds', v_incidents, v_beds;
END $$;

-- ═══ Orchestrator ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.run_quality_indicator_collection(
  p_hospital_id  uuid,
  p_period_start date DEFAULT date_trunc('month', current_date)::date,
  p_period       text DEFAULT 'monthly'
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_from timestamptz;
  v_to   timestamptz;
  v_n    integer;
BEGIN
  -- A browser user may only collect for their own hospital. auth.uid() IS NULL
  -- means pg_cron or service_role, which legitimately runs for every tenant.
  IF auth.uid() IS NOT NULL
     AND p_hospital_id IS DISTINCT FROM public.get_user_hospital_id()
     AND NOT public.is_aumrti_admin() THEN
    RAISE EXCEPTION 'not authorised for hospital %', p_hospital_id USING ERRCODE = '42501';
  END IF;

  IF p_period NOT IN ('monthly','quarterly','yearly') THEN
    RAISE EXCEPTION 'unsupported period: %', p_period USING ERRCODE = '22023';
  END IF;

  v_from := p_period_start::timestamptz;
  v_to   := (p_period_start + CASE p_period
                                WHEN 'monthly'   THEN interval '1 month'
                                WHEN 'quarterly' THEN interval '3 months'
                                ELSE                  interval '1 year'
                              END)::timestamptz;

  WITH raw AS (
    SELECT * FROM public.qi_collect_aac(p_hospital_id, v_from, v_to)
    UNION ALL SELECT * FROM public.qi_collect_cop(p_hospital_id, v_from, v_to)
    UNION ALL SELECT * FROM public.qi_collect_lab(p_hospital_id, v_from, v_to)
    UNION ALL SELECT * FROM public.qi_collect_mom(p_hospital_id, v_from, v_to)
    UNION ALL SELECT * FROM public.qi_collect_pre_grievances(p_hospital_id, v_from, v_to)
    UNION ALL SELECT * FROM public.qi_collect_pre_experience(p_hospital_id, v_from, v_to)
    UNION ALL SELECT * FROM public.qi_collect_hic(p_hospital_id, v_from, v_to)
    UNION ALL SELECT * FROM public.qi_collect_hic_device(p_hospital_id, v_from, v_to)
    UNION ALL SELECT * FROM public.qi_collect_rom(p_hospital_id, v_from, v_to)
    UNION ALL SELECT * FROM public.qi_collect_fms(p_hospital_id, v_from, v_to)
    UNION ALL SELECT * FROM public.qi_collect_hrm(p_hospital_id, v_from, v_to)
    UNION ALL SELECT * FROM public.qi_collect_ims(p_hospital_id, v_from, v_to)
    UNION ALL SELECT * FROM public.qi_collect_qps(p_hospital_id, v_from, v_to)
    UNION ALL SELECT * FROM public.qi_collect_qps_falls(p_hospital_id, v_from, v_to)
  )
  INSERT INTO public.quality_indicators (
    hospital_id, indicator_code, indicator_name, category, nabh_chapter,
    numerator, denominator, value, unit, direction, target, benchmark,
    period, period_start, period_end, data_source, auto_calculated, computed_at, notes
  )
  SELECT
    p_hospital_id, d.indicator_code, d.display_name, d.category, d.nabh_chapter,
    r.numerator, r.denominator,
    CASE WHEN r.denominator IS NULL OR r.denominator = 0 THEN NULL
         ELSE round(r.numerator * d.multiplier / r.denominator, 4) END,
    d.unit, d.direction,
    COALESCE(o.target, d.default_target), COALESCE(o.benchmark, d.default_benchmark),
    p_period, p_period_start, (v_to - interval '1 day')::date,
    'auto:' || d.indicator_code, true, now(),
    CASE WHEN r.denominator IS NULL OR r.denominator = 0
         THEN 'No ' || COALESCE(d.denominator_description, 'denominator') || ' recorded in this period'
    END
  FROM raw r
  JOIN public.quality_indicator_definitions d USING (indicator_code)
  LEFT JOIN public.quality_indicator_overrides o
         ON o.hospital_id = p_hospital_id AND o.indicator_code = d.indicator_code
  WHERE d.is_active
    AND d.collection_mode IN ('auto','hybrid')
    AND COALESCE(o.is_applicable, true)
  ON CONFLICT (hospital_id, indicator_code, period, period_start) DO UPDATE SET
    indicator_name = EXCLUDED.indicator_name,
    category       = EXCLUDED.category,
    nabh_chapter   = EXCLUDED.nabh_chapter,
    numerator      = EXCLUDED.numerator,
    denominator    = EXCLUDED.denominator,
    value          = EXCLUDED.value,
    unit           = EXCLUDED.unit,
    direction      = EXCLUDED.direction,
    target         = EXCLUDED.target,
    benchmark      = EXCLUDED.benchmark,
    period_end     = EXCLUDED.period_end,
    data_source    = EXCLUDED.data_source,
    computed_at    = EXCLUDED.computed_at,
    notes          = EXCLUDED.notes
  -- Never clobber a hand-entered value. This is what makes 'hybrid' safe.
  WHERE public.quality_indicators.auto_calculated;

  GET DIAGNOSTICS v_n = ROW_COUNT;

  PERFORM public.run_nabh_auto_collection(p_hospital_id, p_period_start);

  RETURN v_n;
END $$;

-- Every-tenant variant: pg_cron and service_role only, never the browser.
CREATE OR REPLACE FUNCTION public.run_quality_indicator_collection_all(
  p_period_start date DEFAULT date_trunc('month', current_date)::date,
  p_period       text DEFAULT 'monthly'
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_total integer := 0;
BEGIN
  FOR r IN SELECT id FROM public.hospitals WHERE is_active LOOP
    BEGIN
      v_total := v_total + public.run_quality_indicator_collection(r.id, p_period_start, p_period);
    EXCEPTION WHEN OTHERS THEN
      -- One tenant's bad data must not abort collection for everyone else.
      RAISE WARNING 'QI collection failed for hospital %: %', r.id, SQLERRM;
    END;
  END LOOP;
  RETURN v_total;
END $$;

REVOKE ALL ON FUNCTION public.run_quality_indicator_collection(uuid, date, text) FROM public;
REVOKE ALL ON FUNCTION public.run_quality_indicator_collection_all(date, text)   FROM public;
GRANT EXECUTE ON FUNCTION public.run_quality_indicator_collection(uuid, date, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.run_quality_indicator_collection_all(date, text)
  TO service_role;

COMMENT ON FUNCTION public.run_quality_indicator_collection(uuid, date, text) IS
  'Computes every auto/hybrid quality indicator for one hospital and period and '
  'upserts into quality_indicators. Idempotent. Never overwrites manual values.';
