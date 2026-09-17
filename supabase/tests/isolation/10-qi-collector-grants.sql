-- Phase 4 (multi-tenant isolation). This is the test
-- 20261011000030_quality_indicator_collectors.sql's own header comment claims already
-- existed ("The security test asserts it.") — it didn't, until
-- 20261106000012_fix_qi_collector_function_grants.sql closed the hole and this file.
--
-- THE HOLE (see that migration for the full exploit narrative): all 17 hospital-scoped
-- `qi_*` SECURITY DEFINER functions had EXECUTE granted to `anon`/`authenticated` — Postgres's
-- default for a newly created function — so any caller could read any hospital's NABH
-- safety/quality data by calling a collector directly with an arbitrary hospital_id,
-- completely bypassing the orchestrator's own authorization check.
--
-- THE FIX shifted enforcement from "trust the caller-supplied hospital_id" to "you may not
-- call this at all unless you're the function owner" — so this file proves both halves:
--   (a) direct calls are now rejected for authenticated AND anon, by GRANT, not by logic;
--   (b) the orchestrator (run_quality_indicator_collection) still works for a caller's own
--       hospital despite the revoked grants (SECURITY DEFINER runs as the owner internally),
--       and still correctly rejects a cross-hospital caller via its own get_user_hospital_id()
--       check — the fix must not have broken the check that was already correct.
--
-- Self-contained: throwaway hospitals/users/auth.users rows, rolled back at the end.
-- No PHI. Run: npx supabase test db --local, or psql -f this-file.sql.

BEGIN;
SELECT plan(5);

-- ── Fixture: two throwaway hospitals with one hospital_admin each ──

INSERT INTO public.hospitals (id, name)
VALUES
  ('44444444-4444-4444-8444-000000000001', 'Isolation Test Hospital QI-X'),
  ('44444444-4444-4444-8444-000000000002', 'Isolation Test Hospital QI-Y');

INSERT INTO public.role_permissions (hospital_id, role_name, role_label)
VALUES
  ('44444444-4444-4444-8444-000000000001', 'hospital_admin', 'Hospital Admin'),
  ('44444444-4444-4444-8444-000000000002', 'hospital_admin', 'Hospital Admin');

INSERT INTO auth.users (id) VALUES ('55555555-5555-4555-8555-000000000001');

INSERT INTO public.users (id, hospital_id, full_name, email, role, auth_user_id)
VALUES (
  '66666666-6666-4666-8666-000000000001',
  '44444444-4444-4444-8444-000000000001',
  'Isolation Test QI Admin',
  'isolation-test-qi-admin@example.test',
  'hospital_admin',
  '55555555-5555-4555-8555-000000000001'
);

-- Captures the SQLSTATE a dynamic call actually raises (or NULL if it doesn't raise), so the
-- assertion can pin the exact error code rather than merely "it threw something" — pgTAP's own
-- throws_ok() couples the sqlstate check to an exact-message check in the same overload, which
-- would make this test brittle against a harmless wording change to the RAISE EXCEPTION text.
CREATE FUNCTION pg_temp.capture_sqlstate(p_sql text) RETURNS text AS $$
BEGIN
  EXECUTE p_sql;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END;
$$ LANGUAGE plpgsql;

-- ── 1 & 2. Direct collector call, bypassing the orchestrator entirely ──
-- 42501 = insufficient_privilege — must come from the REVOKEd grant itself, so this holds
-- even for a caller the orchestrator's own logic would otherwise have accepted.

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', '55555555-5555-4555-8555-000000000001', 'role', 'authenticated')::text,
  true);

SELECT is(
  pg_temp.capture_sqlstate($$
    SELECT public.qi_collect_mom(
      '44444444-4444-4444-8444-000000000001'::uuid, now() - interval '1 year', now())
  $$),
  '42501',
  'authenticated cannot call qi_collect_mom directly, even for their own hospital'
);

RESET ROLE;
SET LOCAL ROLE anon;

SELECT is(
  pg_temp.capture_sqlstate($$
    SELECT public.qi_collect_mom(
      '44444444-4444-4444-8444-000000000001'::uuid, now() - interval '1 year', now())
  $$),
  '42501',
  'anon cannot call qi_collect_mom directly — the pre-fix grant let an unauthenticated caller in too'
);

RESET ROLE;

-- ── 3. Orchestrator still works for the caller's own hospital ──
-- Proves the fix didn't collateral-damage the legitimate path: SECURITY DEFINER means the
-- orchestrator's internal calls to qi_collect_* run as the function owner regardless of who
-- invoked the orchestrator, so revoking EXECUTE from anon/authenticated is invisible to it.

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', '55555555-5555-4555-8555-000000000001', 'role', 'authenticated')::text,
  true);

SELECT is(
  pg_temp.capture_sqlstate($$
    SELECT public.run_quality_indicator_collection(
      '44444444-4444-4444-8444-000000000001'::uuid, current_date, 'monthly')
  $$),
  NULL,
  'the orchestrator still runs end-to-end for the caller''s own hospital after the grant fix'
);

-- ── 4. Orchestrator still rejects a cross-hospital caller ──
-- This check lived in the orchestrator before this fix and was already correct — the hole was
-- that it could be walked around, not that this predicate itself was wrong. Confirms the fix
-- didn't touch it.

SELECT is(
  pg_temp.capture_sqlstate($$
    SELECT public.run_quality_indicator_collection(
      '44444444-4444-4444-8444-000000000002'::uuid, current_date, 'monthly')
  $$),
  '42501',
  'orchestrator still rejects a caller naming a hospital that isn''t theirs'
);

RESET ROLE;

-- ── 5. qi_attainment is a pure calculation helper (no hospital_id, no table) — deliberately
-- left grantable, so confirm that exclusion is what's actually live, not stale intent.

SELECT ok(
  has_function_privilege('authenticated', 'public.qi_attainment(numeric, numeric, text)', 'EXECUTE'),
  'qi_attainment stays callable by authenticated — it carries no isolation risk to fix'
);

SELECT * FROM finish();
ROLLBACK;
