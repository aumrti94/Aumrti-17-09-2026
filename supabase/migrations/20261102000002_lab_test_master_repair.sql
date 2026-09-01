-- ═══════════════════════════════════════════════════════════════════════════
-- Lab Test Master — repair existing tenants, then guard against re-drift.
--
-- Companion to 20261102000001_lab_test_catalog_v2.sql (generated). That migration
-- installs the corrected reference catalogue; this one brings hospitals that were
-- already seeded with the old 45-row catalogue up to it, without discarding work a
-- hospital lab has already done.
--
-- WHAT WAS WRONG WITH THE SEEDED ROWS
--   • category was lowercase and not a member of the dropdown list ('hematology',
--     'biochemistry', 'microbiology', 'urine', 'cardiology'). SettingsLabTestsPage
--     filters with an exact `===`, so filtering by any category returned none of the
--     45 tests; and lab_dual_validation_config is matched on test_category with an
--     exact .in(), so a hospital that configured "Histopathology needs a second
--     signature" got no gate at all.
--   • 'urine' and 'cardiology' are not disciplines. One is a specimen type, the other
--     a department.
--   • Clinically wrong intervals that SUPPRESSED alerts: creatinine panic high at
--     10 mg/dL (a dialysis-level 8 raised nothing), Blood Urea carrying the BUN
--     interval so every normal Indian urea flagged High, and merged both-sex bands on
--     Hb/RBC/PCV so an anaemic male read Normal.
--   • Clinically wrong intervals that CREATED false alerts: HDL capped at 60 (every
--     protective HDL flagged High) and invented panic values on MCV/MCH/MCHC/ESR/
--     CRP/HbA1c, none of which has one.
--   • fee 0 on all 45 rows — an order that bills nothing.
--
-- HOW "UNTOUCHED" IS DECIDED
--   A row is repaired only if its category is still one of the five legacy lowercase
--   values. That is proof the row has never been saved by a user: the settings dialog
--   binds Category to a Select fed by hospital_config_values, which offers only
--   Title Case values, so saving ANY edit through the UI rewrites the category away
--   from lowercase. A hospital that has tuned a test therefore keeps its edits.
--
--   The one edit that does NOT go through that dialog is Bulk Edit Price, which
--   updates `fee` alone. So fee is preserved wherever it is already non-zero and
--   adopted from the catalogue only where it is still the seeded 0.
--
--   is_active is never touched here — see the note at step 4.
-- ═══════════════════════════════════════════════════════════════════════════

-- Columns the old schema may not have. Idempotent.
ALTER TABLE public.lab_test_master
  ADD COLUMN IF NOT EXISTS autoverify_eligible BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 1. Legacy names → canonical names ──────────────────────────────────────
-- Renames must happen before the value repair, because the repair joins the
-- catalogue on test_name. Guarded on the legacy category so a hospital that renamed
-- a test itself is not renamed back, and skipped entirely if the canonical name is
-- already taken in that hospital (the unique key is (hospital_id, test_name)).
DO $$
DECLARE
  v_pair   RECORD;
  v_renamed INTEGER := 0;
BEGIN
  FOR v_pair IN
    SELECT * FROM (VALUES
      ('CBC',                          'Complete Blood Count'),
      ('WBC (Total Leukocyte Count)',  'Total Leucocyte Count'),
      -- 'PT / INR' stored a time in seconds and a unitless ratio in one value field.
      -- The legacy row carried the INR range (0.9-1.1), so it becomes the INR row and
      -- the catalogue seed adds Prothrombin Time alongside it.
      ('PT / INR',                     'INR'),
      ('LFT',                          'Liver Function Test'),
      ('KFT',                          'Kidney Function Test'),
      ('Blood Sugar PP',               'Blood Sugar Post Prandial'),
      ('Serum Sodium (Na)',            'Serum Sodium'),
      ('Serum Potassium (K)',          'Serum Potassium'),
      ('Serum Chloride (Cl)',          'Serum Chloride'),
      ('Urine R/M',                    'Urine Routine & Microscopy'),
      ('Urine Culture',                'Urine Culture & Sensitivity')
    ) AS t(old_name, new_name)
  LOOP
    UPDATE public.lab_test_master m
       SET test_name = v_pair.new_name
     WHERE m.test_name = v_pair.old_name
       AND m.category IN ('hematology','biochemistry','microbiology','urine','cardiology')
       AND NOT EXISTS (
         SELECT 1 FROM public.lab_test_master x
          WHERE x.hospital_id = m.hospital_id AND x.test_name = v_pair.new_name
       );
    GET DIAGNOSTICS v_renamed = ROW_COUNT;
    IF v_renamed > 0 THEN
      RAISE NOTICE 'lab repair: renamed % row(s) "%" -> "%"', v_renamed, v_pair.old_name, v_pair.new_name;
    END IF;
  END LOOP;
END$$;

-- ── 2. Repair vocabulary, units and clinical ranges ────────────────────────
DO $$
DECLARE
  v_fixed   INTEGER;
  v_skipped INTEGER;
BEGIN
  UPDATE public.lab_test_master m
     SET category          = c.category,
         sample_type       = c.sample_type,
         unit              = c.unit,
         normal_min        = c.normal_min,
         normal_max        = c.normal_max,
         -- NULL here is the point, not an omission: MCV, MCH, MCHC, ESR, CRP and
         -- HbA1c have no panic value, and the invented ones were paging clinicians
         -- about every microcytic anaemia.
         critical_low      = c.critical_low,
         critical_high     = c.critical_high,
         male_normal_min   = c.male_normal_min,
         male_normal_max   = c.male_normal_max,
         female_normal_min = c.female_normal_min,
         female_normal_max = c.female_normal_max,
         method            = COALESCE(m.method, c.method),
         tat_minutes       = COALESCE(NULLIF(m.tat_minutes, 0), c.tat_minutes),
         -- Bulk Edit Price is the one edit path that leaves the category lowercase,
         -- so a price the hospital has already set is never overwritten.
         fee               = CASE WHEN COALESCE(m.fee, 0) > 0 THEN m.fee ELSE c.fee END
    FROM public.lab_test_catalog_default c
   WHERE m.test_name = c.test_name
     AND m.category IN ('hematology','biochemistry','microbiology','urine','cardiology');
  GET DIAGNOSTICS v_fixed = ROW_COUNT;

  SELECT COUNT(*) INTO v_skipped
    FROM public.lab_test_master m
    JOIN public.lab_test_catalog_default c ON c.test_name = m.test_name
   WHERE m.category NOT IN ('hematology','biochemistry','microbiology','urine','cardiology');

  RAISE NOTICE 'lab repair: corrected % row(s); left % customised row(s) untouched.', v_fixed, v_skipped;
END$$;

-- ── 3. Retire tests that are not laboratory tests ──────────────────────────
-- Deactivated, never deleted: historical lab_order_items may reference the row, and
-- dropping tenant data in a production migration is forbidden. ECG through the lab
-- pipeline made investigationSync mint an 'other' specimen and print a barcode for a
-- patient from whom nothing is ever drawn.
UPDATE public.lab_test_master
   SET is_active = FALSE,
       category  = 'Other'
 WHERE test_name = 'ECG'
   AND category IN ('cardiology', 'Other');

-- ── 4. Backfill anything the tenant is still missing ───────────────────────
-- Adds the ~90 tests the old catalogue never had — including Blood Group & Rh (which
-- labSampleIntegrity's wrong-blood-in-tube check has always looked for and never
-- found), the four mandatory pre-operative screens (HIV/HBsAg/HCV/VDRL), Troponin I,
-- Free T3/T4, magnesium and the histopathology set the dual-validation gate exists
-- to protect.
--
-- Note this seeds new rows as is_active = TRUE. Migration 20261009000171 set the
-- column default to FALSE and deactivated everything; since syncLabOrders and the
-- order-modal search both filter is_active = true, seeding inactive would make every
-- new test invisible to ordering. Rows that already exist keep whatever active state
-- the hospital chose — step 2 deliberately does not touch is_active.
DO $$
DECLARE
  v_hosp   RECORD;
  v_added  INTEGER;
  v_total  INTEGER := 0;
BEGIN
  FOR v_hosp IN SELECT id FROM public.hospitals LOOP
    v_added := public.seed_lab_catalog_for_hospital(v_hosp.id);
    v_total := v_total + v_added;
  END LOOP;
  RAISE NOTICE 'lab repair: added % missing catalogue row(s) across all hospitals.', v_total;
END$$;

-- ── 5. Seed the default test groups (panels) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.seed_lab_groups_for_hospital(p_hospital_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group    RECORD;
  v_group_id UUID;
  v_created  INTEGER := 0;
BEGIN
  FOR v_group IN SELECT * FROM public.lab_test_group_catalog_default LOOP
    SELECT id INTO v_group_id
      FROM public.lab_test_groups
     WHERE hospital_id = p_hospital_id AND group_name = v_group.group_name;

    IF v_group_id IS NULL THEN
      INSERT INTO public.lab_test_groups
        (hospital_id, group_name, group_code, category, fee, tat_minutes, is_active)
      VALUES
        (p_hospital_id, v_group.group_name, v_group.group_code, v_group.category,
         v_group.fee, v_group.tat_minutes, TRUE)
      RETURNING id INTO v_group_id;
      v_created := v_created + 1;

      -- Members are resolved by name against this hospital's own master. A member the
      -- hospital does not stock is simply absent from the panel rather than a failure.
      INSERT INTO public.lab_test_group_items (group_id, test_id)
      SELECT v_group_id, m.id
        FROM public.lab_test_master m
       WHERE m.hospital_id = p_hospital_id
         AND m.test_name = ANY (v_group.members)
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;

  RETURN v_created;
END;
$$;

DO $$
DECLARE
  v_hosp RECORD;
  v_total INTEGER := 0;
BEGIN
  FOR v_hosp IN SELECT id FROM public.hospitals LOOP
    v_total := v_total + public.seed_lab_groups_for_hospital(v_hosp.id);
  END LOOP;
  RAISE NOTICE 'lab repair: created % test group(s) across all hospitals.', v_total;
END$$;

-- ── 6. Stop the vocabulary drifting again ──────────────────────────────────
-- A CHECK constraint cannot subquery, and hospital_config_values' system defaults are
-- enforced by a PARTIAL unique index (hospital_id IS NULL), which cannot back a
-- foreign key. A trigger is therefore the only mechanism that can validate against
-- the same list the dropdown renders — and unlike a hardcoded CHECK it still lets a
-- hospital add its own category through Settings without a schema migration.
CREATE OR REPLACE FUNCTION public.validate_lab_test_vocabulary()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Transaction-local bypass, set only by trg_seed_hospital_defaults (step 8).
  --
  -- seed_hospital_defaults() still carries its original 45-row VALUES list with the
  -- legacy lowercase categories. Without this escape hatch that INSERT would raise,
  -- and because the whole seed runs in one function call the exception would also
  -- roll back the chart of accounts and posting rules seeded just before it — a new
  -- hospital would come up with no accounting configuration at all.
  --
  -- So the legacy rows are allowed IN, and repair_lab_catalog_for_hospital corrects
  -- them a moment later. That ordering matters: the repair identifies untouched rows
  -- BY their lowercase category, so canonicalising them here instead would make the
  -- repair skip them and leave the wrong reference ranges in place.
  --
  -- is_local = true on set_config scopes this to the current transaction; it cannot
  -- leak into another statement or another session.
  IF current_setting('aumrti.skip_lab_vocab_check', TRUE) = 'on' THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.hospital_config_values
     WHERE category = 'lab_test_categories'
       AND value    = NEW.category
       AND (hospital_id IS NULL OR hospital_id = NEW.hospital_id)
  ) THEN
    RAISE EXCEPTION
      'Lab test "%": category "%" is not a configured lab test category. The category '
      'filter and the dual-validation gate both match this value exactly, so an '
      'unlisted category makes the test unfilterable and silently exempt from '
      'pathologist sign-off. Add it under Settings > Config Values > Lab Test '
      'Categories first.',
      NEW.test_name, NEW.category
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.hospital_config_values
     WHERE category = 'sample_types'
       AND value    = NEW.sample_type
       AND (hospital_id IS NULL OR hospital_id = NEW.hospital_id)
  ) THEN
    RAISE EXCEPTION
      'Lab test "%": sample type "%" is not a configured sample type. Specimens are '
      'grouped into tubes by an exact match on this value, so an unlisted one prints '
      'a separate barcode for what is really the same draw.',
      NEW.test_name, NEW.sample_type
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_lab_test_vocabulary ON public.lab_test_master;
CREATE TRIGGER trg_validate_lab_test_vocabulary
  BEFORE INSERT OR UPDATE OF category, sample_type ON public.lab_test_master
  FOR EACH ROW EXECUTE FUNCTION public.validate_lab_test_vocabulary();

-- ── 7. Per-hospital form of steps 1-3, for the trigger and for manual re-runs ──
-- Same logic the whole-estate DO blocks above just ran, scoped to one hospital, so
-- the new-hospital path and the repair path are the same code rather than two
-- implementations that can disagree.
CREATE OR REPLACE FUNCTION public.repair_lab_catalog_for_hospital(p_hospital_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pair  RECORD;
  v_fixed INTEGER;
BEGIN
  FOR v_pair IN
    SELECT * FROM (VALUES
      ('CBC','Complete Blood Count'), ('WBC (Total Leukocyte Count)','Total Leucocyte Count'),
      ('PT / INR','INR'), ('LFT','Liver Function Test'), ('KFT','Kidney Function Test'),
      ('Blood Sugar PP','Blood Sugar Post Prandial'), ('Serum Sodium (Na)','Serum Sodium'),
      ('Serum Potassium (K)','Serum Potassium'), ('Serum Chloride (Cl)','Serum Chloride'),
      ('Urine R/M','Urine Routine & Microscopy'), ('Urine Culture','Urine Culture & Sensitivity')
    ) AS t(old_name, new_name)
  LOOP
    UPDATE public.lab_test_master m
       SET test_name = v_pair.new_name
     WHERE m.hospital_id = p_hospital_id
       AND m.test_name = v_pair.old_name
       AND m.category IN ('hematology','biochemistry','microbiology','urine','cardiology')
       AND NOT EXISTS (
         SELECT 1 FROM public.lab_test_master x
          WHERE x.hospital_id = p_hospital_id AND x.test_name = v_pair.new_name
       );
  END LOOP;

  UPDATE public.lab_test_master m
     SET category = c.category, sample_type = c.sample_type, unit = c.unit,
         normal_min = c.normal_min, normal_max = c.normal_max,
         critical_low = c.critical_low, critical_high = c.critical_high,
         male_normal_min = c.male_normal_min, male_normal_max = c.male_normal_max,
         female_normal_min = c.female_normal_min, female_normal_max = c.female_normal_max,
         method = COALESCE(m.method, c.method),
         tat_minutes = COALESCE(NULLIF(m.tat_minutes, 0), c.tat_minutes),
         fee = CASE WHEN COALESCE(m.fee, 0) > 0 THEN m.fee ELSE c.fee END
    FROM public.lab_test_catalog_default c
   WHERE m.hospital_id = p_hospital_id
     AND m.test_name = c.test_name
     AND m.category IN ('hematology','biochemistry','microbiology','urine','cardiology');
  GET DIAGNOSTICS v_fixed = ROW_COUNT;

  UPDATE public.lab_test_master
     SET is_active = FALSE, category = 'Other'
   WHERE hospital_id = p_hospital_id AND test_name = 'ECG'
     AND category IN ('cardiology', 'Other');

  RETURN v_fixed;
END;
$$;

COMMENT ON FUNCTION public.repair_lab_catalog_for_hospital(UUID) IS
  'Brings one hospital''s legacy lab_test_master rows up to lab_test_catalog_default. '
  'Only rows still carrying a legacy lowercase category are touched, so a hospital '
  'never loses a reference range it tuned itself. Safe to re-run.';

-- ── 8. New hospitals get the corrected catalogue ───────────────────────────
-- seed_hospital_defaults() still carries its original 45-row VALUES list. Rather than
-- re-declare that 200-line function (and duplicate its chart-of-accounts half), the
-- trigger runs the same repair path every new hospital would otherwise need anyway:
-- legacy seed, then repair, then backfill. One code path for new and existing
-- tenants means the repair cannot rot from disuse.
CREATE OR REPLACE FUNCTION public.trg_seed_hospital_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Wrapped so a seed failure never prevents the hospital INSERT from committing.
  BEGIN
    -- Legacy lab rows are let through the vocabulary trigger here and corrected by
    -- repair_lab_catalog_for_hospital below. See validate_lab_test_vocabulary for why
    -- they are not canonicalised on the way in instead.
    PERFORM set_config('aumrti.skip_lab_vocab_check', 'on', TRUE);
    PERFORM public.seed_hospital_defaults(NEW.id);
    PERFORM set_config('aumrti.skip_lab_vocab_check', 'off', TRUE);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('aumrti.skip_lab_vocab_check', 'off', TRUE);
    RAISE WARNING 'seed_hospital_defaults failed for hospital %: %', NEW.id, SQLERRM;
  END;

  BEGIN
    PERFORM public.repair_lab_catalog_for_hospital(NEW.id);
    PERFORM public.seed_lab_catalog_for_hospital(NEW.id);
    PERFORM public.seed_lab_groups_for_hospital(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'lab catalogue seed failed for hospital %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;
