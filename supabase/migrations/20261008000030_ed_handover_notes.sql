-- Phase 5 of nursing module completion plan: ED nursing handover note.
-- ED already has a real medication log (ed_medications/EDMedicationPanel.tsx) — the actual gap
-- is continuity for patients boarding in the ED before a bed/ward assignment exists. Deliberately
-- NOT reusing nursing_handovers (its ward_id is NOT NULL — a pre-admission ED encounter has no
-- ward) and deliberately not loosening that constraint on the just-stabilized IPD table.

CREATE TABLE IF NOT EXISTS public.ed_handover_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  ed_visit_id uuid REFERENCES public.ed_visits(id) ON DELETE CASCADE NOT NULL,
  patient_id uuid REFERENCES public.patients(id) NOT NULL,
  outgoing_nurse_id uuid REFERENCES public.users(id) NOT NULL,
  incoming_nurse_id uuid REFERENCES public.users(id),
  note text NOT NULL,
  flags jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ed_handover_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own hospital ed_handover_notes"
  ON public.ed_handover_notes FOR SELECT TO authenticated
  USING (hospital_id = get_user_hospital_id());

CREATE POLICY "Users can manage own hospital ed_handover_notes"
  ON public.ed_handover_notes FOR ALL TO authenticated
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());

CREATE INDEX IF NOT EXISTS idx_ed_handover_notes_visit ON public.ed_handover_notes(ed_visit_id);
CREATE INDEX IF NOT EXISTS idx_ed_handover_notes_hospital ON public.ed_handover_notes(hospital_id);
