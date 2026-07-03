-- OT Gap review (Phase 9): elective/emergency/add-on case-type field, distinct from
-- surgery_category (which is a specialty picklist, not an urgency classification).
ALTER TABLE public.ot_schedules
  ADD COLUMN IF NOT EXISTS case_type text NOT NULL DEFAULT 'elective'
  CHECK (case_type IN ('elective', 'emergency', 'add_on'));
