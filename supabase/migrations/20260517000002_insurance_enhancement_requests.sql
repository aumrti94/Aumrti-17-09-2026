-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: insurance_enhancement_requests
-- Purpose  : Table for TPA pre-auth enhancement requests. Created when an IPD
--            bill charge would exceed the approved pre-auth ceiling. Routed to
--            the insurance_executive role for submission to the TPA.
-- Idempotent: Yes — uses IF NOT EXISTS, CREATE OR REPLACE.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.insurance_enhancement_requests (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id                 uuid        NOT NULL REFERENCES public.hospitals(id),
  admission_id                uuid        NOT NULL REFERENCES public.admissions(id),
  pre_auth_id                 uuid        NOT NULL REFERENCES public.insurance_pre_auth(id),

  -- Amounts — numeric(12,2) throughout; never JavaScript floats
  current_approved_amount     numeric(12,2) NOT NULL,
  service_amount              numeric(12,2) NOT NULL,
  additional_amount_requested numeric(12,2) NOT NULL,
  new_requested_total         numeric(12,2) NOT NULL
    CHECK (new_requested_total = current_approved_amount + additional_amount_requested),

  -- What triggered the request
  new_service_description     text        NOT NULL,
  clinical_justification      text        NOT NULL,

  -- Workflow state
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),

  -- People
  submitted_by  uuid REFERENCES public.users(id),
  reviewed_by   uuid REFERENCES public.users(id),
  reviewed_at   timestamptz,

  -- TPA response fields (filled by insurance executive after TPA replies)
  tpa_reference text,
  tpa_response_notes text,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Trigger to keep updated_at current
CREATE OR REPLACE FUNCTION public.set_updated_at_enhancement()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_enhancement_requests_updated_at
  ON public.insurance_enhancement_requests;
CREATE TRIGGER trg_enhancement_requests_updated_at
  BEFORE UPDATE ON public.insurance_enhancement_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_enhancement();

-- ── Indexes ──────────────────────────────────────────────────────────────────

-- Billing editor: "does this admission have any pending enhancement requests?"
CREATE INDEX IF NOT EXISTS idx_enhancement_requests_admission
  ON public.insurance_enhancement_requests (hospital_id, admission_id, status);

-- Insurance executive queue: pending requests sorted by age
CREATE INDEX IF NOT EXISTS idx_enhancement_requests_pending
  ON public.insurance_enhancement_requests (hospital_id, status, created_at)
  WHERE status = 'pending';

-- ── Row Level Security ────────────────────────────────────────────────────────

ALTER TABLE public.insurance_enhancement_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "enhancement_requests_select" ON public.insurance_enhancement_requests;
DROP POLICY IF EXISTS "enhancement_requests_insert" ON public.insurance_enhancement_requests;
DROP POLICY IF EXISTS "enhancement_requests_update" ON public.insurance_enhancement_requests;

CREATE POLICY "enhancement_requests_select"
  ON public.insurance_enhancement_requests
  FOR SELECT TO authenticated
  USING (hospital_id = public.get_user_hospital_id());

CREATE POLICY "enhancement_requests_insert"
  ON public.insurance_enhancement_requests
  FOR INSERT TO authenticated
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- UPDATE: insurance executive approves/rejects; billing exec may withdraw.
-- Column-level role restriction deferred to application layer until user_roles
-- table is formalised.
CREATE POLICY "enhancement_requests_update"
  ON public.insurance_enhancement_requests
  FOR UPDATE TO authenticated
  USING  (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());
