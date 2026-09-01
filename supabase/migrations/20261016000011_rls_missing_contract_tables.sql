-- Phase 1.3 (cont.) — RLS for the new tables, plus the hospital_encounter_usage view.
--
-- Policies follow the canonical form from 19_CANONICAL_DATABASE_ARCHITECTURE.md Rule 3:
-- one policy per (table, command-set, role), predicate wrapped in (SELECT ...) so the planner
-- hoists it to an InitPlan instead of re-evaluating per row.

BEGIN;

ALTER TABLE public.sepsis_alerts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.allergy_records     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_endpoints   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_packs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_anomalies ENABLE ROW LEVEL SECURITY;

CREATE POLICY sepsis_alerts_tenant ON public.sepsis_alerts
  AS PERMISSIVE FOR ALL TO authenticated
  USING      (hospital_id = (SELECT public.get_user_hospital_id()) OR (SELECT public.is_aumrti_admin()))
  WITH CHECK (hospital_id = (SELECT public.get_user_hospital_id()));

CREATE POLICY allergy_records_tenant ON public.allergy_records
  AS PERMISSIVE FOR ALL TO authenticated
  USING      (hospital_id = (SELECT public.get_user_hospital_id()) OR (SELECT public.is_aumrti_admin()))
  WITH CHECK (hospital_id = (SELECT public.get_user_hospital_id()));

-- webhook secrets are hospital-scoped credentials: no cross-tenant admin read.
CREATE POLICY webhook_endpoints_tenant ON public.webhook_endpoints
  AS PERMISSIVE FOR ALL TO authenticated
  USING      (hospital_id = (SELECT public.get_user_hospital_id()))
  WITH CHECK (hospital_id = (SELECT public.get_user_hospital_id()));

CREATE POLICY financial_anomalies_tenant ON public.financial_anomalies
  AS PERMISSIVE FOR ALL TO authenticated
  USING      (hospital_id = (SELECT public.get_user_hospital_id()) OR (SELECT public.is_aumrti_admin()))
  WITH CHECK (hospital_id = (SELECT public.get_user_hospital_id()));

-- credit_packs is a global catalogue (layer 15): readable by every authenticated user,
-- writable only by platform staff. This is the same shape as subscription_plans/addon_skus,
-- and is correct-by-design rather than a cross-tenant leak.
CREATE POLICY credit_packs_read ON public.credit_packs
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

CREATE POLICY credit_packs_admin_write ON public.credit_packs
  AS PERMISSIVE FOR ALL TO authenticated
  USING      ((SELECT public.is_aumrti_admin()))
  WITH CHECK ((SELECT public.is_aumrti_admin()));

REVOKE ALL ON public.sepsis_alerts, public.allergy_records, public.webhook_endpoints,
              public.credit_packs, public.financial_anomalies FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.sepsis_alerts, public.allergy_records, public.webhook_endpoints,
     public.credit_packs, public.financial_anomalies
  TO authenticated;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 6. hospital_encounter_usage
--    (src/pages/settings/SettingsPlanPage.tsx, src/pages/platform/AIPerformancePage.tsx)
--
-- Both call sites are READ-ONLY, and one aggregates across hospitals, so this is a view.
--
-- HONEST LIMITATION, stated rather than papered over: this database has no encounter-metering
-- model. There is no credits table, subscription_plans carries no encounter/document allowances
-- (only ai_included_budget_inr), and a catalogue-wide search for %encounter_credit%,
-- %document_credit%, %voice_encounter% and %ocr_document% columns returns nothing.
--
-- So the view returns REAL values for what is genuinely derivable and NULL for what is not,
-- rather than inventing an allowance model:
--   voice_encounters / ocr_documents  -> counted from ai_usage_logs by feature_key
--   hospital_name / plan_slug         -> joined from hospitals / hospital_subscriptions
--   *_included, *_credits, inr_per_*  -> NULL until a metering model exists
--
-- The consuming pages render 0/blank for the NULL columns instead of erroring on a missing
-- relation, which is the improvement. Wiring real allowances is a product decision.
--
-- security_invoker = true is mandatory (canonical Rule 3.6): without it the view would run as
-- postgres and bypass RLS on hospitals/ai_usage_logs — the exact defect fixed in migration
-- 20261016000002. With it, a hospital user sees only their own row and a platform admin sees
-- all, because the underlying tables' policies already say so.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.hospital_encounter_usage
WITH (security_invoker = true) AS
SELECT
  h.id                                   AS hospital_id,
  h.name                                 AS hospital_name,
  sp.slug                                AS plan_slug,
  COALESCE(u.voice_encounters, 0)::int   AS voice_encounters,
  COALESCE(u.ocr_documents,   0)::int    AS ocr_documents,
  NULL::int     AS voice_encounters_included,
  NULL::int     AS ocr_documents_included,
  NULL::int     AS encounter_credits,
  NULL::int     AS document_credits,
  NULL::numeric AS inr_per_encounter,
  NULL::numeric AS inr_per_document
FROM public.hospitals h
LEFT JOIN public.hospital_subscriptions hs ON hs.hospital_id = h.id
LEFT JOIN public.subscription_plans     sp ON sp.id = hs.plan_id
LEFT JOIN (
  SELECT hospital_id,
         count(*) FILTER (WHERE feature_key = 'voice_scribe')  AS voice_encounters,
         count(*) FILTER (WHERE feature_key = 'document_ocr')  AS ocr_documents
  FROM public.ai_usage_logs
  GROUP BY hospital_id
) u ON u.hospital_id = h.id;

REVOKE ALL   ON public.hospital_encounter_usage FROM anon;
GRANT SELECT ON public.hospital_encounter_usage TO authenticated;

COMMENT ON VIEW public.hospital_encounter_usage IS
  'Per-hospital AI encounter/document usage. voice_encounters and ocr_documents are derived from '
  'ai_usage_logs by feature_key. The *_included / *_credits / inr_per_* columns are NULL because '
  'no encounter-metering or credit model exists in this schema yet — they are present so the '
  'consuming pages resolve, not because the values are known.';
