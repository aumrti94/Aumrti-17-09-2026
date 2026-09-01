-- Lab & Radiology results → OPD / IPD, part 3 of 3: link historical orphaned orders.
--
-- Orders raised from the Lab/Radiology worklist saved with encounter_id AND admission_id
-- NULL unless the modal happened to be opened from the "Pending from OPD" tab. Those results
-- can never appear under a visit, because there is no visit recorded on them.
--
-- The order modals are fixed to resolve and record the link at creation time. This migration
-- repairs the rows already written, but ONLY where the answer is unambiguous:
--
--   * prefer an admission of the same patient+hospital that was open on the order date;
--   * otherwise an OPD encounter of the same patient+hospital on the order date;
--   * link only when EXACTLY ONE candidate exists. Two admissions or two encounters on the
--     same day is a real possibility (transfer, second opinion, revisit), and guessing would
--     attach a result to the wrong episode of care — worse than leaving it unlinked. An
--     ambiguous row stays NULL and remains visible to the doctor under the Reports panel's
--     patient-level "All previous" scope.
--
-- Every candidate lookup is scoped by hospital_id as well as patient_id: a patient row is
-- per-hospital, but the predicate is stated explicitly so no cross-tenant link is possible
-- even if that ever changes.
--
-- Idempotent: only rows with both columns NULL are touched, so a second run is a no-op.

/* ─────────── lab_orders ─────────── */
WITH candidates AS (
  SELECT
    o.id AS order_id,
    (SELECT array_agg(a.id) FROM public.admissions a
      WHERE a.hospital_id = o.hospital_id
        AND a.patient_id  = o.patient_id
        AND o.order_date >= a.admitted_at::date
        AND o.order_date <= coalesce(a.discharged_at::date, current_date)) AS adm,
    (SELECT array_agg(e.id) FROM public.opd_encounters e
      WHERE e.hospital_id = o.hospital_id
        AND e.patient_id  = o.patient_id
        AND e.visit_date  = o.order_date) AS enc
  FROM public.lab_orders o
  WHERE o.encounter_id IS NULL
    AND o.admission_id IS NULL
    AND o.order_date IS NOT NULL
)
UPDATE public.lab_orders o
SET admission_id = CASE WHEN array_length(c.adm, 1) = 1 THEN c.adm[1] END,
    encounter_id = CASE WHEN c.adm IS NULL AND array_length(c.enc, 1) = 1 THEN c.enc[1] END
FROM candidates c
WHERE o.id = c.order_id
  AND (array_length(c.adm, 1) = 1
       OR (c.adm IS NULL AND array_length(c.enc, 1) = 1));

/* ─────────── radiology_orders ─────────── */
WITH candidates AS (
  SELECT
    o.id AS order_id,
    (SELECT array_agg(a.id) FROM public.admissions a
      WHERE a.hospital_id = o.hospital_id
        AND a.patient_id  = o.patient_id
        AND o.order_date >= a.admitted_at::date
        AND o.order_date <= coalesce(a.discharged_at::date, current_date)) AS adm,
    (SELECT array_agg(e.id) FROM public.opd_encounters e
      WHERE e.hospital_id = o.hospital_id
        AND e.patient_id  = o.patient_id
        AND e.visit_date  = o.order_date) AS enc
  FROM public.radiology_orders o
  WHERE o.encounter_id IS NULL
    AND o.admission_id IS NULL
    AND o.order_date IS NOT NULL
)
UPDATE public.radiology_orders o
SET admission_id = CASE WHEN array_length(c.adm, 1) = 1 THEN c.adm[1] END,
    encounter_id = CASE WHEN c.adm IS NULL AND array_length(c.enc, 1) = 1 THEN c.enc[1] END
FROM candidates c
WHERE o.id = c.order_id
  AND (array_length(c.adm, 1) = 1
       OR (c.adm IS NULL AND array_length(c.enc, 1) = 1));

/* ─────────── external_lab_referrals ───────────
   admission_id was only just added (20261018000001), so every historical referral is
   unlinked on that side. referred_at is a timestamptz here, not a date. */
WITH candidates AS (
  SELECT
    r.id AS referral_id,
    r.referred_at::date AS ref_date,
    (SELECT array_agg(a.id) FROM public.admissions a
      WHERE a.hospital_id = r.hospital_id
        AND a.patient_id  = r.patient_id
        AND r.referred_at::date >= a.admitted_at::date
        AND r.referred_at::date <= coalesce(a.discharged_at::date, current_date)) AS adm,
    (SELECT array_agg(e.id) FROM public.opd_encounters e
      WHERE e.hospital_id = r.hospital_id
        AND e.patient_id  = r.patient_id
        AND e.visit_date  = r.referred_at::date) AS enc
  FROM public.external_lab_referrals r
  WHERE r.encounter_id IS NULL
    AND r.admission_id IS NULL
    AND r.referred_at IS NOT NULL
    AND r.patient_id IS NOT NULL
)
UPDATE public.external_lab_referrals r
SET admission_id = CASE WHEN array_length(c.adm, 1) = 1 THEN c.adm[1] END,
    encounter_id = CASE WHEN c.adm IS NULL AND array_length(c.enc, 1) = 1 THEN c.enc[1] END
FROM candidates c
WHERE r.id = c.referral_id
  AND (array_length(c.adm, 1) = 1
       OR (c.adm IS NULL AND array_length(c.enc, 1) = 1));

/* ─────────── Report what could not be resolved ───────────
   These rows are not a failure — they are the ambiguous cases we deliberately refused to
   guess at. They stay reachable under the patient-level scope. */
DO $$
DECLARE
  lab_left bigint;
  rad_left bigint;
  ref_left bigint;
BEGIN
  SELECT count(*) INTO lab_left FROM public.lab_orders
    WHERE encounter_id IS NULL AND admission_id IS NULL;
  SELECT count(*) INTO rad_left FROM public.radiology_orders
    WHERE encounter_id IS NULL AND admission_id IS NULL;
  SELECT count(*) INTO ref_left FROM public.external_lab_referrals
    WHERE encounter_id IS NULL AND admission_id IS NULL;

  RAISE NOTICE 'Investigation link backfill complete. Still unlinked (ambiguous or no candidate) — lab_orders: %, radiology_orders: %, external_lab_referrals: %',
    lab_left, rad_left, ref_left;
END $$;
