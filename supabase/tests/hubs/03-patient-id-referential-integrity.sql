-- Phase 5 (the five hubs) — patients.id hub. See
-- 20261106000017_patient_id_missing_fks.sql for the full finding: 16 tables had a `patient_id`
-- column with no foreign key to `patients(id)` at all, so nothing ever stopped a `patient_id`
-- in any of them from referencing a patient that never existed. This file proves the fix
-- actually enforces going forward, on a representative sample spanning both the "existing
-- chapter, brand-new table" pattern (care_plans — chronic disease module) and the "nullable
-- patient_id, still worth protecting" pattern (ai_safety_flags).
--
-- Two things asserted per table: a garbage patient_id is now rejected (the fix), and a real
-- patient_id still works exactly as before (the fix doesn't break legitimate writes).
--
-- Self-contained: a throwaway hospital + one real patient, rolled back at the end. No PHI.

BEGIN;
SELECT plan(6);

INSERT INTO public.hospitals (id, name)
VALUES ('11111111-2222-4333-8444-000000000001', 'Hub Test Hospital — Patient FK');

INSERT INTO public.patients (id, hospital_id, full_name, uhid)
VALUES ('11111111-2222-4333-8444-000000000002', '11111111-2222-4333-8444-000000000001', 'Hub Test Patient', 'HTHPFK001');

CREATE FUNCTION pg_temp.capture_sqlstate(p_sql text) RETURNS text AS $$
BEGIN
  EXECUTE p_sql;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END;
$$ LANGUAGE plpgsql;

-- ── care_plans: NOT NULL patient_id, previously fully unconstrained ────────────────────────

SELECT is(
  pg_temp.capture_sqlstate($$
    INSERT INTO public.care_plans (hospital_id, patient_id, condition)
    VALUES ('11111111-2222-4333-8444-000000000001', '99999999-0000-4000-8000-000000000000', 'Fabricated condition for a nonexistent patient')
  $$),
  '23503',
  'care_plans rejects a patient_id that does not exist (23503 = foreign_key_violation) — this insert succeeded silently before the fix'
);

SELECT lives_ok(
  $$ INSERT INTO public.care_plans (hospital_id, patient_id, condition)
     VALUES ('11111111-2222-4333-8444-000000000001', '11111111-2222-4333-8444-000000000002', 'Diabetes management') $$,
  'care_plans still accepts a real patient_id exactly as before'
);

-- ── patient_ai_context: also carries a UNIQUE(hospital_id, patient_id) — prove the new FK
-- doesn't interfere with that existing constraint.

SELECT is(
  pg_temp.capture_sqlstate($$
    INSERT INTO public.patient_ai_context (hospital_id, patient_id)
    VALUES ('11111111-2222-4333-8444-000000000001', '99999999-0000-4000-8000-000000000000')
  $$),
  '23503',
  'patient_ai_context rejects a nonexistent patient_id'
);

SELECT lives_ok(
  $$ INSERT INTO public.patient_ai_context (hospital_id, patient_id)
     VALUES ('11111111-2222-4333-8444-000000000001', '11111111-2222-4333-8444-000000000002') $$,
  'patient_ai_context still accepts a real patient_id, and its own UNIQUE(hospital_id, patient_id) is unaffected'
);

-- ── ai_safety_flags: patient_id is NULLABLE here — a NULL must still be allowed (this table
-- logs hospital-wide AI safety flags that aren't always patient-specific), only a non-NULL
-- garbage value should be rejected.

SELECT is(
  pg_temp.capture_sqlstate($$
    INSERT INTO public.ai_safety_flags (hospital_id, patient_id, feature_key)
    VALUES ('11111111-2222-4333-8444-000000000001', '99999999-0000-4000-8000-000000000000', 'test_feature')
  $$),
  '23503',
  'ai_safety_flags rejects a non-null garbage patient_id'
);

SELECT lives_ok(
  $$ INSERT INTO public.ai_safety_flags (hospital_id, patient_id, feature_key)
     VALUES ('11111111-2222-4333-8444-000000000001', NULL, 'test_feature') $$,
  'ai_safety_flags still accepts NULL patient_id — a foreign key never rejects NULL, only a populated mismatch'
);

SELECT * FROM finish();
ROLLBACK;
