-- opd_encounters: one encounter per OPD token.
--
-- WHY. This is the "prescribed tests are missing after a refresh" defect.
--
-- ConsultationWorkspace.autoSaveEncounter decides insert-vs-update from the `encounterId`
-- React state. The 2-second debounced autosave (armed by typing) can run concurrently with
-- the explicit save on Complete; both read encounterId as still-null and both INSERT, leaving
-- TWO opd_encounters rows for one token_id. The workspace then reloads with
--
--   .from("opd_encounters").eq("token_id", token.id).maybeSingle()
--
-- which ERRORS on the duplicate. The call site discarded the error, so `enc` came back null
-- and the else-branch blanked the encounter and the prescription. The doctor's drugs, lab
-- tests and radiology studies are all still in the database — the workspace simply stops
-- being able to read them, on every load, permanently.
--
-- This is exactly the bug 20261013000021 fixed for `prescriptions`; the same guard was never
-- applied one level up, to the row prescriptions hang off.
--
-- ConsultationWorkspace now also (a) falls back to the newest encounter instead of blanking
-- when the read fails, and (b) adopts an existing encounter instead of inserting a rival.
-- This migration is the defence in depth: fail loudly at write time rather than silently at
-- read time.

/* ── 1. Re-point children of duplicate encounters onto the survivor ──
   Unlike prescriptions (whose children key off prescriptions.id), these tables key off
   encounter_id directly, so the losing rows cannot simply be deleted — that would orphan
   real clinical and financial records. Every child is moved to the surviving encounter
   first. Survivor = the most recently created row per token_id. */

CREATE TEMP TABLE _enc_dupes ON COMMIT DROP AS
SELECT id AS loser_id, survivor_id
FROM (
  SELECT id,
         token_id,
         first_value(id) OVER (PARTITION BY token_id ORDER BY created_at DESC, id DESC) AS survivor_id
  FROM public.opd_encounters
  WHERE token_id IS NOT NULL
) ranked
WHERE id <> survivor_id;

-- Every table with an FK to opd_encounters(id), enumerated from the migration history.
-- `opd_diagnoses` and `external_lab_referrals` carry an unconstrained encounter_id (no FK)
-- but are re-pointed too, so their rows stay attached to the visit the doctor sees.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'lab_orders', 'radiology_orders', 'bills', 'pharmacy_dispensing',
    'patient_feedback', 'teleconsult_sessions', 'physio_referrals',
    'patient_encounter_templates', 'patient_history_ingest_jobs',
    'opd_diagnoses', 'external_lab_referrals'
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'encounter_id'
    ) THEN
      EXECUTE format(
        'UPDATE public.%I c SET encounter_id = d.survivor_id FROM _enc_dupes d WHERE c.encounter_id = d.loser_id',
        t
      );
    END IF;
  END LOOP;
END $$;

-- Self-reference: a revisit pointing at a losing row.
UPDATE public.opd_encounters e SET revisit_of_encounter_id = d.survivor_id
FROM _enc_dupes d WHERE e.revisit_of_encounter_id = d.loser_id;

/* ── 2. Prescriptions need care: prescriptions.encounter_id is itself uniquely indexed
       (20261013000021), so blindly re-pointing a loser's prescription onto a survivor that
       already has one would violate that index. Keep the survivor's prescription and drop the
       loser's ONLY when both exist; otherwise move it across so nothing is lost. */

DELETE FROM public.prescriptions p
USING _enc_dupes d
WHERE p.encounter_id = d.loser_id
  AND EXISTS (SELECT 1 FROM public.prescriptions s WHERE s.encounter_id = d.survivor_id);

UPDATE public.prescriptions p SET encounter_id = d.survivor_id
FROM _enc_dupes d WHERE p.encounter_id = d.loser_id;

/* ── 3. Delete the losing encounters.
       Any table referencing opd_encounters(id) that was missed above blocks this with a FK
       violation, failing the migration loudly rather than discarding clinical data. That is
       the intended behaviour: add the table to the list in step 1 and re-run. */

DELETE FROM public.opd_encounters e USING _enc_dupes d WHERE e.id = d.loser_id;

/* ── 4. The guard itself.
       Plain (not partial) unique index: Postgres treats NULLs as distinct, so any encounter
       without a token stays unconstrained — matching prescriptions_encounter_uniq's approach. */

CREATE UNIQUE INDEX IF NOT EXISTS opd_encounters_token_uniq
  ON public.opd_encounters (token_id);

DO $$
DECLARE
  remaining bigint;
BEGIN
  SELECT count(*) INTO remaining
  FROM (
    SELECT token_id FROM public.opd_encounters
    WHERE token_id IS NOT NULL GROUP BY token_id HAVING count(*) > 1
  ) x;
  RAISE NOTICE 'opd_encounters token dedupe complete — % token(s) still duplicated (expected 0)', remaining;
END $$;
