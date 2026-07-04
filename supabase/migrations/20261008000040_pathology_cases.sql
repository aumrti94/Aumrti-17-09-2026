-- Phase 7 of Lab/Pathology/LIMS completion plan: minimal-viable histopathology &
-- cytology. The "Pathology" in the module name had no backing workflow at all.
-- Scope (agreed with user): specimen registration → structured gross/micro/impression
-- report → pathologist dual sign-off → print. NO blocks/slides/frozen-section/FNAC
-- tracking (a later plan). Billing rides the existing lab-order rails when linked;
-- standalone registration is allowed (lab_order_id nullable).

CREATE TABLE IF NOT EXISTS public.pathology_cases (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id            uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  patient_id             uuid NOT NULL REFERENCES public.patients(id),
  lab_order_id           uuid REFERENCES public.lab_orders(id) ON DELETE SET NULL,
  case_number            text NOT NULL,
  case_type              text NOT NULL DEFAULT 'histopathology'
                           CHECK (case_type IN ('histopathology', 'cytology')),
  specimen_type          text,
  specimen_site          text,
  clinical_history       text,
  received_at            timestamptz DEFAULT now(),
  gross_description       text,
  microscopic_description text,
  impression             text,
  status                 text NOT NULL DEFAULT 'registered'
                           CHECK (status IN ('registered','grossing','reporting','pending_signoff','signed_off','amended')),
  first_signed_by        uuid REFERENCES public.users(id),
  first_signed_at        timestamptz,
  final_signed_by        uuid REFERENCES public.users(id),
  final_signed_at        timestamptz,
  amendment_reason       text,
  created_by             uuid REFERENCES public.users(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hospital_id, case_number)
);

CREATE INDEX IF NOT EXISTS idx_pathology_cases_hospital ON public.pathology_cases (hospital_id, status);
CREATE INDEX IF NOT EXISTS idx_pathology_cases_patient  ON public.pathology_cases (patient_id);
CREATE INDEX IF NOT EXISTS idx_pathology_cases_order    ON public.pathology_cases (lab_order_id);

ALTER TABLE public.pathology_cases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own hospital pathology cases" ON public.pathology_cases
  FOR SELECT TO authenticated USING (hospital_id = get_user_hospital_id());
CREATE POLICY "Users can manage own hospital pathology cases" ON public.pathology_cases
  FOR ALL TO authenticated
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());

-- Per-hospital-per-day case number, prefix by case type (HP- histopathology, CY- cytology).
-- Reuses the atomic bill_sequences mechanism (prefix is the type code).
CREATE OR REPLACE FUNCTION public.next_pathology_case_number(p_hospital_id uuid, p_case_type text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.generate_bill_number(p_hospital_id, CASE WHEN p_case_type = 'cytology' THEN 'CY' ELSE 'HP' END);
$$;

GRANT EXECUTE ON FUNCTION public.next_pathology_case_number(uuid, text) TO authenticated;
