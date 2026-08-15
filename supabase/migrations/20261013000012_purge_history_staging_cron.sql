-- ══════════════════════════════════════════════════════════════════════════
-- Patient History Ingestion — staging purge (3/3)
--
-- Owner: Meera (DB) | DPDP: Ananya
--
-- The scanned PDFs and photos are staged in the `patient-documents` bucket ONLY
-- so the extraction worker can read them. Once the job is done they must go —
-- that non-retention is the DPDP position this whole feature is built on, and it
-- is only true if the sweep is reliable on the FAILURE path too.
--
-- ── WHY THE DELETION ITSELF IS NOT DONE IN SQL ────────────────────────────
-- `DELETE FROM storage.objects` removes the index row but ORPHANS the underlying
-- S3 blob — the bytes survive, unreferenced and un-garbage-collected. For a
-- retention guarantee that is not a deletion at all, it is a deletion that looks
-- like one in the database. So the actual removal goes through the Storage API in
-- the edge function (`admin.storage.from(bucket).remove(paths)`, the same call
-- delete-hospital uses), and this file provides only:
--
--   • the candidate query        — which jobs are due
--   • the retention lookup       — per-hospital grace window
--   • the finalisation           — recompute a job's terminal status from chunks
--   • the post-purge bookkeeping — called ONLY AFTER the API removal succeeded
--
-- mark_history_job_purged() is deliberately a separate call from the removal. If
-- the Storage API fails, nothing is stamped, the job stays a candidate, and the
-- next sweep retries it. The database must never claim a binary is gone while it
-- is still fetchable.
--
-- ── THREE THINGS TRIGGER A PURGE ──────────────────────────────────────────
--   1. Normal path  — ai-history-digest purges its own job the moment it finishes.
--                     Covers essentially every job.
--   2. Opportunistic — ai-history-ingest sweeps stale jobs at the start of every
--                     new upload. Costs one indexed query; keeps an active
--                     hospital clean without any scheduler at all.
--   3. Scheduled     — the pg_cron job below, for a hospital that scans nothing
--                     for a week after a job died mid-run. This is the only one
--                     that needs setup (see the Vault prerequisite), and the
--                     RAISE NOTICE says so loudly rather than failing silently.
--
-- Idempotent — safe to re-run.
-- ══════════════════════════════════════════════════════════════════════════


-- ─── 1. Per-hospital retention window ───────────────────────────────────────
-- Default 0 = purge as soon as the job is terminal. A hospital that wants a grace
-- window (so an unreadable page can be retried without re-scanning the patient's
-- paper) sets hospital_settings key 'history_retain_originals_days'. Capped at 30:
-- an unbounded value would turn a staging area into an archive by accident, which
-- is exactly the DPDP exposure this design exists to avoid.

-- Accepts either shape the settings UI might write — {"days": 7} or a bare 7 — because
-- hospital_settings.value is untyped JSONB and a mismatch here would silently fall back to 0.
-- Failing closed (purge immediately) is the safe direction, but a hospital that asked for a
-- grace window and silently did not get one would only find out when a retry needed a scan
-- that was already gone.
CREATE OR REPLACE FUNCTION public.history_retention_days(p_hospital_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT LEAST(
    GREATEST(
      COALESCE(
        (SELECT COALESCE(
                  NULLIF(value ->> 'days', ''),
                  CASE WHEN jsonb_typeof(value) = 'number' THEN value #>> '{}' END
                )::integer
           FROM public.hospital_settings
          WHERE hospital_id = p_hospital_id
            AND key = 'history_retain_originals_days'),
        0),
      0),
    30);
$$;

COMMENT ON FUNCTION public.history_retention_days(uuid) IS
  'How many days a hospital keeps the scanned originals of outside patient records after ingestion finishes. Default 0 (purge immediately), hard-capped at 30 — a staging area must never become an archive.';


-- ─── 2. Finalise a job from its chunk counters ──────────────────────────────
-- The single source of truth for "is this job done, and did it read everything".
-- Both the worker and the sweep call it, so the terminal status can never be
-- decided two different ways.
--
-- 'partial' is a FIRST-CLASS SUCCESS STATE, not a soft failure. It means the run
-- completed and some pages could not be read — which the coverage banner then
-- shows in amber with the exact page ranges. Folding it into 'complete' would put
-- a green tick over an unread page, which is the one outcome this feature exists
-- to make impossible.

CREATE OR REPLACE FUNCTION public.finalize_history_job(p_job_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_read     integer;
  v_failed   integer;
  v_open     integer;
  v_status   text;
BEGIN
  SELECT
    COALESCE(SUM(CASE WHEN status = 'extracted' THEN page_to - page_from + 1 END), 0),
    COALESCE(SUM(CASE WHEN status = 'failed'    THEN page_to - page_from + 1 END), 0),
    COUNT(*) FILTER (WHERE status IN ('pending','running'))
  INTO v_read, v_failed, v_open
  FROM public.patient_history_source_chunks
  WHERE job_id = p_job_id;

  -- Still work to do — leave the job alone.
  IF v_open > 0 THEN
    RETURN 'running';
  END IF;

  v_status := CASE
    WHEN v_read = 0 AND v_failed > 0 THEN 'failed'   -- nothing readable at all
    WHEN v_failed > 0                THEN 'partial'  -- read most of it, said so
    ELSE                                  'complete'
  END;

  UPDATE public.patient_history_ingest_jobs
     SET status          = v_status,
         pages_extracted = v_read,
         pages_failed    = v_failed,
         finished_at     = COALESCE(finished_at, now())
   WHERE id = p_job_id;

  -- Roll the same verdict down to each source, so the UI can name which document
  -- the unreadable pages belong to without re-aggregating chunks client-side.
  UPDATE public.patient_history_sources s
     SET ingest_status = c.verdict
    FROM (
      SELECT source_id,
             CASE
               WHEN COUNT(*) FILTER (WHERE status = 'extracted') = 0 THEN 'failed'
               WHEN COUNT(*) FILTER (WHERE status = 'failed')    > 0 THEN 'partial'
               ELSE 'extracted'
             END AS verdict
        FROM public.patient_history_source_chunks
       WHERE job_id = p_job_id
       GROUP BY source_id
    ) c
   WHERE s.id = c.source_id
     AND s.ingest_status NOT IN ('unsupported');

  RETURN v_status;
END $$;

REVOKE ALL ON FUNCTION public.finalize_history_job(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.finalize_history_job(uuid) TO service_role;

COMMENT ON FUNCTION public.finalize_history_job(uuid) IS
  'Recomputes an ingest job''s terminal status and page counters from its chunk rows. Returns ''running'' and changes nothing while chunks remain open. ''partial'' is a real terminal state meaning "finished, and some pages were unreadable" — never collapse it into ''complete''.';


-- ─── 3. Purge candidates ────────────────────────────────────────────────────
-- Returns the staged object paths the edge function should hand to
-- storage.remove(). Two kinds of candidate:
--
--   TERMINAL  — job finished, retention window elapsed. The normal case.
--   STALE     — job stuck in a non-terminal state with no heartbeat for
--               p_stale_minutes. The worker re-invokes itself roughly every 90s,
--               so 30 minutes of silence means it died: a deploy mid-run, an
--               unhandled throw, a provider outage. Without this branch those
--               binaries would sit in staging forever, which is precisely the
--               DPDP failure the non-retention design is meant to prevent.

CREATE OR REPLACE FUNCTION public.history_purge_candidates(
  p_limit          integer DEFAULT 50,
  p_stale_minutes  integer DEFAULT 30
)
RETURNS TABLE (
  job_id       uuid,
  hospital_id  uuid,
  job_status   text,
  is_stale     boolean,
  staged_paths text[]
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    j.id,
    j.hospital_id,
    j.status,
    j.status NOT IN ('complete','partial','failed','cancelled') AS is_stale,
    array_agg(s.staged_path ORDER BY s.created_at)
  FROM public.patient_history_ingest_jobs j
  JOIN public.patient_history_sources s
    ON s.job_id = j.id AND s.staged_path IS NOT NULL
  WHERE j.purged_at IS NULL
    AND (
      -- terminal + retention elapsed
      (    j.status IN ('complete','partial','failed','cancelled')
       AND COALESCE(j.finished_at, j.updated_at)
             < now() - (public.history_retention_days(j.hospital_id) || ' days')::interval)
      OR
      -- non-terminal + no heartbeat
      (    j.status NOT IN ('complete','partial','failed','cancelled')
       AND j.updated_at < now() - (p_stale_minutes || ' minutes')::interval)
    )
  GROUP BY j.id, j.hospital_id, j.status
  ORDER BY j.updated_at
  LIMIT GREATEST(p_limit, 1);
$$;

REVOKE ALL ON FUNCTION public.history_purge_candidates(integer, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.history_purge_candidates(integer, integer) TO service_role;

COMMENT ON FUNCTION public.history_purge_candidates(integer, integer) IS
  'Staged scan objects due for deletion: finished jobs past their hospital''s retention window, plus jobs stuck with no heartbeat (a worker that died mid-run would otherwise leave patient PHI in staging indefinitely). Service-role only — it returns storage paths across every tenant.';


-- ─── 4. Post-purge bookkeeping ──────────────────────────────────────────────
-- Called by the edge function ONLY AFTER storage.remove() reported success. Kept
-- separate from the candidate query for exactly that reason: a failed removal
-- must leave the job a candidate for the next sweep rather than marking it clean.
--
-- A stale job is also given a terminal status here, otherwise it stays "running"
-- forever in the UI and the doctor never learns the scan died.

CREATE OR REPLACE FUNCTION public.mark_history_job_purged(p_job_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.patient_history_sources
     SET staged_path = NULL
   WHERE job_id = p_job_id;

  UPDATE public.patient_history_ingest_jobs
     SET purged_at = now(),
         status    = CASE
                       WHEN status IN ('complete','partial','failed','cancelled') THEN status
                       -- Died mid-run. If it read nothing it failed outright;
                       -- if it read some pages the digest can still be built
                       -- from them, and the coverage banner will show the rest
                       -- as unreadable.
                       WHEN pages_extracted > 0 THEN 'partial'
                       ELSE 'failed'
                     END,
         error_name  = COALESCE(error_name,
                         CASE WHEN status NOT IN ('complete','partial','failed','cancelled')
                              THEN 'WorkerStalled' END),
         finished_at = COALESCE(finished_at, now())
   WHERE id = p_job_id;
END $$;

REVOKE ALL ON FUNCTION public.mark_history_job_purged(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.mark_history_job_purged(uuid) TO service_role;

COMMENT ON FUNCTION public.mark_history_job_purged(uuid) IS
  'Records that a job''s staged scan objects have been deleted, and gives a stalled job a terminal status. MUST be called only after the Storage API removal actually succeeded — a non-null staged_path on a job carrying purged_at means a binary outlived its retention window.';


-- ─── 5. Scheduled sweep ─────────────────────────────────────────────────────
-- Belt and braces for the quiet-hospital case. Same guarded pattern as
-- 20261011000050_qi_cron.sql and 20261008000100_cron_jobs_use_vault.sql: skip with
-- a loud NOTICE rather than failing the migration when pg_cron or the Vault secret
-- is absent.
--
-- Hourly, not nightly: this deletes patient PHI that is past its retention window,
-- and "within an hour" is a defensible answer to a DPDP query in a way that "some
-- time before tomorrow morning" is not.

DO $$
DECLARE
  fn_url text := 'https://pdxvisvmnzjhsgmvygku.supabase.co';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE
      'pg_cron is not enabled — the scheduled staging purge was NOT installed. '
      'Staging is still purged on the normal path (ai-history-digest purges its own job) '
      'and opportunistically at the start of every new scan, so an active hospital stays '
      'clean. What is missing is the safety net for a job that dies on a hospital that then '
      'scans nothing for days. Enable pg_cron and re-run this migration.';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'aumrti_service_role_key') THEN
    RAISE NOTICE
      'aumrti_service_role_key not in Vault — scheduled staging purge NOT installed. '
      'Run the vault.create_secret() step documented in 20261008000100_cron_jobs_use_vault.sql, '
      'then re-run this migration.';
    RETURN;
  END IF;

  BEGIN PERFORM cron.unschedule('aumrti-history-staging-purge'); EXCEPTION WHEN OTHERS THEN NULL; END;

  PERFORM cron.schedule(
    'aumrti-history-staging-purge',
    '20 * * * *',
    format(
      $sql$SELECT net.http_post(url := %L, headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'aumrti_service_role_key')), body := '{"sweep":true}'::jsonb);$sql$,
      fn_url || '/functions/v1/ai-history-ingest'
    )
  );

  RAISE NOTICE 'Scheduled aumrti-history-staging-purge (hourly).';
END;
$$;
