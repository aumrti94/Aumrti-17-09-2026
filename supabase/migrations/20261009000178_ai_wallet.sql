-- ────────────────────────────────────────────────────────────────────────────
-- Prepaid AI credits wallet.
--
-- Self-service SaaS AI billing: a hospital tops up a ₹ balance, and AI usage
-- beyond the plan's included monthly allowance draws it down live. The wallet is
-- a SOFT cost control — it may go negative and a clinical/safety AI call is NEVER
-- blocked on balance (safety-class features are not billed at all). Metering that
-- writes the ledger is fire-and-forget: it must never fail an AI call.
--
-- Two tables + two RPCs:
--   hospital_ai_wallet      — the running balance per hospital (one row).
--   ai_wallet_transactions  — immutable ledger; balance_after frozen per row.
--   apply_ai_wallet_delta   — atomic credit/debit + ledger write (idempotent topups).
--   debit_ai_wallet_for_usage — hot-path helper: bills only the overage above the
--                               plan's ai_included_budget_inr, skips safety AI.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.hospital_ai_wallet (
  hospital_id               uuid PRIMARY KEY REFERENCES public.hospitals(id) ON DELETE CASCADE,
  balance_inr               numeric(14, 4) NOT NULL DEFAULT 0,
  low_balance_threshold_inr numeric(14, 2) NOT NULL DEFAULT 500,
  auto_recharge_enabled     boolean NOT NULL DEFAULT false,
  auto_recharge_amount_inr  numeric(14, 2),
  low_balance_notified_at   timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ai_wallet_transactions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id       uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  -- signed delta: topup/grant/refund > 0, debit < 0, adjustment either.
  type              text NOT NULL CHECK (type IN ('topup', 'debit', 'grant', 'adjustment', 'refund')),
  amount_inr        numeric(14, 4) NOT NULL,
  balance_after_inr numeric(14, 4) NOT NULL,
  source            text,      -- razorpay_payment_id / admin user id / null
  feature_key       text,
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_wallet_txn_hospital
  ON public.ai_wallet_transactions (hospital_id, created_at DESC);

-- A given Razorpay payment can only ever credit the wallet once.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_wallet_topup_source
  ON public.ai_wallet_transactions (source)
  WHERE type = 'topup' AND source IS NOT NULL;

-- ── RLS: hospital reads own, admin reads all; writes only via RPC/service role ─
ALTER TABLE public.hospital_ai_wallet ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_wallet_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_wallet_select" ON public.hospital_ai_wallet;
CREATE POLICY "ai_wallet_select" ON public.hospital_ai_wallet
  FOR SELECT TO authenticated
  USING (hospital_id = public.get_user_hospital_id() OR public.is_aumrti_admin());

DROP POLICY IF EXISTS "ai_wallet_service" ON public.hospital_ai_wallet;
CREATE POLICY "ai_wallet_service" ON public.hospital_ai_wallet
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "ai_wallet_txn_select" ON public.ai_wallet_transactions;
CREATE POLICY "ai_wallet_txn_select" ON public.ai_wallet_transactions
  FOR SELECT TO authenticated
  USING (hospital_id = public.get_user_hospital_id() OR public.is_aumrti_admin());

DROP POLICY IF EXISTS "ai_wallet_txn_service" ON public.ai_wallet_transactions;
CREATE POLICY "ai_wallet_txn_service" ON public.ai_wallet_transactions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── Atomic credit/debit + ledger write ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.apply_ai_wallet_delta(
  p_hospital_id uuid,
  p_amount_inr  numeric,
  p_type        text,
  p_feature_key text  DEFAULT NULL,
  p_source      text  DEFAULT NULL,
  p_metadata    jsonb DEFAULT '{}'::jsonb
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance numeric;
BEGIN
  -- Callers: service_role (edge metering / topup webhook) may do anything. An
  -- authenticated user may only be a platform admin issuing a manual grant or
  -- adjustment — hospitals can never move their own balance directly.
  IF auth.uid() IS NOT NULL THEN
    IF NOT public.is_aumrti_admin() THEN
      RAISE EXCEPTION 'Not authorised to modify AI wallet';
    END IF;
    IF p_type NOT IN ('grant', 'adjustment') THEN
      RAISE EXCEPTION 'Manual wallet changes must be grant or adjustment';
    END IF;
  END IF;

  -- Idempotent external credits: a replayed topup for a payment already booked
  -- is a no-op. The partial unique index is the hard backstop.
  IF p_type = 'topup' AND p_source IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM ai_wallet_transactions WHERE type = 'topup' AND source = p_source) THEN
      SELECT balance_inr INTO v_balance FROM hospital_ai_wallet WHERE hospital_id = p_hospital_id;
      RETURN COALESCE(v_balance, 0);
    END IF;
  END IF;

  INSERT INTO hospital_ai_wallet (hospital_id, balance_inr)
    VALUES (p_hospital_id, 0)
    ON CONFLICT (hospital_id) DO NOTHING;

  UPDATE hospital_ai_wallet
     SET balance_inr = balance_inr + p_amount_inr,
         updated_at  = now()
   WHERE hospital_id = p_hospital_id
   RETURNING balance_inr INTO v_balance;

  INSERT INTO ai_wallet_transactions
    (hospital_id, type, amount_inr, balance_after_inr, source, feature_key, metadata)
  VALUES
    (p_hospital_id, p_type, p_amount_inr, v_balance, p_source, p_feature_key, COALESCE(p_metadata, '{}'::jsonb));

  RETURN v_balance;
END;
$$;

-- Service role (edge) + authenticated (admin grant, guarded above).
GRANT EXECUTE ON FUNCTION public.apply_ai_wallet_delta(uuid, numeric, text, text, text, jsonb) TO service_role, authenticated;

-- ── Hot-path debit: bill only the overage above the included allowance ─────
-- Called by the metering choke points AFTER ai_cost_daily is upserted, so the
-- month-to-date figure already includes this call. Safety-class AI and zero-cost
-- calls are no-ops. NEVER blocks — the wallet simply goes negative if unfunded.
CREATE OR REPLACE FUNCTION public.debit_ai_wallet_for_usage(
  p_hospital_id uuid,
  p_feature_key text,
  p_cost_inr    numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_safety     boolean;
  v_included   numeric;
  v_mtd_after  numeric;
  v_mtd_before numeric;
  v_overage    numeric;
  v_safe_keys  text[] := ARRAY['drug_interaction_analysis','adr_detector','sepsis_early_warning','critical_incidental_finder'];
BEGIN
  IF p_hospital_id IS NULL OR COALESCE(p_cost_inr, 0) <= 0 THEN
    RETURN;
  END IF;

  -- Safety-class AI is never billed (mirrors SAFETY_AI_FEATURE_KEYS).
  IF p_feature_key = ANY (v_safe_keys) THEN
    RETURN;
  END IF;

  -- Plan's monthly included allowance (NULL / <=0 → no free allowance).
  SELECT sp.ai_included_budget_inr INTO v_included
    FROM hospital_subscriptions hs
    JOIN subscription_plans sp ON sp.id = hs.plan_id
   WHERE hs.hospital_id = p_hospital_id;
  v_included := GREATEST(COALESCE(v_included, 0), 0);

  -- MTD non-safety spend, which already includes this call.
  SELECT COALESCE(SUM(total_cost_inr), 0) INTO v_mtd_after
    FROM ai_cost_daily
   WHERE hospital_id = p_hospital_id
     AND date >= date_trunc('month', current_date)::date
     AND feature_key <> ALL (v_safe_keys);

  v_mtd_before := GREATEST(v_mtd_after - p_cost_inr, 0);

  -- The slice of THIS call that lies above the included allowance.
  v_overage := GREATEST(v_mtd_after - v_included, 0) - GREATEST(v_mtd_before - v_included, 0);
  IF v_overage <= 0 THEN
    RETURN;
  END IF;

  PERFORM public.apply_ai_wallet_delta(
    p_hospital_id, -v_overage, 'debit', p_feature_key, NULL,
    jsonb_build_object('mtd_after', v_mtd_after, 'included', v_included));
END;
$$;

GRANT EXECUTE ON FUNCTION public.debit_ai_wallet_for_usage(uuid, text, numeric) TO service_role;
