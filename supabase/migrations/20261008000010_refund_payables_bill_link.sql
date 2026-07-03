-- Make credit_note_id optional so direct bill refunds (no credit note) can be recorded.
-- Add bill_id so refunds are linked to the originating bill.

ALTER TABLE public.refund_payables
  ALTER COLUMN credit_note_id DROP NOT NULL;

ALTER TABLE public.refund_payables
  ADD COLUMN IF NOT EXISTS bill_id uuid REFERENCES public.bills(id);

CREATE INDEX IF NOT EXISTS refund_payables_bill_idx
  ON public.refund_payables (bill_id)
  WHERE bill_id IS NOT NULL;
