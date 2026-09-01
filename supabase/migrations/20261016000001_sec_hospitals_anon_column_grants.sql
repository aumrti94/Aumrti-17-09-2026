-- Phase 0.1 — hospitals: restrict `anon` to branding columns only.
--
-- ROOT CAUSE (RC-1): the policy "Anyone can read hospital branding" expresses a COLUMN-level
-- intent with a ROW-level mechanism. RLS filters rows; it cannot hide columns. The policy
-- therefore hands `anon` the entire 63-column row, including third-party credentials:
--   wati_api_key, wati_api_url, meta_access_token, meta_phone_number_id, meta_waba_id,
--   trust_pan, gstin, drug_license_number, nabl_accreditation_number, abha_facility_id.
--
-- Verified before writing this migration:
--   * has_table_privilege('anon','public.hospitals','SELECT') = true  (table-wide)
--   * has_column_privilege('anon',…,'wati_api_key','SELECT')   = true
--   * 6 active hospitals match the policy predicate (is_active = true)
--   * those credential columns are currently EMPTY — this is a latent exposure that arms
--     itself the moment a hospital configures WhatsApp/Meta. trust_pan is populated on 1 row.
--
-- FIX: column-level GRANTs, which are the correct Postgres mechanism for column-level intent.
-- RLS continues to decide WHICH ROWS anon sees; grants now decide WHICH COLUMNS.
--
-- FUNCTIONALITY PRESERVED — the anon-reachable pages read only:
--   PublicAppointmentPage  id, name, logo_url, primary_color, address, phone
--   TVDisplayPage          name, address, logo_url, announcement_text, razorpay_key_id
--   AdvancedQueueDisplay   name, address, logo_url, announcement_text
--   KioskLandingPage       name, logo_url          KioskCheckinPage  name
--   PortalLogin / PatientPortalLogin  id, name, logo_url
--   PortalBills            name, address, razorpay_key_id
-- Every one of those columns is in the grant list below. No `select("*")` on hospitals is
-- reachable by anon (all such call sites are authenticated: settings, platform, insurance).
-- `authenticated` and `service_role` are untouched and retain full access.

BEGIN;

REVOKE SELECT ON public.hospitals FROM anon;

GRANT SELECT (
  id,
  name,
  type,
  logo_url,
  primary_color,
  accent_color,
  theme_accent_color,
  font_family,
  theme_font_family,
  tagline,
  branding_config,
  announcement_text,
  address,
  city,
  state,
  pincode,
  country,
  phone,
  emergency_phone,
  email,
  website,
  subdomain,
  custom_domain,
  is_active,
  razorpay_key_id,   -- Razorpay publishable key id; public by design (used by PortalBills checkout)
  patient_languages,
  established_year
) ON public.hospitals TO anon;

-- anon must never write to hospitals. These grants were table-wide and unused.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.hospitals FROM anon;

COMMIT;
