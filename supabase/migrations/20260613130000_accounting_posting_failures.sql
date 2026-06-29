-- =============================================================
-- Part D: accounting_posting_failures table
-- Captures every trigger_event that had no matching auto_posting_rule.
-- Written by src/lib/accounting.ts when !rule instead of silently returning null.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.accounting_posting_failures (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id   uuid        NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  trigger_event text        NOT NULL,
  source_module text,
  source_id     text        NOT NULL,
  amount        numeric(12,2),
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS accounting_posting_failures_hospital_created_idx
  ON public.accounting_posting_failures (hospital_id, created_at DESC);

ALTER TABLE public.accounting_posting_failures ENABLE ROW LEVEL SECURITY;

-- Hospital staff can read their own failures
CREATE POLICY "hospital staff read own posting failures"
  ON public.accounting_posting_failures
  FOR SELECT
  USING (hospital_id = public.get_user_hospital_id());

-- Inserts come from the authenticated client (autoPostJournalEntry runs with the
-- logged-in user's JWT, so hospital_id matches get_user_hospital_id()).
CREATE POLICY "hospital staff insert own posting failures"
  ON public.accounting_posting_failures
  FOR INSERT
  WITH CHECK (hospital_id = public.get_user_hospital_id());
