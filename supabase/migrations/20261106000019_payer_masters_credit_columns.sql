-- Phase 5 settings sweep — KNOWN-BUG-143. Same defect class as KNOWN-BUG-118 and its siblings
-- (a migration guarded by `IF EXISTS` against a table created LATER in the migration history,
-- so the guard is false at the time it runs and the ALTER TABLE silently never executes):
--
--   20260531000006_rcm_gaps.sql runs BEFORE 20260908000004_payer_masters.sql creates the table
--   it's trying to extend, so its "Gap 8: Credit Limit Enforcement tracking" block has been a
--   silent no-op for its entire existence. `payer_masters` has never had `credit_hold`,
--   `credit_hold_reason`, `credit_hold_at`, or `outstanding_amount` — the exact four columns
--   `src/lib/creditLimitCheck.ts` (checkPayerCreditLimit / increasePayerOutstanding /
--   decreasePayerOutstanding) reads and writes. Every one of those functions would fail with an
--   unknown-column error if called, which is one reason (on top of never being invoked from any
--   billing call site) that a hospital setting a `credit_limit` in Settings → Payer Masters has
--   zero effect: even if something DID call this module today, it would error, not enforce.
--
-- Per this repo's migration-immutability convention, 20260531000006_rcm_gaps.sql is not edited
-- (it already ran, possibly against other environments) — this is a new migration, timestamped
-- after 20260908000004 so payer_masters unconditionally exists by the time it runs, no guard
-- needed.
--
-- This closes the schema half only. Actually wiring checkPayerCreditLimit()/
-- increasePayerOutstanding() into the billing flow needs two more decisions this migration does
-- not make: (a) claim creation (useInsuranceSubmission.ts) currently stores the TPA as a free-text
-- `tpa_name`, never a `payer_masters.id` — resolving which payer_masters row a claim's outstanding
-- should accrue to needs that lookup built first; (b) whether an over-limit bill should hard-block
-- submission or just warn is a billing-policy call for revenue-pod, not an engineering default.
-- Tracked as the remaining half of KNOWN-BUG-143.

BEGIN;

ALTER TABLE public.payer_masters
  ADD COLUMN IF NOT EXISTS credit_hold        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS credit_hold_reason text,
  ADD COLUMN IF NOT EXISTS credit_hold_at     timestamptz,
  ADD COLUMN IF NOT EXISTS outstanding_amount numeric(12,2) NOT NULL DEFAULT 0;

COMMIT;
