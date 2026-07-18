-- Fix: clinical alerts could never be acknowledged.
--
-- Migration 20260327053837 ("make audit tables immutable") dropped the FOR ALL
-- policy on clinical_alerts and replaced it with INSERT + SELECT only. That left
-- the table with RLS enabled and no UPDATE policy, so every acknowledge from the
-- app matched zero rows. PostgREST reports no error for a zero-row UPDATE, so the
-- UI showed "Alert acknowledged" while the row was never touched, and the alert
-- reappeared on the next fetch.
--
-- Acknowledgement is a legitimate state transition on this table (the
-- is_acknowledged / acknowledged_by / acknowledged_at columns exist precisely for
-- it), so it must be allowed. The immutability intent of that migration is kept by
-- narrowing UPDATE to the three acknowledgement columns via column-level grants:
-- alert_message, severity, alert_type, created_at et al stay unwritable from the
-- client. escalated_at / escalation_count are written only by the alert-escalation
-- edge function under service_role, which keeps its own table-level grant.

-- 1. Hospital-scoped UPDATE policy (the missing piece).
DROP POLICY IF EXISTS "clinical_alerts_update" ON public.clinical_alerts;
CREATE POLICY "clinical_alerts_update" ON public.clinical_alerts
  FOR UPDATE TO authenticated
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());

-- 2. Restrict *which* columns authenticated may write. Table-level UPDATE is
--    revoked first; a table-level grant would otherwise mask the column grants.
REVOKE UPDATE ON public.clinical_alerts FROM authenticated;
GRANT UPDATE (is_acknowledged, acknowledged_by, acknowledged_at)
  ON public.clinical_alerts TO authenticated;

-- 3. anon has no business writing clinical alerts at all.
REVOKE UPDATE, INSERT, DELETE ON public.clinical_alerts FROM anon;

-- 4. Drop the duplicate SELECT policy left behind by the same migration
--    (identical predicate to clinical_alerts_select; two policies OR'd together
--    for no benefit).
DROP POLICY IF EXISTS "Users can view own hospital alerts" ON public.clinical_alerts;
