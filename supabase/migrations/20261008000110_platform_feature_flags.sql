-- ============================================================
-- Feature-flag / experiment console for the platform team (Sprint 5)
-- ============================================================
-- Explicitly NOT the same thing as Anita's entitlement system
-- (plan_features/hospital_feature_overrides/product_modes — what a hospital
-- is PAYING for). This is staged-rollout tooling for the platform team's
-- OWN releases — "ship this new UI to 25% of hospitals and watch for
-- errors before going to 100%" — independent of billing/plan.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.platform_feature_flags (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key                 text NOT NULL UNIQUE,
  description         text,
  is_enabled          boolean NOT NULL DEFAULT false,
  rollout_percentage  integer NOT NULL DEFAULT 0 CHECK (rollout_percentage BETWEEN 0 AND 100),
  created_by          uuid REFERENCES auth.users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.platform_feature_flag_overrides (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_id      uuid NOT NULL REFERENCES public.platform_feature_flags(id) ON DELETE CASCADE,
  hospital_id  uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  is_enabled   boolean NOT NULL,
  reason       text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (flag_id, hospital_id)
);

ALTER TABLE public.platform_feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_feature_flag_overrides ENABLE ROW LEVEL SECURITY;

-- Flag definitions carry no sensitive info (a key + description + rollout %)
-- — any authenticated user's client needs to read them to resolve its own
-- flag state. Only aumrti_admins can create/edit/delete.
DROP POLICY IF EXISTS "platform_feature_flags_read_all" ON public.platform_feature_flags;
CREATE POLICY "platform_feature_flags_read_all" ON public.platform_feature_flags
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "platform_feature_flags_admin_write" ON public.platform_feature_flags;
CREATE POLICY "platform_feature_flags_admin_write" ON public.platform_feature_flags
  FOR ALL TO authenticated USING (public.is_aumrti_admin()) WITH CHECK (public.is_aumrti_admin());

-- Overrides are narrower — a hospital can see its own override (to know why
-- a flag behaves differently for them) but not other hospitals' overrides.
DROP POLICY IF EXISTS "platform_feature_flag_overrides_read" ON public.platform_feature_flag_overrides;
CREATE POLICY "platform_feature_flag_overrides_read" ON public.platform_feature_flag_overrides
  FOR SELECT TO authenticated USING (hospital_id = public.get_user_hospital_id() OR public.is_aumrti_admin());

DROP POLICY IF EXISTS "platform_feature_flag_overrides_admin_write" ON public.platform_feature_flag_overrides;
CREATE POLICY "platform_feature_flag_overrides_admin_write" ON public.platform_feature_flag_overrides
  FOR ALL TO authenticated USING (public.is_aumrti_admin()) WITH CHECK (public.is_aumrti_admin());

-- Single source of truth for "is this flag on for this hospital" — override
-- wins if one exists, else the master switch + a deterministic percentage
-- bucket (hashtext of key+hospital_id, so a hospital never flip-flops
-- between calls at the same rollout_percentage).
CREATE OR REPLACE FUNCTION public.resolve_feature_flag(p_key text, p_hospital_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_flag record;
  v_override record;
  v_bucket int;
BEGIN
  SELECT * INTO v_flag FROM public.platform_feature_flags WHERE key = p_key;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT * INTO v_override FROM public.platform_feature_flag_overrides
    WHERE flag_id = v_flag.id AND hospital_id = p_hospital_id;
  IF FOUND THEN
    RETURN v_override.is_enabled;
  END IF;

  IF NOT v_flag.is_enabled THEN
    RETURN false;
  END IF;
  IF v_flag.rollout_percentage >= 100 THEN
    RETURN true;
  END IF;
  IF v_flag.rollout_percentage <= 0 THEN
    RETURN false;
  END IF;

  v_bucket := abs(hashtext(p_key || p_hospital_id::text)) % 100;
  RETURN v_bucket < v_flag.rollout_percentage;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_feature_flag(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_feature_flag(text, uuid) TO authenticated;
