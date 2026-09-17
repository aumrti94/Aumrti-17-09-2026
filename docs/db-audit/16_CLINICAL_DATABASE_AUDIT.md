# 16 — CLINICAL DATABASE AUDIT

Where each safety rule is actually enforced: **DATABASE** (constraint/trigger/policy),
**BACKEND** (edge function), **FRONTEND** (browser TypeScript), **DOCUMENTED ONLY**, or **MISSING**.

Row counts are live as of 2026-08-18 and matter here: a safety table with zero rows is a safety
control that has never run.

## Enforcement scorecard

| Safety area | Table | Rows | Enforced at | Verdict |
|---|---|---|---|---|
| PHI change audit | `log_phi_change` trigger on `patients`, `prescriptions`, `ndps_register`, `bills` | — | **DATABASE** | Strong |
| Narcotics register immutability | `ndps_register` | 0 | **DATABASE** | Strong |
| Narcotics dual-pharmacist | `ndps_register` CHECK `ndps_different_pharmacists` | 0 | **DATABASE** | Strong |
| Patient identity uniqueness | `patients` UNIQUE `(hospital_id, uhid)` | 1,078 | **DATABASE** | Strong |
| Prescription context integrity | `prescriptions` CHECK `prescriptions_one_context` | 27 | **DATABASE** | Strong |
| Blood unit typing | `blood_units` 4 CHECKs + UNIQUE `(hospital_id, unit_number)` | 0 | **DATABASE** | Strong |
| Vitals mirroring | `mirror_nursing_vitals_to_ipd_vitals` trigger | 0 | **DATABASE** | Correct |
| Alert typing | `clinical_alerts` CHECK on `alert_type`, `severity` | 21 | **DATABASE** | Adequate |
| Drug–drug interactions | `drug_interactions` | **0** | FRONTEND + empty table | **Weak — C-13** |
| Allergy checking | *no table* | — | FRONTEND | **Weak — C-14** |
| Sepsis / NEWS2 alerting | `sepsis_alerts` | **absent** | FRONTEND, write fails | **Broken — C-05** |
| High-alert drug double-check | `high_alert_double_checks` | **0** | FRONTEND | **Weak — C-15** |
| Transfusion reaction records | `transfusion_reactions` | 0, no app refs | — | **Unused** |
| Vitals range validation | `ipd_vitals` (0 CHECKs) | 0 | FRONTEND | **Weak — C-16** |

---

## Strong: what is genuinely well built

**`ndps_register`** is the best-engineered table in the database. Controlled-substance records are
made immutable by a dedicated trigger (`prevent_ndps_register_mutation`) *and* by RLS
(`no_update_ndps`, `no_delete_ndps` with `USING (false)`), and the CHECK constraint
`ndps_different_pharmacists` enforces at the database level that the issuing and witnessing
pharmacist are different people. That is a statutory dual-custody rule implemented where it cannot
be bypassed — exactly right.

**PHI auditing** via the `log_phi_change` trigger on `patients`, `prescriptions`, `ndps_register`
and `bills` writes to `phi_access_audit`, which is itself insert-only and admin-read-only. The
audit trail cannot be edited by the application.

**`patients`** has zero policy churn across 14 migrations — the access model for the most
sensitive table was right the first time.

---

## C-13 · The drug-interaction table is empty

`drug_interactions` exists, has a `severity` CHECK, is correctly modelled — and contains
**0 rows**. `drug_allergy_cross_reactivity` likewise contains 0 rows.

[`src/lib/drugSafetyCheck.ts`](../../src/lib/drugSafetyCheck.ts) implements interaction checking in
browser TypeScript. It had a unit test, `drugSafetyCheck.test.ts`, removed 2026-09-05 with the
rest of the suite and not yet restored — CLAUDE.md names this file as carrying the highest
coverage bar in the repo, and it is currently at zero. The `check-drugbank-ddi` edge function
exists to query an external DDI service.

So the enforcement chain is: frontend logic → external API → an empty local table. There is no
database constraint preventing a prescription that conflicts with a recorded interaction, and no
seeded reference data for the local path to consult.

**Severity: HIGH.** Confidence HIGH on the emptiness and the absence of DB enforcement;
**INSUFFICIENT EVIDENCE** on whether `check-drugbank-ddi` is reliably reached on every prescribe
action, which would change the practical risk considerably.

## C-14 · There is no allergy table

`src/` queries `allergy_records`. No such table exists, and no live table models patient allergies
— the nearest is `drug_allergy_cross_reactivity` (0 rows), which models cross-reactivity between
drug classes, not a patient's recorded allergies.

`patients` has 34 columns; none is an allergy column. The allergy read in
`supabase/functions/update-patient-ai-context/index.ts` silently returns nothing, so the AI patient
context is assembled **without allergy data** and cannot know it is missing.

**Severity: HIGH.** Allergy status is the single most consulted contraindication in prescribing,
and this system has nowhere to store it.

## C-15 · High-alert drug double-checks are never recorded

`high_alert_double_checks` (12 columns, RLS enabled, correct tenant policy) has **0 rows** and
**0 application references** — no code path writes to it.

Independent double-check of high-alert medications (insulin, heparin, concentrated electrolytes,
chemotherapy) is an NABH and ISMP requirement. The table was created to satisfy it; nothing
implements it.

**Severity: MEDIUM** — this is an unimplemented control rather than a broken one, so it fails
visibly (empty reports) rather than silently producing wrong answers.

## C-16 · Vitals tables have no physiological range constraints

`ipd_vitals` (15 columns) carries **zero** CHECK constraints. Any numeric value is accepted for
heart rate, blood pressure, SpO₂, temperature or respiratory rate — including negatives and
values orders of magnitude out of range.

This matters more than usual because NEWS2 is computed from these values
([`src/lib/clinicalPredictions.ts`](../../src/lib/clinicalPredictions.ts)). A mistyped respiratory
rate propagates directly into a sepsis risk score and a critical clinical alert.

`nursing_vitals` is better — it has `pain_score` and `shift` CHECKs — and its
`mirror_nursing_vitals_to_ipd_vitals` trigger copies rows into `ipd_vitals`. That mirror is a
deliberate design (nursing captures, IPD reads), **not** duplication, and it is implemented
correctly in the database. But the mirror carries unvalidated values into the table NEWS2 reads.

**Severity: MEDIUM.** Both tables are currently empty, so nothing is wrong today.

---

## `sepsis_alerts` — see C-05

The most consequential clinical finding is documented in
[`21_CRITICAL_FINDINGS.md § C-05`](21_CRITICAL_FINDINGS.md): the sepsis early-warning path writes
to a table that does not exist, its 4-hour de-duplication guard therefore never suppresses
anything, and the alert audit trail is lost. The primary alert still reaches clinicians via
`clinical_alerts`, which is why it is rated HIGH rather than CRITICAL.

---

## Clinical tables with zero rows and zero application references

These exist in the schema but nothing reads or writes them. Not necessarily defects — several are
plainly built ahead of a feature — but each is an unimplemented clinical control:

`transfusion_reactions`, `blood_antibody_screening`, `partograph_records`, `med_admin_records`,
`mar_records`, `medication_adherence`, `dialyzer_reuse`, `embryology_records`, `coding_audits`,
`cold_storage_log`.

Note `med_admin_records` **and** `mar_records` — two tables for the Medication Administration
Record, both empty, both unreferenced. See
[`13_AI_CODE_DRIFT_FINDINGS.md`](13_AI_CODE_DRIFT_FINDINGS.md).

## Summary

The clinical layer divides cleanly. Where a rule was implemented **in the database** — narcotics
immutability, dual-custody, PHI audit, patient uniqueness, blood unit typing — it is implemented
well, and those controls are genuinely trustworthy. Where a rule was implemented **in the
frontend** — interactions, allergies, sepsis de-duplication, high-alert double-checks — it is
either unenforced, unseeded, or writing to a table that does not exist.

The pattern is consistent and worth stating plainly: this database enforces what it was asked to
enforce. The gap is in which rules were asked of it.
