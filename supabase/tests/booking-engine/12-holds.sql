\set QUIET on
CREATE TEMP TABLE h(name text, ok boolean, detail text);
CREATE OR REPLACE FUNCTION pg_temp.want(p_name text, p_ok boolean, p_detail text DEFAULT '')
RETURNS void LANGUAGE sql AS $$ INSERT INTO h VALUES (p_name, p_ok, p_detail) $$;

-- Must fail, and must fail for the RIGHT reason: the validation trigger, not a type error
-- or a constraint. Matching on the message is what stops this test passing by accident.
CREATE OR REPLACE FUNCTION pg_temp.expect_reject(p_name text, p_sql text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  INSERT INTO h VALUES (p_name, false, 'accepted, but should have been rejected');
EXCEPTION WHEN others THEN
  IF SQLERRM LIKE 'Invalid appointment%' OR SQLERRM LIKE 'Invalid visit_type%' OR SQLERRM LIKE 'Invalid booked_via%' THEN
    INSERT INTO h VALUES (p_name, true, '');
  ELSE
    INSERT INTO h VALUES (p_name, false, 'rejected, but by the wrong thing: ' || SQLERRM);
  END IF;
END; $$;

TRUNCATE appointments, bill_line_items, bills CASCADE;

CREATE OR REPLACE FUNCTION pg_temp.expect_ok(p_name text, p_sql text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  INSERT INTO h VALUES (p_name, true, '');
EXCEPTION WHEN others THEN
  INSERT INTO h VALUES (p_name, false, SQLERRM);
END; $$;

\set HOSP '''11111111-1111-1111-1111-111111111111'''
\set PAT  '''44444444-4444-4444-4444-444444444444'''
\set DOC  '''33333333-3333-3333-3333-333333333333'''
\set QUIET off

-- ── The widened trigger still accepts everything it used to ──────────────────
SELECT pg_temp.expect_ok('legacy status "scheduled" still accepted', format(
  $q$INSERT INTO appointments (id,hospital_id,patient_id,doctor_id,appointment_date,slot_time,slot_end_time,status,booked_via)
     VALUES ('a0000000-0000-0000-0000-000000000001',%L,%L,%L,CURRENT_DATE,'10:00','10:15','scheduled','reception')$q$,
  :HOSP, :PAT, :DOC));

SELECT pg_temp.expect_ok('legacy booked_via "portal" still accepted', format(
  $q$INSERT INTO appointments (id,hospital_id,patient_id,doctor_id,appointment_date,slot_time,slot_end_time,status,booked_via)
     VALUES ('a0000000-0000-0000-0000-000000000002',%L,%L,%L,CURRENT_DATE,'10:30','10:45','confirmed','portal')$q$,
  :HOSP, :PAT, :DOC));

SELECT pg_temp.expect_reject('an unknown status is still rejected', format(
  $q$INSERT INTO appointments (hospital_id,patient_id,doctor_id,appointment_date,slot_time,slot_end_time,status,booked_via)
     VALUES (%L,%L,%L,CURRENT_DATE,'11:00','11:15','banana','reception')$q$,
  :HOSP, :PAT, :DOC));

SELECT pg_temp.expect_reject('an unknown booked_via is still rejected', format(
  $q$INSERT INTO appointments (hospital_id,patient_id,doctor_id,appointment_date,slot_time,slot_end_time,status,booked_via)
     VALUES (%L,%L,%L,CURRENT_DATE,'11:30','11:45','scheduled','carrier_pigeon')$q$,
  :HOSP, :PAT, :DOC));

-- ── ...and the new values it must now accept ─────────────────────────────────
SELECT pg_temp.expect_ok('new status "payment_pending" accepted', format(
  $q$INSERT INTO appointments (id,hospital_id,patient_id,doctor_id,appointment_date,slot_time,slot_end_time,status,booked_via,hold_expires_at)
     VALUES ('a0000000-0000-0000-0000-000000000003',%L,%L,%L,CURRENT_DATE,'12:00','12:15','payment_pending','voice_agent',now()+interval '10 min')$q$,
  :HOSP, :PAT, :DOC));

SELECT pg_temp.expect_ok('new booked_via "whatsapp_bot" accepted', format(
  $q$INSERT INTO appointments (id,hospital_id,patient_id,doctor_id,appointment_date,slot_time,slot_end_time,status,booked_via)
     VALUES ('a0000000-0000-0000-0000-000000000004',%L,%L,%L,CURRENT_DATE,'12:30','12:45','scheduled','whatsapp_bot')$q$,
  :HOSP, :PAT, :DOC));

-- ── hold_expires_at is cleared the moment the row leaves payment_pending ─────
UPDATE appointments SET status='scheduled' WHERE id='a0000000-0000-0000-0000-000000000003';
SELECT pg_temp.want('confirming a hold clears hold_expires_at',
  (SELECT hold_expires_at IS NULL FROM appointments WHERE id='a0000000-0000-0000-0000-000000000003'),
  'stale expiry would let the sweeper cancel a paid appointment');

-- ── The sweeper ─────────────────────────────────────────────────────────────
-- (a) a lapsed, unpaid hold with a bill → released, bill voided
INSERT INTO bills (id,hospital_id,patient_id,bill_number,total_amount,paid_amount,bill_status)
  VALUES ('b0000000-0000-0000-0000-000000000001',:HOSP,:PAT,'BILL-EXPIRE-1',700,0,'final');
INSERT INTO appointments (id,hospital_id,patient_id,doctor_id,appointment_date,slot_time,slot_end_time,status,booked_via,hold_expires_at,bill_id,charged_tier)
  VALUES ('a0000000-0000-0000-0000-000000000010',:HOSP,:PAT,:DOC,CURRENT_DATE,'14:00','14:15','payment_pending','voice_agent',now()-interval '1 min','b0000000-0000-0000-0000-000000000001','new');

-- (b) a lapsed hold whose payment has ALREADY landed → must NOT be cancelled
INSERT INTO bills (id,hospital_id,patient_id,bill_number,total_amount,paid_amount,payment_status,bill_status)
  VALUES ('b0000000-0000-0000-0000-000000000002',:HOSP,:PAT,'BILL-PAID-1',700,700,'paid','paid');
INSERT INTO appointments (id,hospital_id,patient_id,doctor_id,appointment_date,slot_time,slot_end_time,status,booked_via,hold_expires_at,bill_id,charged_tier)
  VALUES ('a0000000-0000-0000-0000-000000000011',:HOSP,:PAT,:DOC,CURRENT_DATE,'14:30','14:45','payment_pending','voice_agent',now()-interval '1 min','b0000000-0000-0000-0000-000000000002','new');

-- (c) a hold still within its TTL → untouched
INSERT INTO appointments (id,hospital_id,patient_id,doctor_id,appointment_date,slot_time,slot_end_time,status,booked_via,hold_expires_at)
  VALUES ('a0000000-0000-0000-0000-000000000012',:HOSP,:PAT,:DOC,CURRENT_DATE,'15:00','15:15','payment_pending','whatsapp_bot',now()+interval '9 min');

SELECT pg_temp.want('sweeper releases exactly the one lapsed unpaid hold',
  public.expire_appointment_holds() = 1);

SELECT pg_temp.want('lapsed hold is cancelled with a reason',
  (SELECT status='cancelled' AND cancellation_reason='hold_expired' AND hold_expires_at IS NULL
     FROM appointments WHERE id='a0000000-0000-0000-0000-000000000010'));

SELECT pg_temp.want('its unpaid bill is voided via bill_status',
  (SELECT bill_status='cancelled' AND payment_status='unpaid' FROM bills WHERE id='b0000000-0000-0000-0000-000000000001'),
  'payment_status has no cancelled member; voiding must use bill_status');

SELECT pg_temp.want('a hold whose payment already landed is NOT cancelled',
  (SELECT status='payment_pending' FROM appointments WHERE id='a0000000-0000-0000-0000-000000000011'),
  'this is the payment-race guard');

SELECT pg_temp.want('a paid bill is never voided',
  (SELECT bill_status<>'cancelled' AND payment_status='paid' FROM bills WHERE id='b0000000-0000-0000-0000-000000000002'));

SELECT pg_temp.want('a hold inside its TTL is untouched',
  (SELECT status='payment_pending' FROM appointments WHERE id='a0000000-0000-0000-0000-000000000012'));

SELECT pg_temp.want('sweeper is idempotent — a second run releases nothing',
  public.expire_appointment_holds() = 0);

\echo ''
\echo '============ APPOINTMENT PAYMENT HOLDS ============'
SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS status, name, CASE WHEN ok THEN '' ELSE detail END AS note
FROM h ORDER BY ok, name;
SELECT count(*) FILTER (WHERE ok) AS passed, count(*) FILTER (WHERE NOT ok) AS failed FROM h;
