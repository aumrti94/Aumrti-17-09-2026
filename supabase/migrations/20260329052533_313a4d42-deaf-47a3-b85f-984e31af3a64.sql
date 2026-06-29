CREATE OR REPLACE FUNCTION public.increment_icd_use_count(p_code text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE icd10_codes SET use_count = use_count + 1 WHERE code = p_code;
$$;