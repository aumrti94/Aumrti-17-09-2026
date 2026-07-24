-- ============================================================
-- Enforce expired / suspended subscriptions (read-only lockout)
-- ------------------------------------------------------------
-- Root cause of "trial period expired but I can still do the work":
--   The expiry was purely cosmetic. useSubscriptionConfig computed isExpired /
--   isSuspended correctly, but the only consumers were TrialBanner and the Plan &
--   Billing page — both display-only. The one enforcement point, <ModuleGate>, reads
--   `enabledModules`, which is derived from plan_features + hospital_feature_overrides
--   and never looks at `status`. Nothing on the server checked subscription status
--   before ANY clinical or financial write. So an expired hospital kept registering
--   patients, running consultations and collecting cash, with a dismissable red banner
--   as the only consequence.
--
-- Fix (this file is the authoritative half; the client fetch guard in
-- src/lib/subscriptionLock.ts is only there to turn the failure into a readable message):
--   1. subscription_access_blocked(hospital_id) — the rule, as a SQL MIRROR of
--      resolveSubscriptionAccess() in src/lib/subscriptionAccess.ts. CHANGE BOTH TOGETHER
--      or the client and the database will disagree about who may write.
--   2. enforce_subscription_access() — a STATEMENT-level BEFORE INSERT/UPDATE/DELETE
--      trigger attached to every public table carrying a hospital_id, minus an explicit
--      exclusion list. Statement-level (not row-level) so a 500-row insert costs one
--      lookup, not 500.
--
-- Read-only, NOT a lockout: SELECT is untouched. A live hospital must never lose the
-- ability to read its own medical records over a billing dispute.
--
-- Deliberate design notes
-- -----------------------
-- * DATE-DRIVEN for trials, not status-driven. trial-lifecycle-cron is what flips an
--   expired trial to 'suspended', and it demonstrably has not always run (the reporting
--   tenant was still status='trial' weeks past trial_ends_at). An enforcement rule that
--   depends on a cron having fired is not an enforcement rule.
-- * 3-day grace after trial_ends_at, so a hospital does not go read-only mid-shift over
--   a payment that is one day late.
-- * 'past_due' is NOT blocked — the existing dunning path (dunning-processor →
--   trial-lifecycle-cron) suspends it after 7 days, and suspension blocks.
-- * The trigger scopes by the CALLER's hospital (users.auth_user_id = auth.uid()), not
--   by the row's hospital_id. RLS already guarantees they match, and it makes the check
--   a single indexed lookup that a statement-level trigger can do without touching rows.
-- * Bypasses: auth.uid() IS NULL (service role — edge functions, cron, migrations) and
--   is_aumrti_admin() (the platform CEO).
-- * IMPERSONATION IS AFFECTED, intentionally. startImpersonation() swaps to a real
--   hospital-user session (src/lib/impersonation.ts), so is_aumrti_admin() is false and a
--   support admin sees the same read-only tenant the staff see.
-- * Fail-open throughout: no subscription row (onboarding), no users row, or an
--   unrecognised status all ALLOW.
-- ============================================================

-- ── 1. The rule ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.subscription_access_blocked(p_hospital_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Mirror of SUBSCRIPTION_GRACE_DAYS in src/lib/subscriptionAccess.ts
  c_grace_days constant int := 3;
  v_status     text;
  v_trial_ends timestamptz;
BEGIN
  IF p_hospital_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT lower(status), trial_ends_at
    INTO v_status, v_trial_ends
    FROM hospital_subscriptions
   WHERE hospital_id = p_hospital_id
   LIMIT 1;

  -- No subscription row at all (onboarding) → allow.
  IF v_status IS NULL THEN
    RETURN false;
  END IF;

  IF v_status IN ('suspended', 'cancelled') THEN
    RETURN true;
  END IF;

  IF v_status = 'trial' THEN
    -- Open-ended trial (no end date) never auto-blocks.
    IF v_trial_ends IS NULL THEN
      RETURN false;
    END IF;
    RETURN now() > (v_trial_ends + make_interval(days => c_grace_days));
  END IF;

  -- 'active', 'past_due', or anything unrecognised → allow.
  RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.subscription_access_blocked(uuid) TO authenticated;

COMMENT ON FUNCTION public.subscription_access_blocked(uuid) IS
  'True when this hospital''s subscription no longer permits writes. SQL mirror of resolveSubscriptionAccess() in src/lib/subscriptionAccess.ts — change both together.';


-- ── 2. Statement-level write guard ───────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_subscription_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_hospital uuid;
  v_memo     text;
BEGIN
  -- Service role / cron / migrations run without a JWT → never blocked.
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  -- Transaction-local memo: a discharge or bill save fires dozens of statements across
  -- many tables, and the answer cannot change mid-transaction.
  v_memo := current_setting('app.subscription_blocked', true);

  IF v_memo IS NULL OR v_memo = '' THEN
    IF public.is_aumrti_admin() THEN
      v_memo := 'f';
    ELSE
      SELECT hospital_id INTO v_hospital
        FROM users
       WHERE auth_user_id = v_uid
       LIMIT 1;

      -- Unknown user or no hospital → fail open; other guards own that case.
      IF v_hospital IS NULL THEN
        v_memo := 'f';
      ELSE
        v_memo := CASE WHEN public.subscription_access_blocked(v_hospital) THEN 't' ELSE 'f' END;
      END IF;
    END IF;

    PERFORM set_config('app.subscription_blocked', v_memo, true);  -- true = transaction-local
  END IF;

  IF v_memo = 't' THEN
    RAISE EXCEPTION
      'Your subscription is inactive — the system is read-only. Contact support to restore full access.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;  -- statement-level BEFORE trigger: return value is ignored
END;
$$;


-- ── 3. Attach to every hospital-scoped table, minus exclusions ─
-- Driven off information_schema so future tables are covered the moment they are created
-- with a hospital_id. Re-running this migration re-syncs coverage.
DO $$
DECLARE
  r record;
  -- Login, telemetry, dunning, support and the pay-us path must keep working while
  -- locked, or the hospital cannot get itself out of the lock from inside the app.
  excluded text[] := ARRAY[
    'users', 'hospitals',
    'hospital_subscriptions', 'hospital_feature_overrides', 'hospital_pricing_overrides',
    'hospital_module_entitlements',
    'subscription_events', 'subscription_invoices',
    'audit_log', 'admin_audit_log',
    'notification_log', 'notification_queue',
    'email_notifications', 'sms_notifications', 'push_notifications', 'fcm_tokens',
    'user_trusted_devices', 'user_tour_progress', 'user_permission_overrides',
    'product_analytics_events', 'entitlement_fail_open_events',
    'platform_support_tickets', 'onboarding_tasks',
    'dunning_attempts', 'referral_redemptions', 'razorpay_webhook_log',
    'signup_otp_verifications', 'hospital_signup_consents'
  ];
  v_count int := 0;
BEGIN
  FOR r IN
    SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'                      -- ordinary tables only (no views/partitions)
       AND a.attname = 'hospital_id'
       AND a.attnum > 0
       AND NOT a.attisdropped
       AND NOT (c.relname = ANY(excluded))
     ORDER BY c.relname
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_enforce_subscription_access ON public.%I', r.table_name);
    EXECUTE format(
      'CREATE TRIGGER trg_enforce_subscription_access
         BEFORE INSERT OR UPDATE OR DELETE ON public.%I
         FOR EACH STATEMENT EXECUTE FUNCTION public.enforce_subscription_access()',
      r.table_name
    );
    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'enforce_subscription_access: guarding % hospital-scoped tables', v_count;
END $$;
