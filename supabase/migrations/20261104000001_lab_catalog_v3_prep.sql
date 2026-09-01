-- ═══════════════════════════════════════════════════════════════════════════
-- Lab catalogue v3 — PREPARE existing tenants. Runs BEFORE 20261104000002.
--
-- Everything in this file must happen before the generated v3 migration seeds, because
-- seed_lab_groups_for_hospital() matches an existing group by group_name. Renaming the
-- five panels afterwards would be too late: the seeder would have already created a
-- SECOND group under the new name, leaving the hospital with 'Complete Blood Count' and
-- 'Complete Blood Count Panel' side by side, both orderable, both billable.
-- ═══════════════════════════════════════════════════════════════════════════

-- NOTE: the legacy lowercase sample_type normalisation that briefly lived here has moved
-- into 20261104000002. A failed push may already have applied and RECORDED this file, and
-- Supabase never re-runs a recorded version — so a fix placed here would never execute for
-- the very tenant that hit the error. It belongs in the migration that actually fails.

-- ── 1. Panels take the names doctors actually write ────────────────────────
-- CBC, LFT, KFT, Lipid Profile and Electrolytes used to exist BOTH as a single
-- lab_test_master row (unit 'report', one value field, so the whole panel came back as
-- one unitless blob no analyte could be flagged inside) AND as a '... Panel' group.
-- v3 retires the rows. The group inherits the name so that a prescription for "CBC" —
-- which investigationSync resolves BY NAME — keeps resolving to something.
--
-- Matched on group_code, which is the stable key; guarded on the old group_name so a
-- hospital that has already renamed its own panel keeps its label.
UPDATE public.lab_test_groups SET group_name = 'Complete Blood Count'
 WHERE group_code = 'CBCP'   AND group_name = 'Complete Blood Count Panel';

UPDATE public.lab_test_groups SET group_name = 'Liver Function Test'
 WHERE group_code = 'LFTP'   AND group_name = 'Liver Function Panel';

UPDATE public.lab_test_groups SET group_name = 'Kidney Function Test'
 WHERE group_code = 'KFTP'   AND group_name = 'Kidney Function Panel';

UPDATE public.lab_test_groups SET group_name = 'Lipid Profile'
 WHERE group_code = 'LIPIDP' AND group_name = 'Lipid Profile Panel';

-- ── 2. Legacy test names the v2 rename list did not cover ──────────────────
-- The v2 map covers every name in the 45-row seed_hospital_defaults list; these are
-- survivors from OTHER sources — the pre-v2 single-hospital seed
-- (20260322154718) and QA fixture runs predating the catalogue.
--
-- Deliberately NOT guarded on a lowercase category, unlike the v2 repair. That
-- heuristic assumed a row still carrying 'biochemistry' had never been saved by a
-- user — but a tenant can hold Title-Case rows that were never repaired either
-- (see the fee-0 evidence in 20261104000003), so guarding on it silently skips them.
-- Guarded instead on the canonical name being free, which is the constraint that
-- actually matters: lab_test_master is UNIQUE (hospital_id, test_name).
DO $$
DECLARE
  v_pair    RECORD;
  v_renamed INTEGER;
  v_total   INTEGER := 0;
BEGIN
  FOR v_pair IN
    SELECT * FROM (VALUES
      ('Blood Culture',        'Blood Culture & Sensitivity'),
      ('Urine Culture',        'Urine Culture & Sensitivity'),
      ('Sputum Culture',       'Sputum Culture & Sensitivity'),
      ('Stool Culture',        'Stool Culture & Sensitivity'),
      ('Total WBC Count',      'Total Leucocyte Count'),
      ('ESR (1 hr)',           'ESR'),
      ('Peripheral Smear',     'Peripheral Smear Examination'),
      ('Blood Glucose Fasting','Blood Sugar Fasting'),
      ('Blood Glucose PP',     'Blood Sugar Post Prandial'),
      ('Serum Urea',           'Blood Urea'),
      ('Total Bilirubin',      'Bilirubin Total'),
      ('Direct Bilirubin',     'Bilirubin Direct'),
      ('SGOT / AST',           'SGOT (AST)'),
      ('SGPT / ALT',           'SGPT (ALT)'),
      ('Serum Albumin',        'Albumin'),
      ('Serum Uric Acid',      'Uric Acid'),
      ('Malaria Antigen Test', 'Malaria Antigen (Rapid)'),
      ('Typhidot (IgM)',       'Typhoid IgM (Typhidot)'),
      ('Urine R/M',            'Urine Routine & Microscopy')
    ) AS t(old_name, new_name)
  LOOP
    UPDATE public.lab_test_master m
       SET test_name = v_pair.new_name
     WHERE m.test_name = v_pair.old_name
       AND NOT EXISTS (
         SELECT 1 FROM public.lab_test_master x
          WHERE x.hospital_id = m.hospital_id AND x.test_name = v_pair.new_name
       );
    GET DIAGNOSTICS v_renamed = ROW_COUNT;
    v_total := v_total + v_renamed;
    IF v_renamed > 0 THEN
      RAISE NOTICE 'lab v3 prep: renamed % row(s) "%" -> "%"', v_renamed, v_pair.old_name, v_pair.new_name;
    END IF;
  END LOOP;
  RAISE NOTICE 'lab v3 prep: % row(s) renamed onto canonical names.', v_total;
END$$;
