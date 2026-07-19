-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: restrict_day_closure_by_role
-- Purpose  : Enforce, at the database layer, the same per-role "Day Closure"
--            action toggle that the app configures under
--            Settings → Roles → Billing → Action Controls.
--            The UI hides the Day Closure button/page for roles without the
--            `billing.day_closure` action; this trigger closes the hole so a
--            crafted API call cannot write a cash closure either.
--
-- Mirrors src/lib/tabPermissions.ts → hasActionAccess("billing","day_closure"):
--   • no role                         → deny
--   • super_admin / hospital_admin    → allow  (BYPASS_ROLES)
--   • no role_permissions row         → allow  (default-allow, back-compat)
--   • permissions.all === true        → allow
--   • billing missing / string ("rw") → allow
--   • billing.actions missing         → allow
--   • billing.actions.day_closure     → its boolean value (undefined ⇒ allow)
--
-- NOTE: the app's entitlement floor (plan/hospital subscription) is an
--       app-level concern and is intentionally NOT re-checked here — this
--       migration enforces ROLE authorisation only, which is what the
--       configurable setting controls.
-- Idempotent: CREATE OR REPLACE, DROP TRIGGER IF EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Helper: does the current user's role allow performing day closure? ─────

CREATE OR REPLACE FUNCTION public.current_user_can_close_day()
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role     text;
  v_hosp_id  uuid;
  v_perms    jsonb;
  v_billing  jsonb;
  v_actions  jsonb;
BEGIN
  SELECT role, hospital_id INTO v_role, v_hosp_id
  FROM public.users
  WHERE auth_user_id = auth.uid()
  LIMIT 1;

  -- No resolvable role → deny (matches `if (!role) return false`).
  IF v_role IS NULL THEN
    RETURN false;
  END IF;

  -- BYPASS_ROLES = ["super_admin", "hospital_admin"].
  IF v_role IN ('super_admin', 'hospital_admin') THEN
    RETURN true;
  END IF;

  SELECT permissions INTO v_perms
  FROM public.role_permissions
  WHERE hospital_id = v_hosp_id
    AND role_name   = v_role
  LIMIT 1;

  -- No permissions blob → default allow (back-compat).
  IF v_perms IS NULL THEN
    RETURN true;
  END IF;

  IF (v_perms->>'all') = 'true' THEN
    RETURN true;
  END IF;

  v_billing := v_perms->'billing';
  -- billing absent, or a coarse string grant like "rw"/"r" → allow.
  IF v_billing IS NULL OR jsonb_typeof(v_billing) <> 'object' THEN
    RETURN true;
  END IF;

  v_actions := v_billing->'actions';
  IF v_actions IS NULL OR jsonb_typeof(v_actions) <> 'object' THEN
    RETURN true;
  END IF;

  -- Action not explicitly configured → allow (default-allow, like the app).
  IF v_actions->'day_closure' IS NULL THEN
    RETURN true;
  END IF;

  -- Explicit boolean toggle.
  RETURN (v_actions->>'day_closure') = 'true';
END;$$;

-- ── 2. Trigger: block cash-closure writes by unauthorised roles ───────────────

CREATE OR REPLACE FUNCTION public.prevent_unauthorized_day_closure()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.current_user_can_close_day() THEN
    RAISE EXCEPTION
      'Cash Closure is restricted for your role. Ask an administrator to enable '
      'the "Day Closure" action for your role under Settings → Roles → Billing.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;$$;

DROP TRIGGER IF EXISTS trg_prevent_unauthorized_day_closure ON public.daily_cash_closure;
CREATE TRIGGER trg_prevent_unauthorized_day_closure
  BEFORE INSERT OR UPDATE ON public.daily_cash_closure
  FOR EACH ROW EXECUTE FUNCTION public.prevent_unauthorized_day_closure();
