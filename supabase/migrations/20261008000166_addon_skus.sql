-- ============================================================
-- Pricing v3 — Phase 2: add-on SKU engine
-- ------------------------------------------------------------
-- Phase 1 (164/165) shipped the bed-banded rate card but left every module
-- bundled, so nothing could be sold as an upgrade. This adds a catalogue of
-- purchasable add-ons, each granting a bundle of MODULES and AI FEATURES.
--
-- Two resolution layers exist in the app and BOTH read these grants:
--   1. module on/off  → src/lib/moduleAccess.ts  (plan_features.is_enabled)
--   2. tabs/actions   → src/lib/entitlementResolve.ts (plan_features.actions),
--      where the 66 AI features are the "actions" of the pseudo-module ai_suite.
--
-- PRECEDENCE: admin override > add-on grant > plan default.
-- An add-on only ever GRANTS; it can never withhold. An admin override still
-- wins (deliberate admin action, e.g. suspending a module for cause) — but that
-- combination means a hospital is PAYING for something gated off, which is a
-- billing-integrity bug, so the cockpit surfaces it as a drift warning.
--
-- BILLING: add-ons do not charge on purchase. They are picked up by the renewal
-- reconciler built in 164/165 and take effect at cycle end — which is why
-- self-service purchase needs no Razorpay checkout at all. NOTE: that reconciler
-- is gated behind the `bed_reprice_live` flag and ships OFF, so until it is
-- enabled an add-on grants access and charges NOTHING.
--
-- Everything here is a /platform knob: SKU names, prices, and the exact module
-- and AI keys each SKU grants are columns edited in PlansManager. No SKU
-- definition and no price lives in code.
-- ============================================================

-- ── 1. The catalogue ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.addon_skus (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE,
  name          text NOT NULL,
  description   text,
  price_monthly numeric(10,2) NOT NULL DEFAULT 0,
  -- NULL = auto 10x monthly, the existing 2-months-free convention used by
  -- subscription_plans. A knob, not a constant.
  price_yearly  numeric(10,2),
  module_keys      text[] NOT NULL DEFAULT '{}',
  ai_feature_keys  text[] NOT NULL DEFAULT '{}',
  is_active     boolean NOT NULL DEFAULT true,
  sort_order    integer NOT NULL DEFAULT 0,
  badge_text    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.addon_skus.module_keys IS
  'Canonical module keys this SKU enables (moduleKeys.ts). Empty = grants no modules (e.g. AI Suite Pro).';
COMMENT ON COLUMN public.addon_skus.ai_feature_keys IS
  'AI feature keys this SKU un-withholds; they are the "actions" of the ai_suite pseudo-module (aiFeatures.ts).';

ALTER TABLE public.addon_skus ENABLE ROW LEVEL SECURITY;

-- Catalogue is public marketing data (name + price + what it unlocks) — the
-- /pricing page must list it before anyone signs in. Only admins may write.
DROP POLICY IF EXISTS "addon_skus_read_all" ON public.addon_skus;
CREATE POLICY "addon_skus_read_all" ON public.addon_skus
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "addon_skus_anon_read" ON public.addon_skus;
CREATE POLICY "addon_skus_anon_read" ON public.addon_skus
  FOR SELECT TO anon USING (is_active = true);

DROP POLICY IF EXISTS "addon_skus_admin_write" ON public.addon_skus;
CREATE POLICY "addon_skus_admin_write" ON public.addon_skus
  FOR ALL TO authenticated
  USING (public.is_aumrti_admin()) WITH CHECK (public.is_aumrti_admin());

-- ── 2. Purchases ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hospital_addons (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id   uuid NOT NULL REFERENCES public.hospitals(id)  ON DELETE CASCADE,
  addon_sku_id  uuid NOT NULL REFERENCES public.addon_skus(id) ON DELETE RESTRICT,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  -- Access starts immediately; money starts at the next renewal.
  granted_at        timestamptz NOT NULL DEFAULT now(),
  billing_starts_at timestamptz,
  cancelled_at      timestamptz,
  purchased_by  uuid REFERENCES auth.users(id),
  source        text NOT NULL DEFAULT 'admin' CHECK (source IN ('admin', 'self_service')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- One ACTIVE row per (hospital, sku). Partial, so a cancelled add-on can be
-- re-purchased later without tripping the constraint or losing its history.
CREATE UNIQUE INDEX IF NOT EXISTS hospital_addons_active_uniq
  ON public.hospital_addons (hospital_id, addon_sku_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_hospital_addons_hospital
  ON public.hospital_addons (hospital_id) WHERE status = 'active';

ALTER TABLE public.hospital_addons ENABLE ROW LEVEL SECURITY;

-- A hospital may see and buy its OWN add-ons (self-service), and aumrti_admins
-- may manage any. Deliberately NOT the hospital_feature_overrides table: that
-- one is the admin-intent surface and must never be writable from a tenant
-- screen. Purchased grants live here, separately, so an admin editing overrides
-- can never silently revoke something a hospital paid for.
DROP POLICY IF EXISTS "hospital_addons_read" ON public.hospital_addons;
CREATE POLICY "hospital_addons_read" ON public.hospital_addons
  FOR SELECT TO authenticated
  USING (hospital_id = public.get_user_hospital_id() OR public.is_aumrti_admin());

DROP POLICY IF EXISTS "hospital_addons_tenant_write" ON public.hospital_addons;
CREATE POLICY "hospital_addons_tenant_write" ON public.hospital_addons
  FOR ALL TO authenticated
  USING (
    public.is_aumrti_admin()
    OR (hospital_id = public.get_user_hospital_id() AND public.has_role(auth.uid(), 'super_admin'::public.app_role))
  )
  WITH CHECK (
    public.is_aumrti_admin()
    OR (hospital_id = public.get_user_hospital_id() AND public.has_role(auth.uid(), 'super_admin'::public.app_role))
  );

-- ── 3. Seed the four SKUs ────────────────────────────────────
-- Prices come from the pricing advisory: each must clear the CFO's
-- >= Rs.3,000/month bar at median uptake to exist as an add-on at all.
-- ABDM and Blood Bank FAILED that bar and are bundled instead (see section 5).
INSERT INTO public.addon_skus
  (slug, name, description, price_monthly, module_keys, ai_feature_keys, sort_order, badge_text)
VALUES
  ('insurance_tpa', 'Insurance & Claims Desk',
   'Insurance/TPA pre-auth and claims, PMJAY, CGHS and ESI submission, with AI denial prediction and coding audit. Recovers claim revenue most hospitals are quietly losing.',
   4999.00,
   ARRAY['insurance', 'pmjay'],
   ARRAY['denial_predictor', 'approval_predictor', 'denial_analytics', 'coding_accuracy_auditor'],
   1, 'Most Added'),

  ('accounts_erp', 'Accounts & Compliance',
   'Full accounting and ERP: P&L, balance sheet, journals, Tally export and GST e-invoicing, with AI financial narratives and revenue-leak detection.',
   3999.00,
   ARRAY['accounts'],
   ARRAY['financial_analysis', 'revenue_leakage', 'inventory_itc_classify'],
   2, NULL),

  ('analytics_hmis', 'Analytics & HMIS',
   'Management analytics, government HMIS reporting and the AI executive digest — the promoter and MD view of the hospital.',
   3499.00,
   ARRAY['analytics', 'hmis'],
   ARRAY['ai_digest'],
   3, NULL),

  ('ai_suite_pro', 'AI Suite Pro',
   'The predictive and optimisation layer: bed and blood demand forecasting, OT and roster optimisation, no-show and readmission risk, ED crowding, staff burnout and AI root-cause analysis.',
   4999.00,
   ARRAY[]::text[],
   ARRAY['readmission_predictor', 'bed_demand_forecaster', 'blood_demand_forecaster',
         'ed_boarding_predictor', 'ot_optimizer', 'ot_cancellation_predictor',
         'no_show_predictor', 'roster_optimizer', 'nurse_workload_optimizer',
         'staff_burnout', 'esg_recommendations', 'radiology_tat_predictor', 'ai_rca'],
   4, NULL)
ON CONFLICT (slug) DO UPDATE SET
  name            = EXCLUDED.name,
  description     = EXCLUDED.description,
  price_monthly   = EXCLUDED.price_monthly,
  module_keys     = EXCLUDED.module_keys,
  ai_feature_keys = EXCLUDED.ai_feature_keys,
  sort_order      = EXCLUDED.sort_order,
  badge_text      = EXCLUDED.badge_text,
  updated_at      = now();

-- ── 4. Give the SKUs something to sell ───────────────────────
-- An add-on is meaningless if the plan already grants its content. Withhold the
-- add-on modules on Clinic and Starter ONLY.
--
-- DERIVED FROM THE CATALOGUE, never hardcoded: the module list comes from
-- addon_skus.module_keys, so if an admin adds a SKU in /platform this seed logic
-- stays the definition of "what add-ons cover". (It runs once — ongoing
-- consistency is enforced by the cockpit's drift check, not by silent
-- auto-sync, because an admin may legitimately choose to include an add-on
-- module in a plan as a promotion.)
--
-- PROFESSIONAL IS DELIBERATELY UNTOUCHED. It is the "everything" tier and is
-- sold as such; add-ons exist to sell UP from Clinic/Starter, not to strip a
-- tier customers already bought. Downgrading a live Professional hospital would
-- also strand in-flight insurance claims and ledgers behind a flag flip.
UPDATE public.plan_features pf
   SET is_enabled = false
  FROM public.subscription_plans sp
 WHERE pf.plan_id = sp.id
   AND sp.slug IN ('clinic', 'starter')
   AND pf.module_key IN (
     SELECT DISTINCT unnest(module_keys) FROM public.addon_skus WHERE is_active
   );

-- Withhold the add-on AI features on Clinic and Starter, at the ai_suite
-- action layer. resolveEntitlement() only treats an explicit `false` as
-- withheld — an absent key is ALLOWED — so these rows must exist for the AI
-- SKUs to have any effect.
WITH addon_ai AS (
  SELECT DISTINCT unnest(ai_feature_keys) AS k FROM public.addon_skus
),
withheld AS (
  SELECT jsonb_object_agg(k, false) AS blob FROM addon_ai
)
INSERT INTO public.plan_features (plan_id, module_key, is_enabled, actions)
SELECT sp.id, 'ai_suite', true, w.blob
  FROM public.subscription_plans sp
 CROSS JOIN withheld w
 WHERE sp.slug IN ('clinic', 'starter')
ON CONFLICT (plan_id, module_key) DO UPDATE
  SET actions = COALESCE(public.plan_features.actions, '{}'::jsonb) || EXCLUDED.actions;

-- ── 4b. Drift detection for the cockpit ──────────────────────
-- Because SKUs are fully editable from /platform, a later edit can make the
-- catalogue and the plan matrix disagree in two ways that both cost money:
--
--   unsellable  — a plan already grants a module the SKU charges for, so the
--                 SKU cannot be sold to that plan's hospitals.
--   paid_but_gated — a hospital has an ACTIVE paid add-on whose module is
--                 switched off by an admin override. They are paying for
--                 something they cannot open. This is the billing-integrity
--                 bug the entitlement rules explicitly call out.
--
-- Surfaced in PlansManager / HospitalDetail rather than auto-corrected: an
-- admin may deliberately bundle an add-on module into a plan as a promotion,
-- and silently "fixing" that would overrule them.
CREATE OR REPLACE VIEW public.addon_entitlement_drift AS
-- SKU sells a module the plan already includes for free
SELECT
  'unsellable'::text  AS drift_type,
  s.slug              AS addon_slug,
  s.name              AS addon_name,
  sp.slug             AS plan_slug,
  NULL::uuid          AS hospital_id,
  NULL::text          AS hospital_name,
  m.module_key,
  format('Plan "%s" already includes "%s", so the "%s" add-on cannot be sold to it.',
         sp.slug, m.module_key, s.name) AS detail
FROM public.addon_skus s
CROSS JOIN LATERAL unnest(s.module_keys) AS m(module_key)
JOIN public.plan_features pf ON pf.module_key = m.module_key AND pf.is_enabled
JOIN public.subscription_plans sp ON sp.id = pf.plan_id
WHERE s.is_active AND sp.is_active AND sp.slug <> 'professional'

UNION ALL

-- Hospital pays for an add-on whose module an admin override has disabled
SELECT
  'paid_but_gated'::text,
  s.slug,
  s.name,
  NULL::text,
  h.id,
  h.name,
  m.module_key,
  format('%s pays for "%s" but module "%s" is disabled by an admin override.',
         h.name, s.name, m.module_key)
FROM public.hospital_addons ha
JOIN public.addon_skus s ON s.id = ha.addon_sku_id
JOIN public.hospitals  h ON h.id = ha.hospital_id
CROSS JOIN LATERAL unnest(s.module_keys) AS m(module_key)
JOIN public.hospital_feature_overrides o
  ON o.hospital_id = ha.hospital_id
 AND o.module_key  = m.module_key
 AND o.is_enabled = false
WHERE ha.status = 'active';

COMMENT ON VIEW public.addon_entitlement_drift IS
  'Inconsistencies between the add-on catalogue and the plan/override matrix. "unsellable" = plan already grants it free; "paid_but_gated" = hospital is charged for a module an override has switched off.';

-- ── 5. Bundle-in correction ──────────────────────────────────
-- ABDM and Blood Bank were evaluated as add-ons and BOTH fell under the
-- Rs.3,000/month bar at median uptake — ABDM because it is trending mandatory
-- (worth far more as a differentiator than as a line item) and Blood Bank
-- because attach is structurally capped to licensed facilities. They ship
-- inside Professional instead.
UPDATE public.plan_features pf
   SET is_enabled = true
  FROM public.subscription_plans sp
 WHERE pf.plan_id = sp.id
   AND sp.slug = 'professional'
   AND pf.module_key IN ('abdm', 'blood_bank');

-- ── 6. Stop advertising what does not exist ──────────────────
-- Migration 164 published an Enterprise price. The plan text still promised
-- multi-branch and white-label, neither of which is built. Selling against a
-- capability list we cannot deliver is a support and credibility problem, so
-- the claims come out until the features ship. The PRICE stays: it is the
-- negotiation anchor.
UPDATE public.subscription_plans
   SET description = 'For chains and 250+ bed hospitals. SLA-backed support and a dedicated success manager. From Rs.49,999/month including 100 beds; Rs.1,100/month per additional 10 beds. Talk to us.',
       updated_at  = now()
 WHERE slug = 'enterprise';
