-- bills / bill_line_items / appointments exactly as the REAL migrations define them.
-- Note bills here is 20260323042425 (the live definition), NOT the superseded
-- 20260322092601 one: the live table's payment_status has no 'cancelled' member and
-- voiding goes through bill_status instead.

CREATE TABLE public.bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL,
  bill_number text UNIQUE NOT NULL,
  patient_id uuid NOT NULL,
  encounter_id uuid,
  bill_type text NOT NULL DEFAULT 'opd' CHECK (bill_type IN ('opd','ipd','emergency','daycare','package')),
  bill_date date NOT NULL DEFAULT CURRENT_DATE,
  bill_status text NOT NULL DEFAULT 'draft'
    CHECK (bill_status IN ('draft','final','partially_paid','paid','cancelled','refunded','insurance_pending')),
  subtotal numeric(12,2) DEFAULT 0,
  discount_amount numeric(12,2) DEFAULT 0,
  taxable_amount numeric(12,2) DEFAULT 0,
  gst_amount numeric(12,2) DEFAULT 0,
  total_amount numeric(12,2) DEFAULT 0,
  patient_payable numeric(12,2) DEFAULT 0,
  paid_amount numeric(12,2) DEFAULT 0,
  balance_due numeric(12,2) DEFAULT 0,
  payment_status text NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid','partial','paid','refund_pending','refunded')),
  notes text,
  created_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE public.bill_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL,
  bill_id uuid REFERENCES bills(id) ON DELETE CASCADE NOT NULL,
  description text NOT NULL,
  item_type text,
  unit_rate numeric(12,2) DEFAULT 0,
  quantity numeric(10,2) DEFAULT 1,
  discount_amount numeric(12,2) DEFAULT 0,
  taxable_amount numeric(12,2) DEFAULT 0,
  gst_percent numeric(5,2) DEFAULT 0,
  gst_amount numeric(12,2) DEFAULT 0,
  total_amount numeric(12,2) DEFAULT 0,
  source_module text,
  source_dedupe_key text,
  created_at timestamptz DEFAULT now()
);

-- Stand-in for the BEFORE INSERT trigger at 20261008000161 that mints bill_number inside
-- the transaction, so callers legitimately omit it.
CREATE OR REPLACE FUNCTION public.bills_assign_bill_number()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.bill_number IS NULL OR btrim(NEW.bill_number) = '' THEN
    NEW.bill_number := 'BILL-' || to_char(now(), 'YYYY') || '-' ||
                       lpad(nextval('bill_number_seq')::text, 5, '0');
  END IF;
  RETURN NEW;
END; $$;
CREATE SEQUENCE IF NOT EXISTS bill_number_seq;
DROP TRIGGER IF EXISTS trg_bills_assign_bill_number ON public.bills;
CREATE TRIGGER trg_bills_assign_bill_number BEFORE INSERT ON public.bills
FOR EACH ROW EXECUTE FUNCTION public.bills_assign_bill_number();

CREATE TABLE public.appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL, patient_id uuid NOT NULL, doctor_id uuid NOT NULL,
  department_id uuid,
  appointment_date date NOT NULL, slot_time time NOT NULL, slot_end_time time NOT NULL,
  status text NOT NULL DEFAULT 'scheduled',
  visit_type text NOT NULL DEFAULT 'new',
  visit_purpose text,
  appointment_type text DEFAULT 'opd',
  chief_complaint text, consultation_fee numeric(10,2) DEFAULT 0,
  booked_by uuid, booked_via text NOT NULL DEFAULT 'reception',
  booking_source text DEFAULT 'front_desk',
  whatsapp_reminder_sent boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Verbatim from 20260418180322:29 — the state migration 2 must widen without breaking.
CREATE OR REPLACE FUNCTION public.validate_appointment()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status NOT IN ('scheduled','confirmed','arrived','in_consultation','completed','cancelled','no_show') THEN
    RAISE EXCEPTION 'Invalid appointment status: %', NEW.status;
  END IF;
  IF NEW.visit_type NOT IN ('new','follow_up','review') THEN
    RAISE EXCEPTION 'Invalid visit_type: %', NEW.visit_type;
  END IF;
  IF NEW.booked_via NOT IN ('reception','portal','phone') THEN
    RAISE EXCEPTION 'Invalid booked_via: %', NEW.booked_via;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_validate_appointment ON public.appointments;
CREATE TRIGGER trg_validate_appointment
BEFORE INSERT OR UPDATE ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.validate_appointment();

-- The partial unique index from 20261007000000: any status other than cancelled/no_show
-- occupies the doctor's slot, which is what makes a payment_pending hold block it.
CREATE UNIQUE INDEX appointments_active_slot_uniq
  ON public.appointments (hospital_id, doctor_id, appointment_date, slot_time)
  WHERE status NOT IN ('cancelled','no_show');
