-- End-to-end price_consultation(): rate ladder + episode discovery from opd_tokens.

\set QUIET on
CREATE TEMP TABLE r(name text, ok boolean, detail text);
CREATE OR REPLACE FUNCTION pg_temp.chk(p_name text, p_got jsonb, p_fee numeric, p_tier text, p_src text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_ok boolean;
BEGIN
  v_ok := (p_got->>'fee')::numeric = p_fee AND p_got->>'tier' = p_tier
          AND (p_src IS NULL OR p_got->>'rate_source' = p_src);
  INSERT INTO r VALUES (p_name, v_ok, format('fee=%s tier=%s src=%s reason=%s',
    p_got->>'fee', p_got->>'tier', p_got->>'rate_source', p_got->>'reason'));
END; $$;

-- Seed: one hospital, Cardiology, Dr Menon, patient Rajesh.
INSERT INTO hospitals (id, name) VALUES ('11111111-1111-1111-1111-111111111111','Test Hospital');
INSERT INTO departments (id, hospital_id, name) VALUES ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','Cardiology');
INSERT INTO users (id, hospital_id, full_name, department_id)
  VALUES ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111','Dr Menon','22222222-2222-2222-2222-222222222222');
INSERT INTO patients (id, hospital_id, full_name, phone)
  VALUES ('44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111','Rajesh Kumar','9876543210');
\set QUIET off

-- ── Ladder: global only ───────────────────────────────────────────────────────
INSERT INTO service_master (hospital_id, name, item_type, fee, is_active)
  VALUES ('11111111-1111-1111-1111-111111111111','Consultation','consultation',400,true);
SELECT pg_temp.chk('ladder: global tier answers',
  public.price_consultation('11111111-1111-1111-1111-111111111111','44444444-4444-4444-4444-444444444444',
    '33333333-3333-3333-3333-333333333333'), 400, 'new', 'global');

-- ── Ladder: department overrides global ───────────────────────────────────────
INSERT INTO service_master (hospital_id, name, item_type, fee, is_active, department_id)
  VALUES ('11111111-1111-1111-1111-111111111111','Cardio Consult','consultation',600,true,'22222222-2222-2222-2222-222222222222');
SELECT pg_temp.chk('ladder: department beats global (dept inferred from doctor)',
  public.price_consultation('11111111-1111-1111-1111-111111111111','44444444-4444-4444-4444-444444444444',
    '33333333-3333-3333-3333-333333333333'), 600, 'new', 'dept');

-- ── Ladder: doctor overrides department; Menon's real card ───────────────────
INSERT INTO service_master (hospital_id, name, item_type, fee, follow_up_fee, validity_days,
                            follow_up_max_visits, emergency_fee, is_active, doctor_id)
  VALUES ('11111111-1111-1111-1111-111111111111','Dr Menon Consult','consultation',700,300,10,1,1000,true,
          '33333333-3333-3333-3333-333333333333');
SELECT pg_temp.chk('ladder: doctor beats department',
  public.price_consultation('11111111-1111-1111-1111-111111111111','44444444-4444-4444-4444-444444444444',
    '33333333-3333-3333-3333-333333333333'), 700, 'new', 'doctor');

-- ── Episode: a full-fee visit 3 days ago makes today a follow-up ─────────────
INSERT INTO opd_tokens (hospital_id, patient_id, doctor_id, visit_date, status, charged_tier)
  VALUES ('11111111-1111-1111-1111-111111111111','44444444-4444-4444-4444-444444444444',
          '33333333-3333-3333-3333-333333333333', CURRENT_DATE - 3, 'completed','new');
SELECT pg_temp.chk('episode: 3 days after anchor prices the follow-up rate',
  public.price_consultation('11111111-1111-1111-1111-111111111111','44444444-4444-4444-4444-444444444444',
    '33333333-3333-3333-3333-333333333333'), 300, 'follow_up', 'doctor');

-- ── Episode: the allowance of 1 is now spent ─────────────────────────────────
INSERT INTO opd_tokens (hospital_id, patient_id, doctor_id, visit_date, status, charged_tier)
  VALUES ('11111111-1111-1111-1111-111111111111','44444444-4444-4444-4444-444444444444',
          '33333333-3333-3333-3333-333333333333', CURRENT_DATE - 1, 'completed','follow_up');
SELECT pg_temp.chk('episode: allowance spent reverts to full fee',
  public.price_consultation('11111111-1111-1111-1111-111111111111','44444444-4444-4444-4444-444444444444',
    '33333333-3333-3333-3333-333333333333'), 700, 'new', 'doctor');

-- ── Cancelled/no-show visits must not count ─────────────────────────────────
DELETE FROM opd_tokens WHERE charged_tier = 'follow_up';
UPDATE opd_tokens SET status = 'cancelled' WHERE charged_tier = 'new';
SELECT pg_temp.chk('episode: a cancelled visit does not anchor an episode',
  public.price_consultation('11111111-1111-1111-1111-111111111111','44444444-4444-4444-4444-444444444444',
    '33333333-3333-3333-3333-333333333333'), 700, 'new', 'doctor');

-- ── Emergency visits neither anchor nor spend ───────────────────────────────
UPDATE opd_tokens SET status = 'completed';
INSERT INTO opd_tokens (hospital_id, patient_id, doctor_id, visit_date, status, charged_tier)
  VALUES ('11111111-1111-1111-1111-111111111111','44444444-4444-4444-4444-444444444444',
          '33333333-3333-3333-3333-333333333333', CURRENT_DATE - 1, 'completed','emergency');
SELECT pg_temp.chk('episode: an emergency visit is skipped, anchor still holds',
  public.price_consultation('11111111-1111-1111-1111-111111111111','44444444-4444-4444-4444-444444444444',
    '33333333-3333-3333-3333-333333333333'), 300, 'follow_up', 'doctor');

-- ── Future-dated pricing: as_of beyond validity is a fresh consultation ─────
SELECT pg_temp.chk('as_of_date beyond validity prices as a new consultation',
  public.price_consultation('11111111-1111-1111-1111-111111111111','44444444-4444-4444-4444-444444444444',
    '33333333-3333-3333-3333-333333333333', NULL, 'new','new', CURRENT_DATE + 30), 700, 'new', 'doctor');

-- ── A free follow-up really bills zero ──────────────────────────────────────
UPDATE service_master SET follow_up_fee = 0 WHERE doctor_id = '33333333-3333-3333-3333-333333333333';
SELECT pg_temp.chk('a configured free follow-up bills Rs.0',
  public.price_consultation('11111111-1111-1111-1111-111111111111','44444444-4444-4444-4444-444444444444',
    '33333333-3333-3333-3333-333333333333'), 0, 'follow_up', 'doctor');

-- ── No patient known: cannot be a follow-up, prices full ────────────────────
SELECT pg_temp.chk('unknown patient prices the full fee',
  public.price_consultation('11111111-1111-1111-1111-111111111111', NULL,
    '33333333-3333-3333-3333-333333333333'), 700, 'new', 'doctor');

\echo ''
\echo '============ END-TO-END price_consultation ============'
SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS status, name, CASE WHEN ok THEN '' ELSE detail END AS got
FROM r ORDER BY ok, name;
SELECT count(*) FILTER (WHERE ok) AS passed, count(*) FILTER (WHERE NOT ok) AS failed FROM r;
