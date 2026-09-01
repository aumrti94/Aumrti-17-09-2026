-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- API Platform — Phase 5: the event outbox
--
-- Business triggers write to api_events in the SAME transaction as the row that caused the
-- event. An event can therefore never describe a write that rolled back, and can never be lost
-- because an HTTP call failed midway. Emitting from application code after commit gives neither
-- guarantee, which is why these live in the database.
--
-- Contract: docs/api/EVENT_CATALOG.md
-- ═════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1. Subscriber lookup index
--
-- The emit function asks "does anyone here subscribe to this event type" on every business
-- write, so that question must be answered from an index rather than a scan of the tenant's
-- endpoints.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_events_gin
  ON public.webhook_endpoints USING GIN (events)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_active_hospital
  ON public.webhook_endpoints (hospital_id)
  WHERE is_active = true;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2. emit_api_event() — one function, reused by every trigger
--
-- Mirrors the route registry's structural idea: adding an event is adding a trigger, not writing
-- another function that drifts from the others.
--
--   TG_ARGV[0]  event type, e.g. 'billing.bill.paid'
--   TG_ARGV[1]  public resource path prefix, e.g. '/v1/bills'
--
-- ── On never raising ─────────────────────────────────────────────────────────────────────────
-- This function swallows its own errors. That is a deliberate trade against the outbox's
-- delivery guarantee, and it is the right way round for a hospital system: if writing an event
-- row fails, the alternatives are to lose the event or to abort the patient registration, the
-- bill, or the lab result that triggered it. Losing a webhook is recoverable; refusing to admit
-- a patient because a webhook table is unavailable is not.
--
-- So the guarantee is precisely: an event is never emitted for a write that rolled back. It is
-- NOT that an event is never lost. A failure here is logged as a warning and the business write
-- proceeds untouched.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.emit_api_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_type  text := TG_ARGV[0];
  v_path_prefix text := TG_ARGV[1];
  v_hospital_id uuid;
BEGIN
  BEGIN
    v_hospital_id := NEW.hospital_id;

    IF v_hospital_id IS NULL THEN
      RETURN NEW;
    END IF;

    -- Emit only when somebody is listening. An unconditional outbox would add a row to every
    -- business write in the product forever, including for the large majority of hospitals that
    -- have registered no endpoint at all. The consequence, which is also correct webhook
    -- behaviour, is that events begin at the moment a subscription is created.
    IF NOT EXISTS (
      SELECT 1 FROM public.webhook_endpoints
       WHERE hospital_id = v_hospital_id
         AND is_active = true
         AND v_event_type = ANY (events)
    ) THEN
      RETURN NEW;
    END IF;

    INSERT INTO public.api_events (
      hospital_id, event_type, resource_type, resource_id, payload, contains_phi, occurred_at
    )
    VALUES (
      v_hospital_id,
      v_event_type,
      TG_TABLE_NAME,
      NEW.id,
      -- Thin by default: an id and a link the subscriber calls back with its own API key, which
      -- re-checks that key's scopes and tenant. The webhook itself therefore grants nothing.
      jsonb_build_object('id', NEW.id, 'self', v_path_prefix || '/' || NEW.id),
      false,
      now()
    );

  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'emit_api_event(%) failed for %.%: %',
      v_event_type, TG_TABLE_NAME, NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.emit_api_event IS
  'Transactional outbox emitter. Never raises: a webhook failure must not roll back the clinical '
  'or billing write that triggered it.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 3. Triggers
--
-- Conditions live in the trigger WHEN clause rather than inside the function, so the row is
-- never even passed to PL/pgSQL unless the transition actually occurred. Each corresponds to a
-- row in docs/api/EVENT_CATALOG.md §2.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- Patients
DROP TRIGGER IF EXISTS trg_emit_patient_registered ON public.patients;
CREATE TRIGGER trg_emit_patient_registered
  AFTER INSERT ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.emit_api_event('patients.patient.registered', '/v1/patients');

-- Demographic corrections only. Without the WHEN clause every touch of a patient row — including
-- the PHI backfill rewriting encrypted columns — would emit an "updated" event.
DROP TRIGGER IF EXISTS trg_emit_patient_updated ON public.patients;
CREATE TRIGGER trg_emit_patient_updated
  AFTER UPDATE ON public.patients
  FOR EACH ROW
  WHEN (
    OLD.full_name   IS DISTINCT FROM NEW.full_name  OR
    OLD.phone       IS DISTINCT FROM NEW.phone      OR
    OLD.dob         IS DISTINCT FROM NEW.dob        OR
    OLD.gender      IS DISTINCT FROM NEW.gender     OR
    OLD.email       IS DISTINCT FROM NEW.email      OR
    OLD.address     IS DISTINCT FROM NEW.address    OR
    OLD.blood_group IS DISTINCT FROM NEW.blood_group
  )
  EXECUTE FUNCTION public.emit_api_event('patients.patient.updated', '/v1/patients');

-- Scheduling
DROP TRIGGER IF EXISTS trg_emit_appointment_booked ON public.appointments;
CREATE TRIGGER trg_emit_appointment_booked
  AFTER INSERT ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.emit_api_event('scheduling.appointment.booked', '/v1/appointments');

DROP TRIGGER IF EXISTS trg_emit_appointment_cancelled ON public.appointments;
CREATE TRIGGER trg_emit_appointment_cancelled
  AFTER UPDATE ON public.appointments
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'cancelled')
  EXECUTE FUNCTION public.emit_api_event('scheduling.appointment.cancelled', '/v1/appointments');

DROP TRIGGER IF EXISTS trg_emit_appointment_checked_in ON public.appointments;
CREATE TRIGGER trg_emit_appointment_checked_in
  AFTER UPDATE ON public.appointments
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'arrived')
  EXECUTE FUNCTION public.emit_api_event('scheduling.appointment.checked_in', '/v1/appointments');

DROP TRIGGER IF EXISTS trg_emit_appointment_rescheduled ON public.appointments;
CREATE TRIGGER trg_emit_appointment_rescheduled
  AFTER UPDATE ON public.appointments
  FOR EACH ROW
  WHEN (
    OLD.appointment_date IS DISTINCT FROM NEW.appointment_date OR
    OLD.slot_time        IS DISTINCT FROM NEW.slot_time
  )
  EXECUTE FUNCTION public.emit_api_event('scheduling.appointment.rescheduled', '/v1/appointments');

-- OPD
DROP TRIGGER IF EXISTS trg_emit_encounter_started ON public.opd_encounters;
CREATE TRIGGER trg_emit_encounter_started
  AFTER INSERT ON public.opd_encounters
  FOR EACH ROW EXECUTE FUNCTION public.emit_api_event('opd.encounter.started', '/v1/encounters');

-- IPD
DROP TRIGGER IF EXISTS trg_emit_admission_created ON public.admissions;
CREATE TRIGGER trg_emit_admission_created
  AFTER INSERT ON public.admissions
  FOR EACH ROW EXECUTE FUNCTION public.emit_api_event('ipd.admission.created', '/v1/admissions');

DROP TRIGGER IF EXISTS trg_emit_admission_discharged ON public.admissions;
CREATE TRIGGER trg_emit_admission_discharged
  AFTER UPDATE ON public.admissions
  FOR EACH ROW
  WHEN (OLD.discharged_at IS NULL AND NEW.discharged_at IS NOT NULL)
  EXECUTE FUNCTION public.emit_api_event('ipd.admission.discharged', '/v1/admissions');

DROP TRIGGER IF EXISTS trg_emit_admission_transferred ON public.admissions;
CREATE TRIGGER trg_emit_admission_transferred
  AFTER UPDATE ON public.admissions
  FOR EACH ROW
  WHEN (OLD.bed_id IS DISTINCT FROM NEW.bed_id OR OLD.ward_id IS DISTINCT FROM NEW.ward_id)
  EXECUTE FUNCTION public.emit_api_event('ipd.admission.transferred', '/v1/admissions');

-- Billing
DROP TRIGGER IF EXISTS trg_emit_bill_created ON public.bills;
CREATE TRIGGER trg_emit_bill_created
  AFTER INSERT ON public.bills
  FOR EACH ROW EXECUTE FUNCTION public.emit_api_event('billing.bill.created', '/v1/bills');

DROP TRIGGER IF EXISTS trg_emit_bill_paid ON public.bills;
CREATE TRIGGER trg_emit_bill_paid
  AFTER UPDATE ON public.bills
  FOR EACH ROW
  -- 'advance_covered' is settlement too: the bill is fully covered from the deposit the patient
  -- already paid. Firing only on 'paid' would mean a hospital that runs on advances — which most
  -- IPD does — never sees a bill.paid event at all.
  WHEN (
    OLD.payment_status IS DISTINCT FROM NEW.payment_status
    AND NEW.payment_status IN ('paid', 'advance_covered')
  )
  EXECUTE FUNCTION public.emit_api_event('billing.bill.paid', '/v1/bills');

DROP TRIGGER IF EXISTS trg_emit_payment_received ON public.bill_payments;
CREATE TRIGGER trg_emit_payment_received
  AFTER INSERT ON public.bill_payments
  FOR EACH ROW EXECUTE FUNCTION public.emit_api_event('billing.payment.received', '/v1/payments');

-- Laboratory
DROP TRIGGER IF EXISTS trg_emit_lab_order_placed ON public.lab_orders;
CREATE TRIGGER trg_emit_lab_order_placed
  AFTER INSERT ON public.lab_orders
  FOR EACH ROW EXECUTE FUNCTION public.emit_api_event('lab.order.placed', '/v1/lab/orders');

DROP TRIGGER IF EXISTS trg_emit_lab_sample_collected ON public.lab_orders;
CREATE TRIGGER trg_emit_lab_sample_collected
  AFTER UPDATE ON public.lab_orders
  FOR EACH ROW
  WHEN (OLD.sample_collected_at IS NULL AND NEW.sample_collected_at IS NOT NULL)
  EXECUTE FUNCTION public.emit_api_event('lab.sample.collected', '/v1/lab/orders');

-- Validation, not result entry, is what makes a result clinically final — see the note on
-- validated_at in the /v1/lab/results route description.
DROP TRIGGER IF EXISTS trg_emit_lab_result_published ON public.lab_order_items;
CREATE TRIGGER trg_emit_lab_result_published
  AFTER UPDATE ON public.lab_order_items
  FOR EACH ROW
  WHEN (OLD.validated_at IS NULL AND NEW.validated_at IS NOT NULL)
  EXECUTE FUNCTION public.emit_api_event('lab.result.published', '/v1/lab/results');

-- Emitted so partner systems can react. It is NOT the clinical alerting path — see
-- EVENT_CATALOG.md §6. The in-product alert is acknowledgement-tracked and NABH-evidenced;
-- this is best-effort delivery to a third party that may be down.
DROP TRIGGER IF EXISTS trg_emit_lab_result_critical ON public.lab_order_items;
CREATE TRIGGER trg_emit_lab_result_critical
  AFTER UPDATE ON public.lab_order_items
  FOR EACH ROW
  -- 'CH'/'CL' are the codes calcFlag() writes (src/components/lab/LabResultWorkspace.tsx) for
  -- critical high and critical low. The full set is N/H/L/CH/CL — NOT the spelled-out words;
  -- critical_high and critical_low are threshold COLUMNS on lab_test_master, not flag values.
  WHEN (
    OLD.result_flag IS DISTINCT FROM NEW.result_flag
    AND NEW.result_flag IN ('CH', 'CL')
  )
  EXECUTE FUNCTION public.emit_api_event('lab.result.critical', '/v1/lab/results');

DROP TRIGGER IF EXISTS trg_emit_bill_finalised ON public.bills;
CREATE TRIGGER trg_emit_bill_finalised
  AFTER UPDATE ON public.bills
  FOR EACH ROW
  WHEN (OLD.bill_status IS DISTINCT FROM NEW.bill_status AND NEW.bill_status = 'final')
  EXECUTE FUNCTION public.emit_api_event('billing.bill.finalised', '/v1/bills');

DROP TRIGGER IF EXISTS trg_emit_refund_issued ON public.bills;
CREATE TRIGGER trg_emit_refund_issued
  AFTER UPDATE ON public.bills
  FOR EACH ROW
  WHEN (OLD.payment_status IS DISTINCT FROM NEW.payment_status AND NEW.payment_status = 'refunded')
  EXECUTE FUNCTION public.emit_api_event('billing.refund.issued', '/v1/bills');

-- Radiology
DROP TRIGGER IF EXISTS trg_emit_radiology_order_placed ON public.radiology_orders;
CREATE TRIGGER trg_emit_radiology_order_placed
  AFTER INSERT ON public.radiology_orders
  FOR EACH ROW EXECUTE FUNCTION public.emit_api_event('radiology.order.placed', '/v1/radiology/orders');

-- Signature, not report entry, is what publishes a radiology report — the same distinction as
-- validated_at on a lab result.
DROP TRIGGER IF EXISTS trg_emit_radiology_report_published ON public.radiology_reports;
CREATE TRIGGER trg_emit_radiology_report_published
  AFTER UPDATE ON public.radiology_reports
  FOR EACH ROW
  WHEN (OLD.is_signed IS DISTINCT FROM NEW.is_signed AND NEW.is_signed = true)
  EXECUTE FUNCTION public.emit_api_event('radiology.report.published', '/v1/radiology/reports');

-- Pharmacy
DROP TRIGGER IF EXISTS trg_emit_prescription_created ON public.prescriptions;
CREATE TRIGGER trg_emit_prescription_created
  AFTER INSERT ON public.prescriptions
  FOR EACH ROW EXECUTE FUNCTION public.emit_api_event('pharmacy.prescription.created', '/v1/pharmacy/prescriptions');

DROP TRIGGER IF EXISTS trg_emit_dispense_completed ON public.pharmacy_dispensing;
CREATE TRIGGER trg_emit_dispense_completed
  AFTER UPDATE ON public.pharmacy_dispensing
  FOR EACH ROW
  WHEN (OLD.dispensed_at IS NULL AND NEW.dispensed_at IS NOT NULL)
  EXECUTE FUNCTION public.emit_api_event('pharmacy.dispense.completed', '/v1/pharmacy/dispenses');

COMMIT;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- 4. claim_api_events() — atomic claim for the dispatcher
--
-- Two dispatcher invocations can overlap (a slow run, then the next cron tick). Without an
-- atomic claim both would read the same undispatched rows and every subscriber would receive
-- each event twice. FOR UPDATE SKIP LOCKED lets concurrent workers take disjoint batches.
--
-- dispatched_at is stamped at claim time rather than after delivery: a crash mid-batch must not
-- leave rows that are re-sent on every subsequent tick forever. Redelivery is the retry ladder's
-- job, tracked per endpoint in webhook_deliveries, not the outbox's.
-- ═════════════════════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.claim_api_events(p_limit integer DEFAULT 100)
RETURNS SETOF public.api_events
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.api_events
     SET dispatched_at = now()
   WHERE id IN (
     SELECT id FROM public.api_events
      WHERE dispatched_at IS NULL
      ORDER BY occurred_at
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
   )
  RETURNING *;
$$;

COMMENT ON FUNCTION public.claim_api_events IS
  'Atomically claims a batch of undispatched outbox events. SKIP LOCKED so overlapping '
  'dispatcher runs take disjoint batches instead of double-sending.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- 5. Schedule — deliberately NOT here
--
-- This migration originally scheduled the dispatcher itself, copying the cron block from
-- 20260518000008_leakage_reports.sql. That block is dead code and copying it was a mistake:
--
--   * it called `pg_net.http_post`, but pg_net installs its API into schema `net`;
--   * it read current_setting('app.supabase_functions_url', true), a GUC nothing sets — with
--     missing_ok = true that returns NULL, so the job posted to a NULL url and failed silently
--     every minute.
--
-- Both were already solved project-wide by 20261008000100_cron_jobs_use_vault.sql, which moved
-- every HTTP-triggered job onto net.http_post plus a Vault credential lookup. Scheduling belongs
-- there, alongside the other six jobs, not scattered across feature migrations.
--
-- See 20261019000007_schedule_webhook_dispatcher.sql.
-- ═════════════════════════════════════════════════════════════════════════════════════════════
