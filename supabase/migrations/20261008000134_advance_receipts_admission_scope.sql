-- ============================================================
-- Attribute advance receipts to the admission they were collected for
-- ------------------------------------------------------------
-- BUG THIS SUPPORTS: the IPD "Ledger & Advance" tab and the billing Advance tab
-- merged patient-wide, all-time `advance_receipts` into a SINGLE admission's balance,
-- and their "already mirrored" guard only looked at THAT admission's ipd_advances.
-- So an advance correctly recorded on a PREVIOUS stay was treated as unmirrored on the
-- current one and double-counted (e.g. a 30-Jun ₹20,000 deposit inflating a 15-Jul
-- admission to ₹25,000 and inventing a ₹23,500 "refund due").
--
-- `advance_receipts.admission_id` already exists but was never populated by
-- AdvanceReceiptModal, so historical receipts are unattributable. This migration
-- backfills it so each receipt belongs to exactly one stay, which lets the app scope
-- the ledger by admission_id (and gives every re-admission a fresh ledger).
--
-- SAFETY: additive only — fills NULL admission_id, never overwrites an existing value
-- and never deletes/changes an amount. Idempotent: safe to re-run.
-- ============================================================

-- 1. PRECISE: the receipt was dual-written into ipd_advances (reference_no = receipt_number).
--    That row already carries the correct admission — trust it.
UPDATE public.advance_receipts ar
SET    admission_id = ia.admission_id
FROM   public.ipd_advances ia
WHERE  ar.admission_id IS NULL
  AND  ia.reference_no     = ar.receipt_number
  AND  ia.hospital_id      = ar.hospital_id
  AND  ia.transaction_type = 'deposit'
  AND  ia.admission_id IS NOT NULL;

-- 2. FALLBACK: no mirror row — attribute to the admission that was OPEN when the
--    receipt was collected. Receipts taken outside any stay resolve to NULL and stay
--    patient-level credit (visible in Payments, never inside an admission ledger).
UPDATE public.advance_receipts ar
SET    admission_id = (
         SELECT a.id
         FROM   public.admissions a
         WHERE  a.patient_id  = ar.patient_id
           AND  a.hospital_id = ar.hospital_id
           AND  a.admitted_at <= COALESCE(ar.created_at, ar.payment_date::timestamptz)
           AND  (a.discharged_at IS NULL
                 OR COALESCE(ar.created_at, ar.payment_date::timestamptz) <= a.discharged_at)
         ORDER BY a.admitted_at DESC
         LIMIT 1
       )
WHERE  ar.admission_id IS NULL
  AND  COALESCE(ar.created_at, ar.payment_date::timestamptz) IS NOT NULL;

-- 3. Index — the ledger now filters by admission_id on every open of the tab.
CREATE INDEX IF NOT EXISTS idx_advance_receipts_admission_id
  ON public.advance_receipts (admission_id);
