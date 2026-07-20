-- ═══════════════════════════════════════════════════════════════════════════
-- Trial-days sync + trial→active conversion handling
--
-- Two long-standing gaps this closes:
--
--  1. trial_ends_at was computed exactly ONCE, at signup (register-hospital).
--     Moving a hospital to a different plan — from the platform Hospital Detail
--     dropdown, from change-subscription-plan, or from the Razorpay webhook —
--     wrote plan_id but left trial_ends_at frozen. A hospital moved from a 30-day
--     plan to a 180-day plan still expired on the original date.
--
--  2. Flipping status to 'active' granted the referrer reward (migration …129)
--     but nothing else: no billing period dates, no referee discount, no event.
--
-- Both are enforced with triggers rather than in app code, deliberately: there
-- are four separate write paths into hospital_subscriptions and they would drift.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- 1. New columns
-- ─────────────────────────────────────────────────────────────

-- Referral bonus days are stored so a later plan change can REBASE the trial
-- (created_at + plan.trial_days + bonus) without losing the perk the referee
-- was promised at signup.
ALTER TABLE public.hospital_subscriptions
  ADD COLUMN IF NOT EXISTS trial_bonus_days int NOT NULL DEFAULT 0;

-- Per-hospital override: when converting, does the paid period start on the
-- conversion date, or only when the trial would have ended (let them keep the
-- remaining trial days they already paid nothing for)?
ALTER TABLE public.hospital_subscriptions
  ADD COLUMN IF NOT EXISTS conversion_period_start_mode text NOT NULL DEFAULT 'conversion_date';

-- Set when a discount has a limited life (e.g. referee's "20% off for 3 months").
-- NULL with a non-zero discount_pct means the discount never expires.
ALTER TABLE public.hospital_subscriptions
  ADD COLUMN IF NOT EXISTS discount_expires_at timestamptz;

-- Audit: when the trial end was last recomputed, and why.
ALTER TABLE public.hospital_subscriptions
  ADD COLUMN IF NOT EXISTS trial_synced_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'hospital_subscriptions_conv_start_mode_check'
    AND   conrelid = 'public.hospital_subscriptions'::regclass
  ) THEN
    ALTER TABLE public.hospital_subscriptions
      ADD CONSTRAINT hospital_subscriptions_conv_start_mode_check
      CHECK (conversion_period_start_mode IN ('conversion_date','trial_end'));
  END IF;
END $$;

-- How many months the referee discount survives after conversion. 0 = forever.
ALTER TABLE public.referral_codes
  ADD COLUMN IF NOT EXISTS referee_discount_months int NOT NULL DEFAULT 0;

-- ─────────────────────────────────────────────────────────────
-- 2. Backfill trial_bonus_days from existing referral redemptions
--    so the first rebase of an already-referred hospital keeps its perk.
-- ─────────────────────────────────────────────────────────────
UPDATE public.hospital_subscriptions hs
   SET trial_bonus_days = COALESCE(rc.referee_trial_extra_days, 0)
  FROM public.referral_redemptions rr
  JOIN public.referral_codes rc ON rc.id = rr.code_id
 WHERE rr.referred_hospital_id = hs.hospital_id
   AND hs.trial_bonus_days = 0
   AND COALESCE(rc.referee_trial_extra_days, 0) > 0;

-- ─────────────────────────────────────────────────────────────
-- 3. Trial rebase on plan change
--
-- Fires only while the hospital is still on trial. Rebases from the
-- subscription's created_at (signup), NOT from today — so changing plans does
-- not silently restart the trial clock, and the date always reflects what the
-- plan config actually says.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_trial_end_on_plan_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trial_days int;
  v_base       timestamptz;
BEGIN
  -- Only when the plan actually changed, and only for trials.
  IF NEW.plan_id IS NOT DISTINCT FROM OLD.plan_id THEN RETURN NEW; END IF;
  IF NEW.status <> 'trial' THEN RETURN NEW; END IF;

  -- An explicit trial_ends_at written in the SAME statement wins — that is the
  -- platform admin manually overriding the date, and the override must not be
  -- clobbered by the plan's default.
  IF NEW.trial_ends_at IS DISTINCT FROM OLD.trial_ends_at THEN RETURN NEW; END IF;

  SELECT trial_days INTO v_trial_days
    FROM public.subscription_plans WHERE id = NEW.plan_id;
  IF v_trial_days IS NULL THEN RETURN NEW; END IF;

  v_base := COALESCE(NEW.created_at, now());

  NEW.trial_ends_at  := v_base + make_interval(days => v_trial_days + COALESCE(NEW.trial_bonus_days, 0));
  NEW.trial_synced_at := now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_trial_end_on_plan_change ON public.hospital_subscriptions;
CREATE TRIGGER trg_sync_trial_end_on_plan_change
  BEFORE UPDATE OF plan_id ON public.hospital_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.sync_trial_end_on_plan_change();

-- ─────────────────────────────────────────────────────────────
-- 4. Manual resync helper — "Resync trial to plan" button on Hospital Detail.
--    Also usable in bulk after an admin edits a plan's trial_days.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resync_trial_end(p_hospital_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new timestamptz;
BEGIN
  IF NOT public.is_aumrti_admin() THEN
    RAISE EXCEPTION 'Only platform admins can resync a trial';
  END IF;

  UPDATE public.hospital_subscriptions hs
     SET trial_ends_at = COALESCE(hs.created_at, now())
                         + make_interval(days => sp.trial_days + COALESCE(hs.trial_bonus_days, 0)),
         trial_synced_at = now(),
         updated_at      = now()
    FROM public.subscription_plans sp
   WHERE hs.plan_id = sp.id
     AND hs.hospital_id = p_hospital_id
     AND hs.status = 'trial'
  RETURNING hs.trial_ends_at INTO v_new;

  RETURN v_new;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resync_trial_end(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 5. Conversion: trial → active
--
-- Sets the billing period, applies the referee's discount for its configured
-- life, and logs the event. Runs BEFORE the referral-reward trigger's AFTER
-- pass (…129), so both fire on the same status flip without interfering.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.apply_subscription_conversion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start  timestamptz;
  rc       public.referral_codes%ROWTYPE;
BEGIN
  IF NEW.status <> 'active' OR OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;
  -- Only a trial converts. active→active or past_due→active (a recovered
  -- payment) must not reset the billing period.
  IF OLD.status <> 'trial' THEN RETURN NEW; END IF;

  -- ── Billing period ──
  IF NEW.conversion_period_start_mode = 'trial_end' AND NEW.trial_ends_at > now() THEN
    v_start := NEW.trial_ends_at;   -- let them ride out the remaining trial
  ELSE
    v_start := now();
  END IF;

  -- Respect a period explicitly written in the same statement (Razorpay webhook
  -- supplies the real cycle dates and those are authoritative).
  IF NEW.current_period_start IS NOT DISTINCT FROM OLD.current_period_start THEN
    NEW.current_period_start := v_start;
    NEW.current_period_end   := v_start + interval '1 month';
  END IF;

  -- ── Referee discount ──
  SELECT rc2.* INTO rc
    FROM public.referral_redemptions rr
    JOIN public.referral_codes rc2 ON rc2.id = rr.code_id
   WHERE rr.referred_hospital_id = NEW.hospital_id
   LIMIT 1;

  IF FOUND AND COALESCE(rc.referee_discount_pct, 0) > 0
     AND COALESCE(NEW.discount_pct, 0) = 0 THEN
    NEW.discount_pct := rc.referee_discount_pct;
    NEW.discount_code_applied := rc.code;
    NEW.discount_expires_at := CASE
      WHEN COALESCE(rc.referee_discount_months, 0) > 0
        THEN v_start + make_interval(months => rc.referee_discount_months)
      ELSE NULL
    END;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_subscription_conversion ON public.hospital_subscriptions;
CREATE TRIGGER trg_apply_subscription_conversion
  BEFORE UPDATE OF status ON public.hospital_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.apply_subscription_conversion();

-- ─────────────────────────────────────────────────────────────
-- 6. Conversion event log (AFTER, so it records the final row)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_subscription_conversion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'active' AND OLD.status = 'trial' THEN
    INSERT INTO public.subscription_events (
      hospital_id, event_type, old_status, new_status, old_plan_id, new_plan_id, metadata
    ) VALUES (
      NEW.hospital_id, 'converted', OLD.status, NEW.status, OLD.plan_id, NEW.plan_id,
      jsonb_build_object(
        'period_start',    NEW.current_period_start,
        'period_end',      NEW.current_period_end,
        'discount_pct',    NEW.discount_pct,
        'discount_expires_at', NEW.discount_expires_at,
        'trial_ended_at',  NEW.trial_ends_at,
        'converted_early', (NEW.trial_ends_at > now())
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_subscription_conversion ON public.hospital_subscriptions;
CREATE TRIGGER trg_log_subscription_conversion
  AFTER UPDATE OF status ON public.hospital_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.log_subscription_conversion();

-- ─────────────────────────────────────────────────────────────
-- 7. Expire time-limited discounts (called by trial-lifecycle-cron)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.expire_lapsed_discounts()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count int;
BEGIN
  UPDATE public.hospital_subscriptions
     SET discount_pct = 0,
         discount_code_applied = NULL,
         discount_expires_at = NULL,
         updated_at = now()
   WHERE discount_expires_at IS NOT NULL
     AND discount_expires_at <= now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
