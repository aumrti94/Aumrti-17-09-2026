-- Parity harness: the fixtures from src/lib/consultationFee.test.ts, run against the SQL
-- engine. Dr. Menon: Rs.700 full, Rs.300 follow-up, 10-day validity, 1 follow-up allowed.

\set QUIET on
\pset pager off

CREATE OR REPLACE FUNCTION pg_temp.menon() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('fee',700,'follow_up_fee',300,'follow_up_validity_days',10,
                            'follow_up_max_visits',1,'emergency_fee',1000,'source','doctor')
$$;

-- Mirrors the episode() helper in the test file: withinValidity and capReached are derived
-- exactly as the DB layer derives them, so the cap rule is exercised rather than restated.
CREATE OR REPLACE FUNCTION pg_temp.episode(p_days int, p_used int, p_rate jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'anchor_date','2026-08-01','anchor_token_id','tok-anchor','anchor_doctor_name','Menon',
    'follow_ups_used', p_used,
    'within_validity', p_days >= 0 AND p_days <= (COALESCE(p_rate, pg_temp.menon()) ->> 'follow_up_validity_days')::int,
    'cap_reached', (COALESCE(p_rate, pg_temp.menon()) -> 'follow_up_max_visits') <> 'null'::jsonb
                   AND p_used >= NULLIF(COALESCE(p_rate, pg_temp.menon()) ->> 'follow_up_max_visits','')::int,
    'days_since_anchor', p_days)
$$;

CREATE OR REPLACE FUNCTION pg_temp.no_episode() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('anchor_date',NULL,'anchor_token_id',NULL,'anchor_doctor_name',NULL,
                            'follow_ups_used',0,'within_validity',false,'cap_reached',false,
                            'days_since_anchor',NULL)
$$;

CREATE TEMP TABLE results(name text, ok boolean, detail text);

CREATE OR REPLACE FUNCTION pg_temp.chk(
  p_name text, p_got jsonb, p_fee numeric, p_tier text, p_reason_contains text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_ok boolean;
BEGIN
  v_ok := (p_got ->> 'fee')::numeric = p_fee
          AND p_got ->> 'tier' = p_tier
          AND (p_reason_contains IS NULL OR p_got ->> 'reason' LIKE '%' || p_reason_contains || '%');
  INSERT INTO results VALUES (p_name, v_ok,
    format('fee=%s tier=%s reason=%s', p_got ->> 'fee', p_got ->> 'tier', p_got ->> 'reason'));
END;
$$;

\set QUIET off

-- ── episode-anchored follow-up pricing ────────────────────────────────────────
SELECT pg_temp.chk('full fee when no prior visit',
  public.compute_consultation_fee(pg_temp.menon(), pg_temp.no_episode(), 'new'), 700, 'new');

SELECT pg_temp.chk('follow-up inside validity with allowance left',
  public.compute_consultation_fee(pg_temp.menon(), pg_temp.episode(3,0), 'new'), 300, 'follow_up', 'visit 1 of 1');

SELECT pg_temp.chk('allowance spent inside validity reverts to full',
  public.compute_consultation_fee(pg_temp.menon(), pg_temp.episode(5,1), 'new'), 700, 'new', 'allowance used');

SELECT pg_temp.chk('validity expired reverts to full',
  public.compute_consultation_fee(pg_temp.menon(), pg_temp.episode(20,0), 'new'), 700, 'new', 'outside the 10-day validity');

SELECT pg_temp.chk('last day of validity is still inside',
  public.compute_consultation_fee(pg_temp.menon(), pg_temp.episode(10,0), 'new'), 300, 'follow_up');
SELECT pg_temp.chk('day after validity is outside',
  public.compute_consultation_fee(pg_temp.menon(), pg_temp.episode(11,0), 'new'), 700, 'new');

-- larger allowance (max 3) across consecutive follow-ups
SELECT pg_temp.chk('allowance 3 - visit 1',
  public.compute_consultation_fee(jsonb_set(pg_temp.menon(),'{follow_up_max_visits}','3'),
    pg_temp.episode(2,0,jsonb_set(pg_temp.menon(),'{follow_up_max_visits}','3')), 'new'), 300, 'follow_up');
SELECT pg_temp.chk('allowance 3 - visit 3',
  public.compute_consultation_fee(jsonb_set(pg_temp.menon(),'{follow_up_max_visits}','3'),
    pg_temp.episode(8,2,jsonb_set(pg_temp.menon(),'{follow_up_max_visits}','3')), 'new'), 300, 'follow_up');
SELECT pg_temp.chk('allowance 3 - visit 4 reverts to full',
  public.compute_consultation_fee(jsonb_set(pg_temp.menon(),'{follow_up_max_visits}','3'),
    pg_temp.episode(9,3,jsonb_set(pg_temp.menon(),'{follow_up_max_visits}','3')), 'new'), 700, 'new');

SELECT pg_temp.chk('null max_visits never caps',
  public.compute_consultation_fee(jsonb_set(pg_temp.menon(),'{follow_up_max_visits}','null'),
    pg_temp.episode(5,9,jsonb_set(pg_temp.menon(),'{follow_up_max_visits}','null')), 'new'), 300, 'follow_up', 'of unlimited');

-- ── manual desk selection ─────────────────────────────────────────────────────
SELECT pg_temp.chk('manual follow-up with no history',
  public.compute_consultation_fee(pg_temp.menon(), pg_temp.no_episode(), 'followup'), 300, 'follow_up', 'marked manually');

SELECT pg_temp.chk('manual cannot override expired validity',
  public.compute_consultation_fee(pg_temp.menon(), pg_temp.episode(20,0), 'followup'), 700, 'new');

SELECT pg_temp.chk('manual cannot override spent allowance',
  public.compute_consultation_fee(pg_temp.menon(), pg_temp.episode(5,1), 'followup'), 700, 'new');

SELECT pg_temp.chk('no follow-up rate configured falls back to full',
  public.compute_consultation_fee(jsonb_set(pg_temp.menon(),'{follow_up_fee}','null'),
    pg_temp.episode(3,0), 'followup'), 700, 'new', 'no follow-up rate configured');

-- ── zero-value rates are configuration, not absence ───────────────────────────
SELECT pg_temp.chk('free follow-up bills Rs.0, not the full fee',
  public.compute_consultation_fee(jsonb_set(pg_temp.menon(),'{follow_up_fee}','0'),
    pg_temp.episode(3,0), 'new'), 0, 'follow_up');

SELECT pg_temp.chk('doctor at exactly the Rs.500 default does not fall through',
  public.compute_consultation_fee(
    jsonb_build_object('fee',500,'follow_up_fee',null,'follow_up_validity_days',7,
                       'follow_up_max_visits',null,'emergency_fee',0,'source','doctor'),
    pg_temp.no_episode(), 'new'), 500, 'new');

SELECT pg_temp.chk('doctor configured free bills Rs.0',
  public.compute_consultation_fee(
    jsonb_build_object('fee',0,'follow_up_fee',null,'follow_up_validity_days',7,
                       'follow_up_max_visits',null,'emergency_fee',0,'source','doctor'),
    pg_temp.no_episode(), 'new'), 0, 'new');

-- ── emergency precedence ──────────────────────────────────────────────────────
SELECT pg_temp.chk('emergency outranks follow-up inside validity',
  public.compute_consultation_fee(pg_temp.menon(), pg_temp.episode(2,0), 'emergency'), 1000, 'emergency');

SELECT pg_temp.chk('emergency with no rate falls back to full',
  public.compute_consultation_fee(jsonb_set(pg_temp.menon(),'{emergency_fee}','0'),
    pg_temp.no_episode(), 'emergency'), 700, 'emergency');

-- ── opd_revisit_rules discounts ───────────────────────────────────────────────
-- 50% off within 30 days, applied only after the follow-up rate is ruled out.
SELECT pg_temp.chk('revisit discount applies after follow-up ruled out',
  public.compute_consultation_fee(
    jsonb_set(pg_temp.menon(),'{follow_up_fee}','null'),
    pg_temp.episode(20,0),
    'revisit', 'revisit',
    '{"enabled":true,"rules":[{"within_days":30,"same_doctor":true,"discount_type":"percent","amount":50}]}'::jsonb
  ), 350, 'new');

\echo ''
\echo '================ PARITY RESULTS ================'
SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS status, name, CASE WHEN ok THEN '' ELSE detail END AS got
FROM results ORDER BY ok, name;
\echo ''
SELECT count(*) FILTER (WHERE ok) AS passed, count(*) FILTER (WHERE NOT ok) AS failed FROM results;
