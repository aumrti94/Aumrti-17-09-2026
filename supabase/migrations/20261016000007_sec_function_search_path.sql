-- Phase 0.7 — pin search_path on the four unpinned SECURITY DEFINER functions.
--
-- ROOT CAUSE: 137 of 141 SECURITY DEFINER functions already SET search_path; these four were
-- missed. Without it, a caller able to create objects earlier on the resolution path can shadow
-- a referenced table and have it execute with the definer's elevated privileges.
--
-- Exploitability is low in Supabase (authenticated cannot create schemas by default), hence
-- MEDIUM not HIGH — but two of the four touch PHI key material and PHI audit retention, so they
-- are worth closing regardless. Bodies are reproduced verbatim from pg_get_functiondef; the only
-- change is the added SET search_path clause.

BEGIN;

CREATE OR REPLACE FUNCTION public.cleanup_expired_trusted_devices()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.user_trusted_devices WHERE expires_at < now();
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_active_phi_key_version(p_hospital_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT key_version
  FROM phi_encryption_keys
  WHERE hospital_id = p_hospital_id
    AND is_active = TRUE
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.next_seq(p_hospital_id uuid, p_type text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v bigint;
BEGIN
  INSERT INTO public.hospital_sequences (hospital_id, seq_type, last_val)
    VALUES (p_hospital_id, p_type, 1)
    ON CONFLICT (hospital_id, seq_type)
    DO UPDATE SET last_val = hospital_sequences.last_val + 1
    RETURNING last_val INTO v;
  RETURN v;
END;
$function$;

CREATE OR REPLACE FUNCTION public.purge_old_phi_audit()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM phi_access_audit
  WHERE accessed_at < now() - INTERVAL '3 years';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$function$;

COMMIT;
