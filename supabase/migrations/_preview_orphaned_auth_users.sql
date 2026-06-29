-- Preview: which auth users will be deleted as orphans
-- Run this in Supabase Dashboard → SQL Editor to see the list before deleting.
SELECT
  au.id,
  au.email,
  au.created_at
FROM auth.users au
WHERE
  -- NOT linked to any user row in an existing hospital
  NOT EXISTS (
    SELECT 1 FROM public.users pu
    WHERE pu.auth_user_id = au.id
      AND pu.hospital_id IN (SELECT id FROM public.hospitals)
  )
  -- NOT an active platform admin
  AND NOT EXISTS (
    SELECT 1 FROM public.aumrti_admins aa
    WHERE aa.auth_user_id = au.id
      AND aa.is_active = true
  )
ORDER BY au.email;
