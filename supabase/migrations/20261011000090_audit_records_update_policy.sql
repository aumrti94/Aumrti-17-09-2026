-- Fix: scheduled audits could never be marked completed.
--
-- Migration 20260327053837 ("Step 4: Make audit tables immutable") dropped the
-- FOR ALL policy on audit_records and replaced it with INSERT + SELECT only.
-- That grouped audit_records with clinical_alerts and whatsapp_notifications,
-- but it is not the same kind of table: audit_records is a *schedule* with a
-- real lifecycle (scheduled -> in_progress -> completed), not an append-only
-- log. The name made it look like an audit trail.
--
-- With RLS enabled and no UPDATE policy, every "Mark Completed" matched zero
-- rows. PostgREST reports no error for a zero-row UPDATE, so the UI showed
-- "Audit marked as completed" while nothing was written and the audit stayed
-- open on the next fetch.
--
-- This is the same fix, in the same shape, as
-- 20261008000133_clinical_alerts_acknowledge_policy.sql. The immutability
-- intent is preserved by narrowing UPDATE to the conduct/outcome columns via
-- column-level grants: audit_title, audit_type, scheduled_date, hospital_id,
-- created_by and created_at stay unwritable from the client, so an audit's
-- identity cannot be rewritten after the fact.

-- 1. Hospital-scoped UPDATE policy (the missing piece).
DROP POLICY IF EXISTS "audit_records_update" ON public.audit_records;
CREATE POLICY "audit_records_update" ON public.audit_records
  FOR UPDATE TO authenticated
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());

-- 2. Restrict *which* columns authenticated may write. Table-level UPDATE is
--    revoked first; a table-level grant would otherwise mask the column grants.
REVOKE UPDATE ON public.audit_records FROM authenticated;
GRANT UPDATE (status, conducted_date, findings, score_obtained, score_maximum, report_url)
  ON public.audit_records TO authenticated;

-- 3. anon has no business writing audit records at all.
REVOKE UPDATE, INSERT, DELETE ON public.audit_records FROM anon;

-- 4. Drop the duplicate SELECT policy left behind by the same migration
--    (identical predicate to audit_records_select; two policies OR'd together
--    for no benefit).
DROP POLICY IF EXISTS "Users can view own hospital audit_records" ON public.audit_records;
