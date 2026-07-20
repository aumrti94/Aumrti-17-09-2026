-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: one_open_refund_per_bill
-- Purpose  : Stop duplicate refund requests stacking up in the Refund Approval
--            Inbox. RefundModal INSERTed unconditionally, so every click of
--            "Process Refund" raised another pending row for the same bill —
--            observed live as two ₹18,500 rows against BILL-20260716-0004, 43
--            minutes apart. Approving both would pay the patient twice.
--
--            settleAdmissionAdvance already guarded in application code, but
--            its guard filtered on admission_id with `.eq()`, which does not
--            match NULL, so discharge-time auto-raises could still double up
--            when no admission was linked (the "No bill linked" row in the
--            inbox). Application-level guards are also racy — two clicks in
--            flight both read "no existing refund" and both insert.
--
--            These indexes make it impossible at the database level regardless
--            of which code path writes.
--
-- Scope    : Only OPEN requests (pending_approval / approved) are constrained.
--            A 'processed' or 'rejected' refund does NOT block a later,
--            genuinely new one — a patient can overpay again on the same bill
--            and be owed a second, separate refund. Blocking those forever
--            would be wrong.
--
--            Pharmacy drug-return refunds carry a credit_note_id and are
--            excluded: each credit note is its own distinct refund and several
--            can legitimately be open against one admission at once.
-- Idempotent: CREATE UNIQUE INDEX IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Retire pre-existing duplicates ────────────────────────────────────────
-- The unique indexes below CANNOT be created while duplicate open rows exist,
-- so the ones already in the table must be resolved first. For each bill (and
-- each bill-less admission) the EARLIEST open request is kept — it carries the
-- original requester and timestamp — and the later copies are rejected.
--
-- Safe: these are 'pending_approval'/'approved' rows only. No money has been
-- disbursed against them, so this moves no cash and reverses no payment; it
-- clears redundant paperwork out of the approval inbox.
--
-- NOTE: the surviving row's AMOUNT may still be wrong if it was raised while
-- the advance-balance bug was live (patient-scoped advances inflated the
-- figure). Review the survivors in Billing → Refunds and reject any whose
-- amount no longer matches the bill before approving.

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY COALESCE(bill_id, admission_id)
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM public.refund_payables
  WHERE credit_note_id IS NULL
    AND status IN ('pending_approval', 'approved')
    AND COALESCE(bill_id, admission_id) IS NOT NULL
)
UPDATE public.refund_payables r
   SET status = 'rejected',
       notes  = COALESCE(r.notes || ' — ', '')
                || 'Auto-rejected: duplicate refund request for the same bill '
                || '(one-open-refund rule, migration 20261008000153).'
  FROM ranked
 WHERE r.id = ranked.id
   AND ranked.rn > 1;

-- ── 2. Make it impossible to recur ───────────────────────────────────────────
-- One open refund per BILL.
CREATE UNIQUE INDEX IF NOT EXISTS refund_payables_one_open_per_bill_idx
  ON public.refund_payables (bill_id)
  WHERE bill_id IS NOT NULL
    AND credit_note_id IS NULL
    AND status IN ('pending_approval', 'approved');

-- One open refund per ADMISSION when no bill is linked yet (discharge-time
-- auto-raise before the bill exists). Without this the NULL bill_id above
-- imposes no constraint at all, since NULLs never collide in a unique index.
CREATE UNIQUE INDEX IF NOT EXISTS refund_payables_one_open_per_admission_idx
  ON public.refund_payables (admission_id)
  WHERE bill_id IS NULL
    AND credit_note_id IS NULL
    AND admission_id IS NOT NULL
    AND status IN ('pending_approval', 'approved');
