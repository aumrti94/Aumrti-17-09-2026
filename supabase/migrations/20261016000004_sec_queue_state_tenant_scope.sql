-- Phase 0.4 — queue_state: stop publishing patient names to unauthenticated callers.
--
-- ROOT CAUSE (RC-1): "Anyone can read queue_state" [SELECT] roles={public} USING (true) over a
-- table containing current_patient_name. The `public` role covers every role including `anon`,
-- and `anon` holds a SELECT grant — so any holder of the publishable anon key could read the
-- currently-called patient for EVERY hospital on the platform, with no tenant filter.
--
-- Two corrections to the original audit finding, established while verifying this fix:
--
--  1. The names are PARTIALLY masked, not plaintext. TokenQueue.tsx:298 writes
--     "Ramesh Kumar Sharma" -> "R. Kumar Sharma" (first initial only, SURNAME RETAINED).
--     Still identifying when joined with hospital_id, doctor_id and called_at, so still a
--     finding — but less severe than "patient names in the clear".
--
--  2. current_patient_name is WRITE-ONLY. It is written at TokenQueue.tsx:316 and read by
--     NOTHING: AdvancedQueueDisplayPage uses current_token_number, and TVDisplayPage computes
--     its own masked name from opd_tokens. Verified by full-repo grep.
--
-- FUNCTIONALITY PRESERVED — the /tv and /tv-display routes are public (no AuthGuard), but the
-- board cannot render without opd_tokens, whose policies are all roles={authenticated}. The TV
-- therefore already requires a logged-in session, and anon access to queue_state bought nothing.
-- Restricting it to authenticated tenant reads changes no working behaviour.
--
-- The sibling policy "Hospital staff manage queue_state" was already correctly tenant-scoped,
-- which shows the pattern was known and simply not applied to the read path.

BEGIN;

DROP POLICY IF EXISTS "Anyone can read queue_state" ON public.queue_state;

CREATE POLICY queue_state_tenant_read ON public.queue_state
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    hospital_id = (SELECT public.get_user_hospital_id())
    OR (SELECT public.is_aumrti_admin())
  );

REVOKE ALL ON public.queue_state FROM anon;

-- Retire the write-only PHI column's contents. The column itself is retained: dropping it is a
-- separate, riskier change and TokenQueue.tsx is updated in the same commit to stop writing it.
UPDATE public.queue_state SET current_patient_name = NULL WHERE current_patient_name IS NOT NULL;

COMMENT ON COLUMN public.queue_state.current_patient_name IS
  'DEPRECATED 2026-10-16 — was written by TokenQueue but never read. Retained as NULL for '
  'backward compatibility; do not repopulate. Patient identity must not appear on this table, '
  'which feeds the public TV display surface.';

COMMIT;
