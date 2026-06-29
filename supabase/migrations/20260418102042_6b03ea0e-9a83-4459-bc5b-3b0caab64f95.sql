
-- 1. Create audit_log table for tamper-proof PHI change tracking
CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid,
  table_name text NOT NULL,
  record_id uuid,
  action text NOT NULL,
  old_values jsonb,
  new_values jsonb,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now(),
  -- App-level fields used by src/lib/auditLog.ts (kept for backward compatibility)
  user_id uuid,
  user_name text,
  user_role text,
  module text,
  entity_type text,
  entity_id uuid,
  details jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_hospital ON public.audit_log(hospital_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_table_record ON public.audit_log(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_changed_by ON public.audit_log(changed_by);

-- 2. Enable RLS — read-only for hospital members, no UPDATE/DELETE allowed (tamper-proof)
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Hospital members can view their audit log" ON public.audit_log;
CREATE POLICY "Hospital members can view their audit log"
ON public.audit_log
FOR SELECT
TO authenticated
USING (hospital_id = public.get_user_hospital_id());

DROP POLICY IF EXISTS "System can insert audit entries" ON public.audit_log;
CREATE POLICY "System can insert audit entries"
ON public.audit_log
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Intentionally NO UPDATE/DELETE policies — audit log is append-only.

-- 3. Generic PHI audit trigger function
CREATE OR REPLACE FUNCTION public.log_phi_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hospital_id uuid;
  v_record_id uuid;
BEGIN
  -- Safely extract hospital_id and id from NEW/OLD (works for any table that has these columns)
  BEGIN
    v_hospital_id := COALESCE(
      (to_jsonb(NEW) ->> 'hospital_id')::uuid,
      (to_jsonb(OLD) ->> 'hospital_id')::uuid
    );
  EXCEPTION WHEN OTHERS THEN v_hospital_id := NULL;
  END;

  BEGIN
    v_record_id := COALESCE(
      (to_jsonb(NEW) ->> 'id')::uuid,
      (to_jsonb(OLD) ->> 'id')::uuid
    );
  EXCEPTION WHEN OTHERS THEN v_record_id := NULL;
  END;

  INSERT INTO public.audit_log (
    hospital_id, table_name, record_id, action,
    old_values, new_values, changed_by, changed_at,
    module, entity_type, entity_id
  ) VALUES (
    v_hospital_id,
    TG_TABLE_NAME,
    v_record_id,
    TG_OP,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
    auth.uid(),
    now(),
    'db_trigger',
    TG_TABLE_NAME,
    v_record_id
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 4. Attach triggers to four critical PHI tables (idempotent)
DROP TRIGGER IF EXISTS audit_patients ON public.patients;
CREATE TRIGGER audit_patients
  AFTER INSERT OR UPDATE OR DELETE ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.log_phi_change();

DROP TRIGGER IF EXISTS audit_prescriptions ON public.prescriptions;
CREATE TRIGGER audit_prescriptions
  AFTER INSERT OR UPDATE OR DELETE ON public.prescriptions
  FOR EACH ROW EXECUTE FUNCTION public.log_phi_change();

DROP TRIGGER IF EXISTS audit_bills ON public.bills;
CREATE TRIGGER audit_bills
  AFTER INSERT OR UPDATE OR DELETE ON public.bills
  FOR EACH ROW EXECUTE FUNCTION public.log_phi_change();

DROP TRIGGER IF EXISTS audit_admissions ON public.admissions;
CREATE TRIGGER audit_admissions
  AFTER INSERT OR UPDATE OR DELETE ON public.admissions
  FOR EACH ROW EXECUTE FUNCTION public.log_phi_change();
