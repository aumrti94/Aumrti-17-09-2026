-- Allow each hospital to create genuinely custom-named roles (not just
-- relabel an existing system role), and remove the arbitrary 15-role cap.
--
-- users.role was a fixed Postgres enum (public.app_role), so role_permissions
-- .role_name could only ever be one of ~16 hardcoded values — a role name
-- outside the enum could never be assigned to a real staff member. This
-- migration replaces the enum constraint with a per-hospital composite FK:
-- users(hospital_id, role) -> role_permissions(hospital_id, role_name).
-- role_name is already free text, so any slug now works, and a role must
-- exist for a hospital before a staff member can be assigned to it.

-- 1. Backfill safety net: make sure every (hospital_id, role) pair already in
--    use by an existing user has a matching role_permissions row, so the FK
--    added below doesn't fail against current data (covers hospitals created
--    via either onboarding path, and any role never auto-seeded).
INSERT INTO public.role_permissions (hospital_id, role_name, role_label, is_system_role, permissions)
SELECT DISTINCT u.hospital_id, u.role::text, initcap(replace(u.role::text, '_', ' ')), true, '{}'::jsonb
FROM public.users u
LEFT JOIN public.role_permissions rp
  ON rp.hospital_id = u.hospital_id AND rp.role_name = u.role::text
WHERE rp.id IS NULL
ON CONFLICT DO NOTHING;

-- 2. Expand the default seed set to include "accountant" — SettingsStaffPage's
--    always-visible DEFAULT_ROLE_CARDS already lets staff be assigned that
--    role, but it was never in this function's seed list. Re-run for every
--    existing hospital (idempotent via ON CONFLICT DO NOTHING).
CREATE OR REPLACE FUNCTION public.seed_default_roles_for_hospital(p_hospital_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.role_permissions (hospital_id, role_name, role_label, is_system_role, permissions)
  VALUES
    (p_hospital_id, 'super_admin',       'Super Admin',  true, '{"all": true}'::jsonb),
    (p_hospital_id, 'hospital_admin',    'Admin',        true, '{"all": true}'::jsonb),
    (p_hospital_id, 'doctor',            'Doctor',       true, '{"opd":"rw","ipd":"rw","emergency":"rw","lab":"r","radiology":"r","pharmacy":"r","patients":"rw","reports":"r"}'::jsonb),
    (p_hospital_id, 'nurse',             'Nurse',        true, '{"nursing":"rw","ipd":"rw","emergency":"rw","patients":"r","pharmacy":"r"}'::jsonb),
    (p_hospital_id, 'receptionist',      'Reception',    true, '{"opd":"rw","patients":"rw","appointments":"rw","billing":"r"}'::jsonb),
    (p_hospital_id, 'pharmacist',        'Pharmacist',   true, '{"pharmacy":"rw","inventory":"rw","patients":"r"}'::jsonb),
    (p_hospital_id, 'lab_tech',          'Lab Tech',     true, '{"lab":"rw","patients":"r"}'::jsonb),
    (p_hospital_id, 'accountant',        'Accountant',   true, '{"billing":"rw","reports":"r","patients":"r"}'::jsonb)
  ON CONFLICT DO NOTHING;
END;
$$;

DO $$
DECLARE h record;
BEGIN
  FOR h IN SELECT id FROM public.hospitals LOOP
    PERFORM public.seed_default_roles_for_hospital(h.id);
  END LOOP;
END $$;

-- 3. Postgres refuses to ALTER COLUMN TYPE on a column referenced by any RLS
--    policy (it can't safely rewrite a stored policy expression the way it
--    rewrites a table's own defaults). has_role(uuid, app_role) is fine —
--    its signature isn't changing — but these 4 policies check users.role
--    directly via an inline subquery, bypassing has_role(). Drop them here,
--    convert the column, then recreate them identically below (their logic
--    is untouched — comparing a text column to string literals works the
--    same whether the column started as an enum or not). Confirmed via
--    pg_depend to be the complete set of policies depending on users.role.
DROP POLICY IF EXISTS "audit_log_select_admin" ON public.abdm_audit_log;
DROP POLICY IF EXISTS "phi_backfill_log_hospital_admin_read" ON public.phi_backfill_log;
DROP POLICY IF EXISTS "phi_access_audit_admin_read" ON public.phi_access_audit;
DROP POLICY IF EXISTS "Admins can manage prompts" ON public.prompt_registry;

-- Convert users.role from the fixed enum to free text. The app_role type
-- itself is left in place (unused as a column type, still valid as a
-- literal-cast target) rather than dropped, to keep this change easy to
-- reason about / roll back.
--
-- Skipped when the column is already text, so a re-run does not force a table
-- rewrite (which on a second pass would also have to rebuild the composite FK
-- added in step 5 below).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users'
      AND column_name = 'role' AND data_type <> 'text'
  ) THEN
    ALTER TABLE public.users ALTER COLUMN role DROP DEFAULT;
    ALTER TABLE public.users ALTER COLUMN role TYPE text USING role::text;
  END IF;
END $$;

ALTER TABLE public.users ALTER COLUMN role SET DEFAULT 'receptionist';

-- Recreate the 4 dropped policies, unchanged.
CREATE POLICY "audit_log_select_admin" ON public.abdm_audit_log
  FOR SELECT TO authenticated
  USING (
    hospital_id = public.get_user_hospital_id()
    AND (
      SELECT role FROM public.users
      WHERE auth_user_id = auth.uid()
      LIMIT 1
    ) IN ('super_admin', 'hospital_admin')
  );

CREATE POLICY phi_backfill_log_hospital_admin_read
  ON public.phi_backfill_log
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.auth_user_id = auth.uid()
        AND u.hospital_id  = phi_backfill_log.hospital_id
        AND u.role IN ('hospital_admin', 'super_admin')
    )
  );

CREATE POLICY phi_access_audit_admin_read
  ON public.phi_access_audit
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.auth_user_id = auth.uid()
        AND u.hospital_id  = phi_access_audit.hospital_id
        AND u.role IN ('hospital_admin', 'super_admin')
    )
  );

CREATE POLICY "Admins can manage prompts"
  ON public.prompt_registry FOR ALL TO authenticated
  USING (
    public.is_aumrti_admin() OR EXISTS (
      SELECT 1 FROM public.users
      WHERE auth_user_id = auth.uid()
        AND role IN ('super_admin', 'hospital_admin')
    )
  )
  WITH CHECK (
    public.is_aumrti_admin() OR EXISTS (
      SELECT 1 FROM public.users
      WHERE auth_user_id = auth.uid()
        AND role IN ('super_admin', 'hospital_admin')
    )
  );

-- 4. has_role() compares its _role argument against users.role, which is now
--    text. Deliberately KEEP the function's (uuid, app_role) signature
--    unchanged — ~8 existing RLS policies across earlier migrations
--    (20260327053837, 20261008000166) depend on this exact overload via
--    pg_depend; dropping/recreating it with a different parameter type would
--    either fail outright or require CASCADE and silently drop those
--    policies. Only the body needs a cast. has_role is only ever called with
--    fixed system-role literals (e.g. 'super_admin') for coarse admin checks
--    at the RLS layer, never with a hospital's custom role name, so keeping
--    the parameter scoped to the app_role enum is correct — per-role/custom
--    permission enforcement happens at the application layer via
--    role_permissions.permissions, not through has_role().
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users WHERE auth_user_id = _user_id AND role = _role::text
  )
$$;

-- 5. The core constraint: a staff member's role must exist as a
--    role_permissions row for their own hospital. This is what makes
--    genuinely custom-named roles possible (no enum to be a member of) while
--    still guaranteeing every assigned role resolves to a real permission
--    set for that hospital.
--    Guarded so the migration is re-runnable: a bare ADD CONSTRAINT raises
--    42710 ("constraint already exists") on a second pass, which aborts the
--    whole push. Checking pg_constraint rather than DROP-then-ADD deliberately
--    leaves an existing, already-validated constraint in place — re-adding it
--    would revalidate every users row and fail if any (hospital_id, role) pair
--    has drifted out of role_permissions since the backfill in step 1.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname  = 'users_role_hospital_fkey'
      AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_role_hospital_fkey
      FOREIGN KEY (hospital_id, role) REFERENCES public.role_permissions (hospital_id, role_name);
  END IF;
END $$;
