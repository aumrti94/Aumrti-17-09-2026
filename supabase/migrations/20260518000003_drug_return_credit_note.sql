-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: drug_return_credit_note
-- Purpose  : Schema for IPD pharmacy drug return → bill credit note workflow.
--            1. Extend pharmacy_dispensing_items with return audit columns.
--            2. Create credit_notes table (against pharmacy bills).
--            3. Create refund_payables table (billing supervisor approval gate).
--            4. Lock ndps_register rows against mutation (immutability).
-- Idempotent: Yes — IF NOT EXISTS, CREATE OR REPLACE, DROP IF EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Extend pharmacy_dispensing_items ──────────────────────────────────────
ALTER TABLE public.pharmacy_dispensing_items
  ADD COLUMN IF NOT EXISTS returned_at           timestamptz,
  ADD COLUMN IF NOT EXISTS returned_by           uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS return_confirmed_by   uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS return_status         text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS ndps_return_senior_id uuid REFERENCES public.users(id);

ALTER TABLE public.pharmacy_dispensing_items
  DROP CONSTRAINT IF EXISTS pharmacy_dispensing_items_return_status_check;
ALTER TABLE public.pharmacy_dispensing_items
  ADD CONSTRAINT pharmacy_dispensing_items_return_status_check
    CHECK (return_status IN ('none', 'pending_confirmation', 'confirmed', 'rejected'));

-- ── 2. credit_notes ──────────────────────────────────────────────────────────
-- One credit note per return event. May cover multiple dispensing items.
-- Not stored as a bills row to avoid polluting the bills CHECK constraint.

CREATE TABLE IF NOT EXISTS public.credit_notes (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id              uuid        NOT NULL REFERENCES public.hospitals(id),
  credit_note_number       text        NOT NULL,
  patient_id               uuid        NOT NULL REFERENCES public.patients(id),
  admission_id             uuid        REFERENCES public.admissions(id),
  original_bill_id         uuid        REFERENCES public.bills(id),
  -- Dispensing link (loose — no FK because pharmacy_dispensing may not have explicit bill link)
  dispensing_id            uuid,
  credit_amount            numeric(12,2) NOT NULL DEFAULT 0,
  gst_credit               numeric(12,2) NOT NULL DEFAULT 0,
  total_credit             numeric(12,2) NOT NULL DEFAULT 0,
  return_reason            text        NOT NULL,
  -- Insurance flag: set true when original bill was insurance/PMJAY
  requires_insurance_amendment boolean NOT NULL DEFAULT false,
  insurance_amendment_notes    text,
  -- Workflow
  status                   text        NOT NULL DEFAULT 'approved'
    CHECK (status IN ('draft', 'approved', 'applied', 'voided')),
  created_by               uuid        REFERENCES public.users(id),
  approved_by              uuid        REFERENCES public.users(id),
  approved_at              timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_note_number
  ON public.credit_notes (hospital_id, credit_note_number);

CREATE INDEX IF NOT EXISTS idx_credit_notes_admission
  ON public.credit_notes (hospital_id, admission_id);

CREATE INDEX IF NOT EXISTS idx_credit_notes_patient
  ON public.credit_notes (hospital_id, patient_id, created_at DESC);

-- credit_note_items: one row per returned dispensing item
CREATE TABLE IF NOT EXISTS public.credit_note_items (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id              uuid        NOT NULL REFERENCES public.hospitals(id),
  credit_note_id           uuid        NOT NULL REFERENCES public.credit_notes(id) ON DELETE CASCADE,
  dispensing_item_id       uuid        REFERENCES public.pharmacy_dispensing_items(id),
  drug_name                text        NOT NULL,
  return_quantity          numeric(10,3) NOT NULL,
  unit_rate                numeric(12,2) NOT NULL,
  gst_percent              numeric(5,2)  NOT NULL DEFAULT 0,
  gst_credit               numeric(12,2) NOT NULL DEFAULT 0,
  line_credit              numeric(12,2) NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_credit_note_items_note
  ON public.credit_note_items (credit_note_id);

-- RLS: credit_notes + items follow hospital isolation
ALTER TABLE public.credit_notes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_note_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "credit_notes_select"      ON public.credit_notes;
DROP POLICY IF EXISTS "credit_notes_insert"      ON public.credit_notes;
DROP POLICY IF EXISTS "credit_notes_update"      ON public.credit_notes;
DROP POLICY IF EXISTS "credit_note_items_select" ON public.credit_note_items;
DROP POLICY IF EXISTS "credit_note_items_insert" ON public.credit_note_items;

CREATE POLICY "credit_notes_select" ON public.credit_notes
  FOR SELECT TO authenticated USING (hospital_id = public.get_user_hospital_id());
CREATE POLICY "credit_notes_insert" ON public.credit_notes
  FOR INSERT TO authenticated WITH CHECK (hospital_id = public.get_user_hospital_id());
CREATE POLICY "credit_notes_update" ON public.credit_notes
  FOR UPDATE TO authenticated
  USING  (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE POLICY "credit_note_items_select" ON public.credit_note_items
  FOR SELECT TO authenticated USING (hospital_id = public.get_user_hospital_id());
CREATE POLICY "credit_note_items_insert" ON public.credit_note_items
  FOR INSERT TO authenticated WITH CHECK (hospital_id = public.get_user_hospital_id());

-- ── 3. refund_payables ───────────────────────────────────────────────────────
-- Created when a drug-return credit note is raised on an already-paid bill.
-- Requires billing supervisor approval before cash/UPI refund is processed.

CREATE TABLE IF NOT EXISTS public.refund_payables (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id      uuid        NOT NULL REFERENCES public.hospitals(id),
  patient_id       uuid        NOT NULL REFERENCES public.patients(id),
  admission_id     uuid        REFERENCES public.admissions(id),
  credit_note_id   uuid        NOT NULL REFERENCES public.credit_notes(id),
  amount           numeric(12,2) NOT NULL,
  refund_mode      text        NOT NULL DEFAULT 'cash'
    CHECK (refund_mode IN ('cash', 'upi', 'bank_transfer', 'cheque')),
  status           text        NOT NULL DEFAULT 'pending_approval'
    CHECK (status IN ('pending_approval', 'approved', 'processed', 'rejected')),
  requested_by     uuid        REFERENCES public.users(id),
  approved_by      uuid        REFERENCES public.users(id),
  processed_at     timestamptz,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refund_payables_pending
  ON public.refund_payables (hospital_id, status, created_at)
  WHERE status = 'pending_approval';

ALTER TABLE public.refund_payables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "refund_payables_select" ON public.refund_payables;
DROP POLICY IF EXISTS "refund_payables_insert" ON public.refund_payables;
DROP POLICY IF EXISTS "refund_payables_update" ON public.refund_payables;

CREATE POLICY "refund_payables_select" ON public.refund_payables
  FOR SELECT TO authenticated USING (hospital_id = public.get_user_hospital_id());
CREATE POLICY "refund_payables_insert" ON public.refund_payables
  FOR INSERT TO authenticated WITH CHECK (hospital_id = public.get_user_hospital_id());
CREATE POLICY "refund_payables_update" ON public.refund_payables
  FOR UPDATE TO authenticated
  USING  (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- ── 4. NDPS register — immutability ─────────────────────────────────────────
-- NDPS return register entries must not be altered or deleted post-creation.
-- Any tampering is a controlled-substances violation under NDPS Act 1985.

CREATE OR REPLACE FUNCTION public.prevent_ndps_register_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'NDPS register entries are immutable — deletion is prohibited under NDPS Act 1985';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'NDPS register entries are immutable — amendments are prohibited under NDPS Act 1985';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_immutable_ndps_register ON public.ndps_register;
CREATE TRIGGER trg_immutable_ndps_register
  BEFORE UPDATE OR DELETE ON public.ndps_register
  FOR EACH ROW EXECUTE FUNCTION public.prevent_ndps_register_mutation();
