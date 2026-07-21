-- Patient soft-delete: make `patients.is_active` trustworthy.
--
-- Deleting a patient sets is_active = false (soft delete — records must be retained for
-- medico-legal reasons). But the column was added as a NULLABLE `boolean DEFAULT true`
-- (20260322103542) with no NOT NULL constraint, which makes every filter written against
-- it fragile: PostgREST's `.neq("is_active", false)` becomes SQL `is_active <> false`,
-- which evaluates to NULL — i.e. EXCLUDES the row — for any patient whose is_active is
-- NULL. A single NULL row would silently vanish from the registry.
--
-- Backfill + NOT NULL so `is_active = true` / `= false` is exact everywhere, and callers
-- can use `.eq("is_active", true)` without worrying about three-valued logic.

UPDATE public.patients SET is_active = true WHERE is_active IS NULL;

ALTER TABLE public.patients ALTER COLUMN is_active SET DEFAULT true;
ALTER TABLE public.patients ALTER COLUMN is_active SET NOT NULL;

-- Every patient search is scoped by hospital and now also by is_active; index the pair so
-- adding the flag to ~38 search surfaces doesn't cost a sequential scan.
CREATE INDEX IF NOT EXISTS idx_patients_hospital_active
  ON public.patients (hospital_id, is_active);
