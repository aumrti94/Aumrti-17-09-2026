-- Billing gap-fill plan, Phase 7 — accounting_posting_failures was write-once:
-- one fire-and-forget insert (src/lib/accounting.ts), one read-only card, no
-- way to retry a posting once the missing auto_posting_rules row is added.
-- The stored row also didn't capture enough of the original PostingData
-- (description, posted_by, entry_date, cost_centre_id) to faithfully repost
-- it later — adding those plus resolved_at/resolved_by so a retry can be
-- a real re-post of the exact original entry, not a reconstructed guess.

ALTER TABLE public.accounting_posting_failures
  ADD COLUMN IF NOT EXISTS description     text,
  ADD COLUMN IF NOT EXISTS posted_by       uuid,
  ADD COLUMN IF NOT EXISTS entry_date      date,
  ADD COLUMN IF NOT EXISTS cost_centre_id  uuid,
  ADD COLUMN IF NOT EXISTS resolved_at     timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by     uuid;

-- No UPDATE policy existed at all (only SELECT + INSERT) — needed so the
-- retry action can mark a failure resolved after a successful re-post.
CREATE POLICY "hospital staff update own posting failures"
  ON public.accounting_posting_failures
  FOR UPDATE
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());
