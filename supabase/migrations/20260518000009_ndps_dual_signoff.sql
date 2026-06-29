-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: ndps_dual_signoff
-- Purpose  : NDPS Act 1985 compliance — mandatory dual sign-off columns,
--            audit trigger, and staging table for pending counter-sign.
-- Idempotent: ADD COLUMN IF NOT EXISTS, DROP TRIGGER/CONSTRAINT IF EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Upgrade ndps_register — add dual-sign-off columns ─────────────────────
-- second_pharmacist_id already exists; keep it for backward compatibility.
ALTER TABLE public.ndps_register
  ADD COLUMN IF NOT EXISTS countersigned_by   uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS countersigned_at   timestamptz,
  ADD COLUMN IF NOT EXISTS prescriber_licence  text,
  ADD COLUMN IF NOT EXISTS rejection_reason    text;

-- Counter-signer must differ from the dispensing pharmacist
ALTER TABLE public.ndps_register
  DROP CONSTRAINT IF EXISTS ndps_different_pharmacists;
ALTER TABLE public.ndps_register
  ADD  CONSTRAINT ndps_different_pharmacists
    CHECK (countersigned_by IS NULL OR countersigned_by != pharmacist_id);

-- ── 2. Audit trigger on ndps_register ────────────────────────────────────────
-- Reuses log_phi_change() defined in 20260418102042_*.sql
DROP TRIGGER IF EXISTS audit_ndps_register ON public.ndps_register;
CREATE TRIGGER audit_ndps_register
  AFTER INSERT OR UPDATE OR DELETE ON public.ndps_register
  FOR EACH ROW EXECUTE FUNCTION public.log_phi_change();

-- ── 3. ndps_pending_dispenses — staging table for dual-sign workflow ──────────
-- Created when the primary pharmacist completes Step A (re-authentication).
-- Counter-signer reads this table for items awaiting their approval.
-- On approval: row updated to 'approved', parent writes ndps_register entry.
-- On rejection: row updated to 'rejected' for audit trail.

CREATE TABLE IF NOT EXISTS public.ndps_pending_dispenses (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id           uuid          NOT NULL REFERENCES public.hospitals(id),
  dispensing_id         uuid          NOT NULL,
  drug_id               uuid          NOT NULL REFERENCES public.drug_master(id),
  drug_name             text          NOT NULL,
  quantity              numeric(10,3) NOT NULL,
  patient_name          text          NOT NULL,
  prescriber_name       text          NOT NULL,
  prescriber_reg_no     text          NOT NULL DEFAULT '',
  prescriber_licence    text,
  prescription_number   text,
  primary_pharmacist_id uuid          NOT NULL REFERENCES public.users(id),
  primary_verified_at   timestamptz   NOT NULL DEFAULT now(),
  countersigner_id      uuid          REFERENCES public.users(id),
  status                text          NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','approved','rejected')),
  rejection_reason      text,
  resolved_at           timestamptz,
  created_at            timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ndps_pending_hospital_status
  ON public.ndps_pending_dispenses (hospital_id, status);

ALTER TABLE public.ndps_pending_dispenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ndps_pending_select" ON public.ndps_pending_dispenses;
DROP POLICY IF EXISTS "ndps_pending_all"    ON public.ndps_pending_dispenses;

CREATE POLICY "ndps_pending_select" ON public.ndps_pending_dispenses
  FOR SELECT TO authenticated USING (hospital_id = public.get_user_hospital_id());
CREATE POLICY "ndps_pending_all" ON public.ndps_pending_dispenses
  FOR ALL TO authenticated
  USING  (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());
