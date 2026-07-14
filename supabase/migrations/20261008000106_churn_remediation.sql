-- ============================================================
-- Automated churn/health-score remediation (Sprint 3)
-- ============================================================
-- ChurnRadar's health score was purely observational — a human had to read
-- it and act. This adds the first automated action (backlog's own
-- suggestion: "start with one action — auto-email at score <40 — before
-- building a general rules engine"). churn_remediation_actions is the
-- dedup/observability log so the same hospital isn't re-emailed daily and
-- Vivek/Rohit can see what fired.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.churn_remediation_actions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  score_at_trigger integer NOT NULL,
  action_type     text NOT NULL DEFAULT 'check_in_email',
  recipient_email text,
  status          text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed', 'skipped_no_admin_email')),
  triggered_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_churn_remediation_hospital ON public.churn_remediation_actions (hospital_id, triggered_at DESC);

ALTER TABLE public.churn_remediation_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "churn_remediation_actions_admin_read" ON public.churn_remediation_actions;
CREATE POLICY "churn_remediation_actions_admin_read" ON public.churn_remediation_actions
  FOR SELECT TO authenticated USING (public.is_aumrti_admin());

-- Insert is service-role only (the scheduled edge function), no
-- authenticated-role insert policy — unlike admin_audit_log this isn't
-- something the frontend ever writes directly.
