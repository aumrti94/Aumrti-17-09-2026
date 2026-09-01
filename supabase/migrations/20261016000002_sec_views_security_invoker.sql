-- Phase 0.2 — views: stop bypassing RLS.
--
-- ROOT CAUSE (RC-3): a PostgreSQL view executes with the privileges of its OWNER unless created
-- with security_invoker = true. All 8 views in `public` are owned by `postgres`. Six omit the
-- option, so they read their base tables with RLS switched off. Four of those six also apply no
-- tenant predicate of their own AND carry SELECT grants to `anon`:
--
--   ipd_advance_balances      patient_id, admission_id, hospital_id, advance balances — ALL hospitals
--   unbilled_service_summary  unbilled revenue by hospital
--   bed_reprice_previews      hospital names + current/proposed pricing
--   addon_entitlement_drift   platform plan/add-on commercial data
--
-- ipd_advance_balances is the material one: its body is a bare aggregate over ipd_advances
-- GROUP BY admission_id, hospital_id, patient_id with NO WHERE clause. ipd_advances itself has
-- correct tenant RLS; the view walks straight past it. It is referenced in 11 places, so it is
-- live code. This single object defeated the isolation that 494 hospital_id policies establish.
--
-- That inventory_value_by_hospital and quality_indicators_current DO set security_invoker shows
-- the mechanism was understood — it was applied inconsistently.
--
-- FUNCTIONALITY PRESERVED — all 11 ipd_advance_balances call sites are tenant-scoped UI:
--   AdvanceApplicationTab, LineItemsTab, RefundApprovalsInbox, DayCareCancelModal,
--   DayCareFinancialPanel, DayCareRescheduleModal, IPDFinancialTab, advanceLedger.ts,
--   ancillaryCharges.ts, chargePosting.ts, dayCareGate.ts, dayCareCancel.ts
-- None reads across tenants; each already filters by an admission in the caller's own hospital.
-- After this change they see exactly the same rows, now enforced by the database.
--
-- platform_payment_config_status and hospital_ai_budget_status already self-filter, but are
-- switched to invoker rights anyway so the whole surface follows one rule.

BEGIN;

ALTER VIEW public.ipd_advance_balances           SET (security_invoker = true);
ALTER VIEW public.unbilled_service_summary       SET (security_invoker = true);
ALTER VIEW public.bed_reprice_previews           SET (security_invoker = true);
ALTER VIEW public.addon_entitlement_drift        SET (security_invoker = true);
ALTER VIEW public.platform_payment_config_status SET (security_invoker = true);
ALTER VIEW public.hospital_ai_budget_status      SET (security_invoker = true);

-- Defence in depth: none of these is read by an anon-reachable page.
REVOKE SELECT ON public.ipd_advance_balances     FROM anon;
REVOKE SELECT ON public.unbilled_service_summary FROM anon;
REVOKE SELECT ON public.bed_reprice_previews     FROM anon;
REVOKE SELECT ON public.addon_entitlement_drift  FROM anon;

COMMIT;
