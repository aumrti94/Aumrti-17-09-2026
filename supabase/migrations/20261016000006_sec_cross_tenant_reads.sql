-- Phase 0.6 — close the remaining cross-tenant reads.
--
-- ROOT CAUSE (RC-1/RC-2): USING (true) SELECT policies on tables that carry hospital_id, so one
-- tenant can read another's rows. Each is handled according to how the application actually
-- consumes it — verified by call-site scan before writing.
--
-- DELIBERATELY NOT TOUCHED: eleven further USING (true) tables are global reference or platform
-- catalogues where cross-tenant read is the REQUIREMENT, not a defect — drug_interactions,
-- drug_allergy_cross_reactivity, nabh_chapter_names, quality_indicator_definitions,
-- plan_features, subscription_plans, addon_skus, platform_incidents, platform_incident_updates,
-- platform_feature_flags, ai_feature_classes. Those are correct as built.
--
-- ALSO NOT TOUCHED — platform_ai_provider_config. Its read policy is USING (true) for
-- authenticated, which exposes api_key_ref across tenants. It is left as-is deliberately:
--   * src/lib/aiProvider.ts issues select("*") on it for EVERY hospital to resolve which
--     provider/model to use, so a tenant-scoped or admin-only read would break AI features
--     platform-wide;
--   * column-level grants cannot help here either, because platform admins authenticate with
--     the same `authenticated` role and PlatformAIConfigPage needs api_key_ref;
--   * api_key_ref holds a key NAME (e.g. 'env'), not key material — the secrets live in edge
--     function environment variables.
-- Recorded as accepted residual risk rather than breaking working functionality. Writes are
-- already correctly gated by is_aumrti_admin().

BEGIN;

-- ── admission_sequences / opd_token_sequences ────────────────────────────────────────────────
-- Leak: each hospital's admission and per-doctor token counters were readable by every
-- authenticated user — direct patient-volume intelligence about competitors on a shared platform.
-- ZERO application references (verified: no .from() call site anywhere). They are written only by
-- SECURITY DEFINER sequence functions, which bypass RLS. Removing the read policy leaves them
-- reachable by service_role and definer functions only — exactly the intended access.
DROP POLICY IF EXISTS admission_sequences_select  ON public.admission_sequences;
DROP POLICY IF EXISTS opd_token_sequences_select  ON public.opd_token_sequences;
REVOKE ALL ON public.admission_sequences FROM anon, authenticated;
REVOKE ALL ON public.opd_token_sequences FROM anon, authenticated;

-- ── discount_codes ───────────────────────────────────────────────────────────────────────────
-- Leak: every code, value, max_uses and validity window was readable by any authenticated user,
-- so one tenant could discover and apply another's (or an unpublished) code.
-- SubscribeButton.tsx validates a code the user has typed, filtering by code + is_active, so a
-- narrowed predicate keeps that working; DiscountsPage (platform admin CRUD) is unaffected
-- because discount_codes_aumrti_write already grants ALL to is_aumrti_admin().
-- Residual: a determined caller can still enumerate currently-valid codes. Eliminating that
-- needs a lookup RPC, which is an architecture change and out of scope for this phase.
DROP POLICY IF EXISTS discount_codes_public_read ON public.discount_codes;
CREATE POLICY discount_codes_active_read ON public.discount_codes
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    is_active = true
    AND (valid_from  IS NULL OR valid_from  <= now())
    AND (valid_until IS NULL OR valid_until >= now())
  );
REVOKE ALL ON public.discount_codes FROM anon;

-- ── ai_language_settings ─────────────────────────────────────────────────────────────────────
-- Leak: per-hospital AI language configuration readable by the `public` role (anon included).
-- Consumers: useVoiceScribeLanguages.ts, SettingsAILanguagePage (both authenticated) and
-- AdvancedQueueDisplayPage, which filters .eq("hospital_id", hospitalId) and already requires an
-- authenticated session for opd_tokens. The management policy is already tenant-scoped.
DROP POLICY IF EXISTS "Anyone can read ai_language_settings" ON public.ai_language_settings;
CREATE POLICY ai_language_settings_tenant_read ON public.ai_language_settings
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    hospital_id = (SELECT public.get_user_hospital_id())
    OR (SELECT public.is_aumrti_admin())
  );
REVOKE ALL ON public.ai_language_settings FROM anon;

-- ── tv_display_settings ──────────────────────────────────────────────────────────────────────
-- Same shape as above: per-hospital display configuration readable by `public`.
-- Consumers: SettingsTVDisplayPage (authenticated) and AdvancedQueueDisplayPage, which filters
-- by hospital_id and already needs a session to render the board at all.
DROP POLICY IF EXISTS "Anyone can read tv_display_settings" ON public.tv_display_settings;
CREATE POLICY tv_display_settings_tenant_read ON public.tv_display_settings
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    hospital_id = (SELECT public.get_user_hospital_id())
    OR (SELECT public.is_aumrti_admin())
  );
REVOKE ALL ON public.tv_display_settings FROM anon;

COMMIT;
