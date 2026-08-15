-- Aumrti security audit — refund approval segregation of duties.
--
-- src/components/billing/RefundApprovalsInbox.tsx gates "Approve & Process" / "Reject" on a
-- pending refund with hasActionAccess("billing","approve_refund", permissions, role) — a
-- client-side-only check. The actual mutation is a plain `refund_payables` UPDATE, and the
-- live refund_payables_update RLS policy (20260518000003_drug_return_credit_note.sql:142-145)
-- only enforces hospital_id, not role — so any authenticated user in the hospital can call the
-- API directly and self-approve their own refund request, bypassing the intended two-person
-- control.
--
-- This function becomes the ONLY path allowed to move a refund_payables row out of
-- 'pending_approval'. It re-checks role authorization server-side using role_permissions —
-- the base/role layer hasActionAccess consults first. It deliberately does NOT replicate the
-- hospital entitlement floor or per-user withhold overrides (the other two layers
-- hasActionAccess also applies): both of those are UI-side layers that can only narrow access
-- further than role_permissions, never grant back what role_permissions denies, so skipping
-- them here cannot let through anyone role_permissions itself withholds. A hospital that
-- withholds approve_refund ONLY via entitlement or a per-user override (not via the role
-- config in Settings → Roles) is not yet covered server-side — that is a known, smaller
-- residual gap versus the main Settings → Roles mechanism this closes.
--
-- The frontend still performs the bill-balance update, advance-ledger entry, and journal
-- posting as separate steps after this RPC succeeds — those are downstream bookkeeping
-- consequences, not the authorization boundary itself.

CREATE OR REPLACE FUNCTION public.approve_or_reject_refund_payable(
  p_refund_id uuid,
  p_action text,
  p_rejection_reason text DEFAULT NULL
)
RETURNS public.refund_payables
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id       uuid;
  v_caller_role     text;
  v_caller_hospital uuid;
  v_action_perms    jsonb;
  v_refund          public.refund_payables;
BEGIN
  IF p_action NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'Invalid action: %', p_action;
  END IF;

  SELECT id, role, hospital_id INTO v_caller_id, v_caller_role, v_caller_hospital
  FROM public.users WHERE auth_user_id = auth.uid();

  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT * INTO v_refund FROM public.refund_payables WHERE id = p_refund_id;
  IF v_refund IS NULL OR v_refund.hospital_id IS DISTINCT FROM v_caller_hospital THEN
    RAISE EXCEPTION 'Not found';
  END IF;

  IF v_refund.status IS DISTINCT FROM 'pending_approval' THEN
    RAISE EXCEPTION 'This refund is no longer pending approval';
  END IF;

  -- super_admin / hospital_admin mirror BYPASS_ROLES in tabPermissions.ts.
  IF v_caller_role NOT IN ('super_admin', 'hospital_admin') THEN
    SELECT permissions -> 'billing' -> 'actions' INTO v_action_perms
    FROM public.role_permissions
    WHERE hospital_id = v_caller_hospital AND role_name = v_caller_role;

    -- Default-allow, matching hasActionAccess: withheld only when explicitly false.
    IF v_action_perms IS NOT NULL
       AND v_action_perms ? 'approve_refund'
       AND (v_action_perms ->> 'approve_refund') = 'false' THEN
      RAISE EXCEPTION 'Forbidden: your role is not authorized to approve or reject refunds';
    END IF;
  END IF;

  IF p_action = 'approve' THEN
    UPDATE public.refund_payables
    SET status = 'processed', approved_by = v_caller_id, processed_at = now()
    WHERE id = p_refund_id
    RETURNING * INTO v_refund;
  ELSE
    UPDATE public.refund_payables
    SET status = 'rejected', approved_by = v_caller_id, processed_at = now(),
        rejection_reason = COALESCE(NULLIF(p_rejection_reason, ''), 'Rejected by approver')
    WHERE id = p_refund_id
    RETURNING * INTO v_refund;
  END IF;

  RETURN v_refund;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_or_reject_refund_payable(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_or_reject_refund_payable(uuid, text, text) TO authenticated;
