-- Allow aumrti_admin to hard-delete hospitals.
-- ON DELETE CASCADE on all child FK relationships means one DELETE
-- on hospitals removes ALL patient records, bills, staff, etc.

DROP POLICY IF EXISTS "aumrti_admin_delete_hospital" ON public.hospitals;

CREATE POLICY "aumrti_admin_delete_hospital"
  ON public.hospitals FOR DELETE TO authenticated
  USING (public.is_aumrti_admin());
