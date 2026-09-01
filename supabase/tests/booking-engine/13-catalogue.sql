\set QUIET on
TRUNCATE appointments, bills, doctor_slots;
DELETE FROM patients WHERE id <> '44444444-4444-4444-4444-444444444444';
UPDATE patients SET uhid = 'CH-20260101-0001', phone = '9876543210', full_name = 'Rajesh Kumar'
 WHERE id = '44444444-4444-4444-4444-444444444444';
UPDATE hospitals SET uhid_prefix = 'CH', uhid_date_format = 'YYYYMMDD';

CREATE TEMP TABLE c(name text, ok boolean, detail text);
CREATE OR REPLACE FUNCTION pg_temp.want(p_name text, p_ok boolean, p_detail text DEFAULT '')
RETURNS void LANGUAGE sql AS $$ INSERT INTO c VALUES (p_name, coalesce(p_ok,false), p_detail) $$;

\set HOSP '11111111-1111-1111-1111-111111111111'
\set DOC  '33333333-3333-3333-3333-333333333333'
\set PAT  '44444444-4444-4444-4444-444444444444'
\set DEPT '22222222-2222-2222-2222-222222222222'
\set QUIET off

-- ── Catalogue ────────────────────────────────────────────────────────────────
SELECT pg_temp.want('departments lists Cardiology with its one doctor',
  (SELECT count(*) = 1 AND max(name) = 'Cardiology' AND max(doctor_count) = 1
     FROM public.list_public_departments(:'HOSP')));

SELECT pg_temp.want('doctors resolve their own configured fee (Rs.700)',
  (SELECT base_fee = 700 AND fee_source = 'doctor'
     FROM public.list_public_doctors(:'HOSP', :'DEPT')));

-- An inactive doctor must vanish from both lists.
\set QUIET on
INSERT INTO users (id, hospital_id, full_name, department_id, role, is_active)
  VALUES ('33333333-3333-3333-3333-33333333aaaa', :'HOSP', 'Dr Retired', :'DEPT', 'doctor', false);
\set QUIET off
SELECT pg_temp.want('an inactive doctor is not offered',
  (SELECT count(*) = 1 FROM public.list_public_doctors(:'HOSP', :'DEPT')));

-- ── Slot availability ───────────────────────────────────────────────────────
\set QUIET on
INSERT INTO doctor_slots (id, hospital_id, doctor_id, department_id, slot_date, slot_time, max_patients) VALUES
  ('50000000-0000-0000-0000-000000000001', :'HOSP', :'DOC', :'DEPT', CURRENT_DATE + 1, '10:00', 1),
  ('50000000-0000-0000-0000-000000000002', :'HOSP', :'DOC', :'DEPT', CURRENT_DATE + 1, '10:15', 1),
  ('50000000-0000-0000-0000-000000000003', :'HOSP', :'DOC', :'DEPT', CURRENT_DATE + 1, '10:30', 2),
  ('50000000-0000-0000-0000-000000000004', :'HOSP', :'DOC', :'DEPT', CURRENT_DATE + 1, '10:45', 1),
  ('50000000-0000-0000-0000-000000000005', :'HOSP', :'DOC', :'DEPT', CURRENT_DATE - 1, '10:00', 1);
UPDATE doctor_slots SET is_blocked = true WHERE id = '50000000-0000-0000-0000-000000000004';
\set QUIET off

SELECT pg_temp.want('past-dated and blocked slots are never offered',
  (SELECT count(*) = 3 FROM public.list_available_slots(:'HOSP', :'DOC')),
  (SELECT 'got ' || count(*)::text FROM public.list_available_slots(:'HOSP', :'DOC')));

-- A confirmed booking consumes the only seat on slot 1.
\set QUIET on
INSERT INTO appointments (hospital_id,patient_id,doctor_id,appointment_date,slot_time,slot_end_time,status,booked_via,slot_id)
  VALUES (:'HOSP',:'PAT',:'DOC',CURRENT_DATE+1,'10:00','10:15','scheduled','reception','50000000-0000-0000-0000-000000000001');
\set QUIET off
SELECT pg_temp.want('a booked slot drops out of the list',
  (SELECT NOT EXISTS (SELECT 1 FROM public.list_available_slots(:'HOSP', :'DOC')
                       WHERE slot_id = '50000000-0000-0000-0000-000000000001')));

-- A payment_pending HOLD must also consume the seat — this is the whole point of the hold.
\set QUIET on
INSERT INTO appointments (hospital_id,patient_id,doctor_id,appointment_date,slot_time,slot_end_time,status,booked_via,slot_id,hold_expires_at)
  VALUES (:'HOSP',:'PAT',:'DOC',CURRENT_DATE+1,'10:15','10:30','payment_pending','voice_agent','50000000-0000-0000-0000-000000000002',now()+interval '10 min');
\set QUIET off
SELECT pg_temp.want('a payment_pending hold also removes the slot',
  (SELECT NOT EXISTS (SELECT 1 FROM public.list_available_slots(:'HOSP', :'DOC')
                       WHERE slot_id = '50000000-0000-0000-0000-000000000002')));

-- A cancelled appointment frees the seat again.
\set QUIET on
UPDATE appointments SET status = 'cancelled' WHERE slot_id = '50000000-0000-0000-0000-000000000001';
\set QUIET off
SELECT pg_temp.want('cancelling frees the seat',
  (SELECT EXISTS (SELECT 1 FROM public.list_available_slots(:'HOSP', :'DOC')
                   WHERE slot_id = '50000000-0000-0000-0000-000000000001')));

-- max_patients = 2: one booking still leaves a seat.
\set QUIET on
INSERT INTO appointments (hospital_id,patient_id,doctor_id,appointment_date,slot_time,slot_end_time,status,booked_via,slot_id)
  VALUES (:'HOSP',:'PAT',:'DOC',CURRENT_DATE+1,'10:30','10:45','scheduled','reception','50000000-0000-0000-0000-000000000003');
\set QUIET off
SELECT pg_temp.want('a 2-seat slot still has one seat after one booking',
  (SELECT seats_left = 1 FROM public.list_available_slots(:'HOSP', :'DOC')
    WHERE slot_id = '50000000-0000-0000-0000-000000000003'));

-- ── Patient identification: the PHI rule ────────────────────────────────────
SELECT pg_temp.want('self-service finds the caller by their own number',
  (SELECT count(*) = 1 FROM public.find_patients_for_booking(:'HOSP', '+91 98765 43210')));

SELECT pg_temp.want('self-service masks name, phone and UHID',
  (SELECT display_name = 'Rajesh K.' AND masked_phone = '******3210'
          AND uhid = 'XXXX0001' AND dob IS NULL
     FROM public.find_patients_for_booking(:'HOSP', '9876543210')),
  (SELECT format('name=%s phone=%s uhid=%s', display_name, masked_phone, uhid)
     FROM public.find_patients_for_booking(:'HOSP', '9876543210')));

SELECT pg_temp.want('self-service REFUSES a name search',
  (SELECT count(*) = 0 FROM public.find_patients_for_booking(:'HOSP', 'Rajesh')),
  'an anonymous caller must not be able to enumerate patients by name');

SELECT pg_temp.want('self-service REFUSES a UHID search',
  (SELECT count(*) = 0 FROM public.find_patients_for_booking(:'HOSP', 'CH-20260101-0001')));

-- Two patients on one handset: must return nothing rather than guess.
\set QUIET on
INSERT INTO patients (hospital_id, uhid, full_name, phone)
  VALUES (:'HOSP', 'CH-20260101-0002', 'Sunita Kumar', '919876543210');
\set QUIET off
SELECT pg_temp.want('an ambiguous shared number returns nothing, never a guess',
  (SELECT count(*) = 0 FROM public.find_patients_for_booking(:'HOSP', '9876543210')),
  'a family handset must not resolve to an arbitrary patient');

SELECT pg_temp.want('staff channel still resolves the same shared number to both',
  (SELECT count(*) = 2 FROM public.find_patients_for_booking(:'HOSP', '9876543210', 'staff')));

SELECT pg_temp.want('staff channel can search by name',
  (SELECT count(*) = 1 FROM public.find_patients_for_booking(:'HOSP', 'Sunita', 'staff')));

-- ── Registration ────────────────────────────────────────────────────────────
SELECT pg_temp.want('registering mints a UHID in the hospital''s configured format',
  (public.register_patient_for_booking(:'HOSP', 'Anil Verma', '9000000001') ->> 'uhid')
    LIKE 'CH-' || to_char(current_date,'YYYYMMDD') || '-%',
  public.register_patient_for_booking(:'HOSP', 'Anil Verma', '9000000001') ->> 'uhid');

SELECT pg_temp.want('registering the same mobile twice does not duplicate',
  (public.register_patient_for_booking(:'HOSP', 'Anil Verma', '9000000001') ->> 'created')::boolean = false);

DO $$
DECLARE v_ok boolean := false; v_detail text := '';
BEGIN
  PERFORM public.register_patient_for_booking('11111111-1111-1111-1111-111111111111', 'X', '12345');
  v_detail := 'accepted a 5-digit mobile number';
EXCEPTION WHEN others THEN
  v_ok := SQLERRM LIKE '%valid 10-digit mobile%';
  v_detail := SQLERRM;
END $$;
SELECT pg_temp.want('registration rejects a short mobile number',
  NOT EXISTS (SELECT 1 FROM patients WHERE full_name = 'X'));

SELECT pg_temp.want('registration rejects an empty name',
  NOT EXISTS (SELECT 1 FROM patients WHERE phone = '9000000002'));

\echo ''
\echo '============ BOOKING CATALOGUE + IDENTIFICATION ============'
SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS status, name, CASE WHEN ok THEN '' ELSE coalesce(detail,'') END AS note
FROM c ORDER BY ok, name;
SELECT count(*) FILTER (WHERE ok) AS passed, count(*) FILTER (WHERE NOT ok) AS failed FROM c;
