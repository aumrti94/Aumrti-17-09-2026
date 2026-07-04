-- Phase 4 of Lab/Pathology/LIMS completion plan: atomic lab-order creation.
--
-- investigationSync.syncLabOrders inserted the lab_orders header, then items, then
-- samples as three separate statements with a manual client-side "rollback" — when the
-- item insert failed (or the tab closed mid-flight) a header-only ghost order was left
-- behind, which LabPage papered over by client-side DELETEing empty orders older than
-- 5 minutes. This RPC makes the whole creation one transaction so ghosts cannot exist;
-- the LabPage band-aid is removed in the same phase.
--
-- SECURITY INVOKER: the caller's RLS still applies (lab_orders' insert policy requires
-- ordered_by = the caller's users.id). Accession is assigned inside the transaction.

CREATE OR REPLACE FUNCTION public.create_lab_order_with_items(
  p_hospital_id    uuid,
  p_patient_id     uuid,
  p_ordered_by     uuid,
  p_encounter_id   uuid    DEFAULT NULL,
  p_admission_id   uuid    DEFAULT NULL,
  p_priority       text    DEFAULT 'routine',
  p_clinical_notes text    DEFAULT NULL,
  p_billing_status text    DEFAULT 'unbilled',
  p_items          jsonb   DEFAULT '[]'::jsonb,  -- [{test_id, result_unit, reference_range}]
  p_samples        jsonb   DEFAULT '[]'::jsonb   -- [{sample_type, barcode}]
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
    (hospital_id, patient_id, ordered_by, encounter_id, admission_id,
     priority, clinical_notes, status, billing_status, ordered_at, accession_number)
  VALUES
    (p_hospital_id, p_patient_id, p_ordered_by, p_encounter_id, p_admission_id,
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

GRANT EXECUTE ON FUNCTION public.create_lab_order_with_items(uuid, uuid, uuid, uuid, uuid, text, text, text, jsonb, jsonb) TO authenticated;
