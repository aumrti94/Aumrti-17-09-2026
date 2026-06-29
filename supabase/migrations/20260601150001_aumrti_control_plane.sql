-- ============================================================
-- AUMRTI CONTROL PLANE
-- Migration : 20260601_aumrti_control_plane.sql
-- Purpose   : Zero-code configuration engine for Aumrti CEO.
--
-- IDEMPOTENT DESIGN:
--   Every CREATE TABLE uses IF NOT EXISTS.
--   Every new column uses ALTER TABLE ... ADD COLUMN IF NOT EXISTS.
--   This handles tables that were pre-created by Lovable / Supabase
--   dashboard with a different schema.
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- SECTION 1: aumrti_admins
-- Platform team accounts — completely separate from hospital users.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.aumrti_admins (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id  uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name     text        NOT NULL,
  email         text        NOT NULL,
  is_active     boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.aumrti_admins ADD COLUMN IF NOT EXISTS auth_user_id  uuid        REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.aumrti_admins ADD COLUMN IF NOT EXISTS full_name     text;
ALTER TABLE public.aumrti_admins ADD COLUMN IF NOT EXISTS email         text;
ALTER TABLE public.aumrti_admins ADD COLUMN IF NOT EXISTS is_active     boolean     NOT NULL DEFAULT true;
ALTER TABLE public.aumrti_admins ADD COLUMN IF NOT EXISTS created_at    timestamptz NOT NULL DEFAULT now();

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'aumrti_admins_auth_user_id_key'
    AND   conrelid = 'public.aumrti_admins'::regclass
  ) THEN
    ALTER TABLE public.aumrti_admins ADD CONSTRAINT aumrti_admins_auth_user_id_key UNIQUE (auth_user_id);
  END IF;
END $$;

ALTER TABLE public.aumrti_admins ENABLE ROW LEVEL SECURITY;


-- ─────────────────────────────────────────────────────────────
-- SECTION 2: is_aumrti_admin() helper
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_aumrti_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.aumrti_admins
    WHERE  auth_user_id = auth.uid()
    AND    is_active     = true
  );
$$;


-- ─────────────────────────────────────────────────────────────
-- SECTION 3: subscription_plans
-- NOTE: This table may already exist from Lovable / Supabase
-- dashboard — we patch every new column with ADD COLUMN IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL
);

-- Patch all columns the CEO control plane needs
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS slug            text;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS price_monthly   numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS price_yearly    numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS max_beds        integer;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS max_staff       integer;
-- Enterprise plan uses NULL to mean "unlimited" — drop NOT NULL if the existing table has it
ALTER TABLE public.subscription_plans ALTER COLUMN max_beds  DROP NOT NULL;
ALTER TABLE public.subscription_plans ALTER COLUMN max_staff DROP NOT NULL;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS trial_days      integer       NOT NULL DEFAULT 30;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS is_active       boolean       NOT NULL DEFAULT true;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS is_custom_price boolean       NOT NULL DEFAULT false;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS sort_order      integer       NOT NULL DEFAULT 0;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS badge_text      text;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS description     text;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS created_at      timestamptz   NOT NULL DEFAULT now();
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS updated_at      timestamptz   NOT NULL DEFAULT now();

-- Unique constraint on slug (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'subscription_plans_slug_key'
    AND   conrelid = 'public.subscription_plans'::regclass
  ) THEN
    ALTER TABLE public.subscription_plans ADD CONSTRAINT subscription_plans_slug_key UNIQUE (slug);
  END IF;
END $$;

ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;


-- ─────────────────────────────────────────────────────────────
-- SECTION 4: plan_features
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.plan_features (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id    uuid NOT NULL REFERENCES public.subscription_plans(id) ON DELETE CASCADE,
  module_key text NOT NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.plan_features ADD COLUMN IF NOT EXISTS plan_id    uuid        REFERENCES public.subscription_plans(id) ON DELETE CASCADE;
ALTER TABLE public.plan_features ADD COLUMN IF NOT EXISTS module_key text;
ALTER TABLE public.plan_features ADD COLUMN IF NOT EXISTS is_enabled boolean     NOT NULL DEFAULT true;
ALTER TABLE public.plan_features ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'plan_features_plan_id_module_key_key'
    AND   conrelid = 'public.plan_features'::regclass
  ) THEN
    ALTER TABLE public.plan_features ADD CONSTRAINT plan_features_plan_id_module_key_key UNIQUE (plan_id, module_key);
  END IF;
END $$;

ALTER TABLE public.plan_features ENABLE ROW LEVEL SECURITY;


-- ─────────────────────────────────────────────────────────────
-- SECTION 5: hospital_subscriptions
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.hospital_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  plan_id     uuid NOT NULL REFERENCES public.subscription_plans(id),
  status      text NOT NULL DEFAULT 'trial'
);

ALTER TABLE public.hospital_subscriptions ADD COLUMN IF NOT EXISTS plan_id                   uuid        REFERENCES public.subscription_plans(id);
ALTER TABLE public.hospital_subscriptions ADD COLUMN IF NOT EXISTS status                    text        NOT NULL DEFAULT 'trial';
ALTER TABLE public.hospital_subscriptions ADD COLUMN IF NOT EXISTS trial_ends_at             timestamptz;
ALTER TABLE public.hospital_subscriptions ADD COLUMN IF NOT EXISTS current_period_start      timestamptz;
ALTER TABLE public.hospital_subscriptions ADD COLUMN IF NOT EXISTS current_period_end        timestamptz;
ALTER TABLE public.hospital_subscriptions ADD COLUMN IF NOT EXISTS razorpay_subscription_id  text;
ALTER TABLE public.hospital_subscriptions ADD COLUMN IF NOT EXISTS razorpay_plan_id          text;
ALTER TABLE public.hospital_subscriptions ADD COLUMN IF NOT EXISTS discount_code_applied     text;
ALTER TABLE public.hospital_subscriptions ADD COLUMN IF NOT EXISTS discount_pct              numeric(5,2);
ALTER TABLE public.hospital_subscriptions ADD COLUMN IF NOT EXISTS notes                     text;
ALTER TABLE public.hospital_subscriptions ADD COLUMN IF NOT EXISTS created_at                timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.hospital_subscriptions ADD COLUMN IF NOT EXISTS updated_at                timestamptz NOT NULL DEFAULT now();

-- Add status CHECK constraint if not present
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'hospital_subscriptions_status_check'
    AND   conrelid = 'public.hospital_subscriptions'::regclass
  ) THEN
    ALTER TABLE public.hospital_subscriptions
      ADD CONSTRAINT hospital_subscriptions_status_check
      CHECK (status IN ('trial','active','past_due','suspended','cancelled'));
  END IF;
END $$;

-- Unique constraint: one subscription per hospital
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'hospital_subscriptions_hospital_id_key'
    AND   conrelid = 'public.hospital_subscriptions'::regclass
  ) THEN
    ALTER TABLE public.hospital_subscriptions ADD CONSTRAINT hospital_subscriptions_hospital_id_key UNIQUE (hospital_id);
  END IF;
END $$;

ALTER TABLE public.hospital_subscriptions ENABLE ROW LEVEL SECURITY;


-- ─────────────────────────────────────────────────────────────
-- SECTION 6: discount_codes
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.discount_codes (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL
);

ALTER TABLE public.discount_codes ADD COLUMN IF NOT EXISTS description     text;
ALTER TABLE public.discount_codes ADD COLUMN IF NOT EXISTS discount_type   text        NOT NULL DEFAULT 'percentage';
ALTER TABLE public.discount_codes ADD COLUMN IF NOT EXISTS discount_value  numeric(10,2);
ALTER TABLE public.discount_codes ADD COLUMN IF NOT EXISTS applies_to      text        NOT NULL DEFAULT 'all';
ALTER TABLE public.discount_codes ADD COLUMN IF NOT EXISTS valid_from      timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.discount_codes ADD COLUMN IF NOT EXISTS valid_until     timestamptz;
ALTER TABLE public.discount_codes ADD COLUMN IF NOT EXISTS max_uses        integer;
ALTER TABLE public.discount_codes ADD COLUMN IF NOT EXISTS used_count      integer     NOT NULL DEFAULT 0;
ALTER TABLE public.discount_codes ADD COLUMN IF NOT EXISTS is_active       boolean     NOT NULL DEFAULT true;
ALTER TABLE public.discount_codes ADD COLUMN IF NOT EXISTS created_by      uuid        REFERENCES auth.users(id);
ALTER TABLE public.discount_codes ADD COLUMN IF NOT EXISTS created_at      timestamptz NOT NULL DEFAULT now();

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'discount_codes_code_key'
    AND   conrelid = 'public.discount_codes'::regclass
  ) THEN
    ALTER TABLE public.discount_codes ADD CONSTRAINT discount_codes_code_key UNIQUE (code);
  END IF;
END $$;

ALTER TABLE public.discount_codes ENABLE ROW LEVEL SECURITY;


-- ─────────────────────────────────────────────────────────────
-- SECTION 7: hospital_pricing_overrides
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.hospital_pricing_overrides (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE
);

ALTER TABLE public.hospital_pricing_overrides ADD COLUMN IF NOT EXISTS monthly_price  numeric(10,2);
ALTER TABLE public.hospital_pricing_overrides ADD COLUMN IF NOT EXISTS yearly_price   numeric(10,2);
ALTER TABLE public.hospital_pricing_overrides ADD COLUMN IF NOT EXISTS reason         text;
ALTER TABLE public.hospital_pricing_overrides ADD COLUMN IF NOT EXISTS valid_until    timestamptz;
ALTER TABLE public.hospital_pricing_overrides ADD COLUMN IF NOT EXISTS created_by     uuid        REFERENCES auth.users(id);
ALTER TABLE public.hospital_pricing_overrides ADD COLUMN IF NOT EXISTS created_at     timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.hospital_pricing_overrides ADD COLUMN IF NOT EXISTS updated_at     timestamptz NOT NULL DEFAULT now();

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'hospital_pricing_overrides_hospital_id_key'
    AND   conrelid = 'public.hospital_pricing_overrides'::regclass
  ) THEN
    ALTER TABLE public.hospital_pricing_overrides ADD CONSTRAINT hospital_pricing_overrides_hospital_id_key UNIQUE (hospital_id);
  END IF;
END $$;

ALTER TABLE public.hospital_pricing_overrides ENABLE ROW LEVEL SECURITY;


-- ─────────────────────────────────────────────────────────────
-- SECTION 8: hospital_feature_overrides
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.hospital_feature_overrides (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  module_key  text NOT NULL,
  is_enabled  boolean NOT NULL
);

ALTER TABLE public.hospital_feature_overrides ADD COLUMN IF NOT EXISTS reason      text;
ALTER TABLE public.hospital_feature_overrides ADD COLUMN IF NOT EXISTS created_by  uuid        REFERENCES auth.users(id);
ALTER TABLE public.hospital_feature_overrides ADD COLUMN IF NOT EXISTS created_at  timestamptz NOT NULL DEFAULT now();

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'hospital_feature_overrides_hospital_id_module_key_key'
    AND   conrelid = 'public.hospital_feature_overrides'::regclass
  ) THEN
    ALTER TABLE public.hospital_feature_overrides
      ADD CONSTRAINT hospital_feature_overrides_hospital_id_module_key_key
      UNIQUE (hospital_id, module_key);
  END IF;
END $$;

ALTER TABLE public.hospital_feature_overrides ENABLE ROW LEVEL SECURITY;


-- ─────────────────────────────────────────────────────────────
-- SECTION 9: updated_at triggers
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_subscription_plans_updated_at     ON public.subscription_plans;
DROP TRIGGER IF EXISTS trg_hospital_subscriptions_updated_at ON public.hospital_subscriptions;
DROP TRIGGER IF EXISTS trg_hospital_pricing_overrides_upd_at ON public.hospital_pricing_overrides;

CREATE TRIGGER trg_subscription_plans_updated_at
  BEFORE UPDATE ON public.subscription_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_hospital_subscriptions_updated_at
  BEFORE UPDATE ON public.hospital_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_hospital_pricing_overrides_upd_at
  BEFORE UPDATE ON public.hospital_pricing_overrides
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ─────────────────────────────────────────────────────────────
-- SECTION 10: RLS POLICIES
-- ─────────────────────────────────────────────────────────────

-- ── aumrti_admins ─────────────────────────────────────────────
DROP POLICY IF EXISTS "aumrti_admins_self_read" ON public.aumrti_admins;
DROP POLICY IF EXISTS "aumrti_admins_write"     ON public.aumrti_admins;

CREATE POLICY "aumrti_admins_self_read"
  ON public.aumrti_admins FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid() OR public.is_aumrti_admin());

CREATE POLICY "aumrti_admins_write"
  ON public.aumrti_admins FOR ALL TO authenticated
  USING (public.is_aumrti_admin())
  WITH CHECK (public.is_aumrti_admin());

-- ── subscription_plans ────────────────────────────────────────
DROP POLICY IF EXISTS "plans_public_read"  ON public.subscription_plans;
DROP POLICY IF EXISTS "plans_aumrti_write" ON public.subscription_plans;

CREATE POLICY "plans_public_read"
  ON public.subscription_plans FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "plans_aumrti_write"
  ON public.subscription_plans FOR ALL TO authenticated
  USING (public.is_aumrti_admin())
  WITH CHECK (public.is_aumrti_admin());

-- ── plan_features ─────────────────────────────────────────────
DROP POLICY IF EXISTS "plan_features_public_read"  ON public.plan_features;
DROP POLICY IF EXISTS "plan_features_aumrti_write" ON public.plan_features;

CREATE POLICY "plan_features_public_read"
  ON public.plan_features FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "plan_features_aumrti_write"
  ON public.plan_features FOR ALL TO authenticated
  USING (public.is_aumrti_admin())
  WITH CHECK (public.is_aumrti_admin());

-- ── hospital_subscriptions ────────────────────────────────────
DROP POLICY IF EXISTS "hospital_sub_own_read"   ON public.hospital_subscriptions;
DROP POLICY IF EXISTS "hospital_sub_aumrti_all" ON public.hospital_subscriptions;

CREATE POLICY "hospital_sub_own_read"
  ON public.hospital_subscriptions FOR SELECT TO authenticated
  USING (
    hospital_id = (
      SELECT hospital_id FROM public.users
      WHERE  auth_user_id = auth.uid()
      LIMIT  1
    )
    OR public.is_aumrti_admin()
  );

CREATE POLICY "hospital_sub_aumrti_all"
  ON public.hospital_subscriptions FOR ALL TO authenticated
  USING    (public.is_aumrti_admin())
  WITH CHECK (public.is_aumrti_admin());

-- ── discount_codes ────────────────────────────────────────────
DROP POLICY IF EXISTS "discount_codes_public_read"  ON public.discount_codes;
DROP POLICY IF EXISTS "discount_codes_aumrti_write" ON public.discount_codes;

CREATE POLICY "discount_codes_public_read"
  ON public.discount_codes FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "discount_codes_aumrti_write"
  ON public.discount_codes FOR ALL TO authenticated
  USING    (public.is_aumrti_admin())
  WITH CHECK (public.is_aumrti_admin());

-- ── hospital_pricing_overrides ────────────────────────────────
DROP POLICY IF EXISTS "pricing_override_own_read"   ON public.hospital_pricing_overrides;
DROP POLICY IF EXISTS "pricing_override_aumrti_all" ON public.hospital_pricing_overrides;

CREATE POLICY "pricing_override_own_read"
  ON public.hospital_pricing_overrides FOR SELECT TO authenticated
  USING (
    hospital_id = (
      SELECT hospital_id FROM public.users
      WHERE  auth_user_id = auth.uid()
      LIMIT  1
    )
    OR public.is_aumrti_admin()
  );

CREATE POLICY "pricing_override_aumrti_all"
  ON public.hospital_pricing_overrides FOR ALL TO authenticated
  USING    (public.is_aumrti_admin())
  WITH CHECK (public.is_aumrti_admin());

-- ── hospital_feature_overrides ────────────────────────────────
DROP POLICY IF EXISTS "feature_override_own_read"   ON public.hospital_feature_overrides;
DROP POLICY IF EXISTS "feature_override_aumrti_all" ON public.hospital_feature_overrides;

CREATE POLICY "feature_override_own_read"
  ON public.hospital_feature_overrides FOR SELECT TO authenticated
  USING (
    hospital_id = (
      SELECT hospital_id FROM public.users
      WHERE  auth_user_id = auth.uid()
      LIMIT  1
    )
    OR public.is_aumrti_admin()
  );

CREATE POLICY "feature_override_aumrti_all"
  ON public.hospital_feature_overrides FOR ALL TO authenticated
  USING    (public.is_aumrti_admin())
  WITH CHECK (public.is_aumrti_admin());


-- ─────────────────────────────────────────────────────────────
-- SECTION 11: INDEXES
-- ─────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_aumrti_admins_auth_user_id          ON public.aumrti_admins (auth_user_id);
CREATE INDEX IF NOT EXISTS idx_plan_features_plan_id               ON public.plan_features (plan_id);
CREATE INDEX IF NOT EXISTS idx_plan_features_module_key            ON public.plan_features (module_key);
CREATE INDEX IF NOT EXISTS idx_hospital_subscriptions_hospital_id  ON public.hospital_subscriptions (hospital_id);
CREATE INDEX IF NOT EXISTS idx_hospital_subscriptions_status       ON public.hospital_subscriptions (status);
CREATE INDEX IF NOT EXISTS idx_hospital_subscriptions_plan_id      ON public.hospital_subscriptions (plan_id);
CREATE INDEX IF NOT EXISTS idx_hospital_feature_overrides_hosp_id  ON public.hospital_feature_overrides (hospital_id);
CREATE INDEX IF NOT EXISTS idx_hospital_pricing_overrides_hosp_id  ON public.hospital_pricing_overrides (hospital_id);
CREATE INDEX IF NOT EXISTS idx_discount_codes_code                 ON public.discount_codes (code);
CREATE INDEX IF NOT EXISTS idx_discount_codes_active_valid         ON public.discount_codes (is_active, valid_from, valid_until);


-- ─────────────────────────────────────────────────────────────
-- SECTION 12: SEED DATA — 3 default plans
-- Fixed UUIDs make this block fully idempotent on re-runs.
--   10000000-...-000000000001 → Starter
--   10000000-...-000000000002 → Professional
--   10000000-...-000000000003 → Enterprise
-- ─────────────────────────────────────────────────────────────

INSERT INTO public.subscription_plans
  (id, name, slug, price_monthly, price_yearly,
   max_beds, max_staff, trial_days,
   is_active, is_custom_price, sort_order, badge_text, description)
VALUES
  ('10000000-0000-0000-0000-000000000001',
   'Starter', 'starter',
   8999.00, 89990.00, 50, 15, 30, true, false, 1, NULL,
   'For clinics and small hospitals up to 50 beds. Core clinical workflow: OPD, IPD, Lab, Pharmacy, Billing.'),

  ('10000000-0000-0000-0000-000000000002',
   'Professional', 'professional',
   18999.00, 189990.00, 250, 100, 30, true, false, 2, 'Most Popular',
   'For hospitals 50–250 beds. All 56 modules including AI features, NABH 6th Edition, Insurance/TPA, ABDM and Analytics.'),

  ('10000000-0000-0000-0000-000000000003',
   'Enterprise', 'enterprise',
   0.00, 0.00, NULL, NULL, 30, true, true, 3, 'Custom Pricing',
   'For chains and 250+ bed hospitals. Everything in Professional plus multi-branch, white-label and SLA-backed support.')

ON CONFLICT (slug) DO UPDATE SET
  name            = EXCLUDED.name,
  price_monthly   = EXCLUDED.price_monthly,
  price_yearly    = EXCLUDED.price_yearly,
  max_beds        = EXCLUDED.max_beds,
  max_staff       = EXCLUDED.max_staff,
  trial_days      = EXCLUDED.trial_days,
  is_active       = EXCLUDED.is_active,
  is_custom_price = EXCLUDED.is_custom_price,
  sort_order      = EXCLUDED.sort_order,
  badge_text      = EXCLUDED.badge_text,
  description     = EXCLUDED.description,
  updated_at      = now();


-- ── STARTER features: 18 core modules ON, 38 advanced OFF ──

INSERT INTO public.plan_features (plan_id, module_key, is_enabled) VALUES
  ('10000000-0000-0000-0000-000000000001', 'opd',               true),
  ('10000000-0000-0000-0000-000000000001', 'ipd',               true),
  ('10000000-0000-0000-0000-000000000001', 'day_care',          true),
  ('10000000-0000-0000-0000-000000000001', 'emergency',         true),
  ('10000000-0000-0000-0000-000000000001', 'nursing',           true),
  ('10000000-0000-0000-0000-000000000001', 'lab',               true),
  ('10000000-0000-0000-0000-000000000001', 'radiology',         true),
  ('10000000-0000-0000-0000-000000000001', 'pharmacy',          true),
  ('10000000-0000-0000-0000-000000000001', 'pharmacy_retail',   true),
  ('10000000-0000-0000-0000-000000000001', 'billing',           true),
  ('10000000-0000-0000-0000-000000000001', 'day_closure',       true),
  ('10000000-0000-0000-0000-000000000001', 'payments',          true),
  ('10000000-0000-0000-0000-000000000001', 'hr',                true),
  ('10000000-0000-0000-0000-000000000001', 'inventory',         true),
  ('10000000-0000-0000-0000-000000000001', 'patient_portal',    true),
  ('10000000-0000-0000-0000-000000000001', 'inbox',             true),
  ('10000000-0000-0000-0000-000000000001', 'tv_display',        true),
  ('10000000-0000-0000-0000-000000000001', 'settings',          true),
  ('10000000-0000-0000-0000-000000000001', 'ot',                false),
  ('10000000-0000-0000-0000-000000000001', 'telemedicine',      false),
  ('10000000-0000-0000-0000-000000000001', 'health_packages',   false),
  ('10000000-0000-0000-0000-000000000001', 'blood_bank',        false),
  ('10000000-0000-0000-0000-000000000001', 'cssd',              false),
  ('10000000-0000-0000-0000-000000000001', 'insurance',         false),
  ('10000000-0000-0000-0000-000000000001', 'accounts',          false),
  ('10000000-0000-0000-0000-000000000001', 'assets',            false),
  ('10000000-0000-0000-0000-000000000001', 'pmjay',             false),
  ('10000000-0000-0000-0000-000000000001', 'quality',           false),
  ('10000000-0000-0000-0000-000000000001', 'dialysis',          false),
  ('10000000-0000-0000-0000-000000000001', 'oncology',          false),
  ('10000000-0000-0000-0000-000000000001', 'physio',            false),
  ('10000000-0000-0000-0000-000000000001', 'mortuary',          false),
  ('10000000-0000-0000-0000-000000000001', 'vaccination',       false),
  ('10000000-0000-0000-0000-000000000001', 'ambulance',         false),
  ('10000000-0000-0000-0000-000000000001', 'home_care',         false),
  ('10000000-0000-0000-0000-000000000001', 'dental',            false),
  ('10000000-0000-0000-0000-000000000001', 'ayush',             false),
  ('10000000-0000-0000-0000-000000000001', 'ivf',               false),
  ('10000000-0000-0000-0000-000000000001', 'obstetric_anc',     false),
  ('10000000-0000-0000-0000-000000000001', 'neonatal',          false),
  ('10000000-0000-0000-0000-000000000001', 'anaesthesia',       false),
  ('10000000-0000-0000-0000-000000000001', 'ophthalmology',     false),
  ('10000000-0000-0000-0000-000000000001', 'partograph',        false),
  ('10000000-0000-0000-0000-000000000001', 'mental_health',     false),
  ('10000000-0000-0000-0000-000000000001', 'chronic_disease',   false),
  ('10000000-0000-0000-0000-000000000001', 'mrd',               false),
  ('10000000-0000-0000-0000-000000000001', 'biomedical',        false),
  ('10000000-0000-0000-0000-000000000001', 'housekeeping',      false),
  ('10000000-0000-0000-0000-000000000001', 'hmis',              false),
  ('10000000-0000-0000-0000-000000000001', 'dietetics',         false),
  ('10000000-0000-0000-0000-000000000001', 'lms',               false),
  ('10000000-0000-0000-0000-000000000001', 'crm',               false),
  ('10000000-0000-0000-0000-000000000001', 'abdm',              false),
  ('10000000-0000-0000-0000-000000000001', 'patient_relations', false),
  ('10000000-0000-0000-0000-000000000001', 'analytics',         false),
  ('10000000-0000-0000-0000-000000000001', 'hod_dashboard',     false)
ON CONFLICT (plan_id, module_key) DO UPDATE SET is_enabled = EXCLUDED.is_enabled;


-- ── PROFESSIONAL features: all 56 modules ON ──

INSERT INTO public.plan_features (plan_id, module_key, is_enabled) VALUES
  ('10000000-0000-0000-0000-000000000002', 'opd',               true),
  ('10000000-0000-0000-0000-000000000002', 'ipd',               true),
  ('10000000-0000-0000-0000-000000000002', 'day_care',          true),
  ('10000000-0000-0000-0000-000000000002', 'emergency',         true),
  ('10000000-0000-0000-0000-000000000002', 'ot',                true),
  ('10000000-0000-0000-0000-000000000002', 'nursing',           true),
  ('10000000-0000-0000-0000-000000000002', 'telemedicine',      true),
  ('10000000-0000-0000-0000-000000000002', 'health_packages',   true),
  ('10000000-0000-0000-0000-000000000002', 'lab',               true),
  ('10000000-0000-0000-0000-000000000002', 'radiology',         true),
  ('10000000-0000-0000-0000-000000000002', 'blood_bank',        true),
  ('10000000-0000-0000-0000-000000000002', 'cssd',              true),
  ('10000000-0000-0000-0000-000000000002', 'pharmacy',          true),
  ('10000000-0000-0000-0000-000000000002', 'pharmacy_retail',   true),
  ('10000000-0000-0000-0000-000000000002', 'billing',           true),
  ('10000000-0000-0000-0000-000000000002', 'day_closure',       true),
  ('10000000-0000-0000-0000-000000000002', 'insurance',         true),
  ('10000000-0000-0000-0000-000000000002', 'payments',          true),
  ('10000000-0000-0000-0000-000000000002', 'accounts',          true),
  ('10000000-0000-0000-0000-000000000002', 'assets',            true),
  ('10000000-0000-0000-0000-000000000002', 'pmjay',             true),
  ('10000000-0000-0000-0000-000000000002', 'hr',                true),
  ('10000000-0000-0000-0000-000000000002', 'inventory',         true),
  ('10000000-0000-0000-0000-000000000002', 'quality',           true),
  ('10000000-0000-0000-0000-000000000002', 'dialysis',          true),
  ('10000000-0000-0000-0000-000000000002', 'oncology',          true),
  ('10000000-0000-0000-0000-000000000002', 'physio',            true),
  ('10000000-0000-0000-0000-000000000002', 'mortuary',          true),
  ('10000000-0000-0000-0000-000000000002', 'vaccination',       true),
  ('10000000-0000-0000-0000-000000000002', 'ambulance',         true),
  ('10000000-0000-0000-0000-000000000002', 'home_care',         true),
  ('10000000-0000-0000-0000-000000000002', 'dental',            true),
  ('10000000-0000-0000-0000-000000000002', 'ayush',             true),
  ('10000000-0000-0000-0000-000000000002', 'ivf',               true),
  ('10000000-0000-0000-0000-000000000002', 'obstetric_anc',     true),
  ('10000000-0000-0000-0000-000000000002', 'neonatal',          true),
  ('10000000-0000-0000-0000-000000000002', 'anaesthesia',       true),
  ('10000000-0000-0000-0000-000000000002', 'ophthalmology',     true),
  ('10000000-0000-0000-0000-000000000002', 'partograph',        true),
  ('10000000-0000-0000-0000-000000000002', 'mental_health',     true),
  ('10000000-0000-0000-0000-000000000002', 'chronic_disease',   true),
  ('10000000-0000-0000-0000-000000000002', 'mrd',               true),
  ('10000000-0000-0000-0000-000000000002', 'biomedical',        true),
  ('10000000-0000-0000-0000-000000000002', 'housekeeping',      true),
  ('10000000-0000-0000-0000-000000000002', 'hmis',              true),
  ('10000000-0000-0000-0000-000000000002', 'dietetics',         true),
  ('10000000-0000-0000-0000-000000000002', 'lms',               true),
  ('10000000-0000-0000-0000-000000000002', 'crm',               true),
  ('10000000-0000-0000-0000-000000000002', 'abdm',              true),
  ('10000000-0000-0000-0000-000000000002', 'patient_portal',    true),
  ('10000000-0000-0000-0000-000000000002', 'patient_relations', true),
  ('10000000-0000-0000-0000-000000000002', 'inbox',             true),
  ('10000000-0000-0000-0000-000000000002', 'analytics',         true),
  ('10000000-0000-0000-0000-000000000002', 'hod_dashboard',     true),
  ('10000000-0000-0000-0000-000000000002', 'tv_display',        true),
  ('10000000-0000-0000-0000-000000000002', 'settings',          true)
ON CONFLICT (plan_id, module_key) DO UPDATE SET is_enabled = EXCLUDED.is_enabled;


-- ── ENTERPRISE features: copy all Professional rows ──

INSERT INTO public.plan_features (plan_id, module_key, is_enabled)
SELECT '10000000-0000-0000-0000-000000000003', module_key, is_enabled
FROM   public.plan_features
WHERE  plan_id = '10000000-0000-0000-0000-000000000002'
ON CONFLICT (plan_id, module_key) DO UPDATE SET is_enabled = EXCLUDED.is_enabled;


-- ─────────────────────────────────────────────────────────────
-- DONE. Run in Supabase SQL Editor.
--
-- After running, create your Aumrti admin account:
-- 1. Supabase Dashboard → Authentication → Users → Add user
--    Email: ceo@aumrti.in  Password: (strong password)
-- 2. Copy the UUID of the new user
-- 3. Run:
--      INSERT INTO public.aumrti_admins (auth_user_id, full_name, email)
--      VALUES ('<uuid>', 'Your Name', 'ceo@aumrti.in');
-- ─────────────────────────────────────────────────────────────
