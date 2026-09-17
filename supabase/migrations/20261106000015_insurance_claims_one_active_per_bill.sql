-- Phase 5 (the five hubs) — insurance_claims hub. Per-hub methodology (PHASED_TEST_PLAN.md
-- §8 Phase 5): "duplicate and conflicting writes are caught (negative)". Auditing every write
-- path into this table (src/hooks/useInsuranceSubmission.ts, ClaimBundleGenerator.tsx,
-- ClaimsStatus.tsx, InsuranceTab.tsx) found none of them check for an existing active claim
-- before inserting a new one — a double-click on "Submit Claim", a network retry, or a user
-- reopening the claim form after a stale page all create a second, independent
-- insurance_claims row for the same bill. Each one runs its own
-- postClaimReclass()/autoPostJournalEntry() (Dr AR-Insurance/TPA, Cr AR-Patients), so a
-- duplicate claim double-books the insurer receivable in the general ledger — real money,
-- silently wrong, exactly the class of defect the plan's severity rubric calls S1/S2.
--
-- The schema already anticipated the SYMPTOM of this from the insurer's side —
-- insurance_claims_rejection_code_chk has always allowed 'duplicate_claim' as a rejection
-- reason — but nothing ever prevented the hospital's own write path from causing it.
--
-- THE FIX is not "one claim per bill, ever": ClaimsStatus.tsx's resubmit flow deliberately
-- inserts a SECOND row (parent_claim_id pointing at the first) after a claim is rejected,
-- which is the correct, intended behaviour and must keep working. The real invariant is
-- "at most one ACTIVE claim per bill at a time" — a claim in a terminal state (rejected,
-- settled, written_off) does not block a fresh submission for the same bill.

BEGIN;

DROP INDEX IF EXISTS idx_insurance_claims_one_active_per_bill;
CREATE UNIQUE INDEX idx_insurance_claims_one_active_per_bill
  ON public.insurance_claims (bill_id)
  WHERE status IN ('draft', 'submitted', 'under_review', 'approved', 'partially_approved');

COMMIT;
