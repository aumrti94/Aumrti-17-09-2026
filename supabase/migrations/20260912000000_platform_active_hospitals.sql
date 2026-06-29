-- ============================================================
-- Platform Active Hospitals RPC
-- Migration: 20260912000000_platform_active_hospitals.sql
--
-- Replaces bulk row queries from opd_tokens and bills with a 
-- fast server-side existence check per hospital.
-- ============================================================

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
  WHERE h.is_active = true AND public.is_aumrti_admin();
$$;

REVOKE ALL    ON FUNCTION public.platform_active_hospitals(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.platform_active_hospitals(timestamptz) TO authenticated;
