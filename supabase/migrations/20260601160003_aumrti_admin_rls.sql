-- Aumrti platform admin needs to read ALL hospitals, users, and related tables.
-- Without these policies the platform pages return empty results even though
-- data exists, because the existing RLS only allows each hospital to see its own rows.

-- ── hospitals ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "aumrti_admin_read_all_hospitals" ON public.hospitals;

CREATE POLICY "aumrti_admin_read_all_hospitals"
  ON public.hospitals FOR SELECT TO authenticated
  USING (public.is_aumrti_admin());

-- ── users (needed for staff count + contact info in hospital detail) ────────
DROP POLICY IF EXISTS "aumrti_admin_read_all_users" ON public.users;

CREATE POLICY "aumrti_admin_read_all_users"
  ON public.users FOR SELECT TO authenticated
  USING (public.is_aumrti_admin());

-- ── branches (needed if platform pages join branches) ──────────────────────
DROP POLICY IF EXISTS "aumrti_admin_read_all_branches" ON public.branches;

CREATE POLICY "aumrti_admin_read_all_branches"
  ON public.branches FOR SELECT TO authenticated
  USING (public.is_aumrti_admin());
