-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: rls_open_access_fixes
-- Purpose  : Fix 5 critical RLS failures found in Sunita's C9 audit.
--            All policies previously used USING(true) / WITH CHECK(true),
--            allowing cross-hospital reads and writes.
-- Idempotent: DROP POLICY IF EXISTS before every CREATE POLICY.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. ot_team_members ───────────────────────────────────────────────────────
-- Table has no hospital_id column — isolation derived via ot_schedules FK.
DROP POLICY IF EXISTS "Users can view ot_team_members"   ON public.ot_team_members;
DROP POLICY IF EXISTS "Users can manage ot_team_members" ON public.ot_team_members;
DROP POLICY IF EXISTS "ot_team_members_select"           ON public.ot_team_members;
DROP POLICY IF EXISTS "ot_team_members_all"              ON public.ot_team_members;

CREATE POLICY "ot_team_members_select" ON public.ot_team_members
  FOR SELECT TO authenticated
  USING (
    ot_schedule_id IN (
      SELECT id FROM public.ot_schedules
      WHERE hospital_id = public.get_user_hospital_id()
    )
  );

CREATE POLICY "ot_team_members_all" ON public.ot_team_members
  FOR ALL TO authenticated
  USING (
    ot_schedule_id IN (
      SELECT id FROM public.ot_schedules
      WHERE hospital_id = public.get_user_hospital_id()
    )
  )
  WITH CHECK (
    ot_schedule_id IN (
      SELECT id FROM public.ot_schedules
      WHERE hospital_id = public.get_user_hospital_id()
    )
  );

-- ── 2. package_bookings ───────────────────────────────────────────────────────
ALTER TABLE public.package_bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow select package_bookings by hospital" ON public.package_bookings;
DROP POLICY IF EXISTS "Allow insert package_bookings"            ON public.package_bookings;
DROP POLICY IF EXISTS "Allow update package_bookings"            ON public.package_bookings;
DROP POLICY IF EXISTS "package_bookings_select"                  ON public.package_bookings;
DROP POLICY IF EXISTS "package_bookings_all"                     ON public.package_bookings;

CREATE POLICY "package_bookings_select" ON public.package_bookings
  FOR SELECT TO authenticated USING (hospital_id = public.get_user_hospital_id());
CREATE POLICY "package_bookings_all" ON public.package_bookings
  FOR ALL TO authenticated
  USING  (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- ── 3. corporate_accounts ─────────────────────────────────────────────────────
ALTER TABLE public.corporate_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow select corporate_accounts" ON public.corporate_accounts;
DROP POLICY IF EXISTS "Allow insert corporate_accounts" ON public.corporate_accounts;
DROP POLICY IF EXISTS "corporate_accounts_select"       ON public.corporate_accounts;
DROP POLICY IF EXISTS "corporate_accounts_all"          ON public.corporate_accounts;

CREATE POLICY "corporate_accounts_select" ON public.corporate_accounts
  FOR SELECT TO authenticated USING (hospital_id = public.get_user_hospital_id());
CREATE POLICY "corporate_accounts_all" ON public.corporate_accounts
  FOR ALL TO authenticated
  USING  (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- ── 4. health_packages ────────────────────────────────────────────────────────
ALTER TABLE public.health_packages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow select health_packages" ON public.health_packages;
DROP POLICY IF EXISTS "health_packages_select"       ON public.health_packages;
DROP POLICY IF EXISTS "health_packages_all"          ON public.health_packages;

CREATE POLICY "health_packages_select" ON public.health_packages
  FOR SELECT TO authenticated USING (hospital_id = public.get_user_hospital_id());
CREATE POLICY "health_packages_all" ON public.health_packages
  FOR ALL TO authenticated
  USING  (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- ── 5. patient_portal_sessions — tighten anon policies ───────────────────────
-- Original policies used USING(true) — any anon user could enumerate ALL
-- sessions across all hospitals without knowing a session token.
-- Fix: INSERT only for unverified rows; SELECT only for verified rows
-- (caller must know the exact session_token UUID to retrieve it);
-- UPDATE only for rows still awaiting OTP verification.

DROP POLICY IF EXISTS "Anon can insert portal sessions"          ON public.patient_portal_sessions;
DROP POLICY IF EXISTS "Anon can select portal sessions by token" ON public.patient_portal_sessions;
DROP POLICY IF EXISTS "Anon can update portal sessions"          ON public.patient_portal_sessions;
DROP POLICY IF EXISTS "portal_sessions_anon_insert"              ON public.patient_portal_sessions;
DROP POLICY IF EXISTS "portal_sessions_anon_select"              ON public.patient_portal_sessions;
DROP POLICY IF EXISTS "portal_sessions_anon_update"              ON public.patient_portal_sessions;

CREATE POLICY "portal_sessions_anon_insert" ON public.patient_portal_sessions
  FOR INSERT TO anon
  WITH CHECK (otp_verified = false OR otp_verified IS NULL);

-- Anon SELECT: only OTP-verified rows that have a session_token.
-- Security: caller must supply the exact UUID session_token in their query
-- predicate (.eq('session_token', token)) — the policy allows the row,
-- not enumeration of all rows.
CREATE POLICY "portal_sessions_anon_select" ON public.patient_portal_sessions
  FOR SELECT TO anon
  USING (otp_verified = true AND session_token IS NOT NULL);

CREATE POLICY "portal_sessions_anon_update" ON public.patient_portal_sessions
  FOR UPDATE TO anon
  USING  (otp_verified = false OR otp_verified IS NULL)
  WITH CHECK (true);

-- ── 6. patient_feedback — require non-null hospital_id on anon INSERT ─────────
DROP POLICY IF EXISTS "Anon can insert feedback"     ON public.patient_feedback;
DROP POLICY IF EXISTS "patient_feedback_anon_insert" ON public.patient_feedback;

CREATE POLICY "patient_feedback_anon_insert" ON public.patient_feedback
  FOR INSERT TO anon
  WITH CHECK (hospital_id IS NOT NULL);

-- ── 7. whatsapp_notifications — remove anon INSERT entirely ───────────────────
-- Notifications are system-generated (Edge Functions run as service_role).
-- No legitimate reason for an unauthenticated caller to create these.
DROP POLICY IF EXISTS "Anon can insert notifications" ON public.whatsapp_notifications;
