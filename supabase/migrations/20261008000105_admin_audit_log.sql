-- ============================================================
-- Fleet-wide admin audit log (Sprint 3)
-- ============================================================
-- Per-hospital audit_log already exists (clinical/operational actions
-- within a tenant). This is the missing cross-tenant counterpart: what did
-- an aumrti_admin do, on which hospital, and when. Covers the highest-
-- stakes admin actions first (hospital delete/restore, erasure review,
-- admin management, impersonation) — extending coverage to entitlement/
-- pricing-override changes is the same pattern, a natural fast-follow.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id              uuid REFERENCES public.aumrti_admins(id),
  admin_name            text,
  action                text NOT NULL,
  target_hospital_id    uuid REFERENCES public.hospitals(id),
  target_hospital_name  text,
  details               jsonb NOT NULL DEFAULT '{}',
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created ON public.admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_hospital ON public.admin_audit_log (target_hospital_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_action ON public.admin_audit_log (action, created_at DESC);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

-- Read: admins only. Insert: any active admin can log their own action
-- (several admin mutations happen directly from the frontend, not always
-- via a service-role edge function) — this table is an append-only trail,
-- never updated or deleted via RLS (no UPDATE/DELETE policy at all).
DROP POLICY IF EXISTS "admin_audit_log_admin_read" ON public.admin_audit_log;
CREATE POLICY "admin_audit_log_admin_read" ON public.admin_audit_log
  FOR SELECT TO authenticated USING (public.is_aumrti_admin());

DROP POLICY IF EXISTS "admin_audit_log_admin_insert" ON public.admin_audit_log;
CREATE POLICY "admin_audit_log_admin_insert" ON public.admin_audit_log
  FOR INSERT TO authenticated WITH CHECK (public.is_aumrti_admin());
