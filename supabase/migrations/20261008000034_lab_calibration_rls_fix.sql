-- Phase 1 of Lab/Pathology/LIMS completion plan: lab_calibration_records' RLS policy
-- (20260901000009) compares users.id = auth.uid(), but users.id is the app-level PK —
-- the auth UID lives in users.auth_user_id. The subquery therefore returns no row and
-- the policy denies everyone except table owners; calibration records were only visible
-- because inserts/reads happened before RLS misconfig surfaced or via service role.
-- Recreate with the standard per-hospital pattern (get_user_hospital_id()) used by every
-- other lab table, including WITH CHECK so writes are hospital-scoped too.

DROP POLICY IF EXISTS "hospital_isolation_lab_calibration" ON public.lab_calibration_records;

CREATE POLICY "hospital_isolation_lab_calibration" ON public.lab_calibration_records
  FOR ALL TO authenticated
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());
