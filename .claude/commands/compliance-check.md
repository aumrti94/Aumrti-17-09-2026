---
description: Verify a feature meets Indian healthcare compliance requirements (DPDP, NABH, GST, NDPS, multi-tenancy, audit trail, locale)
---

Verify that $ARGUMENTS meets Indian healthcare compliance requirements.

**Load the `clinical-compliance` and `multi-tenant-data-access` skills first** — they carry the
verified signatures and rules this check is auditing against. Checking against a remembered API is
how a wrong assertion gets recorded as a PASS.

Report **PASS / FAIL / NEEDS ATTENTION** for each:

1. **DPDP Act 2023** — consent captured, stored in `patient_consents`, separate from marketing
   consent, and withdrawable?
2. **NABH** — clinical evidence logged via `logNABHEvidence()` from `@/lib/nabh-evidence`, with a
   `ComplianceStatus` as the 4th argument (not an entity id)?
3. **Drug safety** — `checkDrugSafety()` called and gated on `result.hasIssues`? A gate on
   `hasContraindication` is a FAIL: that field does not exist, so the check never fires.
4. **GST / money** — amounts via `formatCurrency()`, never raw numbers?
5. **NDPS** — pharmacy features: Schedule H enforcement, register entry, high-alert double-check?
6. **Multi-tenancy** — every query filters `hospital_id`; every insert stamps it; service-role
   queries in Edge Functions filter it explicitly?
7. **Silent failures** — `error` destructured and handled on every Supabase call? Any `.single()`?
8. **PHI** — nothing patient-identifying in logs, Edge Function `console.log`, error messages, or
   NABH evidence text?
9. **Audit trail** — PHI tables carry an audit trigger; the action reaches `audit_log`?
10. **Indian locale** — `DD/MM/YYYY` via `formatDateIST`, ₹ with `en-IN` grouping, Indian English
    spelling (Anaesthesia, Gynaecology, finalised)?

Run the gates as evidence rather than reading alone:
`npm run lint && npm run check:rls-coverage && npm run check:user-fk && npm run check:db-contract`

If any check fails, name the specific file and line and what is missing — don't just report the
verdict. If a check does not apply to this feature, say N/A and why, rather than passing it.
