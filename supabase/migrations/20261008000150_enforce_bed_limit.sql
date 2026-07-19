-- ============================================================
-- Enforce the subscription plan's max_beds limit
-- ------------------------------------------------------------
-- Root cause of the "can create more than the plan's beds" bug:
--   check_bed_capacity() returned  allowed = (current < max)  — i.e. "is there
--   room for ONE more bed?". It never considered how many beds an operation was
--   about to create, so creating a ward with 15 beds on a max=10 plan (current 0)
--   passed the check (0 < 10) and inserted all 15. Two paths (bulk ward templates
--   + onboarding Step3) skipped the check entirely.
--
-- Fix:
--   1. check_bed_capacity(p_hospital_id, p_adding) — count-aware pre-check so the
--      UI can warn BEFORE inserting (allowed = current + adding <= max).
--   2. A BEFORE INSERT trigger on beds as the authoritative backstop that blocks
--      the (max+1)th active bed regardless of the code path. In a multi-row INSERT
--      Postgres processes rows one at a time and a BEFORE ROW trigger sees the
--      earlier rows already inserted, so the running count grows correctly and the
--      statement fails the moment it would exceed the plan limit.
--
-- NULL/0 max_beds = unlimited (Enterprise). No trial/active subscription (e.g.
-- during onboarding) = unlimited, matching the client's fail-open behaviour.
-- Existing hospitals already over their limit keep their beds; only NEW beds are
-- blocked.
-- ============================================================

-- ── 1. Count-aware capacity pre-check ────────────────────────
CREATE OR REPLACE FUNCTION public.check_bed_capacity(
  p_hospital_id uuid,
  p_adding      int DEFAULT 1
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_beds  int;
  v_current   int;
  v_plan_slug text;
  v_adding    int := GREATEST(COALESCE(p_adding, 1), 1);
BEGIN
  SELECT sp.max_beds, sp.slug
    INTO v_max_beds, v_plan_slug
    FROM hospital_subscriptions hs
    JOIN subscription_plans sp ON sp.id = hs.plan_id
   WHERE hs.hospital_id = p_hospital_id
     AND hs.status IN ('trial', 'active')
   LIMIT 1;

  SELECT COUNT(*) INTO v_current
    FROM beds
   WHERE hospital_id = p_hospital_id
     AND is_active = true;

  -- No subscription or unlimited plan
  IF v_max_beds IS NULL OR v_max_beds = 0 THEN
    RETURN json_build_object('allowed', true, 'current', v_current, 'max', null, 'plan_slug', v_plan_slug);
  END IF;

  RETURN json_build_object(
    'allowed',    (v_current + v_adding) <= v_max_beds,
    'current',    v_current,
    'max',        v_max_beds,
    'plan_slug',  v_plan_slug
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_bed_capacity(uuid, int) TO authenticated;

-- ── 2. Authoritative backstop trigger ───────────────────────
CREATE OR REPLACE FUNCTION public.enforce_bed_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_beds int;
  v_current  int;
BEGIN
  -- Only active beds count toward the limit; inactive/archived beds are free.
  IF NEW.is_active IS DISTINCT FROM true THEN
    RETURN NEW;
  END IF;

  SELECT sp.max_beds
    INTO v_max_beds
    FROM hospital_subscriptions hs
    JOIN subscription_plans sp ON sp.id = hs.plan_id
   WHERE hs.hospital_id = NEW.hospital_id
     AND hs.status IN ('trial', 'active')
   LIMIT 1;

  -- No subscription (onboarding) or unlimited plan → allow.
  IF v_max_beds IS NULL OR v_max_beds = 0 THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_current
    FROM beds
   WHERE hospital_id = NEW.hospital_id
     AND is_active = true;

  IF v_current >= v_max_beds THEN
    RAISE EXCEPTION
      'Bed limit reached (%/% beds on this subscription plan). Upgrade the plan to add more beds.',
      v_current, v_max_beds
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_bed_limit ON public.beds;
CREATE TRIGGER trg_enforce_bed_limit
  BEFORE INSERT ON public.beds
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_bed_limit();
