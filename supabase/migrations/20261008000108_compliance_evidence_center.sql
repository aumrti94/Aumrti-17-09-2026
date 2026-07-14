-- ============================================================
-- Compliance evidence center — cross-fleet read access (Sprint 3)
-- ============================================================
-- Aggregates evidence that already exists per-hospital (NABH compliance,
-- DPDP signup consent) into one platform-admin view. Adds READ-ONLY
-- cross-tenant policies for aumrti_admins on two tables that didn't have
-- one yet — same precedented pattern already used on bills/admissions/
-- opd_tokens (aumrti_admin_read_all_*), not a new access model. Neither
-- table carries patient-identifiable PHI (compliance status rows and
-- hospital-admin signup consent records, not clinical data).
-- ============================================================

ALTER TABLE public.nabh_hospital_compliance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "aumrti_admin_read_all_nabh_compliance" ON public.nabh_hospital_compliance;
CREATE POLICY "aumrti_admin_read_all_nabh_compliance" ON public.nabh_hospital_compliance
  FOR SELECT TO authenticated USING (public.is_aumrti_admin());

-- hospital_signup_consents had zero RLS policies (checked live) — narrowing
-- it to admin-only read is strictly safer than the implicit default-deny-
-- to-clients-but-open-to-any-authenticated-role-if-RLS-were-off state;
-- register-hospital's own writes go through the service-role key regardless,
-- which always bypasses RLS, so this doesn't affect signup.
ALTER TABLE public.hospital_signup_consents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "aumrti_admin_read_all_signup_consents" ON public.hospital_signup_consents;
CREATE POLICY "aumrti_admin_read_all_signup_consents" ON public.hospital_signup_consents
  FOR SELECT TO authenticated USING (public.is_aumrti_admin());
