-- ═══════════════════════════════════════════════════════════════════════════
-- Platform billing v2 — annual plans, correct pricing, complete payment history
--
-- Closes four defects in the hospital→Aumrti payment path:
--
--  1. Only monthly was purchasable. `create-razorpay-subscription` hardcoded
--     period:'monthly' + price_monthly, so the price_yearly on 5 plans was
--     advertised but unbuyable.
--  2. `hospital_pricing_overrides` was never read at checkout — a negotiated
--     rate showed in the console and the hospital was charged list price.
--  3. Coupon discounts were computed for the response payload only; the
--     Razorpay subscription bound to a list-price plan. No coupon ever
--     reduced a charge.
--  4. Only successful charges were recorded. Failed and refunded payments
--     left no trace, so payment history could not be trusted.
--
-- (2) and (3) share a root cause: `subscription_plans.razorpay_plan_id` can
-- hold exactly ONE Razorpay plan, but a Razorpay plan is an immutable
-- (period, interval, amount) tuple and the amount actually charged varies per
-- hospital. Hence `razorpay_plan_registry` below.
--
-- Safe to apply: verified live that there are 0 invoices, 0 Razorpay mandates
-- and 0 razorpay_plan_ids, so there is nothing to migrate or backfill.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- 1. hospital_subscriptions — billing cycle + what we actually charge
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.hospital_subscriptions
  ADD COLUMN IF NOT EXISTS billing_cycle text NOT NULL DEFAULT 'monthly';

-- The amount bound to the Razorpay plan, after override and coupon. Stored so
-- MRR, dunning and invoices stop re-deriving it from subscription_plans (which
-- is what let the displayed price and the charged price diverge).
ALTER TABLE public.hospital_subscriptions
  ADD COLUMN IF NOT EXISTS effective_amount_inr numeric(12,2);

ALTER TABLE public.hospital_subscriptions
  ADD COLUMN IF NOT EXISTS payment_method text;
ALTER TABLE public.hospital_subscriptions
  ADD COLUMN IF NOT EXISTS payment_method_detail text;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'hospital_subscriptions_billing_cycle_check'
    AND   conrelid = 'public.hospital_subscriptions'::regclass
  ) THEN
    ALTER TABLE public.hospital_subscriptions
      ADD CONSTRAINT hospital_subscriptions_billing_cycle_check
      CHECK (billing_cycle IN ('monthly','yearly'));
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 2. subscription_invoices — GST breakup, payment identity, failures/refunds
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.subscription_invoices
  ADD COLUMN IF NOT EXISTS currency        text NOT NULL DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS subtotal_inr    numeric(12,2),
  ADD COLUMN IF NOT EXISTS cgst_inr        numeric(12,2),
  ADD COLUMN IF NOT EXISTS sgst_inr        numeric(12,2),
  ADD COLUMN IF NOT EXISTS igst_inr        numeric(12,2),
  ADD COLUMN IF NOT EXISTS tax_rate_pct    numeric(5,2) DEFAULT 18,
  ADD COLUMN IF NOT EXISTS place_of_supply text,
  ADD COLUMN IF NOT EXISTS seller_gstin    text,
  ADD COLUMN IF NOT EXISTS buyer_gstin     text,
  ADD COLUMN IF NOT EXISTS sac_code        text DEFAULT '998313',
  ADD COLUMN IF NOT EXISTS billing_cycle   text,
  ADD COLUMN IF NOT EXISTS subscription_id uuid REFERENCES public.hospital_subscriptions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_method        text,
  ADD COLUMN IF NOT EXISTS payment_method_detail text,
  ADD COLUMN IF NOT EXISTS payment_captured_at   timestamptz,
  ADD COLUMN IF NOT EXISTS failure_reason  text,
  ADD COLUMN IF NOT EXISTS failure_code    text,
  ADD COLUMN IF NOT EXISTS razorpay_refund_id text,
  ADD COLUMN IF NOT EXISTS refund_amount_inr  numeric(12,2),
  ADD COLUMN IF NOT EXISTS refunded_at        timestamptz,
  ADD COLUMN IF NOT EXISTS document_format    text,
  ADD COLUMN IF NOT EXISTS invoice_type       text NOT NULL DEFAULT 'tax_invoice';

-- `pdf_storage_path` is reused as-is for the PDF (no stored HTML invoices exist
-- to keep readable). `document_format` records what was actually written so the
-- download button stops claiming "PDF" when a degraded HTML fallback was saved.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'subscription_invoices_document_format_check'
    AND   conrelid = 'public.subscription_invoices'::regclass
  ) THEN
    ALTER TABLE public.subscription_invoices
      ADD CONSTRAINT subscription_invoices_document_format_check
      CHECK (document_format IS NULL OR document_format IN ('pdf','html'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'subscription_invoices_invoice_type_check'
    AND   conrelid = 'public.subscription_invoices'::regclass
  ) THEN
    ALTER TABLE public.subscription_invoices
      ADD CONSTRAINT subscription_invoices_invoice_type_check
      CHECK (invoice_type IN ('tax_invoice','payment_attempt','credit_note'));
  END IF;
END $$;

-- Widen status: the original CHECK allowed only paid/failed/refunded.
ALTER TABLE public.subscription_invoices
  DROP CONSTRAINT IF EXISTS subscription_invoices_status_check;
ALTER TABLE public.subscription_invoices
  ADD CONSTRAINT subscription_invoices_status_check
  CHECK (status IN ('paid','failed','refunded','partially_refunded','pending'));

CREATE INDEX IF NOT EXISTS idx_sub_invoices_hospital_created
  ON public.subscription_invoices(hospital_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sub_invoices_paid
  ON public.subscription_invoices(created_at DESC) WHERE status = 'paid';
CREATE INDEX IF NOT EXISTS idx_sub_invoices_rzp_payment
  ON public.subscription_invoices(razorpay_payment_id) WHERE razorpay_payment_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- 3. razorpay_plan_registry
--
-- One row per distinct (plan, cycle, amount) actually sold. A negotiated price
-- or a coupon produces its own Razorpay plan instead of silently charging list.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.razorpay_plan_registry (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id          uuid NOT NULL REFERENCES public.subscription_plans(id) ON DELETE CASCADE,
  billing_cycle    text NOT NULL CHECK (billing_cycle IN ('monthly','yearly')),
  amount_paise     bigint NOT NULL CHECK (amount_paise > 0),
  razorpay_plan_id text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, billing_cycle, amount_paise)
);

ALTER TABLE public.razorpay_plan_registry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_read_plan_registry" ON public.razorpay_plan_registry;
CREATE POLICY "admin_read_plan_registry" ON public.razorpay_plan_registry
  FOR SELECT USING (public.is_aumrti_admin());

DROP POLICY IF EXISTS "service_role_plan_registry_all" ON public.razorpay_plan_registry;
CREATE POLICY "service_role_plan_registry_all" ON public.razorpay_plan_registry
  FOR ALL TO service_role USING (true) WITH CHECK (true);

/*
 * Claim-or-read a registry slot.
 *
 * Called twice by checkout: once before hitting Razorpay (cache lookup), and
 * again with the freshly created plan id. The INSERT ... ON CONFLICT DO NOTHING
 * followed by SELECT means two concurrent checkouts for the same price both end
 * up bound to the SAME Razorpay plan — the loser's plan is an orphaned, free,
 * unused Razorpay object rather than a second live plan competing for mandates.
 *
 * A transaction cannot span the Razorpay HTTP call, which is why correctness is
 * pushed into the unique constraint instead of into locking.
 */
CREATE OR REPLACE FUNCTION public.claim_razorpay_plan_slot(
  p_plan_id          uuid,
  p_billing_cycle    text,
  p_amount_paise     bigint,
  p_razorpay_plan_id text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing text;
BEGIN
  SELECT razorpay_plan_id INTO v_existing
    FROM public.razorpay_plan_registry
   WHERE plan_id = p_plan_id
     AND billing_cycle = p_billing_cycle
     AND amount_paise = p_amount_paise;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  -- Lookup-only call (no id yet): tell the caller to create one.
  IF p_razorpay_plan_id IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.razorpay_plan_registry (plan_id, billing_cycle, amount_paise, razorpay_plan_id)
  VALUES (p_plan_id, p_billing_cycle, p_amount_paise, p_razorpay_plan_id)
  ON CONFLICT (plan_id, billing_cycle, amount_paise) DO NOTHING;

  -- Re-read: on conflict the winner is whoever inserted first, and both callers
  -- must return the same id.
  SELECT razorpay_plan_id INTO v_existing
    FROM public.razorpay_plan_registry
   WHERE plan_id = p_plan_id
     AND billing_cycle = p_billing_cycle
     AND amount_paise = p_amount_paise;

  RETURN v_existing;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_razorpay_plan_slot(uuid, text, bigint, text) TO service_role;

-- ─────────────────────────────────────────────────────────────
-- 4. platform_billing_settings — the seller's own identity
--
-- Every invoice generated so far carried the literal text
-- "GST No: [YOUR-GSTIN] · CIN: [YOUR-CIN]" because generate-invoice hardcoded
-- a placeholder. That is not a valid tax invoice, so seller identity becomes
-- configuration rather than a string in an edge function.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.platform_billing_settings (
  id            int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  legal_name    text NOT NULL DEFAULT 'Aumrti Technologies',
  trade_name    text,
  gstin         text,
  state_code    text,
  address_line1 text,
  address_line2 text,
  city          text,
  state         text,
  pincode       text,
  cin           text,
  pan           text,
  sac_code      text NOT NULL DEFAULT '998313',
  tax_rate_pct  numeric(5,2) NOT NULL DEFAULT 18,
  support_email text NOT NULL DEFAULT 'support@aumrti.in',
  website       text DEFAULT 'aumrti.in',
  logo_url      text,
  invoice_notes text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.platform_billing_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.platform_billing_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_manage_billing_settings" ON public.platform_billing_settings;
CREATE POLICY "admin_manage_billing_settings" ON public.platform_billing_settings
  FOR ALL USING (public.is_aumrti_admin()) WITH CHECK (public.is_aumrti_admin());

DROP POLICY IF EXISTS "service_role_billing_settings_all" ON public.platform_billing_settings;
CREATE POLICY "service_role_billing_settings_all" ON public.platform_billing_settings
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- 5. next_document_number — separate series per document type
--
-- Recording failed payments as rows must NOT consume a GST invoice number: the
-- INV- series has to stay gapless for filing. Splitting by invoice_type keeps
-- everything in one table (so one query powers all three UIs) while the tax
-- series only advances on a real charge.
-- ─────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.payment_attempt_number_seq START 1000;
CREATE SEQUENCE IF NOT EXISTS public.credit_note_number_seq START 1000;

CREATE OR REPLACE FUNCTION public.next_document_number(p_hospital_id uuid, p_kind text DEFAULT 'tax_invoice')
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year   text := to_char(now(), 'YYYY');
  v_month  text := to_char(now(), 'MM');
  v_seq    bigint;
  v_short  text := upper(left(replace(p_hospital_id::text, '-', ''), 4));
  v_prefix text;
BEGIN
  CASE p_kind
    WHEN 'tax_invoice'     THEN v_prefix := 'INV'; v_seq := nextval('public.invoice_number_seq');
    WHEN 'payment_attempt' THEN v_prefix := 'ATT'; v_seq := nextval('public.payment_attempt_number_seq');
    WHEN 'credit_note'     THEN v_prefix := 'CN';  v_seq := nextval('public.credit_note_number_seq');
    ELSE RAISE EXCEPTION 'Unknown document kind: %', p_kind;
  END CASE;

  RETURN v_prefix || '-' || v_year || '-' || v_month || '-' || v_short || '-' || lpad(v_seq::text, 4, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_document_number(uuid, text) TO service_role;

-- `next_invoice_number` is retained unchanged so nothing in flight breaks; it is
-- now equivalent to next_document_number(id, 'tax_invoice').
