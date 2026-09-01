-- Audit trail for mid-stay bed/ward transfers. Previously a transfer just overwrote
-- admissions.ward_id/bed_id in place, destroying the prior value with no timestamp — so
-- room/nursing billing could only ever price the WHOLE stay at whatever ward the patient
-- currently occupies. This table is what lets billing split charges by segment: the old
-- ward for the days before the transfer, the new ward from the transfer onward.
CREATE TABLE public.bed_transfers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id       UUID NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  admission_id      UUID NOT NULL REFERENCES public.admissions(id) ON DELETE CASCADE,
  patient_id        UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  -- Nullable and SET NULL: these describe history only. A ward later deactivated/deleted
  -- should not be blocked by an audit row that merely mentions it.
  from_ward_id      UUID REFERENCES public.wards(id) ON DELETE SET NULL,
  from_bed_id       UUID REFERENCES public.beds(id) ON DELETE SET NULL,
  to_ward_id        UUID NOT NULL REFERENCES public.wards(id) ON DELETE RESTRICT,
  to_bed_id         UUID NOT NULL REFERENCES public.beds(id) ON DELETE RESTRICT,
  transferred_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason            TEXT,
  transferred_by    UUID REFERENCES public.users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.bed_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hospital_isolation" ON public.bed_transfers
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- Serves the one query pattern every consumer needs: an admission's transfers in order.
CREATE INDEX ON public.bed_transfers(admission_id, transferred_at);
CREATE INDEX ON public.bed_transfers(hospital_id);
CREATE INDEX ON public.bed_transfers(patient_id);
