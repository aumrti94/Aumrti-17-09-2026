---
description: Verify a feature meets Indian healthcare compliance requirements (DPDP, NABH, GST, NDPS, multi-tenancy, audit trail, locale)
---

Verify that $ARGUMENTS meets Indian healthcare compliance requirements. Check each of the
following and report **PASS / FAIL / NEEDS ATTENTION** for each:

1. **DPDP Act 2023** — is patient consent captured and logged?
2. **NABH** — is clinical evidence logged via `logNABHEvidence()`?
3. **GST** — are monetary values correctly formatted?
4. **NDPS** — if this is a pharmacy feature, is Schedule H enforcement present?
5. **Multi-tenancy** — does every query filter on `hospital_id`?
6. **Audit trail** — is the action logged in `audit_log`?
7. **Indian locale** — dates as `DD/MM/YYYY`? Currency as ₹ with `en-IN` grouping?

If any check fails, name the specific file/line and what's missing — don't just report the
verdict.
