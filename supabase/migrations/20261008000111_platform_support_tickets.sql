-- ============================================================
-- Fleet-wide support-ticket console
-- ============================================================
-- Named platform_support_tickets deliberately, not "tickets" or
-- "support_tickets" alone — this repo already has a documented naming
-- collision on a too-generic name: a staff-grievances migration tried to
-- reuse the table name "grievances" (already taken by patient complaints,
-- 20260329152029) and CREATE TABLE IF NOT EXISTS silently no-op'd, so
-- staff grievances had no table until 20261008000063 renamed it to
-- staff_grievances. A prefixed, specific name avoids repeating that.
--
-- Shape: inbox_messages' self-referencing parent_id for reply-threading
-- (20260327035800) + grievances' SLA/status/severity columns
-- (20260329152029), combined. RLS: hospital_subscriptions' dual
-- own-hospital-or-admin pattern (20260601150001 lines 358-376).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.platform_support_tickets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id    uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  parent_id      uuid REFERENCES public.platform_support_tickets(id) ON DELETE CASCADE,
  subject        text,
  message_body   text NOT NULL,
  direction      text NOT NULL DEFAULT 'inbound' CHECK (direction IN ('inbound', 'outbound')),
  category       text NOT NULL DEFAULT 'other' CHECK (category IN ('billing', 'technical', 'clinical_workflow', 'training', 'other')),
  priority       text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  created_by     uuid REFERENCES auth.users(id),
  assigned_to    uuid REFERENCES public.aumrti_admins(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_support_tickets_hospital ON public.platform_support_tickets (hospital_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_support_tickets_thread ON public.platform_support_tickets (parent_id);
CREATE INDEX IF NOT EXISTS idx_platform_support_tickets_status ON public.platform_support_tickets (status, created_at DESC) WHERE parent_id IS NULL;

ALTER TABLE public.platform_support_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "platform_support_tickets_own_hospital" ON public.platform_support_tickets;
CREATE POLICY "platform_support_tickets_own_hospital" ON public.platform_support_tickets
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id() OR public.is_aumrti_admin())
  WITH CHECK (hospital_id = public.get_user_hospital_id() OR public.is_aumrti_admin());
