-- ABDM Security Hardening
-- Adds: abdm_audit_log (append-only), abdm_rate_limits, abdm_client_secret_hint,
--       set_hospital_abdm_secret / rotate_abdm_credentials / abdm_rate_limit_increment RPCs.

-- ─── abdm_audit_log ──────────────────────────────────────────────────────────
-- Append-only audit trail for all significant ABDM operations.
-- RLS: hospital admins can read; NO update/delete allowed for any role.
CREATE TABLE IF NOT EXISTS public.abdm_audit_log (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  action       TEXT        NOT NULL,
  patient_id   UUID        REFERENCES public.patients(id) ON DELETE SET NULL,
  abha_address TEXT,
  performed_by UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  hospital_id  UUID        NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  ip_hash      TEXT,
  metadata     JSONB,
  timestamp    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.abdm_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_log_select_admin"  ON public.abdm_audit_log;

-- Only hospital_admin / super_admin can read their own hospital's audit rows.
-- Intentionally no INSERT/UPDATE/DELETE policy — only service-role (edge functions) may write.
CREATE POLICY "audit_log_select_admin" ON public.abdm_audit_log
  FOR SELECT TO authenticated
  USING (
    hospital_id = public.get_user_hospital_id()
    AND (
      SELECT role FROM public.users
      WHERE auth_user_id = auth.uid()
      LIMIT 1
    ) IN ('super_admin', 'hospital_admin')
  );

-- ─── abdm_rate_limits ────────────────────────────────────────────────────────
-- Tumbling-window counters for ABDM operation rate limiting.
-- Keyed as "<operation>:<identifier>:<window-epoch>".
-- Written exclusively by the abdm_rate_limit_increment() function below.
CREATE TABLE IF NOT EXISTS public.abdm_rate_limits (
  key          TEXT        PRIMARY KEY,
  count        INTEGER     NOT NULL DEFAULT 1,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.abdm_rate_limits ENABLE ROW LEVEL SECURITY;
-- No authenticated-user policies — service role only (edge functions).

-- ─── hospital_abdm_config: credential hint column ────────────────────────────
-- Stores only the last-4-char hint of abdm_client_secret for safe UI display.
-- The full secret stays in abdm_client_secret but is never returned by SELECT *.
ALTER TABLE public.hospital_abdm_config
  ADD COLUMN IF NOT EXISTS abdm_client_secret_hint TEXT;

-- ─── set_hospital_abdm_secret() ──────────────────────────────────────────────
-- SECURITY DEFINER RPC: lets the authenticated user save a credential secret
-- without the full value ever being readable back by the frontend.
-- Validates hospital ownership before writing.
CREATE OR REPLACE FUNCTION public.set_hospital_abdm_secret(
  p_hospital_id UUID,
  p_key         TEXT,
  p_value       TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Caller must belong to this hospital
  IF p_hospital_id IS DISTINCT FROM public.get_user_hospital_id() THEN
    RAISE EXCEPTION 'Forbidden: hospital_id mismatch';
  END IF;

  IF p_key = 'abdm_client_secret' THEN
    UPDATE public.hospital_abdm_config
    SET
      abdm_client_secret      = p_value,
      abdm_client_secret_hint = CASE
        WHEN char_length(p_value) >= 4 THEN '••••' || right(p_value, 4)
        ELSE '••••'
      END,
      updated_at = now()
    WHERE hospital_id = p_hospital_id;

  ELSIF p_key = 'abdm_client_id' THEN
    UPDATE public.hospital_abdm_config
    SET abdm_client_id = p_value, updated_at = now()
    WHERE hospital_id = p_hospital_id;

  ELSE
    RAISE EXCEPTION 'Unknown secret key: %', p_key;
  END IF;
END;
$$;

-- ─── rotate_abdm_credentials() ───────────────────────────────────────────────
-- Clears the cached token so the next ABDM call forces a fresh authentication.
CREATE OR REPLACE FUNCTION public.rotate_abdm_credentials(
  p_hospital_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_hospital_id IS DISTINCT FROM public.get_user_hospital_id() THEN
    RAISE EXCEPTION 'Forbidden: hospital_id mismatch';
  END IF;

  UPDATE public.hospital_abdm_config
  SET
    abdm_access_token     = NULL,
    abdm_token_expires_at = NULL,
    updated_at            = now()
  WHERE hospital_id = p_hospital_id;
END;
$$;

-- ─── abdm_rate_limit_increment() ─────────────────────────────────────────────
-- Atomically upsert + increment a rate-limit counter, returning the new count.
-- Called from edge functions (service role) to enforce per-operation limits.
CREATE OR REPLACE FUNCTION public.abdm_rate_limit_increment(
  p_key          TEXT,
  p_window_start TIMESTAMPTZ
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  INSERT INTO public.abdm_rate_limits (key, count, window_start)
  VALUES (p_key, 1, p_window_start)
  ON CONFLICT (key) DO UPDATE
    SET count = abdm_rate_limits.count + 1
  RETURNING count INTO v_count;
  RETURN v_count;
END;
$$;

-- Stale rate-limit rows are cheap to purge; a daily job or next request cleans them.
-- Rows older than 2 hours are automatically irrelevant.
