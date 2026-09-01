-- Phase 0.5 — patient_portal_sessions: stop anon reading OTPs and session tokens.
--
-- ROOT CAUSE (RC-1 + RC-2). The table holds phone, otp_code, session_token, patient_id and
-- carried SIX policies, two pairs of which contradicted each other — two generation sessions
-- solving one problem with incompatible assumptions, both left installed:
--
--   anon_select_active_sessions  [SELECT] anon USING (last_active > now() - 24h)
--        -> anon could read otp_code AND session_token for EVERY session active in 24 hours,
--           across every hospital. Direct account takeover: read the OTP, or steal the token.
--   portal_sessions_anon_select  [SELECT] anon USING (otp_verified AND session_token IS NOT NULL)
--        -> anon could read the session_token of every verified session.
--   anon_update_active_sessions  [UPDATE] anon USING (last_active > now() - 24h) WITH CHECK (true)
--        -> anon could rewrite ANY column of ANY recent session, including already-verified ones.
--   portal_sessions_anon_update  [UPDATE] anon USING (otp_verified = false OR NULL) WITH CHECK (true)
--        -> the deliberately narrower sibling. Permissive policies are OR-ed, so the broad one
--           above always won and this restriction never took effect.
--
-- HOW THE LOGIN FLOW ACTUALLY WORKS (src/pages/portal/PortalLogin.tsx) — verified before writing:
--   1. INSERT a session carrying otp_code and otp_expires_at (now + 10 min),
--      then .select("id") to capture the row id.
--   2. The OTP is compared CLIENT-SIDE against React state (`code !== generatedOtp`).
--      The database is never asked to validate it — so no anon SELECT of otp_code is required.
--   3. completeLogin() UPDATEs the row: otp_verified = true, session_token, patient_id.
--
-- So the flow needs exactly: INSERT, SELECT of `id` on the row just created, and an UPDATE that
-- carries otp_verified from false to true. Nothing more. This migration grants exactly that.
--
-- FUNCTIONALITY PRESERVED:
--   * .insert().select("id") still works — narrow SELECT policy below matches a fresh row
--     (otp_verified defaults to false, otp_expires_at is set to now + 10 min by the caller),
--     and anon retains column-level SELECT on `id`.
--   * completeLogin() still works — the UPDATE policy's USING matches the pre-update row
--     (otp_verified = false); WITH CHECK deliberately permits the false -> true transition,
--     which is the whole point of verification, while requiring the session still be recent.
--   * anon can no longer read otp_code, session_token, phone or patient_id, and can no longer
--     modify phone, hospital_id or otp_code at all (column-level UPDATE grant below).

BEGIN;

-- Remove the two over-broad readers and the over-broad writer.
DROP POLICY IF EXISTS anon_select_active_sessions ON public.patient_portal_sessions;
DROP POLICY IF EXISTS portal_sessions_anon_select ON public.patient_portal_sessions;
DROP POLICY IF EXISTS anon_update_active_sessions ON public.patient_portal_sessions;

-- Minimal read: only a live, not-yet-verified session, and (via the column grant below) only
-- its id. This exists solely to let the INSERT ... RETURNING id round-trip succeed.
CREATE POLICY portal_sessions_anon_select_pending ON public.patient_portal_sessions
  AS PERMISSIVE FOR SELECT TO anon
  USING (
    otp_verified IS NOT TRUE
    AND otp_expires_at IS NOT NULL
    AND otp_expires_at > now()
  );

-- Replace the surviving UPDATE policy with one that has a real WITH CHECK.
DROP POLICY IF EXISTS portal_sessions_anon_update ON public.patient_portal_sessions;
CREATE POLICY portal_sessions_anon_update ON public.patient_portal_sessions
  AS PERMISSIVE FOR UPDATE TO anon
  USING (
    otp_verified IS NOT TRUE
    AND otp_expires_at IS NOT NULL
    AND otp_expires_at > now()
  )
  WITH CHECK (
    -- Permits the verification transition (false -> true) but not the revival of a session
    -- whose OTP window has closed.
    otp_expires_at IS NOT NULL
    AND otp_expires_at > now() - interval '1 hour'
  );

-- Column-level privileges: the correct mechanism for "anon may touch these fields only".
REVOKE SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.patient_portal_sessions FROM anon;

GRANT SELECT (id) ON public.patient_portal_sessions TO anon;
GRANT UPDATE (otp_verified, session_token, patient_id, last_active)
  ON public.patient_portal_sessions TO anon;
-- INSERT is left intact: PortalLogin must be able to create the session row.

COMMIT;
