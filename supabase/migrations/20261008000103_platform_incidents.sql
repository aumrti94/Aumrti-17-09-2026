-- ============================================================
-- Incident / status page (Sprint 2)
-- ============================================================
-- A manually-maintained incident communication log (like a lightweight
-- Statuspage.io), not automated uptime monitoring — Lakshmi's team posts an
-- incident and updates as it's worked; PublicStatusPage renders the current
-- state for anyone, no login required.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.platform_incidents (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title              text NOT NULL,
  severity           text NOT NULL DEFAULT 'minor' CHECK (severity IN ('minor', 'major', 'critical')),
  status             text NOT NULL DEFAULT 'investigating' CHECK (status IN ('investigating', 'identified', 'monitoring', 'resolved')),
  affected_services  text[] NOT NULL DEFAULT '{}',
  started_at         timestamptz NOT NULL DEFAULT now(),
  resolved_at        timestamptz,
  created_by         uuid REFERENCES auth.users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.platform_incident_updates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id   uuid NOT NULL REFERENCES public.platform_incidents(id) ON DELETE CASCADE,
  message       text NOT NULL,
  status        text NOT NULL CHECK (status IN ('investigating', 'identified', 'monitoring', 'resolved')),
  created_by    uuid REFERENCES auth.users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_incidents_status ON public.platform_incidents (status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_incident_updates_incident ON public.platform_incident_updates (incident_id, created_at);

ALTER TABLE public.platform_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_incident_updates ENABLE ROW LEVEL SECURITY;

-- Public read (status pages are meant to be seen without logging in) —
-- no TO clause, same pattern as payment_links' public_read policy.
DROP POLICY IF EXISTS "platform_incidents_public_read" ON public.platform_incidents;
CREATE POLICY "platform_incidents_public_read" ON public.platform_incidents FOR SELECT USING (true);

DROP POLICY IF EXISTS "platform_incident_updates_public_read" ON public.platform_incident_updates;
CREATE POLICY "platform_incident_updates_public_read" ON public.platform_incident_updates FOR SELECT USING (true);

-- Writes are aumrti_admin only.
DROP POLICY IF EXISTS "platform_incidents_admin_write" ON public.platform_incidents;
CREATE POLICY "platform_incidents_admin_write" ON public.platform_incidents
  FOR ALL TO authenticated USING (public.is_aumrti_admin()) WITH CHECK (public.is_aumrti_admin());

DROP POLICY IF EXISTS "platform_incident_updates_admin_write" ON public.platform_incident_updates;
CREATE POLICY "platform_incident_updates_admin_write" ON public.platform_incident_updates
  FOR ALL TO authenticated USING (public.is_aumrti_admin()) WITH CHECK (public.is_aumrti_admin());
