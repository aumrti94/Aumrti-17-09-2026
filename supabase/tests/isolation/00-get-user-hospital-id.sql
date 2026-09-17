-- Phase 4 (multi-tenant isolation). `public.get_user_hospital_id()` is the tenant helper
-- 1,026 call sites and every RLS policy in this schema key off — see
-- 20260322111223_b9e8ade2-f59d-4999-9365-101cacd12e3d.sql:
--
--   SELECT hospital_id FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1
--
-- If this ever returns the wrong hospital_id, every policy that trusts it is wrong too. This
-- file is a real pgTAP suite (plan/ok/is/finish), not the psql-assertion style
-- supabase/tests/booking-engine/ uses despite its name — see the tenant-isolation-testing skill.
--
-- Self-contained: creates its own throwaway hospitals/users/auth.users rows inside a
-- transaction that is rolled back at the end, so it needs no prior seed and leaves nothing
-- behind. No PHI — placeholder names only.
--
-- Run: docker exec -i <db-container> psql -U postgres -d postgres -f this-file.sql
-- or:  npx supabase test db --local

BEGIN;
SELECT plan(6);

-- ── Fixture: two throwaway hospitals, one user, no real auth account needed for case 1 ──

INSERT INTO public.hospitals (id, name)
VALUES
  ('11111111-1111-4111-8111-000000000001', 'Isolation Test Hospital X'),
  ('11111111-1111-4111-8111-000000000002', 'Isolation Test Hospital Y');

-- users.role FKs (hospital_id, role) to role_permissions — satisfy it for both hospitals.
INSERT INTO public.role_permissions (hospital_id, role_name, role_label)
VALUES
  ('11111111-1111-4111-8111-000000000001', 'hospital_admin', 'Hospital Admin'),
  ('11111111-1111-4111-8111-000000000002', 'hospital_admin', 'Hospital Admin');

-- A real auth.users row: users.auth_user_id FKs to it, ON DELETE CASCADE.
INSERT INTO auth.users (id) VALUES ('22222222-2222-4222-8222-000000000001');

INSERT INTO public.users (id, hospital_id, full_name, email, role, auth_user_id)
VALUES (
  '33333333-3333-4333-8333-000000000001',
  '11111111-1111-4111-8111-000000000001',
  'Isolation Test User',
  'isolation-test-user@example.test',
  'hospital_admin',
  '22222222-2222-4222-8222-000000000001'
);

-- ── 1. No public.users row matches the JWT subject → NULL, not an error, not hospital 0 ──

SELECT set_config('request.jwt.claims',
  json_build_object('sub', '99999999-9999-4999-8999-000000000099', 'role', 'authenticated')::text,
  true);

SELECT is(
  public.get_user_hospital_id(),
  NULL::uuid,
  'no matching public.users row → NULL, not a false-positive hospital match'
);

-- ── 2. Normal case: the JWT subject matches a seeded user → their hospital_id ──

SELECT set_config('request.jwt.claims',
  json_build_object('sub', '22222222-2222-4222-8222-000000000001', 'role', 'authenticated')::text,
  true);

SELECT is(
  public.get_user_hospital_id(),
  '11111111-1111-4111-8111-000000000001'::uuid,
  'resolves the seeded user''s current hospital_id'
);

-- ── 3. Mid-transfer: hospital_id changes underneath an already-established session ──
--
-- get_user_hospital_id() is STABLE (cacheable within one statement, not across statements),
-- and it is a live SELECT keyed on auth_user_id, not a value captured at login — so a transfer
-- takes effect on the next call in the same session, with no re-login required. That is what
-- this asserts: the function reflects the CURRENT row, not a snapshot.

UPDATE public.users
SET hospital_id = '11111111-1111-4111-8111-000000000002'
WHERE auth_user_id = '22222222-2222-4222-8222-000000000001';

SELECT is(
  public.get_user_hospital_id(),
  '11111111-1111-4111-8111-000000000002'::uuid,
  'reflects an in-flight hospital transfer on the very next call, not a stale value'
);

-- ── 4. service_role bypasses RLS structurally; authenticated/anon must not ──
--
-- This is the mechanism every "service-role handler must filter explicitly" rule in
-- CLAUDE.md/the skills rests on: RLS is not consulted at all for a role with rolbypassrls.

SELECT ok(
  (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'service_role'),
  'service_role has rolbypassrls — RLS is not a backstop for service-role code paths'
);

SELECT ok(
  NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'authenticated'),
  'authenticated does NOT bypass RLS — tenant isolation for app users depends on policies actually running'
);

SELECT ok(
  NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'anon'),
  'anon does NOT bypass RLS'
);

SELECT * FROM finish();
ROLLBACK;
