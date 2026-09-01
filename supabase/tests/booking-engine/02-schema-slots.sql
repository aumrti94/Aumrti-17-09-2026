-- Remaining real-schema pieces migration 3 depends on.
CREATE TYPE public.gender_type AS ENUM ('male','female','other');

ALTER TABLE patients
  ADD COLUMN dob date,
  ADD COLUMN gender public.gender_type,
  ADD COLUMN uhid text,
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE patients ADD CONSTRAINT patients_hospital_uhid_uniq UNIQUE (hospital_id, uhid);

ALTER TABLE hospitals ADD COLUMN uhid_prefix text, ADD COLUMN uhid_date_format text;

CREATE TABLE hospital_sequences (
  hospital_id uuid, seq_type text NOT NULL, last_val bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (hospital_id, seq_type)
);

CREATE OR REPLACE FUNCTION public.next_seq(p_hospital_id uuid, p_type text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v bigint;
BEGIN
  INSERT INTO public.hospital_sequences (hospital_id, seq_type, last_val)
    VALUES (p_hospital_id, p_type, 1)
    ON CONFLICT (hospital_id, seq_type) DO UPDATE SET last_val = hospital_sequences.last_val + 1
    RETURNING last_val INTO v;
  RETURN v;
END; $$;

CREATE TABLE doctor_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid, doctor_id uuid, department_id uuid,
  slot_date date NOT NULL, slot_time time NOT NULL,
  slot_duration_mins int DEFAULT 15, max_patients int DEFAULT 1, booked_count int DEFAULT 0,
  slot_type text DEFAULT 'opd' CHECK (slot_type IN ('opd','review','procedure','teleconsult')),
  is_blocked boolean DEFAULT false, block_reason text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE appointments ADD COLUMN slot_id uuid REFERENCES doctor_slots(id);

-- Needed by 20261017000005 (RLS policies reference the helper; hospitals.phone is the
-- handoff-number fallback in get_booking_policy).
ALTER TABLE hospitals ADD COLUMN phone text;

-- The harness has no auth schema; the RLS policies are not exercised here, only their
-- creation, so the helper simply has to exist with the right signature.
CREATE OR REPLACE FUNCTION public.get_user_hospital_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT NULL::uuid $$;
