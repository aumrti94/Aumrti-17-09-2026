-- KNOWN-BUG-120 recovery migration (2026-09-12).
--
-- `ai_feature_classes` and `clinical_reference_sources` are real tables — both are in the
-- generated src/integrations/supabase/types.ts, and `20261016000012_perf_fk_indexes.sql`
-- creates an index on each — but neither had a CREATE TABLE anywhere in this repo's migration
-- history. `supabase db reset` failed at `perf_fk_indexes.sql` with
-- `relation "public.clinical_reference_sources" does not exist`, confirmed by grepping every
-- migration for both names: nothing else in git ever creates them. Same root cause as
-- 20261016000010_create_missing_contract_tables.sql — an object the application (and in this
-- case, a later generated-index migration) references but which never had its own migration
-- committed.
--
-- Recovered by connecting read-only to the linked cloud project and extracting the real DDL
-- (`supabase db dump --schema-only -s public`), not by inferring a schema from column names in
-- types.ts. Every column, constraint, RLS policy and index below is copied verbatim from that
-- dump, not designed fresh — this migration's job is to make git match what is actually live,
-- not to redesign either table.
--
-- The two commented-out CREATE INDEX statements in perf_fk_indexes.sql (marked KNOWN-BUG-120)
-- are restored in the same change, since both tables now exist before that migration runs.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1. ai_feature_classes — platform-wide AI governance lookup: classifies each AI feature key
--    (drug_interaction_analysis, voice_scribe, ...) as safety / productivity / analytical, which
--    is what gates whether a feature may ever be budget-capped (safety-class AI is never capped
--    — see the ai-feature skill). Not tenant-scoped: one row per feature key, platform-wide.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_feature_classes (
  feature_key text NOT NULL,
  class       text NOT NULL,
  notes       text,
  updated_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_feature_classes_pkey PRIMARY KEY (feature_key),
  CONSTRAINT ai_feature_classes_class_check CHECK (class = ANY (ARRAY['safety', 'productivity', 'analytical']))
);

-- `updated_by` references `auth.users(id)`, not `public.users(id)` — reproduced exactly as it
-- exists live, NOT the house convention (CLAUDE.md: "_by columns FK public.users(id), never
-- auth.users(id)"). This migration recovers lost history; it does not redesign the table while
-- doing so — changing the FK target here would make git diverge from the live schema this is
-- meant to capture. Logged as KNOWN-BUG-122 and corrected as its own follow-up migration,
-- 20261106000011_fix_ai_feature_classes_user_fk.sql, right after this one — not folded in here.
ALTER TABLE public.ai_feature_classes
  ADD CONSTRAINT ai_feature_classes_updated_by_fkey
  FOREIGN KEY (updated_by) REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_ai_feature_classes_updated_by
  ON public.ai_feature_classes (updated_by);

ALTER TABLE public.ai_feature_classes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_feature_classes_read" ON public.ai_feature_classes;
CREATE POLICY "ai_feature_classes_read" ON public.ai_feature_classes
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "ai_feature_classes_admin_write" ON public.ai_feature_classes;
CREATE POLICY "ai_feature_classes_admin_write" ON public.ai_feature_classes
  TO authenticated
  USING (public.is_aumrti_admin())
  WITH CHECK (public.is_aumrti_admin());

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2. clinical_reference_sources — catalogue of citation sources (WHO/ICMR guidelines, PubMed,
--    hospital-authored protocols, ...) an AI clinical feature can cite. `hospital_id` is
--    NULLABLE by design: NULL rows are platform-wide sources every tenant can read (WHO
--    guidelines, say), non-NULL rows are a specific hospital's own protocol library, visible
--    only to that hospital's own staff. This is the "cross-tenant reference table" RLS shape
--    the supabase-migration skill documents, confirmed here against the real policy rather
--    than inferred from it.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.clinical_reference_sources (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key           text NOT NULL,
  organisation         text NOT NULL,
  full_name            text NOT NULL,
  source_type          text NOT NULL DEFAULT 'guideline',
  homepage_url         text NOT NULL,
  search_url_template  text,
  aliases              text[] NOT NULL DEFAULT '{}',
  region               text NOT NULL DEFAULT 'international',
  trust_tier           smallint NOT NULL DEFAULT 2,
  is_active            boolean NOT NULL DEFAULT true,
  verified_at          timestamptz,
  verified_by          text,
  hospital_id          uuid REFERENCES public.hospitals(id) ON DELETE CASCADE,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clinical_reference_sources_source_key_key UNIQUE (source_key),
  CONSTRAINT clinical_reference_sources_region_check
    CHECK (region = ANY (ARRAY['india', 'international'])),
  CONSTRAINT clinical_reference_sources_source_type_check
    CHECK (source_type = ANY (ARRAY['guideline', 'standard_treatment_guideline', 'evidence_summary', 'literature_index', 'regulatory', 'hospital_protocol'])),
  CONSTRAINT clinical_reference_sources_trust_tier_check
    CHECK (trust_tier >= 1 AND trust_tier <= 3)
);

CREATE INDEX IF NOT EXISTS idx_clinical_reference_sources_hospital_id
  ON public.clinical_reference_sources (hospital_id);
CREATE INDEX IF NOT EXISTS idx_clinical_ref_sources_aliases
  ON public.clinical_reference_sources USING gin (aliases);
CREATE INDEX IF NOT EXISTS idx_clinical_ref_sources_active_org
  ON public.clinical_reference_sources (lower(organisation))
  WHERE (is_active = true);

ALTER TABLE public.clinical_reference_sources ENABLE ROW LEVEL SECURITY;

-- Read: platform-wide rows (hospital_id IS NULL) OR your own hospital's rows.
DROP POLICY IF EXISTS "clinical_ref_sources_read" ON public.clinical_reference_sources;
CREATE POLICY "clinical_ref_sources_read" ON public.clinical_reference_sources
  FOR SELECT
  USING (
    hospital_id IS NULL
    OR hospital_id = (SELECT users.hospital_id FROM public.users WHERE users.auth_user_id = auth.uid())
  );

-- Write: only your own hospital's rows — nobody edits a platform-wide row this way.
DROP POLICY IF EXISTS "clinical_ref_sources_write" ON public.clinical_reference_sources;
CREATE POLICY "clinical_ref_sources_write" ON public.clinical_reference_sources
  USING (hospital_id = (SELECT users.hospital_id FROM public.users WHERE users.auth_user_id = auth.uid()))
  WITH CHECK (hospital_id = (SELECT users.hospital_id FROM public.users WHERE users.auth_user_id = auth.uid()));

-- Service role: the AI backend (ai-proxy / citation-resolution edge functions) needs unrestricted
-- read/write, same as every other AI-governance table in this schema.
DROP POLICY IF EXISTS "clinical_ref_sources_service_role" ON public.clinical_reference_sources;
CREATE POLICY "clinical_ref_sources_service_role" ON public.clinical_reference_sources
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMIT;
