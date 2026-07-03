-- OT Gap review (Phase 5): real opening/closing instrument, sponge & needle count log
CREATE TABLE public.ot_instrument_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  ot_schedule_id uuid REFERENCES public.ot_schedules(id) NOT NULL,
  count_type text NOT NULL CHECK (count_type IN ('instrument','sponge','needle')),
  opening_count integer,
  closing_count integer,
  counted_by uuid,
  discrepancy_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ot_schedule_id, count_type)
);

CREATE INDEX idx_ot_instrument_counts_schedule ON public.ot_instrument_counts(ot_schedule_id);

ALTER TABLE public.ot_instrument_counts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own hospital ot_instrument_counts" ON public.ot_instrument_counts FOR SELECT TO authenticated USING (hospital_id = get_user_hospital_id());
CREATE POLICY "Users can manage own hospital ot_instrument_counts" ON public.ot_instrument_counts FOR ALL TO authenticated USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());
