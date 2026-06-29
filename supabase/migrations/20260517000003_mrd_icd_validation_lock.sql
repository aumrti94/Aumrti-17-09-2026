-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: mrd_icd_validation_lock
-- Purpose  : Add MRD ICD lock gate before PMJAY claim submission.
--            Extends icd_codings with mrd_locked status + immutability trigger
--            + audit trail + validate_pmjay_icd_before_claim() RPC.
-- Idempotent: Yes — uses IF NOT EXISTS, CREATE OR REPLACE, DROP IF EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. mrd_officer role ───────────────────────────────────────────────────────
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'mrd_officer';

-- ── 2. New columns on icd_codings ────────────────────────────────────────────
ALTER TABLE public.icd_codings
  ADD COLUMN IF NOT EXISTS mrd_locked_by    uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS mrd_locked_at    timestamptz,
  ADD COLUMN IF NOT EXISTS mrd_justification text;

-- ── 3. Update status validation trigger to accept mrd_locked ─────────────────
-- The trigger trg_validate_icd_codings already exists; replacing the function
-- body is sufficient — the trigger picks up the new function automatically.
CREATE OR REPLACE FUNCTION public.validate_icd_codings()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status NOT IN ('pending', 'coded', 'validated', 'billed', 'mrd_locked') THEN
    RAISE EXCEPTION 'Invalid icd_codings status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

-- ── 4. Lock enforcement trigger ───────────────────────────────────────────────
-- BEFORE UPDATE: enforces
--   a) immutability once mrd_locked
--   b) role check when transitioning TO mrd_locked
--   c) source-state check (must be coded or validated)
--   d) auto-populates mrd_locked_by + mrd_locked_at from the calling session

CREATE OR REPLACE FUNCTION public.enforce_icd_mrd_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role text;
BEGIN
  -- Immutability: once locked, nobody can change it
  IF OLD.status = 'mrd_locked' THEN
    RAISE EXCEPTION 'ICD code is MRD-locked and cannot be modified';
  END IF;

  -- Transitioning TO mrd_locked
  IF NEW.status = 'mrd_locked' THEN
    SELECT role::text INTO v_role
    FROM public.users
    WHERE auth_user_id = auth.uid()
    LIMIT 1;

    IF v_role NOT IN ('mrd_officer', 'super_admin', 'hospital_admin') THEN
      RAISE EXCEPTION 'Only MRD officers can lock ICD codes';
    END IF;

    IF OLD.status NOT IN ('coded', 'validated') THEN
      RAISE EXCEPTION 'ICD must be in coded or validated state before locking (current: %)', OLD.status;
    END IF;

    -- Client sends only status + mrd_justification; DB fills audit metadata
    NEW.mrd_locked_at := now();
    NEW.mrd_locked_by := (
      SELECT id FROM public.users
      WHERE auth_user_id = auth.uid()
      LIMIT 1
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_icd_mrd_lock ON public.icd_codings;
CREATE TRIGGER trg_enforce_icd_mrd_lock
  BEFORE UPDATE ON public.icd_codings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_icd_mrd_lock();

-- ── 5. Audit trigger on icd_codings ──────────────────────────────────────────
-- Reuses existing log_phi_change() — same function attached to patients, bills, admissions.
DROP TRIGGER IF EXISTS audit_icd_codings ON public.icd_codings;
CREATE TRIGGER audit_icd_codings
  AFTER INSERT OR UPDATE OR DELETE ON public.icd_codings
  FOR EACH ROW EXECUTE FUNCTION public.log_phi_change();

-- ── 6. RPC: validate_pmjay_icd_before_claim ──────────────────────────────────
-- Returns TRUE only when an mrd_locked icd_codings row exists for the
-- given IPD admission. Called by PmjayClaimsTab before allowing submission.
CREATE OR REPLACE FUNCTION public.validate_pmjay_icd_before_claim(p_admission_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.icd_codings
    WHERE visit_id   = p_admission_id
      AND visit_type = 'ipd'
      AND status     = 'mrd_locked'
  )
$$;
