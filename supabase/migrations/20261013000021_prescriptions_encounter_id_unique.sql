-- prescriptions: one live prescription per OPD encounter, mirroring the guardrail
-- 20261012000020_prescriptions_ipd_context.sql already added for admission_id.
--
-- WHY. autoSavePrescription (ConsultationWorkspace.tsx) decides insert-vs-update from the
-- prescriptionId React state. handleComplete's explicit save can run concurrently with a
-- leftover 2s debounced autosave (armed by updatePrescription/addLabOrder) if Complete is
-- clicked before that timer fires — both read prescriptionId as still-null and both insert,
-- leaving two prescriptions rows for one encounter_id. ConsultationWorkspace's reload query
-- (`.eq("encounter_id", enc.id).maybeSingle()`) then throws on the duplicate and the catch-less
-- call site silently falls back to an empty prescription: the doctor's saved drugs/lab/radiology
-- orders vanish from the Rx & Orders tab the next time the token is opened, and the
-- "BILLED & ORDERED" chips / amber "not found in catalogue" banner (both driven by the same
-- reloaded prescription) never render even though the orders were in fact created. Confirmed
-- live in the QA tenant: two prescriptions rows, ~0.5s apart, for the same encounter_id.
--
-- ConsultationWorkspace.tsx's handleComplete now also cancels the pending debounce timer before
-- saving, which prevents new duplicates going forward; this migration is the same defence in
-- depth 20261012000020 already applied to admission_id — fail loudly at write time instead of
-- silently at read time.

-- Dedupe existing duplicates first (there is no ON DELETE for prescriptions' children —
-- lab_orders/radiology_orders/prescription_history are keyed off prescriptions.id, not
-- encounter_id, so removing the older row does not touch anything already ordered/billed).
-- Keep the most recently created row per encounter_id.
DELETE FROM public.prescriptions p
USING (
  SELECT id,
         row_number() OVER (PARTITION BY encounter_id ORDER BY created_at DESC, id DESC) AS rn
  FROM public.prescriptions
  WHERE encounter_id IS NOT NULL
) ranked
WHERE p.id = ranked.id
  AND ranked.rn > 1;

-- Plain (not partial) unique index: Postgres treats NULLs as distinct, so IPD rows
-- (encounter_id IS NULL) stay unconstrained, matching prescriptions_admission_uniq's approach.
CREATE UNIQUE INDEX IF NOT EXISTS prescriptions_encounter_uniq
  ON public.prescriptions (encounter_id);
