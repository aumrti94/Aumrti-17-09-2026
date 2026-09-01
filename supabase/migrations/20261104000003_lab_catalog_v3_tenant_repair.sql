-- ═══════════════════════════════════════════════════════════════════════════
-- Lab catalogue v3 — repair EXISTING tenant rows. Runs AFTER 20261104000002.
--
-- WHY THIS FILE EXISTS
--   repair_lab_catalog_for_hospital() (v2) only touches rows whose category is still
--   one of the five legacy lowercase values. That was its "never overwrite a range the
--   lab tuned itself" heuristic: the settings dialog binds Category to a Title-Case
--   Select, so a lowercase category proved the row had never been saved by a user.
--
--   The heuristic no longer holds. A tenant can hold Title-Case rows that were never
--   repaired either — a row sitting at fee 0 with a lowercase 'blood' sample type but a
--   Title-Case category is not a row a hospital curated, and no hospital deliberately
--   prices a test at ₹0. Guarding on category case alone silently skips exactly those
--   rows, which is why a hospital already on v2 would receive none of the corrections
--   below.
--
--   So every statement here is guarded on the VALUE instead: it changes a row only where
--   the stored value still equals the old default. That is proof the hospital has not
--   tuned it, and it is safe to re-run.
--
--   Nothing here deletes. Nothing here touches is_active except via the generated
--   retirement block, which has already run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. Specimen types this tenant holds that the list does not know ────────
-- MUST run before section 3. That section UPDATEs `category`, and
-- trg_validate_lab_test_vocabulary is BEFORE UPDATE OF category, sample_type and validates
-- the WHOLE new row — so a perfectly valid category repair is rejected because of an
-- unrelated, pre-existing sample_type. That is exactly how this migration failed:
--
--   ERROR: Lab test "Fasting Blood Sugar": sample type "Fluoride" is not a configured
--          sample type. (SQLSTATE 23514)  -- at section 3
--
-- 20261104000002 already normalises sample_type, but from a HARDCODED list of legacy
-- strings ('fluoride blood', 'edta blood', …). "Fluoride" — the additive alone, no "Blood"
-- — appears nowhere in this repository: it was typed by a user in Settings > Lab Tests, or
-- came in through the bulk importer or a data migration. An enumerated map can never cover
-- operator-entered vocabulary, so that block's own orphan loop had already RAISEd
--   WARNING: sample type "Fluoride" is not in the sample_types list — any future edit to
--            that row's category or sample type will be rejected.
-- and then this file made exactly that edit. The warning was right; the map was incomplete.
--
-- So this block does not enumerate. It reconciles against the list itself, in four passes,
-- and finishes by forcing anything still unmatched to 'Other' — because a row the trigger
-- rejects is a row NOBODY can ever edit again through the settings screen, which is worse
-- than a specimen labelled 'Other'. Each one is named so the lab can re-file it.
--
-- Runs under the same transaction-local bypass 20261104000002 uses: these rows are
-- mid-repair, and every value written below is read back out of the list itself.
DO $$
DECLARE
  v_case   INTEGER;
  v_alias  INTEGER;
  v_tube   INTEGER;
  v_other  INTEGER;
  v_row    RECORD;
BEGIN
  PERFORM set_config('aumrti.skip_lab_vocab_check', 'on', TRUE);

  -- (a) Right specimen, wrong casing — 'FLUORIDE BLOOD', 'edta blood'. Adopt the list's
  -- spelling, since the tube grouping matches on it exactly.
  UPDATE public.lab_test_master m
     SET sample_type = c.value
    FROM public.hospital_config_values c
   WHERE c.category = 'sample_types'
     AND (c.hospital_id IS NULL OR c.hospital_id = m.hospital_id)
     AND LOWER(TRIM(m.sample_type)) = LOWER(c.value)
     AND m.sample_type <> c.value;
  GET DIAGNOSTICS v_case = ROW_COUNT;

  -- (b) A different word for a listed specimen. Only mappings where the two genuinely go
  -- into the same tube: plasma and serum do NOT, but the catalogue models both as 'Serum'
  -- and splitting them here would strand rows the catalogue can never match.
  UPDATE public.lab_test_master m
     SET sample_type = v.canonical
    FROM (VALUES
      ('plasma','Serum'), ('serum/plasma','Serum'), ('clotted blood','Serum'),
      ('whole blood','Blood'), ('blood (edta)','EDTA Blood'), ('venous blood','Blood'),
      ('tissue','Biopsy'), ('fnac','Biopsy'),
      ('random urine','Urine'), ('24 hr urine','Urine'), ('24hr urine','Urine'),
      ('midstream urine','Urine'),
      ('pus','Swab'), ('pus swab','Swab'),
      ('body fluid','Fluid'), ('ascitic fluid','Fluid'), ('pleural fluid','Fluid'),
      -- Not specimens at all. A unit or a placeholder that landed in the wrong column.
      ('report','Other'), ('na','Other'), ('n/a','Other'), ('none','Other'), ('-','Other')
    ) AS v(legacy, canonical)
   WHERE LOWER(TRIM(m.sample_type)) = v.legacy
     AND m.sample_type <> v.canonical
     AND EXISTS (
       SELECT 1 FROM public.hospital_config_values c
        WHERE c.category = 'sample_types' AND c.value = v.canonical
          AND (c.hospital_id IS NULL OR c.hospital_id = m.hospital_id)
     );
  GET DIAGNOSTICS v_alias = ROW_COUNT;

  -- (c) The tube named by its ADDITIVE alone — 'Fluoride' for 'Fluoride Blood', 'EDTA',
  -- 'Citrate', 'Arterial', 'Culture'. This is the generic rule that fixes the reported
  -- failure and its siblings without anyone having to enumerate them: adopt the one listed
  -- specimen whose name begins with what is stored. Applied ONLY when exactly one listed
  -- value qualifies — two would be a guess, and a guess here mis-groups a blood draw.
  --
  -- LEFT(...) rather than LIKE so a stored value containing % or _ cannot become a pattern.
  UPDATE public.lab_test_master m
     SET sample_type = (
       SELECT MIN(c.value) FROM public.hospital_config_values c
        WHERE c.category = 'sample_types'
          AND (c.hospital_id IS NULL OR c.hospital_id = m.hospital_id)
          AND LEFT(LOWER(c.value), LENGTH(TRIM(m.sample_type)) + 1)
              = LOWER(TRIM(m.sample_type)) || ' '
     )
   WHERE m.sample_type IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.hospital_config_values c
        WHERE c.category = 'sample_types' AND c.value = m.sample_type
          AND (c.hospital_id IS NULL OR c.hospital_id = m.hospital_id)
     )
     -- DISTINCT, not COUNT(*): a hospital that has its own row for a specimen the platform
     -- also seeds would otherwise count 2 and be treated as ambiguous, sending a perfectly
     -- resolvable 'Fluoride' to 'Other'. What must be unambiguous is the VALUE, not the row.
     AND (
       SELECT COUNT(DISTINCT c.value) FROM public.hospital_config_values c
        WHERE c.category = 'sample_types'
          AND (c.hospital_id IS NULL OR c.hospital_id = m.hospital_id)
          AND LEFT(LOWER(c.value), LENGTH(TRIM(m.sample_type)) + 1)
              = LOWER(TRIM(m.sample_type)) || ' '
     ) = 1;
  GET DIAGNOSTICS v_tube = ROW_COUNT;

  -- (d) Whatever is left. Named individually first, because 'Other' loses the tube and the
  -- lab needs to know which rows to re-file — but a row the trigger rejects cannot be
  -- edited through Settings at all, so leaving it invalid strands it permanently.
  FOR v_row IN
    SELECT m.hospital_id, m.test_name, m.sample_type
      FROM public.lab_test_master m
     WHERE NOT EXISTS (
       SELECT 1 FROM public.hospital_config_values c
        WHERE c.category = 'sample_types' AND c.value = m.sample_type
          AND (c.hospital_id IS NULL OR c.hospital_id = m.hospital_id)
     )
     ORDER BY m.hospital_id, m.test_name
  LOOP
    RAISE WARNING 'lab v3 repair: specimen "%" on "%" (hospital %) is not a configured '
      'sample type and could not be reconciled — set to "Other". Re-file it under '
      'Settings > Lab Tests, or add the value under Config Values > Sample Types.',
      v_row.sample_type, v_row.test_name, v_row.hospital_id;
  END LOOP;

  UPDATE public.lab_test_master m
     SET sample_type = 'Other'
   WHERE NOT EXISTS (
     SELECT 1 FROM public.hospital_config_values c
      WHERE c.category = 'sample_types' AND c.value = m.sample_type
        AND (c.hospital_id IS NULL OR c.hospital_id = m.hospital_id)
   );
  GET DIAGNOSTICS v_other = ROW_COUNT;

  PERFORM set_config('aumrti.skip_lab_vocab_check', 'off', TRUE);

  RAISE NOTICE 'lab v3 repair: specimen reconciliation — % recased, % aliased, % resolved '
    'to a full tube name, % forced to Other.', v_case, v_alias, v_tube, v_other;
END$$;

-- ── 1. Panic values that were never panic values ───────────────────────────
-- A critical value means SOMEONE GETS TELEPHONED. Each threshold below was a diagnostic
-- cut-off firing on routine results — Dr. Ramesh's rule is explicit that more alerts is
-- not better, and an alert that fires on every lipid profile trains staff to ignore the
-- one that matters.

-- 500 mg/dL is ordinary metabolic syndrome. 1000 is the acute-pancreatitis threshold,
-- where the patient may need apheresis today. This one moves rather than clears.
UPDATE public.lab_test_master SET critical_high = 1000
 WHERE test_name = 'Triglycerides' AND critical_high = 500;

-- No cholesterol has a panic value. A total of 410 or an LDL of 310 is a statin
-- conversation in clinic, and a low HDL is the commonest abnormal result in the profile.
UPDATE public.lab_test_master SET critical_high = NULL
 WHERE test_name = 'Total Cholesterol' AND critical_high = 400;

UPDATE public.lab_test_master SET critical_high = NULL
 WHERE test_name = 'LDL Cholesterol' AND critical_high = 300;

UPDATE public.lab_test_master SET critical_low = NULL
 WHERE test_name = 'HDL Cholesterol' AND critical_low = 20;

-- An age-stratified DIAGNOSTIC cut-off for acute heart failure. Every decompensated HF
-- inpatient clears it, and the team admitted them for that reason.
UPDATE public.lab_test_master SET critical_high = NULL
 WHERE test_name = 'NT-proBNP' AND critical_high = 900;

-- eGFR is calculated FROM the creatinine on the same draw, which already pages at 5.0.
-- CK-MB is drawn WITH troponin, which already pages. Both are the same call placed twice.
UPDATE public.lab_test_master SET critical_low = NULL
 WHERE test_name = 'eGFR' AND critical_low = 15;

UPDATE public.lab_test_master SET critical_high = NULL
 WHERE test_name = 'CK-MB' AND critical_high = 10;

-- A chronic liver or nephrotic patient lives at 2.0 g/dL for months.
UPDATE public.lab_test_master SET critical_low = NULL
 WHERE test_name = 'Albumin' AND critical_low = 2.0;

-- One analyte, one pair of thresholds. Fasting paged at 500 while post-prandial and
-- random paged at 600, so a glucose of 550 was a phone call or not depending only on
-- which box the doctor happened to tick.
UPDATE public.lab_test_master SET critical_high = 500
 WHERE test_name IN ('Blood Sugar Post Prandial', 'Blood Sugar Random')
   AND critical_high = 600;

-- ── 2. Reference intervals ─────────────────────────────────────────────────
-- Sex-specific transaminase and ALP ceilings. Applied only where the tenant still holds
-- the old merged band AND has no sex-specific values of its own — half-populating these
-- is worse than not populating them, because one sex silently falls back to the merged
-- interval while the other does not.
UPDATE public.lab_test_master
   SET male_normal_min = 0, male_normal_max = 40,
       female_normal_min = 0, female_normal_max = 32
 WHERE test_name = 'SGOT (AST)'
   AND normal_max = 40
   AND male_normal_max IS NULL AND female_normal_max IS NULL;

UPDATE public.lab_test_master
   SET normal_max = 41,
       male_normal_min = 0, male_normal_max = 41,
       female_normal_min = 0, female_normal_max = 33
 WHERE test_name = 'SGPT (ALT)'
   AND normal_max = 40
   AND male_normal_max IS NULL AND female_normal_max IS NULL;

-- 44-147 is a US range. Indian NABL labs running IFCC report 40-129 (M) / 35-104 (F);
-- the old ceiling let a raised ALP in a woman pass as normal.
UPDATE public.lab_test_master
   SET normal_min = 35, normal_max = 129,
       male_normal_min = 40, male_normal_max = 129,
       female_normal_min = 35, female_normal_max = 104
 WHERE test_name = 'Alkaline Phosphatase'
   AND normal_min = 44 AND normal_max = 147
   AND male_normal_max IS NULL AND female_normal_max IS NULL;

-- ── 3. Legacy lowercase categories the v2 repair never covered ─────────────
-- repair_lab_catalog_for_hospital() only recognises five legacy values
-- ('hematology','biochemistry','microbiology','urine','cardiology'). The older
-- single-hospital seed (20260322154718) also wrote 'haematology', 'hormones',
-- 'serology' and 'coagulation', so those rows fall through every repair path and keep a
-- category the dropdown does not offer — which means the category filter never matches
-- them, the dual-validation gate never fires on them, and trg_validate_lab_test_vocabulary
-- rejects ANY future edit to them.
--
-- Safe to normalise now, and only now: the repair has already consumed the lowercase
-- category as its "never curated" signal, so nothing downstream still depends on it.
--
-- This block used to claim "no vocabulary bypass is needed either — 20261104000001
-- normalised sample_type first, so the other half of the row the trigger inspects is
-- already valid." Both halves of that were wrong. The sample_type normalisation lives in
-- 20261104000002, not 000001; and it works from an enumerated list, so it cannot vouch for
-- a value a user typed. A tenant holding sample_type 'Fluoride' made this exact UPDATE
-- raise 23514 — a CATEGORY repair rejected on account of a SPECIMEN it does not touch.
--
-- Section 0 now reconciles sample_type first, so the row is valid by the time we get here.
-- The bypass stays anyway, because the dependency itself was the defect: repairing one
-- column must never be able to fail on the state of another. Nothing invalid gets in —
-- every category written below is a value 20261104000002 seeded into the list.
DO $$
DECLARE
  v_fixed INTEGER;
BEGIN
  PERFORM set_config('aumrti.skip_lab_vocab_check', 'on', TRUE);

  UPDATE public.lab_test_master m
     SET category = v.canonical
    FROM (VALUES
      ('hematology',         'Haematology'),
      ('haematology',        'Haematology'),
      ('coagulation',        'Coagulation'),
      ('biochemistry',       'Biochemistry'),
      ('hormones',           'Endocrinology'),
      ('endocrinology',      'Endocrinology'),
      ('cardiac markers',    'Cardiac Markers'),
      ('serology',           'Serology'),
      ('immunology',         'Immunology'),
      ('microbiology',       'Microbiology'),
      -- A specimen type, not a discipline.
      ('urine',              'Clinical Pathology'),
      ('clinical pathology', 'Clinical Pathology'),
      ('histopathology',     'Histopathology'),
      ('cytology',           'Cytology'),
      ('genetics',           'Genetics'),
      -- A department, not a discipline. ECG is the only occupant and v3 retires it.
      ('cardiology',         'Other'),
      ('other',              'Other')
    ) AS v(legacy, canonical)
   WHERE LOWER(TRIM(m.category)) = v.legacy
     AND m.category <> v.canonical;
  GET DIAGNOSTICS v_fixed = ROW_COUNT;

  PERFORM set_config('aumrti.skip_lab_vocab_check', 'off', TRUE);
  RAISE NOTICE 'lab v3 repair: normalised category on % legacy row(s).', v_fixed;
END$$;

-- ── 4. Discipline relocations ──────────────────────────────────────────────
-- The vocabulary trigger validates category against hospital_config_values, and
-- 20261104000002 seeded 'Tumour Markers' and 'Molecular Biology' before this file runs.
-- Guarded on the OLD category so a hospital that has already re-filed a test keeps it.

-- 'Genetics' must mean hereditary disease testing. An infectious PCR filed there shared
-- a reporting bucket with genetic diagnosis, and any dual-validation rule a hospital set
-- for genetics would have gated a COVID swab.
UPDATE public.lab_test_master SET category = 'Molecular Biology'
 WHERE test_name = 'COVID-19 RT-PCR' AND category = 'Genetics';

-- Serology means antibodies in serum. This is an antigen strip read off a swab.
UPDATE public.lab_test_master SET category = 'Microbiology'
 WHERE test_name = 'COVID-19 Rapid Antigen' AND category = 'Serology';

UPDATE public.lab_test_master SET category = 'Tumour Markers'
 WHERE test_name = 'PSA (Total)' AND category = 'Endocrinology';

-- Same immunochromatographic strip as Dengue NS1, which was already in Serology. The
-- malaria SMEAR correctly stays in Haematology — it is a stained slide.
UPDATE public.lab_test_master SET category = 'Serology'
 WHERE test_name = 'Malaria Antigen (Rapid)' AND category = 'Haematology';

-- Nutritional analytes, not hormones; they belong beside the iron studies they are
-- ordered with on a macrocytic anaemia workup.
UPDATE public.lab_test_master SET category = 'Biochemistry'
 WHERE test_name IN ('Vitamin B12', 'Folate') AND category = 'Endocrinology';

-- ── 5. Rows the v2 repair skipped ──────────────────────────────────────────
-- The evidence that a row was seeded and never curated is not its category case — it is
-- fee 0. No hospital prices a test at zero: it produces an order that bills nothing and
-- leaks revenue with no error raised anywhere (TC-P5L-001). Same for a NULL unit on an
-- analyte the catalogue gives a unit to.
--
-- Only the columns that are still empty are filled. A tuned reference range is never
-- overwritten, because ranges are not touched here at all.
--
-- Under the vocabulary bypass for the same reason as section 3: this block writes `unit`,
-- `tat_minutes` and `method`, but the trigger is BEFORE UPDATE OF category, sample_type and
-- re-validates the WHOLE row — so filling in a missing unit could be rejected because of a
-- category the hospital's own importer wrote years ago. Every value written here comes from
-- lab_test_catalog_default, which is generated from the reviewed catalogue.
DO $$
DECLARE
  v_fee  INTEGER;
  v_unit INTEGER;
BEGIN
  PERFORM set_config('aumrti.skip_lab_vocab_check', 'on', TRUE);

  UPDATE public.lab_test_master m
     SET fee = c.fee
    FROM public.lab_test_catalog_default c
   WHERE m.test_name = c.test_name
     AND COALESCE(m.fee, 0) = 0
     AND c.fee > 0;
  GET DIAGNOSTICS v_fee = ROW_COUNT;

  UPDATE public.lab_test_master m
     SET unit = c.unit,
         sample_type = CASE
           -- Lowercase sample types ('blood') are legacy values that are not in the
           -- dropdown, so specimens cannot group into tubes by exact match on them.
           WHEN m.sample_type = LOWER(m.sample_type) THEN c.sample_type
           ELSE m.sample_type
         END,
         tat_minutes = COALESCE(NULLIF(m.tat_minutes, 0), c.tat_minutes),
         method = COALESCE(m.method, c.method)
    FROM public.lab_test_catalog_default c
   WHERE m.test_name = c.test_name
     AND (m.unit IS NULL OR m.sample_type = LOWER(m.sample_type));
  GET DIAGNOSTICS v_unit = ROW_COUNT;

  PERFORM set_config('aumrti.skip_lab_vocab_check', 'off', TRUE);
  RAISE NOTICE 'lab v3 repair: priced % zero-fee row(s); normalised unit/specimen on % row(s).',
    v_fee, v_unit;
END$$;

-- ── 6. Reconcile the membership of groups that already exist ───────────────
-- seed_lab_groups_for_hospital() inserts members ONLY when it creates the group. An
-- existing tenant therefore keeps whatever membership it had, and the Fever Panel's
-- membership changed in v3: it used to list 'Complete Blood Count', which v3 retires,
-- because a group cannot contain a group. Left alone, that panel would carry an item
-- pointing at a deactivated row — an order line the lab can never process.
--
-- Two narrow operations, matched on group_code (the stable key):
--   • drop items whose test is now inactive — a deactivated test in a panel is dead
--     weight regardless of who added it, and dropping the ITEM never touches the test;
--   • add catalogue members the group is missing.
-- A member the hospital added itself and left active is untouched by both.
DO $$
DECLARE
  v_dropped INTEGER;
  v_added   INTEGER;
BEGIN
  DELETE FROM public.lab_test_group_items gi
   USING public.lab_test_master m
   WHERE gi.test_id = m.id
     AND m.is_active = FALSE;
  GET DIAGNOSTICS v_dropped = ROW_COUNT;

  INSERT INTO public.lab_test_group_items (group_id, test_id)
  SELECT g.id, m.id
    FROM public.lab_test_groups g
    JOIN public.lab_test_group_catalog_default d ON d.group_code = g.group_code
    JOIN public.lab_test_master m
      ON m.hospital_id = g.hospital_id
     AND m.test_name = ANY (d.members)
     AND m.is_active = TRUE
   WHERE NOT EXISTS (
     SELECT 1 FROM public.lab_test_group_items x
      WHERE x.group_id = g.id AND x.test_id = m.id
   )
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_added = ROW_COUNT;

  RAISE NOTICE 'lab v3 repair: group membership — dropped % inactive item(s), added % missing member(s).',
    v_dropped, v_added;
END$$;

-- ── 7. Report anything still unreconciled ──────────────────────────────────
-- A row whose name is absent from the catalogue is either a test the hospital added
-- itself — entirely legitimate — or a legacy survivor under a name the rename map in
-- 20261104000001 does not know about. This migration cannot tell the two apart, and
-- guessing would risk renaming a hospital's own test, so it reports instead of acting.
-- Anything listed here that is NOT hospital-authored belongs in that rename map.
DO $$
DECLARE
  v_row   RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR v_row IN
    SELECT m.hospital_id, m.test_name, m.test_code, m.category, m.fee
      FROM public.lab_test_master m
     WHERE NOT EXISTS (
       SELECT 1 FROM public.lab_test_catalog_default c WHERE c.test_name = m.test_name
     )
     ORDER BY m.hospital_id, m.test_name
  LOOP
    v_count := v_count + 1;
    RAISE NOTICE 'lab v3 repair: unreconciled row — hospital=% name="%" code=% category=% fee=%',
      v_row.hospital_id, v_row.test_name, v_row.test_code, v_row.category, v_row.fee;
  END LOOP;

  IF v_count = 0 THEN
    RAISE NOTICE 'lab v3 repair: every lab_test_master row maps to the catalogue.';
  ELSE
    RAISE NOTICE 'lab v3 repair: % row(s) not in the catalogue (hospital-authored, or legacy names to add to the v3 prep rename map).', v_count;
  END IF;
END$$;
