-- ============================================================
-- Lifecycle nudge emails — dedup/observability log
-- ============================================================
-- Mirrors churn_remediation_actions exactly (20261008000106): the scheduled
-- edge function (lifecycle-nudge-scan) is the only writer, admins can read
-- for observability. Three nudge types, one row per send attempt:
--   activation_nudge     — hospital registered 3-14 days ago, never created an OPD token
--   trial_reengagement   — trial hospital, 7+ days old, zero OPD/billing activity at all
--   win_back              — subscription transitioned to 'cancelled'
-- ============================================================

CREATE TABLE IF NOT EXISTS public.lifecycle_nudge_actions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  nudge_type      text NOT NULL CHECK (nudge_type IN ('activation_nudge', 'trial_reengagement', 'win_back')),
  recipient_email text,
  status          text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed', 'skipped_no_admin_email')),
  triggered_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_nudge_hospital ON public.lifecycle_nudge_actions (hospital_id, nudge_type, triggered_at DESC);

ALTER TABLE public.lifecycle_nudge_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lifecycle_nudge_actions_admin_read" ON public.lifecycle_nudge_actions;
CREATE POLICY "lifecycle_nudge_actions_admin_read" ON public.lifecycle_nudge_actions
  FOR SELECT TO authenticated USING (public.is_aumrti_admin());

-- Insert is service-role only (the scheduled edge function).
