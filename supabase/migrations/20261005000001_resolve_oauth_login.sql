-- resolve_oauth_login(): called by the /auth/callback page after a social (OAuth) sign-in
-- to decide where the freshly-authenticated user should land — and to reject anyone who is
-- not a known Aumrti user. Runs SECURITY DEFINER so it can read auth.users + link the staff
-- row, but it only ever acts on the CURRENT caller (auth.uid()).
--
-- Returns jsonb:
--   { "target": "platform" }                       -- active Aumrti super-admin
--   { "target": "app", "role": "<app_role>" }       -- active hospital staff member
--   { "target": "rejected", "reason": "..." }        -- no account / inactive / no session
--
-- Linking: a social provider verifies the email, so on first social sign-in we link the
-- existing staff row (matched by verified email) to this auth user. To avoid landing a
-- multi-hospital email in the wrong tenant, we link ONLY when exactly one users row matches.

CREATE OR REPLACE FUNCTION public.resolve_oauth_login()
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_uid             uuid := auth.uid();
  v_email           text;
  v_email_confirmed timestamptz;
  v_user            record;
  v_match_count     int;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('target', 'rejected', 'reason', 'no_session');
  END IF;

  -- 1. Platform super-admin takes precedence.
  IF EXISTS (
    SELECT 1 FROM public.aumrti_admins
    WHERE auth_user_id = v_uid AND is_active = true
  ) THEN
    RETURN jsonb_build_object('target', 'platform');
  END IF;

  -- Caller's email + verification status (provider-verified for social sign-ins).
  SELECT email, email_confirmed_at
    INTO v_email, v_email_confirmed
  FROM auth.users
  WHERE id = v_uid;

  -- 2. Existing staff row already linked to this auth user.
  SELECT id, role, is_active, can_login
    INTO v_user
  FROM public.users
  WHERE auth_user_id = v_uid
  LIMIT 1;

  -- 2b. First social sign-in: link the staff row by verified email, but only when exactly
  --     one users row matches (avoid linking the wrong tenant for shared emails).
  IF v_user.id IS NULL AND v_email IS NOT NULL AND v_email_confirmed IS NOT NULL THEN
    SELECT count(*) INTO v_match_count
    FROM public.users
    WHERE lower(email) = lower(v_email);

    IF v_match_count = 1 THEN
      UPDATE public.users
        SET auth_user_id = v_uid
      WHERE lower(email) = lower(v_email)
      RETURNING id, role, is_active, can_login INTO v_user;
    END IF;
  END IF;

  IF v_user.id IS NULL THEN
    RETURN jsonb_build_object('target', 'rejected', 'reason', 'no_account');
  END IF;

  IF v_user.is_active IS NOT TRUE OR v_user.can_login IS NOT TRUE THEN
    RETURN jsonb_build_object('target', 'rejected', 'reason', 'inactive');
  END IF;

  RETURN jsonb_build_object('target', 'app', 'role', v_user.role);
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_oauth_login() TO authenticated;
