-- ============================================================
-- Aumrti Admin Cross Tenant RLS Policies
-- Migration: 20260913000000_aumrti_admin_cross_tenant_rls.sql
--
-- Authorizes CEO platform administrators to perform cross-tenant
-- reads on transactional and operational tables.
-- ============================================================

-- ── opd_tokens ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "aumrti_admin_read_all_opd_tokens" ON public.opd_tokens;
CREATE POLICY "aumrti_admin_read_all_opd_tokens"
  ON public.opd_tokens FOR SELECT TO authenticated
  USING (public.is_aumrti_admin());

-- ── bills ───────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "aumrti_admin_read_all_bills" ON public.bills;
CREATE POLICY "aumrti_admin_read_all_bills"
  ON public.bills FOR SELECT TO authenticated
  USING (public.is_aumrti_admin());

-- ── admissions ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "aumrti_admin_read_all_admissions" ON public.admissions;
CREATE POLICY "aumrti_admin_read_all_admissions"
  ON public.admissions FOR SELECT TO authenticated
  USING (public.is_aumrti_admin());

-- ── lab_orders ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "aumrti_admin_read_all_lab_orders" ON public.lab_orders;
CREATE POLICY "aumrti_admin_read_all_lab_orders"
  ON public.lab_orders FOR SELECT TO authenticated
  USING (public.is_aumrti_admin());

-- ── radiology_orders ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "aumrti_admin_read_all_radiology_orders" ON public.radiology_orders;
CREATE POLICY "aumrti_admin_read_all_radiology_orders"
  ON public.radiology_orders FOR SELECT TO authenticated
  USING (public.is_aumrti_admin());

-- ── ed_visits ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "aumrti_admin_read_all_ed_visits" ON public.ed_visits;
CREATE POLICY "aumrti_admin_read_all_ed_visits"
  ON public.ed_visits FOR SELECT TO authenticated
  USING (public.is_aumrti_admin());

-- ── ot_schedules ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "aumrti_admin_read_all_ot_schedules" ON public.ot_schedules;
CREATE POLICY "aumrti_admin_read_all_ot_schedules"
  ON public.ot_schedules FOR SELECT TO authenticated
  USING (public.is_aumrti_admin());

-- ── insurance_claims ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "aumrti_admin_read_all_insurance_claims" ON public.insurance_claims;
CREATE POLICY "aumrti_admin_read_all_insurance_claims"
  ON public.insurance_claims FOR SELECT TO authenticated
  USING (public.is_aumrti_admin());

-- ── pharmacy_dispensing ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "aumrti_admin_read_all_pharmacy_dispensing" ON public.pharmacy_dispensing;
CREATE POLICY "aumrti_admin_read_all_pharmacy_dispensing"
  ON public.pharmacy_dispensing FOR SELECT TO authenticated
  USING (public.is_aumrti_admin());

-- ── staff_attendance ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "aumrti_admin_read_all_staff_attendance" ON public.staff_attendance;
CREATE POLICY "aumrti_admin_read_all_staff_attendance"
  ON public.staff_attendance FOR SELECT TO authenticated
  USING (public.is_aumrti_admin());

-- ── fcm_tokens ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "aumrti_admin_read_all_fcm_tokens" ON public.fcm_tokens;
CREATE POLICY "aumrti_admin_read_all_fcm_tokens"
  ON public.fcm_tokens FOR SELECT TO authenticated
  USING (public.is_aumrti_admin());

-- ── push_notifications ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "aumrti_admin_read_all_push_notifications" ON public.push_notifications;
CREATE POLICY "aumrti_admin_read_all_push_notifications"
  ON public.push_notifications FOR SELECT TO authenticated
  USING (public.is_aumrti_admin());
