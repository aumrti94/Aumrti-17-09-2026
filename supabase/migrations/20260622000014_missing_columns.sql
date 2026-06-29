-- Add rate_per_day to wards (used by IPD billing and ward settings)
ALTER TABLE public.wards
  ADD COLUMN IF NOT EXISTS rate_per_day numeric(10,2) DEFAULT 0;

-- Add designation to users (used by payroll and HR modules)
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS designation text;

-- Add month/year int columns to payroll_runs for payroll engine compatibility.
-- The old schema used run_month text (e.g. "2026-06"); new schema uses month/year ints.
-- Both columns are added idempotently and backfilled from run_month if present.
ALTER TABLE public.payroll_runs
  ADD COLUMN IF NOT EXISTS month int,
  ADD COLUMN IF NOT EXISTS year  int,
  ADD COLUMN IF NOT EXISTS processed_at  timestamptz,
  ADD COLUMN IF NOT EXISTS approved_at   timestamptz,
  ADD COLUMN IF NOT EXISTS disbursed_at  timestamptz;

-- Backfill month/year from run_month (format: "YYYY-MM")
UPDATE public.payroll_runs
SET
  year  = SUBSTRING(run_month, 1, 4)::int,
  month = SUBSTRING(run_month, 6, 2)::int
WHERE run_month IS NOT NULL
  AND year IS NULL;

-- Add unique constraint for payroll engine upsert (hospital_id, month, year)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payroll_runs_hospital_month_year_key'
      AND conrelid = 'public.payroll_runs'::regclass
  ) THEN
    ALTER TABLE public.payroll_runs
      ADD CONSTRAINT payroll_runs_hospital_month_year_key
      UNIQUE (hospital_id, month, year);
  END IF;
END $$;
