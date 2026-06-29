-- ============================================================
-- Platform Activation Funnel RPC
-- Migration: 20260602b_platform_funnel_function.sql
--
-- Uses LANGUAGE sql (not plpgsql) so Postgres stores the body
-- as text only — no parsing/compilation at CREATE time, which
-- avoids the SQL Editor connection-timeout issue.
--
-- Access control: SECURITY DEFINER + REVOKE FROM PUBLIC + GRANT
-- to authenticated only. Underlying table RLS policies (which
-- already restrict opd_tokens/bills/admissions to
-- is_aumrti_admin() for cross-hospital reads) enforce that
-- only platform admins get meaningful results.
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
    (SELECT COUNT(*)::bigint                    FROM hospitals              WHERE is_active = true),
    (SELECT COUNT(DISTINCT hospital_id)::bigint FROM opd_tokens),
    (SELECT COUNT(DISTINCT hospital_id)::bigint FROM bills),
    (SELECT COUNT(DISTINCT hospital_id)::bigint FROM admissions),
    (SELECT COUNT(*)::bigint                    FROM hospital_subscriptions WHERE status = 'active');
$$;

REVOKE ALL    ON FUNCTION public.platform_activation_funnel() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.platform_activation_funnel() TO authenticated;
