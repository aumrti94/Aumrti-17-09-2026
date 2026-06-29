# Workflow: Compliance Verification

Goal: Verify a feature meets Indian healthcare compliance requirements.

Steps:
1. Check DPDP Act 2023: Is patient consent captured and logged?
2. Check NABH: Is clinical evidence logged via logNABHEvidence()?
3. Check GST: Are monetary values correctly formatted?
4. Check NDPS: If pharmacy feature, is Schedule H enforcement present?
5. Check Multi-tenancy: Does every query use hospital_id filter?
6. Check Audit Trail: Is the action logged in audit_log?
7. Check Indian Locale: Dates DD/MM/YYYY? Currency ₹ with en-IN grouping?
8. Report: PASS / FAIL / NEEDS ATTENTION for each check.
