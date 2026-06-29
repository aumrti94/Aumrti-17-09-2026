-- ── Gap 10: Medication Reconciliation ────────────────────────────────────────

-- Best Possible Medication History — pre-admission home medications
CREATE TABLE IF NOT EXISTS public.bpmh_records (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  patient_id      uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  admission_id    uuid NOT NULL REFERENCES public.admissions(id) ON DELETE CASCADE,
  drug_name       text NOT NULL,
  dose            text,
  route           text,
  frequency       text,
  indication      text,
  prescriber      text,
  last_taken_date date,
  source          text DEFAULT 'patient_reported'
    CHECK (source IN ('patient_reported','caregiver_reported','prescription_card','pharmacy_record','gp_letter')),
  recorded_by     uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bpmh_admission
  ON public.bpmh_records (hospital_id, admission_id);

ALTER TABLE public.bpmh_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bpmh_hospital_iso" ON public.bpmh_records;
CREATE POLICY "bpmh_hospital_iso" ON public.bpmh_records
  FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());


-- Reconciliation events — one per transition point (admission, transfer, discharge)
CREATE TABLE IF NOT EXISTS public.med_reconciliation_events (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id           uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  admission_id          uuid NOT NULL REFERENCES public.admissions(id) ON DELETE CASCADE,
  event_type            text NOT NULL CHECK (event_type IN ('admission', 'transfer', 'discharge')),
  reconciled_at         timestamptz NOT NULL DEFAULT now(),
  reconciled_by         uuid REFERENCES auth.users(id),
  verified_by           uuid REFERENCES auth.users(id),  -- second verifier (pharmacist/doctor)
  discrepancy_count     integer NOT NULL DEFAULT 0,
  unresolved_count      integer NOT NULL DEFAULT 0,
  notes                 text,
  UNIQUE (admission_id, event_type)
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_admission
  ON public.med_reconciliation_events (hospital_id, admission_id);

ALTER TABLE public.med_reconciliation_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reconciliation_events_hospital_iso" ON public.med_reconciliation_events;
CREATE POLICY "reconciliation_events_hospital_iso" ON public.med_reconciliation_events
  FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());


-- Individual discrepancies found during reconciliation
CREATE TABLE IF NOT EXISTS public.reconciliation_discrepancies (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id         uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  admission_id        uuid NOT NULL REFERENCES public.admissions(id) ON DELETE CASCADE,
  reconciliation_id   uuid REFERENCES public.med_reconciliation_events(id) ON DELETE CASCADE,
  drug_name           text NOT NULL,
  discrepancy_type    text NOT NULL
    CHECK (discrepancy_type IN ('omitted','added','dose_changed','route_changed','frequency_changed','duplicate','contraindicated')),
  bpmh_detail         text,
  current_detail      text,
  clinical_reason     text,
  is_intentional      boolean DEFAULT false,
  resolved            boolean DEFAULT false,
  resolved_by         uuid REFERENCES auth.users(id),
  resolved_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_discrepancies_admission
  ON public.reconciliation_discrepancies (hospital_id, admission_id, resolved);

ALTER TABLE public.reconciliation_discrepancies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "discrepancies_hospital_iso" ON public.reconciliation_discrepancies;
CREATE POLICY "discrepancies_hospital_iso" ON public.reconciliation_discrepancies
  FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());


-- High-alert medication double-check log (two-nurse sign-off)
CREATE TABLE IF NOT EXISTS public.high_alert_double_checks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  admission_id    uuid NOT NULL REFERENCES public.admissions(id) ON DELETE CASCADE,
  drug_name       text NOT NULL,
  dose            text,
  route           text,
  first_check_by  uuid NOT NULL REFERENCES auth.users(id),
  second_check_by uuid REFERENCES auth.users(id),
  first_check_at  timestamptz NOT NULL DEFAULT now(),
  second_check_at timestamptz,
  both_verified   boolean NOT NULL DEFAULT false,
  notes           text
);

CREATE INDEX IF NOT EXISTS idx_high_alert_checks_admission
  ON public.high_alert_double_checks (hospital_id, admission_id, both_verified);

ALTER TABLE public.high_alert_double_checks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "high_alert_checks_hospital_iso" ON public.high_alert_double_checks;
CREATE POLICY "high_alert_checks_hospital_iso" ON public.high_alert_double_checks
  FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());
