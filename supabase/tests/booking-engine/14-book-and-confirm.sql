\set QUIET on
TRUNCATE appointments, bill_line_items, bills, doctor_slots, opd_tokens CASCADE;
CREATE TEMP TABLE b(name text, ok boolean, detail text);
CREATE OR REPLACE FUNCTION pg_temp.want(p_name text, p_ok boolean, p_detail text DEFAULT '')
RETURNS void LANGUAGE sql AS $$ INSERT INTO b VALUES (p_name, coalesce(p_ok,false), p_detail) $$;

\set HOSP '11111111-1111-1111-1111-111111111111'
\set DOC  '33333333-3333-3333-3333-333333333333'
\set PAT  '44444444-4444-4444-4444-444444444444'
\set DEPT '22222222-2222-2222-2222-222222222222'

-- Dr Menon: Rs.700 full, Rs.300 follow-up, 10-day validity, 1 follow-up, 18% GST.
UPDATE service_master SET follow_up_fee = 300, gst_applicable = true, gst_percent = 18
 WHERE doctor_id = :'DOC';

INSERT INTO doctor_slots (id, hospital_id, doctor_id, department_id, slot_date, slot_time, max_patients) VALUES
  ('50000000-0000-0000-0000-0000000000a1', :'HOSP', :'DOC', :'DEPT', CURRENT_DATE + 1, '10:00', 1),
  ('50000000-0000-0000-0000-0000000000a2', :'HOSP', :'DOC', :'DEPT', CURRENT_DATE + 1, '10:15', 1),
  ('50000000-0000-0000-0000-0000000000a3', :'HOSP', :'DOC', :'DEPT', CURRENT_DATE + 1, '10:30', 1),
  ('50000000-0000-0000-0000-0000000000a4', :'HOSP', :'DOC', :'DEPT', CURRENT_DATE + 1, '10:45', 1),
  ('50000000-0000-0000-0000-0000000000a5', :'HOSP', :'DOC', :'DEPT', CURRENT_DATE - 1, '09:00', 1);
\set QUIET off

-- ── A new patient's first booking: full fee, held, billed ───────────────────
SELECT pg_temp.want('new consultation is held at the full fee',
  (SELECT (r->>'status') = 'payment_pending' AND (r->>'fee')::numeric = 700
          AND (r->>'tier') = 'new' AND (r->>'payment_required')::boolean
          AND r->>'bill_id' IS NOT NULL
     FROM (SELECT public.book_appointment_with_payment(
             :'HOSP','50000000-0000-0000-0000-0000000000a1',:'PAT','new','new',
             'chest pain','voice_agent',10,true) AS r) x),
  'see appointments table');

SELECT pg_temp.want('the bill splits inclusive GST correctly (700 = 593.22 + 106.78)',
  (SELECT total_amount = 700 AND taxable_amount = 593.22 AND gst_amount = 106.78
          AND payment_status = 'unpaid' AND bill_status = 'final'
     FROM bills WHERE total_amount = 700 ORDER BY created_at LIMIT 1),
  (SELECT format('total=%s taxable=%s gst=%s', total_amount, taxable_amount, gst_amount)
     FROM bills WHERE total_amount = 700 ORDER BY created_at LIMIT 1));

SELECT pg_temp.want('a bill_number was minted by the trigger',
  (SELECT bill_number IS NOT NULL AND bill_number <> '' FROM bills WHERE total_amount = 700 ORDER BY created_at LIMIT 1));

SELECT pg_temp.want('the line item is deduped per appointment',
  (SELECT source_dedupe_key LIKE 'appointment_consult:%' AND item_type = 'consultation'
     FROM bill_line_items LIMIT 1));

SELECT pg_temp.want('the appointment carries charged_tier and links to its bill',
  (SELECT charged_tier = 'new' AND bill_id IS NOT NULL AND hold_expires_at IS NOT NULL
          AND booked_via = 'voice_agent' AND booking_source = 'sarvam_voice'
     FROM appointments WHERE slot_id = '50000000-0000-0000-0000-0000000000a1'));

-- ── The held slot is gone from availability ─────────────────────────────────
SELECT pg_temp.want('a held slot is no longer offered',
  (SELECT NOT EXISTS (SELECT 1 FROM public.list_available_slots(:'HOSP', :'DOC')
                       WHERE slot_id = '50000000-0000-0000-0000-0000000000a1')));

-- ── Payment confirms it ─────────────────────────────────────────────────────
\set QUIET on
UPDATE bills SET paid_amount = 700, balance_due = 0, payment_status = 'paid', bill_status = 'paid'
 WHERE id = (SELECT bill_id FROM appointments WHERE slot_id = '50000000-0000-0000-0000-0000000000a1');
\set QUIET off

SELECT pg_temp.want('payment confirms the appointment',
  (SELECT (public.confirm_appointment_after_payment(
             (SELECT bill_id FROM appointments WHERE slot_id = '50000000-0000-0000-0000-0000000000a1'), 'pay_TEST1') ->> 'status')
          = 'confirmed'));

SELECT pg_temp.want('the confirmed appointment is scheduled with no lingering hold',
  (SELECT status = 'scheduled' AND hold_expires_at IS NULL AND hold_channel IS NULL
     FROM appointments WHERE slot_id = '50000000-0000-0000-0000-0000000000a1'));

SELECT pg_temp.want('a replayed webhook is a no-op, not a second confirmation',
  (SELECT (public.confirm_appointment_after_payment(
             (SELECT bill_id FROM appointments WHERE slot_id = '50000000-0000-0000-0000-0000000000a1'), 'pay_TEST1') ->> 'status')
          = 'already_settled'));

SELECT pg_temp.want('an ordinary counter bill is reported as not_a_booking',
  (SELECT (public.confirm_appointment_after_payment(gen_random_uuid(), 'pay_X') ->> 'status')
          = 'not_a_booking'));

-- ── Fee type: a second visit inside validity is the follow-up rate ──────────
\set QUIET on
INSERT INTO opd_tokens (hospital_id, patient_id, doctor_id, visit_date, status, charged_tier)
  VALUES (:'HOSP', :'PAT', :'DOC', CURRENT_DATE - 2, 'completed', 'new');
\set QUIET off

SELECT pg_temp.want('a follow-up inside validity is priced at Rs.300, not Rs.700',
  (SELECT (r->>'fee')::numeric = 300 AND (r->>'tier') = 'follow_up'
     FROM (SELECT public.book_appointment_with_payment(
             :'HOSP','50000000-0000-0000-0000-0000000000a2',:'PAT','follow_up','follow_up',
             NULL,'whatsapp_bot',10,true) AS r) x),
  'see appointments table');

-- ── A FREE follow-up must book outright with no bill and no payment link ────
\set QUIET on
UPDATE service_master SET follow_up_fee = 0 WHERE doctor_id = :'DOC';
DELETE FROM appointments WHERE slot_id = '50000000-0000-0000-0000-0000000000a2';
\set QUIET off

SELECT pg_temp.want('a free follow-up books immediately, with no bill and no payment link',
  (SELECT (r->>'status') = 'scheduled' AND (r->>'fee')::numeric = 0
          AND (r->>'payment_required')::boolean = false AND r->>'bill_id' IS NULL
     FROM (SELECT public.book_appointment_with_payment(
             :'HOSP','50000000-0000-0000-0000-0000000000a2',:'PAT','follow_up','follow_up',
             NULL,'whatsapp_bot',10,true) AS r) x),
  'see appointments table');

-- ── Hospital does not require prepayment: confirm outright, no bill ─────────
\set QUIET on
UPDATE service_master SET follow_up_fee = 300 WHERE doctor_id = :'DOC';
DELETE FROM appointments WHERE slot_id = '50000000-0000-0000-0000-0000000000a3';
\set QUIET off

SELECT pg_temp.want('payment_required=false books outright and raises no bill',
  (SELECT (r->>'status') = 'scheduled' AND (r->>'payment_required')::boolean = false
          AND r->>'bill_id' IS NULL AND (r->>'fee')::numeric = 300
     FROM (SELECT public.book_appointment_with_payment(
             :'HOSP','50000000-0000-0000-0000-0000000000a3',:'PAT','follow_up','follow_up',
             NULL,'reception',10,false) AS r) x));

-- ── Rejections ──────────────────────────────────────────────────────────────
DO $$ DECLARE v text; BEGIN
  PERFORM public.book_appointment_with_payment('11111111-1111-1111-1111-111111111111',
    '50000000-0000-0000-0000-0000000000a5','44444444-4444-4444-4444-444444444444');
  INSERT INTO b VALUES ('a past-dated slot is refused', false, 'accepted');
EXCEPTION WHEN others THEN
  INSERT INTO b VALUES ('a past-dated slot is refused', SQLERRM LIKE '%already passed%', SQLERRM);
END $$;

DO $$ BEGIN
  PERFORM public.book_appointment_with_payment('11111111-1111-1111-1111-111111111111',
    '50000000-0000-0000-0000-0000000000a4','44444444-4444-4444-4444-4444444444ff');
  INSERT INTO b VALUES ('a patient from another tenant is refused', false, 'accepted');
EXCEPTION WHEN others THEN
  INSERT INTO b VALUES ('a patient from another tenant is refused', SQLERRM LIKE '%Patient record not found%', SQLERRM);
END $$;

DO $$ BEGIN
  PERFORM public.book_appointment_with_payment('11111111-1111-1111-1111-111111111111',
    '50000000-0000-0000-0000-0000000000a4','44444444-4444-4444-4444-444444444444',
    'new','new',NULL,'carrier_pigeon');
  INSERT INTO b VALUES ('an unknown channel is refused', false, 'accepted');
EXCEPTION WHEN others THEN
  INSERT INTO b VALUES ('an unknown channel is refused', SQLERRM LIKE '%Unknown booking channel%', SQLERRM);
END $$;

-- Slot a4 has one seat; fill it, then try again.
\set QUIET on
SELECT public.book_appointment_with_payment(:'HOSP','50000000-0000-0000-0000-0000000000a4',:'PAT');
\set QUIET off
DO $$ BEGIN
  PERFORM public.book_appointment_with_payment('11111111-1111-1111-1111-111111111111',
    '50000000-0000-0000-0000-0000000000a4','44444444-4444-4444-4444-444444444444');
  INSERT INTO b VALUES ('a full slot is refused', false, 'accepted — overbooked!');
EXCEPTION WHEN others THEN
  INSERT INTO b VALUES ('a full slot is refused', SQLERRM LIKE '%just been taken%', SQLERRM);
END $$;

\echo ''
\echo '============ BOOK + CONFIRM ============'
SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS status, name, CASE WHEN ok THEN '' ELSE left(coalesce(detail,''),90) END AS note
FROM b ORDER BY ok, name;
SELECT count(*) FILTER (WHERE ok) AS passed, count(*) FILTER (WHERE NOT ok) AS failed FROM b;
