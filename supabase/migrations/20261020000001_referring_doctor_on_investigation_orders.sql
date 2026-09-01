-- Referring clinician on lab / radiology orders.
--
-- WHY THIS COLUMN EXISTS
--
-- `ordered_by` is load-bearing for row-level security. Both insert policies in
-- 20260517000001_investigation_order_schema_hardening.sql assert
--
--     ordered_by = (SELECT id FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1)
--
-- i.e. "you cannot raise an order in someone else's name". That is a real guarantee and it
-- stays.
--
-- But the lab bench and the radiology desk key in orders on behalf of the clinician who asked
-- for them, and the result-ready notification / the doctor's Reports tab need to reach THAT
-- clinician, not the receptionist. Overloading `ordered_by` with the referring doctor to serve
-- that need made every desk-raised order fail its WITH CHECK ("new row violates row-level
-- security policy for table \"radiology_orders\"").
--
-- So the two facts get two columns: `ordered_by` = who keyed it in (RLS-checked), and
-- `referring_doctor_id` = who asked for it (nullable, purely informational). Readers that route
-- results to a clinician should prefer `referring_doctor_id` and fall back to `ordered_by`.

ALTER TABLE public.lab_orders
  ADD COLUMN IF NOT EXISTS referring_doctor_id uuid REFERENCES public.users(id);

ALTER TABLE public.radiology_orders
  ADD COLUMN IF NOT EXISTS referring_doctor_id uuid REFERENCES public.users(id);

COMMENT ON COLUMN public.lab_orders.referring_doctor_id IS
  'Clinician who requested the investigation. NULL when the orderer is the requester. Never RLS-checked — see ordered_by for that.';
COMMENT ON COLUMN public.radiology_orders.referring_doctor_id IS
  'Clinician who requested the investigation. NULL when the orderer is the requester. Never RLS-checked — see ordered_by for that.';

-- Supports the doctor's "my results" queries, which filter by hospital + clinician.
CREATE INDEX IF NOT EXISTS idx_lab_orders_referring_doctor
  ON public.lab_orders (hospital_id, referring_doctor_id)
  WHERE referring_doctor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_radiology_orders_referring_doctor
  ON public.radiology_orders (hospital_id, referring_doctor_id)
  WHERE referring_doctor_id IS NOT NULL;


-- ---------------------------------------------------------------------------
-- create_lab_order_with_items: carry the referring doctor, and document that
-- p_items is a BATCH.
--
-- The callers changed shape in the same commit: investigationSync.syncLabOrders used to call
-- this once per test, producing one lab_orders header (and one accession, and one sample) per
-- test. A patient with four tests appeared four times in the lab worklist. p_items has always
-- been an array — the loop below has not changed — so the fix is entirely on the caller side;
-- this replace only adds the new parameter.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_lab_order_with_items(
  p_hospital_id         uuid,
  p_patient_id          uuid,
  p_ordered_by          uuid,
  p_encounter_id        uuid    DEFAULT NULL,
  p_admission_id        uuid    DEFAULT NULL,
  p_priority            text    DEFAULT 'routine',
  p_clinical_notes      text    DEFAULT NULL,
  p_billing_status      text    DEFAULT 'unbilled',
  p_items               jsonb   DEFAULT '[]'::jsonb,  -- [{test_id, result_unit, reference_range}] — a BATCH, one order holds all of them
  p_samples             jsonb   DEFAULT '[]'::jsonb,  -- [{sample_type, barcode}]
  p_referring_doctor_id uuid    DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_order_id  uuid;
  v_accession text;
  it jsonb;
  s  jsonb;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'create_lab_order_with_items: at least one item is required';
  END IF;

  v_accession := public.next_lab_accession(p_hospital_id);

  INSERT INTO public.lab_orders
    (hospital_id, patient_id, ordered_by, referring_doctor_id, encounter_id, admission_id,
     priority, clinical_notes, status, billing_status, ordered_at, accession_number)
  VALUES
    (p_hospital_id, p_patient_id, p_ordered_by, p_referring_doctor_id, p_encounter_id, p_admission_id,
     COALESCE(p_priority, 'routine'), p_clinical_notes, 'ordered',
     COALESCE(p_billing_status, 'unbilled'), now(), v_accession)
  RETURNING id INTO v_order_id;

  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO public.lab_order_items
      (hospital_id, lab_order_id, test_id, status, result_unit, reference_range)
    VALUES
      (p_hospital_id, v_order_id, NULLIF(it->>'test_id', '')::uuid, 'ordered',
       NULLIF(it->>'result_unit', ''), NULLIF(it->>'reference_range', ''));
  END LOOP;

  FOR s IN SELECT * FROM jsonb_array_elements(p_samples) LOOP
    INSERT INTO public.lab_samples
      (hospital_id, lab_order_id, sample_type, barcode, status)
    VALUES
      (p_hospital_id, v_order_id, COALESCE(NULLIF(s->>'sample_type', ''), 'blood'),
       COALESCE(NULLIF(s->>'barcode', ''), v_accession || '-' || substr(md5(random()::text), 1, 4)),
       'pending');
  END LOOP;

  RETURN v_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_lab_order_with_items(
  uuid, uuid, uuid, uuid, uuid, text, text, text, jsonb, jsonb, uuid
) TO authenticated;

-- The 10-argument signature is now unreachable from the client and would silently keep the old
-- per-test behaviour alive if anything still called it.
DROP FUNCTION IF EXISTS public.create_lab_order_with_items(
  uuid, uuid, uuid, uuid, uuid, text, text, text, jsonb, jsonb
);
