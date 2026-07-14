-- Referral program: marketing partners, sales reps, and hospital-to-hospital referrals.
-- Unified engine (one code table, owner_type discriminator) + signup->conversion funnel + two-sided
-- rewards. Mirrors the discount_codes / is_aumrti_admin() conventions. Rewards are RECORDED here
-- (source of truth) and surfaced in the UIs; auto-crediting into invoices is intentionally out of
-- scope. See plan.

-- ─────────────────────────────────────────────────────────────
-- 1. referral_partners  (marketing partners & sales reps; platform-managed, no login)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.referral_partners (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_type   text        NOT NULL DEFAULT 'partner',   -- 'partner' | 'rep'
  name           text        NOT NULL,
  email          text,
  phone          text,
  commission_pct numeric(5,2) NOT NULL DEFAULT 0,          -- % of first payment (partner/rep)
  notes          text,
  is_active      boolean     NOT NULL DEFAULT true,
  created_by     uuid        REFERENCES auth.users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.referral_partners ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────
-- 2. referral_codes  (unified; one of partner_id / hospital_id populated per owner_type)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.referral_codes (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                   text        NOT NULL,
  owner_type             text        NOT NULL DEFAULT 'partner',  -- 'partner' | 'rep' | 'hospital'
  partner_id             uuid        REFERENCES public.referral_partners(id) ON DELETE CASCADE,
  hospital_id            uuid        REFERENCES public.hospitals(id)         ON DELETE CASCADE,
  -- Referee (new hospital) perk
  referee_discount_pct     numeric(5,2) NOT NULL DEFAULT 0,
  referee_discount_months  int          NOT NULL DEFAULT 0,
  referee_trial_extra_days int          NOT NULL DEFAULT 0,
  -- Referrer reward (granted on conversion)
  referrer_reward_type   text        NOT NULL DEFAULT 'none',     -- 'free_month'|'credit'|'commission'|'none'
  referrer_reward_value  numeric(10,2) NOT NULL DEFAULT 0,        -- months / ₹ credit / commission %
  valid_from             timestamptz NOT NULL DEFAULT now(),
  valid_until            timestamptz,
  max_uses               integer,
  used_count             integer     NOT NULL DEFAULT 0,
  is_active              boolean     NOT NULL DEFAULT true,
  created_by             uuid        REFERENCES auth.users(id),
  created_at             timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'referral_codes_code_key' AND conrelid = 'public.referral_codes'::regclass
  ) THEN
    ALTER TABLE public.referral_codes ADD CONSTRAINT referral_codes_code_key UNIQUE (code);
  END IF;
END $$;

-- A hospital has at most one referral code.
CREATE UNIQUE INDEX IF NOT EXISTS referral_codes_one_per_hospital
  ON public.referral_codes (hospital_id) WHERE owner_type = 'hospital';
CREATE INDEX IF NOT EXISTS idx_referral_codes_code_active
  ON public.referral_codes (code) WHERE is_active;

ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────
-- 3. referral_redemptions  (signup -> conversion funnel + reward accounting)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.referral_redemptions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_id              uuid NOT NULL REFERENCES public.referral_codes(id) ON DELETE CASCADE,
  code_text            text NOT NULL,
  referred_hospital_id uuid REFERENCES public.hospitals(id) ON DELETE SET NULL,
  status               text NOT NULL DEFAULT 'signed_up',   -- 'signed_up' | 'converted' | 'expired'
  referee_discount_pct numeric(5,2) NOT NULL DEFAULT 0,
  signed_up_at         timestamptz NOT NULL DEFAULT now(),
  converted_at         timestamptz,
  -- Referrer reward accounting
  reward_type          text NOT NULL DEFAULT 'none',
  reward_value         numeric(10,2) NOT NULL DEFAULT 0,
  reward_status        text NOT NULL DEFAULT 'pending',     -- 'pending' | 'granted' | 'void'
  reward_granted_at    timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- A hospital can be referred at most once.
CREATE UNIQUE INDEX IF NOT EXISTS referral_redemptions_one_per_hospital
  ON public.referral_redemptions (referred_hospital_id) WHERE referred_hospital_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_referral_redemptions_code ON public.referral_redemptions (code_id);

ALTER TABLE public.referral_redemptions ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────
-- 4. hospitals.referred_by_code_id  (which code referred this hospital)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.hospitals
  ADD COLUMN IF NOT EXISTS referred_by_code_id uuid REFERENCES public.referral_codes(id);

-- ─────────────────────────────────────────────────────────────
-- 5. RLS policies
-- ─────────────────────────────────────────────────────────────
-- referral_partners: platform-admin only
DROP POLICY IF EXISTS "referral_partners_aumrti_all" ON public.referral_partners;
CREATE POLICY "referral_partners_aumrti_all"
  ON public.referral_partners FOR ALL TO authenticated
  USING (public.is_aumrti_admin()) WITH CHECK (public.is_aumrti_admin());

-- referral_codes: platform admin full access; a hospital may read its own code row
DROP POLICY IF EXISTS "referral_codes_aumrti_all"  ON public.referral_codes;
DROP POLICY IF EXISTS "referral_codes_own_read"    ON public.referral_codes;
CREATE POLICY "referral_codes_aumrti_all"
  ON public.referral_codes FOR ALL TO authenticated
  USING (public.is_aumrti_admin()) WITH CHECK (public.is_aumrti_admin());
CREATE POLICY "referral_codes_own_read"
  ON public.referral_codes FOR SELECT TO authenticated
  USING (owner_type = 'hospital' AND hospital_id = public.get_user_hospital_id());

-- referral_redemptions: platform admin full access; a hospital may read redemptions of its own code
DROP POLICY IF EXISTS "referral_redemptions_aumrti_all" ON public.referral_redemptions;
DROP POLICY IF EXISTS "referral_redemptions_own_read"   ON public.referral_redemptions;
CREATE POLICY "referral_redemptions_aumrti_all"
  ON public.referral_redemptions FOR ALL TO authenticated
  USING (public.is_aumrti_admin()) WITH CHECK (public.is_aumrti_admin());
CREATE POLICY "referral_redemptions_own_read"
  ON public.referral_redemptions FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.referral_codes rc
    WHERE rc.id = referral_redemptions.code_id
      AND rc.owner_type = 'hospital'
      AND rc.hospital_id = public.get_user_hospital_id()
  ));

-- ─────────────────────────────────────────────────────────────
-- 6. RPCs
-- ─────────────────────────────────────────────────────────────

-- Public: validate a code for the /register form (non-sensitive fields only).
CREATE OR REPLACE FUNCTION public.validate_referral_code(p_code text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r public.referral_codes%ROWTYPE;
BEGIN
  IF p_code IS NULL OR btrim(p_code) = '' THEN
    RETURN json_build_object('valid', false, 'message', 'No code');
  END IF;

  SELECT * INTO r FROM public.referral_codes
   WHERE upper(code) = upper(btrim(p_code)) AND is_active
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN json_build_object('valid', false, 'message', 'Code not recognised');
  END IF;
  IF r.valid_until IS NOT NULL AND r.valid_until < now() THEN
    RETURN json_build_object('valid', false, 'message', 'Code expired');
  END IF;
  IF r.max_uses IS NOT NULL AND r.used_count >= r.max_uses THEN
    RETURN json_build_object('valid', false, 'message', 'Code fully redeemed');
  END IF;

  RETURN json_build_object(
    'valid', true,
    'owner_type', r.owner_type,
    'referee_discount_pct', r.referee_discount_pct,
    'referee_trial_extra_days', r.referee_trial_extra_days,
    'message', 'Referral applied'
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.validate_referral_code(text) TO anon, authenticated;

-- Get (or lazily create) the calling hospital's own referral code.
CREATE OR REPLACE FUNCTION public.get_or_create_hospital_referral_code(p_hospital_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code   text;
  v_slug   text;
  v_try    int := 0;
BEGIN
  IF p_hospital_id IS DISTINCT FROM public.get_user_hospital_id() THEN
    RAISE EXCEPTION 'not authorized for this hospital';
  END IF;

  SELECT code INTO v_code FROM public.referral_codes
   WHERE owner_type = 'hospital' AND hospital_id = p_hospital_id LIMIT 1;
  IF FOUND THEN
    RETURN json_build_object('code', v_code);
  END IF;

  -- Build a short slug from the hospital name (letters/digits, upper, max 6).
  SELECT upper(substring(regexp_replace(coalesce(name, 'HOSP'), '[^a-zA-Z0-9]', '', 'g') FROM 1 FOR 6))
    INTO v_slug FROM public.hospitals WHERE id = p_hospital_id;
  IF v_slug IS NULL OR v_slug = '' THEN v_slug := 'HOSP'; END IF;

  LOOP
    v_try := v_try + 1;
    v_code := v_slug || lpad((floor(random() * 10000))::int::text, 4, '0');
    BEGIN
      INSERT INTO public.referral_codes (
        code, owner_type, hospital_id,
        referee_trial_extra_days, referrer_reward_type, referrer_reward_value
      ) VALUES (
        v_code, 'hospital', p_hospital_id,
        14, 'free_month', 1          -- platform defaults for hospital-to-hospital referrals
      );
      RETURN json_build_object('code', v_code);
    EXCEPTION WHEN unique_violation THEN
      IF v_try >= 10 THEN RAISE; END IF;   -- retry on rare code collision
    END;
  END LOOP;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_or_create_hospital_referral_code(uuid) TO authenticated;

-- Funnel stats for the calling hospital's own code.
CREATE OR REPLACE FUNCTION public.get_referral_stats(p_hospital_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_signed   int := 0;
  v_converted int := 0;
  v_reward   numeric := 0;
BEGIN
  IF p_hospital_id IS DISTINCT FROM public.get_user_hospital_id() THEN
    RAISE EXCEPTION 'not authorized for this hospital';
  END IF;

  SELECT
    count(*),
    count(*) FILTER (WHERE rr.status = 'converted'),
    coalesce(sum(rr.reward_value) FILTER (WHERE rr.reward_status = 'granted'), 0)
  INTO v_signed, v_converted, v_reward
  FROM public.referral_redemptions rr
  JOIN public.referral_codes rc ON rc.id = rr.code_id
  WHERE rc.owner_type = 'hospital' AND rc.hospital_id = p_hospital_id;

  RETURN json_build_object('signed_up', v_signed, 'converted', v_converted, 'reward_earned', v_reward);
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_referral_stats(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 7. Conversion trigger: trial -> active grants the referrer reward
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.apply_referral_conversion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rr   public.referral_redemptions%ROWTYPE;
  rc   public.referral_codes%ROWTYPE;
BEGIN
  -- Only on transition into 'active'.
  IF NEW.status <> 'active' OR OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  SELECT * INTO rr FROM public.referral_redemptions
   WHERE referred_hospital_id = NEW.hospital_id AND status <> 'converted'
   LIMIT 1;
  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT * INTO rc FROM public.referral_codes WHERE id = rr.code_id;

  -- Self-referral guard: a hospital referring itself earns nothing.
  IF rc.owner_type = 'hospital' AND rc.hospital_id = NEW.hospital_id THEN
    UPDATE public.referral_redemptions
       SET status = 'converted', converted_at = now(), reward_status = 'void'
     WHERE id = rr.id;
    RETURN NEW;
  END IF;

  UPDATE public.referral_redemptions
     SET status = 'converted',
         converted_at = now(),
         reward_type = rc.referrer_reward_type,
         reward_value = rc.referrer_reward_value,
         reward_status = CASE WHEN rc.referrer_reward_type = 'none' THEN 'void' ELSE 'granted' END,
         reward_granted_at = CASE WHEN rc.referrer_reward_type = 'none' THEN NULL ELSE now() END
   WHERE id = rr.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_referral_conversion ON public.hospital_subscriptions;
CREATE TRIGGER trg_apply_referral_conversion
  AFTER UPDATE OF status ON public.hospital_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_referral_conversion();
