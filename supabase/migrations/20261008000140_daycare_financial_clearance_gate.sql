-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: daycare_financial_clearance_gate
-- Purpose  : Server-side enforcement of "financially cleared to admit a day care patient".
--
--            An elective day care patient walks out the same day, so there is no leverage
--            to collect afterwards. Indian day care units take the deposit (or the payer's
--            approval) up front. Nothing in this app enforced that: the discharge checklist
--            had a "Bill finalised and payment cleared" checkbox a user simply ticked.
--
-- Mirrors  : src/lib/dayCareGate.ts → evaluateDayCareClearance(). The TS function explains
--            the rule in the UI; THIS is the enforcement — a client cannot bypass it by
--            writing admissions directly. If one changes, change both. The truth table in
--            dayCareGate.test.ts locks the shared definition.
--
-- Rule     : cleared ⟺ policy off
--                    ∨ audited override (reason AND author)
--                    ∨ payer ≠ self_pay AND pre-auth 'approved'
--                    ∨ advance ≥ required deposit, where required is
--                        · partially_approved → estimate − approved_amount  (the TPA gap)
--                        · otherwise          → admission_estimates.deposit_required
--
-- Reachability: fires ONLY on the scheduled → active transition for admission_type='daycare'.
--            Only the new booking flow creates a 'scheduled' row, so every existing admission
--            path and every legacy daycare row is literally unreachable by this trigger.
--            That is why require_clearance can safely default TRUE.
--
-- Policy   : hospital_settings key 'daycare_payment'
--              { "require_clearance": bool, "deposit_percent": int, "override_roles": [text] }
--            mirroring the 'teleconsult_payment' key shape.
--
-- Idempotent: CREATE OR REPLACE + DROP TRIGGER IF EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.enforce_daycare_financial_clearance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_require   boolean;
  v_deposit   numeric;
  v_estimate  numeric;
  v_balance   numeric;
  v_pa_status text;
  v_pa_amount numeric;
  v_required  numeric;
  v_payer     text;
BEGIN
  -- Only the booking → admission transition for day care.
  IF COALESCE(NEW.admission_type, '') <> 'daycare'
     OR COALESCE(OLD.status, '') <> 'scheduled'
     OR COALESCE(NEW.status, '') <> 'active'
  THEN
    RETURN NEW;
  END IF;

  -- An audited override clears the gate. BOTH fields are required: a reason with no author,
  -- or an author with no reason, is not an audit trail.
  IF NEW.financial_override_by IS NOT NULL
     AND COALESCE(btrim(NEW.financial_override_reason), '') <> ''
  THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE((value->>'require_clearance')::boolean, true)
    INTO v_require
  FROM hospital_settings
  WHERE hospital_id = NEW.hospital_id AND key = 'daycare_payment';

  IF NOT COALESCE(v_require, true) THEN
    RETURN NEW;
  END IF;

  v_payer := lower(COALESCE(NEW.insurance_type, 'self_pay'));

  -- Latest pre-auth for this admission.
  SELECT lower(status), approved_amount
    INTO v_pa_status, v_pa_amount
  FROM insurance_pre_auth
  WHERE admission_id = NEW.id
  ORDER BY created_at DESC
  LIMIT 1;

  -- Payer approved in full: the hospital is not carrying the risk.
  IF v_payer <> 'self_pay' AND v_pa_status = 'approved' THEN
    RETURN NEW;
  END IF;

  SELECT estimated_amount, deposit_required
    INTO v_estimate, v_deposit
  FROM admission_estimates
  WHERE admission_id = NEW.id
  ORDER BY created_at DESC
  LIMIT 1;

  -- Partially approved: the patient owes the un-approved difference. Approving ₹30,000 of a
  -- ₹47,000 cataract leaves ₹17,000 that is the patient's — not collecting it is the single
  -- biggest day care leak.
  IF v_payer <> 'self_pay' AND v_pa_status = 'partially_approved' THEN
    IF v_estimate IS NULL THEN
      RAISE EXCEPTION
        'Day care admission blocked: pre-auth is only partially approved and no estimate '
        'exists to compute the patient''s share from. Record an estimate first.';
    END IF;
    v_required := GREATEST(0, v_estimate - COALESCE(v_pa_amount, 0));
  ELSE
    -- Self-pay, or insured with no approval yet (pending/submitted/rejected/none).
    v_required := v_deposit;
  END IF;

  IF v_required IS NULL THEN
    RAISE EXCEPTION
      'Day care admission blocked: no estimate recorded. Give the patient an estimate '
      '(Estimate & Deposit) before admitting.';
  END IF;

  IF v_required <= 0 THEN
    RETURN NEW;
  END IF;

  -- Never let a negative balance invent money the patient has not paid.
  SELECT GREATEST(0, COALESCE(balance, 0))
    INTO v_balance
  FROM ipd_advance_balances
  WHERE admission_id = NEW.id;
  v_balance := COALESCE(v_balance, 0);

  IF v_balance < v_required THEN
    RAISE EXCEPTION
      'Day care admission blocked: collected % of the required deposit % (shortfall %). '
      'Collect the balance, get the pre-auth approved, or record an audited override.',
      v_balance, v_required, v_required - v_balance;
  END IF;

  RETURN NEW;
END;$$;

DROP TRIGGER IF EXISTS trg_enforce_daycare_financial_clearance ON public.admissions;
CREATE TRIGGER trg_enforce_daycare_financial_clearance
  BEFORE UPDATE ON public.admissions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_daycare_financial_clearance();
