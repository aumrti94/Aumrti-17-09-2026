-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- Correct the platform seller domain: aumrti.in → aumrti.com
--
-- The product's domain is aumrti.com. `platform_billing_settings` was created in
-- 20261008000154_platform_billing_v2.sql with column DEFAULTs of 'support@aumrti.in' and
-- 'aumrti.in', and the same migration seeds row id = 1 immediately.
--
-- That row is what generate-invoice reads:
--
--     support_email: seller?.support_email ?? SUPPORT_EMAIL,
--     website:       seller?.website       ?? APP_DOMAIN,
--
-- Because the row exists, the `??` fallback never applies — so fixing the constant in code was
-- not enough. Every platform invoice raised so far carries the wrong support address and website
-- in its footer, taken from this table.
--
-- Both the stored values and the column DEFAULTs are corrected, so a future reset does not
-- reintroduce it.
--
-- Only the two branded values are touched. GSTIN, PAN, CIN, address and tax rate are the
-- company's real registration details and are none of this migration's business.
-- ═════════════════════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'platform_billing_settings'
  ) THEN
    RAISE NOTICE 'platform_billing_settings not present — nothing to correct.';
    RETURN;
  END IF;

  ALTER TABLE public.platform_billing_settings
    ALTER COLUMN support_email SET DEFAULT 'support@aumrti.com';
  ALTER TABLE public.platform_billing_settings
    ALTER COLUMN website SET DEFAULT 'aumrti.com';

  -- Scoped to the known-wrong values rather than a blanket overwrite: if someone has already set
  -- a deliberate support address, it is left alone.
  UPDATE public.platform_billing_settings
     SET support_email = 'support@aumrti.com'
   WHERE support_email = 'support@aumrti.in';

  UPDATE public.platform_billing_settings
     SET website = 'aumrti.com'
   WHERE website = 'aumrti.in';

  RAISE NOTICE 'platform_billing_settings now uses aumrti.com for support_email and website.';
END $$;
