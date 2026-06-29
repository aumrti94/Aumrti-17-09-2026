-- Fix vaccine_master: correct RLS policy, relax NOT NULL constraints,
-- and replace global vaccine_code unique with per-hospital unique.

-- 1. Fix RLS: old policy used `WHERE id = auth.uid()` (wrong — id is internal app PK).
--    Replace with get_user_hospital_id() which correctly maps auth_user_id → hospital_id.
DROP POLICY IF EXISTS "tenant_isolation_vaccine_master" ON public.vaccine_master;
CREATE POLICY "tenant_isolation_vaccine_master"
  ON public.vaccine_master AS PERMISSIVE FOR ALL TO authenticated
  USING    (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- 2. Make hospital_id NOT NULL (every vaccine must belong to a hospital now that
--    global seed data is removed).
ALTER TABLE public.vaccine_master
  ALTER COLUMN hospital_id SET NOT NULL;

-- 3. Drop the global unique on vaccine_code (prevents two hospitals using "BCG").
--    Replace with a per-hospital unique constraint.
ALTER TABLE public.vaccine_master
  DROP CONSTRAINT IF EXISTS vaccine_master_vaccine_code_key;

ALTER TABLE public.vaccine_master
  DROP CONSTRAINT IF EXISTS vaccine_master_hospital_id_vaccine_code_key;

ALTER TABLE public.vaccine_master
  ADD CONSTRAINT vaccine_master_hospital_id_vaccine_code_key
  UNIQUE (hospital_id, vaccine_code);

-- 4. Allow NULL for type and route — they are optional in the custom catalogue UI.
ALTER TABLE public.vaccine_master
  ALTER COLUMN type  DROP NOT NULL,
  ALTER COLUMN route DROP NOT NULL;

-- 5. Fix trigger: add 'conjugate' to allowed types; guard NULL explicitly so optional
--    fields pass through without raising.
CREATE OR REPLACE FUNCTION public.validate_vaccine_master()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.type IS NOT NULL AND NEW.type NOT IN (
    'live_attenuated','inactivated','subunit','toxoid','mrna',
    'viral_vector','combination','conjugate','other'
  ) THEN
    RAISE EXCEPTION 'Invalid vaccine type: %', NEW.type;
  END IF;
  IF NEW.route IS NOT NULL AND NEW.route NOT IN ('im','sc','id','oral','intranasal') THEN
    RAISE EXCEPTION 'Invalid route: %', NEW.route;
  END IF;
  RETURN NEW;
END; $$;
