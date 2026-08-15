-- ══════════════════════════════════════════════════════════════════════════
-- Patient History Ingestion — schema (1/3)
--
-- Owner: Meera (DB) | Clinical schema: Priya | DPDP: Ananya | MRD: Saroja
--
-- WHAT THIS IS FOR
-- A rural OPD patient arrives with a bag of outside paper — old prescriptions,
-- discharge summaries, lab reports, sometimes hundreds of pages, often
-- handwritten. The doctor has ~4 minutes. Today that information is not used
-- slowly; it is not used at all. These tables back a pipeline that reads every
-- page, builds one date-ordered timeline, and keeps it for future visits.
--
-- ── THE CENTRAL DESIGN DECISION: NO BINARY IS RETAINED ────────────────────
-- Scanned PDFs/images transit the `patient-documents` bucket ONLY as a staging
-- area for the extraction worker, and are purged the moment the job reaches a
-- terminal state (see 20261013000012). What persists is the VERBATIM
-- TRANSCRIBED TEXT per page range, plus the structured timeline built from it.
--
-- Consequences, accepted deliberately:
--   • DPDP data minimisation — the hospital does not warehouse third-party PHI
--     it never generated. The patient keeps the physical paper.
--   • Provenance survives as TEXT, not as an image. This is why
--     patient_history_source_chunks.verbatim_text is not optional and not a
--     debugging aid — with the binary gone, it IS the audit record that lets a
--     doctor challenge any line in the timeline against the paper in their hand.
--   • Re-extracting with a better model later requires re-scanning. Accepted.
--
-- ── WHY NOT REUSE public.patient_documents ────────────────────────────────
-- That table exists for STORED documents and its file_url is NOT NULL — the
-- wrong shape for a record whose binary is deliberately discarded. Widening it
-- would also put two lifecycles (retained vs purged) behind one validation
-- trigger. The existing single-file uploader (PatientDocuments.tsx) is left
-- completely untouched by this migration.
--
-- Idempotent — safe to re-run.
-- ══════════════════════════════════════════════════════════════════════════


-- ─── 1. Ingest jobs — one row per scanned batch ─────────────────────────────

CREATE TABLE IF NOT EXISTS public.patient_history_ingest_jobs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id        uuid NOT NULL REFERENCES public.hospitals(id),
  patient_id         uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,

  -- Which consultation triggered the scan, when one did. Nullable on purpose:
  -- the front desk scans during registration, before any encounter exists.
  -- That is the intended primary path — a doctor will not scan 100 pages in a
  -- 4-minute slot (Rohit).
  encounter_id       uuid REFERENCES public.opd_encounters(id) ON DELETE SET NULL,

  status             text NOT NULL DEFAULT 'uploading',

  -- Tier recorded at the job level for reporting; the authoritative per-file
  -- choice lives on patient_history_sources.model_tier, because one bag can mix
  -- 300 typed lab pages (fast) with 12 handwritten prescription pages (accurate).
  -- 'mixed' is what the job carries when the two disagree.
  model_tier         text NOT NULL DEFAULT 'fast',

  documents_total    integer NOT NULL DEFAULT 0,
  pages_total        integer NOT NULL DEFAULT 0,
  pages_extracted    integer NOT NULL DEFAULT 0,
  pages_failed       integer NOT NULL DEFAULT 0,

  -- What the doctor was shown BEFORE clicking Analyse, versus what it actually
  -- cost. Kept side by side so the estimate can be audited: a confirm dialog
  -- quoting a number that is routinely wrong is worse than no dialog at all
  -- (Kavitha). QA asserts actual lands within ~20% of estimate.
  estimated_cost_inr numeric(10,2),
  actual_cost_inr    numeric(10,2),

  requested_by       uuid REFERENCES public.users(id),
  error_name         text,
  started_at         timestamptz,
  finished_at        timestamptz,
  purged_at          timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- 'uploading' → files are being staged, no spend yet, worker must ignore it.
-- 'partial'   → finished with at least one unreadable page range. A REAL and
--               EXPECTED terminal state, not an error: the coverage banner shows
--               amber and names the pages. Collapsing this into 'complete' is
--               exactly the lie this whole feature exists to avoid.
ALTER TABLE public.patient_history_ingest_jobs
  DROP CONSTRAINT IF EXISTS chk_history_job_status;
ALTER TABLE public.patient_history_ingest_jobs
  ADD CONSTRAINT chk_history_job_status CHECK (status IN (
    'uploading','queued','running','reducing','complete','partial','failed','cancelled'
  ));

ALTER TABLE public.patient_history_ingest_jobs
  DROP CONSTRAINT IF EXISTS chk_history_job_tier;
ALTER TABLE public.patient_history_ingest_jobs
  ADD CONSTRAINT chk_history_job_tier CHECK (model_tier IN ('fast','accurate','mixed'));

CREATE INDEX IF NOT EXISTS idx_history_jobs_patient
  ON public.patient_history_ingest_jobs (patient_id, created_at DESC);

-- Drives the purge sweep and the "is anything still running for this patient?"
-- poll. Partial so it stays small — finished, purged jobs fall out of it.
CREATE INDEX IF NOT EXISTS idx_history_jobs_open
  ON public.patient_history_ingest_jobs (status, created_at)
  WHERE purged_at IS NULL;


-- ─── 2. Sources — one row per scanned file (NO binary retained) ─────────────

CREATE TABLE IF NOT EXISTS public.patient_history_sources (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     uuid NOT NULL REFERENCES public.hospitals(id),
  patient_id      uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  job_id          uuid NOT NULL REFERENCES public.patient_history_ingest_jobs(id) ON DELETE CASCADE,

  source_name     text NOT NULL,
  -- Free text, AI-assigned after reading. Deliberately NOT constrained to the
  -- eight values patient_documents.validate_patient_document_type enforces:
  -- that trigger governs a different table with a different lifecycle, and
  -- forcing an outside record into one of eight buckets loses information the
  -- timeline can use (Saroja).
  source_type     text NOT NULL DEFAULT 'other',
  page_count      integer NOT NULL DEFAULT 1,

  -- SHA-256 of the file bytes, computed client-side before upload. The dedupe
  -- key: a patient re-scanning the same discharge summary at their next visit
  -- must not be extracted — or charged for — twice.
  content_hash    text,

  -- The CLINICAL date printed on the paper, extracted by the model. Entirely
  -- distinct from created_at (when it was scanned) — a 2019 discharge summary
  -- scanned today is a 2019 event on the timeline.
  document_date   date,

  model_tier      text NOT NULL DEFAULT 'fast',
  ingest_status   text NOT NULL DEFAULT 'pending',

  -- Storage object path WHILE STAGED. Nulled at purge, alongside a purged_at
  -- stamp on the parent job. A non-null staged_path on a purged job is a bug,
  -- and the sweep in 20261013000012 treats it as one.
  staged_path     text,

  error_name      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- 'unsupported' → a file type with no reliable reader (bmp/tiff/.doc/heic).
-- It still gets a row so the coverage ledger can say "this was scanned and NOT
-- read" rather than quietly dropping it from the count.
ALTER TABLE public.patient_history_sources
  DROP CONSTRAINT IF EXISTS chk_history_source_status;
ALTER TABLE public.patient_history_sources
  ADD CONSTRAINT chk_history_source_status CHECK (ingest_status IN (
    'pending','chunked','extracted','partial','failed','unsupported'
  ));

ALTER TABLE public.patient_history_sources
  DROP CONSTRAINT IF EXISTS chk_history_source_tier;
ALTER TABLE public.patient_history_sources
  ADD CONSTRAINT chk_history_source_tier CHECK (model_tier IN ('fast','accurate'));

CREATE INDEX IF NOT EXISTS idx_history_sources_job
  ON public.patient_history_sources (job_id);

-- The dedupe lookup. Not UNIQUE: the same document legitimately reappears
-- across patients (a shared lab report format hashes differently, but a
-- re-scan by a different hospital of the same patient should still be allowed
-- to record its own row). Uniqueness is enforced in the client's pre-scan check,
-- which is the only place that can tell the user "already on file".
CREATE INDEX IF NOT EXISTS idx_history_sources_dedupe
  ON public.patient_history_sources (patient_id, content_hash)
  WHERE content_hash IS NOT NULL;

-- Feeds the purge sweep: everything still holding a staged object.
CREATE INDEX IF NOT EXISTS idx_history_sources_staged
  ON public.patient_history_sources (job_id)
  WHERE staged_path IS NOT NULL;


-- ─── 3. Source chunks — coverage ledger AND permanent provenance ────────────
--
-- One row per page range (default 15 pages). This table does double duty and
-- both duties are load-bearing:
--
--   COVERAGE LEDGER — the arithmetic behind "412 of 412 pages read". Every page
--   of every scanned file belongs to exactly one row here. A page that cannot be
--   read gets status='failed', NOT a missing row. The invariant QA asserts is
--   SUM(page_to - page_from + 1) = pages_total, with no gaps in the ranges.
--
--   PROVENANCE — verbatim_text is the transcription the timeline was built from.
--   Because the binary is purged, this is the only surviving evidence of what the
--   paper actually said. It is written BEFORE the structured extraction, so a
--   model that transcribes fine but emits malformed JSON still leaves the doctor
--   something to read.

CREATE TABLE IF NOT EXISTS public.patient_history_source_chunks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id    uuid NOT NULL REFERENCES public.hospitals(id),
  patient_id     uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  source_id      uuid NOT NULL REFERENCES public.patient_history_sources(id) ON DELETE CASCADE,
  job_id         uuid NOT NULL REFERENCES public.patient_history_ingest_jobs(id) ON DELETE CASCADE,

  page_from      integer NOT NULL,
  page_to        integer NOT NULL,

  status         text NOT NULL DEFAULT 'pending',
  attempts       integer NOT NULL DEFAULT 0,

  verbatim_text  text,
  extracted      jsonb,

  model_used     text,
  model_tier     text,
  prompt_version integer,
  error_name     text,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.patient_history_source_chunks
  DROP CONSTRAINT IF EXISTS chk_history_chunk_status;
ALTER TABLE public.patient_history_source_chunks
  ADD CONSTRAINT chk_history_chunk_status CHECK (status IN (
    'pending','running','extracted','failed'
  ));

ALTER TABLE public.patient_history_source_chunks
  DROP CONSTRAINT IF EXISTS chk_history_chunk_pages;
ALTER TABLE public.patient_history_source_chunks
  ADD CONSTRAINT chk_history_chunk_pages CHECK (page_to >= page_from AND page_from >= 1);

-- The no-gaps, no-overlaps guarantee starts here: one chunk may begin at a given
-- page of a given source. Also the ON CONFLICT target that makes chunk creation
-- safely re-runnable after a worker dies mid-write.
CREATE UNIQUE INDEX IF NOT EXISTS uq_history_chunk_range
  ON public.patient_history_source_chunks (source_id, page_from);

-- The worker's hot query: "next pending chunk for this job". Partial, because a
-- completed 400-page job's 27 rows must not slow down the next job's scan.
CREATE INDEX IF NOT EXISTS idx_history_chunks_pending
  ON public.patient_history_source_chunks (job_id, page_from)
  WHERE status IN ('pending','running');

CREATE INDEX IF NOT EXISTS idx_history_chunks_source
  ON public.patient_history_source_chunks (source_id, page_from);


-- ─── 4. Digests — the doctor-facing structured history ──────────────────────
--
-- Patient-scoped, NOT encounter-scoped: this is the patient's history, and its
-- whole value is that the second visit inherits what the first visit's scan
-- built. Versioned and append-only — a later scan adds a new row rather than
-- overwriting, so a digest a doctor already attested to can never change under
-- them retrospectively.

CREATE TABLE IF NOT EXISTS public.patient_history_digests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id    uuid NOT NULL REFERENCES public.hospitals(id),
  patient_id     uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  job_id         uuid REFERENCES public.patient_history_ingest_jobs(id) ON DELETE SET NULL,

  version        integer NOT NULL DEFAULT 1,
  prompt_version integer,
  model_used     text,

  -- Array of dated clinical events, newest-first, each carrying `verbatim` and a
  -- `source` {source_id, source_name, page_from, page_to}. Shape documented on
  -- the column comment below.
  timeline       jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- { one_liner, active_problems[], current_medications[], allergies[],
  --   surgeries[], key_investigations[], red_flags[], conflicts[], gaps[] }
  summary        jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- { documents_total, pages_total, pages_read, pages_unreadable,
  --   unreadable_refs: [{source_name, page_from, page_to}] }
  -- Copied from the job counters at reduce time so the banner is a single read
  -- and cannot drift from what the doctor was shown.
  coverage       jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Human-in-the-loop gate (Arnav). Until reviewed_at is set, this digest is
  -- labelled UNVERIFIED everywhere it appears, including in the prompt text sent
  -- to the three AI Guidance cards.
  reviewed_by    uuid REFERENCES public.users(id),
  reviewed_at    timestamptz,

  is_current     boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Exactly one current digest per patient. A partial unique index rather than
-- application discipline: two current digests would make "the patient's history"
-- ambiguous at the exact moment a doctor is reading it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_history_digest_current
  ON public.patient_history_digests (hospital_id, patient_id)
  WHERE is_current;

CREATE INDEX IF NOT EXISTS idx_history_digests_patient
  ON public.patient_history_digests (patient_id, version DESC);


-- ─── 5. updated_at ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.touch_patient_history_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_history_jobs_touch    ON public.patient_history_ingest_jobs;
DROP TRIGGER IF EXISTS trg_history_sources_touch ON public.patient_history_sources;
DROP TRIGGER IF EXISTS trg_history_chunks_touch  ON public.patient_history_source_chunks;
DROP TRIGGER IF EXISTS trg_history_digests_touch ON public.patient_history_digests;

CREATE TRIGGER trg_history_jobs_touch    BEFORE UPDATE ON public.patient_history_ingest_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_patient_history_updated_at();
CREATE TRIGGER trg_history_sources_touch BEFORE UPDATE ON public.patient_history_sources
  FOR EACH ROW EXECUTE FUNCTION public.touch_patient_history_updated_at();
CREATE TRIGGER trg_history_chunks_touch  BEFORE UPDATE ON public.patient_history_source_chunks
  FOR EACH ROW EXECUTE FUNCTION public.touch_patient_history_updated_at();
CREATE TRIGGER trg_history_digests_touch BEFORE UPDATE ON public.patient_history_digests
  FOR EACH ROW EXECUTE FUNCTION public.touch_patient_history_updated_at();


-- ─── 6. RLS — tenant isolation ──────────────────────────────────────────────
--
-- ANANYA, READ THIS BEFORE THE WORKER LANDS: these policies protect the CLIENT
-- path only. supabase/functions/ai-history-ingest runs under the SERVICE ROLE and
-- therefore bypasses every policy below. Each of its reads must filter
-- hospital_id explicitly IN ADDITION TO patient_id / job_id / source_id — the same
-- hazard called out in ai-clarifying-questions/index.ts. The direct-invoke
-- cross-tenant test in QA exists for precisely this gap.

ALTER TABLE public.patient_history_ingest_jobs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_history_sources        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_history_source_chunks  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_history_digests        ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hospital_isolation" ON public.patient_history_ingest_jobs;
CREATE POLICY "hospital_isolation" ON public.patient_history_ingest_jobs
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

DROP POLICY IF EXISTS "hospital_isolation" ON public.patient_history_sources;
CREATE POLICY "hospital_isolation" ON public.patient_history_sources
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

DROP POLICY IF EXISTS "hospital_isolation" ON public.patient_history_source_chunks;
CREATE POLICY "hospital_isolation" ON public.patient_history_source_chunks
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

DROP POLICY IF EXISTS "hospital_isolation" ON public.patient_history_digests;
CREATE POLICY "hospital_isolation" ON public.patient_history_digests
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());


-- ─── 7. DPDP Act 2023 — purpose, contents, retention, access ────────────────
-- (Ananya. Every column storing patient data must document all four.)

COMMENT ON TABLE public.patient_history_ingest_jobs IS
  'One scanned batch of patient-supplied outside medical records. Purpose: clinical care for this patient only — never analytics, never model training. Contents: counts, cost and status only, no clinical text. Retention: lifecycle of the patient record. Access: hospital_id RLS (same-hospital clinical and front-desk staff).';

COMMENT ON TABLE public.patient_history_sources IS
  'One patient-supplied outside document that was scanned. THE FILE ITSELF IS NOT RETAINED — staged_path points at a transient staging object that is purged when the job finishes (see 20261013000012). Purpose: clinical care for this patient. Retention: lifecycle of the patient record; the binary''s retention is governed by hospital_settings key history_retain_originals_days, default 0 = purge immediately. Access: hospital_id RLS.';

COMMENT ON COLUMN public.patient_history_sources.content_hash IS
  'SHA-256 of the scanned file, computed client-side. Purpose: de-duplication, so a re-scanned document is neither re-extracted nor re-charged. Not reversible to content. Retention: with the parent row.';

COMMENT ON COLUMN public.patient_history_sources.staged_path IS
  'Transient storage object path, valid only while the job is running. MUST be NULL once the parent job carries purged_at. A non-null value on a purged job means the binary outlived its retention window and is a DPDP incident, not a cosmetic bug.';

COMMENT ON TABLE public.patient_history_source_chunks IS
  'One page range of one scanned outside document. Serves as BOTH the coverage ledger (every page of every document has exactly one row, including unreadable ones) AND — because the binary is discarded — the permanent provenance record. Purpose: clinical care for this patient. Retention: lifecycle of the patient record. Access: hospital_id RLS.';

COMMENT ON COLUMN public.patient_history_source_chunks.verbatim_text IS
  'Transcription of what is physically printed or written on these pages, before any interpretation. Purpose: the audit trail that lets a treating doctor verify any timeline entry against the paper the patient still holds — this is the ONLY surviving evidence of the document contents, since the scan itself is purged. Contents: third-party clinical PHI supplied by the patient. Retention: lifecycle of the patient record. Access: hospital_id RLS.';

COMMENT ON COLUMN public.patient_history_source_chunks.extracted IS
  'Structured clinical events parsed from verbatim_text for this page range: [{date, date_confidence, type, facility, title, detail, values[], medications[], significance, red_flag, verbatim, source{}}]. Written after verbatim_text so a transcription survives a structuring failure.';

COMMENT ON TABLE public.patient_history_digests IS
  'The merged, date-ordered clinical history built from all scanned outside records for one patient. SaMD Class B (Decision Support): it asserts an active-problem and medication list a doctor could act on, so it requires the reviewed_by/reviewed_at attestation before it is treated as verified. Purpose: clinical care for this patient. Retention: lifecycle of the patient record. Access: hospital_id RLS.';

COMMENT ON COLUMN public.patient_history_digests.timeline IS
  'Date-ordered clinical events. Each carries `verbatim` (the transcribed source line) and `source` {source_id, source_name, page_from, page_to} so every claim is traceable to a page. Sorted in application code, never by the model.';

COMMENT ON COLUMN public.patient_history_digests.coverage IS
  'Page accounting: {documents_total, pages_total, pages_read, pages_unreadable, unreadable_refs[]}. Rendered as the first thing on screen. A green banner over an unreadable page range is the failure this feature exists to prevent.';

COMMENT ON COLUMN public.patient_history_digests.reviewed_at IS
  'When the treating doctor attested to this digest. Human-in-the-loop gate for a SaMD Class B output: until set, the digest is labelled unverified in the UI and is prefixed as unverified in the prompt text sent to the AI Guidance cards.';
