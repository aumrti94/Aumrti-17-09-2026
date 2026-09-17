-- pmjay-claim-submit/index.ts upserts into govt_scheme_claims with
-- `onConflict: "hospital_id,scheme_type,claim_number"` — a target Postgres requires a real
-- unique (or exclusion) constraint to resolve, and none has ever existed on this table (only
-- a plain non-unique index on hospital_id/scheme_type/status/created_at). Every single
-- upsert from this function — sandbox mock and live HCX submission alike — has always been
-- rejected outright ("there is no unique or exclusion constraint matching the ON CONFLICT
-- specification"), stacked with the sibling scheme_type-casing bug fixed in the same pass.
-- Adds the constraint the code was already written to assume exists, rather than removing
-- the upsert's intended idempotency (a retried submission with the same claim_number should
-- update the existing row, not fail or duplicate it). NULLs in claim_number (other schemes'
-- plain-insert callers, e.g. esi-claim-submit/cghs-eligibility, don't all set it) never
-- conflict with each other under a standard unique constraint, so this is additive-safe for
-- every other scheme_type already writing to this table. Found via Phase 6 edge-function
-- testing.

BEGIN;

ALTER TABLE public.govt_scheme_claims
  ADD CONSTRAINT govt_scheme_claims_hospital_scheme_claim_number_key
  UNIQUE (hospital_id, scheme_type, claim_number);

COMMIT;
