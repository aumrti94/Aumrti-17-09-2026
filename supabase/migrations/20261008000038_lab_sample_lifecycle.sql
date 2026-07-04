-- Phase 5 of Lab/Pathology/LIMS completion plan: real sample lifecycle.
--
-- lab_samples has had a dormant rejection_reason column since the original schema
-- (20260322152823) with no workflow behind it — no UI could ever reject a hemolyzed/
-- clotted/insufficient sample and trigger recollection. This adds the rejection
-- bookkeeping columns, a link from a recollection sample back to the rejected one,
-- and (safe here, unlike lab_order_items) a status CHECK: every status the app writes
-- is known (pending/collected/received/processing from LabResultWorkspace + creation
-- paths), and stray legacy values are normalized first so the constraint can't fail.

ALTER TABLE public.lab_samples ADD COLUMN IF NOT EXISTS rejected_at timestamptz;
ALTER TABLE public.lab_samples ADD COLUMN IF NOT EXISTS rejected_by uuid REFERENCES public.users(id);
ALTER TABLE public.lab_samples ADD COLUMN IF NOT EXISTS recollected_from_sample_id uuid REFERENCES public.lab_samples(id);

-- Normalize any stray status values before constraining (defensive; none are expected)
UPDATE public.lab_samples
SET status = 'pending'
WHERE status IS NULL
   OR status NOT IN ('pending', 'collected', 'received', 'processing', 'rejected', 'completed');

ALTER TABLE public.lab_samples DROP CONSTRAINT IF EXISTS lab_samples_status_check;
ALTER TABLE public.lab_samples
  ADD CONSTRAINT lab_samples_status_check
  CHECK (status IN ('pending', 'collected', 'received', 'processing', 'rejected', 'completed'));

CREATE INDEX IF NOT EXISTS idx_lab_samples_hospital_status
  ON public.lab_samples (hospital_id, status);
