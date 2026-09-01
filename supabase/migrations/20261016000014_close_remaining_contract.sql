-- Phase 1.2 (cont.) — close the remaining application↔database contract violations.
--
-- Two tables and four functions the application calls but which have never existed.
-- Shapes taken from the call sites, as before.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- prescription_history   (src/components/opd/ConsultationWorkspace.tsx)
--
-- A genuine versioning table, not a naming variant of `prescriptions`: the call site counts
-- existing versions for a prescription, then inserts the pre-edit row as a JSON snapshot. The
-- write is wrapped in try/catch and logged as "non-blocking", so the failure never surfaced —
-- amendments to a signed prescription simply left no audit trail, which matters clinically.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.prescription_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  prescription_id uuid NOT NULL REFERENCES public.prescriptions(id) ON DELETE CASCADE,
  version_number  integer NOT NULL CHECK (version_number > 0),
  snapshot        jsonb NOT NULL,
  changed_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  changed_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prescription_history_version_uq UNIQUE (prescription_id, version_number)
);

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- hospital_credit_grants   (backs the grant_credits RPC below)
--
-- HospitalDetailPage's own comment states the intent: "Every grant writes a ledger row with a
-- reason, so a credit balance can always be explained rather than just asserted." The ledger was
-- never built, so the RPC did not exist and the mutation threw on every use.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hospital_credit_grants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('encounter','document')),
  qty         integer NOT NULL,
  reason      text,
  source      text NOT NULL DEFAULT 'admin_grant',
  granted_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.prescription_history    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hospital_credit_grants  ENABLE ROW LEVEL SECURITY;

CREATE POLICY prescription_history_tenant ON public.prescription_history
  AS PERMISSIVE FOR ALL TO authenticated
  USING      (hospital_id = (SELECT public.get_user_hospital_id()) OR (SELECT public.is_aumrti_admin()))
  WITH CHECK (hospital_id = (SELECT public.get_user_hospital_id()));

-- Hospitals may READ their own credit history; only platform staff may grant.
CREATE POLICY hospital_credit_grants_read ON public.hospital_credit_grants
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (hospital_id = (SELECT public.get_user_hospital_id()) OR (SELECT public.is_aumrti_admin()));

CREATE POLICY hospital_credit_grants_admin_write ON public.hospital_credit_grants
  AS PERMISSIVE FOR ALL TO authenticated
  USING      ((SELECT public.is_aumrti_admin()))
  WITH CHECK ((SELECT public.is_aumrti_admin()));

REVOKE ALL ON public.prescription_history, public.hospital_credit_grants FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.prescription_history, public.hospital_credit_grants TO authenticated;

COMMIT;

CREATE INDEX IF NOT EXISTS idx_prescription_history_hospital_id     ON public.prescription_history (hospital_id);
CREATE INDEX IF NOT EXISTS idx_prescription_history_prescription_id ON public.prescription_history (prescription_id);
CREATE INDEX IF NOT EXISTS idx_prescription_history_changed_by      ON public.prescription_history (changed_by);
CREATE INDEX IF NOT EXISTS idx_hospital_credit_grants_hospital_id   ON public.hospital_credit_grants (hospital_id);
CREATE INDEX IF NOT EXISTS idx_hospital_credit_grants_granted_by    ON public.hospital_credit_grants (granted_by);

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- Missing RPCs
-- ═════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

-- grant_credits — platform-staff only. HospitalDetailPage throws on error, so this must succeed
-- for admins and must refuse everyone else rather than silently no-op.
CREATE OR REPLACE FUNCTION public.grant_credits(
  p_hospital_id uuid, p_kind text, p_qty integer, p_reason text, p_source text DEFAULT 'admin_grant')
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  IF NOT public.is_aumrti_admin() THEN
    RAISE EXCEPTION 'only platform administrators may grant credits' USING ERRCODE='insufficient_privilege';
  END IF;
  IF p_kind NOT IN ('encounter','document') THEN
    RAISE EXCEPTION 'invalid credit kind: %', p_kind USING ERRCODE='check_violation';
  END IF;
  INSERT INTO public.hospital_credit_grants (hospital_id, kind, qty, reason, source, granted_by)
  VALUES (p_hospital_id, p_kind, p_qty, p_reason, COALESCE(p_source,'admin_grant'),
          (SELECT id FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

-- increment_discount_used_count — called by the Razorpay webhook after a successful subscription.
-- The webhook already has a manual read-modify-write fallback; this replaces it with an atomic
-- increment so concurrent redemptions cannot lose a count.
CREATE OR REPLACE FUNCTION public.increment_discount_used_count(p_code text)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_new integer;
BEGIN
  UPDATE public.discount_codes
     SET used_count = COALESCE(used_count, 0) + 1
   WHERE code = p_code
  RETURNING used_count INTO v_new;
  RETURN v_new;   -- NULL when the code does not exist; caller treats that as non-fatal
END;
$function$;

-- increment_query_count — TPAQueryManager, after a query response is submitted.
-- insurance_claims.query_count already exists; only the atomic incrementer was missing.
CREATE OR REPLACE FUNCTION public.increment_query_count(claim_id_in uuid)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_new integer;
BEGIN
  UPDATE public.insurance_claims
     SET query_count = COALESCE(query_count, 0) + 1
   WHERE id = claim_id_in
     AND (hospital_id = public.get_user_hospital_id() OR public.is_aumrti_admin())
  RETURNING query_count INTO v_new;
  RETURN v_new;
END;
$function$;

-- enum_values_app_role — e2e helper (P1D.staff-logins) that compares the live app_role enum
-- against the fixture list, so drift in either is caught. The spec already tolerates absence;
-- providing it makes the assertion real rather than skipped.
CREATE OR REPLACE FUNCTION public.enum_values_app_role()
 RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder)
  FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
  WHERE t.typname = 'app_role';
$function$;

REVOKE ALL ON FUNCTION public.grant_credits(uuid,text,integer,text,text)   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.increment_discount_used_count(text)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.increment_query_count(uuid)                  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.enum_values_app_role()                       FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_credits(uuid,text,integer,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_discount_used_count(text)        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.increment_query_count(uuid)                TO authenticated;
GRANT EXECUTE ON FUNCTION public.enum_values_app_role()                     TO authenticated, service_role;

-- Now that a credit ledger exists, surface the balance in the usage view instead of NULL.
-- The *_included and inr_per_* columns stay NULL: plan allowances and per-unit pricing still
-- have no source in this schema (subscription_plans carries only ai_included_budget_inr).
CREATE OR REPLACE VIEW public.hospital_encounter_usage
WITH (security_invoker = true) AS
SELECT
  h.id                                   AS hospital_id,
  h.name                                 AS hospital_name,
  sp.slug                                AS plan_slug,
  COALESCE(u.voice_encounters, 0)::int   AS voice_encounters,
  COALESCE(u.ocr_documents,   0)::int    AS ocr_documents,
  NULL::int                              AS voice_encounters_included,
  NULL::int                              AS ocr_documents_included,
  COALESCE(g.encounter_credits, 0)::int  AS encounter_credits,
  COALESCE(g.document_credits,  0)::int  AS document_credits,
  NULL::numeric                          AS inr_per_encounter,
  NULL::numeric                          AS inr_per_document
FROM public.hospitals h
LEFT JOIN public.hospital_subscriptions hs ON hs.hospital_id = h.id
LEFT JOIN public.subscription_plans     sp ON sp.id = hs.plan_id
LEFT JOIN (
  SELECT hospital_id,
         count(*) FILTER (WHERE feature_key = 'voice_scribe') AS voice_encounters,
         count(*) FILTER (WHERE feature_key = 'document_ocr') AS ocr_documents
  FROM public.ai_usage_logs GROUP BY hospital_id
) u ON u.hospital_id = h.id
LEFT JOIN (
  SELECT hospital_id,
         SUM(qty) FILTER (WHERE kind = 'encounter') AS encounter_credits,
         SUM(qty) FILTER (WHERE kind = 'document')  AS document_credits
  FROM public.hospital_credit_grants GROUP BY hospital_id
) g ON g.hospital_id = h.id;

REVOKE ALL   ON public.hospital_encounter_usage FROM anon;
GRANT SELECT ON public.hospital_encounter_usage TO authenticated;

COMMIT;
