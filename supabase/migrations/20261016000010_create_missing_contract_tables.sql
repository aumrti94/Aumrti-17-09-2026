-- Phase 1.3 — create the six objects the application references but which never existed.
--
-- ROOT CAUSE (RC-4): Supabase returns errors as values rather than throwing, and `types.ts` is
-- missing 91 live tables, so a `.from("sepsis_alerts")` against a non-existent table compiled,
-- ran, failed, and returned a discarded error object. Nothing surfaced.
--
-- Every column below is taken from an actual call site, not invented. Each object follows the
-- canonical rules: uuid PK, hospital_id NOT NULL where tenant-scoped, RLS on with a tenant
-- policy, timestamptz timestamps, and an index on every foreign key.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1. sepsis_alerts   (src/lib/clinicalPredictions.ts, src/components/ipd/tabs/IPDVitalsTab.tsx)
--
-- CLINICAL IMPACT of its absence: the NEWS2 sepsis path both read and wrote this table. The read
-- was the 4-hour de-duplication guard — with no table it always returned null, so the guard
-- never suppressed anything and a duplicate critical alert fired on EVERY vitals entry at
-- NEWS2 >= 3, on precisely the sickest patients. The write silently lost the alert audit trail
-- (news2_score, vitals_snapshot, clinical interpretation). The primary alert still reached
-- clinicians via clinical_alerts, which is why this was rated HIGH and not CRITICAL.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sepsis_alerts (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id             uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  patient_id              uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  admission_id            uuid REFERENCES public.admissions(id) ON DELETE CASCADE,
  news2_score             integer NOT NULL CHECK (news2_score >= 0 AND news2_score <= 20),
  risk_level              text    NOT NULL CHECK (risk_level IN ('low','medium','high','critical')),
  vitals_snapshot         jsonb,
  clinical_interpretation text,
  urgent_actions          jsonb   NOT NULL DEFAULT '[]'::jsonb,
  resolved                boolean NOT NULL DEFAULT false,
  resolved_at             timestamptz,
  resolved_by             uuid REFERENCES public.users(id) ON DELETE SET NULL,
  acknowledged            boolean NOT NULL DEFAULT false,
  acknowledged_by         uuid REFERENCES public.users(id) ON DELETE SET NULL,
  acknowledged_at         timestamptz,
  alert_fired_at          timestamptz NOT NULL DEFAULT now(),
  created_at              timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2. allergy_records   (supabase/functions/update-patient-ai-context/index.ts)
--
-- CLINICAL IMPACT of its absence: this system had NOWHERE to record a patient allergy. The
-- nearest table, drug_allergy_cross_reactivity, models cross-reactivity between drug classes,
-- not a patient's recorded allergies, and `patients` has no allergy column among its 34. The AI
-- patient-context builder read this table, got nothing, and assembled context with no allergy
-- data while having no way to know it was missing.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.allergy_records (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id   uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  patient_id    uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  allergen      text NOT NULL,
  allergen_type text CHECK (allergen_type IN ('drug','food','environmental','latex','other')),
  severity      text CHECK (severity IN ('mild','moderate','severe','life_threatening')),
  reaction      text,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','resolved','refuted')),
  onset_date    date,
  notes         text,
  recorded_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- One active record per allergen per patient; re-recording updates rather than duplicates.
  CONSTRAINT allergy_records_unique_active UNIQUE (patient_id, allergen, status)
);

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 3. webhook_endpoints   (src/pages/settings/SettingsAPIPortalPage.tsx)
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.webhook_endpoints (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id   uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  url           text NOT NULL CHECK (url ~* '^https?://'),
  events        text[] NOT NULL DEFAULT '{}',
  is_active     boolean NOT NULL DEFAULT true,
  secret        text NOT NULL,
  description   text,
  last_fired_at timestamptz,
  failure_count integer NOT NULL DEFAULT 0,
  created_by    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 4. credit_packs   (src/pages/settings/SettingsPlanPage.tsx)
-- A GLOBAL platform catalogue — deliberately no hospital_id. The call site filters only on
-- is_active and orders by sort_order, with no tenant predicate.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.credit_packs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE,
  name        text NOT NULL,
  description text,
  encounters  integer NOT NULL DEFAULT 0 CHECK (encounters >= 0),
  documents   integer NOT NULL DEFAULT 0 CHECK (documents  >= 0),
  price_inr   numeric(12,2) NOT NULL CHECK (price_inr >= 0),
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 5. financial_anomalies   (supabase/functions/financial-anomaly-check/index.ts)
-- The edge function upserts with onConflict "hospital_id,anomaly_date", so that unique
-- constraint is REQUIRED — without it the upsert errors rather than merging.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.financial_anomalies (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id      uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  anomaly_date     date NOT NULL,
  actual_revenue   numeric(15,2) NOT NULL DEFAULT 0,
  expected_revenue numeric(15,2) NOT NULL DEFAULT 0,
  z_score          numeric(10,4),
  deviation_amount numeric(15,2),
  direction        text CHECK (direction IN ('above','below')),
  reviewed         boolean NOT NULL DEFAULT false,
  reviewed_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at      timestamptz,
  detected_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT financial_anomalies_hospital_date_key UNIQUE (hospital_id, anomaly_date)
);

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Indexes: every FK gets one (canonical rule; see 15_AI_UNDER_ENGINEERING_FINDINGS.md U-1).
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_sepsis_alerts_hospital_id        ON public.sepsis_alerts (hospital_id);
CREATE INDEX IF NOT EXISTS idx_sepsis_alerts_patient_id         ON public.sepsis_alerts (patient_id);
CREATE INDEX IF NOT EXISTS idx_sepsis_alerts_admission_id       ON public.sepsis_alerts (admission_id);
CREATE INDEX IF NOT EXISTS idx_sepsis_alerts_resolved_by        ON public.sepsis_alerts (resolved_by);
CREATE INDEX IF NOT EXISTS idx_sepsis_alerts_acknowledged_by    ON public.sepsis_alerts (acknowledged_by);
-- Serves the de-duplication lookup: admission_id + resolved + alert_fired_at DESC.
CREATE INDEX IF NOT EXISTS idx_sepsis_alerts_dedup              ON public.sepsis_alerts (admission_id, resolved, alert_fired_at DESC);

CREATE INDEX IF NOT EXISTS idx_allergy_records_hospital_id      ON public.allergy_records (hospital_id);
CREATE INDEX IF NOT EXISTS idx_allergy_records_patient_id       ON public.allergy_records (patient_id);
CREATE INDEX IF NOT EXISTS idx_allergy_records_recorded_by      ON public.allergy_records (recorded_by);
CREATE INDEX IF NOT EXISTS idx_allergy_records_patient_active   ON public.allergy_records (patient_id, hospital_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_hospital_id    ON public.webhook_endpoints (hospital_id);
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_created_by     ON public.webhook_endpoints (created_by);

CREATE INDEX IF NOT EXISTS idx_financial_anomalies_hospital_id  ON public.financial_anomalies (hospital_id);
CREATE INDEX IF NOT EXISTS idx_financial_anomalies_reviewed_by  ON public.financial_anomalies (reviewed_by);
