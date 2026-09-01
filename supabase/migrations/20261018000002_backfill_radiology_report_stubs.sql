-- Lab & Radiology results → OPD / IPD, part 2 of 3: repair unreportable radiology orders.
--
-- ROOT CAUSE. There are two ways a radiology order gets created:
--   * NewRadiologyOrderModal (the radiology desk) — inserts the order AND an empty
--     radiology_reports row immediately after it;
--   * syncRadiologyOrders in src/lib/investigationSync.ts (a doctor ordering imaging from an
--     OPD consultation or an IPD ward round) — inserted only the order.
--
-- RadiologyReportingWorkspace loads that report row and returns early from both saveDraft and
-- validateAndSign when it is missing. So every scan a DOCTOR ordered was silently
-- unreportable: the study could be performed, but the radiologist could not save findings
-- against it, and the result never came back to the person who asked for it. Orders raised by
-- the radiology desk itself were unaffected, which is why this looked like "radiology is not
-- linked to OPD/IPD" rather than an outright failure.
--
-- The code path is fixed in investigationSync.ts. This migration repairs the rows already in
-- the database, so historical orders become reportable rather than staying stuck.
--
-- Idempotent: the NOT EXISTS guard means re-running inserts nothing.

INSERT INTO public.radiology_reports (hospital_id, order_id, patient_id)
SELECT o.hospital_id, o.id, o.patient_id
FROM public.radiology_orders o
WHERE o.status <> 'cancelled'
  AND NOT EXISTS (
    SELECT 1 FROM public.radiology_reports r WHERE r.order_id = o.id
  );

DO $$
DECLARE
  remaining bigint;
BEGIN
  SELECT count(*) INTO remaining
  FROM public.radiology_orders o
  WHERE o.status <> 'cancelled'
    AND NOT EXISTS (SELECT 1 FROM public.radiology_reports r WHERE r.order_id = o.id);

  RAISE NOTICE 'radiology_reports stub backfill complete — % active order(s) still without a report row (expected 0)', remaining;
END $$;
