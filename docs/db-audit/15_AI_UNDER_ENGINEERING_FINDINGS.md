# 15 — AI UNDER-ENGINEERING FINDINGS

Where the database does not enforce something the system depends on. This is the more dangerous
direction: over-engineering costs money, under-engineering costs correctness.

The governing observation: **this database enforces what it was asked to enforce, and was not
asked often enough.** Where a rule was expressed as a constraint or trigger it is generally
implemented well; where it was expressed as TypeScript it is not enforced at all.

---

## U-1 · 905 of 1,474 foreign keys have no index
**Severity: HIGH**

61% of FKs lack a supporting index, including **127 on `hospital_id`** — the column that appears
in nearly every RLS predicate — and **96 on `patient_id`**.

Every RLS-filtered query on those 127 tables is a sequential scan. Every parent `DELETE` scans
every child table fully, which matters because `purge_hospital*` functions exist to do exactly
that. Detail and full list: [C-08](21_CRITICAL_FINDINGS.md),
[`10_INDEX_PERFORMANCE_AUDIT.csv`](10_INDEX_PERFORMANCE_AUDIT.csv).

**Fix:** ~130 `CREATE INDEX CONCURRENTLY` statements. Purely additive, no downtime, no behaviour
change. The single highest value-to-risk action available.

## U-2 · No uniqueness on payments or charge lines
**Severity: HIGH**

`bill_payments` (115 rows) has **no UNIQUE constraint** — no idempotency key, no
`(bill_id, provider_reference)`. Payment providers guarantee at-least-once webhook delivery; a
retry inserts a second payment row and the patient's balance goes negative.

`bill_line_items` (215 rows) has **no UNIQUE constraint** — the same charge can be appended
repeatedly. This already happened: `20260613100000_fix_duplicate_consultation_line_items.sql` is a
**data repair** for it. The data was cleaned; the constraint that would prevent recurrence was
never added.

Fixing the data without adding the constraint is the defining shape of under-engineering.

**Fix:** `UNIQUE (bill_id, provider_reference)`; partial unique index on
`(bill_id, service_id, service_date)` scoped by `item_type`.

## U-3 · The general ledger has no balance constraint
**Severity: HIGH**

`journal_entries` (841 rows) carries `total_debit` and `total_credit`. `journal_line_items` (1,683
rows) carries the detail. **Nothing relates them.** No constraint enforces `total_debit =
total_credit`, that lines sum to the header, or that a `posted` entry has any lines at all.

`journal_line_items` has **0 CHECK constraints**.

This is not hypothetical — [C-03](21_CRITICAL_FINDINGS.md) shows the payroll path actively
producing posted, "balanced", line-less journal entries and reporting success.

**Fix:** correct the table name in the application first, then add a deferred constraint trigger.
Reconcile the existing 841 headers before enabling it.

## U-4 · Monetary totals have no database-side derivation or bounds
**Severity: HIGH**

No constraint, trigger or generated column re-derives `bills.total_amount` from `bill_line_items`.
There is not even `CHECK (total_amount >= 0)` or `CHECK (balance_due >= 0)`.

`bills` has three CHECK constraints — all on *categorical* fields (`bill_status`, `bill_type`,
`payment_status`), none on *monetary* fields. Combined with client-side computation
([C-06](21_CRITICAL_FINDINGS.md)), any caller with a valid session can write arbitrary totals and
mark a bill paid.

**Fix:** non-negativity CHECKs immediately (cheap, safe). Server-side derivation — either the
missing `recalculate_bill_totals` function or a trigger — as the real remedy.

## U-5 · Clinical values have no range constraints
**Severity: MEDIUM**

`ipd_vitals` has **0 CHECK constraints** across 15 columns. Heart rate, blood pressure, SpO₂,
temperature and respiratory rate accept any numeric value including negatives.

These feed NEWS2 scoring in [`src/lib/clinicalPredictions.ts`](../../src/lib/clinicalPredictions.ts),
so an out-of-range value propagates into a sepsis risk score and a critical alert.
`nursing_vitals` is better (`pain_score`, `shift` CHECKs) and mirrors into `ipd_vitals` via
trigger — carrying unvalidated values with it.

**Fix:** physiological-plausibility CHECKs on both. Both tables are currently empty, so this can be
added without a backfill.

## U-6 · Identity linkage is unconstrained
**Severity: MEDIUM**

`users.auth_user_id` is nullable with no constraint requiring linkage. Live: **10 users with NULL
`auth_user_id`** and **7 `auth.users` with no `public.users` row** — 17 identities for which
`get_user_hospital_id()` returns NULL, every tenant policy denies, and the user sees a functioning
but empty application with no explanation.

The provisioning flow legitimately creates the business row before the login, so a `NOT NULL`
constraint would be wrong.

**Fix:** a scheduled reconciliation report, and an explicit "account not linked" state in the UI
rather than an empty app. Detail: [`07_IDENTITY_ARCHITECTURE_AUDIT.md § I-3`](07_IDENTITY_ARCHITECTURE_AUDIT.md).

## U-7 · Role is unconstrained free text
**Severity: LOW**

`users.role` is `text`, compared against the `app_role` enum inside `has_role` via cast. Nothing
restricts the stored value to enum members. An arbitrary string is accepted and simply never
matches any role check.

Fails closed, hence LOW. But the enum documents rather than enforces — and it contains duplicate
values (`lab_tech`/`lab_technician`) that make the mismatch likelier
([D-4](13_AI_CODE_DRIFT_FINDINGS.md)).

## U-8 · `status` is free text on 162 of 163 tables
**Severity: MEDIUM**

One table uses an enum type; 162 use `text`. 374 CHECK constraints cover status vocabularies
unevenly — `bills` constrains all three of its status columns, `journal_line_items` has none.

Consequence: the valid vocabulary for a status lives in up to three places (enum types, CHECK
constraints, TypeScript literals) with no authority. The application can write a status the
database accepts and no reader understands.

**Fix:** add CHECK constraints to status columns on the transactional tables that lack them —
cheaper and lower-risk than enum conversion, and sufficient.

## U-9 · Safety rules that exist only in the frontend
**Severity: HIGH**

| Rule | Enforced at | DB backing |
|---|---|---|
| Drug–drug interaction checking | frontend + external API | `drug_interactions` — **0 rows** |
| Allergy contraindication | frontend | **no table exists** |
| High-alert drug double-check | — | `high_alert_double_checks` — 0 rows, 0 refs |
| Sepsis alert de-duplication | frontend | table absent, guard never fires |
| Bill total arithmetic | frontend | no constraint |

Every one is a rule the system claims to implement, enforced only where the user's browser can be
bypassed by any direct API call. Detail: [`16_CLINICAL_DATABASE_AUDIT.md`](16_CLINICAL_DATABASE_AUDIT.md).

## U-10 · No soft-delete strategy
**Severity: MEDIUM**

`deleted_at` exists on **1 of 548** tables. Deletions are physical.

Combined with 18 `ON DELETE CASCADE` FKs reaching `ndps_register`, `phi_access_audit`,
`journal_entries` and `bill_payments` ([C-10](21_CRITICAL_FINDINGS.md)), there is no recovery path
and no tombstone for records that regulation requires be retained.

`updated_at` on only 96 of 548 tables compounds this — most tables cannot say when they last
changed.

**Fix:** for statutory tables specifically, replace CASCADE with `ON DELETE RESTRICT` and add an
explicit archival step to the purge path. Do not add `deleted_at` everywhere — that is a large
change for a diffuse benefit.

## U-11 · Views omit `security_invoker` — see C-13
**Severity: CRITICAL**

Six of eight views run as their `postgres` owner with RLS bypassed; four have no tenant filter and
are granted to `anon`, exposing patient identifiers and financial balances across all hospitals.

The under-engineering framing: the schema relies on RLS as its sole access-control layer, then
creates views that silently opt out of it. Two views set `security_invoker` correctly, so the
mechanism was known.

Detail: [C-13](21_CRITICAL_FINDINGS.md), [`18_SECURITY_DATABASE_AUDIT.md § S-1`](18_SECURITY_DATABASE_AUDIT.md).

---

## Summary, ordered by value-to-risk

| # | Finding | Severity | Fix cost | Risk of fixing |
|---|---|---|---|---|
| U-11 | Views bypass RLS | CRITICAL | 6 `ALTER VIEW` | Very low |
| U-1 | 905 unindexed FKs | HIGH | ~130 `CREATE INDEX CONCURRENTLY` | Very low |
| U-3 | GL has no balance constraint | HIGH | App fix + trigger | Low, needs reconciliation |
| U-2 | No payment/line-item uniqueness | HIGH | 2 constraints | Low, needs dedup first |
| U-4 | No monetary bounds or derivation | HIGH | CHECKs now, trigger later | Low |
| U-9 | Clinical rules frontend-only | HIGH | Seed data + constraints | Medium |
| U-5 | No vitals range constraints | MEDIUM | CHECKs | Very low (tables empty) |
| U-8 | Free-text status | MEDIUM | CHECKs on transactional tables | Low |
| U-10 | No soft delete / CASCADE on statutory data | MEDIUM | FK action changes | Medium |
| U-6 | Unconstrained identity linkage | MEDIUM | Reconciliation report | Very low |
| U-7 | Unconstrained role text | LOW | One CHECK | Very low |

**The pattern.** Under-engineering here is not carelessness — `ndps_register` proves the team
could implement immutability, dual-custody and audit triggers correctly when the requirement was
explicit. The gap is that constraints were added **reactively, after a defect appeared**, and then
often only as a data repair. `fix_duplicate_consultation_line_items` cleaned duplicate rows without
adding the unique constraint; `billing_leakage_fix` repaired revenue data without adding the
derivation. Each fixed the instance and left the class open.

Closing the classes — roughly a dozen constraints and 130 indexes — is the single highest-leverage
work available, and almost all of it is additive and reversible.
