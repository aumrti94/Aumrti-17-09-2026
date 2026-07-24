-- ============================================================
-- Pricing v3 — 4-tier rate card + bed-block billing (Phase 1)
-- ------------------------------------------------------------
-- Implements the approved pricing architecture:
--   · New "Clinic & Day Care" self-service tier (≤15 beds, HARD cap via the
--     existing migration-150 bed trigger — max_beds stays the enforcement knob).
--   · Starter / Professional / Enterprise reprice to a platform-fee +
--     bed-block structure: base price includes N beds, then a per-block fee
--     per `bed_block_size` beds above that. Paid tiers drop max_beds caps
--     entirely (NULL = trigger fail-open) — BILLING replaces CAPPING.
--   · Enterprise gets a published floor (₹49,999) but keeps
--     is_custom_price=true, so checkout remains quote-gated; the figure is a
--     display anchor, not a purchasable price.
--   · max_staff → NULL on every plan. The advertised 15/100 staff caps were
--     never trigger-enforced (check_staff_capacity is a soft UI advisory) and
--     are incoherent under bed-band pricing (a 75-bed Starter hospital runs
--     ~110-190 staff). Unlimited users is now a feature: per-user pricing
--     incentivises shared logins, which destroy NABH evidence attribution.
--     check_staff_capacity stays (fail-open on NULL) as expansion telemetry.
--
-- GRANDFATHERING (runs FIRST, before any price changes):
--   Every hospital currently on trial/active starter|professional gets a
--   hospital_pricing_overrides row freezing today's list price for 12 months.
--   ON CONFLICT DO NOTHING — an existing negotiated override beats the freeze.
--   Live Razorpay subscriptions keep charging their bound amount regardless
--   (effective_amount_inr); the override intercepts the renewal-rebind and
--   plan-change paths, which are the only places the new card could reach them.
--
-- EVERYTHING REMAINS A /platform KNOB: this migration seeds initial values
-- only. All pricing columns are edited in PlansManager; per-hospital freezes
-- are edited in HospitalDetail's existing override editor. No number here is
-- referenced by code.
-- ============================================================

-- ── 1. Bed-band columns on subscription_plans ────────────────
ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS beds_included             integer,
  ADD COLUMN IF NOT EXISTS bed_block_size            integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS price_per_bed_block       numeric(10,2),
  ADD COLUMN IF NOT EXISTS price_per_bed_block_yearly numeric(10,2);

COMMENT ON COLUMN public.subscription_plans.beds_included IS
  'Active beds included in the base price. NULL = bed count does not affect price (legacy/flat plans).';
COMMENT ON COLUMN public.subscription_plans.bed_block_size IS
  'Billing increment: extra beds are charged per block of this many beds (ceil).';
COMMENT ON COLUMN public.subscription_plans.price_per_bed_block IS
  'Monthly ₹ per bed block above beds_included. NULL = no bed billing on this plan.';
COMMENT ON COLUMN public.subscription_plans.price_per_bed_block_yearly IS
  'Yearly ₹ per bed block. NULL = auto 10× monthly (the existing 2-months-free convention).';

-- ── 2a. GRANDFATHER existing subscribers (before repricing!) ─
-- Freeze the CURRENT list price for 12 months for every hospital on a live
-- starter/professional subscription. DO NOTHING on conflict: a hospital that
-- already has a negotiated override keeps its deal untouched.
INSERT INTO public.hospital_pricing_overrides
  (hospital_id, monthly_price, yearly_price, reason, valid_until)
SELECT
  hs.hospital_id,
  sp.price_monthly,
  sp.price_yearly,
  'Pricing v3 grandfather — 12-month freeze at pre-v3 list price (' || sp.slug || ')',
  now() + interval '12 months'
FROM public.hospital_subscriptions hs
JOIN public.subscription_plans sp ON sp.id = hs.plan_id
WHERE hs.status IN ('trial', 'active')
  AND sp.slug IN ('starter', 'professional')
ON CONFLICT (hospital_id) DO NOTHING;

-- ── 2b. The new rate card ────────────────────────────────────
INSERT INTO public.subscription_plans
  (id, name, slug, price_monthly, price_yearly,
   max_beds, max_staff, trial_days,
   is_active, is_custom_price, sort_order, badge_text, description,
   beds_included, bed_block_size, price_per_bed_block)
VALUES
  ('10000000-0000-0000-0000-000000000004',
   'Clinic & Day Care', 'clinic',
   2499.00, 24990.00, 15, NULL, 30, true, false, 1, 'New',
   'For clinics, day-care centres and small nursing homes up to 15 beds. OPD, day care, billing, retail pharmacy, lab and the patient portal — self-service, live in minutes.',
   15, 10, NULL),

  ('10000000-0000-0000-0000-000000000001',
   'Starter', 'starter',
   8999.00, 89990.00, NULL, NULL, 30, true, false, 2, NULL,
   'Full core clinical for growing hospitals: IPD, nursing, lab, radiology, inpatient pharmacy, inventory and HR. Includes 20 beds; ₹750/month per additional 10 beds.',
   20, 10, 750.00),

  ('10000000-0000-0000-0000-000000000002',
   'Professional', 'professional',
   17999.00, 179990.00, NULL, NULL, 30, true, false, 3, 'Most Popular',
   'Everything Aumrti does — OT, Emergency, Blood Bank, ABDM, Insurance/TPA, Quality/NABH, Analytics and the full AI suite. Includes 40 beds; ₹950/month per additional 10 beds.',
   40, 10, 950.00),

  ('10000000-0000-0000-0000-000000000003',
   'Enterprise', 'enterprise',
   49999.00, 499990.00, NULL, NULL, 30, true, true, 4, 'From ₹49,999',
   'For chains and 250+ bed hospitals: SLA-backed support and a dedicated CSM. From ₹49,999/month including 100 beds; ₹1,100/month per additional 10 beds. Talk to us.',
   100, 10, 1100.00)

ON CONFLICT (slug) DO UPDATE SET
  name                = EXCLUDED.name,
  price_monthly       = EXCLUDED.price_monthly,
  price_yearly        = EXCLUDED.price_yearly,
  max_beds            = EXCLUDED.max_beds,
  max_staff           = EXCLUDED.max_staff,
  trial_days          = EXCLUDED.trial_days,
  is_active           = EXCLUDED.is_active,
  is_custom_price     = EXCLUDED.is_custom_price,
  sort_order          = EXCLUDED.sort_order,
  badge_text          = EXCLUDED.badge_text,
  description         = EXCLUDED.description,
  beds_included       = EXCLUDED.beds_included,
  bed_block_size      = EXCLUDED.bed_block_size,
  price_per_bed_block = EXCLUDED.price_per_bed_block,
  updated_at          = now();

-- Belt-and-braces: max_staff NULL everywhere, including any plan rows this
-- migration did not touch (custom plans created via PlansManager).
UPDATE public.subscription_plans SET max_staff = NULL WHERE max_staff IS NOT NULL;

-- ── 3. Clinic module set (plan_features) ─────────────────────
-- useSubscriptionConfig treats a module key with NO plan_features row as
-- ENABLED (legacy fail-open). So the Clinic plan needs an explicit row for
-- EVERY key in the matrix — true for the clinic set, false for everything else.
-- A missing row here is a revenue leak, not a cosmetic gap.
--
-- The key universe is the union of every key any plan already knows about,
-- PLUS the canonical keys that no plan row has ever covered. Seeding only from
-- Professional would miss exactly those (ipc, fms, ai_clinical, research,
-- ai_suite at time of writing) and hand them to the cheapest tier for free.
--
-- ai_suite is deliberately TRUE: AI is bundled on every plan today, and
-- metering it is Phase 2. Withholding it here would be a new restriction that
-- this change was not scoped to make.
--
-- ON CONFLICT DO NOTHING: later /platform edits are never clobbered.
INSERT INTO public.plan_features (plan_id, module_key, is_enabled)
SELECT
  '10000000-0000-0000-0000-000000000004',
  k.module_key,
  k.module_key IN (
    'opd', 'day_care', 'billing', 'payments', 'day_closure',
    'pharmacy_retail', 'lab', 'patient_portal', 'inbox', 'settings',
    'ai_suite'
  )
FROM (
  SELECT DISTINCT module_key FROM public.plan_features
  UNION
  SELECT unnest(ARRAY['ipc', 'fms', 'ai_clinical', 'research', 'ai_suite'])
) k
ON CONFLICT (plan_id, module_key) DO NOTHING;

-- ── 4. Canonical billed-bed count ────────────────────────────
-- ONE definition of "how many beds does this hospital have", shared by the
-- client (SubscribeButton price preview) and the edge functions (checkout,
-- plan change, renewal reprice). Mirrors the migration-150 enforcement
-- trigger's count exactly, so the billed count and the enforced count can
-- never diverge.
CREATE OR REPLACE FUNCTION public.current_active_beds(p_hospital_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::integer
  FROM beds
  WHERE hospital_id = p_hospital_id
    AND is_active = true;
$$;

GRANT EXECUTE ON FUNCTION public.current_active_beds(uuid) TO authenticated;
