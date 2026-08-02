-- ────────────────────────────────────────────────────────────────────────────
-- Platform Razorpay subscription credentials, editable from /platform.
--
-- Until now the platform's own Razorpay keys existed ONLY as Supabase edge
-- secrets (RAZORPAY_SUBSCRIPTION_KEY_ID / _KEY_SECRET / _WEBHOOK_SECRET). A
-- self-service SaaS operator must be able to set them from the admin UI without
-- touching Supabase, so they move into the platform_billing_settings singleton
-- (same admin + service-role RLS already on that table). Edge functions read the
-- row via service role and fall back to the env vars, so existing deployments
-- keep working until the row is populated.
--
-- The two *secret* columns are write-only from the UI (never SELECTed back), the
-- same pattern already proven for platform_settings.meta_access_token and
-- oauth_provider_settings.client_secret. The key id is not secret (it is the
-- public rzp_* key used in checkout) and may be shown.
--
-- access_grace_days lives here too (used by Phase 2's payment-failure cutoff) so
-- the whole billing/access config has one home the edge + DB trigger can read.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.platform_billing_settings
  ADD COLUMN IF NOT EXISTS razorpay_subscription_key_id        text,
  ADD COLUMN IF NOT EXISTS razorpay_subscription_key_secret    text,
  ADD COLUMN IF NOT EXISTS razorpay_subscription_webhook_secret text,
  ADD COLUMN IF NOT EXISTS payment_gateway_enabled             boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS access_grace_days                   integer NOT NULL DEFAULT 3;

-- Guard against a nonsensical negative buffer.
ALTER TABLE public.platform_billing_settings
  DROP CONSTRAINT IF EXISTS platform_billing_settings_grace_days_nonneg;
ALTER TABLE public.platform_billing_settings
  ADD CONSTRAINT platform_billing_settings_grace_days_nonneg
  CHECK (access_grace_days >= 0 AND access_grace_days <= 30);

-- ── Secrets-safe status view for the admin UI ──────────────────────────────
-- Lets /platform show what is configured (key id + whether each secret is set +
-- the toggles) WITHOUT ever returning the secret values. Admin-only.
-- DROP first so a re-run with a changed column set can never hit 42P16.
DROP VIEW IF EXISTS public.platform_payment_config_status;
CREATE VIEW public.platform_payment_config_status AS
SELECT
  razorpay_subscription_key_id AS key_id,
  (razorpay_subscription_key_secret     IS NOT NULL
     AND length(razorpay_subscription_key_secret) > 0)     AS has_key_secret,
  (razorpay_subscription_webhook_secret IS NOT NULL
     AND length(razorpay_subscription_webhook_secret) > 0) AS has_webhook_secret,
  payment_gateway_enabled,
  access_grace_days
FROM public.platform_billing_settings
WHERE id = 1 AND public.is_aumrti_admin();

REVOKE ALL ON public.platform_payment_config_status FROM anon;
GRANT SELECT ON public.platform_payment_config_status TO authenticated;
