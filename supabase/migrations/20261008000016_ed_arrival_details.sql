-- ED arrival capture (Phase 4). Stores how the patient arrived beyond the existing
-- arrival_mode text column: brought-by / referring facility, ambulance ref, etc.
-- Additive + nullable; the existing arrival_mode column and all flows are unchanged.
ALTER TABLE public.ed_visits
  ADD COLUMN IF NOT EXISTS arrival_details jsonb;
