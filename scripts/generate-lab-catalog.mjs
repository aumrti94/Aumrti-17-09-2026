#!/usr/bin/env node
// Generates every downstream copy of the lab test catalogue from src/lib/labTestCatalog.ts.
//
// Three catalogues used to exist and disagree: the hospital seed migration, the QA
// fixture, and a hardcoded list in the bulk importer. Blood Urea was 7-25 in one and
// 15-40 in another; TSH was 0.5-5.0 in one and 0.4-4.0 in another. A QA suite that is
// green against the wrong reference intervals is worse than no suite at all, because it
// certifies the defect.
//
// So the catalogue is authored ONCE, in TypeScript where it is type-checked and unit
// tested, and every other representation is generated from it:
//
//   supabase/migrations/<CATALOG_VERSION>.sql                    the reference table
//   e2e/fixtures/mock-data.json  ->  labTests, labTestGroups     the QA fixture
//
//   node scripts/generate-lab-catalog.mjs           # write both
//   node scripts/generate-lab-catalog.mjs --check   # CI: fail if either is stale
//
// esbuild bundles the TS module because Node cannot import a `.ts` specifier directly —
// same approach as generate-openapi.mjs.

import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const ROOT = process.cwd();
const ENTRY = join(ROOT, "src", "lib", "labTestCatalog.ts");

// The generated migration's version. BUMP THIS whenever labTestCatalog.ts changes.
//
// It must sort AFTER every migration already in supabase/migrations — Supabase applies
// them in filename order, and this file's dependencies (repair_lab_catalog_for_hospital,
// seed_lab_groups_for_hospital) are defined in 20261102000002. A version dated earlier
// fails on the missing function, and 20261102000001 would afterwards TRUNCATE
// lab_test_catalog_default straight back to the previous catalogue. Note the repo's
// migration timestamps run AHEAD of the wall clock, so "today's date" is the wrong
// default — check `ls supabase/migrations` before choosing.
//
// This was a fixed path pointing at 20261102000001_lab_test_catalog_v2.sql — a
// migration that had ALREADY BEEN APPLIED. Supabase records applied versions in
// supabase_migrations.schema_migrations and skips them, so rewriting that file in
// place meant a catalogue correction was written to disk, passed CI, and then never
// reached a single live database. Every reference range corrected after v2 shipped
// was inert: right in TypeScript, right in the fixture, absent from the DB.
//
// Emitting a NEW version each time is what makes an edit actually land. The previous
// version stays on disk untouched as applied history — never regenerate it.
const CATALOG_VERSION = "20261104000002_lab_test_catalog_v3";
const SQL_OUT = join(ROOT, "supabase", "migrations", `${CATALOG_VERSION}.sql`);
const MOCK_OUT = join(ROOT, "e2e", "fixtures", "mock-data.json");
const TMP = join(ROOT, "node_modules", ".cache", "aumrti-lab-catalog", "catalog.mjs");

const checkOnly = process.argv.includes("--check");

async function loadCatalog() {
  mkdirSync(dirname(TMP), { recursive: true });
  await build({
    entryPoints: [ENTRY],
    outfile: TMP,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
  });
  const mod = await import(pathToFileURL(TMP).href + `?t=${Date.now()}`);
  rmSync(dirname(TMP), { recursive: true, force: true });
  return mod;
}

// ── SQL emission ─────────────────────────────────────────────────────────────

/** Single-quote a SQL string literal, or NULL. Doubles embedded quotes. */
const q = v => (v == null || v === "" ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
/** A numeric literal, or NULL. Never emits the string "null". */
const n = v => (v == null ? "NULL" : String(v));
const b = v => (v ? "TRUE" : "FALSE");

function emitSql({
  LAB_TEST_CATALOG, LAB_TEST_GROUP_CATALOG, LAB_TEST_CATEGORIES, LAB_SAMPLE_TYPES, LAB_TEST_RETIRED,
}) {
  const testRows = LAB_TEST_CATALOG.map(t =>
    `  (${q(t.name)}, ${q(t.code)}, ${q(t.category)}, ${q(t.sampleType)}, ${q(t.unit)}, ` +
    `${n(t.normalMin)}, ${n(t.normalMax)}, ${n(t.criticalLow)}, ${n(t.criticalHigh)}, ` +
    `${n(t.maleNormalMin)}, ${n(t.maleNormalMax)}, ${n(t.femaleNormalMin)}, ${n(t.femaleNormalMax)}, ` +
    `${q(t.method)}, ${n(t.tatMinutes)}, ${n(t.fee)}, ${b(t.autoverifyEligible)})`
  ).join(",\n");

  const groupRows = LAB_TEST_GROUP_CATALOG.map(g =>
    `  (${q(g.name)}, ${q(g.code)}, ${q(g.category)}, ${n(g.fee)}, ${n(g.tatMinutes)}, ` +
    `ARRAY[${g.members.map(q).join(", ")}]::text[])`
  ).join(",\n");

  // Retirements were hand-written into the repair migration (ECG only), which meant the
  // TypeScript list and the SQL that acts on it could drift. Generated from the list now.
  const retiredRows = (LAB_TEST_RETIRED ?? []).map(r =>
    `-- ${r.reason.replace(/\s+/g, " ").trim()}\n` +
    `UPDATE public.lab_test_master SET is_active = FALSE WHERE test_name = ${q(r.name)};`
  ).join("\n\n");

  const catRows = LAB_TEST_CATEGORIES.map((c, i) =>
    `  (NULL, 'lab_test_categories', ${q(c)}, ${q(c)}, ${(i + 1) * 10}, TRUE, TRUE)`).join(",\n");
  const sampleRows = LAB_SAMPLE_TYPES.map((s, i) =>
    `  (NULL, 'sample_types', ${q(s)}, ${q(s)}, ${(i + 1) * 10}, TRUE, TRUE)`).join(",\n");

  return `-- ═══════════════════════════════════════════════════════════════════════════
-- ${CATALOG_VERSION} — GENERATED FILE, DO NOT EDIT BY HAND.
--
-- Source of truth:  src/lib/labTestCatalog.ts
-- Regenerate with:  node scripts/generate-lab-catalog.mjs
-- CI guard:         npm run check:lab-catalog
--
-- Hand-editing this file will be reverted by the next generation and will fail CI.
--
-- What this migration does:
--   1. Extends lab_test_categories and sample_types with the values the catalogue
--      uses. The old seed wrote categories ('hematology', 'urine', 'cardiology')
--      that were not in the dropdown at all, so the category filter matched nothing
--      and the dual-validation gate — which compares test_category exactly — could
--      never fire.
--   2. Creates lab_test_catalog_default, the platform-level reference catalogue.
--      Same hospital_id IS NULL pattern hospital_config_values already uses for
--      system defaults.
--   3. Repoints seed_hospital_defaults() at that table so a new hospital and the QA
--      seeder cannot drift apart again.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Config vocabulary ───────────────────────────────────────────────────
-- Idempotent: system defaults are unique on (category, value) where hospital_id IS
-- NULL. ON CONFLICT DO UPDATE so a relabelled value is corrected on re-run.
INSERT INTO public.hospital_config_values
  (hospital_id, category, value, label, sort_order, is_active, is_system)
VALUES
${catRows},
${sampleRows}
ON CONFLICT (category, value) WHERE hospital_id IS NULL
DO UPDATE SET label = EXCLUDED.label, sort_order = EXCLUDED.sort_order, is_active = TRUE;

-- ── 2. Platform reference catalogue ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lab_test_catalog_default (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_name         TEXT NOT NULL UNIQUE,
  test_code         TEXT NOT NULL,
  category          TEXT NOT NULL,
  sample_type       TEXT NOT NULL,
  unit              TEXT,
  normal_min        NUMERIC(12,3),
  normal_max        NUMERIC(12,3),
  critical_low      NUMERIC(12,3),
  critical_high     NUMERIC(12,3),
  male_normal_min   NUMERIC(12,3),
  male_normal_max   NUMERIC(12,3),
  female_normal_min NUMERIC(12,3),
  female_normal_max NUMERIC(12,3),
  method            TEXT,
  tat_minutes       INTEGER NOT NULL,
  fee               NUMERIC(12,2) NOT NULL,
  autoverify_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Platform reference data, not tenant data: no hospital_id, therefore no isolation
-- policy to write. RLS is still enabled and SELECT is open to authenticated users so
-- the settings page can offer the catalogue; nobody but a migration writes to it.
ALTER TABLE public.lab_test_catalog_default ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lab_catalog_default_read ON public.lab_test_catalog_default;
CREATE POLICY lab_catalog_default_read ON public.lab_test_catalog_default
  FOR SELECT TO authenticated USING (TRUE);

CREATE TABLE IF NOT EXISTS public.lab_test_group_catalog_default (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_name   TEXT NOT NULL UNIQUE,
  group_code   TEXT NOT NULL,
  category     TEXT NOT NULL,
  fee          NUMERIC(12,2) NOT NULL,
  tat_minutes  INTEGER NOT NULL,
  members      TEXT[] NOT NULL
);

ALTER TABLE public.lab_test_group_catalog_default ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lab_group_catalog_default_read ON public.lab_test_group_catalog_default;
CREATE POLICY lab_group_catalog_default_read ON public.lab_test_group_catalog_default
  FOR SELECT TO authenticated USING (TRUE);

-- Full refresh. This table holds no tenant data and no foreign keys point at it, so
-- replacing its contents is safe and makes the migration re-runnable after a
-- catalogue edit without accumulating stale rows.
TRUNCATE public.lab_test_catalog_default;
INSERT INTO public.lab_test_catalog_default
  (test_name, test_code, category, sample_type, unit,
   normal_min, normal_max, critical_low, critical_high,
   male_normal_min, male_normal_max, female_normal_min, female_normal_max,
   method, tat_minutes, fee, autoverify_eligible)
VALUES
${testRows};

TRUNCATE public.lab_test_group_catalog_default;
INSERT INTO public.lab_test_group_catalog_default
  (group_name, group_code, category, fee, tat_minutes, members)
VALUES
${groupRows};

-- ── 3. Seed a hospital from the reference catalogue ────────────────────────
-- Replaces the literal VALUES list that used to live inside seed_hospital_defaults.
-- Both this and the QA seeder now read the same rows.
CREATE OR REPLACE FUNCTION public.seed_lab_catalog_for_hospital(p_hospital_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted INTEGER;
BEGIN
  INSERT INTO public.lab_test_master
    (hospital_id, test_name, test_code, category, sample_type, unit,
     normal_min, normal_max, critical_low, critical_high,
     male_normal_min, male_normal_max, female_normal_min, female_normal_max,
     method, tat_minutes, fee, autoverify_eligible, is_active)
  SELECT
    p_hospital_id, c.test_name, c.test_code, c.category, c.sample_type, c.unit,
    c.normal_min, c.normal_max, c.critical_low, c.critical_high,
    c.male_normal_min, c.male_normal_max, c.female_normal_min, c.female_normal_max,
    c.method, c.tat_minutes, c.fee, c.autoverify_eligible,
    -- Active on arrival. Migration 20261009000171 flipped the column default to
    -- false and deactivated every existing row; because syncLabOrders and the order
    -- search both filter is_active = true, a hospital seeded under that default has
    -- no orderable tests at all and the whole Lab module looks broken.
    TRUE
  FROM public.lab_test_catalog_default c
  ON CONFLICT ON CONSTRAINT lab_test_master_hospital_id_test_name_key DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION public.seed_lab_catalog_for_hospital(UUID) IS
  'Seeds lab_test_master for one hospital from lab_test_catalog_default. Idempotent: '
  'existing tests are left untouched, so a hospital never loses a tuned reference range.';

-- ── 4. Legacy lowercase sample types ───────────────────────────────────────
-- MUST run before repair_lab_catalog_for_hospital() below, or that function raises:
--
--   ERROR: Lab test "ECG": sample type "other" is not a configured sample type
--
-- The repair updates ONLY \`category\` on the ECG row, but trg_validate_lab_test_vocabulary
-- is BEFORE UPDATE OF category, sample_type and validates the WHOLE new row — so it also
-- checks sample_type. The legacy seed wrote lowercase 'other'/'blood'/'urine', none of
-- which is in the sample_types list (which holds Title Case). A row that was ALREADY
-- invalid therefore blocks an update to a different column.
--
-- Latent, not new. The estate-wide ECG update in 20261102000002 ran at its step 3, BEFORE
-- that migration created the trigger at step 6; and the only other caller of the repair,
-- trg_seed_hospital_defaults, invokes it under the skip_lab_vocab_check bypass. This
-- migration is simply the first to call the repair on an existing legacy tenant with the
-- trigger live.
--
-- This lives HERE rather than in the companion prep migration deliberately: a failed
-- push may have already applied and recorded the prep migration, and Supabase never
-- re-runs a recorded version. The fix has to sit in the migration that actually fails.
--
-- Categories are deliberately NOT normalised here. The repair identifies a row the
-- hospital has never curated BY its lowercase category, so canonicalising categories now
-- would make the repair skip every legacy row and leave the wrong reference ranges in
-- place. They are normalised afterwards, in the tenant-repair companion.
DO $$
DECLARE
  v_fixed  INTEGER;
  v_orphan RECORD;
BEGIN
  -- Same transaction-local escape hatch trg_seed_hospital_defaults uses, and for the same
  -- reason: these rows are mid-repair and their category is still legacy on purpose.
  -- Every value written below IS in the sample_types list, so nothing invalid gets in.
  PERFORM set_config('aumrti.skip_lab_vocab_check', 'on', TRUE);

  UPDATE public.lab_test_master m
     SET sample_type = v.canonical
    FROM (VALUES
      ('blood','Blood'), ('edta blood','EDTA Blood'), ('fluoride blood','Fluoride Blood'),
      ('citrate blood','Citrate Blood'), ('arterial blood','Arterial Blood'),
      ('serum','Serum'), ('plasma','Serum'), ('urine','Urine'), ('stool','Stool'),
      ('swab','Swab'), ('sputum','Sputum'), ('csf','CSF'), ('fluid','Fluid'),
      ('biopsy','Biopsy'), ('tissue','Biopsy'), ('semen','Semen'),
      ('culture bottle','Culture Bottle'), ('other','Other')
    ) AS v(legacy, canonical)
   WHERE LOWER(TRIM(m.sample_type)) = v.legacy
     AND m.sample_type <> v.canonical;
  GET DIAGNOSTICS v_fixed = ROW_COUNT;

  PERFORM set_config('aumrti.skip_lab_vocab_check', 'off', TRUE);
  RAISE NOTICE 'lab catalogue: normalised sample_type on % legacy row(s).', v_fixed;

  -- Anything still outside the list would fail the trigger on the next edit to that row,
  -- so name it now rather than let it surface as a migration error months from now.
  FOR v_orphan IN
    SELECT DISTINCT m.sample_type
      FROM public.lab_test_master m
     WHERE NOT EXISTS (
       SELECT 1 FROM public.hospital_config_values c
        WHERE c.category = 'sample_types' AND c.value = m.sample_type
          AND (c.hospital_id IS NULL OR c.hospital_id = m.hospital_id)
     )
  LOOP
    RAISE WARNING 'lab catalogue: sample type "%" is not in the sample_types list — any '
      'future edit to that row''s category or sample type will be rejected.', v_orphan.sample_type;
  END LOOP;
END$$;

-- ── 5. Apply the catalogue to every existing hospital ──────────────────────
-- Without this loop the migration would only refresh lab_test_catalog_default — the
-- platform reference table — and no tenant would ever see the change. All three
-- functions are idempotent, so re-running is safe.
--
-- repair BEFORE seed: repair renames legacy rows ('CBC' -> 'Complete Blood Count')
-- onto canonical names, and seed's ON CONFLICT (hospital_id, test_name) then skips
-- them instead of inserting a duplicate under the canonical name.
DO $$
DECLARE
  v_hosp    RECORD;
  v_seeded  INTEGER := 0;
  v_groups  INTEGER := 0;
BEGIN
  FOR v_hosp IN SELECT id FROM public.hospitals LOOP
    PERFORM public.repair_lab_catalog_for_hospital(v_hosp.id);
    v_seeded := v_seeded + public.seed_lab_catalog_for_hospital(v_hosp.id);
    v_groups := v_groups + public.seed_lab_groups_for_hospital(v_hosp.id);
  END LOOP;
  RAISE NOTICE 'lab catalogue ${CATALOG_VERSION}: added % test(s), % group(s).', v_seeded, v_groups;
END$$;

-- ── 6. Retire tests that do not belong in a laboratory catalogue ───────────
-- Deactivated, never deleted: historical lab_order_items reference these rows, and
-- dropping tenant data in a production migration is forbidden.
--
-- Runs AFTER the repair loop above, which is what makes it effective on legacy
-- tenants: a row still named 'CBC' is renamed to 'Complete Blood Count' by the repair
-- and only then matches the retirement below. Retiring first would miss it entirely.
${retiredRows || "-- (nothing retired)"}
`;
}

// ── QA fixture emission ──────────────────────────────────────────────────────

function toMockTest(t) {
  return {
    name: t.name,
    code: t.code,
    category: t.category,
    sampleType: t.sampleType,
    fee: t.fee,
    unit: t.unit,
    normalMin: t.normalMin,
    normalMax: t.normalMax,
    criticalLow: t.criticalLow,
    criticalHigh: t.criticalHigh,
    maleNormalMin: t.maleNormalMin ?? null,
    maleNormalMax: t.maleNormalMax ?? null,
    femaleNormalMin: t.femaleNormalMin ?? null,
    femaleNormalMax: t.femaleNormalMax ?? null,
    method: t.method ?? null,
    autoverifyEligible: t.autoverifyEligible === true,
    tatMinutes: t.tatMinutes,
  };
}

function emitMock(existing, { LAB_TEST_CATALOG, LAB_TEST_GROUP_CATALOG }) {
  const next = structuredClone(existing);
  next.labTests = LAB_TEST_CATALOG.map(toMockTest);

  const feeOf = new Map(LAB_TEST_CATALOG.map(t => [t.name, t.fee]));
  next.labTestGroups = LAB_TEST_GROUP_CATALOG.map(g => ({
    name: g.name,
    code: g.code,
    category: g.category,
    fee: g.fee,
    tatMinutes: g.tatMinutes,
    members: g.members,
    // The QA cases assert that a group price beats the sum of its parts; carrying the
    // sum in the fixture keeps that expectation generated rather than hand-maintained.
    membersSum: g.members.reduce((a, m) => a + (feeOf.get(m) ?? 0), 0),
    note: `Group price ₹${g.fee} must win over the ₹${g.members.reduce((a, m) => a + (feeOf.get(m) ?? 0), 0)} sum of its members.`,
  }));

  // Anything downstream that NAMES a test or quotes a group price is derived here
  // rather than hand-maintained. A fixture pointing at a test name the catalogue no
  // longer carries does not fail loudly — the order simply comes back empty and a
  // dozen Phase 5 cases go red for a reason that has nothing to do with them.
  const fever = next.labTestGroups.find(g => g.name === "Fever Panel");
  if (fever && next.phase2?.labTestGroup) {
    next.phase2.labTestGroup = {
      ...next.phase2.labTestGroup,
      name: fever.name,
      fee: fever.fee,
      members: fever.members,
      membersSum: fever.membersSum,
    };
  }

  if (next.phase5?.labOrder) {
    const byCode = c => LAB_TEST_CATALOG.find(t => t.code === c)?.name;
    next.phase5.labOrder = {
      ...next.phase5.labOrder,
      // P5B-008 needs primaryTest and urineTest to sit on DIFFERENT sample types so one
      // order produces two tubes; Serum vs Urine keeps that true.
      cultureTest: byCode("BCUL") ?? next.phase5.labOrder.cultureTest,
      urineTest: byCode("URM") ?? next.phase5.labOrder.urineTest,
      ...(fever ? { group: fever.name, groupFee: fever.fee, groupMemberSum: fever.membersSum } : {}),
    };
  }

  // Health package contents are stored as test CODES.
  if (Array.isArray(next.healthPackages)) {
    const validCode = new Set(LAB_TEST_CATALOG.map(t => t.code));
    const renamed = { FBS: "BSF", URINE: "URM", PPBS: "BSPP" };
    next.healthPackages = next.healthPackages.map(p => ({
      ...p,
      includes: (p.includes ?? []).map(x => (validCode.has(x) ? x : renamed[x] ?? x)),
    }));
  }

  return JSON.stringify(next, null, 2) + "\n";
}

// ── Main ─────────────────────────────────────────────────────────────────────

const catalog = await loadCatalog();

if (!catalog.LAB_TEST_CATALOG?.length) {
  console.error("generate-lab-catalog: the catalogue is empty; refusing to generate from it.");
  process.exit(1);
}

const sql = emitSql(catalog);
const mockExisting = JSON.parse(readFileSync(MOCK_OUT, "utf8"));
const mock = emitMock(mockExisting, catalog);

if (checkOnly) {
  const stale = [];
  const cmp = (path, next) => {
    let committed = null;
    try { committed = readFileSync(path, "utf8"); } catch { /* never generated */ }
    if (committed !== next) stale.push(path.replace(ROOT + "\\", "").replace(ROOT + "/", ""));
  };
  cmp(SQL_OUT, sql);
  cmp(MOCK_OUT, mock);

  if (stale.length) {
    console.error(
      "generate-lab-catalog --check FAILED — these are stale:\n" +
      stale.map(s => `  ${s}`).join("\n") +
      "\n\nsrc/lib/labTestCatalog.ts has changed since they were generated, so the seeded\n" +
      "reference ranges no longer match the reviewed catalogue. Run:\n" +
      "  node scripts/generate-lab-catalog.mjs\nand commit the result.",
    );
    process.exit(1);
  }
  console.log(
    `generate-lab-catalog --check passed — ${catalog.LAB_TEST_CATALOG.length} tests, ` +
    `${catalog.LAB_TEST_GROUP_CATALOG.length} groups in sync.`,
  );
} else {
  mkdirSync(dirname(SQL_OUT), { recursive: true });
  writeFileSync(SQL_OUT, sql, "utf8");
  writeFileSync(MOCK_OUT, mock, "utf8");
  const cats = new Set(catalog.LAB_TEST_CATALOG.map(t => t.category)).size;
  const samples = new Set(catalog.LAB_TEST_CATALOG.map(t => t.sampleType)).size;
  console.log(
    `generate-lab-catalog wrote:\n` +
    `  supabase/migrations/${CATALOG_VERSION}.sql\n` +
    `  e2e/fixtures/mock-data.json\n` +
    `${catalog.LAB_TEST_CATALOG.length} tests across ${cats} categories and ${samples} sample types, ` +
    `${catalog.LAB_TEST_GROUP_CATALOG.length} groups.`,
  );
}
