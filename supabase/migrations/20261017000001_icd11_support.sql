-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: icd11_support
-- Purpose  : Add ICD-11 alongside the existing ICD-10 catalogue, and index the
--            catalogue for the full-text search the pickers actually run.
--
-- STRICTLY ADDITIVE. Nothing existing changes meaning:
--   * `code_system` defaults to 'icd10', so every existing catalogue row keeps
--     behaving exactly as before and every existing query still matches it.
--   * ICD-11 codes land in NEW columns beside `icd10_code`, never replacing it.
--     The statutory paths (PMJAY, HCX, FHIR, insurance pre-auth) read the ICD-10
--     columns and are untouched — see validate_pmjay_icd_before_claim() and
--     pmjay_package_master.icd10_codes[].
--   * `active_code_system` defaults to 'icd10', so no hospital is opted into
--     ICD-11 without saying so in Settings → ICD Code Master.
--   * The old idx_icd10_fts index is deliberately LEFT IN PLACE.
--
-- Idempotent: Yes — IF NOT EXISTS / CREATE OR REPLACE throughout.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Catalogue gains a code-system discriminator ───────────────────────────
-- One table rather than a parallel icd11_codes: the table name is referenced by
-- ~15 call sites and the generated Supabase types, and a second table would fork
-- every query for no functional gain.
ALTER TABLE public.icd10_codes
  ADD COLUMN IF NOT EXISTS code_system text NOT NULL DEFAULT 'icd10';

ALTER TABLE public.icd10_code_sets
  ADD COLUMN IF NOT EXISTS code_system text NOT NULL DEFAULT 'icd10';

COMMENT ON COLUMN public.icd10_codes.code_system IS
  'Which classification this row belongs to: icd10 | icd11. Defaults to icd10 so pre-existing rows are unchanged.';
COMMENT ON COLUMN public.icd10_code_sets.code_system IS
  'Which classification this uploaded set contains: icd10 | icd11.';

-- ── 2. Extend the existing validation triggers ───────────────────────────────
-- Replacing the function body is sufficient; the triggers created in
-- 20260329051509_* pick up the new definition automatically.
CREATE OR REPLACE FUNCTION public.validate_icd10_code()
  RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.gender_specific IS NOT NULL AND NEW.gender_specific NOT IN ('male','female') THEN
    RAISE EXCEPTION 'Invalid gender_specific: %', NEW.gender_specific;
  END IF;
  IF NEW.code_system NOT IN ('icd10','icd11') THEN
    RAISE EXCEPTION 'Invalid code_system: %', NEW.code_system;
  END IF;
  RETURN NEW;
END;$$;

CREATE OR REPLACE FUNCTION public.validate_icd10_code_set()
  RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.set_type NOT IN ('system_default','hospital_uploaded','custom') THEN
    RAISE EXCEPTION 'Invalid set_type: %', NEW.set_type;
  END IF;
  IF NEW.code_system NOT IN ('icd10','icd11') THEN
    RAISE EXCEPTION 'Invalid code_system: %', NEW.code_system;
  END IF;
  RETURN NEW;
END;$$;

-- ── 3. Per-hospital opt-in switch ────────────────────────────────────────────
-- NOTE: this is a DIFFERENT axis from the existing `active_set`, which selects
-- system vs hospital-uploaded codes. Do not conflate the two.
-- Default 'icd10' (not 'both') so an existing hospital sees exactly today's
-- behaviour until an admin turns ICD-11 on.
ALTER TABLE public.hospital_icd_settings
  ADD COLUMN IF NOT EXISTS active_code_system text NOT NULL DEFAULT 'icd10';

COMMENT ON COLUMN public.hospital_icd_settings.active_code_system IS
  'Which classification(s) the pickers offer: icd10 | icd11 | both. Defaults to icd10 — ICD-11 is opt-in.';

CREATE OR REPLACE FUNCTION public.validate_hospital_icd_settings()
  RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.active_set NOT IN ('system_only','hospital_only','all') THEN
    RAISE EXCEPTION 'Invalid active_set: %', NEW.active_set;
  END IF;
  IF NEW.active_code_system NOT IN ('icd10','icd11','both') THEN
    RAISE EXCEPTION 'Invalid active_code_system: %', NEW.active_code_system;
  END IF;
  RETURN NEW;
END;$$;

-- ── 4. ICD-11 columns on the clinical records ────────────────────────────────
-- Parallel columns, never a discriminator on the record itself: India is
-- mid-transition and ICD-10 remains mandatory for PMJAY/insurance while ICD-11
-- is what WHO reporting wants. Dual-coding is the real requirement, and it keeps
-- every existing consumer of icd10_code working untouched.
ALTER TABLE public.opd_diagnoses
  ADD COLUMN IF NOT EXISTS icd11_code        text,
  ADD COLUMN IF NOT EXISTS icd11_description text;

ALTER TABLE public.opd_encounters
  ADD COLUMN IF NOT EXISTS icd11_code text;

ALTER TABLE public.icd_codings
  ADD COLUMN IF NOT EXISTS primary_icd11_code text,
  ADD COLUMN IF NOT EXISTS primary_icd11_desc text;

-- ── 5. Make the catalogue search actually use an index ───────────────────────
-- The existing idx_icd10_fts is on to_tsvector('english', code || ' ' || description),
-- but every caller runs .textSearch("description", …), which Postgres expands to
-- to_tsvector(<default config>, description) — a different expression, so the index
-- was never used and the table was seq-scanned. That was tolerable at ~294 rows;
-- it is not once a full ICD-11 linearization is uploaded.
--
-- A stored generated column gives the pickers a stable thing to match on.
ALTER TABLE public.icd10_codes
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(code, '') || ' ' || coalesce(description, ''))
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_icd10_search_tsv
  ON public.icd10_codes USING gin(search_tsv);

CREATE INDEX IF NOT EXISTS idx_icd10_code_system
  ON public.icd10_codes(code_system, common_india, use_count DESC);

-- idx_icd10_fts is intentionally NOT dropped — removing it would be a change to
-- something that currently works, and it costs nothing to keep.

-- ── 6. RLS ───────────────────────────────────────────────────────────────────
-- No policy changes needed. "Read global or own codes" on icd10_codes is
--   (hospital_id IS NULL OR hospital_id = get_user_hospital_id())
-- which already covers the seeded global ICD-11 rows and hospital uploads alike.
