-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: discount_approval_authorization
-- Purpose  : Make discount-approval AUTHORIZATION configurable and enforced.
--
--   The approver role(s) for each discount tier are configured per hospital in
--   Settings → Approval Rules (hospital_settings key `discount_approval_rules`,
--   fields `t2_roles` / `t3_roles`). When a discount request is raised, the app
--   freezes the authorized role set onto the approval row so later config changes
--   don't retroactively alter who may approve an in-flight request.
--
--   The UI (DiscountTab, DiscountApprovalsInbox) shows the Approve button only to
--   an authorized role. This trigger closes the hole so a crafted API call cannot
--   approve a discount the acting user is not authorized for.
--
--   Override: super_admin / hospital_admin may approve any tier (mirrors
--   DISCOUNT_OVERRIDE_ROLES in src/lib/appRoles.ts).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, DROP TRIGGER IF EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Carry the authorized role set on each approval row ─────────────────────
ALTER TABLE public.bill_discount_approvals
  ADD COLUMN IF NOT EXISTS required_approver_roles text[];

-- Backfill existing rows from the legacy single-role column so old pending
-- requests remain approvable by the same role.
UPDATE public.bill_discount_approvals
SET required_approver_roles = ARRAY[required_approver_role]
WHERE required_approver_roles IS NULL
  AND required_approver_role IS NOT NULL
  AND required_approver_role <> 'none';

-- ── 2. Trigger: block an approve transition by an unauthorized role ───────────
CREATE OR REPLACE FUNCTION public.enforce_discount_approval_authorization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role text;
BEGIN
  -- Only guard the transition INTO 'approved'. Reject/cancel and the initial
  -- pending insert are unrestricted here.
  IF NEW.status = 'approved' AND COALESCE(OLD.status, '') <> 'approved' THEN
    SELECT role INTO v_role
    FROM public.users
    WHERE auth_user_id = auth.uid()
    LIMIT 1;

    -- Override roles may always approve.
    IF v_role IN ('super_admin', 'hospital_admin') THEN
      RETURN NEW;
    END IF;

    -- No resolvable role, or role not in the frozen authorized set → block.
    IF v_role IS NULL
       OR NEW.required_approver_roles IS NULL
       OR NOT (v_role = ANY (NEW.required_approver_roles)) THEN
      RAISE EXCEPTION
        'Your role is not authorized to approve this discount. Required: %.',
        COALESCE(array_to_string(NEW.required_approver_roles, ', '), 'an authorized role')
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  RETURN NEW;
END;$$;

DROP TRIGGER IF EXISTS trg_enforce_discount_approval_authorization ON public.bill_discount_approvals;
CREATE TRIGGER trg_enforce_discount_approval_authorization
  BEFORE UPDATE ON public.bill_discount_approvals
  FOR EACH ROW EXECUTE FUNCTION public.enforce_discount_approval_authorization();
