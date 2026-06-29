-- Fix stale admissions where the patient physically left but status was never updated.

-- Case 1: discharged_at was set (by DischargeSummaryGenerator) but status column
--         wasn't updated — shouldn't normally happen but guard against it.
UPDATE admissions
SET status = 'discharged'
WHERE discharged_at IS NOT NULL
  AND status = 'active';

-- Case 2: bed is no longer occupied (cleaning/available/maintenance) but admission
--         was never closed — happens when billing clearance gate blocked the
--         DischargeSummaryGenerator from completing the discharge flow.
UPDATE admissions
SET status = 'discharged',
    discharged_at = now()
WHERE status = 'active'
  AND bed_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM beds
    WHERE beds.id = admissions.bed_id
      AND beds.status IN ('available', 'cleaning', 'maintenance')
  );
