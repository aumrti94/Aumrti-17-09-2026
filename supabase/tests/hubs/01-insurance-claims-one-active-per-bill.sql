-- Phase 5 (the five hubs) — insurance_claims hub, the "negative" half of the per-hub
-- methodology: duplicate and conflicting writes are caught. See
-- 20261106000015_insurance_claims_one_active_per_bill.sql for the full defect this closes —
-- no write path checked for an existing active claim before inserting a new one, so a
-- double-click / retry / stale-form-resubmit created two independent claims for one bill,
-- each posting its own journal reclass entry (a real, silent, double-booked-money defect).
--
-- Three things asserted, not one: (1) a second ACTIVE claim for the same bill is rejected —
-- the actual fix; (2) the legitimate resubmit-after-rejection flow (ClaimsStatus.tsx) still
-- works — the fix must not break the one workflow that deliberately inserts a second row for
-- the same bill; (3) two genuinely different bills are unaffected by each other — the
-- constraint isn't over-broad.
--
-- Self-contained: a throwaway hospital/patient/bill fixture, rolled back at the end. No PHI.

BEGIN;
SELECT plan(5);

INSERT INTO public.hospitals (id, name)
VALUES ('88888888-8888-4888-8888-000000000001', 'Hub Test Hospital — Insurance Claims');

INSERT INTO public.patients (id, hospital_id, full_name, uhid)
VALUES
  ('88888888-8888-4888-8888-000000000002', '88888888-8888-4888-8888-000000000001', 'Hub Test Patient A', 'HTHIC0001'),
  ('88888888-8888-4888-8888-000000000003', '88888888-8888-4888-8888-000000000001', 'Hub Test Patient B', 'HTHIC0002');

INSERT INTO public.bills (id, hospital_id, bill_number, patient_id)
VALUES
  ('88888888-8888-4888-8888-000000000004', '88888888-8888-4888-8888-000000000001', 'HTHIC-BILL-A', '88888888-8888-4888-8888-000000000002'),
  ('88888888-8888-4888-8888-000000000005', '88888888-8888-4888-8888-000000000001', 'HTHIC-BILL-B', '88888888-8888-4888-8888-000000000003');

-- ── 1. First claim for bill A — must succeed ────────────────────────────────────────────────

INSERT INTO public.insurance_claims (id, hospital_id, bill_id, patient_id, tpa_name, claim_number, claimed_amount, status)
VALUES ('88888888-8888-4888-8888-000000000010', '88888888-8888-4888-8888-000000000001',
        '88888888-8888-4888-8888-000000000004', '88888888-8888-4888-8888-000000000002',
        'Hub Test TPA', 'CLM-HUB-0001', 10000, 'submitted');

SELECT is(
  (SELECT count(*)::int FROM public.insurance_claims WHERE bill_id = '88888888-8888-4888-8888-000000000004'),
  1,
  'first claim on bill A is recorded'
);

-- Captures the SQLSTATE a dynamic statement actually raises (or NULL if it doesn't raise),
-- pinning the exact error code rather than "it threw something" — pgTAP's own throws_ok()
-- couples the sqlstate check to an exact-message check in the same overload when the sqlstate
-- is passed as a bare string, which would make this brittle against a harmless wording change.
CREATE FUNCTION pg_temp.capture_sqlstate(p_sql text) RETURNS text AS $$
BEGIN
  EXECUTE p_sql;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END;
$$ LANGUAGE plpgsql;

-- ── 2. A second ACTIVE claim on the SAME bill must be rejected — this is the actual fix.
-- 23505 = unique_violation, from the partial index this migration added.

SELECT is(
  pg_temp.capture_sqlstate($$
    INSERT INTO public.insurance_claims (hospital_id, bill_id, patient_id, tpa_name, claim_number, claimed_amount, status)
    VALUES ('88888888-8888-4888-8888-000000000001', '88888888-8888-4888-8888-000000000004',
            '88888888-8888-4888-8888-000000000002', 'Hub Test TPA', 'CLM-HUB-0002', 10000, 'draft')
  $$),
  '23505',
  'a second active claim (draft) for the same bill is rejected — the double-submit this migration closes'
);

-- ── 3. Reject the first claim, then resubmit — the legitimate workflow this fix must not
-- break (ClaimsStatus.tsx's resubmit-after-rejection, which inserts a NEW row with
-- parent_claim_id pointing at the rejected one, while the rejected row's own status never
-- changes).

UPDATE public.insurance_claims SET status = 'rejected'
WHERE id = '88888888-8888-4888-8888-000000000010';

SELECT lives_ok(
  $$ INSERT INTO public.insurance_claims
       (hospital_id, bill_id, patient_id, tpa_name, claim_number, claimed_amount, status, parent_claim_id)
     VALUES ('88888888-8888-4888-8888-000000000001', '88888888-8888-4888-8888-000000000004',
             '88888888-8888-4888-8888-000000000002', 'Hub Test TPA', 'CLM-HUB-0001-R1', 10000,
             'submitted', '88888888-8888-4888-8888-000000000010') $$,
  'resubmitting after a rejection (a genuinely new active claim, old one now terminal) is not blocked'
);

SELECT is(
  (SELECT count(*)::int FROM public.insurance_claims WHERE bill_id = '88888888-8888-4888-8888-000000000004'),
  2,
  'bill A now correctly carries two rows: one rejected, one active resubmission'
);

-- ── 4. A different bill (B) is completely unaffected — the constraint is per-bill, not global.

SELECT lives_ok(
  $$ INSERT INTO public.insurance_claims (hospital_id, bill_id, patient_id, tpa_name, claim_number, claimed_amount, status)
     VALUES ('88888888-8888-4888-8888-000000000001', '88888888-8888-4888-8888-000000000005',
             '88888888-8888-4888-8888-000000000003', 'Hub Test TPA', 'CLM-HUB-0003', 5000, 'submitted') $$,
  'an active claim on a DIFFERENT bill is unaffected by bill A''s constraint'
);

SELECT * FROM finish();
ROLLBACK;
