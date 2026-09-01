-- Phase 0.8 — constrain the two remaining WITH CHECK (true) insert paths.
--
-- Caught by the Phase 0 verification sweep ("no USING/WITH CHECK (true) on any hospital_id
-- table"), which is exactly the guard being added to CI in Phase 3.
--
-- ROOT CAUSE (RC-2): both policies express "let the form submit" but were written as an
-- unconditional WITH CHECK (true), which also permits setting fields the submitter should never
-- control.
--
-- ── enterprise_leads ─────────────────────────────────────────────────────────────────────────
-- A public "contact sales" form (src/pages/register/Step4ChoosePlan.tsx, reachable from the
-- public /register route, hence one anon and one authenticated insert policy).
-- WITH CHECK (true) let a submitter also set `status`, `notes` and `hospital_id` — i.e. inject a
-- lead pre-marked as converted, with arbitrary admin notes, attributed to any hospital, straight
-- into the platform sales pipeline that PlansManagerPage reads.
--
-- FUNCTIONALITY PRESERVED: the real form inserts exactly
--   hospital_name, contact_name, email, phone, beds_range, state, message, status:"new"
-- and never sets notes or hospital_id. The check below permits precisely that shape.
--
-- ── entitlement_fail_open_events ─────────────────────────────────────────────────────────────
-- A billing-integrity audit trail: written by useSubscriptionConfig.ts when an entitlement check
-- fails open, read only by platform admins via ComplianceCenterPage.
-- WITH CHECK (true) let any authenticated user write rows against ANY hospital_id, which
-- destroys the evidentiary value of the very record it exists to keep.
--
-- FUNCTIONALITY PRESERVED: the hook inserts { hospital_id: <current hospital>, error_message },
-- so scoping the check to the caller's own hospital (or a platform admin) permits every genuine
-- write and rejects only cross-tenant forgery.

BEGIN;

-- ── enterprise_leads ─────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS anon_leads_insert          ON public.enterprise_leads;
DROP POLICY IF EXISTS authenticated_leads_insert ON public.enterprise_leads;

CREATE POLICY anon_leads_insert ON public.enterprise_leads
  AS PERMISSIVE FOR INSERT TO anon
  WITH CHECK (
    (status IS NULL OR status = 'new')
    AND notes IS NULL
    AND hospital_id IS NULL
  );

CREATE POLICY authenticated_leads_insert ON public.enterprise_leads
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    (status IS NULL OR status = 'new')
    AND notes IS NULL
    AND (hospital_id IS NULL OR hospital_id = (SELECT public.get_user_hospital_id()))
  );

-- The lead form submits only these fields; admin triage fields stay out of reach.
REVOKE INSERT ON public.enterprise_leads FROM anon;
GRANT INSERT (hospital_name, contact_name, email, phone, beds_range, state, message, status)
  ON public.enterprise_leads TO anon;
REVOKE SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.enterprise_leads FROM anon;

-- ── entitlement_fail_open_events ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS entitlement_fail_open_insert ON public.entitlement_fail_open_events;

CREATE POLICY entitlement_fail_open_insert ON public.entitlement_fail_open_events
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    hospital_id = (SELECT public.get_user_hospital_id())
    OR (SELECT public.is_aumrti_admin())
  );

REVOKE ALL ON public.entitlement_fail_open_events FROM anon;

COMMIT;
