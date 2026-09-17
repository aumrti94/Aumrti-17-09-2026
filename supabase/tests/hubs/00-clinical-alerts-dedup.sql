-- Phase 5 (the five hubs) — clinical_alerts exit gate: "Dedup enforced at the DB layer on
-- clinical_alerts; run-any-step-twice asserts exactly one row." KNOWN-BUG-002 was LabTATPanel
-- (and, once audited, five other components/functions) re-inserting a duplicate alert on every
-- reload/poll/cron tick with no dedup check at all. The fix
-- (20261106000014_clinical_alerts_dedup_and_write_fixes.sql) added a nullable `dedupe_key`
-- column plus a plain UNIQUE constraint on (hospital_id, alert_type, dedupe_key) — this file is
-- the test that constraint's own existence claims.
--
-- Two things asserted per scenario, not one: running the exact "raise this alert" step twice
-- yields exactly one row (the dedup working), AND a DIFFERENT dedupe_key for the same
-- hospital+alert_type still gets its own row (proving the constraint isn't over-broad and
-- silently swallowing genuinely distinct alerts).
--
-- Self-contained: a throwaway hospital, rolled back at the end. No PHI.

BEGIN;
SELECT plan(6);

INSERT INTO public.hospitals (id, name)
VALUES ('77777777-7777-4777-8777-000000000001', 'Hub Test Hospital — Clinical Alerts');

-- ── 1 & 2. Same dedupe_key twice → exactly one row, and the FIRST message wins (DO NOTHING,
-- not DO UPDATE — a duplicate raise must not overwrite fields like is_acknowledged on the
-- existing row).

INSERT INTO public.clinical_alerts (hospital_id, alert_type, severity, alert_message, dedupe_key)
VALUES ('77777777-7777-4777-8777-000000000001', 'lab_tat_overdue', 'high', 'first raise', 'order-A')
ON CONFLICT (hospital_id, alert_type, dedupe_key) DO NOTHING;

INSERT INTO public.clinical_alerts (hospital_id, alert_type, severity, alert_message, dedupe_key)
VALUES ('77777777-7777-4777-8777-000000000001', 'lab_tat_overdue', 'high', 'second raise — must be skipped', 'order-A')
ON CONFLICT (hospital_id, alert_type, dedupe_key) DO NOTHING;

SELECT is(
  (SELECT count(*)::int FROM public.clinical_alerts
   WHERE hospital_id = '77777777-7777-4777-8777-000000000001' AND dedupe_key = 'order-A'),
  1,
  'raising the same alert (same hospital+type+dedupe_key) twice leaves exactly one row'
);

SELECT is(
  (SELECT alert_message FROM public.clinical_alerts
   WHERE hospital_id = '77777777-7777-4777-8777-000000000001' AND dedupe_key = 'order-A'),
  'first raise',
  'the surviving row is the FIRST raise, not overwritten by the duplicate attempt'
);

-- ── 3 & 4. A genuinely different order (different dedupe_key) still gets its own row — the
-- constraint must not collapse two distinct overdue orders into one alert.

INSERT INTO public.clinical_alerts (hospital_id, alert_type, severity, alert_message, dedupe_key)
VALUES ('77777777-7777-4777-8777-000000000001', 'lab_tat_overdue', 'high', 'a different overdue order', 'order-B')
ON CONFLICT (hospital_id, alert_type, dedupe_key) DO NOTHING;

SELECT is(
  (SELECT count(*)::int FROM public.clinical_alerts
   WHERE hospital_id = '77777777-7777-4777-8777-000000000001' AND alert_type = 'lab_tat_overdue'),
  2,
  'a different dedupe_key (a genuinely different order) is not swallowed by the constraint'
);

SELECT ok(
  (SELECT count(*)::int FROM public.clinical_alerts
   WHERE hospital_id = '77777777-7777-4777-8777-000000000001' AND dedupe_key = 'order-B') = 1,
  'the second, distinct order got its own row'
);

-- ── 5. NULL dedupe_key (every alert_type this migration did not touch) must repeat freely —
-- the whole point of a nullable column + plain UNIQUE is that untouched call sites are
-- unaffected. Standard SQL: NULL is never equal to NULL, so no conflict is ever inferred.

INSERT INTO public.clinical_alerts (hospital_id, alert_type, severity, alert_message)
VALUES
  ('77777777-7777-4777-8777-000000000001', 'drug_interaction', 'high', 'no dedupe key row 1'),
  ('77777777-7777-4777-8777-000000000001', 'drug_interaction', 'high', 'no dedupe key row 2');

SELECT is(
  (SELECT count(*)::int FROM public.clinical_alerts
   WHERE hospital_id = '77777777-7777-4777-8777-000000000001' AND alert_type = 'drug_interaction'
     AND dedupe_key IS NULL),
  2,
  'alert types with no dedupe_key still insert freely — the constraint only bites when populated'
);

-- ── 6. The five alert_type values found broken during this audit (never in the CHECK
-- whitelist, so every insert using them failed silently since inception) must now be accepted.

INSERT INTO public.clinical_alerts (hospital_id, alert_type, severity, alert_message)
VALUES
  ('77777777-7777-4777-8777-000000000001', 'pre_auth_expiry_alert', 'high', 'x'),
  ('77777777-7777-4777-8777-000000000001', 'irdai_deadline_alert', 'critical', 'x'),
  ('77777777-7777-4777-8777-000000000001', 'intimation_deadline_alert', 'critical', 'x'),
  ('77777777-7777-4777-8777-000000000001', 'daycare_no_show', 'low', 'x'),
  ('77777777-7777-4777-8777-000000000001', 'daycare_cancelled', 'low', 'x');

SELECT is(
  (SELECT count(*)::int FROM public.clinical_alerts
   WHERE hospital_id = '77777777-7777-4777-8777-000000000001'
     AND alert_type IN ('pre_auth_expiry_alert', 'irdai_deadline_alert', 'intimation_deadline_alert',
                         'daycare_no_show', 'daycare_cancelled')),
  5,
  'the five alert_type values found missing from the CHECK whitelist are now accepted'
);

SELECT * FROM finish();
ROLLBACK;
