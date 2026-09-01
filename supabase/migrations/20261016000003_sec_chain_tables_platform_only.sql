-- Phase 0.3 — hospital_chains / chain_memberships: make the policy do what its name says.
--
-- ROOT CAUSE (RC-2): the policy is named "*_platform_only" but its body imposes no restriction.
-- The identifier carries the requirement; the SQL does not implement it.
--
--   hospital_chains_platform_only    [ALL] roles={authenticated} USING (true) WITH CHECK (true)
--   chain_memberships_platform_only  [ALL] roles={authenticated} USING (true) WITH CHECK (true)
--
-- `authenticated` also held SELECT/INSERT/UPDATE/DELETE/TRUNCATE grants and is NOT bypassrls,
-- so RLS was the only gate and it was wide open: any logged-in user of any hospital could read,
-- modify or delete the entire chain-ownership graph — including reassigning which hospitals
-- belong to which chain via chain_memberships.hospital_id / .chain_id.
--
-- FUNCTIONALITY PRESERVED: both tables hold 0 rows and are referenced by 0 application files
-- (verified against the full .from() scan). There is no code path to break.
--
-- is_aumrti_admin() is the established platform-admin predicate, already used correctly by
-- discount_codes_aumrti_write, platform_ai_provider_config_admin_all and others.

BEGIN;

DROP POLICY IF EXISTS hospital_chains_platform_only   ON public.hospital_chains;
DROP POLICY IF EXISTS chain_memberships_platform_only ON public.chain_memberships;

CREATE POLICY hospital_chains_platform_only ON public.hospital_chains
  AS PERMISSIVE FOR ALL TO authenticated
  USING ((SELECT public.is_aumrti_admin()))
  WITH CHECK ((SELECT public.is_aumrti_admin()));

CREATE POLICY chain_memberships_platform_only ON public.chain_memberships
  AS PERMISSIVE FOR ALL TO authenticated
  USING ((SELECT public.is_aumrti_admin()))
  WITH CHECK ((SELECT public.is_aumrti_admin()));

-- anon has no business here at all.
REVOKE ALL ON public.hospital_chains   FROM anon;
REVOKE ALL ON public.chain_memberships FROM anon;

COMMIT;
