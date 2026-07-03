-- ED discharge documentation (Phase 2). Stores the structured ED discharge summary /
-- prescription / follow-up advice for a visit. Additive + nullable; nothing existing changes.
ALTER TABLE public.ed_visits
  ADD COLUMN IF NOT EXISTS discharge_summary jsonb;
