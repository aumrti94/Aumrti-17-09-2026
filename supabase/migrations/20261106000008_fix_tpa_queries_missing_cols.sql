-- =============================================================================
-- Migration: 20261106000008_fix_tpa_queries_missing_cols.sql
--   (originally 20260615000001 — see KNOWN-BUG-118-class fix below)
-- Purpose  : Backfill columns that 20260529_insurance_upgrade.sql attempted to
--            add to tpa_queries via a guarded DO-block, but the block was
--            silently skipped because tpa_queries did not yet exist at that
--            point (it was created later in 20260904000026_p2_gaps.sql).
--
-- ── Ordering fix (2026-09-12, same class as KNOWN-BUG-118) ──────────────────
-- This file was ALSO originally timestamped in the past (20260615000001) —
-- before `tpa_queries` existed. Unlike the migrations this file's own header
-- describes, its own ALTER TABLE statements were NOT guarded, so it hard-failed
-- `supabase db reset` with `relation "public.tpa_queries" does not exist`
-- immediately after the KNOWN-BUG-118 fix let the reset reach this far.
-- Renamed via `git mv` to sort after 20260904000026_p2_gaps.sql (which creates
-- tpa_queries); content unchanged — every statement was already idempotent
-- (ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS, CREATE INDEX IF NOT
-- EXISTS), so only the timestamp needed to move.
--
--            20260907000001_insurance_automation.sql subsequently added
--            pre_auth_id and ai_suggested_reply, but the following five
--            columns are still absent:
--              query_date, response_deadline, response_text,
--              response_date, ai_draft_response
--
--            All statements use ADD COLUMN IF NOT EXISTS and
--            DROP/ADD CONSTRAINT with IF EXISTS — safe to re-run.
--
-- PART C audit
--   insurance_pre_auth  — created 20260323, well before 20260529; its ALTER
--                         statements were NOT guarded and ran successfully.
--                         No action needed.
--   insurance_claims    — same situation; no action needed.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Add missing columns to tpa_queries
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.tpa_queries
  ADD COLUMN IF NOT EXISTS query_date         DATE,
  ADD COLUMN IF NOT EXISTS response_deadline  DATE,
  ADD COLUMN IF NOT EXISTS response_text      TEXT,
  ADD COLUMN IF NOT EXISTS response_date      DATE,
  ADD COLUMN IF NOT EXISTS ai_draft_response  TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Widen the status check constraint so it includes 'responded' and 'overdue'
--    (TPAQueryManager.tsx writes status='responded' on submitResponse).
--    The p2_gaps table definition used an anonymous constraint named
--    tpa_queries_status_check; 20260529 tried to rename it to
--    tpa_queries_status_chk — both drops are guarded.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.tpa_queries
  DROP CONSTRAINT IF EXISTS tpa_queries_status_check;

ALTER TABLE public.tpa_queries
  DROP CONSTRAINT IF EXISTS tpa_queries_status_chk;

ALTER TABLE public.tpa_queries
  ADD CONSTRAINT tpa_queries_status_chk
  CHECK (status IN ('open', 'responded', 'replied', 'overdue', 'escalated', 'closed'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Indexes
--    idx_tpaq_response_deadline — supports ORDER BY response_deadline used by
--    TPAQueryManager's main fetch query (NULLs last).
--    The four indexes from 20260529's guarded block were also skipped;
--    p2_gaps created partial equivalents, but idx_tpaq_created_at is new.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tpaq_response_deadline
  ON public.tpa_queries (response_deadline ASC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_tpaq_hospital_id
  ON public.tpa_queries (hospital_id);

CREATE INDEX IF NOT EXISTS idx_tpaq_claim_id
  ON public.tpa_queries (claim_id);

CREATE INDEX IF NOT EXISTS idx_tpaq_status
  ON public.tpa_queries (hospital_id, status);

CREATE INDEX IF NOT EXISTS idx_tpaq_created_at
  ON public.tpa_queries (created_at DESC);

-- =============================================================================
-- END
-- =============================================================================
