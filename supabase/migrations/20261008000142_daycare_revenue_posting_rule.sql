-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: daycare_revenue_posting_rule
-- Purpose  : Post day care revenue to "Procedure Revenue" instead of misclassifying it as
--            "OPD Consultation Revenue".
--
--            auto_post_bill_journal() looks up a rule for 'bill_finalized_' || bill_type and
--            falls back to 'bill_finalized_generic' when none exists. Rules exist for opd,
--            ipd, ot, lab, radiology and pharmacy — but NOT for daycare, so every day care
--            bill fell through to the generic rule and credited 4001 OPD Consultation
--            Revenue. A ₹47,000 cataract or a ₹4,500 endoscopy is not an OPD consultation:
--            day care revenue was silently unsegmentable and the OPD line overstated.
--
--            Observed live: JE-2026-0039 (a daycare bill) credited 4001.
--
-- Mapping  : Dr 1010 Accounts Receivable - Patients / Cr 4008 Procedure Revenue.
--            4008 already exists in the seeded chart of accounts and is the natural home for
--            a day care procedure — it is neither an OPD consultation (4001) nor an IPD
--            room/nursing charge (4002). Day care that runs through the OT module continues
--            to post via 'bill_finalized_ot' → 4003, which is also correct.
--
-- Idempotent: inserts only where no active daycare rule already exists.
-- Additive  : creates no account and rewrites no historical entry. Bills already posted keep
--             their original entry; correct them with a reversal if desired.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.auto_posting_rules
  (hospital_id, rule_name, trigger_event, debit_account_id, credit_account_id,
   description_template, is_active)
SELECT
  h.id,
  'Day Care bill finalised → Procedure Revenue',
  'bill_finalized_daycare',
  ar.id,
  rev.id,
  'Auto: Day care bill {bill_number}',
  true
FROM public.hospitals h
JOIN public.chart_of_accounts ar
  ON ar.hospital_id = h.id AND ar.code = '1010'
JOIN public.chart_of_accounts rev
  ON rev.hospital_id = h.id AND rev.code = '4008'
WHERE NOT EXISTS (
  SELECT 1 FROM public.auto_posting_rules apr
  WHERE apr.hospital_id   = h.id
    AND apr.trigger_event = 'bill_finalized_daycare'
    AND apr.is_active     = true
);
