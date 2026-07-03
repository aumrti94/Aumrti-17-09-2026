-- Fix RLS on ipd_advances: the original policy used `users.id = auth.uid()`
-- but users.id is no longer the auth UUID (changed in migration 20260322111223).
-- Use get_user_hospital_id() which already handles the correct auth_user_id lookup,
-- consistent with every other table in the app.

DROP POLICY IF EXISTS "hospital_isolation_ipd_advances" ON public.ipd_advances;

CREATE POLICY "hospital_isolation_ipd_advances" ON public.ipd_advances
  FOR ALL TO authenticated
  USING  (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());
