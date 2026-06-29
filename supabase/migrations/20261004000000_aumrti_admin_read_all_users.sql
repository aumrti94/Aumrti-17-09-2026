-- ============================================================
-- Aumrti Admin Cross-Tenant RLS — public.users
-- Migration: 20261004000000_aumrti_admin_read_all_users.sql
--
-- Authorizes CEO platform administrators (aumrti_admins) to perform
-- a cross-tenant READ on the staff/user directory so the platform
-- console can surface a hospital's Users tab (name, email, phone,
-- role, last login) for support and account management.
--
-- DPDP Act 2023 note (purpose limitation): staff email + phone are
-- personal data. This policy is:
--   • SELECT only — no cross-tenant insert/update/delete is granted.
--   • Gated strictly on public.is_aumrti_admin() — hospital users are
--     unaffected and continue to see only their own hospital's users.
-- Purpose: platform support & account management.
-- ============================================================

-- ── users ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "aumrti_admin_read_all_users" ON public.users;
CREATE POLICY "aumrti_admin_read_all_users"
  ON public.users FOR SELECT TO authenticated
  USING (public.is_aumrti_admin());
