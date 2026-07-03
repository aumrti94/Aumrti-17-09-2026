-- bed_reservations: pre-book a bed for elective/planned admissions.
-- The bed_status enum already has 'reserved' (unused until now).
-- On reservation creation, the caller also sets beds.status = 'reserved'.
-- On check-in, beds.status is set to 'occupied' by the existing admission flow.
-- On cancellation, the caller sets beds.status back to 'available'.

CREATE TABLE IF NOT EXISTS public.bed_reservations (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id            uuid        NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  bed_id                 uuid        NOT NULL REFERENCES public.beds(id),
  patient_id             uuid        NOT NULL REFERENCES public.patients(id),
  doctor_id              uuid        REFERENCES public.users(id),
  planned_admission_date date        NOT NULL,
  reserved_at            timestamptz NOT NULL DEFAULT now(),
  reserved_by            uuid        REFERENCES public.users(id),
  status                 text        NOT NULL DEFAULT 'reserved'
                           CHECK (status IN ('reserved', 'checked_in', 'cancelled', 'no_show')),
  admission_id           uuid        REFERENCES public.admissions(id),
  cancellation_reason    text,
  cancelled_at           timestamptz,
  notes                  text,
  created_at             timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bed_reservations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hospital_staff_rw" ON public.bed_reservations
  FOR ALL TO authenticated
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());

CREATE INDEX IF NOT EXISTS bed_reservations_hospital_date_idx
  ON public.bed_reservations (hospital_id, planned_admission_date);

CREATE INDEX IF NOT EXISTS bed_reservations_bed_active_idx
  ON public.bed_reservations (bed_id)
  WHERE status = 'reserved';
