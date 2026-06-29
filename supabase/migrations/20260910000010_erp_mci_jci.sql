-- ── Gap 16: ERP Completion ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.budget_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  fiscal_year     text NOT NULL,        -- e.g. "2026-27"
  period_month    integer,              -- 1-12 (null = annual budget)
  department_id   uuid REFERENCES public.departments(id),
  cost_centre_id  uuid,
  account_code    text NOT NULL,
  account_name    text NOT NULL,
  budgeted_amount numeric(14,2) NOT NULL DEFAULT 0,
  actual_amount   numeric(14,2) NOT NULL DEFAULT 0,
  variance        numeric(14,2) GENERATED ALWAYS AS (budgeted_amount - actual_amount) STORED,
  status          text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','pending_approval','approved','rejected')),
  approved_by     uuid REFERENCES auth.users(id),
  approved_at     timestamptz,
  notes           text,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_budget_lines_hospital
  ON public.budget_lines (hospital_id, fiscal_year, period_month);

ALTER TABLE public.budget_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "budget_lines_hospital_iso" ON public.budget_lines;
CREATE POLICY "budget_lines_hospital_iso" ON public.budget_lines
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());


CREATE TABLE IF NOT EXISTS public.fixed_assets (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id         uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  asset_code          text NOT NULL,
  asset_name          text NOT NULL,
  category            text NOT NULL
    CHECK (category IN ('medical_equipment','furniture','it_equipment','vehicle','building','land','other')),
  department_id       uuid REFERENCES public.departments(id),
  location            text,
  purchase_date       date NOT NULL,
  purchase_cost       numeric(14,2) NOT NULL,
  useful_life_years   integer NOT NULL DEFAULT 5,
  depreciation_method text NOT NULL DEFAULT 'straight_line'
    CHECK (depreciation_method IN ('straight_line','wdv')),
  depreciation_rate   numeric(5,2),    -- % per year; if null, derived from useful life
  salvage_value       numeric(14,2) NOT NULL DEFAULT 0,
  current_book_value  numeric(14,2),
  accumulated_dep     numeric(14,2) NOT NULL DEFAULT 0,
  status              text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','disposed','under_maintenance','fully_depreciated')),
  disposed_at         date,
  disposal_value      numeric(14,2),
  vendor              text,
  serial_number       text,
  warranty_expiry     date,
  amc_expiry          date,
  invoice_number      text,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hospital_id, asset_code)
);

CREATE INDEX IF NOT EXISTS idx_fixed_assets_hospital
  ON public.fixed_assets (hospital_id, category, status);

ALTER TABLE public.fixed_assets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fixed_assets_hospital_iso" ON public.fixed_assets;
CREATE POLICY "fixed_assets_hospital_iso" ON public.fixed_assets
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());


-- ── Gap 21: MCI / Disaster Response ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.mci_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  event_name      text NOT NULL,
  incident_type   text NOT NULL CHECK (incident_type IN ('natural_disaster','mass_casualty','fire','chemical','biological','radiological','infrastructure','other')),
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','standby','deactivated')),
  activated_at    timestamptz NOT NULL DEFAULT now(),
  deactivated_at  timestamptz,
  activated_by    uuid REFERENCES auth.users(id),
  deactivated_by  uuid REFERENCES auth.users(id),
  total_casualties integer DEFAULT 0,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mci_triage_patients (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  mci_event_id    uuid NOT NULL REFERENCES public.mci_events(id) ON DELETE CASCADE,
  patient_id      uuid REFERENCES public.patients(id),
  triage_tag      text NOT NULL CHECK (triage_tag IN ('P1_immediate','P2_delayed','P3_minor','P4_expectant','dead')),
  patient_name    text,
  age_approx      integer,
  gender          text,
  chief_complaint text,
  assigned_bed    text,
  triaged_by      uuid REFERENCES auth.users(id),
  triaged_at      timestamptz NOT NULL DEFAULT now(),
  notes           text
);

CREATE INDEX IF NOT EXISTS idx_mci_events_hospital
  ON public.mci_events (hospital_id, status, activated_at DESC);

CREATE INDEX IF NOT EXISTS idx_mci_triage_event
  ON public.mci_triage_patients (hospital_id, mci_event_id, triage_tag);

ALTER TABLE public.mci_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mci_events_hospital_iso" ON public.mci_events;
CREATE POLICY "mci_events_hospital_iso" ON public.mci_events
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

ALTER TABLE public.mci_triage_patients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mci_triage_hospital_iso" ON public.mci_triage_patients;
CREATE POLICY "mci_triage_hospital_iso" ON public.mci_triage_patients
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());


-- ── Gap 20: JCI Accreditation ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.jci_evidence_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  standard_code   text NOT NULL,    -- e.g. "IPSG.1", "ACC.2", "COP.3"
  chapter         text NOT NULL,    -- e.g. "IPSG", "ACC", "COP", "ASC"
  element         text NOT NULL,    -- human-readable standard name
  status          text NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started','in_progress','compliant','non_compliant','not_applicable')),
  evidence_text   text,
  document_url    text,
  last_assessed   date,
  assessed_by     uuid REFERENCES auth.users(id),
  score           integer CHECK (score BETWEEN 0 AND 10),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hospital_id, standard_code)
);

CREATE INDEX IF NOT EXISTS idx_jci_evidence_hospital
  ON public.jci_evidence_items (hospital_id, chapter, status);

ALTER TABLE public.jci_evidence_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "jci_evidence_hospital_iso" ON public.jci_evidence_items;
CREATE POLICY "jci_evidence_hospital_iso" ON public.jci_evidence_items
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());
