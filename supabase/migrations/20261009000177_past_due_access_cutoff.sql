-- ────────────────────────────────────────────────────────────────────────────
-- Event-driven payment-failure access cutoff (configurable buffer).
--
-- Before: a hospital in `past_due` (renewal payment failed, Razorpay retrying)
-- was NEVER blocked by the access rule — it only lost access if a separate cron
-- happened to flip it to `suspended` after 7 days, and that cron "demonstrably
-- has not always run". So a failed payment could mean indefinite free access.
--
-- After: `past_due` is blocked once now > past_due_since + buffer, where the
-- buffer is platform_billing_settings.access_grace_days (default 3, set from
-- /platform → Payments). The rule itself is now authoritative — it does not
-- depend on any cron having fired. The webhook stamps/clears past_due_since so
-- the buffer has a durable anchor (not the fragile updated_at it used before).
--
-- SQL mirror of resolveSubscriptionAccess() in src/lib/subscriptionAccess.ts —
-- CHANGE BOTH TOGETHER. Trial grace now also reads the same configurable value.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.hospital_subscriptions
  ADD COLUMN IF NOT EXISTS past_due_since timestamptz;

CREATE OR REPLACE FUNCTION public.subscription_access_blocked(p_hospital_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- One configurable buffer, mirrored on the client (useSubscriptionConfig
  -- reads access_grace_days and passes it to resolveSubscriptionAccess).
  v_grace_days int;
  v_status     text;
  v_trial_ends timestamptz;
  v_past_due   timestamptz;
BEGIN
  IF p_hospital_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT COALESCE(access_grace_days, 3) INTO v_grace_days
    FROM platform_billing_settings
   WHERE id = 1;
  IF v_grace_days IS NULL THEN
    v_grace_days := 3;
  END IF;

  SELECT lower(status), trial_ends_at, past_due_since
    INTO v_status, v_trial_ends, v_past_due
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
    RETURN now() > (v_trial_ends + make_interval(days => v_grace_days));
  END IF;

  IF v_status = 'past_due' THEN
    -- No anchor yet (just transitioned, or a legacy row): allow. The webhook
    -- stamps past_due_since on the halting event, giving the buffer a start.
    IF v_past_due IS NULL THEN
      RETURN false;
    END IF;
    RETURN now() > (v_past_due + make_interval(days => v_grace_days));
  END IF;

  -- 'active' or anything unrecognised → allow.
  RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.subscription_access_blocked(uuid) TO authenticated;

COMMENT ON FUNCTION public.subscription_access_blocked(uuid) IS
  'True when this hospital''s subscription no longer permits writes. SQL mirror of resolveSubscriptionAccess() in src/lib/subscriptionAccess.ts — change both together. Buffer = platform_billing_settings.access_grace_days.';

-- ── Grace-days reader for the client mirror ────────────────────────────────
-- platform_billing_settings is admin-only (it holds secrets), but a hospital's
-- own client needs the buffer value so its read-only UX matches the DB trigger.
-- This SECURITY DEFINER function exposes ONLY the non-sensitive integer.
CREATE OR REPLACE FUNCTION public.get_subscription_grace_days()
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT access_grace_days FROM platform_billing_settings WHERE id = 1), 3);
$$;

GRANT EXECUTE ON FUNCTION public.get_subscription_grace_days() TO authenticated;
