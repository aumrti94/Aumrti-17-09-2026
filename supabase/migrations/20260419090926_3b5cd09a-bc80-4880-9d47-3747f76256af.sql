
-- 1. Cleanup invalid custom_* role permission rows
DELETE FROM public.role_permissions WHERE role_name LIKE 'custom_%';

-- 2. Seed function: insert default 7 system roles for a hospital
CREATE OR REPLACE FUNCTION public.seed_default_roles_for_hospital(p_hospital_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.role_permissions (hospital_id, role_name, role_label, is_system_role, permissions)
  VALUES
    (p_hospital_id, 'super_admin',       'Super Admin',  true, '{"all": true}'::jsonb),
    (p_hospital_id, 'hospital_admin',    'Admin',        true, '{"all": true}'::jsonb),
    (p_hospital_id, 'doctor',            'Doctor',       true, '{"opd":"rw","ipd":"rw","emergency":"rw","lab":"r","radiology":"r","pharmacy":"r","patients":"rw","reports":"r"}'::jsonb),
    (p_hospital_id, 'nurse',             'Nurse',        true, '{"nursing":"rw","ipd":"rw","emergency":"rw","patients":"r","pharmacy":"r"}'::jsonb),
    (p_hospital_id, 'receptionist',      'Reception',    true, '{"opd":"rw","patients":"rw","appointments":"rw","billing":"r"}'::jsonb),
    (p_hospital_id, 'pharmacist',        'Pharmacist',   true, '{"pharmacy":"rw","inventory":"rw","patients":"r"}'::jsonb),
    (p_hospital_id, 'lab_tech',          'Lab Tech',     true, '{"lab":"rw","patients":"r"}'::jsonb)
  ON CONFLICT DO NOTHING;
END;
$$;

-- 3. Backfill existing hospitals with default roles
DO $$
DECLARE h record;
BEGIN
  FOR h IN SELECT id FROM public.hospitals LOOP
    PERFORM public.seed_default_roles_for_hospital(h.id);
  END LOOP;
END $$;

-- 4. Promote founder (earliest hospital_admin per hospital) to super_admin
WITH founders AS (
  SELECT DISTINCT ON (hospital_id) id, hospital_id
  FROM public.users
  WHERE role = 'hospital_admin'
  ORDER BY hospital_id, created_at ASC
)
UPDATE public.users u
SET role = 'super_admin'
FROM founders f
WHERE u.id = f.id;
