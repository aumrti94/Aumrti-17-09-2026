-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: fix_audit_log_rls
-- Purpose  : Tighten the audit_log INSERT policy.
--            Previous policy used WITH CHECK(true), allowing any authenticated
--            user to insert rows with an arbitrary hospital_id — enabling
--            forged audit entries. Fix: scope INSERT to the caller's hospital.
-- Idempotent: DROP POLICY IF EXISTS before CREATE POLICY.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "System can insert audit entries" ON public.audit_log;
DROP POLICY IF EXISTS "audit_log_insert"               ON public.audit_log;

CREATE POLICY "audit_log_insert" ON public.audit_log
  FOR INSERT TO authenticated
  WITH CHECK (hospital_id = public.get_user_hospital_id());
