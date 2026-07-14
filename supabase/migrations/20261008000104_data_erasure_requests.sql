-- ============================================================
-- Self-service data erasure requests (Sprint 2, DPDP-driven)
-- ============================================================
-- A tenant-facing REQUEST, not a self-service delete button — DPDP's right
-- to erasure requires the data fiduciary (Aumrti) to act on the request
-- with appropriate verification, not necessarily instant self-service
-- deletion. The actual purge still goes through delete-hospital's existing
-- two-phase soft-delete/purge flow (20260602150001 + 20261008000098),
-- gated to aumrti_admin — this table is the intake + tracking layer in
-- front of it.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.data_erasure_requests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id    uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  requested_by   uuid REFERENCES auth.users(id),
  reason         text,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_review', 'approved', 'rejected', 'completed')),
  requested_at   timestamptz NOT NULL DEFAULT now(),
  reviewed_by    uuid REFERENCES auth.users(id),
  reviewed_at    timestamptz,
  admin_notes    text
);

CREATE INDEX IF NOT EXISTS idx_data_erasure_requests_status ON public.data_erasure_requests (status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_data_erasure_requests_hospital ON public.data_erasure_requests (hospital_id);

ALTER TABLE public.data_erasure_requests ENABLE ROW LEVEL SECURITY;

-- Tenant users can see and file their own hospital's requests.
DROP POLICY IF EXISTS "data_erasure_requests_hospital_read" ON public.data_erasure_requests;
CREATE POLICY "data_erasure_requests_hospital_read" ON public.data_erasure_requests
  FOR SELECT TO authenticated USING (hospital_id = public.get_user_hospital_id());

DROP POLICY IF EXISTS "data_erasure_requests_hospital_insert" ON public.data_erasure_requests;
CREATE POLICY "data_erasure_requests_hospital_insert" ON public.data_erasure_requests
  FOR INSERT TO authenticated WITH CHECK (hospital_id = public.get_user_hospital_id());

-- aumrti_admins can read/update every request across the fleet.
DROP POLICY IF EXISTS "data_erasure_requests_admin_all" ON public.data_erasure_requests;
CREATE POLICY "data_erasure_requests_admin_all" ON public.data_erasure_requests
  FOR ALL TO authenticated USING (public.is_aumrti_admin()) WITH CHECK (public.is_aumrti_admin());
