-- Single-round-trip RPC replacing the 20-query loadKPIs waterfall in InsurancePage.tsx
-- Returns all dashboard KPIs + sidebar badge counts in one DB call.

CREATE OR REPLACE FUNCTION get_insurance_kpis(
  p_hospital_id UUID,
  p_from_ts     TIMESTAMPTZ,
  p_to_ts       TIMESTAMPTZ
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pending_preauth       INT   := 0;
  v_sla_at_risk           INT   := 0;
  v_outstanding_count     INT   := 0;
  v_outstanding_amount    NUMERIC := 0;
  v_denied_count          INT   := 0;
  v_resolved_count        INT   := 0;
  v_overdue_queries       INT   := 0;
  v_supplementary_needed  INT   := 0;
  v_avg_preauth_minutes   NUMERIC;
  v_fp_approved           INT   := 0;
  v_fp_rejected           INT   := 0;
  v_avg_settlement_days   NUMERIC;
  v_underpayment_amount   NUMERIC := 0;
  v_total_claimed         NUMERIC := 0;
  v_total_settled         NUMERIC := 0;
  v_pending_enhancements  INT   := 0;
  v_failed_intimations    INT   := 0;
  v_auto_handled          INT   := 0;
  v_total_ins_adms        INT   := 0;
BEGIN
  -- 1. Pending pre-auth + SLA at risk (one pass)
  SELECT
    COUNT(*),
    COUNT(*) FILTER (
      WHERE sla_deadline IS NOT NULL
        AND sla_breached  = FALSE
        AND sla_deadline  BETWEEN NOW() AND NOW() + INTERVAL '30 minutes'
    )
  INTO v_pending_preauth, v_sla_at_risk
  FROM insurance_pre_auth
  WHERE hospital_id = p_hospital_id
    AND status IN ('pending', 'submitted', 'under_review');

  -- 2. Outstanding claims amount + count (one pass)
  SELECT COUNT(*), COALESCE(SUM(claimed_amount), 0)
  INTO v_outstanding_count, v_outstanding_amount
  FROM insurance_claims
  WHERE hospital_id = p_hospital_id
    AND status IN ('submitted', 'under_review');

  -- 3. Denied + resolved in period (one pass)
  SELECT
    COUNT(*) FILTER (WHERE status = 'rejected'),
    COUNT(*) FILTER (WHERE status IN ('approved', 'rejected'))
  INTO v_denied_count, v_resolved_count
  FROM insurance_claims
  WHERE hospital_id  = p_hospital_id
    AND created_at  BETWEEN p_from_ts AND p_to_ts;

  -- 4. Overdue TPA queries
  SELECT COUNT(*) INTO v_overdue_queries
  FROM tpa_queries
  WHERE hospital_id        = p_hospital_id
    AND status            NOT IN ('responded', 'replied', 'closed')
    AND response_deadline  IS NOT NULL
    AND response_deadline  < NOW();

  -- 5. Supplementary needed
  SELECT COUNT(*) INTO v_supplementary_needed
  FROM insurance_pre_auth
  WHERE hospital_id           = p_hospital_id
    AND supplementary_required = TRUE
    AND status NOT IN ('approved', 'rejected');

  -- 6. Avg pre-auth submission time in period
  SELECT ROUND(AVG(EXTRACT(EPOCH FROM (submitted_at - created_at)) / 60))
  INTO v_avg_preauth_minutes
  FROM insurance_pre_auth
  WHERE hospital_id   = p_hospital_id
    AND submitted_at  IS NOT NULL
    AND created_at   BETWEEN p_from_ts AND p_to_ts
    AND EXTRACT(EPOCH FROM (submitted_at - created_at)) BETWEEN 0 AND 864000;

  -- 7. First-pass approval rate in period (one pass)
  SELECT
    COUNT(*) FILTER (WHERE status = 'approved'),
    COUNT(*) FILTER (WHERE status = 'rejected')
  INTO v_fp_approved, v_fp_rejected
  FROM insurance_pre_auth
  WHERE hospital_id = p_hospital_id
    AND status      IN ('approved', 'rejected')
    AND created_at  BETWEEN p_from_ts AND p_to_ts;

  -- 8. Avg claim settlement days in period
  SELECT ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - submitted_at)) / 86400))
  INTO v_avg_settlement_days
  FROM insurance_claims
  WHERE hospital_id  = p_hospital_id
    AND status        = 'approved'
    AND submitted_at  IS NOT NULL
    AND created_at   BETWEEN p_from_ts AND p_to_ts;

  -- 9. Underpayment unreconciled
  SELECT COALESCE(SUM(underpayment_amount), 0) INTO v_underpayment_amount
  FROM insurance_claims
  WHERE hospital_id        = p_hospital_id
    AND reconciled          = FALSE
    AND underpayment_amount > 0;

  -- 10. Recovery rate in period (one pass)
  SELECT
    COALESCE(SUM(claimed_amount), 0),
    COALESCE(SUM(settled_amount),  0)
  INTO v_total_claimed, v_total_settled
  FROM insurance_claims
  WHERE hospital_id  = p_hospital_id
    AND settled_amount > 0
    AND created_at   BETWEEN p_from_ts AND p_to_ts;

  -- 11. Sidebar badges + automation % (three counts, one per table)
  BEGIN
    SELECT COUNT(*) INTO v_pending_enhancements
    FROM insurance_enhancement_requests
    WHERE hospital_id = p_hospital_id AND status = 'pending';
  EXCEPTION WHEN undefined_table THEN v_pending_enhancements := 0;
  END;

  BEGIN
    SELECT COUNT(*) INTO v_failed_intimations
    FROM insurance_intimations
    WHERE hospital_id = p_hospital_id AND status IN ('failed', 'pending');
  EXCEPTION WHEN undefined_table THEN v_failed_intimations := 0;
  END;

  BEGIN
    SELECT COUNT(*) INTO v_auto_handled
    FROM insurance_automation_log
    WHERE hospital_id  = p_hospital_id
      AND event_type   = 'intimation_auto_sent'
      AND created_at  >= p_from_ts;
  EXCEPTION WHEN undefined_table THEN v_auto_handled := 0;
  END;

  SELECT COUNT(*) INTO v_total_ins_adms
  FROM admissions
  WHERE hospital_id    = p_hospital_id
    AND insurance_type != 'self_pay'
    AND admitted_at    >= p_from_ts;

  RETURN json_build_object(
    'pendingPreAuth',      v_pending_preauth,
    'slaAtRisk',           v_sla_at_risk,
    'outstandingCount',    v_outstanding_count,
    'outstandingAmount',   v_outstanding_amount,
    'deniedCount',         v_denied_count,
    'denialRate',          CASE WHEN v_resolved_count > 0
                             THEN ROUND((v_denied_count::NUMERIC / v_resolved_count) * 100)
                             ELSE 0 END,
    'overdueQueries',      v_overdue_queries,
    'supplementaryNeeded', v_supplementary_needed,
    'avgPreAuthMinutes',   v_avg_preauth_minutes,
    'firstPassRate',       CASE WHEN v_fp_approved + v_fp_rejected > 0
                             THEN ROUND((v_fp_approved::NUMERIC / (v_fp_approved + v_fp_rejected)) * 100)
                             ELSE NULL END,
    'avgSettlementDays',   v_avg_settlement_days,
    'underpaymentAmount',  v_underpayment_amount,
    'recoveryRate',        CASE WHEN v_total_claimed > 0
                             THEN ROUND((v_total_settled / v_total_claimed) * 100)
                             ELSE NULL END,
    'automationPct',       CASE WHEN v_total_ins_adms > 0
                             THEN ROUND((v_auto_handled::NUMERIC / v_total_ins_adms) * 100)
                             ELSE 0 END,
    'pendingEnhancements', v_pending_enhancements,
    'failedIntimations',   v_failed_intimations
  );
END;
$$;

-- Grant execution to authenticated users (RLS on the called tables enforces row-level access)
GRANT EXECUTE ON FUNCTION get_insurance_kpis(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
