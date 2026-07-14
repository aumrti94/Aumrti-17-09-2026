-- ============================================================
-- Entitlement fail-open event log
-- ============================================================
-- useSubscriptionConfig() intentionally fails OPEN on a DB error (every
-- module returns enabled, so a transient outage never locks a hospital
-- out of its own product) — but that meant a hospital getting free access
-- to every gated module during an outage was completely invisible; nobody
-- could see it happened. This table gives Vivek's RevOps surface something
-- to read so fail-open events are at least visible, even before there's a
-- dedicated cockpit page to show them.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.entitlement_fail_open_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     uuid        REFERENCES public.hospitals(id) ON DELETE CASCADE,
  error_message   text,
  occurred_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_entitlement_fail_open_events_occurred
  ON public.entitlement_fail_open_events (occurred_at DESC);

ALTER TABLE public.entitlement_fail_open_events ENABLE ROW LEVEL SECURITY;

-- Any authenticated hospital user can report their own fail-open event
-- (this is a client-side hook running in the browser, not a service-role
-- edge function) — but only aumrti_admins can read the log.
DROP POLICY IF EXISTS "entitlement_fail_open_insert" ON public.entitlement_fail_open_events;
CREATE POLICY "entitlement_fail_open_insert"
  ON public.entitlement_fail_open_events FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "entitlement_fail_open_admin_read" ON public.entitlement_fail_open_events;
CREATE POLICY "entitlement_fail_open_admin_read"
  ON public.entitlement_fail_open_events FOR SELECT TO authenticated
  USING (public.is_aumrti_admin());
