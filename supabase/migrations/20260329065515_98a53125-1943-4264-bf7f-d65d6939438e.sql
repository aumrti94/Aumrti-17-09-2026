-- Migration tables for data import tool

-- migration_jobs
CREATE TABLE public.migration_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  job_name text NOT NULL,
  entity_type text NOT NULL,
  status text DEFAULT 'pending',
  file_name text NOT NULL,
  file_url text,
  total_rows integer DEFAULT 0,
  valid_rows integer DEFAULT 0,
  error_rows integer DEFAULT 0,
  imported_rows integer DEFAULT 0,
  skipped_rows integer DEFAULT 0,
  column_mapping jsonb DEFAULT '{}',
  error_report jsonb DEFAULT '[]',
  can_rollback boolean DEFAULT true,
  rollback_until timestamptz,
  rolled_back_at timestamptz,
  started_by uuid REFERENCES public.users(id),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Validation trigger for entity_type and status
CREATE OR REPLACE FUNCTION public.validate_migration_job()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.entity_type NOT IN ('patients','staff','services','drugs','vendors','lab_tests') THEN
    RAISE EXCEPTION 'Invalid entity_type: %', NEW.entity_type;
  END IF;
  IF NEW.status NOT IN ('pending','validating','importing','completed','failed','rolled_back') THEN
    RAISE EXCEPTION 'Invalid migration status: %', NEW.status;
  END IF;
  RETURN NEW;
END;$$;

CREATE TRIGGER trg_validate_migration_job
  BEFORE INSERT OR UPDATE ON public.migration_jobs
  FOR EACH ROW EXECUTE FUNCTION public.validate_migration_job();

-- RLS
ALTER TABLE public.migration_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Hospital isolation" ON public.migration_jobs
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE INDEX idx_migration_jobs_hospital ON public.migration_jobs(hospital_id);
CREATE INDEX idx_migration_jobs_status ON public.migration_jobs(status);

-- migration_logs
CREATE TABLE public.migration_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  job_id uuid REFERENCES public.migration_jobs(id) NOT NULL,
  row_number integer NOT NULL,
  entity_id uuid,
  status text NOT NULL,
  error_message text,
  source_data jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.validate_migration_log_status()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status NOT IN ('imported','skipped','error','rolled_back') THEN
    RAISE EXCEPTION 'Invalid migration log status: %', NEW.status;
  END IF;
  RETURN NEW;
END;$$;

CREATE TRIGGER trg_validate_migration_log
  BEFORE INSERT OR UPDATE ON public.migration_logs
  FOR EACH ROW EXECUTE FUNCTION public.validate_migration_log_status();

ALTER TABLE public.migration_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Hospital isolation" ON public.migration_logs
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE INDEX idx_migration_logs_job ON public.migration_logs(job_id);
CREATE INDEX idx_migration_logs_hospital ON public.migration_logs(hospital_id);