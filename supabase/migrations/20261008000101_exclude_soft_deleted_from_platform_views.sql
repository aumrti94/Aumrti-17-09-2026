-- ============================================================
-- Exclude soft-deleted hospitals from platform-wide RPCs
-- ============================================================
-- 20261008000098_hospital_soft_delete.sql added hospitals.deleted_at (the
-- two-phase delete-hospital grace window). The platform RPCs that compute
-- fleet-wide stats only filtered is_active — a hospital marked for deletion
-- would still count toward the activation funnel and "active hospitals"
-- lists for up to its 7-day grace period. Re-create both with the same
-- deleted_at IS NULL guard used on the frontend dashboard queries.
-- ============================================================

CREATE OR REPLACE FUNCTION public.platform_activation_funnel()
RETURNS TABLE (
  registered  bigint,
  has_opd     bigint,
  has_billing bigint,
  has_ipd     bigint,
  converted   bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT COUNT(*)::bigint                    FROM hospitals              WHERE is_active = true AND deleted_at IS NULL),
    (SELECT COUNT(DISTINCT hospital_id)::bigint FROM opd_tokens),
    (SELECT COUNT(DISTINCT hospital_id)::bigint FROM bills),
    (SELECT COUNT(DISTINCT hospital_id)::bigint FROM admissions),
    (SELECT COUNT(*)::bigint                    FROM hospital_subscriptions WHERE status = 'active');
$$;

CREATE OR REPLACE FUNCTION public.platform_active_hospitals(since timestamptz)
RETURNS TABLE (
  hospital_id uuid,
  has_opd boolean,
  has_billing boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    h.id AS hospital_id,
    EXISTS (
      SELECT 1 FROM public.opd_tokens t
      WHERE t.hospital_id = h.id AND t.created_at >= since
    ) AS has_opd,
    EXISTS (
      SELECT 1 FROM public.bills b
      WHERE b.hospital_id = h.id AND b.created_at >= since
    ) AS has_billing
  FROM public.hospitals h
  WHERE h.is_active = true AND h.deleted_at IS NULL AND public.is_aumrti_admin();
$$;
