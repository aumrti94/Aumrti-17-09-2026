-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: public_appointment_booking
-- Purpose  : Make the public online booking page (/book/:slug) actually create an
--            appointment. Today it cannot, and tells the patient it did.
--
-- What is broken (PublicAppointmentPage.tsx:167-194). The insert fails for FOUR
-- independent reasons, and the result is never checked:
--
--   1. status: "booked"        — validate_appointment() (20260418180322) allows only
--                                scheduled|confirmed|arrived|in_consultation|completed|
--                                cancelled|no_show. 'booked' raises immediately.
--   2. RLS                     — the only INSERT policy on appointments is
--                                WITH CHECK (hospital_id = get_user_hospital_id()).
--                                An anonymous visitor has no users row, so that helper
--                                returns NULL and the check can never pass.
--   3. slot_end_time           — NOT NULL on appointments, never supplied by the page.
--   4. visit_type "teleconsult"— the page's Telemedicine option is not in the
--                                new|follow_up|review set validate_appointment() enforces.
--
--            The call is `await supabase.from("appointments").insert({...})` with no
--            .select() and no error destructuring, so every one of those failures is
--            swallowed. Execution continues to line 188, which opens WhatsApp saying
--            "Appointment Confirmed" with a reference number and advances the UI to the
--            confirmation step. The patient believes they have an appointment. No row
--            exists and nobody at the hospital ever sees it.
--
-- Approach : one SECURITY DEFINER RPC that does the whole booking server-side. This is
--            the standard pattern for public forms — it keeps the anon role with no
--            direct write grant on patients or appointments, so RLS is NOT loosened.
--            Every value that matters (doctor, department, date, time, duration, fee,
--            status) is read from the slot and the doctor row rather than trusted from
--            the browser; the caller can only choose which slot and supply their name,
--            phone and complaint.
--
-- Capacity : enforced here, unlike the front-desk paths. This is a brand-new code path
--            with no existing behaviour to preserve, and unbounded overbooking from the
--            open internet is not something a hospital would want. Reception keeps its
--            ability to overbook deliberately — nothing about the staff paths changes.
--            The slot row is locked FOR UPDATE so two simultaneous bookings serialise.
--
-- Additive : no existing table, policy, trigger or function is modified. Reverting is
--            DROP FUNCTION. With the function present but the page not yet calling it,
--            behaviour is exactly as it is today.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_public_appointment(
  p_hospital_id     uuid,
  p_slot_id         uuid,
  p_patient_name    text,
  p_patient_phone   text,
  p_visit_type      text DEFAULT 'new',
  p_chief_complaint text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_slot        record;
  v_doctor      record;
  v_patient_id  uuid;
  v_appt_id     uuid;
  v_uhid        text;
  v_name        text := btrim(coalesce(p_patient_name, ''));
  v_phone       text := regexp_replace(coalesce(p_patient_phone, ''), '\D', '', 'g');
  v_visit_type  text;
  v_appt_type   text := 'opd';
  v_active      integer;
  v_end_time    time;
  v_attempt     integer := 0;
BEGIN
  -- ── Input validation ──────────────────────────────────────────────────────
  IF v_name = '' THEN
    RAISE EXCEPTION 'Please enter the patient name.' USING ERRCODE = 'check_violation';
  END IF;

  IF length(v_phone) < 10 THEN
    RAISE EXCEPTION 'Please enter a valid mobile number.' USING ERRCODE = 'check_violation';
  END IF;

  -- The page offers Telemedicine, but validate_appointment() only accepts
  -- new|follow_up|review. Keep the clinical intent on appointment_type instead of
  -- losing it or failing the insert.
  IF p_visit_type = 'teleconsult' THEN
    v_visit_type := 'new';
    v_appt_type  := 'teleconsult';
  ELSIF p_visit_type IN ('new', 'follow_up', 'review') THEN
    v_visit_type := p_visit_type;
  ELSE
    v_visit_type := 'new';
  END IF;

  -- ── Slot: lock, then verify it belongs to this hospital and is bookable ────
  -- FOR UPDATE holds until commit, so concurrent callers for the same slot queue up
  -- and the capacity check below cannot be raced.
  SELECT * INTO v_slot
    FROM public.doctor_slots
   WHERE id = p_slot_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That appointment slot no longer exists.' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_slot.hospital_id IS DISTINCT FROM p_hospital_id THEN
    RAISE EXCEPTION 'That appointment slot is not available.' USING ERRCODE = 'check_violation';
  END IF;

  IF coalesce(v_slot.is_blocked, false) THEN
    RAISE EXCEPTION 'That appointment slot is no longer available.' USING ERRCODE = 'check_violation';
  END IF;

  IF v_slot.slot_date < current_date THEN
    RAISE EXCEPTION 'That appointment date has already passed.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO v_active
    FROM public.appointments a
   WHERE a.slot_id = v_slot.id
     AND a.status NOT IN ('cancelled', 'no_show');

  IF v_active >= coalesce(v_slot.max_patients, 1) THEN
    RAISE EXCEPTION 'That appointment slot has just been taken. Please choose another time.'
      USING ERRCODE = 'unique_violation';
  END IF;

  -- ── Doctor: read fee and department from the slot's doctor, not the browser ─
  SELECT id, department_id, consultation_fee
    INTO v_doctor
    FROM public.users
   WHERE id = v_slot.doctor_id
     AND hospital_id = p_hospital_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That doctor is no longer available.' USING ERRCODE = 'no_data_found';
  END IF;

  -- ── Patient: match on phone within this hospital, else create ──────────────
  SELECT id INTO v_patient_id
    FROM public.patients
   WHERE hospital_id = p_hospital_id
     AND regexp_replace(coalesce(phone, ''), '\D', '', 'g') = v_phone
   ORDER BY created_at
   LIMIT 1;

  IF v_patient_id IS NULL THEN
    -- UHID collision is possible under concurrency; retry a few times before giving up.
    LOOP
      v_attempt := v_attempt + 1;
      v_uhid := 'WEB-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
      BEGIN
        INSERT INTO public.patients (hospital_id, uhid, full_name, phone)
        VALUES (p_hospital_id, v_uhid, v_name, v_phone)
        RETURNING id INTO v_patient_id;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        IF v_attempt >= 5 THEN
          RAISE EXCEPTION 'Could not register the patient. Please call the hospital.';
        END IF;
      END;
    END LOOP;
  END IF;

  -- ── Appointment ───────────────────────────────────────────────────────────
  v_end_time := (v_slot.slot_time + make_interval(mins => coalesce(v_slot.slot_duration_mins, 15)))::time;

  INSERT INTO public.appointments (
    hospital_id, patient_id, doctor_id, department_id,
    appointment_date, slot_time, slot_end_time, slot_id,
    status, visit_type, appointment_type, chief_complaint,
    consultation_fee, booked_via, booking_source
  ) VALUES (
    p_hospital_id, v_patient_id, v_slot.doctor_id, v_doctor.department_id,
    v_slot.slot_date, v_slot.slot_time, v_end_time, v_slot.id,
    'scheduled', v_visit_type, v_appt_type, nullif(btrim(coalesce(p_chief_complaint, '')), ''),
    coalesce(v_doctor.consultation_fee, 0), 'portal', 'patient_web'
  )
  RETURNING id INTO v_appt_id;

  -- booked_count is maintained by trg_sync_slot_booked_count (20261014000001);
  -- nothing to update here.

  RETURN jsonb_build_object(
    'appointment_id',   v_appt_id,
    'patient_id',       v_patient_id,
    'reference',        'APT-' || upper(substr(replace(v_appt_id::text, '-', ''), 1, 6)),
    'appointment_date', v_slot.slot_date,
    'slot_time',        v_slot.slot_time
  );

EXCEPTION
  -- The active-slot partial unique index (20261007000000) is the final backstop if two
  -- callers somehow reach the insert for the same doctor+date+time.
  WHEN unique_violation THEN
    RAISE EXCEPTION 'That appointment slot has just been taken. Please choose another time.'
      USING ERRCODE = 'unique_violation';
END;
$$;

COMMENT ON FUNCTION public.create_public_appointment(uuid, uuid, text, text, text, text) IS
  'Creates an appointment from the anonymous /book/:slug page. SECURITY DEFINER so the anon '
  'role needs no write grant on patients or appointments. Doctor, department, date, time, '
  'duration, fee and status are all derived server-side from the slot; the caller only '
  'chooses a slot and supplies name, phone and complaint. Enforces slot capacity under a '
  'row lock. Returns the new appointment id and a booking reference.';

-- anon needs execute; authenticated too, so a logged-in user testing the public page works.
REVOKE ALL ON FUNCTION public.create_public_appointment(uuid, uuid, text, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.create_public_appointment(uuid, uuid, text, text, text, text) TO anon, authenticated;
