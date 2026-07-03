-- Link bills to an ED visit so Emergency charges consolidate onto one 'emergency' bill.
-- bills.encounter_id FKs opd_encounters(id) and cannot hold an ed_visit id, so ED billing
-- needs its own reference column (mirrors how encounter_id/admission_id key OPD/IPD bills).
-- Additive + idempotent; nothing existing is altered.
ALTER TABLE public.bills
  ADD COLUMN IF NOT EXISTS ed_visit_id uuid REFERENCES public.ed_visits(id);

CREATE INDEX IF NOT EXISTS idx_bills_ed_visit_id ON public.bills(ed_visit_id);
